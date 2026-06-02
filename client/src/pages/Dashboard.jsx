import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import CitaModal from '../components/CitaModal';
import PatientHistoryModal from '../components/PatientHistoryModal';
import BotStatusWidget from '../components/BotStatusWidget';
import WaitingListPanel from '../components/WaitingListPanel';
import BlockedSlotsModal from '../components/BlockedSlotsModal';

// ── Constantes ────────────────────────────────────────────────────────────────

const DOW_NAMES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

const STATUS = {
  pendiente:  { label: 'Pendiente',  icon: '⏳', badge: 'bg-orange-100 text-orange-700' },
  confirmada: { label: 'Confirmada', icon: '✅', badge: 'bg-green-100 text-green-700' },
  cancelada:  { label: 'Cancelada',  icon: '❌', badge: 'bg-red-100 text-red-700' },
};

const TIME_SLOTS = [];
for (let h = 9; h <= 18; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2,'0')}:00`);
  if (h < 18) TIME_SLOTS.push(`${String(h).padStart(2,'0')}:30`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
const fmtPhone = (t) => {
  const d = (t || '').replace(/\D/g, '');
  if (!d) return '';
  return `+52 ${d.slice(-10)}`;
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

function CitaCard({ cita, updating, changeStatus, onEdit, onDelete, onPhone }) {
  const isPending   = cita.status === 'pendiente';
  const isConfirmed = cita.status === 'confirmada';
  const accentColor = isConfirmed ? '#34d399' : isPending ? '#fbbf24' : '#f87171';
  const bgColor     = isConfirmed ? '#f0fdf4' : isPending ? '#fffbeb' : '#fef2f2';

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
        {isPending && (
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
      {/* Banner: día completo bloqueado */}
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

      {/* Cuadrícula */}
      <div style={{ paddingBottom: 8 }}>
        {TIME_SLOTS.map((slot) => {
          const citas      = citasAtSlot(slot);
          const bloqueados = blockedAtSlot(slot);
          const hasContent = citas.length > 0 || bloqueados.length > 0;
          const isHour     = slot.endsWith(':00');

          return (
            <div key={slot} className="flex"
              style={{ minHeight: hasContent ? 'auto' : 56, borderBottom: `1px solid ${isHour ? '#f3f4f6' : '#fafafa'}` }}>

              {/* Columna de hora */}
              <div className="flex-none flex items-start justify-end pt-3 pr-3"
                style={{ width: 72 }}>
                <span style={{ fontSize: 11, fontWeight: isHour ? 600 : 400, color: isHour ? '#6b7280' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>
                  {slot}
                </span>
              </div>

              {/* Línea vertical */}
              <div className="flex-none mt-2" style={{ width:1, background: isHour ? '#e5e7eb' : '#f3f4f6' }} />

              {/* Área de contenido */}
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
                {!hasContent && !isDayBlocked && (
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

// ── Analytics ─────────────────────────────────────────────────────────────────

function AnalyticsContent({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="py-16 text-center text-gray-400">
      <div className="text-4xl mb-2">⏳</div><p>Cargando analíticas...</p>
    </div>
  );
  if (!data) return <div className="py-16 text-center text-gray-400">Sin datos disponibles.</div>;

  const totalSrc = data.bySource.reduce((s, r) => s + r.count, 0);
  const botCount = (data.bySource.find(r => r.source === 'whatsapp')?.count) || 0;
  const autoPct  = totalSrc > 0 ? Math.round(botCount / totalSrc * 100) : 0;

  const totalSt = data.byStatus.reduce((s, r) => s + r.count, 0);
  const stMap   = Object.fromEntries(data.byStatus.map(r => [r.status, r.count]));
  const stRows  = [
    { label: 'Confirmadas', key: 'confirmada', color: '#22c55e' },
    { label: 'Pendientes',  key: 'pendiente',  color: '#f59e0b' },
    { label: 'Canceladas',  key: 'cancelada',  color: '#ef4444' },
  ];

  const maxDow = data.byDayOfWeek.reduce((m, r) => Math.max(m, r.count), 1);
  const dowMap = Object.fromEntries(data.byDayOfWeek.map(r => [r.dow, r.count]));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: '3px solid #6366f1' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-3xl font-extrabold text-indigo-600">{autoPct}%</div>
            <div className="text-gray-500 text-sm mt-0.5">Citas automatizadas (WhatsApp)</div>
          </div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-indigo-50">🤖</div>
        </div>
        <Bar pct={autoPct} color="#6366f1" />
        <div className="text-xs text-gray-400 mt-2">{botCount} de {totalSrc} en los últimos 30 días</div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: '3px solid #22c55e' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-gray-700">Distribución por estado</div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-green-50">📊</div>
        </div>
        <div className="space-y-3">
          {stRows.map(({ label, key, color }) => {
            const cnt = stMap[key] || 0;
            const pct = totalSt > 0 ? Math.round(cnt / totalSt * 100) : 0;
            return (
              <div key={key}>
                <div className="flex justify-between text-xs font-semibold mb-1" style={{ color }}>
                  <span>{label}</span><span>{cnt} ({pct}%)</span>
                </div>
                <Bar pct={pct} color={color} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: '3px solid #6366f1' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-gray-700">Demanda por día de semana</div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-indigo-50">📅</div>
        </div>
        <div className="space-y-2">
          {DOW_NAMES.map((name, dow) => {
            const cnt  = dowMap[dow] || 0;
            const pct  = Math.round(cnt / maxDow * 100);
            const isMax = cnt === maxDow && maxDow > 0;
            return (
              <div key={dow}>
                <div className="flex justify-between text-xs font-semibold mb-1 text-gray-600">
                  <span>{name}</span><span>{cnt}</span>
                </div>
                <Bar pct={pct} color={isMax ? '#6366f1' : '#94a3b8'} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const nav  = useNavigate();
  const name  = localStorage.getItem('panel_name') || 'Doctor';
  const token = localStorage.getItem('panel_token');

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

  const api = useCallback((url, opts = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  , [token]);

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
  const pending   = appointments.filter(a => a.status === 'pendiente').length;
  const confirmed = appointments.filter(a => a.status === 'confirmada').length;

  const statCards = [
    { label: fecha ? 'Citas del día' : 'Total citas', value: appointments.length, color: '#1a1a2e', bg: '#f0f4ff', icon: '📅' },
    { label: 'Pendientes',  value: pending,    color: '#e65100', bg: '#fff3e0', icon: '⏳' },
    { label: 'Confirmadas', value: confirmed,  color: '#2e7d32', bg: '#e8f5e9', icon: '✅' },
    { label: 'Este mes',    value: monthTotal, color: '#6a1b9a', bg: '#f3e5f5', icon: '📊' },
  ];

  const dateLabel = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-screen bg-gray-100">

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
              {[['agenda','📋 Agenda'],['analytics','📈 Rendimiento'],['espera','⏳ Lista de Espera']].map(([key,label]) => (
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
        {[['agenda','📋 Agenda'],['analytics','📈 Rendimiento'],['espera','⏳ Espera']].map(([key,label]) => (
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

        {tab === 'analytics' ? <AnalyticsContent token={token} /> :
         tab === 'espera'    ? <WaitingListPanel token={token} /> : (<>

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

          {/* ── Barra de controles ─────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl p-4 mb-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

              {/* Fecha + toggle de vista */}
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
                {/* Toggle de vista */}
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

              {/* Acciones */}
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

          {/* ── Vista Calendario ─────────────────────────────────────────── */}
          {vista === 'calendario' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* Cabecera del calendario */}
              <div className="flex items-center justify-between px-5 py-3.5"
                style={{ background:'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)' }}>
                <div className="flex items-center gap-2">
                  {/* Navegación por día */}
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
                    {appointments.length} {appointments.length === 1 ? 'cita' : 'citas'}
                  </span>
                  {/* Leyenda */}
                  <div className="hidden sm:flex items-center gap-3 ml-2">
                    {[['#34d399','Confirmada'],['#fbbf24','Pendiente'],['#f87171','Cancelada']].map(([c,l]) => (
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
                appointments={appointments}
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

          {/* ── Vista Tabla ───────────────────────────────────────────────── */}
          {vista === 'tabla' && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* Cabecera */}
              <div className="flex justify-between items-center px-5 py-3.5"
                style={{ background:'linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)' }}>
                <h2 className="text-white font-bold text-sm">
                  📋 Citas {fecha ? `— ${fmtDate(fecha)}` : '— Todas'}
                </h2>
                <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
                  style={{ background:'rgba(255,255,255,.15)' }}>
                  {appointments.length} {appointments.length === 1 ? 'cita' : 'citas'}
                </span>
              </div>

              {loading ? (
                <div className="py-16 text-center text-gray-400">
                  <div className="text-4xl mb-2">⏳</div><p>Cargando citas...</p>
                </div>
              ) : appointments.length === 0 ? (
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
                  {appointments.map(c => {
                    const st = STATUS[c.status] || STATUS.pendiente;
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
                          {c.status === 'pendiente' && (
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
                          )}
                          {c.status !== 'pendiente' && <div className="flex-1" />}
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
                      {appointments.map((c, i) => {
                        const st = STATUS[c.status] || STATUS.pendiente;
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
                                {c.status === 'pendiente' && (
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
                                )}
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
    </div>
  );
}
