import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle } from 'lucide-react';
import { setJwt } from '../utils/apiClient';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            [Orchestrator]
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Sign in to continue</p>
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
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-3)' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
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

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-3)' }}>
          Default: <span style={{ color: 'var(--text-2)' }}>admin@orchestrator.local</span>
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
