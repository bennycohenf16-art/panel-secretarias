import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CitaModal from '../components/CitaModal';
import PatientHistoryModal from '../components/PatientHistoryModal';
import BotStatusWidget from '../components/BotStatusWidget';
import WaitingListPanel from '../components/WaitingListPanel';
import BlockedSlotsModal from '../components/BlockedSlotsModal';
import ForcePasswordModal from '../components/ForcePasswordModal';

// ── Constantes ────────────────────────────────────────────────────────────────

const DOW_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

const STATUS = {
  pendiente:  { label: 'Pendiente',  icon: '⏳', badge: 'bg-orange-100 text-orange-700' },
  confirmada: { label: 'Confirmada', icon: '✅', badge: 'bg-green-100 text-green-700' },
  cancelada:  { label: 'Cancelada',  icon: '❌', badge: 'bg-red-100 text-red-700' },
  atendida:   { label: 'Atendida',   icon: '🏥', badge: 'bg-blue-100 text-blue-700' },
  ausente:    { label: 'Ausente',    icon: '👻', badge: 'bg-gray-100 text-gray-500' },
};

const TIME_SLOTS = [];
for (let h = 9; h <= 18; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2,'0')}:00`);
  if (h < 18) TIME_SLOTS.push(`${String(h).padStart(2,'0')}:30`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeJWT(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return {}; }
}

function Bar({ pct, color }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div style={{ width: `${pct}%`, background: color }} className="h-2 rounded-full transition-all" />
    </div>
  );
}

const fmtDate = (d) => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.split('T')[0] : d;
  const [y, m, day] = s.split('-');
  return `${day}/${m}/${y}`;
};
const fmtTime = (t) => (t || '').slice(0, 5);
const todayISO = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const firstOfMonthISO = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
};
const fmtPhone = (t) => {
  const d = (t || '').replace(/\D/g, '').slice(-10);
  if (d.length < 10) return d || '';
  return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6,10)}`;
};
const addDays = (fechaISO, delta) => {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta, 12);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2,'0'),
    String(dt.getDate()).padStart(2,'0'),
  ].join('-');
};

// ── Sub-componentes del Time Grid ─────────────────────────────────────────────

const STATUS_COLORS = {
  confirmada:  { accent: '#34d399', bg: '#f0fdf4' },
  pendiente:   { accent: '#fbbf24', bg: '#fffbeb' },
  cancelada:   { accent: '#f87171', bg: '#fef2f2' },
  atendida:    { accent: '#60a5fa', bg: '#eff6ff' },
  ausente:     { accent: '#9ca3af', bg: '#f9fafb' },
  rechazada:   { accent: '#f87171', bg: '#fef2f2' },
  reagendada:  { accent: '#fbbf24', bg: '#fffbeb' },
};

function CitaCard({ cita, updating, changeStatus, onEdit, onDelete, onPhone }) {
  const { accent: accentColor, bg: bgColor } = STATUS_COLORS[cita.status] || STATUS_COLORS.pendiente;
  const today     = todayISO();
  const fechaNorm = cita.fecha ? String(cita.fecha).split('T')[0] : '';
  const isPast    = !!fechaNorm && fechaNorm < today;

  return (
    <div style={{ borderLeft: `4px solid ${accentColor}`, background: bgColor, borderRadius: '0 8px 8px 0' }}
      className="px-3 py-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm text-gray-800 truncate">{cita.nombre}</div>
        {cita.motivo && <div className="text-xs text-gray-400 truncate">{cita.motivo}</div>}
        {cita.telefono && (
          <button onClick={onPhone}
            className="text-xs text-green-700 font-semibold border-0 bg-transparent cursor-pointer p-0 mt-0.5 hover:underline">
            📞 {fmtPhone(cita.telefono)}
          </button>
        )}
      </div>
      <div className="flex gap-1 flex-none items-center">
        {/* Cita pasada ya cerrada: badge estático que refleja el estado final */}
        {isPast && cita.status === 'atendida' && (
          <span title="Atendida"
            style={{ width:28, height:28, borderRadius:7, background:'#dbeafe', color:'#1d4ed8', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>
            🏥
          </span>
        )}
        {isPast && cita.status === 'ausente' && (
          <span title="Ausente"
            style={{ width:28, height:28, borderRadius:7, background:'#f3f4f6', color:'#4b5563', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>
            👻
          </span>
        )}
        {/* Cita pasada aún sin cerrar: botones de acción para asignar estado final */}
        {isPast && cita.status !== 'atendida' && cita.status !== 'ausente' && (
          <>
            <button disabled={updating === cita.id} onClick={() => changeStatus(cita.id, 'atendida')}
              title="Marcar como Atendida"
              className="disabled:opacity-40"
              style={{ width:28, height:28, borderRadius:7, background:'#dbeafe', color:'#1d4ed8', border:'none', cursor:'pointer', fontSize:12 }}>
              🏥
            </button>
            <button disabled={updating === cita.id} onClick={() => changeStatus(cita.id, 'ausente')}
              title="Marcar como Ausente"
              className="disabled:opacity-40"
              style={{ width:28, height:28, borderRadius:7, background:'#f3f4f6', color:'#4b5563', border:'none', cursor:'pointer', fontSize:12 }}>
              👻
            </button>
          </>
        )}
        {/* Cita hoy/futura pendiente: confirmar / cancelar */}
        {!isPast && cita.status === 'pendiente' && (
          <>
            <button disabled={updating === cita.id} onClick={() => changeStatus(cita.id, 'confirmada')}
              title="Confirmar"
              className="disabled:opacity-40"
              style={{ width:28, height:28, borderRadius:7, background:'#dcfce7', color:'#15803d', border:'none', cursor:'pointer', fontSize:13, fontWeight:800 }}>
              ✓
            </button>
            <button disabled={updating === cita.id} onClick={() => changeStatus(cita.id, 'cancelada')}
              title="Cancelar"
              className="disabled:opacity-40"
              style={{ width:28, height:28, borderRadius:7, background:'#fee2e2', color:'#dc2626', border:'none', cursor:'pointer', fontSize:13, fontWeight:800 }}>
              ✕
            </button>
          </>
        )}
        <button onClick={onEdit} title="Editar"
          style={{ width:28, height:28, borderRadius:7, background:'#e0e7ff', color:'#4338ca', border:'none', cursor:'pointer', fontSize:12 }}>
          ✏️
        </button>
        <button onClick={onDelete} title="Eliminar"
          style={{ width:28, height:28, borderRadius:7, background:'#fee2e2', color:'#ef4444', border:'none', cursor:'pointer', fontSize:12 }}>
          🗑
        </button>
      </div>
    </div>
  );
}

function BlockedCard({ bloqueo, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2"
      style={{
        borderRadius: '0 8px 8px 0',
        border: '1px solid #fca5a5',
        background: 'repeating-linear-gradient(-45deg,#fef2f2,#fef2f2 6px,#fee2e2 6px,#fee2e2 12px)',
      }}>
      <span className="text-xs font-bold text-red-700 flex-1 truncate">
        🔒 Bloqueado{bloqueo.motivo ? ` — ${bloqueo.motivo}` : ''}
      </span>
      <button onClick={onDelete}
        style={{ border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:7, padding:'2px 10px', fontSize:11, fontWeight:700, cursor:'pointer', flexShrink:0 }}>
        Liberar
      </button>
    </div>
  );
}

function EmptySlot({ onClick }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer transition-all border-0"
      style={{ height:38, borderRadius:8, border:'2px dashed #e5e7eb', background:'transparent', color:'#d1d5db' }}
      onMouseEnter={e => { const b = e.currentTarget; b.style.borderColor='#a5b4fc'; b.style.background='#eef2ff'; b.style.color='#4338ca'; }}
      onMouseLeave={e => { const b = e.currentTarget; b.style.borderColor='#e5e7eb'; b.style.background='transparent'; b.style.color='#d1d5db'; }}>
      <span style={{ fontSize:16, fontWeight:900, lineHeight:1 }}>+</span>
      Disponible — Agendar
    </button>
  );
}

// Devuelve true si el slot (ej. "14:30") ya pasó en CDMX para la fecha dada
function isPastSlotToday(fecha, slot) {
  if (!fecha || fecha !== todayISO()) return false;
  const cdmxNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const [hH, hMin] = slot.split(':').map(Number);
  const slotDt = new Date(cdmxNow.getFullYear(), cdmxNow.getMonth(), cdmxNow.getDate(), hH, hMin, 0);
  return slotDt <= cdmxNow;
}

function TimeGrid({ fecha, appointments, blockedSlots, loading, updating,
                    changeStatus, setEditing, setConfirmDelete, setHistoryPhone,
                    onNewCita, onDeleteBlocked }) {
  if (loading) return (
    <div className="py-16 text-center text-gray-400">
      <div className="text-4xl mb-2">⏳</div>
      <p className="text-sm">Cargando agenda...</p>
    </div>
  );
  if (!fecha) return (
    <div className="py-16 text-center text-gray-400">
      <div className="text-5xl mb-3">📅</div>
      <p className="font-semibold text-gray-500">Selecciona un día para ver la agenda</p>
    </div>
  );

  const isDayBlocked  = blockedSlots.some(b => !b.hora);
  const blockedAtSlot = (slot) => blockedSlots.filter(b => b.hora && String(b.hora).slice(0,5) === slot);
  const citasAtSlot   = (slot) => appointments.filter(a => fmtTime(a.hora) === slot);

  return (
    <div>
      {isDayBlocked && (
        <div className="px-4 py-3 border-b border-red-100 flex flex-wrap items-center gap-3"
          style={{ background: 'repeating-linear-gradient(-45deg,#fff5f5,#fff5f5 8px,#fee2e2 8px,#fee2e2 16px)' }}>
          {blockedSlots.filter(b => !b.hora).map(b => (
            <React.Fragment key={b.id}>
              <span className="font-bold text-red-700 text-sm flex-1">
                🔒 Día completo bloqueado{b.motivo ? ` — ${b.motivo}` : ''}
              </span>
              <button onClick={() => onDeleteBlocked(b.id)}
                style={{ border:'1px solid #fca5a5', background:'#fff', color:'#dc2626', borderRadius:8, padding:'4px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                Desbloquear día
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
      <div style={{ paddingBottom: 8 }}>
        {TIME_SLOTS.map((slot) => {
          const citas      = citasAtSlot(slot);
          const bloqueados = blockedAtSlot(slot);
          const hasContent = citas.length > 0 || bloqueados.length > 0;
          const isHour     = slot.endsWith(':00');
          const isPast     = isPastSlotToday(fecha, slot);
          return (
            <div key={slot} className="flex"
              style={{
                minHeight: hasContent ? 'auto' : 56,
                borderBottom: `1px solid ${isHour ? '#f3f4f6' : '#fafafa'}`,
                ...(isPast ? {
                  background: 'repeating-linear-gradient(-45deg,#f9fafb,#f9fafb 5px,#f3f4f6 5px,#f3f4f6 10px)',
                  opacity: 0.55,
                  pointerEvents: 'none',
                } : {})
              }}>
              <div className="flex-none flex items-start justify-end pt-3 pr-3" style={{ width: 72 }}>
                <span style={{ fontSize: 11, fontWeight: isHour ? 600 : 400, color: isPast ? '#d1d5db' : (isHour ? '#6b7280' : '#d1d5db'), fontVariantNumeric: 'tabular-nums' }}>
                  {slot}
                </span>
              </div>
              <div className="flex-none mt-2" style={{ width:1, background: isHour ? '#e5e7eb' : '#f3f4f6' }} />
              <div className="flex-1 pl-3 pr-4 py-1.5 space-y-1">
                {citas.map(c => (
                  <CitaCard key={c.id} cita={c} updating={updating}
                    changeStatus={changeStatus}
                    onEdit={() => setEditing(c)}
                    onDelete={() => setConfirmDelete(c.id)}
                    onPhone={() => setHistoryPhone(c.telefono)} />
                ))}
                {bloqueados.map(b => (
                  <BlockedCard key={b.id} bloqueo={b} onDelete={() => onDeleteBlocked(b.id)} />
                ))}
                {!hasContent && !isDayBlocked && !isPast && (
                  <EmptySlot onClick={() => onNewCita(fecha, slot)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const nav   = useNavigate();
  const name  = localStorage.getItem('panel_name') || 'Doctor';
  const token = localStorage.getItem('panel_token');

  // role y force_password_change se leen del JWT (campos estáticos).
  // subscription_status se obtiene del backend porque cambia dinámicamente.
  const decoded = decodeJWT(token);
  const role = decoded?.role || 'doctor';
  const [forcePasswordChange, setForcePasswordChange] = useState(!!decoded?.force_password_change);

  // ── Suscripción ────────────────────────────────────────────────────────────
  const [subscriptionStatus, setSubscriptionStatus] = useState(null); // null = verificando
  const [loadingCheckout, setLoadingCheckout]       = useState(false);

  // ── Agenda states ──────────────────────────────────────────────────────────
  const [appointments, setAppointments] = useState([]);
  const [blockedSlots, setBlockedSlots]  = useState([]);
  const [loading, setLoading]            = useState(true);
  const [fecha, setFecha]                = useState(todayISO());
  const [monthTotal, setMonthTotal]      = useState(0);
  const [showAdd, setShowAdd]            = useState(false);
  const [editing, setEditing]            = useState(null);
  const [historyPhone, setHistoryPhone]  = useState(null);
  const [updating, setUpdating]          = useState(null);
  const [confirmDelete, setConfirmDelete]= useState(null);
  const [drawerOpen, setDrawerOpen]      = useState(false);
  const [tab, setTab]                    = useState('agenda');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [vista, setVista]                = useState('calendario');
  const [prefillSlot, setPrefillSlot]    = useState(null);

  // ── Rendimiento states ─────────────────────────────────────────────────────
  const [perfData, setPerfData]       = useState([]);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [fechaDesde, setFechaDesde]   = useState(firstOfMonthISO);
  const [fechaHasta, setFechaHasta]   = useState(todayISO);

  // ── API helper ─────────────────────────────────────────────────────────────
  const api = useCallback((url, opts = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  , [token]);

  // ── Verificación de suscripción ────────────────────────────────────────────
  const checkSubscription = useCallback(async () => {
    try {
      const r = await api('/api/billing/status');
      if (r.status === 401) { localStorage.clear(); nav('/login'); return; }
      const d = await r.json();
      setSubscriptionStatus(d.subscription_status || 'unpaid');
    } catch {
      // Si el fetch falla por red, no penalizar al usuario activo
      setSubscriptionStatus('active');
    }
  }, [api, nav]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  // ── Manejo del retorno desde Stripe ───────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('payment')) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (params.get('payment') === 'success') {
      // El webhook puede tener un leve delay — re-verifica tras 2.5 s
      setTimeout(checkSubscription, 2500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Checkout Stripe ────────────────────────────────────────────────────────
  const handleCheckout = async () => {
    if (loadingCheckout) return;
    setLoadingCheckout(true);
    try {
      const r = await api('/api/billing/checkout', { method: 'POST' });
      const d = await r.json();
      if (d.url) {
        window.location.href = d.url;
      } else {
        alert(d.error || 'No se pudo generar el enlace de pago. Intenta de nuevo.');
        setLoadingCheckout(false);
      }
    } catch {
      alert('Error de red. Verifica tu conexión e intenta de nuevo.');
      setLoadingCheckout(false);
    }
  };

  // ── Derivados de suscripción ───────────────────────────────────────────────
  // Los administradores nunca son bloqueados. Solo doctores con status inactivo.
  const isBlocked = role !== 'admin' && (subscriptionStatus === 'unpaid' || subscriptionStatus === 'past_due');

  // ── Carga de agenda ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const apptRes = await api(`/api/appointments${fecha ? `?fecha=${fecha}` : ''}`);
    if (apptRes.status === 401) { localStorage.clear(); nav('/login'); return; }
    const [apptData, blkData] = await Promise.all([
      apptRes.json(),
      fecha
        ? api(`/api/blocked-slots?fecha=${fecha}`).then(r => r.json()).catch(() => [])
        : Promise.resolve([]),
    ]);
    setAppointments(Array.isArray(apptData) ? apptData : []);
    setBlockedSlots(Array.isArray(blkData) ? blkData : []);
    setLoading(false);
  }, [fecha, api, nav]);

  // ── Carga de rendimiento ───────────────────────────────────────────────────
  const loadPerformance = useCallback(async () => {
    setLoadingPerf(true);
    try {
      const r = await api(`/api/reports/performance?desde=${fechaDesde}&hasta=${fechaHasta}`);
      const d = await r.json();
      setPerfData(Array.isArray(d) ? d : []);
    } catch {
      setPerfData([]);
    } finally {
      setLoadingPerf(false);
    }
  }, [api, fechaDesde, fechaHasta]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/api/appointments/month').then(r => r.json()).then(d => setMonthTotal(d.total || 0));
  }, [api]);
  useEffect(() => {
    if (tab === 'rendimiento') loadPerformance();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Acciones de agenda ─────────────────────────────────────────────────────
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

  const deleteBlockedSlot = async (id) => {
    await api(`/api/blocked-slots/${id}`, { method: 'DELETE' });
    load();
  };

  const handleSetVista = (v) => {
    setVista(v);
    if (v === 'calendario' && !fecha) setFecha(todayISO());
  };

  const logout = () => { localStorage.clear(); nav('/login'); };

  const today     = todayISO();
  // rechazada/reagendada pertenecen al historial de Espera — nunca deben aparecer en la agenda activa
  const activeAppointments = appointments.filter(a => a.status !== 'rechazada' && a.status !== 'reagendada');
  const pending   = activeAppointments.filter(a => a.status === 'pendiente').length;
  const confirmed = activeAppointments.filter(a => a.status === 'confirmada').length;

  const statCards = [
    { label: fecha ? 'Citas del día' : 'Total citas', value: activeAppointments.length, color: '#1a1a2e', bg: '#f0f4ff', icon: '📅' },
    { label: 'Pendientes',  value: pending,    color: '#e65100', bg: '#fff3e0', icon: '⏳' },
    { label: 'Confirmadas', value: confirmed,  color: '#2e7d32', bg: '#e8f5e9', icon: '✅' },
    { label: 'Este mes',    value: monthTotal, color: '#6a1b9a', bg: '#f3e5f5', icon: '📊' },
  ];

  const dateLabel = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  // ── Cómputos de rendimiento ────────────────────────────────────────────────
  const perfTotals = perfData.reduce(
    (acc, r) => ({
      creadas:     acc.creadas     + (r.creadas_manual || 0),
      confirmadas: acc.confirmadas + (r.confirmadas    || 0),
      canceladas:  acc.canceladas  + (r.canceladas     || 0),
      atendidas:   acc.atendidas   + (r.atendidas      || 0),
      ausentes:    acc.ausentes    + (r.ausentes        || 0),
    }),
    { creadas: 0, confirmadas: 0, canceladas: 0, atendidas: 0, ausentes: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Cambio de contraseña forzado — modal bloqueante ───────────────── */}
      {forcePasswordChange && (
        <ForcePasswordModal
          token={token}
          onPasswordChanged={() => setForcePasswordChange(false)}
        />
      )}

      {/* ── Drawer móvil ──────────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 flex flex-col shadow-2xl"
            style={{ background: '#1a1a2e' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                  style={{ background: 'linear-gradient(135deg, #25d366, #20b858)' }}>🏥</div>
                <div>
                  <div className="text-white font-bold text-sm">Dr. {name}</div>
                  <div className="text-gray-400 text-xs">Panel de Citas</div>
                </div>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 text-2xl leading-none p-1 bg-transparent border-0 cursor-pointer">✕</button>
            </div>
            <div className="px-5 py-4 border-b border-white/10">
              <div className="text-gray-300 text-sm capitalize">{dateLabel}</div>
            </div>
            <div className="px-5 py-4 space-y-2">
              {[['agenda','📋 Agenda'],['rendimiento','📈 Rendimiento'],['espera','⏳ Lista de Espera']].map(([key,label]) => (
                <button key={key} onClick={() => { setTab(key); setDrawerOpen(false); }}
                  className="w-full py-3 rounded-xl text-sm font-semibold border-0 cursor-pointer text-left px-4 transition-colors"
                  style={tab === key ? { background:'#6366f1', color:'#fff' } : { background:'rgba(255,255,255,.08)', color:'#cbd5e1' }}>
                  {label}
                </button>
              ))}
            </div>
            <div className="px-5 pb-2">
              <BotStatusWidget token={token} />
            </div>
            <div className="flex-1" />
            <div className="p-5 border-t border-white/10">
              <button onClick={logout}
                className="w-full py-3 rounded-xl border border-white/20 text-white text-sm font-semibold bg-transparent cursor-pointer">
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 h-16 flex items-center justify-between shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
            style={{ background: 'linear-gradient(135deg, #25d366, #20b858)' }}>🏥</div>
          <div>
            <div className="text-white font-bold text-sm">Dr. {name}</div>
            <div className="text-gray-400 text-xs">Panel de Citas</div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-4">
          <span className="text-gray-400 text-sm capitalize">{dateLabel}</span>
          <button onClick={logout}
            className="px-3 py-1.5 rounded-lg text-white text-sm font-semibold cursor-pointer border"
            style={{ background:'rgba(255,255,255,.1)', borderColor:'rgba(255,255,255,.2)' }}>
            Salir
          </button>
        </div>
        <button onClick={() => setDrawerOpen(true)}
          className="sm:hidden text-white text-2xl p-1 leading-none cursor-pointer bg-transparent border-0">
          ☰
        </button>
      </div>

      {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-6 flex gap-1"
        style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
        {[['agenda','📋 Agenda'],['rendimiento','📈 Rendimiento'],['espera','⏳ Espera']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className="px-4 py-2.5 text-sm font-semibold border-0 cursor-pointer transition-colors rounded-t-lg"
            style={tab === key ? { background:'#f3f4f6', color:'#1a1a2e' } : { background:'transparent', color:'rgba(255,255,255,.6)' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-5 sm:py-6">

        <BotStatusWidget token={token} />

        {/* ══════════════════════════════════════════════════════════════════
            PESTAÑA RENDIMIENTO
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'rendimiento' && (
          <div className="space-y-5">

            {/* Toolbar de filtros */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Desde</label>
                  <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                    className="px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-indigo-400 focus:outline-none" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Hasta</label>
                  <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                    className="px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-indigo-400 focus:outline-none" />
                </div>
                <button onClick={loadPerformance} disabled={loadingPerf}
                  className="px-5 py-2 rounded-xl text-white text-sm font-bold border-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg,#4f46e5,#6366f1)', boxShadow: '0 4px 12px rgba(99,102,241,.35)' }}>
                  {loadingPerf ? 'Cargando...' : '🔍 Filtrar'}
                </button>
              </div>
            </div>

            {loadingPerf ? (
              <div className="py-20 text-center text-gray-400">
                <div className="text-4xl mb-3">⏳</div>
                <p className="text-sm font-medium">Cargando datos de rendimiento...</p>
              </div>
            ) : perfData.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm py-20 text-center">
                <div className="text-5xl mb-4">📊</div>
                <p className="text-base font-semibold text-gray-500 mb-1">Sin acciones registradas</p>
                <p className="text-sm text-gray-400">No se registran acciones del personal en el rango de fechas seleccionado.</p>
              </div>
            ) : (
              <>
                {/* Tarjetas de resumen global */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {[
                    { label: 'Citas Creadas (manual)', value: perfTotals.creadas,     color: '#4f46e5', bg: '#eef2ff', icon: '✏️' },
                    { label: 'Total Confirmadas',      value: perfTotals.confirmadas,  color: '#15803d', bg: '#f0fdf4', icon: '✅' },
                    { label: 'Total Canceladas',       value: perfTotals.canceladas,   color: '#dc2626', bg: '#fef2f2', icon: '❌' },
                    { label: 'Total Atendidas',        value: perfTotals.atendidas,    color: '#1d4ed8', bg: '#eff6ff', icon: '🏥' },
                    { label: 'Total Ausentes',         value: perfTotals.ausentes,     color: '#4b5563', bg: '#f9fafb', icon: '👻' },
                  ].map(s => (
                    <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-4"
                      style={{ borderTop: `3px solid ${s.color}` }}>
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{ background: s.bg }}>
                        {s.icon}
                      </div>
                      <div>
                        <div className="text-3xl font-extrabold leading-none" style={{ color: s.color }}>
                          {s.value}
                        </div>
                        <div className="text-gray-400 text-xs mt-1">{s.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tabla de posiciones */}
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 flex items-center justify-between"
                    style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
                    <h2 className="text-white font-bold text-sm">🏆 Leaderboard del Equipo</h2>
                    <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
                      style={{ background: 'rgba(255,255,255,.15)' }}>
                      {perfData.length} {perfData.length === 1 ? 'usuario' : 'usuarios'}
                    </span>
                  </div>

                  {/* Desktop */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          {['#', 'Secretaria / Usuario', 'Creadas Manual', 'Confirmadas', 'Canceladas', 'Atendidas', 'Ausentes', 'Efectividad'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 border-b border-gray-100 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {perfData
                          .map(r => {
                            const positivas = (r.confirmadas || 0) + (r.atendidas || 0);
                            const total = positivas + (r.canceladas || 0);
                            const efectividad = total > 0 ? (positivas / total * 100).toFixed(1) : '—';
                            return { ...r, efectividad, total };
                          })
                          .sort((a, b) => b.confirmadas - a.confirmadas)
                          .map((r, i) => {
                            const medals = ['🥇', '🥈', '🥉'];
                            const medal  = medals[i] || `${i + 1}`;
                            const efectPct = r.efectividad !== '—' ? parseFloat(r.efectividad) : 0;
                            const efectColor = efectPct >= 80 ? '#15803d' : efectPct >= 50 ? '#b45309' : '#dc2626';
                            return (
                              <tr key={r.secretary_name || i}
                                className={`transition-colors hover:bg-indigo-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                                <td className="px-4 py-3 text-base text-center" style={{ width: 48 }}>{medal}</td>
                                <td className="px-4 py-3">
                                  <div className="font-bold text-sm text-gray-800">{r.secretary_name || 'Sin nombre'}</div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold"
                                    style={{ background: '#eef2ff', color: '#4f46e5' }}>
                                    {r.creadas_manual || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold"
                                    style={{ background: '#f0fdf4', color: '#15803d' }}>
                                    {r.confirmadas || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold"
                                    style={{ background: '#fef2f2', color: '#dc2626' }}>
                                    {r.canceladas || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold"
                                    style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                                    {r.atendidas || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold"
                                    style={{ background: '#f9fafb', color: '#4b5563' }}>
                                    {r.ausentes || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-extrabold" style={{ color: efectColor, minWidth: 44 }}>
                                      {r.efectividad !== '—' ? `${r.efectividad}%` : '—'}
                                    </span>
                                    {r.efectividad !== '—' && (
                                      <div className="flex-1 min-w-[64px]">
                                        <Bar pct={efectPct} color={efectColor} />
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="block sm:hidden divide-y divide-gray-100">
                    {perfData
                      .map(r => {
                        const positivas = (r.confirmadas || 0) + (r.atendidas || 0);
                        const total = positivas + (r.canceladas || 0);
                        const efectividad = total > 0 ? (positivas / total * 100).toFixed(1) : null;
                        return { ...r, efectividad };
                      })
                      .sort((a, b) => b.confirmadas - a.confirmadas)
                      .map((r, i) => {
                        const medals = ['🥇', '🥈', '🥉'];
                        const efectColor = r.efectividad
                          ? (parseFloat(r.efectividad) >= 80 ? '#15803d' : parseFloat(r.efectividad) >= 50 ? '#b45309' : '#dc2626')
                          : '#9ca3af';
                        return (
                          <div key={r.secretary_name || i} className="p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xl">{medals[i] || `${i + 1}.`}</span>
                              <span className="font-bold text-gray-800 text-base">{r.secretary_name || 'Sin nombre'}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-2 mb-3">
                              {[
                                { label: 'Creadas',    value: r.creadas_manual || 0, bg: '#eef2ff', color: '#4f46e5' },
                                { label: 'Confirm.',   value: r.confirmadas    || 0, bg: '#f0fdf4', color: '#15803d' },
                                { label: 'Canceladas', value: r.canceladas     || 0, bg: '#fef2f2', color: '#dc2626' },
                                { label: 'Atendidas',  value: r.atendidas      || 0, bg: '#eff6ff', color: '#1d4ed8' },
                                { label: 'Ausentes',   value: r.ausentes       || 0, bg: '#f9fafb', color: '#4b5563' },
                              ].map(m => (
                                <div key={m.label} className="rounded-xl py-2 px-1 text-center" style={{ background: m.bg }}>
                                  <div className="text-lg font-extrabold" style={{ color: m.color }}>{m.value}</div>
                                  <div className="text-xs font-semibold" style={{ color: m.color }}>{m.label}</div>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500">Efectividad:</span>
                              <span className="text-sm font-extrabold" style={{ color: efectColor }}>
                                {r.efectividad ? `${r.efectividad}%` : '—'}
                              </span>
                              {r.efectividad && (
                                <div className="flex-1">
                                  <Bar pct={parseFloat(r.efectividad)} color={efectColor} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PESTAÑA ESPERA
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'espera' && <WaitingListPanel token={token} />}

        {/* ══════════════════════════════════════════════════════════════════
            PESTAÑA AGENDA
        ══════════════════════════════════════════════════════════════════ */}
        {tab === 'agenda' && (<>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-5">
            {statCards.map(s => (
              <div key={s.label} className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm"
                style={{ borderTop: `3px solid ${s.color}` }}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold leading-none" style={{ color: s.color }}>
                      {s.value}
                    </div>
                    <div className="text-gray-400 text-xs sm:text-sm mt-1">{s.label}</div>
                  </div>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                    style={{ background: s.bg }}>
                    {s.icon}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Barra de controles */}
          <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden sm:inline text-sm font-semibold text-gray-600">Fecha:</span>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="flex-1 sm:flex-none px-3 py-2 rounded-xl border-2 border-gray-100 text-sm cursor-pointer focus:border-[#25d366] focus:outline-none" />
                <button onClick={() => setFecha(today)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border-0 cursor-pointer
                    ${fecha === today ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  Hoy
                </button>
                {vista === 'tabla' && fecha && (
                  <button onClick={() => setFecha('')}
                    className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm border-0 cursor-pointer">
                    Todas
                  </button>
                )}
                <div className="flex items-center rounded-xl p-1 gap-0.5" style={{ background:'#f3f4f6' }}>
                  {[['calendario','🗓 Calendario'],['tabla','📋 Tabla']].map(([v, label]) => (
                    <button key={v} onClick={() => handleSetVista(v)}
                      className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer border-0 transition-all"
                      style={vista === v
                        ? { background:'#fff', color:'#1a1a2e', boxShadow:'0 1px 4px rgba(0,0,0,.12)' }
                        : { background:'transparent', color:'#9ca3af' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <button onClick={() => setShowBlockedModal(true)}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-sm cursor-pointer border-0"
                  style={{ background:'linear-gradient(135deg,#e53935,#b71c1c)', color:'#fff', boxShadow:'0 4px 12px rgba(229,57,53,.3)' }}>
                  🔒 Bloquear
                </button>
                <button onClick={() => { setPrefillSlot(null); setShowAdd(true); }}
                  className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-white font-bold text-sm cursor-pointer border-0"
                  style={{ background:'linear-gradient(135deg,#1a1a2e,#2d2d4e)', boxShadow:'0 4px 12px rgba(26,26,46,.3)' }}>
                  <span className="text-base font-bold">+</span> Nueva Cita
                </button>
              </div>
            </div>
          </div>

          {/* Vista Calendario */}
          {vista === 'calendario' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5"
                style={{ background:'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)' }}>
                <div className="flex items-center gap-2">
                  <button onClick={() => setFecha(f => addDays(f || today, -1))}
                    className="text-white border-0 rounded-lg cursor-pointer flex items-center justify-center text-lg font-bold"
                    style={{ width:28, height:28, background:'rgba(255,255,255,.12)' }}>
                    ‹
                  </button>
                  <h2 className="text-white font-bold text-sm px-1">
                    🗓 {fecha ? fmtDate(fecha) : 'Sin fecha'}
                  </h2>
                  <button onClick={() => setFecha(f => addDays(f || today, 1))}
                    className="text-white border-0 rounded-lg cursor-pointer flex items-center justify-center text-lg font-bold"
                    style={{ width:28, height:28, background:'rgba(255,255,255,.12)' }}>
                    ›
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
                    style={{ background:'rgba(255,255,255,.15)' }}>
                    {activeAppointments.length} {activeAppointments.length === 1 ? 'cita' : 'citas'}
                  </span>
                  <div className="hidden sm:flex items-center gap-3 ml-2">
                    {[['#34d399','Confirmada'],['#fbbf24','Pendiente'],['#f87171','Cancelada'],['#60a5fa','Atendida'],['#9ca3af','Ausente']].map(([c,l]) => (
                      <div key={l} className="flex items-center gap-1">
                        <div style={{ width:8, height:8, borderRadius:'50%', background:c }} />
                        <span style={{ color:'rgba(255,255,255,.6)', fontSize:11 }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <TimeGrid
                fecha={fecha}
                appointments={activeAppointments}
                blockedSlots={blockedSlots}
                loading={loading}
                updating={updating}
                changeStatus={changeStatus}
                setEditing={setEditing}
                setConfirmDelete={setConfirmDelete}
                setHistoryPhone={setHistoryPhone}
                onNewCita={(f, h) => { setPrefillSlot({ fecha: f, hora: h }); setShowAdd(true); }}
                onDeleteBlocked={deleteBlockedSlot}
              />
            </div>
          )}

          {/* Vista Tabla */}
          {vista === 'tabla' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="flex justify-between items-center px-5 py-3.5"
                style={{ background:'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)' }}>
                <h2 className="text-white font-bold text-sm">
                  📋 Citas {fecha ? `— ${fmtDate(fecha)}` : '— Todas'}
                </h2>
                <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
                  style={{ background:'rgba(255,255,255,.15)' }}>
                  {activeAppointments.length} {activeAppointments.length === 1 ? 'cita' : 'citas'}
                </span>
              </div>

              {loading ? (
                <div className="py-16 text-center text-gray-400">
                  <div className="text-4xl mb-2">⏳</div><p>Cargando citas...</p>
                </div>
              ) : activeAppointments.length === 0 ? (
                <div className="py-16 text-center text-gray-400">
                  <div className="text-5xl mb-3">📭</div>
                  <p className="text-base font-semibold text-gray-500 mb-1">
                    Sin citas {fecha ? 'para este día' : 'registradas'}
                  </p>
                  <p className="text-sm">Haz clic en "+ Nueva Cita" para agregar una</p>
                </div>
              ) : (<>

                {/* Mobile cards */}
                <div className="block sm:hidden divide-y divide-gray-100">
                  {activeAppointments.map(c => {
                    const st = STATUS[c.status] || STATUS.pendiente;
                    const fechaNormM = c.fecha ? String(c.fecha).split('T')[0] : '';
                    const isPastM    = !!fechaNormM && fechaNormM < today;
                    return (
                      <div key={c.id} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-bold text-[#1a1a2e] text-base leading-tight">{c.nombre}</span>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ml-2 shrink-0 ${st.badge}`}>
                            {st.icon} {st.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mb-2">
                          <span>📅 {fmtDate(c.fecha)}</span>
                          <span className="font-bold text-[#1a1a2e]">⏰ {fmtTime(c.hora)}</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${c.source === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {c.source === 'whatsapp' ? '📱 WA' : '✏️ Manual'}
                          </span>
                        </div>
                        {c.motivo && <div className="text-sm text-gray-500 mb-2 truncate">📝 {c.motivo}</div>}
                        {c.telefono && (
                          <button onClick={() => setHistoryPhone(c.telefono)}
                            className="bg-green-50 text-green-700 text-xs font-bold px-3 py-1.5 rounded-lg mb-3 border-0 cursor-pointer block">
                            📞 {fmtPhone(c.telefono)}
                          </button>
                        )}
                        <div className="flex gap-2">
                          {isPastM ? (
                            <>
                              {c.status !== 'atendida' && (
                                <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'atendida')}
                                  className="flex-1 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-bold text-sm border-0 cursor-pointer disabled:opacity-50">
                                  🏥 Atendida
                                </button>
                              )}
                              {c.status !== 'ausente' && (
                                <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'ausente')}
                                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-500 font-bold text-sm border-0 cursor-pointer disabled:opacity-50">
                                  👻 Ausente
                                </button>
                              )}
                            </>
                          ) : c.status === 'pendiente' ? (
                            <>
                              <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'confirmada')}
                                className="flex-1 py-2.5 rounded-xl bg-green-50 text-green-700 font-bold text-sm border-0 cursor-pointer disabled:opacity-50">
                                ✅ Confirmar
                              </button>
                              <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'cancelada')}
                                className="flex-1 py-2.5 rounded-xl bg-red-50 text-red-600 font-bold text-sm border-0 cursor-pointer disabled:opacity-50">
                                ❌ Cancelar
                              </button>
                            </>
                          ) : (
                            <div className="flex-1" />
                          )}
                          <button onClick={() => setEditing(c)}
                            className="px-4 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 font-bold text-sm border-0 cursor-pointer">
                            ✏️
                          </button>
                          <button onClick={() => setConfirmDelete(c.id)}
                            className="px-4 py-2.5 rounded-xl bg-red-50 text-red-500 font-bold text-sm border-0 cursor-pointer">
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        {['Paciente','Teléfono','Fecha','Hora','Motivo','Fuente','Estado','Acciones'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 border-b border-gray-100 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeAppointments.map((c, i) => {
                        const st = STATUS[c.status] || STATUS.pendiente;
                        const fechaNormD = c.fecha ? String(c.fecha).split('T')[0] : '';
                        const isPastD    = !!fechaNormD && fechaNormD < today;
                        return (
                          <tr key={c.id} className={`transition-colors hover:bg-blue-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                            <td className="px-4 py-3 font-bold text-sm text-[#1a1a2e]">{c.nombre}</td>
                            <td className="px-4 py-3">
                              {c.telefono ? (
                                <button onClick={() => setHistoryPhone(c.telefono)}
                                  className="bg-green-50 text-green-700 border-0 px-2.5 py-1 rounded-lg cursor-pointer text-xs font-bold">
                                  📞 {fmtPhone(c.telefono)}
                                </button>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{fmtDate(c.fecha)}</td>
                            <td className="px-4 py-3 text-sm font-bold text-[#1a1a2e] whitespace-nowrap">{fmtTime(c.hora)}</td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px] truncate">
                              {c.motivo || <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-bold px-2 py-0.5 rounded ${c.source === 'whatsapp' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                                {c.source === 'whatsapp' ? '📱 WA' : '✏️ Manual'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${st.badge}`}>
                                {st.icon} {st.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1.5">
                                {isPastD ? (
                                  <>
                                    {c.status !== 'atendida' && (
                                      <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'atendida')}
                                        className="bg-blue-50 text-blue-700 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm disabled:opacity-50">
                                        🏥
                                      </button>
                                    )}
                                    {c.status !== 'ausente' && (
                                      <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'ausente')}
                                        className="bg-gray-100 text-gray-500 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm disabled:opacity-50">
                                        👻
                                      </button>
                                    )}
                                  </>
                                ) : c.status === 'pendiente' ? (
                                  <>
                                    <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'confirmada')}
                                      className="bg-green-50 text-green-700 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm disabled:opacity-50">
                                      ✅
                                    </button>
                                    <button disabled={updating === c.id} onClick={() => changeStatus(c.id, 'cancelada')}
                                      className="bg-red-50 text-red-500 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm disabled:opacity-50">
                                      ❌
                                    </button>
                                  </>
                                ) : null}
                                <button onClick={() => setEditing(c)}
                                  className="bg-indigo-50 text-indigo-700 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm">
                                  ✏️
                                </button>
                                <button onClick={() => setConfirmDelete(c.id)}
                                  className="bg-red-50 text-red-500 border-0 px-2 py-1.5 rounded-lg cursor-pointer text-sm">
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
              </>)}
            </div>
          )}

        </>)}
      </div>

      {/* ── Modales ───────────────────────────────────────────────────────── */}
      {showAdd && (
        <CitaModal
          cita={null}
          defaults={prefillSlot}
          onClose={() => { setShowAdd(false); setPrefillSlot(null); }}
          onSaved={load}
        />
      )}
      {editing && (
        <CitaModal cita={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
      {historyPhone && (
        <PatientHistoryModal telefono={historyPhone} onClose={() => setHistoryPhone(null)} />
      )}
      {showBlockedModal && (
        <BlockedSlotsModal onClose={() => setShowBlockedModal(false)} onSaved={load} />
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1002] p-4">
          <div className="bg-white rounded-2xl p-7 w-full max-w-sm shadow-2xl text-center">
            <div className="text-5xl mb-3">🗑️</div>
            <h3 className="text-lg font-bold mb-2">¿Eliminar esta cita?</h3>
            <p className="text-gray-500 text-sm mb-5">Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 font-semibold cursor-pointer bg-white text-gray-700">
                Cancelar
              </button>
              <button onClick={() => deleteOne(confirmDelete)}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold cursor-pointer border-0">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MURO DE PAGO — Overlay de suscripción inactiva
          z-[2000] garantiza que queda por encima de todos los modales (z-[1002]).
          Se renderiza solo cuando subscriptionStatus ya se conoce (≠ null).
          Los administradores nunca ven este overlay (role === 'admin').
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Estado de verificación inicial — pantalla de carga rápida */}
      {subscriptionStatus === null && (
        <div className="fixed inset-0 z-[2000] bg-white flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: 'linear-gradient(135deg, #25d366, #20b858)' }}>
            🏥
          </div>
          <svg className="animate-spin h-6 w-6 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-sm text-gray-400 font-medium">Verificando suscripción...</p>
        </div>
      )}

      {/* Muro de pago — se activa solo cuando el status es definitivo y está bloqueado */}
      {subscriptionStatus !== null && isBlocked && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.82)', backdropFilter: 'blur(6px)' }}>
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">

            {/* Encabezado del card con gradiente */}
            <div className="px-8 pt-8 pb-6 text-center"
              style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}>
              <div className="w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center text-4xl"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)', boxShadow: '0 8px 24px rgba(99,102,241,.5)' }}>
                💳
              </div>
              <h2 className="text-2xl font-extrabold text-white mb-2">
                Suscripción Inactiva
              </h2>
              {subscriptionStatus === 'past_due' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(251,191,36,.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' }}>
                  ⚠️ Pago pendiente de renovación
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(248,113,113,.15)', color: '#f87171', border: '1px solid rgba(248,113,113,.3)' }}>
                  🔒 Cuenta suspendida
                </span>
              )}
            </div>

            {/* Cuerpo del card */}
            <div className="px-8 py-7">
              <p className="text-gray-600 text-sm leading-relaxed text-center mb-7">
                Tu acceso al panel de control y a la automatización de citas se encuentra suspendido. Activa tu mensualidad para continuar operando.
              </p>

              {/* Botón de checkout */}
              <button
                onClick={handleCheckout}
                disabled={loadingCheckout}
                className="w-full py-4 rounded-2xl text-white font-bold text-base cursor-pointer border-0 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)', boxShadow: '0 8px 24px rgba(99,102,241,.4)' }}>
                {loadingCheckout ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Generando enlace de pago...
                  </span>
                ) : (
                  '💳 Activar Suscripción Mensual'
                )}
              </button>

              {/* Sellos de confianza */}
              <div className="flex items-center justify-center gap-4 mt-5">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Pago seguro con Stripe
                </div>
                <div className="w-px h-4 bg-gray-200" />
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Activa de inmediato
                </div>
              </div>

              {/* Logout link */}
              <div className="text-center mt-6">
                <button onClick={logout}
                  className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-0 underline transition-colors">
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
