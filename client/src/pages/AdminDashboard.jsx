import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API_BASE from '../utils/apiBase';

function StatusBadge({ status, gracePeriodUntil }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Activo
      </span>
    );
  }
  if (status === 'past_due') {
    const dias = gracePeriodUntil
      ? Math.max(0, Math.ceil((new Date(gracePeriodUntil) - new Date()) / (1000 * 60 * 60 * 24)))
      : '?';
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        Periodo gracia ({dias}d)
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        Bloqueado
      </span>
    );
  }
  return <span className="text-xs text-gray-400">{status}</span>;
}

export default function AdminDashboard() {
  const nav = useNavigate();
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('panel_token');
      const r = await fetch(`${API_BASE}/api/admin/subscriptions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 403) { nav('/'); return; }
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      setDoctors(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [nav]);

  useEffect(() => { load(); }, [load]);

  const filtered = doctors.filter(d =>
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.bot_slug?.toLowerCase().includes(search.toLowerCase()) ||
    d.email?.toLowerCase().includes(search.toLowerCase())
  );

  const total    = doctors.length;
  const active   = doctors.filter(d => d.subscription_status === 'active').length;
  const pastDue  = doctors.filter(d => d.subscription_status === 'past_due').length;
  const blocked  = doctors.filter(d => d.subscription_status === 'blocked').length;

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('es-MX') : '—';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Panel de Administración</h1>
          <p className="text-sm text-gray-500 mt-0.5">Vista de suscripciones en tiempo real</p>
        </div>
        <button
          onClick={() => nav('/')}
          className="text-sm text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer border-0"
        >
          ← Volver al panel
        </button>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Métricas */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total',          value: total,   color: 'text-gray-900', bg: 'bg-white' },
            { label: 'Activos',        value: active,  color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Periodo gracia', value: pastDue, color: 'text-amber-700', bg: 'bg-amber-50' },
            { label: 'Bloqueados',     value: blocked, color: 'text-red-700',   bg: 'bg-red-50'   },
          ].map(m => (
            <div key={m.label} className={`${m.bg} rounded-2xl border border-gray-200 px-5 py-4`}>
              <p className="text-sm text-gray-500 font-medium">{m.label}</p>
              <p className={`text-3xl font-extrabold mt-1 ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Buscador */}
        <div className="mb-5">
          <input
            type="text"
            placeholder="Buscar por nombre, email o bot slug..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Tabla */}
        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Cargando...</div>
        )}
        {error && (
          <div className="text-center py-8 text-red-500 text-sm">{error}</div>
        )}
        {!loading && !error && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Nombre</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Email</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Bot Slug</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Estado</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Gracia hasta</th>
                  <th className="px-5 py-3.5 text-left font-semibold text-gray-600">Alta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                      Sin resultados
                    </td>
                  </tr>
                )}
                {filtered.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{d.name}</td>
                    <td className="px-5 py-3.5 text-gray-500">{d.email}</td>
                    <td className="px-5 py-3.5">
                      <code className="bg-gray-100 px-2 py-0.5 rounded text-xs text-gray-700">
                        {d.bot_slug}
                      </code>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge
                        status={d.subscription_status}
                        gracePeriodUntil={d.grace_period_until}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {d.subscription_status === 'past_due' ? fmtDate(d.grace_period_until) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400">{fmtDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Botón de recarga */}
        {!loading && !error && (
          <div className="mt-4 text-right">
            <button
              onClick={load}
              className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-0 underline transition-colors"
            >
              Actualizar datos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
