import React, { useEffect, useState } from 'react';

const STATUS_COLOR = { pendiente: '#ff9800', confirmada: '#4caf50', cancelada: '#f44336' };
const STATUS_LABEL = { pendiente: 'Pendiente', confirmada: 'Confirmada', cancelada: 'Cancelada' };

const fmtDate = (d) => { const [y,m,day] = (d||'').split('T')[0].split('-'); return `${day}/${m}/${y}`; };
const fmtTime = (t) => (t||'').slice(0, 5);

export default function PatientHistoryModal({ telefono, onClose }) {
  const [citas, setCitas] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('panel_token');

  useEffect(() => {
    fetch(`/api/patients/${telefono}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setCitas(Array.isArray(data) ? data : []); setLoading(false); });
  }, [telefono]);

  const clean = (t) => (t || '').replace(/:[0-9]+(@.*)?$/, '').replace(/@.*$/, '');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32, width: 560, maxWidth: '100%',
        maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1a1a2e', marginBottom: 2 }}>
              📋 Historial del Paciente
            </h2>
            <p style={{ color: '#888', fontSize: 13 }}>+{clean(telefono)}</p>
          </div>
          <button onClick={onClose} style={{
            background: '#f0f2f5', border: 'none', borderRadius: 8, width: 32, height: 32,
            cursor: 'pointer', fontSize: 16, color: '#666'
          }}>✕</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Cargando historial...</div>
        ) : citas.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: 40, background: '#f8f9ff', borderRadius: 12, color: '#aaa'
          }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📭</div>
            <p>Sin citas registradas</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {citas.map(c => (
              <div key={c.id} style={{
                background: '#f8f9ff', borderRadius: 10, padding: '14px 16px',
                border: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{c.nombre}</div>
                  <div style={{ color: '#555', fontSize: 13 }}>
                    📅 {fmtDate(c.fecha)} &nbsp;·&nbsp; ⏰ {fmtTime(c.hora)}
                  </div>
                  {c.motivo && (
                    <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>🩺 {c.motivo}</div>
                  )}
                  <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
                    {c.source === 'whatsapp' ? '📱 WhatsApp' : '✏️ Manual'}
                  </div>
                </div>
                <span style={{
                  background: STATUS_COLOR[c.status] + '22', color: STATUS_COLOR[c.status],
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap'
                }}>
                  {STATUS_LABEL[c.status] || c.status}
                </span>
              </div>
            ))}
          </div>
        )}

        <button onClick={onClose} style={{
          marginTop: 20, width: '100%', padding: '11px', borderRadius: 9,
          border: '1.5px solid #ddd', background: '#fff', color: '#555',
          fontWeight: 600, cursor: 'pointer', fontSize: 14
        }}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
