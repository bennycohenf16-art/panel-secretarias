import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import API_BASE from '../utils/apiBase';
import { useAuth } from '../context/AuthContext';

export default function Billing() {
  const nav = useNavigate();
  const { subscriptionStatus, gracePeriodUntil, refreshSubscription } = useAuth();
  const [loading, setLoading] = useState(false);
  const token = localStorage.getItem('panel_token');

  // Refresca el status si el usuario vuelve desde Stripe con ?payment=success
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('payment')) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (params.get('payment') === 'success') {
      setTimeout(refreshSubscription, 2500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      if (d.url) {
        window.location.href = d.url;
      } else {
        alert(d.error || 'No se pudo generar el enlace de pago. Intenta de nuevo.');
        setLoading(false);
      }
    } catch {
      alert('Error de red. Verifica tu conexión e intenta de nuevo.');
      setLoading(false);
    }
  };

  const diasRestantes = gracePeriodUntil
    ? Math.max(0, Math.ceil((new Date(gracePeriodUntil) - new Date()) / (1000 * 60 * 60 * 24)))
    : null;

  const isActive = subscriptionStatus === 'active';

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center"
          style={{ background: isActive
            ? 'linear-gradient(135deg, #064e3b, #065f46)'
            : 'linear-gradient(135deg, #0f172a, #1e1b4b)' }}>
          <div className="w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center text-4xl"
            style={{ background: isActive
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : subscriptionStatus === 'blocked'
                ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : 'linear-gradient(135deg, #d97706, #f59e0b)',
              boxShadow: isActive
                ? '0 8px 24px rgba(16,185,129,.5)'
                : subscriptionStatus === 'blocked'
                  ? '0 8px 24px rgba(220,38,38,.5)'
                  : '0 8px 24px rgba(217,119,6,.5)' }}>
            {isActive ? '✅' : subscriptionStatus === 'blocked' ? '🛑' : '💳'}
          </div>
          <h2 className="text-2xl font-extrabold text-white mb-2">
            {isActive ? 'Suscripción Activa' : subscriptionStatus === 'blocked' ? 'Cuenta Suspendida' : 'Facturación'}
          </h2>
          {subscriptionStatus === 'past_due' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: 'rgba(251,191,36,.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' }}>
              ⚠️ Pago pendiente — {diasRestantes !== null ? `${diasRestantes} día${diasRestantes !== 1 ? 's' : ''} de gracia` : 'periodo de gracia activo'}
            </span>
          )}
          {subscriptionStatus === 'blocked' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: 'rgba(248,113,113,.2)', color: '#fca5a5', border: '1px solid rgba(248,113,113,.3)' }}>
              🔒 Servicio suspendido
            </span>
          )}
          {isActive && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
              style={{ background: 'rgba(52,211,153,.15)', color: '#6ee7b7', border: '1px solid rgba(52,211,153,.3)' }}>
              ✅ Al día
            </span>
          )}
        </div>

        {/* Body */}
        <div className="px-8 py-7">
          {isActive ? (
            <p className="text-gray-600 text-sm leading-relaxed text-center mb-7">
              Tu suscripción está activa. Tu bot de WhatsApp y la agenda médica están operando con normalidad.
            </p>
          ) : (
            <p className="text-gray-600 text-sm leading-relaxed text-center mb-7">
              {subscriptionStatus === 'blocked'
                ? 'Tu bot de WhatsApp y el acceso a la agenda médica han sido desactivados por falta de pago. Para reactivar tu servicio de inmediato, actualiza tu método de pago.'
                : 'Hubo un problema con el cobro de tu mensualidad. Actualiza tu método de pago para evitar la suspensión del servicio.'}
            </p>
          )}

          {!isActive && (
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full py-4 rounded-2xl text-white font-bold text-base cursor-pointer border-0 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed mb-4"
              style={{ background: subscriptionStatus === 'blocked'
                ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : 'linear-gradient(135deg, #d97706, #f59e0b)',
                boxShadow: subscriptionStatus === 'blocked'
                  ? '0 8px 24px rgba(220,38,38,.4)'
                  : '0 8px 24px rgba(217,119,6,.4)' }}>
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Generando enlace de pago...
                </span>
              ) : '💳 Actualizar Tarjeta / Pagar'}
            </button>
          )}

          {/* Sellos de confianza */}
          <div className="flex items-center justify-center gap-4 mb-6">
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

          <button onClick={() => nav('/')}
            className="w-full py-2.5 rounded-xl text-gray-600 text-sm font-semibold cursor-pointer border border-gray-200 bg-transparent hover:bg-gray-50 transition-colors">
            ← Volver al Panel
          </button>
        </div>
      </div>
    </div>
  );
}
