import React, { useState } from 'react';
import API_BASE from '../utils/apiBase';

export default function ForcePasswordModal({ token, onPasswordChanged }) {
  const [current,  setCurrent]  = useState('');
  const [next,     setNext]     = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const fi = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1.5px solid #ddd', fontSize: 14, outline: 'none'
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (next.length < 6)  { setError('La nueva contraseña debe tener al menos 6 caracteres.'); return; }
    setSaving(true);
    try {
      const r = await fetch(API_BASE + '/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Error al cambiar contraseña'); setSaving(false); return; }
      onPasswordChanged();
    } catch {
      setError('Error de conexión');
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 16
    }}>
      <div style={{
        background: '#fff', borderRadius: 18, padding: 36, width: 420, maxWidth: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1a1a2e', marginBottom: 8 }}>
            Actualiza tu contraseña
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
            Por razones de seguridad, debes actualizar tu contraseña de fábrica antes de continuar.
            No podrás cerrar este diálogo hasta completar el cambio.
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fff0f0', border: '1px solid #ffcdd2', color: '#c62828',
            padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 14
          }}>{error}</div>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Contraseña actual
            </label>
            <input required type="password" value={current} onChange={e => setCurrent(e.target.value)}
              placeholder="Contraseña de fábrica" style={fi} autoFocus />
          </div>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Nueva contraseña
            </label>
            <input required type="password" value={next} onChange={e => setNext(e.target.value)}
              placeholder="Mínimo 6 caracteres" style={fi} />
          </div>
          <div>
            <label style={{ fontWeight: 600, fontSize: 13, display: 'block', marginBottom: 5, color: '#444' }}>
              Confirmar nueva contraseña
            </label>
            <input required type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repite la nueva contraseña" style={fi} />
          </div>
          <button type="submit" disabled={saving} style={{
            marginTop: 4, padding: '12px', borderRadius: 10, border: 'none',
            background: saving ? '#ccc' : 'linear-gradient(135deg,#1a1a2e,#16213e)',
            color: '#fff', fontWeight: 700, fontSize: 15,
            cursor: saving ? 'default' : 'pointer',
            boxShadow: saving ? 'none' : '0 4px 14px rgba(26,26,46,.3)'
          }}>
            {saving ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}
