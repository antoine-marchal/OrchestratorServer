import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Activity, Server, Sun, Moon, ShieldCheck, LogOut } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useServerWorkers } from '../../hooks/useServerWorkers';
import { clearJwt } from '../../utils/apiClient';
import { useAuth } from '../../hooks/useAuth';

declare const __APP_VERSION__: string;

/* Inline SVG icons used in sidebar/logo that aren't in lucide */
const FlowIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M6 8.5v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3" />
  </svg>
);

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
      <span
        style={{
          display: 'inline-block',
          color: 'var(--accent)',
          position: 'relative',
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        O
        <BoltMark size={13} />
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text)', fontSize: 13, lineHeight: 1 }}>
        rchestrator
      </span>
      <span className="bracket">/&gt;</span>
    </span>
    <span className="ver">v{__APP_VERSION__}</span>
    <span className="pulse" title="scheduler active" />
  </span>
);

const ALL_NAV_ITEMS = [
  { to: '/flows', icon: FlowIcon, label: 'Flows', adminOnly: false },
  { to: '/executions', icon: Activity, label: 'Executions', adminOnly: false },
  { to: '/workers', icon: Server, label: 'Workers', adminOnly: false },
  { to: '/admin', icon: ShieldCheck, label: 'Admin', adminOnly: true },
];

const AppLayout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { workers } = useServerWorkers(15_000);
  const navigate = useNavigate();
  const { canAccessAdmin } = useAuth();

  const handleLogout = () => {
    clearJwt();
    localStorage.removeItem('orchestrator_refresh');
    localStorage.removeItem('orchestrator_user');
    navigate('/login', { replace: true });
  };

  const onlineCount = workers.filter(w => w.status === 'online').length;
  const totalCount = workers.length;
  const footerDotClass = totalCount === 0 ? 'unknown' : (onlineCount > 0 ? '' : 'disconnected');
  const footerShort = totalCount === 0 ? '—' : `${onlineCount}/${totalCount}`;
  const footerLabel =
    totalCount === 0 ? 'no workers' :
    onlineCount === 0 ? `${totalCount} worker${totalCount > 1 ? 's' : ''} · all offline` :
    `${onlineCount}/${totalCount} online`;

  return (
    <div className="tc-app">
      {/* Titlebar */}
      <div className="tc-titlebar">
        <Logo />
        <div style={{ flex: 1 }} />
        <div className="tc-title-actions">
          <button
            className="tc-icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            className="tc-icon-btn"
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="tc-sidebar">
        <nav>
          {ALL_NAV_ITEMS.filter(item => !item.adminOnly || canAccessAdmin).map(({ to, icon: Icon, label }) => {
            const badgeCount =
              label === 'Workers' && totalCount > 0 && onlineCount < totalCount
                ? `${onlineCount}/${totalCount}`
                : null;
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive: a }) => 'tc-nav-item' + (a ? ' active' : '')}
                title={label}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0, width: 16, justifyContent: 'center' }}>
                  <Icon size={16} />
                </span>
                <span className="tc-nav-label">{label}</span>
                {badgeCount && <span className="tc-nav-badge">{badgeCount}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="tc-sidebar-footer">
          <span className={`tc-worker-dot ${footerDotClass}`} />
          <span className="worker-name-short">{footerShort}</span>
          <span className="worker-name">{footerLabel}</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="tc-main">
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
