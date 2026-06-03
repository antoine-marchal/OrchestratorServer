import React from 'react';
import { useFlowStore } from '../store/sessionFlowStore';
import { useSessionStore } from '../store/sessionStore';
import { Terminal, X, Trash2, Maximize2, Minimize2, Clock, Download } from 'lucide-react';
import { useTheme } from "../context/ThemeContext";

const Console: React.FC = () => {
  const { theme } = useTheme();
  const activeSession = useSessionStore(s => s.getActiveSession());
  const {
    consoleMessages,
    showConsole,
    fullscreen,
    setFullscreen,
    toggleConsole,
    clearConsole,
    nodes,
    nodeExecutionTimeout,
    setNodeExecutionTimeout,
    setMouseOverConsole
  } = useFlowStore();

  const consoleRef = React.useRef<HTMLDivElement>(null);
  const [visibleTypes, setVisibleTypes] = React.useState<string[]>(['input', 'log', 'output', 'error', 'flow']);
  const [logDropdownOpen, setLogDropdownOpen] = React.useState(false);
  const [timeoutDropdownOpen, setTimeoutDropdownOpen] = React.useState(false);
  const logDropdownRef = React.useRef<HTMLDivElement>(null);
  const timeoutDropdownRef = React.useRef<HTMLDivElement>(null);
  function toggleLogType(type: string) {
    setVisibleTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }
  React.useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleMessages]);
  React.useEffect(() => {
    if (!logDropdownOpen && !timeoutDropdownOpen) return;
    function handler(e: MouseEvent) {
      // If click is outside the dropdowns, close them
      if (
        logDropdownOpen &&
        logDropdownRef.current &&
        !logDropdownRef.current.contains(e.target as Node)
      ) {
        setLogDropdownOpen(false);
      }
      
      if (
        timeoutDropdownOpen &&
        timeoutDropdownRef.current &&
        !timeoutDropdownRef.current.contains(e.target as Node)
      ) {
        setTimeoutDropdownOpen(false);
      }
    }
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [logDropdownOpen, timeoutDropdownOpen]);

  const getNodeLabel = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.label || nodeId;
  };

  const handleExportLogs = () => {
    const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = consoleMessages.map(msg => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      return `[${time}] [${msg.type.toUpperCase()}] ${getNodeLabel(msg.nodeId)}: ${stripAnsi(msg.message || '')}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const sessionName = (activeSession?.name || 'session').replace(/[^a-z0-9_-]/gi, '_');
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.href = url;
    a.download = `${sessionName}_${date}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!showConsole) {
    return (
      <button
        onClick={toggleConsole}
        className="absolute bottom-4 left-4 bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 rounded-full shadow-lg hover:bg-gray-700 hover:text-white transition-colors"
      >
        <Terminal className="w-5 h-5" />
      </button>
    );
  }
  const LOG_TYPES = [
    { label: 'Inputs', value: 'input' },
    { label: 'Log', value: 'log' },
    { label: 'Output', value: 'output' },
    { label: 'Error', value: 'error' },
    { label: 'Flow', value: 'flow' },
  ];

  function escapeHtml(text: string) {
    if (text == null) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ANSI color code to CSS color mapping
  const ansiColors: Record<number, string> = {
    30: '#000000', 31: '#cc0000', 32: '#00cc00', 33: '#cccc00',
    34: '#0000cc', 35: '#cc00cc', 36: '#00cccc', 37: '#cccccc',
    90: '#666666', 91: '#ff0000', 92: '#00ff00', 93: '#ffff00',
    94: '#0000ff', 95: '#ff00ff', 96: '#00ffff', 97: '#ffffff',
  };

  const ansiBgColors: Record<number, string> = {
    40: '#000000', 41: '#cc0000', 42: '#00cc00', 43: '#cccc00',
    44: '#0000cc', 45: '#cc00cc', 46: '#00cccc', 47: '#cccccc',
    100: '#666666', 101: '#ff0000', 102: '#00ff00', 103: '#ffff00',
    104: '#0000ff', 105: '#ff00ff', 106: '#00ffff', 107: '#ffffff',
  };

  // Group consecutive log entries with the same timestamp, nodeId, and type
  function groupConsoleMessages(messages: typeof consoleMessages) {
    const grouped: typeof consoleMessages = [];

    for (const msg of messages) {
      const lastGroup = grouped[grouped.length - 1];

      // Group if same nodeId, type, and timestamp within 100ms
      if (
        lastGroup &&
        lastGroup.nodeId === msg.nodeId &&
        lastGroup.type === msg.type &&
        Math.abs(lastGroup.timestamp - msg.timestamp) < 100
      ) {
        // Append message to the last group
        lastGroup.message = lastGroup.message + '\n' + msg.message;
      } else {
        // Start a new group (clone the object to avoid mutating original)
        grouped.push({ ...msg });
      }
    }

    return grouped;
  }

  function ansiToHtml(text: string): string {
    // Handle null/undefined
    if (text == null) return '';

    // First escape HTML
    let escaped = escapeHtml(text);

    // Track current styles
    let result = '';
    let currentStyles: string[] = [];

    // Split by ANSI escape sequences
    // Matches: ESC[ followed by numbers separated by ; and ending with m
    const ansiRegex = /\x1b\[([0-9;]*)m/g;
    let lastIndex = 0;
    let match;

    while ((match = ansiRegex.exec(escaped)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        const textBefore = escaped.slice(lastIndex, match.index);
        if (currentStyles.length > 0) {
          result += `<span style="${currentStyles.join(';')}">${textBefore}</span>`;
        } else {
          result += textBefore;
        }
      }

      // Parse the codes
      const codes = match[1].split(';').map(c => parseInt(c, 10) || 0);

      for (const code of codes) {
        if (code === 0) {
          // Reset
          currentStyles = [];
        } else if (code === 1) {
          currentStyles.push('font-weight:bold');
        } else if (code === 2) {
          currentStyles.push('opacity:0.7');
        } else if (code === 3) {
          currentStyles.push('font-style:italic');
        } else if (code === 4) {
          currentStyles.push('text-decoration:underline');
        } else if (code === 9) {
          currentStyles.push('text-decoration:line-through');
        } else if (ansiColors[code]) {
          // Remove any existing color
          currentStyles = currentStyles.filter(s => !s.startsWith('color:'));
          currentStyles.push(`color:${ansiColors[code]}`);
        } else if (ansiBgColors[code]) {
          // Remove any existing background
          currentStyles = currentStyles.filter(s => !s.startsWith('background:'));
          currentStyles.push(`background:${ansiBgColors[code]}`);
        }
      }

      lastIndex = ansiRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < escaped.length) {
      const remaining = escaped.slice(lastIndex);
      if (currentStyles.length > 0) {
        result += `<span style="${currentStyles.join(';')}">${remaining}</span>`;
      } else {
        result += remaining;
      }
    }

    return result;
  }
  return (
    <div
      className={`
        absolute bottom-0 left-0 bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-lg rounded-t-lg
        transition-all duration-300 z-50
        ${fullscreen
          ? 'top-0 w-full h-full rounded-none'
          : 'w-full md:w-1/2 lg:w-1/3 h-auto'
        }
      `}
      style={fullscreen ? { minHeight: '100vh' } : {}}
      onMouseEnter={() => setMouseOverConsole(true)}
      onMouseLeave={() => setMouseOverConsole(false)}
    >
      <div className="flex left-[5px] items-center justify-between p-2 border-b border-gray-300 dark:border-gray-700 ">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          <span className="font-medium">Console</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFullscreen()}
            className="p-1 hover:bg-gray-700 hover:text-white rounded"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={clearConsole}
            className="p-1 hover:bg-gray-700 hover:text-white rounded"
            title="Clear console"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Timeout Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setTimeoutDropdownOpen((v) => !v);
                setLogDropdownOpen(false);
              }}
              className="p-1 hover:bg-gray-700  hover:text-white rounded flex items-center"
              title="Node execution timeout"
            >
              <Clock className="w-4 h-4" />
              <span className="ml-1 text-xs">{nodeExecutionTimeout === Infinity ? '∞' : `${nodeExecutionTimeout / 1000}s`}</span>
            </button>
            {timeoutDropdownOpen && (
              <div
                ref={timeoutDropdownRef}
                className="absolute right-0 mt-2 w-36 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-xl z-50"
              >
                <div className="py-1 px-2 text-xs text-gray-600 dark:text-gray-400 border-b border-gray-300 dark:border-gray-700">Execution Timeout</div>
                {[5, 30, 60, 120, 600, 1200, Infinity].map((seconds) => (
                  <button
                    key={String(seconds)}
                    className={`w-full text-left px-3 py-1 hover:bg-gray-700 hover:text-white ${
                      nodeExecutionTimeout === seconds * 1000 ? 'bg-gray-700 text-white' : ''
                    }`}
                    onClick={() => {
                      setNodeExecutionTimeout(seconds * 1000);
                      setTimeoutDropdownOpen(false);
                    }}
                  >
                    {seconds === Infinity ? 'No limit' : `${seconds} seconds`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Log Level Dropdown */}
          <button
            onClick={() => {
              setLogDropdownOpen((v) => !v);
              setTimeoutDropdownOpen(false);
            }}
            className="p-1 hover:bg-gray-700 hover:text-white rounded"
            title="Log level filter"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M3 7h18M6 12h12M10 17h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {logDropdownOpen && (
            <div ref={logDropdownRef} className="absolute right-0 mt-2 w-36 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-xl z-50">
              {LOG_TYPES.map((item) => (
                <label key={item.value} className="flex items-center px-3 py-1 cursor-pointer hover:bg-gray-700 hover:text-white">
                  <input
                    type="checkbox"
                    checked={visibleTypes.includes(item.value)}
                    onChange={() => toggleLogType(item.value)}
                    className="mr-2 accent-blue-500"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          )}


          <button
            onClick={handleExportLogs}
            className="p-1 hover:bg-gray-700 hover:text-white rounded"
            title="Export logs"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={toggleConsole}
            className="p-1 hover:bg-gray-700 hover:text-white rounded"
            title="Close console"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={consoleRef}
        className={`overflow-y-auto p-4 font-mono text-sm transition-all duration-200 ${fullscreen ? 'h-[calc(100vh-48px)]' : 'h-64'}`}
      >
        {(() => {
          // Track how many times each node has opened a run (an `input` log
          // starts a run). The 2nd+ input for a node marks a new instance, so we
          // render a divider — the two A's in A->B->A->C stay visually separate
          // even though they share one node id (issue 1).
          const runCount: Record<string, number> = {};
          return groupConsoleMessages(consoleMessages.filter(msg => visibleTypes.includes(msg.type))).map((msg, i) => {
          let runDivider: string | null = null;
          if (msg.type === 'input') {
            runCount[msg.nodeId] = (runCount[msg.nodeId] || 0) + 1;
            if (runCount[msg.nodeId] > 1) runDivider = `${getNodeLabel(msg.nodeId)} — run ${runCount[msg.nodeId]}`;
          }
          return (
          <React.Fragment key={i}>
          {runDivider && (
            <div className="my-1 flex items-center gap-2 select-none" style={{ color: 'var(--text-mute, #9aa4b2)' }}>
              <span className="flex-1 border-t border-gray-300 dark:border-gray-700" />
              <span className="text-[10px] uppercase tracking-wider">{runDivider}</span>
              <span className="flex-1 border-t border-gray-300 dark:border-gray-700" />
            </div>
          )}
          <div
            className={`mb-2 flex ${msg.type === 'error'
                ? 'text-red-600 dark:text-red-400'
                : msg.type === 'input'
                  ? 'text-blue-600 dark:text-blue-400'
                  : msg.type === 'log'
                    ? 'text-gray-600 dark:text-gray-400'
                    : msg.type === 'flow'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-green-600 dark:text-green-400'
              }`}
          >
            <span className="text-gray-500 shrink-0 pr-2 select-none">
              [{new Date(msg.timestamp).toLocaleTimeString()}] {getNodeLabel(msg.nodeId)}:
            </span>
            <span
              className="whitespace-pre-wrap break-words min-w-0"
              dangerouslySetInnerHTML={{
                __html: ansiToHtml(msg.message || '')
              }}
            />
          </div>
          </React.Fragment>
          );
          });
        })()}
      </div>
    </div>
  );
};

export default Console;
