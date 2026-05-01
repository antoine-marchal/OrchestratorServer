import React, { useCallback, useEffect, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { GitBranch, Activity, Server, Sun, Moon, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTheme } from '../../context/ThemeContext';
import { useWorkerStore } from '../../store/workerStore';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';

const NAV_ITEMS = [
  { to: '/flows', icon: GitBranch, label: 'Flows' },
  { to: '/executions', icon: Activity, label: 'Executions' },
  { to: '/workers', icon: Server, label: 'Workers' },
];

const appWindow = getCurrentWindow();

const AppLayout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const { workers, statuses } = useWorkerStore();
  const { schedulerActive } = useFlowLibraryStore();
  const [isMaximized, setIsMaximized] = useState(false);

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

  return (
    <div className={`flex flex-col h-screen overflow-hidden ${dark ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Custom titlebar */}
      <div className={`flex-shrink-0 flex items-center h-8 select-none ${dark ? 'bg-gray-900 border-b border-gray-800' : 'bg-white border-b border-gray-200'}`}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 flex-shrink-0">
          <div className="w-5 h-5 rounded-md bg-purple-600 flex items-center justify-center">
            <GitBranch className="w-3 h-3 text-white" />
          </div>
          <span className="font-semibold text-xs">Orchestrator</span>
          <span className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>v{__APP_VERSION__}</span>
          {schedulerActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </div>
        {/* Drag region fills the remaining space */}
        <div data-tauri-drag-region className="flex-1 h-full" />
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={`w-10 h-full flex items-center justify-center transition-colors ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-800'}`}
        >
          {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>
        {/* Window controls */}
        <button
          onClick={handleMinimize}
          className={`w-12 h-full flex items-center justify-center transition-colors ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-800'}`}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className={`w-12 h-full flex items-center justify-center transition-colors ${dark ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-800'}`}
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className={`w-12 h-full flex items-center justify-center transition-colors hover:bg-red-500 hover:text-white ${dark ? 'text-gray-400' : 'text-gray-500'}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
      <aside className={`w-52 flex-shrink-0 flex flex-col border-r ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? dark ? 'bg-purple-600/20 text-purple-400' : 'bg-purple-50 text-purple-700'
                    : dark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {label === 'Workers' && workers.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  connectedCount === workers.length
                    ? 'bg-emerald-400/20 text-emerald-400'
                    : connectedCount > 0
                    ? 'bg-yellow-400/20 text-yellow-400'
                    : 'bg-red-400/20 text-red-400'
                }`}>
                  {connectedCount}/{workers.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {workers.length > 0 && (
          <div className={`px-3 py-3 border-t ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
            {workers.slice(0, 3).map(w => (
              <div key={w.id} className="flex items-center gap-2 py-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  statuses[w.id] === 'connected' ? 'bg-emerald-400' :
                  statuses[w.id] === 'checking' ? 'bg-blue-400 animate-pulse' :
                  statuses[w.id] === 'disconnected' ? 'bg-red-400' : 'bg-gray-500'
                }`} />
                <span className={`text-xs truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{w.name}</span>
              </div>
            ))}
            {workers.length > 3 && (
              <p className={`text-xs mt-0.5 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>+{workers.length - 3} more</p>
            )}
          </div>
        )}
      </aside>

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full">
          <Outlet />
        </div>
      </main>
      </div>
    </div>
  );
};

export default AppLayout;
