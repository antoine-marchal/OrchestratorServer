import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { GitBranch, Activity, Server, Code2, Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useWorkerStore } from '../../store/workerStore';
import { useKestraStore } from '../../store/kestraStore';

const NAV_ITEMS = [
  { to: '/flows', icon: GitBranch, label: 'Flows' },
  { to: '/executions', icon: Activity, label: 'Executions' },
  { to: '/workers', icon: Server, label: 'Workers' },
  { to: '/editor', icon: Code2, label: 'Editor' },
];

const KestrasLayout: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const { workers, statuses } = useWorkerStore();
  const { schedulerActive } = useKestraStore();

  const connectedCount = workers.filter(w => statuses[w.id] === 'connected').length;

  return (
    <div className={`flex h-screen overflow-hidden ${dark ? 'bg-gray-950 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      {/* Sidebar */}
      <aside className={`w-52 flex-shrink-0 flex flex-col border-r ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
        {/* Logo */}
        <div className={`h-13 flex items-center px-4 py-3 border-b ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center">
              <GitBranch className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-semibold text-sm">Orchestrator</span>
              {schedulerActive && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Navigation */}
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
              {/* Workers badge */}
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

        {/* Theme toggle */}
        <div className={`px-3 py-2 border-t ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
          <button
            onClick={toggleTheme}
            className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-colors ${
              dark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
            }`}
          >
            {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>

        {/* Worker status summary */}
        {workers.length > 0 && (
          <div className={`px-3 py-3 border-t ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
            {workers.slice(0, 3).map(w => (
              <div key={w.id} className="flex items-center gap-2 py-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    statuses[w.id] === 'connected' ? 'bg-emerald-400' :
                    statuses[w.id] === 'checking' ? 'bg-blue-400 animate-pulse' :
                    statuses[w.id] === 'disconnected' ? 'bg-red-400' : 'bg-gray-500'
                  }`}
                />
                <span className={`text-xs truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{w.name}</span>
              </div>
            ))}
            {workers.length > 3 && (
              <p className={`text-xs mt-0.5 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>+{workers.length - 3} more</p>
            )}
          </div>
        )}
      </aside>

      {/* Main content — pages manage their own scrolling */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default KestrasLayout;
