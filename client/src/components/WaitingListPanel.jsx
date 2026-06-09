import React, { useEffect, useState } from 'react';

export default function WaitingListPanel({ token }) {
  const [lista, setLista]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [nombre, setNombre]         = useState('');
  const [telefono, setTelefono]     = useState('');
  const [saving, setSaving]         = useState(false);
  const [addMsg, setAddMsg]         = useState('');
  const [offerTarget, setOfferTarget]       = useState(null); // paciente al que se ofrece espacio
  const [offerFecha, setOfferFecha]         = useState('');
  const [offerHora, setOfferHora]           = useState('');
  const [offering, setOffering]             = useState(false);
  const [offerMsg, setOfferMsg]             = useState('');
  const [availableOffers, setAvailableOffers] = useState([]);
  const [loadingOffers, setLoadingOffers]   = useState(false);
  const [rechazadas, setRechazadas]         = useState([]);
  const [loadingRech, setLoadingRech]       = useState(false);

  const api = (url, opts = {}) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });

  const load = async () => {
    setLoading(true);
    const r = await api('/api/waiting-list');
    setLista(await r.json());
    setLoading(false);
  };

  const loadRechazadas = async () => {
    setLoadingRech(true);
    try {
      const r = await api('/api/appointments/rejected');
      const data = await r.json();
      setRechazadas(Array.isArray(data) ? data : []);
    } catch {
      setRechazadas([]);
    } finally {
      setLoadingRech(false);
    }
  };

  useEffect(() => { load(); loadRechazadas(); }, []);

  // Fetch de slots disponibles cada vez que cambia la fecha o el paciente objetivo
  useEffect(() => {
    if (!offerTarget?.doctor_id || !offerFecha) {
      setAvailableOffers([]);
      return;
    }
    setOfferHora('');
    setAvailableOffers([]);
    setLoadingOffers(true);
    api(`/api/appointments/available-slots?doctor_id=${offerTarget.doctor_id}&fecha=${offerFecha}`)
      .then(r => r.json())
      .then(data => {
        let slots = Array.isArray(data.slots) ? data.slots : [];
        const todayISO = new Date().toLocaleDateString('sv'); // YYYY-MM-DD sin desfase
        if (offerFecha === todayISO) {
          const now = new Date();
          const nowMins = now.getHours() * 60 + now.getMinutes();
          slots = slots.filter(s => {
            const [sh, sm] = s.split(':').map(Number);
            return sh * 60 + sm > nowMins;
          });
        }
        setAvailableOffers(slots);
      })
      .catch(() => setAvailableOffers([]))
      .finally(() => setLoadingOffers(false));
  }, [offerFecha, offerTarget?.doctor_id]);

  const add = async (e) => {
    e.preventDefault();
    if (!nombre.trim() || !telefono.trim()) return;
    setSaving(true);
    setAddMsg('');
    const r = await api('/api/waiting-list', {
      method: 'POST',
      body: JSON.stringify({ nombre: nombre.trim(), telefono: telefono.trim() })
    });
    if (r.ok) {
      setNombre('');
      setTelefono('');
      setAddMsg('✅ Paciente guardado en la lista.');
      await load();
      setTimeout(() => setAddMsg(''), 3000);
    } else {
      const data = await r.json();
      setAddMsg(`❌ ${data.error || 'Error al agregar'}`);
    }
    setSaving(false);
  };

  const remove = async (id) => {
    await api(`/api/waiting-list/${id}`, { method: 'DELETE' });
    setLista(prev => prev.filter(p => p.id !== id));
  };

  const openOffer = (p) => {
    setOfferTarget(p);
    setOfferFecha('');
    setOfferHora('');
    setOfferMsg('');
    setAvailableOffers([]);
  };

  const sendOffer = async () => {
    if (!offerFecha || !offerHora) return;
    setOffering(true);
    setOfferMsg('');
    const r = await api('/api/waiting-list/offer', {
      method: 'POST',
      body: JSON.stringify({ waiting_list_id: offerTarget.id, fecha: offerFecha, hora: offerHora.replace(/[^0-9:]/g, '').slice(0, 5) })
    });
    const data = await r.json();
    if (r.ok) {
      setOfferMsg('✅ WhatsApp enviado. El paciente fue removido de la lista.');
      setLista(prev => prev.filter(p => p.id !== offerTarget.id));
      setTimeout(() => { setOfferTarget(null); setOfferMsg(''); }, 2200);
    } else {
      setOfferMsg(`❌ ${data.error || 'Error al enviar'}`);
    }
    setOffering(false);
  };

  const fmtDate = (ts) =>
    new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

  // Parsea fecha_preferida sin desfase de zona horaria.
  // Postgres devuelve DATE como ISO completo ("2025-06-04T06:00:00.000Z");
  // concatenar 'T12:00:00' a eso rompe el parse → extraer solo YYYY-MM-DD primero.
  const fmtFecha = (raw) => {
    if (!raw) return 'Por definir';
    const iso = String(raw).slice(0, 10);           // siempre "YYYY-MM-DD"
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d || isNaN(y + m + d)) return 'Por definir';
    return new Date(y, m - 1, d, 12).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  };

  return (
    <div className="space-y-4">

      {/* Formulario de alta manual */}
      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ borderTop: '3px solid #f59e0b' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-gray-700">Agregar paciente manualmente</div>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl bg-amber-50">📋</div>
        </div>
        <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
          <input value={nombre} onChange={e => setNombre(e.target.value)}
            placeholder="Nombre completo"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none" />
          <input value={telefono} onChange={e => setTelefono(e.target.value)}
            placeholder="Teléfono (ej: 5215551234567)"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none" />
          <button type="submit" disabled={saving || !nombre.trim() || !telefono.trim()}
            className="px-5 py-2 rounded-xl text-white font-bold text-sm border-0 cursor-pointer disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
            {saving ? '...' : '+ Agregar'}
          </button>
        </form>
        {addMsg && (
          <div className={`mt-2 text-xs font-semibold ${addMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>
            {addMsg}
          </div>
        )}
        <div className="mt-3 text-xs text-gray-400">
          El bot también agrega pacientes automáticamente cuando no hay horario disponible.
          Si el paciente reingresa, su fecha de interés se actualiza.
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
                className={`flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-amber-50
                  ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: '#f59e0b' }}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-[#1a1a2e] truncate">{p.nombre}</div>
                    <div className="text-xs text-gray-400 flex flex-wrap gap-x-2">
                      <span>📞 +{p.telefono}</span>
                      {p.fecha_preferida && (
                        <span className="text-amber-600 font-semibold">
                          📅 {fmtFecha(p.fecha_preferida)}
                        </span>
                      )}
                      <span className="text-gray-300">
                        {p.origen === 'bot' ? '· via bot' : '· manual'} · {fmtDate(p.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0 ml-2">
                  <button onClick={() => openOffer(p)}
                    title="Ofrecer espacio liberado"
                    className="px-2.5 py-1.5 rounded-lg border-0 cursor-pointer text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                    <span className="hidden sm:inline">⚡ Ofrecer</span>
                    <span className="sm:hidden">⚡</span>
                  </button>
                  <button onClick={() => remove(p.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-500 border-0 cursor-pointer text-sm font-bold">
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historial de Ofertas Rechazadas */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="flex justify-between items-center px-5 py-3.5"
          style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)' }}>
          <h2 className="text-white font-bold text-sm">🚫 Historial de Ofertas Rechazadas</h2>
          <span className="text-white text-xs font-semibold px-3 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,.15)' }}>
            {rechazadas.length} {rechazadas.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        {loadingRech ? (
          <div className="py-10 text-center text-gray-400">
            <div className="text-3xl mb-2">⏳</div>
            <p className="text-sm">Cargando...</p>
          </div>
        ) : rechazadas.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <div className="text-4xl mb-2">✅</div>
            <p className="text-sm font-semibold text-gray-500">Sin ofertas rechazadas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  {['Paciente', 'Teléfono', 'Fecha ofrecida', 'Hora'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 border-b border-gray-100 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rechazadas.map((rec, i) => (
                  <tr key={rec.id} className={`hover:bg-red-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-4 py-3 font-bold text-sm text-[#1a1a2e]">{rec.nombre || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {rec.telefono ? `+${String(rec.telefono).replace(/\D/g, '')}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{fmtFecha(rec.fecha)}</td>
                    <td className="px-4 py-3 text-sm font-bold text-[#1a1a2e] whitespace-nowrap">
                      {rec.hora ? String(rec.hora).slice(0, 5) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: ofrecer espacio liberado */}
      {offerTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1002] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-3xl mb-2 text-center">⚡</div>
            <h3 className="text-base font-bold text-center mb-0.5">Ofrecer Espacio Liberado</h3>
            <p className="text-sm text-gray-500 text-center mb-5">
              Se enviará un WhatsApp a <strong>{offerTarget.nombre}</strong>
            </p>

            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Fecha del espacio</label>
                <input type="date" value={offerFecha} onChange={e => setOfferFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">Hora disponible</label>
                {!offerFecha ? (
                  <select disabled
                    className="w-full px-3 py-2 rounded-xl border-2 border-gray-100 text-sm text-gray-400 bg-gray-50">
                    <option>Selecciona primero una fecha</option>
                  </select>
                ) : loadingOffers ? (
                  <select disabled
                    className="w-full px-3 py-2 rounded-xl border-2 border-gray-100 text-sm text-gray-400 bg-gray-50">
                    <option>Cargando espacios libres...</option>
                  </select>
                ) : availableOffers.length === 0 ? (
                  <div className="w-full px-3 py-2 rounded-xl border-2 border-amber-200 text-xs font-semibold text-amber-700 bg-amber-50">
                    ⚠️ No hay horarios disponibles para ofrecer en este día
                  </div>
                ) : (
                  <select value={offerHora} onChange={e => setOfferHora(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-gray-100 text-sm focus:border-amber-400 focus:outline-none">
                    <option value="">— Elige un horario —</option>
                    {availableOffers.map(slot => (
                      <option key={slot} value={slot}>{slot} hrs</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {offerMsg && (
              <div className={`text-xs font-semibold mb-4 text-center ${offerMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>
                {offerMsg}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setOfferTarget(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 font-semibold cursor-pointer bg-white text-gray-700 text-sm">
                Cancelar
              </button>
              <button onClick={sendOffer}
                disabled={!offerFecha || !offerHora || availableOffers.length === 0 || loadingOffers || offering}
                className="flex-1 py-3 rounded-xl text-white font-bold cursor-pointer border-0 text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                {offering ? 'Enviando...' : '⚡ Enviar WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
