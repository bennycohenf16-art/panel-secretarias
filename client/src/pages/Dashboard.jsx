import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CitaModal from '../components/CitaModal';
import PatientHistoryModal from '../components/PatientHistoryModal';

const STATUS = {
  pendiente:  { color: '#ff9800', bg: '#fff3e0', label: 'Pendiente',  icon: '⏳' },
  confirmada: { color: '#4caf50', bg: '#e8f5e9', label: 'Confirmada', icon: '✅' },
  cancelada:  { color: '#f44336', bg: '#fff0f0', label: 'Cancelada',  icon: '❌' }
};

const fmtDate = (d) => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.split('T')[0] : d;
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
};
const fmtTime = (t) => (t || '').slice(0, 5);
const todayISO = () => new Date().toISOString().split('T')[0];
const cleanPhone = (t) => (t || '').replace(/:[0-9]+(@.*)?$/, '').replace(/@.*$/, '');

export default function Dashboard() {
  const nav = useNavigate();
  const name = localStorage.getItem('panel_name') || 'Doctor';
  const token = localStorage.getItem('panel_token');

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fecha, setFecha] = useState(todayISO());
  const [monthTotal, setMonthTotal] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [historyPhone, setHistoryPhone] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const api = useCallback((url, opts = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  , [token]);

  const load = useCallback(async () => {
    setLoading(true);
    const url = `/api/appointments${fecha ? `?fecha=${fecha}` : ''}`;
    const r = await api(url);
    if (r.status === 401) { localStorage.clear(); nav('/login'); return; }
    const data = await r.json();
    setAppointments(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [fecha, api, nav]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api('/api/appointments/month').then(r => r.json()).then(d => setMonthTotal(d.total || 0));
  }, [api]);

  const changeStatus = async (id, status) => {
    setUpdating(id);
    await api(`/api/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    setUpdating(null);
    load();
  };

  const deleteOne = async (id) => {
    await api(`/api/appointments/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    load();
  };

  const logout = () => { localStorage.clear(); nav('/login'); };

  const pending = appointments.filter(a => a.status === 'pendiente').length;
  const confirmed = appointments.filter(a => a.status === 'confirmada').length;
  const today = todayISO();

  const statCards = [
    { label: fecha ? `Citas del día` : 'Total citas', value: appointments.length, color: '#1a1a2e', bg: '#f0f4ff', icon: '📅' },
    { label: 'Pendientes',  value: pending,   color: '#e65100', bg: '#fff3e0', icon: '⏳' },
    { label: 'Confirmadas', value: confirmed, color: '#2e7d32', bg: '#e8f5e9', icon: '✅' },
    { label: 'Este mes',    value: monthTotal, color: '#6a1b9a', bg: '#f3e5f5', icon: '📊' }
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        padding: '0 24px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 16px rgba(0,0,0,.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #25d366, #20b858)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
          }}>🏥</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Dr. {name}</div>
            <div style={{ color: '#aaa', fontSize: 11 }}>Panel de Citas</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: '#888', fontSize: 13 }}>
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <button onClick={logout} style={{
            background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
            color: '#fff', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600
          }}>
            Salir
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
          {statCards.map(s => (
            <div key={s.label} style={{
              background: '#fff', borderRadius: 14, padding: '20px 20px',
              boxShadow: '0 2px 12px rgba(0,0,0,.06)', borderTop: `3px solid ${s.color}`
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>{s.label}</div>
                </div>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: s.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
                }}>{s.icon}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter + New button */}
        <div style={{
          background: '#fff', borderRadius: 14, padding: '16px 20px', marginBottom: 20,
          boxShadow: '0 2px 12px rgba(0,0,0,.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#444' }}>Filtrar por fecha:</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #ddd', fontSize: 13, cursor: 'pointer' }} />
            <button onClick={() => setFecha(today)} style={{
              padding: '8px 14px', borderRadius: 8, background: fecha === today ? '#e8f5e9' : '#f0f2f5',
              color: fecha === today ? '#2e7d32' : '#555', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600
            }}>
              Hoy
            </button>
            {fecha && (
              <button onClick={() => setFecha('')} style={{
                padding: '8px 14px', borderRadius: 8, background: '#f0f2f5',
                color: '#555', border: 'none', cursor: 'pointer', fontSize: 13
              }}>
                Todas
              </button>
            )}
          </div>
          <button onClick={() => setShowAdd(true)} style={{
            padding: '10px 20px', borderRadius: 9,
            background: 'linear-gradient(135deg, #1a1a2e, #2d2d4e)',
            color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14,
            boxShadow: '0 4px 12px rgba(26,26,46,.3)', display: 'flex', alignItems: 'center', gap: 6
          }}>
            <span style={{ fontSize: 16 }}>+</span> Nueva Cita
          </button>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,.06)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
            padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <h2 style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>
              📋 Citas {fecha ? `— ${fmtDate(fecha)}` : '— Todas'}
            </h2>
            <span style={{
              background: 'rgba(255,255,255,.15)', color: '#fff', padding: '3px 10px',
              borderRadius: 20, fontSize: 12, fontWeight: 600
            }}>
              {appointments.length} {appointments.length === 1 ? 'cita' : 'citas'}
            </span>
          </div>

          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>⏳</div>
              <p>Cargando citas...</p>
            </div>
          ) : appointments.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#aaa' }}>
              <div style={{ fontSize: 52, marginBottom: 12 }}>📭</div>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Sin citas {fecha ? 'para este día' : 'registradas'}</p>
              <p style={{ fontSize: 13 }}>Haz clic en "+ Nueva Cita" para agregar una</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9ff' }}>
                    {['Paciente', 'Teléfono', 'Fecha', 'Hora', 'Motivo', 'Fuente', 'Estado', 'Acciones'].map(h => (
                      <th key={h} style={{
                        padding: '12px 16px', textAlign: 'left', fontSize: 12,
                        fontWeight: 700, color: '#666', borderBottom: '1px solid #eee',
                        whiteSpace: 'nowrap'
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((c, i) => {
                    const st = STATUS[c.status] || STATUS.pendiente;
                    return (
                      <tr key={c.id} style={{
                        background: i % 2 === 0 ? '#fff' : '#fafbff',
                        transition: 'background .15s'
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbff'}
                      >
                        <td style={{ padding: '13px 16px', fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>
                          {c.nombre}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          {c.telefono ? (
                            <button onClick={() => setHistoryPhone(c.telefono)} style={{
                              background: '#e8f5e9', color: '#2e7d32', border: 'none',
                              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                              fontSize: 12, fontWeight: 600
                            }}>
                              📞 +{cleanPhone(c.telefono)}
                            </button>
                          ) : <span style={{ color: '#ccc' }}>—</span>}
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: 13, color: '#444', whiteSpace: 'nowrap' }}>
                          {fmtDate(c.fecha)}
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: 14, fontWeight: 700, color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                          {fmtTime(c.hora)}
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: 13, color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.motivo || <span style={{ color: '#ccc' }}>—</span>}
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <span style={{
                            background: c.source === 'whatsapp' ? '#e8f5e9' : '#e3f2fd',
                            color: c.source === 'whatsapp' ? '#2e7d32' : '#1565c0',
                            padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700
                          }}>
                            {c.source === 'whatsapp' ? '📱 WA' : '✏️ Manual'}
                          </span>
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <span style={{
                            background: st.bg, color: st.color,
                            padding: '5px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                            whiteSpace: 'nowrap'
                          }}>
                            {st.icon} {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '13px 16px' }}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            {c.status === 'pendiente' && (
                              <>
                                <button disabled={updating === c.id}
                                  onClick={() => changeStatus(c.id, 'confirmada')}
                                  title="Confirmar"
                                  style={{ background: '#e8f5e9', color: '#2e7d32', border: 'none', padding: '6px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                                  ✅
                                </button>
                                <button disabled={updating === c.id}
                                  onClick={() => changeStatus(c.id, 'cancelada')}
                                  title="Cancelar"
                                  style={{ background: '#fff0f0', color: '#f44336', border: 'none', padding: '6px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                                  ❌
                                </button>
                              </>
                            )}
                            <button onClick={() => setEditing(c)} title="Editar"
                              style={{ background: '#e8eaf6', color: '#3949ab', border: 'none', padding: '6px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                              ✏️
                            </button>
                            <button onClick={() => setConfirmDelete(c.id)} title="Eliminar"
                              style={{ background: '#fff0f0', color: '#f44336', border: 'none', padding: '6px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 13 }}>
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAdd && (
        <CitaModal cita={null} onClose={() => setShowAdd(false)} onSaved={() => { load(); }} />
      )}
      {editing && (
        <CitaModal cita={editing} onClose={() => setEditing(null)} onSaved={() => { load(); }} />
      )}
      {historyPhone && (
        <PatientHistoryModal telefono={historyPhone} onClose={() => setHistoryPhone(null)} />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1002, padding: 16
        }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 28, width: 360, maxWidth: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)', textAlign: 'center'
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>¿Eliminar esta cita?</h3>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>Esta acción no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmDelete(null)} style={{
                flex: 1, padding: '11px', borderRadius: 9, border: '1.5px solid #ddd',
                background: '#fff', fontWeight: 600, cursor: 'pointer'
              }}>Cancelar</button>
              <button onClick={() => deleteOne(confirmDelete)} style={{
                flex: 1, padding: '11px', borderRadius: 9, border: 'none',
                background: '#f44336', color: '#fff', fontWeight: 700, cursor: 'pointer'
              }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
