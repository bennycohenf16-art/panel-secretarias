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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '48px 40px', width: 400, maxWidth: '90vw',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)'
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg, #1a1a2e, #25d366)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(37,211,102,.3)'
          }}>🏥</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginBottom: 4 }}>Panel Médico</h1>
          <p style={{ color: '#888', fontSize: 14 }}>Sistema de gestión de citas</p>
        </div>

        {error && (
          <div style={{
            background: '#fff0f0', border: '1px solid #ffcdd2', color: '#c62828',
            padding: '12px 14px', borderRadius: 10, fontSize: 13, marginBottom: 20, textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 6, color: '#444' }}>
              Correo electrónico
            </label>
            <input
              type="email" required autoFocus
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="secretaria@clinica.com"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                border: '2px solid #eee', fontSize: 14, outline: 'none',
                transition: 'border-color .2s'
              }}
              onFocus={e => e.target.style.borderColor = '#25d366'}
              onBlur={e => e.target.style.borderColor = '#eee'}
            />
          </div>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 6, color: '#444' }}>
              Contraseña
            </label>
            <input
              type="password" required
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                border: '2px solid #eee', fontSize: 14, outline: 'none',
                transition: 'border-color .2s'
              }}
              onFocus={e => e.target.style.borderColor = '#25d366'}
              onBlur={e => e.target.style.borderColor = '#eee'}
            />
          </div>
          <button
            type="submit" disabled={loading}
            style={{
              marginTop: 8, padding: '13px', borderRadius: 10, border: 'none',
              background: loading ? '#ccc' : 'linear-gradient(135deg, #25d366, #20b858)',
              color: '#fff', fontWeight: 700, fontSize: 15, cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(37,211,102,.4)',
              transition: 'all .2s'
            }}
          >
            {loading ? 'Verificando...' : 'Iniciar Sesión'}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: '#bbb', fontSize: 12, marginTop: 24 }}>
          Panel exclusivo para secretarias médicas
        </p>
      </div>
    </div>
  );
}
