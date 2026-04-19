import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Logo } from '../components/primitives';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/settings';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, remember);
      navigate(from);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-brand">
        <Logo size={44}/>
        <div>
          <div className="login-hero">
            Trading signals <em>so sweet</em>, you'll forget the chart.
          </div>
          <div className="login-features">
            <div className="login-feature"><span className="login-feature-dot"/> 4-level OBD analysis · 100ms WebSocket</div>
            <div className="login-feature"><span className="login-feature-dot"/> Claude confirms every signal with SL/TP</div>
            <div className="login-feature"><span className="login-feature-dot"/> Auto-trading + Telegram notifications</div>
            <div className="login-feature"><span className="login-feature-dot"/> Backtest on real accumulated data</div>
          </div>
        </div>
        <div style={{display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-mono)'}}>
          <span>v2.3.1</span>
          <span>·</span>
          <span>binance · bybit</span>
          <span>·</span>
          <span>claude-sonnet-4</span>
        </div>
      </div>

      <div className="login-form-col">
        <form className="login-form" onSubmit={handleSubmit}>
          <h2>Welcome back</h2>
          <p>Sign in to your Finik account</p>

          {error && (
            <div style={{
              background: 'color-mix(in srgb, var(--short) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--short) 30%, transparent)',
              color: 'var(--short)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <div className="field" style={{marginBottom: 14}}>
            <label className="label">Username</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field" style={{marginBottom: 14}}>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, fontSize: 12}}>
            <label style={{display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)'}}>
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/> Remember me
            </label>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="submit-btn buy"
            style={{background: 'var(--primary)', opacity: loading ? 0.6 : 1}}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
