import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API_BASE from '../utils/apiBase';

const DAYS_ORDER = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const DAYS_LABEL = {
  lunes:'Lunes', martes:'Martes', miercoles:'Miércoles',
  jueves:'Jueves', viernes:'Viernes', sabado:'Sábado', domingo:'Domingo',
};
const DEFAULT_DAY = { activo: false, inicio: '09:00', fin: '18:00' };
const SLOT_OPTIONS = [15, 20, 30, 45, 60];

function Alert({ type, msg }) {
  if (!msg) return null;
  const styles = {
    success: { background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d' },
    error:   { background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626' },
  };
  return (
    <div style={{ ...styles[type], padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
      {type === 'success' ? '✅ ' : '⚠️ '}{msg}
    </div>
  );
}

function TabBtn({ id, active, onClick, children }) {
  return (
    <button onClick={() => onClick(id)}
      className="px-5 py-2.5 text-sm font-semibold border-0 cursor-pointer transition-colors rounded-t-lg"
      style={active
        ? { background: '#f3f4f6', color: '#1a1a2e' }
        : { background: 'transparent', color: 'rgba(255,255,255,.6)' }}>
      {children}
    </button>
  );
}

// ── Tab Seguridad ─────────────────────────────────────────────────────────────

function TabSeguridad({ token }) {
  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [status,   setStatus]   = useState({ type: '', msg: '' });

  const fi = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1.5px solid #e5e7eb', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ type: '', msg: '' });
    if (next !== confirm) { setStatus({ type: 'error', msg: 'Las contraseñas nuevas no coinciden.' }); return; }
    if (next.length < 6)  { setStatus({ type: 'error', msg: 'La nueva contraseña debe tener al menos 6 caracteres.' }); return; }
    setSaving(true);
    try {
      const r = await fetch(API_BASE + '/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const d = await r.json();
      if (!r.ok) { setStatus({ type: 'error', msg: d.error || 'Error al cambiar contraseña' }); return; }
      setStatus({ type: 'success', msg: 'Contraseña actualizada correctamente.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch {
      setStatus({ type: 'error', msg: 'Error de conexión.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md">
      <h2 className="text-base font-bold text-gray-800 mb-1">Cambiar contraseña</h2>
      <p className="text-sm text-gray-500 mb-5">Actualiza tu contraseña de acceso al panel.</p>
      <Alert type={status.type} msg={status.msg} />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { label: 'Contraseña actual',          val: current,  set: setCurrent,  ph: 'Tu contraseña actual' },
          { label: 'Nueva contraseña',           val: next,     set: setNext,     ph: 'Mínimo 6 caracteres' },
          { label: 'Confirmar nueva contraseña', val: confirm,  set: setConfirm,  ph: 'Repite la nueva contraseña' },
        ].map(({ label, val, set, ph }) => (
          <div key={label}>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#374151' }}>
              {label}
            </label>
            <input required type="password" value={val} onChange={e => set(e.target.value)}
              placeholder={ph} style={fi} />
          </div>
        ))}
        <button type="submit" disabled={saving}
          className="py-3 rounded-xl font-bold text-sm cursor-pointer border-0 disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#fff',
            boxShadow: '0 4px 14px rgba(26,26,46,.25)', marginTop: 4 }}>
          {saving ? 'Guardando...' : '🔒 Actualizar contraseña'}
        </button>
      </form>
    </div>
  );
}

// ── Tab Horarios ──────────────────────────────────────────────────────────────

function TabHorarios({ token }) {
  const [days,        setDays]        = useState(() =>
    Object.fromEntries(DAYS_ORDER.map(d => [d, { ...DEFAULT_DAY }]))
  );
  const [slotDuration, setSlotDuration] = useState(30);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [status,       setStatus]       = useState({ type: '', msg: '' });

  useEffect(() => {
    fetch(API_BASE + '/api/doctor/config', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        setSlotDuration(d.slotDuration || 30);
        setDays(prev => {
          const merged = { ...prev };
          for (const dia of DAYS_ORDER) {
            merged[dia] = d.horarioSemanal?.[dia]
              ? { activo: !!d.horarioSemanal[dia].activo, inicio: d.horarioSemanal[dia].inicio || '09:00', fin: d.horarioSemanal[dia].fin || '18:00' }
              : { ...DEFAULT_DAY };
          }
          return merged;
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const toggleDay   = (dia) => setDays(prev => ({ ...prev, [dia]: { ...prev[dia], activo: !prev[dia].activo } }));
  const updateField = (dia, field, val) => setDays(prev => ({ ...prev, [dia]: { ...prev[dia], [field]: val } }));

  const save = async () => {
    setSaving(true);
    setStatus({ type: '', msg: '' });
    try {
      const r = await fetch(API_BASE + '/api/doctor/config/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days, slotDuration }),
      });
      const d = await r.json();
      if (!r.ok) { setStatus({ type: 'error', msg: d.error || 'Error al guardar horario' }); return; }
      setStatus({ type: 'success', msg: 'Horario actualizado. El bot lo usará de inmediato.' });
    } catch {
      setStatus({ type: 'error', msg: 'Error de conexión.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="py-12 text-center text-gray-400">
      <div className="text-3xl mb-2">⏳</div><p className="text-sm">Cargando horario...</p>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-bold text-gray-800">Horarios de atención</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">Define los días y horas en que el bot puede agendar citas.</p>

      <Alert type={status.type} msg={status.msg} />

      {/* Duración de slots */}
      <div className="mb-5">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
          Duración de cada cita
        </label>
        <div className="flex gap-2 flex-wrap">
          {SLOT_OPTIONS.map(min => (
            <button key={min} onClick={() => setSlotDuration(min)}
              className="px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer border-0 transition-all"
              style={slotDuration === min
                ? { background: '#4f46e5', color: '#fff', boxShadow: '0 2px 8px rgba(79,70,229,.3)' }
                : { background: '#f3f4f6', color: '#6b7280' }}>
              {min} min
            </button>
          ))}
        </div>
      </div>

      {/* Días */}
      <div className="space-y-2">
        {DAYS_ORDER.map(dia => {
          const cfg = days[dia];
          return (
            <div key={dia}
              className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl transition-colors"
              style={{ background: cfg.activo ? '#f0fdf4' : '#f9fafb', border: `1.5px solid ${cfg.activo ? '#86efac' : '#e5e7eb'}` }}>
              {/* Checkbox + nombre */}
              <label className="flex items-center gap-2 cursor-pointer min-w-[110px]">
                <input type="checkbox" checked={cfg.activo} onChange={() => toggleDay(dia)}
                  style={{ width: 16, height: 16, accentColor: '#4f46e5', cursor: 'pointer' }} />
                <span className="text-sm font-semibold text-gray-700">{DAYS_LABEL[dia]}</span>
              </label>
              {/* Horas */}
              {cfg.activo ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 font-medium">Inicio</span>
                    <input type="time" value={cfg.inicio} onChange={e => updateField(dia, 'inicio', e.target.value)}
                      className="px-2 py-1 rounded-lg text-sm border border-gray-200 focus:border-indigo-400 focus:outline-none"
                      style={{ background: '#fff' }} />
                  </div>
                  <span className="text-gray-300 text-sm">→</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 font-medium">Fin</span>
                    <input type="time" value={cfg.fin} onChange={e => updateField(dia, 'fin', e.target.value)}
                      className="px-2 py-1 rounded-lg text-sm border border-gray-200 focus:border-indigo-400 focus:outline-none"
                      style={{ background: '#fff' }} />
                  </div>
                </div>
              ) : (
                <span className="text-xs text-gray-400 italic">Día no laborable</span>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={save} disabled={saving}
        className="mt-5 px-6 py-3 rounded-xl font-bold text-sm cursor-pointer border-0 disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)', color: '#fff',
          boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}>
        {saving ? 'Guardando...' : '💾 Guardar horario'}
      </button>
    </div>
  );
}

// ── Tab Bot ───────────────────────────────────────────────────────────────────

function TabBot({ token }) {
  const [instructions, setInstructions] = useState('');
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [status,       setStatus]       = useState({ type: '', msg: '' });

  useEffect(() => {
    fetch(API_BASE + '/api/doctor/config', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setInstructions(d.instructions || ''))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true);
    setStatus({ type: '', msg: '' });
    try {
      const r = await fetch(API_BASE + '/api/doctor/config/instructions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instructions }),
      });
      const d = await r.json();
      if (!r.ok) { setStatus({ type: 'error', msg: d.error || 'Error al guardar instrucciones' }); return; }
      setStatus({ type: 'success', msg: 'Instrucciones actualizadas. El bot las usará en la próxima conversación.' });
    } catch {
      setStatus({ type: 'error', msg: 'Error de conexión.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="py-12 text-center text-gray-400">
      <div className="text-3xl mb-2">⏳</div><p className="text-sm">Cargando instrucciones...</p>
    </div>
  );

  return (
    <div>
      <h2 className="text-base font-bold text-gray-800 mb-1">Instrucciones del Bot</h2>
      <p className="text-sm text-gray-500 mb-5">
        Personaliza cómo responde el asistente de WhatsApp. Estas instrucciones se agregan al prompt del sistema de la IA.
      </p>

      <Alert type={status.type} msg={status.msg} />

      <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-2">
        Instrucciones adicionales para la IA
      </label>
      <textarea
        value={instructions}
        onChange={e => setInstructions(e.target.value)}
        placeholder={`Ejemplo:\n- Habla siempre de forma cordial y formal.\n- Si el paciente pregunta el precio de consulta, diles que es $500 MXN.\n- No agendes citas los días feriados.\n- Si el paciente menciona urgencia, dales el número directo: 555-1234.`}
        rows={12}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: '1.5px solid #e5e7eb', fontSize: 14, lineHeight: 1.6,
          outline: 'none', resize: 'vertical', boxSizing: 'border-box',
          fontFamily: 'inherit', color: '#374151',
        }}
        onFocus={e => { e.target.style.borderColor = '#6366f1'; }}
        onBlur={e  => { e.target.style.borderColor = '#e5e7eb'; }}
      />
      <p className="text-xs text-gray-400 mt-2 mb-4">
        {instructions.length} caracteres · Vacío = el bot usa solo su comportamiento base.
      </p>

      <button onClick={save} disabled={saving}
        className="px-6 py-3 rounded-xl font-bold text-sm cursor-pointer border-0 disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)', color: '#fff',
          boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}>
        {saving ? 'Guardando...' : '💾 Guardar instrucciones'}
      </button>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'seguridad', label: '🔒 Seguridad' },
  { id: 'horarios',  label: '🗓 Horarios'  },
  { id: 'bot',       label: '🤖 Bot'       },
];

export default function Settings() {
  const nav   = useNavigate();
  const token = localStorage.getItem('panel_token');
  const name  = localStorage.getItem('panel_name') || 'Doctor';
  const [tab, setTab] = useState('seguridad');

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="px-4 sm:px-6 h-16 flex items-center justify-between shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/')}
            className="text-gray-400 hover:text-white transition-colors text-sm font-semibold border-0 cursor-pointer bg-transparent flex items-center gap-1">
            ← Volver
          </button>
          <div className="w-px h-5 bg-white/20" />
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
            style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)' }}>⚙️</div>
          <div>
            <div className="text-white font-bold text-sm">Configuración</div>
            <div className="text-gray-400 text-xs">Dr. {name}</div>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="px-4 sm:px-6 flex gap-1"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
        {TABS.map(t => (
          <TabBtn key={t.id} id={t.id} active={tab === t.id} onClick={setTab}>
            {t.label}
          </TabBtn>
        ))}
      </div>

      {/* Contenido */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm p-6">
          {tab === 'seguridad' && <TabSeguridad token={token} />}
          {tab === 'horarios'  && <TabHorarios  token={token} />}
          {tab === 'bot'       && <TabBot        token={token} />}
        </div>
      </div>
    </div>
  );
}
