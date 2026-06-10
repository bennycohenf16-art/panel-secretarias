import React, { useEffect, useState, useCallback } from 'react';
import API_BASE from '../utils/apiBase';

export default function BotStatusWidget({ token }) {
  const [status,       setStatus]       = useState(null);
  const [qr,           setQr]           = useState(null);
  const [error,        setError]        = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMsg, setReconnectMsg] = useState('');

  const check = useCallback(async (cancelled, timerRef) => {
    try {
      const r = await fetch(API_BASE + '/api/bot-status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (cancelled.current) return;
      if (!r.ok) { setError(true); return; }
      const data = await r.json();
      setError(false);
      setStatus(data.status);
      setQr(data.qr || null);
      if (data.status !== 'connected') {
        timerRef.current = setTimeout(() => check(cancelled, timerRef), 8000);
      }
    } catch {
      if (!cancelled.current) setError(true);
    }
  }, [token]);

  useEffect(() => {
    const cancelled = { current: false };
    const timerRef  = { current: null };
    check(cancelled, timerRef);
    return () => {
      cancelled.current = true;
      clearTimeout(timerRef.current);
    };
  }, [check]);

  const forceReconnect = async () => {
    setReconnecting(true);
    setReconnectMsg('');
    try {
      const r = await fetch(API_BASE + '/api/bot-reconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setReconnectMsg(d.error || 'Error al reconectar');
      } else {
        setReconnectMsg('Reiniciando… el QR aparecerá en unos segundos.');
        setQr(null);
        // Empezar a sondear de inmediato para captar el nuevo QR
        setTimeout(() => {
          const cancelled = { current: false };
          const timerRef  = { current: null };
          check(cancelled, timerRef);
        }, 5000);
      }
    } catch {
      setReconnectMsg('Error de conexión');
    }
    setReconnecting(false);
  };

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
            <div className="text-xs text-gray-400 mt-0.5 mb-3">
              Sin sesión activa. Presiona "Forzar reconexión" para generar un código QR.
            </div>
          )}

          {reconnectMsg && (
            <div className="text-xs mt-2 px-3 py-2 rounded-lg"
              style={{ background: reconnectMsg.includes('Error') ? '#fff0f0' : '#f0fdf4', color: reconnectMsg.includes('Error') ? '#c62828' : '#166534' }}>
              {reconnectMsg}
            </div>
          )}

          <button
            onClick={forceReconnect}
            disabled={reconnecting}
            className="mt-3 w-full text-xs font-semibold py-2 px-3 rounded-lg border transition-colors"
            style={{
              background: reconnecting ? '#f3f4f6' : '#fef2f2',
              border: '1.5px solid #fecaca',
              color: reconnecting ? '#9ca3af' : '#dc2626',
              cursor: reconnecting ? 'default' : 'pointer'
            }}
          >
            {reconnecting ? 'Reconectando…' : '🔄 Forzar reconexión'}
          </button>
        </div>
      </div>
    </div>
  );
}
