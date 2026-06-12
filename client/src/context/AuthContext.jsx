import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import API_BASE from '../utils/apiBase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Inicializa desde localStorage para que el primer render sea síncrono y sin parpadeo
  const [subscriptionStatus, setSubscriptionStatus] = useState(
    () => localStorage.getItem('panel_sub_status') || null
  );
  const [gracePeriodUntil, setGracePeriodUntil] = useState(
    () => localStorage.getItem('panel_grace_until') || null
  );

  const refreshSubscription = useCallback(async () => {
    const token = localStorage.getItem('panel_token');
    if (!token) return;
    try {
      const r = await fetch(`${API_BASE}/api/billing/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.status === 401) {
        localStorage.clear();
        window.location.href = '/login';
        return;
      }
      const d = await r.json();
      const status = d.subscription_status || 'active';
      const grace  = d.grace_period_until  || null;
      setSubscriptionStatus(status);
      setGracePeriodUntil(grace);
      localStorage.setItem('panel_sub_status', status);
      localStorage.setItem('panel_grace_until', grace || '');
    } catch {
      // Falla de red — conserva el estado actual para no penalizar usuarios activos
    }
  }, []);

  // Refresca al montar para tener datos frescos del servidor
  useEffect(() => {
    refreshSubscription();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{ subscriptionStatus, gracePeriodUntil, refreshSubscription }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
