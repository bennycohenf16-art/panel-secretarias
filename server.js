process.env.TZ = 'America/Mexico_City';
require('dotenv').config();

// Guarda de arranque — el sistema no puede operar sin estas variables
if (!process.env.DATABASE_URL) { console.error('[FATAL] DATABASE_URL no definida — abortando.'); process.exit(1); }
if (!process.env.JWT_SECRET)   { console.error('[FATAL] JWT_SECRET no definida — abortando.'); process.exit(1); }

const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cron = require('node-cron');
const Stripe = require('stripe');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normPhone = (t) => { const d = (t || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d; };

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET;
const FACTORY_SECRET = process.env.FACTORY_SECRET;
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY.trim()) : null;

const h = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK — CRÍTICO: debe estar ANTES de app.use(express.json()).
// express.raw() consume el cuerpo crudo necesario para validar la firma.
// Moverlo después del middleware global rompe stripe.webhooks.constructEvent.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), h(async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe no configurado' });

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('[STRIPE WEBHOOK] Firma inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[STRIPE WEBHOOK] Evento: ${event.type}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const doctorId = session.metadata?.doctorId;
        if (!doctorId) {
          console.warn('[STRIPE WEBHOOK] checkout.session.completed sin doctorId en metadata');
          break;
        }
        const customerId = session.customer;
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const endsAt = new Date(sub.current_period_end * 1000);
        await pool.query(
          'UPDATE doctors SET stripe_customer_id=$1, subscription_status=$2, subscription_ends_at=$3 WHERE id=$4',
          [customerId, 'active', endsAt, doctorId]
        );
        console.log(`[STRIPE WEBHOOK] ✅ Doctor ${doctorId} activado → ${endsAt.toISOString()}`);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const periodEndUnix = invoice.lines?.data?.[0]?.period?.end;
        if (periodEndUnix) {
          const endsAt = new Date(periodEndUnix * 1000);
          await pool.query(
            "UPDATE doctors SET subscription_status='active', subscription_ends_at=$1, grace_period_until=NULL WHERE stripe_customer_id=$2",
            [endsAt, customerId]
          );
        } else {
          await pool.query(
            "UPDATE doctors SET subscription_status='active', grace_period_until=NULL WHERE stripe_customer_id=$1",
            [customerId]
          );
        }
        console.log(`[STRIPE WEBHOOK] ✅ Renovación pagada — customer ${customerId}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await pool.query(
          "UPDATE doctors SET subscription_status='unpaid' WHERE stripe_customer_id=$1",
          [sub.customer]
        );
        console.log(`[STRIPE WEBHOOK] ⚠️ Suscripción cancelada — customer ${sub.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const gracePeriodUntil = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
        await pool.query(
          "UPDATE doctors SET subscription_status='past_due', grace_period_until=$1 WHERE stripe_customer_id=$2",
          [gracePeriodUntil, invoice.customer]
        );
        console.log(`[STRIPE WEBHOOK] ❌ Pago fallido — customer ${invoice.customer} — gracia hasta ${gracePeriodUntil.toISOString()}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (sub.status === 'past_due') {
          const gracePeriodUntil = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
          await pool.query(
            "UPDATE doctors SET subscription_status='past_due', grace_period_until=$1 WHERE stripe_customer_id=$2",
            [gracePeriodUntil, sub.customer]
          );
          console.log(`[STRIPE WEBHOOK] ⚠️ Suscripción past_due — customer ${sub.customer} — gracia hasta ${gracePeriodUntil.toISOString()}`);
        }
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK] Evento no manejado: ${event.type}`);
    }
  } catch (dbErr) {
    console.error('[STRIPE WEBHOOK] Error en DB:', dbErr.message);
    return res.status(500).json({ error: 'Error procesando evento' });
  }

  res.json({ received: true });
}));

app.use(express.json());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4000',
  process.env.FRONTEND_URL,
].filter(Boolean).map(url => url.trim().replace(/\/$/, ''));

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.trim().replace(/\/$/, '');
    if (allowedOrigins.includes(cleanOrigin)) return callback(null, true);
    console.log('❌ Origen bloqueado por CORS:', origin);
    return callback(new Error('No permitido por CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Pre-flight handler explícito para todas las rutas
app.options('*', cors());

// ─────────────────────────────────────────────────────────────────────────────
// Tablas PROPIAS de panel-secretarias (coexisten de forma segura con factory_prod):
//   doctors       — cuentas de doctores/secretarias
//   appointments  — citas agendadas
//
// Tablas de bot-factory que comparten la misma DB — NUNCA se tocan aquí:
//   bots, bot_items, settings, catalogs, citas, patients, conv_state, wa_sessions
// ─────────────────────────────────────────────────────────────────────────────
async function initDB() {
  const dbHost = (process.env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@').split('?')[0];
  console.log(`[db] Conectando a: ${dbHost}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      email         VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      bot_slug      VARCHAR(255) UNIQUE NOT NULL,
      panel_token   VARCHAR(255) UNIQUE NOT NULL,
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id        SERIAL PRIMARY KEY,
      doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
      nombre    VARCHAR(255) NOT NULL,
      telefono  VARCHAR(50)  DEFAULT '',
      fecha     DATE         NOT NULL,
      hora      TIME         NOT NULL,
      motivo    TEXT         DEFAULT '',
      status    VARCHAR(50)  DEFAULT 'pendiente',
      source    VARCHAR(50)  DEFAULT 'whatsapp',
      created_at TIMESTAMP   DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'doctor'`);
  await pool.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waiting_list (
      id              SERIAL PRIMARY KEY,
      doctor_id       INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      nombre          VARCHAR(255) NOT NULL,
      telefono        VARCHAR(50)  NOT NULL,
      bot_slug        VARCHAR(255) DEFAULT '',
      fecha_preferida DATE,
      origen          VARCHAR(50)  DEFAULT 'manual',
      created_at      TIMESTAMP    DEFAULT NOW(),
      UNIQUE(doctor_id, telefono)
    )
  `);
  await pool.query(`ALTER TABLE waiting_list ADD COLUMN IF NOT EXISTS fecha_preferida DATE`);
  await pool.query(`ALTER TABLE waiting_list ADD COLUMN IF NOT EXISTS origen VARCHAR(50) DEFAULT 'manual'`);
  await pool.query(`ALTER TABLE waiting_list ADD COLUMN IF NOT EXISTS horario_preferencia TEXT`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id         SERIAL PRIMARY KEY,
      doctor_id  INT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      fecha      DATE NOT NULL,
      hora       TIME NULL,
      motivo     TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS secretary_logs (
      id             SERIAL PRIMARY KEY,
      secretary_id   INT NOT NULL,
      secretary_name VARCHAR(255),
      appointment_id INT,
      action         VARCHAR(50),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migraciones de facturación Stripe
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'unpaid'`);
  await pool.query(`ALTER TABLE doctors ALTER COLUMN subscription_status SET DEFAULT 'active'`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS grace_period_until TIMESTAMP DEFAULT NULL`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS horario_semanal JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 1`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id             SERIAL PRIMARY KEY,
      user_id        INT NOT NULL,
      action         VARCHAR(100) NOT NULL,
      appointment_id INT,
      meta           JSONB,
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log('[db] Schema panel-secretarias OK');

  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM doctors');
  if (parseInt(rows[0].total) === 0) {
    const hash = await bcrypt.hash('1234', 10);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO doctors (name, email, password_hash, bot_slug, panel_token, role, force_password_change)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      ['Admin', 'admin@bot.com', hash, 'admin-seed', token, 'admin']
    );
    console.log('[db] Seed ejecutado → admin@bot.com / 1234 (force_password_change=true)');
  } else {
    console.log(`[db] Seed omitido — ya existen ${rows[0].total} doctor(es)`);
  }
}

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Sesión expirada' });
  }
  try {
    const { rows } = await pool.query('SELECT token_version, subscription_status FROM doctors WHERE id=$1', [decoded.id]);
    if (!rows.length || rows[0].token_version !== (decoded.token_version ?? 1)) {
      return res.status(401).json({ error: 'Sesión revocada' });
    }
    if (rows[0].subscription_status === 'blocked' && decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Cuenta suspendida por falta de pago' });
    }
  } catch {
    return res.status(401).json({ error: 'Error de autenticación' });
  }
  req.user = decoded;
  next();
}

// Variante para rutas de facturación: valida JWT pero no bloquea cuentas 'blocked'
// para que el doctor pueda llegar al checkout y reactivar su suscripción.
async function authBilling(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada' });
  }
}

function authOrInternal(req, res, next) {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (internalKey && req.headers['x-internal-key'] === internalKey) {
    req.user = null;
    return next();
  }
  auth(req, res, next);
}

// ── Factory: crear cuenta de doctor ──────────────────────────────────────────
app.post('/api/doctors', h(async (req, res) => {
  const { factory_secret, name, email, password, bot_slug } = req.body;
  if (factory_secret !== FACTORY_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  if (!email || !password || !bot_slug)
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  const password_hash = await bcrypt.hash(password, 10);
  const panel_token = crypto.randomBytes(32).toString('hex');
  try {
    const r = await pool.query(
      'INSERT INTO doctors (name,email,password_hash,bot_slug,panel_token) VALUES ($1,$2,$3,$4,$5) RETURNING id,panel_token',
      [name, email, password_hash, bot_slug, panel_token]
    );
    res.json({ ok: true, panel_token: r.rows[0].panel_token });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email o bot ya registrado' });
    throw e;
  }
}));

// ── Factory: recuperar panel_token de cuenta existente ───────────────────────
app.post('/api/doctors/recover-token', h(async (req, res) => {
  const { factory_secret, email, password } = req.body;
  if (factory_secret !== FACTORY_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  if (!email || !password) return res.status(400).json({ error: 'Faltan campos' });
  const r = await pool.query('SELECT * FROM doctors WHERE email=$1', [email.trim().toLowerCase()]);
  if (!r.rows.length) return res.status(404).json({ error: 'Cuenta no encontrada' });
  const doc = r.rows[0];
  const valid = await bcrypt.compare(password, doc.password_hash);
  if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ ok: true, panel_token: doc.panel_token });
}));

// ── Factory: reasignar cuenta existente por bot_slug (nueva email+pass) ───────
app.post('/api/doctors/reassign', h(async (req, res) => {
  const { factory_secret, bot_slug, name, email, password } = req.body;
  if (factory_secret !== FACTORY_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  if (!bot_slug || !email || !password) return res.status(400).json({ error: 'Faltan campos' });
  const r = await pool.query('SELECT * FROM doctors WHERE bot_slug=$1', [bot_slug]);
  if (!r.rows.length) return res.status(404).json({ error: 'Bot no encontrado' });
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query('UPDATE doctors SET email=$1, password_hash=$2, name=$3 WHERE bot_slug=$4',
      [email.trim().toLowerCase(), hash, name || r.rows[0].name, bot_slug]);
  } catch(e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ese email ya está en uso por otro bot' });
    throw e;
  }
  const updated = await pool.query('SELECT panel_token FROM doctors WHERE bot_slug=$1', [bot_slug]);
  res.json({ ok: true, panel_token: updated.rows[0].panel_token });
}));

// ── Factory: eliminar cuenta de doctor por bot_slug ──────────────────────────
app.delete('/api/doctors/by-slug/:slug', h(async (req, res) => {
  const { factory_secret } = req.body || {};
  if (factory_secret !== FACTORY_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  const r = await pool.query('DELETE FROM doctors WHERE bot_slug=$1 RETURNING id', [req.params.slug]);
  if (!r.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  res.json({ ok: true, deleted: r.rows[0].id });
}));

// ── Factory: actualizar contraseña ────────────────────────────────────────────
app.put('/api/doctors/password', h(async (req, res) => {
  const { factory_secret, email, password } = req.body;
  if (factory_secret !== FACTORY_SECRET)
    return res.status(401).json({ error: 'No autorizado' });
  const hash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE doctors SET password_hash=$1 WHERE email=$2', [hash, email]);
  res.json({ ok: true });
}));

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', h(async (req, res) => {
  const { email, password } = req.body;
  const r = await pool.query('SELECT * FROM doctors WHERE email=$1', [email.trim().toLowerCase()]);
  if (!r.rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const doc = r.rows[0];
  const ok = await bcrypt.compare(password, doc.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const forceChange = !!doc.force_password_change;
  const token = jwt.sign(
    { id: doc.id, name: doc.name, email: doc.email, role: doc.role || 'doctor', force_password_change: forceChange, token_version: doc.token_version ?? 1 },
    JWT_SECRET,
    { expiresIn: '14d' }
  );
  res.json({
    token,
    name: doc.name,
    email: doc.email,
    force_password_change: forceChange,
    subscription_status:  doc.subscription_status  || 'active',
    grace_period_until:   doc.grace_period_until   || null,
  });
}));

// ── Cambio de contraseña autenticado (auto-servicio) ──────────────────────────
app.put('/api/auth/change-password', auth, h(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Se requieren currentPassword y newPassword' });
  if (newPassword.length < 6)
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

  const r = await pool.query('SELECT password_hash FROM doctors WHERE id=$1', [req.user.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

  const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    'UPDATE doctors SET password_hash=$1, force_password_change=FALSE, token_version = token_version + 1 WHERE id=$2',
    [hash, req.user.id]
  );
  res.json({ ok: true });
}));

// ── Webhook: bot envía cita nueva ─────────────────────────────────────────────
app.post('/api/webhook', h(async (req, res) => {
  const secret = process.env.INTERNAL_WEBHOOK_TOKEN;
  if (!secret || req.headers['x-webhook-token'] !== secret)
    return res.status(401).json({ error: 'Token de webhook inválido' });
  const { token, nombre, telefono, fecha, hora, motivo } = req.body;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const r = await pool.query('SELECT id FROM doctors WHERE panel_token=$1', [token]);
  if (!r.rows.length) return res.status(401).json({ error: 'Token inválido' });
  await pool.query(
    'INSERT INTO appointments (doctor_id,nombre,telefono,fecha,hora,motivo,source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.rows[0].id, nombre, normPhone(telefono), fecha, hora, motivo || '', 'whatsapp']
  );
  res.json({ ok: true });
}));

// ── Helper: slots disponibles (comparte lógica con bot-engine) ────────────────
const DIAS_ES_P = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];

async function calcAvailableSlots(doctorId, fecha) {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [doctorId]);
  if (!dr.rows.length) return [];
  const botSlug = dr.rows[0].bot_slug;

  let schedule = {};
  try {
    const { rows } = await pool.query("SELECT config FROM bots WHERE status='deployed'");
    for (const row of rows) {
      const c = JSON.parse(row.config);
      if (c.panelSlug === botSlug) { schedule = c.schedule || {}; break; }
    }
  } catch {}

  const diaNombre = DIAS_ES_P[new Date(fecha + 'T12:00:00').getDay()];
  const dayConfig = schedule.days?.[diaNombre];
  if (!dayConfig?.active) return [];

  const slotMin = schedule.slotDuration || 30;
  const [sH, sM] = dayConfig.start.split(':').map(Number);
  const [eH, eM] = dayConfig.end.split(':').map(Number);
  const lunchFrom = schedule.lunchBreak?.active ? schedule.lunchBreak.from : null;
  const lunchTo   = schedule.lunchBreak?.active ? schedule.lunchBreak.to   : null;

  const { rows: diaBlq } = await pool.query(
    'SELECT id FROM blocked_slots WHERE doctor_id=$1 AND fecha=$2 AND hora IS NULL LIMIT 1',
    [doctorId, fecha]
  );
  if (diaBlq.length) return [];

  const { rows: apptRows } = await pool.query(
    "SELECT hora FROM appointments WHERE doctor_id=$1 AND fecha=$2 AND status!='cancelada'",
    [doctorId, fecha]
  );
  const { rows: bloqRows } = await pool.query(
    'SELECT hora FROM blocked_slots WHERE doctor_id=$1 AND fecha=$2 AND hora IS NOT NULL',
    [doctorId, fecha]
  );
  const ocupadas = new Set([
    ...apptRows.map(r => String(r.hora).slice(0, 5)),
    ...bloqRows.map(r => String(r.hora).slice(0, 5))
  ]);

  const slots = [];
  let cur = sH * 60 + sM;
  const end = eH * 60 + eM;
  while (cur + slotMin <= end) {
    const h = String(Math.floor(cur / 60)).padStart(2, '0');
    const m = String(cur % 60).padStart(2, '0');
    const t = `${h}:${m}`;
    if (lunchFrom && lunchTo) {
      const [lh, lm2] = lunchFrom.split(':').map(Number);
      const [leh, lem] = lunchTo.split(':').map(Number);
      if (cur >= lh * 60 + lm2 && cur < leh * 60 + lem) { cur += slotMin; continue; }
    }
    if (!ocupadas.has(t)) slots.push(t);
    cur += slotMin;
  }
  return slots;
}

// ── Helper centralizado de notificaciones de cambio de estado ─────────────────
// Textos planos y rotativos para notificaciones del panel — sin emojis ni markdown
const NOTIF_CONFIRMACION = [
  (n, f, h) => `Hola ${n}, tu cita para el ${f} a las ${h} ya está confirmada en nuestra agenda. Te esperamos.`,
  (n, f, h) => `Buen día ${n}. Tu espacio está reservado para el ${f} a las ${h}. Recuerda llegar unos minutos antes.`,
  (n, f, h) => `${n}, confirmamos tu consulta para el ${f} a las ${h}. Cualquier duda nos escribes por aquí.`,
  (n, f, h) => `Hola ${n}, ya quedó agendada tu cita para el ${f} a las ${h}. Te avisamos para que no se te olvide.`,
  (n, f, h) => `Todo listo ${n}. Tu cita del ${f} a las ${h} está confirmada en el sistema.`,
];

const NOTIF_CANCELACION = [
  (n, f, h) => `Hola ${n}, te informamos que tu cita del ${f} a las ${h} ha sido cancelada.`,
  (n, f, h) => `${n}, el espacio que tenías reservado para el ${f} a las ${h} ha quedado liberado.`,
  (n, f, h) => `Hola ${n}. Tu cita programada para el ${f} a las ${h} fue cancelada por el consultorio.`,
  (n, f, h) => `${n}, te avisamos que ya no tienes cita para el ${f}. Escríbenos si quieres reagendar.`,
  (n, f, h) => `Hola ${n}, la cita del ${f} a las ${h} fue cancelada. Cuando gustes podemos buscar otra fecha.`,
];

async function notificarCambioEstado(citaId, estadoAnterior, estadoNuevo, doctorId) {
  const nuevoLimpio    = (estadoNuevo    || '').toLowerCase().trim();
  const anteriorLimpio = (estadoAnterior || '').toLowerCase().trim();

  const esCancelacion  = nuevoLimpio === 'cancelada';
  const esConfirmacion = nuevoLimpio === 'confirmada';
  if (!esCancelacion && !esConfirmacion) return;

  console.log(`[BRIDGE] notificarCambioEstado | ID:${citaId} | ${anteriorLimpio} -> ${nuevoLimpio}`);

  try {
    const [apptRes, drRes] = await Promise.all([
      pool.query(
        'SELECT nombre, telefono, fecha, hora FROM appointments WHERE id=$1 AND doctor_id=$2',
        [citaId, doctorId]
      ),
      pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [doctorId])
    ]);

    if (!apptRes.rows.length) { console.warn('[BRIDGE] Cita no encontrada:', citaId); return; }
    if (!drRes.rows.length)   { console.warn('[BRIDGE] bot_slug no encontrado para doctor:', doctorId); return; }

    const { nombre = '', telefono = '', fecha, hora } = apptRes.rows[0];
    const botSlug = drRes.rows[0].bot_slug;

    if (!telefono.trim()) { console.warn('[BRIDGE] Teléfono vacío en cita:', citaId); return; }

    let fechaCitaStr = 'la fecha programada';
    if (fecha) {
      const isoDate = typeof fecha === 'string' ? fecha.split('T')[0] : fecha.toISOString().substring(0, 10);
      const d = new Date(`${isoDate}T12:00:00`);
      if (!isNaN(d)) fechaCitaStr = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    }
    const horaFmt = String(hora || '').substring(0, 5);

    // Elegir plantilla aleatoria y calcular delay humano 2–5 min
    const banco    = esCancelacion ? NOTIF_CANCELACION : NOTIF_CONFIRMACION;
    const plantilla = banco[Math.floor(Math.random() * banco.length)];
    const text     = plantilla(nombre, fechaCitaStr, horaFmt);
    const delayMs  = Math.floor(120000 + Math.random() * 180000); // 2–5 min

    const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
    const apiKey  = process.env.INTERNAL_API_KEY || '';
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(`${baseUrl}/api/messages/send-notification`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        body:    JSON.stringify({ botSlug, phone: telefono, text, delayMs }),
        signal:  controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const raw = await resp.text();
        console.error(`[BRIDGE] Bot respondio ${resp.status}: ${raw.substring(0, 120)}`);
      } else {
        console.log(`[BRIDGE] Notificacion programada | ${nuevoLimpio} → ${nombre} | delay ${Math.round(delayMs / 60000)} min`);
      }
    } catch (botError) {
      clearTimeout(timeoutId);
      console.error('[BRIDGE] El bot no respondio, DB ya actualizada:', botError.message);
    }
  } catch (err) {
    console.error('[BRIDGE] Error preparando la notificacion:', err.message);
  }
}

// ── Slots disponibles ─────────────────────────────────────────────────────────
app.get('/api/appointments/available-slots', auth, h(async (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: 'Falta fecha' });
  const [slots, { rows: activeRows }] = await Promise.all([
    calcAvailableSlots(req.user.id, fecha),
    pool.query(
      "SELECT 1 FROM appointments WHERE doctor_id=$1 AND fecha=$2 AND status!='cancelada' LIMIT 1",
      [req.user.id, fecha]
    )
  ]);

  // Si la fecha pedida es HOY en CDMX, eliminar slots cuya hora ya pasó
  let filteredSlots = slots;
  if (fecha === todayCDMX()) {
    const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    filteredSlots = slots.filter(slot => {
      const [hH, hMin] = slot.split(':').map(Number);
      const slotDt = new Date(nowMx.getFullYear(), nowMx.getMonth(), nowMx.getDate(), hH, hMin, 0);
      return slotDt > nowMx;
    });
  }

  res.json({ slots: filteredSlots, hasActiveAppointments: activeRows.length > 0 });
}));

// ── Bloqueos ──────────────────────────────────────────────────────────────────
app.get('/api/blocked-slots', auth, h(async (req, res) => {
  const { fecha } = req.query;
  const params = [req.user.id];
  let q = 'SELECT * FROM blocked_slots WHERE doctor_id=$1';
  if (fecha) { q += ' AND fecha=$2'; params.push(fecha); }
  q += ' ORDER BY fecha ASC, hora ASC NULLS FIRST';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

app.post('/api/blocked-slots', auth, h(async (req, res) => {
  const { fecha, hora, motivo } = req.body;
  if (!fecha) return res.status(400).json({ error: 'Falta fecha' });
  if (!hora) {
    const { rows: active } = await pool.query(
      "SELECT 1 FROM appointments WHERE doctor_id=$1 AND fecha=$2 AND status!='cancelada' LIMIT 1",
      [req.user.id, fecha]
    );
    if (active.length > 0)
      return res.status(400).json({ error: 'No puedes bloquear este día completo porque existen citas activas agendadas.' });
  }
  const { rows } = await pool.query(
    'INSERT INTO blocked_slots (doctor_id,fecha,hora,motivo) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.user.id, fecha, hora || null, motivo || null]
  );
  res.json(rows[0]);
}));

app.delete('/api/blocked-slots/:id', auth, h(async (req, res) => {
  await pool.query('DELETE FROM blocked_slots WHERE id=$1 AND doctor_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ── Citas ─────────────────────────────────────────────────────────────────────
app.get('/api/appointments', auth, h(async (req, res) => {
  const { fecha } = req.query;
  const params = [req.user.id];
  let where = 'doctor_id=$1';
  if (fecha) { where += ' AND fecha=$2'; params.push(fecha); }
  const r = await pool.query(
    `SELECT * FROM appointments WHERE ${where} ORDER BY fecha ASC, hora ASC`,
    params
  );
  res.json(r.rows);
}));

app.get('/api/appointments/month', auth, h(async (req, res) => {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const r = await pool.query(
    'SELECT COUNT(*) AS total FROM appointments WHERE doctor_id=$1 AND fecha >= $2',
    [req.user.id, start]
  );
  res.json({ total: parseInt(r.rows[0].total) });
}));

app.get('/api/appointments/rejected', auth, h(async (req, res) => {
  const r = await pool.query(
    `SELECT id, nombre, telefono, fecha, hora, motivo, created_at
     FROM appointments WHERE doctor_id=$1 AND status='rechazada'
     ORDER BY created_at DESC`,
    [req.user.id]
  );
  console.log(`[REJECTED] doctor_id=${req.user.id} → ${r.rows.length} registros`);
  res.json(r.rows);
}));

app.post('/api/appointments', authOrInternal, h(async (req, res) => {
  console.log('[BACKEND INCOMING APPOINTMENT]', req.body);
  const { nombre, telefono, fecha, hora, motivo, status: bodyStatus, doctor_id: bodyDoctorId } = req.body;
  const doctorId = req.user?.id ?? bodyDoctorId;
  if (!doctorId) return res.status(400).json({ error: 'doctor_id requerido' });

  // Candado de hora pasada — solo para bookings manuales desde el panel (req.user)
  if (req.user && fecha && hora) {
    const horaPrefix = String(hora).slice(0, 5);
    const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const [fY, fM, fD] = fecha.split('-').map(Number);
    const [hH, hMin]   = horaPrefix.split(':').map(Number);
    const slotDt = new Date(fY, fM - 1, fD, hH, hMin, 0);
    if (slotDt <= nowMx)
      return res.status(400).json({ error: 'No puedes agendar en una hora que ya pasó.' });
  }
  const source = req.user ? 'manual' : 'whatsapp';
  const status = (!req.user && bodyStatus) ? bodyStatus : 'pendiente';
  const r = await pool.query(
    'INSERT INTO appointments (doctor_id,nombre,telefono,fecha,hora,motivo,status,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [doctorId, nombre, normPhone(telefono), fecha, hora, motivo || '', status, source]
  );
  if (req.user) {
    await pool.query(
      'INSERT INTO secretary_logs (secretary_id,secretary_name,appointment_id,action) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, r.rows[0].id, 'crear_manual']
    );
  }
  res.json(r.rows[0]);
}));

app.put('/api/appointments/:id', auth, h(async (req, res) => {
  const { nombre, telefono, fecha, hora, motivo, status } = req.body;
  const citaId   = req.params.id;
  const doctorId = req.user.id;

  const prev = await pool.query(
    'SELECT status FROM appointments WHERE id=$1 AND doctor_id=$2',
    [citaId, doctorId]
  );
  const estadoAnterior = (prev.rows[0]?.status || '').toLowerCase().trim();

  const r = await pool.query(
    'UPDATE appointments SET nombre=$1,telefono=$2,fecha=$3,hora=$4,motivo=$5,status=$6 WHERE id=$7 AND doctor_id=$8 RETURNING *',
    [nombre, normPhone(telefono), fecha, hora, motivo || '', status, citaId, doctorId]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });

  const nuevoLimpioP = (status || '').toLowerCase().trim();
  if (req.user && (nuevoLimpioP === 'confirmada' || nuevoLimpioP === 'cancelada')) {
    await pool.query(
      'INSERT INTO secretary_logs (secretary_id,secretary_name,appointment_id,action) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, citaId, nuevoLimpioP === 'confirmada' ? 'confirmar' : 'cancelar']
    );
  }

  await notificarCambioEstado(citaId, estadoAnterior, status, doctorId);

  res.json(r.rows[0]);
}));

app.patch('/api/appointments/:id/status', auth, h(async (req, res) => {
  const citaId    = req.params.id;
  const doctorId  = req.user.id;
  const nuevoEstado = (req.body.status || '').toLowerCase().trim();

  const prev = await pool.query(
    'SELECT status FROM appointments WHERE id=$1 AND doctor_id=$2',
    [citaId, doctorId]
  );
  if (!prev.rows.length) return res.status(404).json({ error: 'No encontrada' });
  const estadoAnterior = (prev.rows[0].status || '').toLowerCase().trim();

  console.log(`[CAMBIO ESTADO] Cita ID: ${citaId} | Estado Anterior: ${estadoAnterior} -> Nuevo Estado: ${nuevoEstado}`);

  await pool.query(
    'UPDATE appointments SET status=$1 WHERE id=$2 AND doctor_id=$3',
    [nuevoEstado, citaId, doctorId]
  );

  if (req.user && (nuevoEstado === 'confirmada' || nuevoEstado === 'cancelada')) {
    await pool.query(
      'INSERT INTO secretary_logs (secretary_id,secretary_name,appointment_id,action) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, citaId, nuevoEstado === 'confirmada' ? 'confirmar' : 'cancelar']
    );
  }

  // Auditoría para overrides manuales de citas pasadas
  if (req.user && (nuevoEstado === 'atendida' || nuevoEstado === 'ausente')) {
    await pool.query(
      `INSERT INTO activity_logs (user_id, action, appointment_id, meta)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, `manual_override_${nuevoEstado}`, citaId,
       JSON.stringify({ user_name: req.user.name, estado_anterior: estadoAnterior, estado_nuevo: nuevoEstado })]
    );
    await pool.query(
      'INSERT INTO secretary_logs (secretary_id,secretary_name,appointment_id,action) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.user.name, citaId, nuevoEstado]
    );
  }

  await notificarCambioEstado(citaId, estadoAnterior, nuevoEstado, doctorId);

  res.json({ ok: true });
}));

app.delete('/api/appointments/:id', auth, h(async (req, res) => {
  await pool.query('DELETE FROM appointments WHERE id=$1 AND doctor_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ── Historial de paciente ─────────────────────────────────────────────────────
app.get('/api/patients/:telefono', auth, h(async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM appointments WHERE doctor_id=$1 AND telefono=$2 ORDER BY fecha DESC, hora DESC',
    [req.user.id, req.params.telefono]
  );
  res.json(r.rows);
}));

// ── Analíticas ────────────────────────────────────────────────────────────────
app.get('/api/analytics', auth, h(async (req, res) => {
  const did = req.user.id;
  const [sourceRes, statusRes, dowRes] = await Promise.all([
    pool.query(
      `SELECT source, COUNT(*)::int AS count
       FROM appointments
       WHERE doctor_id = $1
         AND created_at >= (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') - INTERVAL '30 days'
       GROUP BY source`,
      [did]
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM appointments
       WHERE doctor_id = $1
       GROUP BY status`,
      [did]
    ),
    pool.query(
      `SELECT EXTRACT(DOW FROM fecha)::int AS dow, COUNT(*)::int AS count
       FROM appointments
       WHERE doctor_id = $1
       GROUP BY dow
       ORDER BY dow`,
      [did]
    ),
  ]);
  res.json({
    bySource:    sourceRes.rows,
    byStatus:    statusRes.rows,
    byDayOfWeek: dowRes.rows,
  });
}));

// ── Lista de espera ───────────────────────────────────────────────────────────
app.get('/api/waiting-list', auth, h(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM waiting_list WHERE doctor_id=$1 ORDER BY created_at ASC',
    [req.user.id]
  );
  res.json(rows);
}));

app.post('/api/waiting-list', auth, h(async (req, res) => {
  const { nombre, telefono, fecha_preferida } = req.body;
  if (!nombre?.trim() || !telefono?.trim())
    return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
  const { rows } = await pool.query(
    `INSERT INTO waiting_list (doctor_id, nombre, telefono, fecha_preferida, origen)
     VALUES ($1, $2, $3, $4, 'manual')
     ON CONFLICT (doctor_id, telefono)
     DO UPDATE SET fecha_preferida = EXCLUDED.fecha_preferida, created_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [req.user.id, nombre.trim(), telefono.trim(), fecha_preferida || null]
  );
  res.json(rows[0]);
}));

app.post('/api/waiting-list/offer', auth, h(async (req, res) => {
  const { waiting_list_id, fecha, hora, nombre: bodyNombre, telefono: bodyTelefono } = req.body;
  if (!fecha || !hora)
    return res.status(400).json({ error: 'Faltan campos: fecha, hora' });

  // Validación de horario pasado — zona CDMX
  const horaPrefix = String(hora).slice(0, 5);
  const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const [fY, fM, fD] = fecha.split('-').map(Number);
  const [hH, hMin] = horaPrefix.split(':').map(Number);
  const slotDt = new Date(fY, fM - 1, fD, hH, hMin, 0);
  if (slotDt <= nowMx) {
    return res.status(400).json({ error: 'No puedes ofrecer un horario que ya pasó.' });
  }

  try {
    let nombre, telefono, bot_slug;

    if (waiting_list_id) {
      // Flujo original — paciente en lista de espera
      const r = await pool.query(
        `SELECT w.nombre, w.telefono, d.bot_slug
         FROM waiting_list w
         JOIN doctors d ON w.doctor_id = d.id
         WHERE w.id=$1 AND w.doctor_id=$2`,
        [waiting_list_id, req.user.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'Paciente no encontrado en tu lista' });
      ({ nombre, telefono, bot_slug } = r.rows[0]);
    } else {
      // Flujo re-oferta — desde cita rechazada (sin waiting_list_id)
      if (!bodyNombre || !bodyTelefono)
        return res.status(400).json({ error: 'Faltan campos: nombre, telefono o waiting_list_id' });
      const drRes = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
      if (!drRes.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
      nombre   = bodyNombre;
      telefono = bodyTelefono;
      bot_slug = drRes.rows[0].bot_slug;
    }

    const [slotAppt, slotBlqHora, slotBlqDia] = await Promise.all([
      pool.query(
        "SELECT 1 FROM appointments WHERE doctor_id=$1 AND fecha=$2 AND hora::text LIKE $3 AND status!='cancelada' LIMIT 1",
        [req.user.id, fecha, horaPrefix + '%']
      ),
      pool.query(
        'SELECT 1 FROM blocked_slots WHERE doctor_id=$1 AND fecha=$2 AND hora IS NOT NULL AND hora::text LIKE $3 LIMIT 1',
        [req.user.id, fecha, horaPrefix + '%']
      ),
      pool.query(
        'SELECT 1 FROM blocked_slots WHERE doctor_id=$1 AND fecha=$2 AND hora IS NULL LIMIT 1',
        [req.user.id, fecha]
      )
    ]);

    if (slotAppt.rows.length || slotBlqHora.rows.length || slotBlqDia.rows.length)
      return res.status(400).json({ error: 'El horario seleccionado ya no está disponible o se encuentra bloqueado.' });

    const fechaFmt = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    const horaFmt = horaPrefix;
    const text = `¡Hola, ${nombre}! ✨ Se acaba de liberar un espacio con el doctor para el *${fechaFmt}* a las *${horaFmt} hrs*. ¿Te interesa agendarlo? Responde *SÍ* para asegurarlo de inmediato. 🏥`;

    const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
    const apiKey  = process.env.INTERNAL_API_KEY || '';
    const resp = await fetch(`${baseUrl}/api/messages/send-offer`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      body:    JSON.stringify({ botSlug: bot_slug, phone: telefono, text, fecha, hora: horaFmt, nombre, telefono, doctor_id: req.user.id })
    });
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`Bot Factory: ${raw.substring(0, 200)}`);

    if (waiting_list_id) {
      await pool.query('DELETE FROM waiting_list WHERE id=$1', [waiting_list_id]);
    }
    console.log(`[offer] ✅ Espacio ofrecido a ${nombre} (${telefono}) → ${fecha} ${horaFmt}`);
    res.json({ ok: true });

  } catch (err) {
    console.error('[OFFER CRASH]', err);
    res.status(500).json({ error: err.message });
  }
}));

app.delete('/api/waiting-list/:id', auth, h(async (req, res) => {
  await pool.query(
    'DELETE FROM waiting_list WHERE id=$1 AND doctor_id=$2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
}));

// ── Módulo de Rendimiento ─────────────────────────────────────────────────────
app.get('/api/reports/performance', auth, h(async (req, res) => {
  const { desde, hasta } = req.query;
  const params = [req.user.id];
  let dateFilter = '';
  if (desde) {
    params.push(desde);
    dateFilter += ` AND sl.created_at >= $${params.length}`;
  }
  if (hasta) {
    params.push(hasta + ' 23:59:59');
    dateFilter += ` AND sl.created_at <= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT
       sl.secretary_name,
       COUNT(*) FILTER (WHERE sl.action = 'confirmar')    AS confirmadas,
       COUNT(*) FILTER (WHERE sl.action = 'cancelar')     AS canceladas,
       COUNT(*) FILTER (WHERE sl.action = 'crear_manual') AS creadas_manual,
       COUNT(*) FILTER (WHERE sl.action = 'atendida')     AS atendidas,
       COUNT(*) FILTER (WHERE sl.action = 'ausente')      AS ausentes
     FROM secretary_logs sl
     JOIN appointments a ON sl.appointment_id = a.id
     WHERE a.doctor_id = $1${dateFilter}
     GROUP BY sl.secretary_name
     ORDER BY sl.secretary_name`,
    params
  );
  res.json(rows.map(r => ({
    secretary_name:  r.secretary_name,
    confirmadas:     parseInt(r.confirmadas)    || 0,
    canceladas:      parseInt(r.canceladas)     || 0,
    creadas_manual:  parseInt(r.creadas_manual) || 0,
    atendidas:       parseInt(r.atendidas)      || 0,
    ausentes:        parseInt(r.ausentes)       || 0,
  })));
}));

// ── Facturación Stripe ────────────────────────────────────────────────────────
app.post('/api/billing/checkout', authBilling, h(async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe no configurado en este entorno' });

  const priceId = (process.env.STRIPE_PRICE_ID || '').trim();
  if (!priceId) return res.status(500).json({ error: 'STRIPE_PRICE_ID no configurado' });

  const doctorId = req.user.id;
  const dr = await pool.query('SELECT name, email, stripe_customer_id FROM doctors WHERE id=$1', [doctorId]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });

  const doctor = dr.rows[0];

  if (!doctor.email || !doctor.email.includes('@')) {
    console.error(`[STRIPE CHECKOUT ERROR] Doctor ${doctorId} sin email válido: "${doctor.email}"`);
    return res.status(400).json({ error: 'El doctor no tiene un email válido registrado.' });
  }

  try {
    let customerId = doctor.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: doctor.email.trim(),
        name:  (doctor.name || '').trim(),
        metadata: { doctorId: String(doctorId) }
      });
      customerId = customer.id;
      await pool.query('UPDATE doctors SET stripe_customer_id=$1 WHERE id=$2', [customerId, doctorId]);
    }

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      metadata:    { doctorId: String(doctorId) },
      success_url: `${frontendUrl}/dashboard?payment=success`,
      cancel_url:  `${frontendUrl}/dashboard?payment=cancelled`,
    });

    console.log(`[STRIPE CHECKOUT] Sesión creada para doctor ${doctorId} → ${session.url}`);
    res.json({ url: session.url });

  } catch (err) {
    console.error('[STRIPE CHECKOUT CRASH]', err.message);
    res.status(400).json({ error: err.message });
  }
}));

// ── Estado de suscripción del doctor autenticado ─────────────────────────────
app.get('/api/billing/status', authBilling, h(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT subscription_status, subscription_ends_at, grace_period_until FROM doctors WHERE id=$1',
    [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
  res.json({
    subscription_status:  rows[0].subscription_status  || 'active',
    subscription_ends_at: rows[0].subscription_ends_at || null,
    grace_period_until:   rows[0].grace_period_until   || null,
  });
}));

// ── Panel de control de facturación — solo admin ──────────────────────────────
app.get('/api/admin/billing-control', auth, h(async (req, res) => {
  const me = await pool.query('SELECT role FROM doctors WHERE id=$1', [req.user.id]);
  if (!me.rows.length || me.rows[0].role !== 'admin')
    return res.status(403).json({ error: 'Acceso denegado' });

  const { rows } = await pool.query(
    `SELECT id, name, email, subscription_status, subscription_ends_at
     FROM doctors
     ORDER BY subscription_ends_at DESC NULLS LAST`
  );
  res.json(rows);
}));

// ── Panel de Administración Maestro — suscripciones en tiempo real ────────────
app.get('/api/admin/subscriptions', auth, h(async (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Acceso denegado' });

  const { rows } = await pool.query(`
    SELECT
      id, name, email, bot_slug,
      subscription_status, grace_period_until,
      created_at
    FROM doctors
    ORDER BY
      CASE subscription_status
        WHEN 'blocked'  THEN 0
        WHEN 'past_due' THEN 1
        ELSE 2
      END,
      name
  `);
  res.json(rows);
}));

// ── Recordatorios ─────────────────────────────────────────────────────────────
async function runReminders() {
  console.log('[CRON Recordatorios] Iniciando revisión...');
  const { rows: appts } = await pool.query(`
    SELECT a.id, a.nombre, a.telefono, a.hora, d.bot_slug
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    WHERE a.status        = 'confirmada'
      AND a.reminder_sent = FALSE
      AND a.fecha         = CURRENT_DATE + INTERVAL '1 day'
  `);

  if (!appts.length) {
    console.log('[CRON Recordatorios] Sin citas confirmadas para mañana.');
    return { enviados: 0, total: 0 };
  }

  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY || '';

  const RECORDATORIO_TEXTOS = [
    (n, h) => `Hola ${n}, te escribo para recordarte que mañana tienes una cita a las ${h}. Por favor confirma tu asistencia.`,
    (n, h) => `Buen día ${n}. Pasamos a confirmar tu cita de mañana a las ${h}. Si no puedes asistir, avísanos con tiempo.`,
    (n, h) => `Hola ${n}, solo un recordatorio: tienes cita registrada para mañana a las ${h}. Te esperamos puntual.`,
    (n, h) => `${n}, te recordamos tu consulta programada para mañana a las ${h}. Cualquier duda nos escribes por aquí.`,
    (n, h) => `Hola, confirmando tu cita de mañana a las ${h}, ${n}. Si necesitas cancelar o reagendar, con gusto te ayudamos.`,
  ];

  // Distribuir los envíos de forma escalonada a lo largo de 60 minutos.
  // El delay de escalonamiento se pasa a bot-factory como 'delayMs', que lo persiste
  // en Redis vía BullMQ — sobrevive reinicios y deploys en ambos servicios.
  const total     = appts.length;
  const staggerMs = total > 1 ? Math.floor(3600000 / total) : 0;
  let programados = 0;

  const enqueue = async (appt, fireAt) => {
    try {
      const horaFmt    = String(appt.hora).substring(0, 5);
      const plantilla  = RECORDATORIO_TEXTOS[Math.floor(Math.random() * RECORDATORIO_TEXTOS.length)];
      const textoFinal = plantilla(appt.nombre, horaFmt);

      const resp = await fetch(`${baseUrl}/api/messages/send-notification`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        body:    JSON.stringify({ botSlug: appt.bot_slug, phone: appt.telefono, text: textoFinal, delayMs: fireAt })
      });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`Status ${resp.status}: ${raw.substring(0, 120)}`);

      // Marcar como enviado una vez que BullMQ confirmó la encola — Redis garantiza la entrega.
      await pool.query('UPDATE appointments SET reminder_sent=TRUE WHERE id=$1', [appt.id]);
      console.log(`[CRON Recordatorios] encolado id=${appt.id} → ${appt.nombre} (delay ${Math.round(fireAt/60000)}min en BullMQ)`);
    } catch (err) {
      console.error(`[CRON Recordatorios] error id=${appt.id} (${appt.nombre}):`, err.message);
    }
  };

  const promesas = [];
  for (let i = 0; i < total; i++) {
    const appt = appts[i];
    if (!appt.telefono || appt.telefono.trim() === '') {
      console.warn(`[CRON Recordatorios] Skipping id=${appt.id} — teléfono vacío`);
      continue;
    }
    programados++;
    promesas.push(enqueue(appt, i * staggerMs));
  }

  await Promise.allSettled(promesas);

  console.log(`[CRON Recordatorios] ${programados} recordatorios encolados en BullMQ — escalonados a lo largo de 60 min.`);
  return { programados, total };
}

app.post('/api/admin/run-reminders', auth, h(async (req, res) => {
  const result = await runReminders();
  res.json({ ok: true, ...result });
}));

// ── Cierre automático de citas pasadas ────────────────────────────────────────
// La fecha se calcula en Node con zona horaria CDMX — Postgres en Render corre en UTC
// y no puede usarse CURRENT_DATE directo. El operador es < (estrictamente menor) para
// que las citas del día en curso no se toquen hasta la medianoche real de CDMX.
function todayCDMX() {
  // 'en-CA' produce 'YYYY-MM-DD', independiente del TZ del servidor
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

async function runGracePeriodCheck() {
  console.log('[CRON GracePeriod] Verificando periodos de gracia expirados...');
  const { rowCount } = await pool.query(
    `UPDATE doctors
     SET subscription_status = 'blocked', grace_period_until = NULL
     WHERE subscription_status = 'past_due'
       AND grace_period_until IS NOT NULL
       AND grace_period_until < NOW()`
  );
  console.log(`[CRON GracePeriod] ${rowCount} doctor(es) bloqueados por periodo de gracia expirado.`);
  return { bloqueados: rowCount };
}

async function runAttendanceCleanup() {
  const hoy = todayCDMX();
  const { rowCount } = await pool.query(
    `UPDATE appointments
     SET status = 'atendida'
     WHERE status IN ('pendiente', 'confirmada')
       AND fecha::date < $1::date`,
    [hoy]
  );
  console.log(`[CRON Asistencia] ${rowCount} cita(s) marcadas como 'atendida' (hoy CDMX=${hoy})`);
  return { updated: rowCount, fechaReferencia: hoy };
}

app.post('/api/admin/run-attendance-cleanup', auth, h(async (req, res) => {
  const result = await runAttendanceCleanup();
  res.json({ ok: true, ...result });
}));

// ── Recuperación de emergencia: revierte citas de una fecha de 'atendida' a 'confirmada' ──
app.post('/api/admin/recover-today-appointments', auth, h(async (req, res) => {
  const fecha = req.body?.fecha || todayCDMX();
  const { rowCount, rows } = await pool.query(
    `UPDATE appointments
     SET status = 'confirmada'
     WHERE status = 'atendida'
       AND fecha::date = $1::date
     RETURNING id, nombre, telefono, fecha, hora`,
    [fecha]
  );
  console.log(`[RECOVER] ${rowCount} cita(s) revertidas a 'confirmada' para fecha=${fecha}`);
  res.json({ ok: true, revertidas: rowCount, fecha, citas: rows });
}));

// ── Configuración de horario del doctor — por día de la semana ───────────────
app.get('/api/doctor/config', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  let slotDuration = 30;
  let instructions = '';
  // horarioSemanal: { lunes: { inicio, fin, activo }, ... }
  const horarioSemanal = {};

  if (dr.rows.length) {
    const botSlug = dr.rows[0].bot_slug;
    try {
      const { rows } = await pool.query("SELECT config FROM bots WHERE status='deployed'");
      for (const row of rows) {
        const c = JSON.parse(row.config);
        if (c.panelSlug === botSlug) {
          slotDuration = c.schedule?.slotDuration || 30;
          instructions = c.instructions || '';
          // Mapear formato bot (active/start/end) → formato panel (activo/inicio/fin)
          for (const [dia, cfg] of Object.entries(c.schedule?.days || {})) {
            horarioSemanal[dia] = {
              inicio: cfg.start  || '09:00',
              fin:    cfg.end    || '18:00',
              activo: !!cfg.active,
            };
          }
          // Persistir cache en la columna del doctor para consultas futuras offline
          await pool.query(
            'UPDATE doctors SET horario_semanal=$1 WHERE id=$2',
            [JSON.stringify(horarioSemanal), req.user.id]
          ).catch(() => {});
          break;
        }
      }
    } catch {}
  }

  res.json({ slotDuration, horarioSemanal, instructions });
}));

// ── Actualizar horario del doctor → bot-factory ────────────────────────────
app.put('/api/doctor/config/schedule', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  const botSlug = dr.rows[0].bot_slug;
  if (!botSlug) return res.status(400).json({ error: 'Doctor sin bot asignado' });

  const { days, slotDuration } = req.body;
  // Convertir formato panel { activo, inicio, fin } → formato bot { active, start, end }
  const botDays = {};
  for (const [dia, cfg] of Object.entries(days || {})) {
    botDays[dia] = { active: !!cfg.activo, start: cfg.inicio || '09:00', end: cfg.fin || '18:00' };
  }

  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY;
  const resp = await fetch(`${baseUrl}/api/bots/${botSlug}/config`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
    body:    JSON.stringify({ schedule: { days: botDays, slotDuration: Number(slotDuration) || 30 } }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return res.status(resp.status).json({ error: err.error || 'Error en bot-factory' });
  }
  res.json({ ok: true });
}));

// ── Actualizar instrucciones del bot → bot-factory ─────────────────────────
app.put('/api/doctor/config/instructions', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  const botSlug = dr.rows[0].bot_slug;
  if (!botSlug) return res.status(400).json({ error: 'Doctor sin bot asignado' });

  const { instructions } = req.body;

  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY;
  const resp = await fetch(`${baseUrl}/api/bots/${botSlug}/config`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
    body:    JSON.stringify({ instructions: instructions || '' }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return res.status(resp.status).json({ error: err.error || 'Error en bot-factory' });
  }
  res.json({ ok: true });
}));

// ── Alertas operativas — citas de hoy sin cerrar cuya hora ya pasó ───────────
app.get('/api/admin/pending-cleanup', auth, h(async (req, res) => {
  const hoy = todayCDMX();
  const nowMx = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const horaActual = `${String(nowMx.getHours()).padStart(2,'0')}:${String(nowMx.getMinutes()).padStart(2,'0')}`;
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, motivo, hora, status
     FROM appointments
     WHERE fecha::date = $1
       AND hora < $2
       AND status IN ('pendiente', 'confirmada')
     ORDER BY hora ASC`,
    [hoy, horaActual]
  );
  res.json(rows);
}));

// ── Estado del bot — puente hacia bot-factory ────────────────────────────────
app.get('/api/bot-status', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  const botSlug = dr.rows[0].bot_slug;
  if (!botSlug) return res.status(404).json({ error: 'Este doctor no tiene un bot asignado' });
  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY || '';
  const resp = await fetch(`${baseUrl}/api/bots/${botSlug}/status`, {
    headers: { 'x-internal-key': apiKey }
  });
  if (!resp.ok) {
    console.error(`[bot-status] bot-factory devolvió ${resp.status} para slug=${botSlug}`);
    return res.status(resp.status).json({ error: 'Error al consultar bot-factory' });
  }
  res.json(await resp.json());
}));

// ── Forzar reconexión del bot — limpia sesión y genera nuevo QR ──────────────
app.post('/api/bot-reconnect', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  const botSlug = dr.rows[0].bot_slug;
  if (!botSlug) return res.status(404).json({ error: 'Este doctor no tiene un bot asignado' });
  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY || '';
  const resp = await fetch(`${baseUrl}/api/bots/${botSlug}/force-reconnect`, {
    method: 'POST',
    headers: { 'x-internal-key': apiKey }
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    console.error(`[bot-reconnect] bot-factory devolvió ${resp.status}:`, errBody);
    return res.status(resp.status).json({ error: errBody.error || 'Error al reconectar bot' });
  }
  res.json({ ok: true });
}));

// ── Manejo global de errores ──────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Serve React build ─────────────────────────────────────────────────────────
// Frontend desacoplado — React se sirve desde Vercel/Netlify, no desde Express.
// Mantener comentado para referencia histórica:
// app.use(express.static(path.join(__dirname, 'client/dist')));
// app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));

const PORT = process.env.PORT || 4000;
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`\n🏥 Panel Secretarias en http://localhost:${PORT}\n`));

    cron.schedule('0 9 * * *', () => {
      runReminders().catch(err =>
        console.error('[CRON Recordatorios] Error crítico en la tarea:', err.message)
      );
    }, { timezone: 'America/Mexico_City' });
    console.log('[CRON Recordatorios] Tarea programada — 09:00 AM CDMX cada día.');

    cron.schedule('59 23 * * *', () => {
      runAttendanceCleanup().catch(err =>
        console.error('[CRON Asistencia] Error crítico:', err.message)
      );
    }, { timezone: 'America/Mexico_City' });
    console.log('[CRON Asistencia] Tarea programada — 23:59 CDMX cada día.');

    cron.schedule('0 0 * * *', () => {
      runGracePeriodCheck().catch(err =>
        console.error('[CRON GracePeriod] Error crítico:', err.message)
      );
    }, { timezone: 'America/Mexico_City' });
    console.log('[CRON GracePeriod] Tarea programada — 00:00 CDMX cada día.');
  })
  .catch(e => { console.error('DB init error:', e.message); process.exit(1); });
