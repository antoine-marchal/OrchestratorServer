import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Activity, Server, Sun, Moon, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTheme } from '../../context/ThemeContext';
import { useWorkerStore } from '../../store/workerStore';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';

declare const __APP_VERSION__: string;

const appWindow = getCurrentWindow();

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

const NAV_ITEMS = [
  { to: '/flows', icon: FlowIcon, label: 'Flows' },
  { to: '/executions', icon: Activity, label: 'Executions' },
  { to: '/workers', icon: Server, label: 'Workers' },
];

const AppLayout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { workers, statuses } = useWorkerStore();
  const { schedulerActive } = useFlowLibraryStore();
  const [isMaximized, setIsMaximized] = useState(false);
  const location = useLocation();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const handleMinimize = useCallback(() => appWindow.minimize(), []);
  const handleMaximize = useCallback(() => appWindow.toggleMaximize(), []);
  const handleClose = useCallback(() => appWindow.close(), []);

  const connectedCount = workers.filter(w => statuses[w.id] === 'connected').length;
  const primaryWorker = workers[0];
  const primaryStatus = primaryWorker ? (statuses[primaryWorker.id] ?? 'unknown') : 'unknown';
  const workerShortName = primaryWorker ? primaryWorker.name.slice(0, 4) : '';

  const workerDotClass =
    primaryStatus === 'connected' ? '' :
    primaryStatus === 'checking' ? 'checking' :
    primaryStatus === 'disconnected' ? 'disconnected' :
    'unknown';

  const workerLabel =
    primaryStatus === 'connected' ? 'online' :
    primaryStatus === 'checking' ? 'checking…' :
    primaryStatus === 'disconnected' ? 'offline' :
    'no worker';

  return (
    <div className="tc-app">
      {/* Titlebar */}
      <div className="tc-titlebar">
        <Logo />
        <div data-tauri-drag-region style={{ flex: 1, height: '100%' }} />
        <div className="tc-title-actions">
          <button
            className="tc-icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark'
              ? <Sun size={14} />
              : <Moon size={14} />
            }
          </button>
          <button className="tc-icon-btn tc-win-btn" title="Minimize" onClick={handleMinimize}>
            <Minus size={14} />
          </button>
          <button className="tc-icon-btn tc-win-btn" title="Maximize" onClick={handleMaximize}>
            <Square size={12} />
          </button>
          <button className="tc-icon-btn tc-win-btn close" title="Close" onClick={handleClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="tc-sidebar">
        <nav>
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname.startsWith(to);
            const badgeCount =
              label === 'Workers' && workers.length > 0 && connectedCount < workers.length
                ? `${connectedCount}/${workers.length}`
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
          {workers.length > 0 ? (
            <>
              <span className={`tc-worker-dot ${workerDotClass}`} />
              <span className="worker-name-short">{workerShortName}</span>
              <span className="worker-name">{primaryWorker?.name} · {workerLabel}</span>
            </>
          ) : (
            <>
              <span className="tc-worker-dot unknown" />
              <span className="worker-name-short">—</span>
              <span className="worker-name">no worker</span>
            </>
          )}
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
