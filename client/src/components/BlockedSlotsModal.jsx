import React, { useState, useEffect } from 'react';

const fi = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1.5px solid #ddd', fontSize: 14, outline: 'none', background: '#fff'
};

export default function BlockedSlotsModal({ onClose, onSaved }) {
  const token = localStorage.getItem('panel_token');
  const [form, setForm] = useState({ fecha: '', tipo: 'dia', hora: '', motivo: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState([]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    fetch('/api/blocked-slots', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setExisting(Array.isArray(d) ? d : [])).catch(() => {});
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/blocked-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fecha: form.fecha,
          hora: form.tipo === 'hora' ? form.hora : null,
          motivo: form.motivo || null
        })
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Error al guardar'); setSaving(false); return; }
      setExisting(prev => [...prev, d]);
      setForm({ fecha: '', tipo: 'dia', hora: '', motivo: '' });
      onSaved?.();
    } catch { setError('Error de conexión'); }
    setSaving(false);
  };

  const remove = async (id) => {
    await fetch(`/api/blocked-slots/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
    });
    setExisting(prev => prev.filter(x => x.id !== id));
    onSaved?.();
  };

  const fmtBlq = (b) => {
    const iso = String(b.fecha).slice(0, 10);
    const [y, m, d] = iso.split('-').map(Number);
    const fechaStr = new Date(y, m - 1, d, 12).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    return b.hora ? `${fechaStr} — ${String(b.hora).slice(0, 5)}` : `${fechaStr} — Todo el día`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 28, width: 460, maxWidth: '100%',
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#1a1a2e' }}>🔒 Bloquear Horario / Día</h2>
          <button onClick={onClose} style={{
            background: '#f0f2f5', border: 'none', borderRadius: 8, width: 32, height: 32,
            cursor: 'pointer', fontSize: 16, color: '#666'
          }}>✕</button>
        </div>

        {error && (
          <div style={{
            background: '#fff0f0', border: '1px solid #ffcdd2', color: '#c62828',
            padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 14
          }}>{error}</div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4, color: '#444' }}>
              Fecha *
            </label>
            <input required type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)} style={fi} />
          </div>

          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4, color: '#444' }}>
              Tipo de bloqueo
            </label>
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={fi}>
              <option value="dia">🚫 Todo el día</option>
              <option value="hora">🕐 Hora específica</option>
            </select>
          </div>

          {form.tipo === 'hora' && (
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4, color: '#444' }}>
                Hora *
              </label>
              <input required type="time" value={form.hora} onChange={e => set('hora', e.target.value)} style={fi} />
            </div>
          )}

          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 4, color: '#444' }}>
              Motivo (opcional)
            </label>
            <input value={form.motivo} onChange={e => set('motivo', e.target.value)}
              placeholder="Ej: Congreso médico, junta..." style={fi} />
          </div>

          <button type="submit" disabled={saving} style={{
            padding: '11px', borderRadius: 9, border: 'none',
            background: saving ? '#ccc' : 'linear-gradient(135deg, #e53935, #b71c1c)',
            color: '#fff', fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontSize: 14,
            boxShadow: saving ? 'none' : '0 4px 12px rgba(229,57,53,.3)'
          }}>
            {saving ? 'Guardando...' : '🔒 Bloquear'}
          </button>
        </form>

        {existing.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#555', marginBottom: 8 }}>
              Bloqueos activos
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {existing.map(b => (
                <div key={b.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: '#fff5f5', borderRadius: 8, padding: '8px 12px',
                  border: '1px solid #ffcdd2', fontSize: 13
                }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#c62828' }}>{fmtBlq(b)}</span>
                    {b.motivo && <span style={{ color: '#888', marginLeft: 6 }}>— {b.motivo}</span>}
                  </div>
                  <button onClick={() => remove(b.id)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#e53935', fontSize: 16, padding: '0 4px'
                  }}>🗑</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
