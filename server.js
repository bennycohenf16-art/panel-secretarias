require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      bot_slug VARCHAR(255) UNIQUE NOT NULL,
      panel_token VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      doctor_id INTEGER REFERENCES doctors(id) ON DELETE CASCADE,
      nombre VARCHAR(255) NOT NULL,
      telefono VARCHAR(50) DEFAULT '',
      fecha DATE NOT NULL,
      hora TIME NOT NULL,
      motivo TEXT DEFAULT '',
      status VARCHAR(50) DEFAULT 'pendiente',
      source VARCHAR(50) DEFAULT 'whatsapp',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
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
  const { status } = req.body;
  await pool.query(
    'UPDATE appointments SET status=$1 WHERE id=$2 AND doctor_id=$3',
    [status, req.params.id, req.user.id]
  );
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
  .then(() => app.listen(PORT, () => console.log(`\n🏥 Panel Secretarias en http://localhost:${PORT}\n`)))
  .catch(e => { console.error('DB init error:', e.message); process.exit(1); });
