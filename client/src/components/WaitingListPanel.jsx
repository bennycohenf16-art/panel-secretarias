import React, { useEffect, useState } from 'react';

export default function WaitingListPanel({ token }) {
  const [lista, setLista]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [nombre, setNombre]     = useState('');
  const [telefono, setTelefono] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const api = (url, opts = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

  const load = async () => {
    setLoading(true);
    const r = await api('/api/waiting-list');
    setLista(await r.json());
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    if (!nombre.trim() || !telefono.trim()) return;
    setSaving(true);
    setError('');
    const r = await api('/api/waiting-list', {
      method: 'POST',
      body: JSON.stringify({ nombre: nombre.trim(), telefono: telefono.trim() })
    });
    if (r.ok) {
      setNombre('');
      setTelefono('');
      await load();
    } else {
      const data = await r.json();
      setError(data.error || 'Error al agregar');
    }
    setSaving(false);
  };

  const remove = async (id) => {
    await api(`/api/waiting-list/${id}`, { method: 'DELETE' });
    setLista(prev => prev.filter(p => p.id !== id));
  };

  const fmtDate = (ts) =>
    new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4">

      {/* Formulario de alta manual */}
      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: '3px solid #f59e0b' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-gray-700">Agregar paciente manualmente</div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-amber-50">📋</div>
        </div>
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Nombre completo"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none"
          />
          <input
            value={telefono}
            onChange={e => setTelefono(e.target.value)}
            placeholder="Teléfono (ej: 5215551234567)"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none"
          />
          <button type="submit" disabled={saving || !nombre.trim() || !telefono.trim()}
            className="px-5 py-2 rounded-xl text-white font-bold text-sm border-0 cursor-pointer disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
            {saving ? '...' : '+ Agregar'}
          </button>
        </form>
        {error && <div className="mt-2 text-xs text-red-500 font-semibold">{error}</div>}
        <div className="mt-3 text-xs text-gray-400">
          El bot también agrega pacientes automáticamente cuando no hay horario disponible.
        </div>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-5 py-3.5"
          style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
          <h2 className="text-white font-bold text-sm">⏳ Lista de Espera</h2>
          <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,.15)' }}>
            {lista.length} {lista.length === 1 ? 'paciente' : 'pacientes'}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400">
            <div className="text-3xl mb-2">⏳</div>
            <p className="text-sm">Cargando...</p>
          </div>
        ) : lista.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <div className="text-4xl mb-2">📭</div>
            <p className="text-sm font-semibold text-gray-500">La lista de espera está vacía.</p>
            <p className="text-xs mt-1">Los pacientes aparecen aquí cuando no encuentran horario.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {lista.map((p, i) => (
              <div key={p.id}
                className={`flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-amber-50
                  ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: '#f59e0b' }}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1a1a2e] truncate">{p.nombre}</div>
                    <div className="text-xs text-gray-400">
                      📞 +{p.telefono}
                      {p.bot_slug && <span className="ml-2 text-gray-300">· via bot</span>}
                      <span className="ml-2">· {fmtDate(p.created_at)}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => remove(p.id)}
                  className="ml-3 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 border-0 cursor-pointer text-sm font-bold shrink-0">
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
