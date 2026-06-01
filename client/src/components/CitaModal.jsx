import React, { useState, useEffect } from 'react';

const fi = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1.5px solid #ddd', fontSize: 14, outline: 'none', transition: 'border-color .2s'
};

export default function CitaModal({ cita, onClose, onSaved }) {
  const isEdit = !!cita;
  const [form, setForm] = useState({
    nombre: cita?.nombre || '',
    telefono: cita?.telefono || '',
    fecha: cita?.fecha ? cita.fecha.split('T')[0] : '',
    hora: cita?.hora ? cita.hora.slice(0, 5) : '',
    motivo: cita?.motivo || '',
    status: cita?.status || 'pendiente'
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const token = localStorage.getItem('panel_token');

  // Para nuevas citas: cargar slots disponibles cuando cambia la fecha
  useEffect(() => {
    if (isEdit || !form.fecha) { setSlots([]); return; }
    setLoadingSlots(true);
    setForm(p => ({ ...p, hora: '' }));
    fetch(`/api/appointments/available-slots?fecha=${form.fecha}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { setSlots(d.slots || []); })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [form.fecha, isEdit, token]);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const url = isEdit ? `/api/appointments/${cita.id}` : '/api/appointments';
      const method = isEdit ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Error al guardar'); setSaving(false); return; }
      onSaved(data);
      onClose();
    } catch {
      setError('Error de conexión');
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32, width: 480, maxWidth: '100%',
        maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e' }}>
            {isEdit ? '✏️ Editar Cita' : '➕ Nueva Cita'}
          </h2>
          <button onClick={onClose} style={{
            background: '#f0f2f5', border: 'none', borderRadius: 8, width: 32, height: 32,
            cursor: 'pointer', fontSize: 16, color: '#666'
          }}>✕</button>
        </div>

        {error && (
          <div style={{
            background: '#fff0f0', border: '1px solid #ffcdd2', color: '#c62828',
            padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 16
          }}>{error}</div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Nombre del paciente *
            </label>
            <input required value={form.nombre} onChange={e => set('nombre', e.target.value)}
              placeholder="Ej: María González" style={fi}
              onFocus={e => e.target.style.borderColor = '#25d366'}
              onBlur={e => e.target.style.borderColor = '#ddd'} />
          </div>

          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Teléfono (con código de país, sin +)
            </label>
            <input value={form.telefono} onChange={e => set('telefono', e.target.value)}
              placeholder="525512345678" style={fi}
              onFocus={e => e.target.style.borderColor = '#25d366'}
              onBlur={e => e.target.style.borderColor = '#ddd'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
                Fecha *
              </label>
              <input required type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)}
                style={fi}
                onFocus={e => e.target.style.borderColor = '#25d366'}
                onBlur={e => e.target.style.borderColor = '#ddd'} />
            </div>
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
                Hora *
              </label>
              {isEdit ? (
                <input required type="time" value={form.hora} onChange={e => set('hora', e.target.value)}
                  style={fi}
                  onFocus={e => e.target.style.borderColor = '#25d366'}
                  onBlur={e => e.target.style.borderColor = '#ddd'} />
              ) : (
                <select required value={form.hora} onChange={e => set('hora', e.target.value)}
                  disabled={!form.fecha || loadingSlots}
                  style={{ ...fi, background: '#fff', cursor: 'pointer', color: form.hora ? '#000' : '#999' }}>
                  <option value="">
                    {!form.fecha ? 'Elige fecha primero' : loadingSlots ? 'Cargando...' : slots.length === 0 ? 'Sin horarios disponibles' : 'Selecciona hora'}
                  </option>
                  {slots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          </div>

          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Motivo de consulta
            </label>
            <input value={form.motivo} onChange={e => set('motivo', e.target.value)}
              placeholder="Ej: Revisión general, dolor de cabeza..." style={fi}
              onFocus={e => e.target.style.borderColor = '#25d366'}
              onBlur={e => e.target.style.borderColor = '#ddd'} />
          </div>

          {isEdit && (
            <div>
              <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
                Estado
              </label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                style={{ ...fi, background: '#fff', cursor: 'pointer' }}>
                <option value="pendiente">⏳ Pendiente</option>
                <option value="confirmada">✅ Confirmada</option>
                <option value="cancelada">❌ Cancelada</option>
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: '11px', borderRadius: 9, border: '1.5px solid #ddd',
              background: '#fff', color: '#555', fontWeight: 600, cursor: 'pointer', fontSize: 14
            }}>
              Cancelar
            </button>
            <button type="submit"
              disabled={saving || (!isEdit && slots.length === 0)}
              style={{
                flex: 1, padding: '11px', borderRadius: 9, border: 'none',
                background: (saving || (!isEdit && slots.length === 0)) ? '#ccc' : 'linear-gradient(135deg, #25d366, #20b858)',
                color: '#fff', fontWeight: 700,
                cursor: (saving || (!isEdit && slots.length === 0)) ? 'default' : 'pointer',
                fontSize: 14,
                boxShadow: (saving || (!isEdit && slots.length === 0)) ? 'none' : '0 4px 12px rgba(37,211,102,.3)'
              }}>
              {saving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : slots.length === 0 && form.fecha ? 'Sin disponibilidad' : 'Agregar Cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
