process.env.TZ = 'America/Mexico_City';
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cron = require('node-cron');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'panel-jwt-secret-change-me';
const FACTORY_SECRET = process.env.FACTORY_SECRET || 'factory-secret-change-me';

// Wrapper — evita que un error async apague el servidor
const h = fn => (req, res, next) => fn(req, res, next).catch(next);

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

  // Separados para que un fallo en uno no enmascare al otro
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

  // Migraciones incrementales — seguras de re-ejecutar
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

  console.log('[db] Schema panel-secretarias OK');

  // Seed: admin de arranque solo si la tabla doctors está completamente vacía
  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM doctors');
  if (parseInt(rows[0].total) === 0) {
    const hash = await bcrypt.hash('1234', 10);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO doctors (name, email, password_hash, bot_slug, panel_token, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['Admin', 'admin@bot.com', hash, 'admin-seed', token, 'admin']
    );
    console.log('[db] Seed ejecutado → admin@bot.com / 1234');
  } else {
    console.log(`[db] Seed omitido — ya existen ${rows[0].total} doctor(es)`);
  }
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión expirada' });
  }
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
  const token = jwt.sign({ id: doc.id, name: doc.name, email: doc.email }, JWT_SECRET, { expiresIn: '14d' });
  res.json({ token, name: doc.name, email: doc.email });
}));

// ── Webhook: bot envía cita nueva ─────────────────────────────────────────────
app.post('/api/webhook', h(async (req, res) => {
  const secret = process.env.INTERNAL_WEBHOOK_TOKEN;
  if (secret && req.headers['x-webhook-token'] !== secret)
    return res.status(401).json({ error: 'Token de webhook inválido' });
  const { token, nombre, telefono, fecha, hora, motivo } = req.body;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const r = await pool.query('SELECT id FROM doctors WHERE panel_token=$1', [token]);
  if (!r.rows.length) return res.status(401).json({ error: 'Token inválido' });
  await pool.query(
    'INSERT INTO appointments (doctor_id,nombre,telefono,fecha,hora,motivo,source) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.rows[0].id, nombre, telefono || '', fecha, hora, motivo || '', 'whatsapp']
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
  res.json({ slots, hasActiveAppointments: activeRows.length > 0 });
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

app.post('/api/appointments', auth, h(async (req, res) => {
  const { nombre, telefono, fecha, hora, motivo } = req.body;
  const r = await pool.query(
    'INSERT INTO appointments (doctor_id,nombre,telefono,fecha,hora,motivo,source) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.user.id, nombre, telefono || '', fecha, hora, motivo || '', 'manual']
  );
  res.json(r.rows[0]);
}));

app.put('/api/appointments/:id', auth, h(async (req, res) => {
  const { nombre, telefono, fecha, hora, motivo, status } = req.body;
  const r = await pool.query(
    'UPDATE appointments SET nombre=$1,telefono=$2,fecha=$3,hora=$4,motivo=$5,status=$6 WHERE id=$7 AND doctor_id=$8 RETURNING *',
    [nombre, telefono || '', fecha, hora, motivo || '', status, req.params.id, req.user.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });
  res.json(r.rows[0]);
}));

app.patch('/api/appointments/:id/status', auth, h(async (req, res) => {
  const nuevoEstado = (req.body.status || '').toLowerCase().trim();
  const citaId = req.params.id;

  const prev = await pool.query(
    'SELECT status FROM appointments WHERE id=$1 AND doctor_id=$2',
    [citaId, req.user.id]
  );
  const estadoAnterior = (prev.rows[0]?.status || '').toLowerCase().trim();

  console.log(`[CAMBIO ESTADO] Cita ID: ${citaId} | Estado Anterior: ${estadoAnterior} -> Nuevo Estado: ${nuevoEstado}`);

  const r = await pool.query(
    'UPDATE appointments SET status=$1 WHERE id=$2 AND doctor_id=$3 RETURNING nombre, telefono, fecha, hora',
    [nuevoEstado, citaId, req.user.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'No encontrada' });

  const { nombre, telefono, fecha, hora } = r.rows[0];

  const esConfirmacion = nuevoEstado === 'confirmada';
  const esCancelacionDesdeConfirmada = estadoAnterior === 'confirmada' && nuevoEstado === 'cancelada';

  if (esConfirmacion || esCancelacionDesdeConfirmada) {
    if (!telefono || telefono.trim() === '') {
      console.warn('[notify] Abortado — teléfono vacío en la cita');
    } else {
      try {
        const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
        if (!dr.rows.length) {
          console.error('[notify] Abortado — no se encontró bot_slug para doctor_id', req.user.id);
        } else {
          const botSlug = dr.rows[0].bot_slug;

          let fechaCitaStr = 'Fecha no disponible';
          if (fecha) {
            const isoDate = typeof fecha === 'string'
              ? fecha.split('T')[0]
              : fecha.toISOString().substring(0, 10);
            const parsedDate = new Date(`${isoDate}T12:00:00`);
            if (!isNaN(parsedDate)) {
              fechaCitaStr = parsedDate.toLocaleDateString('es-MX', {
                weekday: 'long', day: 'numeric', month: 'long'
              });
            }
          }
          const horaFmt = String(hora).substring(0, 5);

          const text = esConfirmacion
            ? `¡Hola, ${nombre}! 🎉 Tu cita ha sido *CONFIRMADA* para el *${fechaCitaStr}* a las *${horaFmt} hrs*. ¡Te esperamos! 🏥`
            : `✅ Tu cita ha sido cancelada exitosamente.\n\nSi deseas volver a agendar, escribe 'hola' en cualquier momento. ¡Que te mejores! 🙏`;

          const baseUrl  = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
          const finalUrl = `${baseUrl}/api/messages/send-notification`;
          const apiKey   = process.env.INTERNAL_API_KEY || '';
          console.log(`[notify] POST → ${finalUrl} | botSlug=${botSlug} | telefono=${telefono}`);

          const resp = await fetch(finalUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
            body:    JSON.stringify({ botSlug, phone: telefono, text })
          });
          const raw = await resp.text();
          if (!resp.ok) {
            console.error(`[notify] ❌ Bot respondió ${resp.status}: ${raw.substring(0, 120)}`);
          } else {
            console.log(`[notify] ✅ Enviado: ${nuevoEstado} → ${nombre} (${telefono})`);
          }
        }
      } catch (err) {
        console.error('[Bridge Error]', err.message, err.stack);
      }
    }
  }

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
    // A: citas por origen en los últimos 30 días
    pool.query(
      `SELECT source, COUNT(*)::int AS count
       FROM appointments
       WHERE doctor_id = $1
         AND created_at >= (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City') - INTERVAL '30 days'
       GROUP BY source`,
      [did]
    ),
    // B: distribución por estado (histórico completo)
    pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM appointments
       WHERE doctor_id = $1
       GROUP BY status`,
      [did]
    ),
    // C: demanda por día de semana (0 = Dom … 6 = Sáb)
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

// Ofrecer un espacio liberado a un paciente en espera
app.post('/api/waiting-list/offer', auth, h(async (req, res) => {
  const { waiting_list_id, fecha, hora } = req.body;
  if (!waiting_list_id || !fecha || !hora)
    return res.status(400).json({ error: 'Faltan campos: waiting_list_id, fecha, hora' });

  const r = await pool.query(
    `SELECT w.nombre, w.telefono, d.bot_slug
     FROM waiting_list w
     JOIN doctors d ON w.doctor_id = d.id
     WHERE w.id=$1 AND w.doctor_id=$2`,
    [waiting_list_id, req.user.id]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Paciente no encontrado en tu lista' });

  const { nombre, telefono, bot_slug } = r.rows[0];
  const fechaFmt = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const horaFmt = String(hora).substring(0, 5);
  const text = `¡Hola, ${nombre}! ✨ Se acaba de liberar un espacio con el doctor para el *${fechaFmt}* a las *${horaFmt} hrs*. ¿Te interesa agendarlo? Responde *SÍ* para asegurarlo de inmediato. 🏥`;

  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY || '';
  // send-offer: además de enviar el WA, guarda conv_state ESPERANDO_OFERTA en bot-factory
  const resp = await fetch(`${baseUrl}/api/messages/send-offer`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
    body:    JSON.stringify({ botSlug: bot_slug, phone: telefono, text, fecha, hora, nombre, telefono })
  });
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`Bot Factory: ${raw.substring(0, 200)}`);

  await pool.query('DELETE FROM waiting_list WHERE id=$1', [waiting_list_id]);
  console.log(`[offer] ✅ Espacio ofrecido a ${nombre} (${telefono}) → ${fecha} ${horaFmt}`);
  res.json({ ok: true });
}));

app.delete('/api/waiting-list/:id', auth, h(async (req, res) => {
  await pool.query(
    'DELETE FROM waiting_list WHERE id=$1 AND doctor_id=$2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
}));

// ── Lógica de recordatorios (también usada por el cron) ──────────────────────
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
  let enviados  = 0;

  for (const appt of appts) {
    if (!appt.telefono || appt.telefono.trim() === '') {
      console.warn(`[CRON Recordatorios] Skipping id=${appt.id} — teléfono vacío`);
      continue;
    }
    try {
      const horaFmt = String(appt.hora).substring(0, 5);
      const opciones = [
        `¡Hola, ${appt.nombre}! ⏰ Te recordamos que el día de mañana tienes una cita agendada a las *${horaFmt} hrs*. ¡Te esperamos! 🏥`,
        `Hola, ${appt.nombre}. 📅 Solo para confirmarte que mañana es tu cita médica a las *${horaFmt} hrs*. Por favor, intenta llegar 5 minutos antes. 🏥`,
        `¡Buen día, ${appt.nombre}! ✨ Pasamos a recordarte tu cita programada para mañana a las *${horaFmt} hrs*. Si tienes alguna duda, escríbenos por este medio. 👍`,
        `Estimado/a ${appt.nombre}, 📝 Le recordamos que su cita está confirmada para mañana a las *${horaFmt} hrs*. Agradecemos su puntualidad. Clínica Médica 🏥`,
      ];
      const textoFinal = opciones[Math.floor(Math.random() * opciones.length)];

      const resp = await fetch(`${baseUrl}/api/messages/send-notification`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
        body:    JSON.stringify({ botSlug: appt.bot_slug, phone: appt.telefono, text: textoFinal })
      });
      const raw = await resp.text();
      if (!resp.ok) throw new Error(`Status ${resp.status}: ${raw.substring(0, 120)}`);

      await pool.query('UPDATE appointments SET reminder_sent=TRUE WHERE id=$1', [appt.id]);
      enviados++;
      console.log(`[CRON Recordatorios] ✅ id=${appt.id} → ${appt.nombre} (${appt.telefono})`);
    } catch (err) {
      console.error(`[CRON Recordatorios] ❌ id=${appt.id} (${appt.nombre}):`, err.message);
    }

    const tiempoEspera = Math.floor(Math.random() * 3001) + 3000;
    await delay(tiempoEspera);
  }

  console.log(`[CRON Recordatorios] Enviados ${enviados} de ${appts.length} mensajes para el día de mañana.`);
  return { enviados, total: appts.length };
}

// Endpoint de prueba manual — solo admin autenticado
app.post('/api/admin/run-reminders', auth, h(async (req, res) => {
  const result = await runReminders();
  res.json({ ok: true, ...result });
}));

// ── Estado del bot — puente hacia bot-factory ────────────────────────────────
app.get('/api/bot-status', auth, h(async (req, res) => {
  const dr = await pool.query('SELECT bot_slug FROM doctors WHERE id=$1', [req.user.id]);
  if (!dr.rows.length) return res.status(404).json({ error: 'Doctor no encontrado' });
  const botSlug = dr.rows[0].bot_slug;
  const baseUrl = (process.env.BOT_FACTORY_URL || 'https://bot-factory-8amb.onrender.com').replace(/\/$/, '');
  const apiKey  = process.env.INTERNAL_API_KEY || '';
  const resp = await fetch(`${baseUrl}/api/bots/${botSlug}/status`, {
    headers: { 'x-internal-key': apiKey }
  });
  if (!resp.ok) return res.status(resp.status).json({ error: 'Error al consultar bot-factory' });
  res.json(await resp.json());
}));

// ── Manejo global de errores — evita que el servidor se apague ────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Serve React build ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'client/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client/dist/index.html')));

const PORT = process.env.PORT || 4000;
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`\n🏥 Panel Secretarias en http://localhost:${PORT}\n`));

    // ── Recordatorios automáticos — 09:00 AM hora CDMX todos los días ──────────
    cron.schedule('0 9 * * *', () => {
      runReminders().catch(err =>
        console.error('[CRON Recordatorios] Error crítico en la tarea:', err.message)
      );
    }, { timezone: 'America/Mexico_City' });

    console.log('[CRON Recordatorios] Tarea programada — 09:00 AM CDMX cada día.');
  })
  .catch(e => { console.error('DB init error:', e.message); process.exit(1); });
