import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error); setLoading(false); return; }
      localStorage.setItem('panel_token', data.token);
      localStorage.setItem('panel_name', data.name);
      nav('/');
    } catch {
      setError('Error de conexión');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}>

      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-8 sm:p-10">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl shadow-lg"
            style={{ background: 'linear-gradient(135deg, #1a1a2e, #25d366)', boxShadow: '0 8px 24px rgba(37,211,102,.3)' }}>
            🏥
          </div>
          <h1 className="text-2xl font-extrabold text-[#1a1a2e]">Panel Médico</h1>
          <p className="text-gray-400 text-sm mt-1">Sistema de gestión de citas</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm mb-5 text-center">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Correo electrónico
            </label>
            <input
              type="email" required autoFocus
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="secretaria@clinica.com"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 text-sm focus:border-[#25d366] focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Contraseña
            </label>
            <input
              type="password" required
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 text-sm focus:border-[#25d366] focus:outline-none transition-colors"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="mt-2 py-3.5 rounded-xl text-white font-bold text-base transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={loading ? { background: '#ccc' } : {
              background: 'linear-gradient(135deg, #25d366, #20b858)',
              boxShadow: '0 4px 16px rgba(37,211,102,.4)'
            }}
          >
            {loading ? 'Verificando...' : 'Iniciar Sesión'}
          </button>
        </form>

        <p className="text-center text-gray-300 text-xs mt-6">
          Panel exclusivo para secretarias médicas
        </p>
      </div>
    </div>
  );
}
