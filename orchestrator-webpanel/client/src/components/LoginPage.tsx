import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { setJwt } from '../utils/apiClient';

declare const __APP_VERSION__: string;

const BoltMark = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size * 0.55}
    height={size * 0.55}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
  >
    <path d="M13 6.5 8.5 13H12l-1 4.5L15.5 11H12l1-4.5Z" />
  </svg>
);

const Logo = () => (
  <span className="tc-brand">
    <span className="word-group">
      <span className="bracket">&lt;</span>
      <span style={{ display: 'inline-block', color: 'var(--accent)', position: 'relative', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, lineHeight: 1 }}>
        O
        <BoltMark size={13} />
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)', fontSize: 13, lineHeight: 1 }}>
        rchestrator
      </span>
      <span className="bracket">/&gt;</span>
    </span>
    <span className="ver">v{__APP_VERSION__}</span>
  </span>
);

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Proxy auth: on mount, check if proxy auth is enabled and URL has a ticket
  useEffect(() => {
    // Reaching the login page ends any SSO bounce cycle (see SsoGate loop guard).
    sessionStorage.removeItem('sso_bounced');
    (async () => {
      try {
        const cfgRes = await fetch('/api/v1/authProxy/config');
        if (!cfgRes.ok) return;
        const cfg = await cfgRes.json();
        if (!cfg.enabled) return;
        const params = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
        const ticket = params.get(cfg.paramName);
        if (!ticket) return;
        setLoading(true);
        const res = await fetch(`/api/v1/authProxy?${cfg.paramName}=${encodeURIComponent(ticket)}`);
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || 'Proxy auth failed'); }
        const data = await res.json();
        setJwt(data.accessToken);
        localStorage.setItem('orchestrator_refresh', data.refreshToken || '');
        localStorage.setItem('orchestrator_user', JSON.stringify(data.user || {}));
        navigate('/flows', { replace: true });
      } catch (e: any) {
        setError(e?.message ?? 'Proxy authentication failed');
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || 'Invalid credentials');
      }
      const data = await res.json();
      setJwt(data.accessToken);
      localStorage.setItem('orchestrator_refresh', data.refreshToken || '');
      localStorage.setItem('orchestrator_user', JSON.stringify(data.user || {}));
      navigate('/flows', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center tc-grid-bg">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center flex flex-col items-center gap-2">
          <Logo />
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 p-6 rounded-lg"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
        >
          {error && (
            <div className="flex items-center gap-2 p-2 rounded text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--err)' }}>
              <AlertCircle size={12} /> {error}
            </div>
          )}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Login</label>
            <input
              type="text"
              value={login}
              onChange={e => setLogin(e.target.value)}
              autoComplete="username"
              required
              className="w-full px-3 py-2 rounded text-sm"
              style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full px-3 py-2 rounded text-sm pr-9"
                style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)' }}
              >
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="tc-btn primary mt-1"
            style={{ height: 36, fontSize: 13, fontFamily: 'var(--font-mono)' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
