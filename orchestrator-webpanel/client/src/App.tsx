import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import AppLayout from './components/flows/AppLayout';
import FlowsList from './components/flows/FlowsList';
import FlowDetail from './components/flows/FlowDetail';
import ExecutionsList from './components/flows/ExecutionsList';
import WorkersPanel from './components/flows/WorkersPanel';
import AdminLayout from './components/admin/AdminLayout';
import LoginPage from './components/LoginPage';
import { getJwt } from './utils/apiClient';
import { useSessionStore } from './store/sessionStore';
import { useFlowLibraryStore } from './store/flowLibraryStore';

// Reads a query param from both the real URL search (where an SSO server drops
// ?ticket=) and the HashRouter hash, so a CAS round-trip is detected either way.
function readParam(name: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch) return fromSearch;
  const hash = window.location.hash || '';
  const qIdx = hash.indexOf('?');
  return qIdx >= 0 ? new URLSearchParams(hash.slice(qIdx + 1)).get(name) : null;
}

// Unauthenticated landing. When proxy auth is enabled, bootstraps the SSO flow
// by redirecting the browser to the external CAS /login (which mints a ticket
// and redirects back). Otherwise falls back to the password form at /login.
// The explicit /login route bypasses this gate entirely (escape hatch).
const SsoGate: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        const cfgRes = await fetch('/api/v1/authProxy/config');
        const cfg = cfgRes.ok ? await cfgRes.json() : { enabled: false };
        if (!cfg.enabled || !cfg.loginUrl || !cfg.service) {
          navigate('/login', { replace: true });
          return;
        }
        // A ticket is already on the URL → hand off to the password page, which
        // exchanges it. (LoginPage reads the ticket from window.location.)
        if (readParam(cfg.paramName || 'ticket')) {
          navigate('/login', { replace: true });
          return;
        }
        // Loop guard: if we already bounced to the SSO and came back without a
        // ticket, don't redirect again — show the password form instead.
        if (sessionStorage.getItem('sso_bounced')) {
          sessionStorage.removeItem('sso_bounced');
          navigate('/login', { replace: true });
          return;
        }
        sessionStorage.setItem('sso_bounced', '1');
        window.location.href = `${cfg.loginUrl}?service=${encodeURIComponent(cfg.service)}`;
      } catch {
        navigate('/login', { replace: true });
      }
    })();
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center tc-grid-bg">
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>Redirecting to sign-in…</p>
    </div>
  );
};

// Renders the target when authenticated, else bootstraps SSO / password login.
const PrivateRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  return getJwt() ? element : <SsoGate />;
};

function App() {
  const { loadSessions } = useSessionStore();
  const { loadAll, resumePolling, startScheduler } = useFlowLibraryStore();

  useEffect(() => {
    if (!getJwt()) return; // don't load if not authenticated
    loadSessions();
    loadAll();
    resumePolling();
    startScheduler();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute element={<Navigate to="/flows" replace />} />} />
        <Route element={<PrivateRoute element={<AppLayout />} />}>
          <Route path="/flows" element={<FlowsList />} />
          <Route path="/flows/:id" element={<FlowDetail />} />
          <Route path="/executions" element={<ExecutionsList />} />
          <Route path="/workers" element={<WorkersPanel />} />
          <Route path="/admin" element={<AdminLayout />} />
        </Route>
        <Route path="/editor" element={<Navigate to="/flows" replace />} />
        <Route path="*" element={<Navigate to="/flows" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
