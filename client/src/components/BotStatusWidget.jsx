import React, { useEffect, useState } from 'react';

export default function BotStatusWidget({ token }) {
  const [status, setStatus] = useState(null); // null = cargando silenciosamente
  const [qr, setQr]         = useState(null);
  const [error, setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer     = null;

    async function check() {
      try {
        const r = await fetch('/api/bot-status', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (cancelled) return;
        if (!r.ok) { setError(true); return; }
        const data = await r.json();
        setError(false);
        setStatus(data.status);
        setQr(data.qr || null);
        // Reintenta cada 8 s solo mientras está desconectado
        if (data.status !== 'connected') {
          timer = setTimeout(check, 8000);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);

  // Carga inicial silenciosa — no ocupa espacio
  if (status === null && !error) return null;

  if (error) return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm mb-4 flex items-center gap-2"
      style={{ borderTop: '3px solid #94a3b8' }}>
      <span>⚪</span>
      <span className="text-gray-400 text-xs">Estado del bot: sin información</span>
    </div>
  );

  if (status === 'connected') return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm mb-4"
      style={{ borderTop: '3px solid #22c55e' }}>
      <div className="flex items-center gap-3">
        <span className="text-xl">🟢</span>
        <div>
          <div className="text-sm font-bold text-green-700">Bot Activo y Conectado</div>
          <div className="text-xs text-gray-400">WhatsApp online — recibiendo mensajes</div>
        </div>
      </div>
    </div>
  );

  // status === 'disconnected'
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm mb-4"
      style={{ borderTop: '3px solid #ef4444' }}>
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">🔴</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-red-600">Bot Desconectado</div>
          {qr ? (
            <>
              <div className="text-xs text-gray-500 mt-0.5 mb-3">
                Escanea con WhatsApp para reconectar. El QR se actualiza automáticamente.
              </div>
              <div className="flex justify-center">
                <img
                  src={qr}
                  alt="Código QR WhatsApp"
                  className="w-44 h-44 sm:w-48 sm:h-48 rounded-xl border border-gray-100"
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-400 mt-0.5">Iniciando conexión, espera unos segundos…</div>
          )}
        </div>
      </div>
    </div>
  );
}
