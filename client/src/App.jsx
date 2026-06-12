import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import AdminDashboard from './pages/AdminDashboard';

function decodeJWT(t) {
  try { return JSON.parse(atob((t || '').split('.')[1])); } catch { return {}; }
}

function PrivateRoute({ children }) {
  return localStorage.getItem('panel_token') ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const token = localStorage.getItem('panel_token');
  if (!token) return <Navigate to="/login" replace />;
  const role = decodeJWT(token)?.role || 'doctor';
  return role === 'admin' ? children : <Navigate to="/" replace />;
}

// ── Banner preventivo — visible cuando el pago falló pero aún hay periodo de gracia ──
function GracePeriodBanner() {
  const { subscriptionStatus, gracePeriodUntil } = useAuth();
  const nav = useNavigate();
  const token = localStorage.getItem('panel_token');
  const role  = decodeJWT(token)?.role || 'doctor';

  // Solo para doctores autenticados con status past_due
  if (!token || role === 'admin' || subscriptionStatus !== 'past_due') return null;

  const diasRestantes = gracePeriodUntil
    ? Math.max(0, Math.ceil((new Date(gracePeriodUntil) - new Date()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div
      className="sticky top-0 z-[1500] flex items-center justify-between gap-3 px-4 py-3 text-sm font-semibold shadow-md"
      style={{ background: 'linear-gradient(90deg, #d97706, #b45309)', color: '#fff' }}
    >
      <span className="leading-snug">
        ⚠️ <strong>Aviso Importante:</strong> Hubo un problema con el cobro de tu mensualidad.
        Tienes <strong>{diasRestantes} día{diasRestantes !== 1 ? 's' : ''}</strong> antes de que
        tu bot y panel se suspendan automáticamente.
      </span>
      <button
        onClick={() => nav('/billing')}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-amber-700 font-bold text-xs cursor-pointer border-0 transition-colors hover:bg-amber-50"
      >
        Ir a Facturación →
      </button>
    </div>
  );
}

// ── Overlay de bloqueo total — visible cuando la cuenta está suspendida ──
function BlockedOverlay() {
  const nav = useNavigate();
  const logout = () => { localStorage.clear(); nav('/login'); };

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(8px)' }}
    >
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">

        {/* Cabecera */}
        <div
          className="px-8 pt-8 pb-6 text-center"
          style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #450a0a 100%)' }}
        >
          <div
            className="w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center text-4xl"
            style={{
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              boxShadow: '0 8px 24px rgba(220,38,38,.5)'
            }}
          >
            🛑
          </div>
          <h2 className="text-2xl font-extrabold text-white mb-2">
            Cuenta Suspendida por Falta de Pago
          </h2>
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
            style={{
              background: 'rgba(248,113,113,.2)',
              color: '#fca5a5',
              border: '1px solid rgba(248,113,113,.3)'
            }}
          >
            🔒 Servicio desactivado
          </span>
        </div>

        {/* Cuerpo */}
        <div className="px-8 py-7">
          <p className="text-gray-600 text-sm leading-relaxed text-center mb-7">
            Tu bot de WhatsApp y el acceso a la agenda médica han sido desactivados.
            Para reactivar tu servicio de inmediato de forma automática, actualiza tu método de pago.
          </p>

          <button
            onClick={() => nav('/billing')}
            className="w-full py-4 rounded-2xl text-white font-bold text-base cursor-pointer border-0 transition-opacity mb-4"
            style={{
              background: 'linear-gradient(135deg, #dc2626, #ef4444)',
              boxShadow: '0 8px 24px rgba(220,38,38,.4)'
            }}
          >
            💳 Actualizar Tarjeta / Pagar
          </button>

          <div className="text-center">
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-0 underline transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout global: inyecta banner + overlay en todas las rutas protegidas ──
function AppLayout({ children }) {
  const { subscriptionStatus } = useAuth();
  const location = useLocation();
  const token = localStorage.getItem('panel_token');
  const role  = decodeJWT(token)?.role || 'doctor';

  const isSuspended = !!token && role !== 'admin' && subscriptionStatus === 'blocked';
  const isOnBilling = location.pathname === '/billing';

  return (
    <>
      <GracePeriodBanner />
      {children}
      {isSuspended && !isOnBilling && <BlockedOverlay />}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout>
          <Routes>
            <Route path="/login"   element={<Login />} />
            <Route path="/"        element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
            <Route path="/billing" element={<PrivateRoute><Billing /></PrivateRoute>} />
            <Route path="/admin/subscriptions" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="*"        element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      </AuthProvider>
    </BrowserRouter>
  );
}
