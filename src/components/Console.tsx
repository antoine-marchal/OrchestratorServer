import React from 'react';
import { useFlowStore } from '../store/flowStore';
import { Terminal, X, Trash2, Maximize2, Minimize2, Clock } from 'lucide-react';
import { useTheme } from "../context/ThemeContext";

const Console: React.FC = () => {
  const { theme } = useTheme();
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
  const [visibleTypes, setVisibleTypes] = React.useState<string[]>(['input', 'log', 'output', 'error']);
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

  if (!showConsole) {
    return (
      <button
        onClick={toggleConsole}
        className="fixed bottom-4 left-[5px] bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-2 rounded-full shadow-lg hover:bg-gray-700 hover:text-white transition-colors"
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
  ];

  function escapeHtml(text: string) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  return (
    <div
      className={`
        fixed bottom-0 left-[5px] bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-lg rounded-t-lg
        transition-all duration-300 z-50
        ${fullscreen
          ? 'top-0 left-0 w-screen h-screen rounded-none'
          : 'w-full md:w-1/2 lg:w-1/3 h-auto'
        }
      `}
      style={fullscreen ? { minHeight: '100vh' } : {}}
      onMouseEnter={() => setMouseOverConsole(true)}
      onMouseLeave={() => setMouseOverConsole(false)}
    >
      <div className="flex items-center justify-between p-2 border-b border-gray-300 dark:border-gray-700 ">
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
              <span className="ml-1 text-xs">{nodeExecutionTimeout / 1000}s</span>
            </button>
            {timeoutDropdownOpen && (
              <div
                ref={timeoutDropdownRef}
                className="absolute right-0 mt-2 w-36 bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded shadow-xl z-50"
              >
                <div className="py-1 px-2 text-xs text-gray-600 dark:text-gray-400 border-b border-gray-300 dark:border-gray-700">Execution Timeout</div>
                {[5, 30, 60, 120, 600, 1200, Infinity].map((seconds) => (
                  <button
                    key={seconds}
                    className={`w-full text-left px-3 py-1 hover:bg-gray-700 hover:text-white ${
                      nodeExecutionTimeout === seconds * 1000 ? 'bg-gray-700 text-white' : ''
                    }`}
                    onClick={() => {
                      setNodeExecutionTimeout(seconds * 1000);
                      setTimeoutDropdownOpen(false);
                    }}
                  >
                    {seconds} seconds
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
        {consoleMessages.filter(msg => visibleTypes.includes(msg.type)).map((msg, i) => (
          <div
            key={i}
            className={`mb-2 ${msg.type === 'error'
                ? 'text-red-600 dark:text-red-400'
                : msg.type === 'input'
                  ? 'text-blue-600 dark:text-blue-400'
                  : msg.type === 'log'
                    ? 'text-gray-600 dark:text-gray-400'
                    : 'text-green-600 dark:text-green-400'
              }`}
          >
            <span className="text-gray-500">
              [{new Date(msg.timestamp).toLocaleTimeString()}] {getNodeLabel(msg.nodeId)}:{' '}
            </span>
            <span
              className="whitespace-pre"
              dangerouslySetInnerHTML={{
                __html: escapeHtml(msg.message)
              }}
            />


          </div>
        ))}
      </div>
    </div>
  );
};

export default Console;
