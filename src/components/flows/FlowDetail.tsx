import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import 'reactflow/dist/style.css';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Server,
  StopCircle,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useFlowLibraryStore } from '../../store/flowLibraryStore';
import { useWorkerStore } from '../../store/workerStore';
import { useTheme } from '../../context/ThemeContext';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import StatusBadge from './StatusBadge';
import ScheduleModal from './ScheduleModal';
import FlowEditor from '../FlowEditor';
import CodeEditorModal from '../CodeEditorModal';
import SessionTabs from '../SessionTabs';
import { ansiToHtml } from '../../utils/ansiToHtml';
import type { OrchestratorFlow } from '../../store/flowLibraryStore';

type TabId = 'executions' | 'edit';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatLogTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (value: number, size = 2) => value.toString().padStart(size, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const ExecutionsTab: React.FC<{ flowId: string; dark: boolean; highlightId?: string; onSelectExec: (id: string) => void }> = ({
  flowId,
  dark,
  highlightId,
  onSelectExec,
}) => {
  const { executions, killExecution, clearExecutions, renameExecution, syncBackendExecutions } = useFlowLibraryStore();
  const flowExecs = executions.filter(e => e.flowId === flowId);
  const [selectedId, setSelectedId] = useState<string | null>(highlightId || flowExecs[0]?.id || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightId) setSelectedId(highlightId);
  }, [highlightId]);

  const selectedExec = flowExecs.find(e => e.id === selectedId);
  const selectedLabel = selectedExec ? (selectedExec.displayName || selectedExec.id) : '';

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [selectedExec?.logs.length, selectedExec?.id]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    onSelectExec(id);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await syncBackendExecutions(flowId);
    } finally {
      setIsRefreshing(false);
    }
  };

  const exportSelectedLogs = () => {
    if (!selectedExec) return;
    const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
    const lines = selectedExec.logs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const node = log.nodeId ? ` [${log.nodeId}]` : '';
      return `[${time}] [${log.type.toUpperCase()}]${node} ${stripAnsi(log.message || '')}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLabel.replace(/[^a-z0-9_-]/gi, '_')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (flowExecs.length === 0) {
    return (
      <div className={`h-full flex flex-col items-center justify-center gap-3 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
        <Activity className="w-8 h-8" />
        <p className="text-sm">No executions yet - hit Execute to run this flow</p>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      <div className={`w-80 flex-shrink-0 border-r overflow-auto ${dark ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`sticky top-0 z-10 px-3 py-2 border-b ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`p-1.5 rounded-md border disabled:opacity-50 ${dark ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}
              title="Refresh executions"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => { clearExecutions(flowId); setSelectedId(null); }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium border ${dark ? 'border-red-900/50 text-red-400 hover:bg-red-950/30' : 'border-red-200 text-red-600 hover:bg-red-50'}`}
            >
              <Trash2 className="w-3.5 h-3.5" />Clear history
            </button>
          </div>
        </div>
        {flowExecs.map(exec => (
          <div
            key={exec.id}
            onClick={() => handleSelect(exec.id)}
            className={`px-4 py-3 border-b cursor-pointer transition-colors ${
              exec.id === selectedId
                ? dark ? 'bg-purple-900/20 border-purple-800/30' : 'bg-purple-50 border-purple-100'
                : dark ? 'border-gray-800/50 hover:bg-gray-800/40' : 'border-gray-100 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <StatusBadge status={exec.status} size="sm" />
              {exec.status === 'RUNNING' && (
                <button
                  onClick={e => { e.stopPropagation(); killExecution(exec.id); }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                >
                  <StopCircle className="w-3 h-3" />Kill
                </button>
              )}
            </div>
            <p className={`font-mono text-xs mt-1 truncate ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{exec.displayName || `${exec.id.slice(0, 16)}...`}</p>
            <div className={`flex items-center gap-2 mt-1 text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
              <span>{formatRelative(exec.startTime)}</span>
              <span>-</span>
              <span>{formatDuration(exec.duration)}</span>
              <span>-</span>
              <span className="capitalize">{exec.triggeredBy}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={`flex-1 flex flex-col overflow-hidden ${dark ? 'bg-gray-950' : 'bg-gray-100'}`}>
        {selectedExec ? (
          <>
            <div className={`px-4 py-2 border-b flex items-center gap-3 flex-shrink-0 ${dark ? 'border-gray-800 bg-gray-900' : 'border-gray-300 bg-gray-200'}`}>
              <StatusBadge status={selectedExec.status} size="sm" />
              <input
                value={selectedLabel}
                onChange={e => renameExecution(selectedExec.id, e.target.value)}
                className={`min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-xs outline-none ${
                  dark ? 'bg-gray-950 border-gray-700 text-gray-300 focus:border-purple-500' : 'bg-white border-gray-300 text-gray-700 focus:border-purple-500'
                }`}
                title={`Execution id: ${selectedExec.id}`}
              />
              <button
                onClick={exportSelectedLogs}
                className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400 hover:text-cyan-400' : 'hover:bg-gray-100 text-gray-500 hover:text-cyan-600'}`}
                title="Export logs"
              >
                <Download className="w-4 h-4" />
              </button>
              {selectedExec.status === 'RUNNING' && (
                <span className="ml-auto flex items-center gap-1 text-xs text-blue-400">
                  <Loader2 className="w-3 h-3 animate-spin" />Live
                </span>
              )}
            </div>
            <div ref={logRef} className={`flex-1 overflow-auto p-3 font-mono text-xs space-y-0.5 ${dark ? 'text-gray-100' : 'text-gray-800'}`}>
              {selectedExec.logs.length === 0 ? (
                <p className={`${dark ? 'text-gray-600' : 'text-gray-500'} italic`}>No logs yet...</p>
              ) : (
                selectedExec.logs.map((log, i) => (
                  <div key={i} className="grid grid-cols-[154px_54px_minmax(0,1fr)] gap-3 leading-5">
                    <span className={`select-none whitespace-nowrap ${dark ? 'text-gray-500' : 'text-gray-500'}`}>
                      {formatLogTimestamp(log.timestamp)}
                    </span>
                    <span className={`select-none uppercase ${log.type === 'error' ? 'text-red-400' : log.type === 'output' ? 'text-cyan-400' : dark ? 'text-gray-500' : 'text-gray-500'}`}>
                      {log.type}
                    </span>
                    <span className="min-w-0 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: ansiToHtml(log.message) }} />
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className={`h-full flex items-center justify-center text-sm ${dark ? 'text-gray-600' : 'text-gray-500'}`}>
            Select an execution to view logs
          </div>
        )}
      </div>
    </div>
  );
};

const EditorTab: React.FC<{ flow: OrchestratorFlow }> = ({ flow }) => {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  const { nodes, edges, editorModal, closeEditorModal, showConsole, toggleConsole } = useFlowStore();
  const { sessions, activeSessionId, createSession, switchSession, updateActiveFlowState } = useSessionStore();
  const { updateFlow } = useFlowLibraryStore();

  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isFlowSession = activeSession?.linkedFlowId === flow.id;

  useEffect(() => {
    if (initializedRef.current === flow.id) return;
    initializedRef.current = flow.id;
    hydratedRef.current = false;

    const flowSessions = sessions.filter(s => s.linkedFlowId === flow.id);
    if (flowSessions.length === 0) {
      createSession(flow.name, flow.id).then(() => {
        updateActiveFlowState({ nodes: flow.nodes || [], edges: flow.edges || [], history: [], historyIndex: -1 });
        hydratedRef.current = true;
      });
    } else {
      if (!flowSessions.some(s => s.id === activeSessionId)) {
        switchSession(flowSessions[0].id);
      }
      setTimeout(() => {
        updateActiveFlowState({ nodes: flow.nodes || [], edges: flow.edges || [], history: [], historyIndex: -1 });
        hydratedRef.current = true;
      }, 0);
    }
  }, [flow.id]);

  useEffect(() => {
    if (!isFlowSession || !hydratedRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      updateFlow(flow.id, { nodes, edges });
      setSaveState('saved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    }, 800);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [nodes, edges, isFlowSession]);

  const editorNode = nodes.find(n => n.id === editorModal.nodeId);

  return (
    <div className="h-full flex flex-col">
      <div className={`flex-shrink-0 flex items-center justify-between px-3 py-1.5 border-b ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        <SessionTabs flowId={flow.id} compact />
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          {saveState === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />Saved
            </span>
          )}
  
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <FlowEditor embedded flowId={flow.id} />
      </div>

      {editorModal.isOpen && editorNode && (
        <CodeEditorModal
          nodeId={editorNode.id}
          code={editorNode.data.code || ''}
          language={editorNode.data.language || 'javascript'}
          onClose={closeEditorModal}
        />
      )}
    </div>
  );
};

const FlowDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { flows, deleteFlow, executeFlow, updateFlow } = useFlowLibraryStore();
  const { statuses, getWorker } = useWorkerStore();

  const rawTabParam = searchParams.get('tab');
  const tabParam: TabId = rawTabParam === 'executions' ? 'executions' : 'edit';
  const highlightExec = searchParams.get('exec') || undefined;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam);
  const [showSchedule, setShowSchedule] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const flow = flows.find(f => f.id === id);
  const worker = flow ? getWorker(flow.workerId) : undefined;
  const workerStatus = worker ? (statuses[worker.id] ?? 'unknown') : null;
  const canRun = workerStatus === 'connected';

  useEffect(() => {
    setActiveTab(tabParam);
    if (!rawTabParam || rawTabParam === 'overview') {
      const p = new URLSearchParams(searchParams);
      p.set('tab', tabParam);
      setSearchParams(p, { replace: true });
    }
  }, [tabParam, rawTabParam]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    const p = new URLSearchParams(searchParams);
    p.set('tab', tab);
    setSearchParams(p, { replace: true });
  };

  const handleExecute = async () => {
    if (!id) return;
    setRunning(true);
    try {
      const execId = await executeFlow(id);
      const p = new URLSearchParams(searchParams);
      p.set('tab', 'executions');
      p.set('exec', execId);
      setSearchParams(p, { replace: true });
      setActiveTab('executions');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
      return;
    }
    if (!id) return;
    deleteFlow(id);
    navigate('/flows');
  };

  const handleScheduleSave = (schedule: { cron: string; enabled: boolean; timezone: string } | null) => {
    if (!id) return;
    updateFlow(id, { schedule: schedule ?? undefined });
    setShowSchedule(false);
  };

  const handleExecSelect = (execId: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('exec', execId);
    setSearchParams(p, { replace: true });
  };

  if (!flow) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-sm font-medium">Flow not found</p>
        <button onClick={() => navigate('/flows')} className="text-sm text-purple-400 hover:text-purple-300">Back to Flows</button>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'executions', label: 'Executions', icon: Activity },
    { id: 'edit', label: 'Edit', icon: Edit3 },
  ];
  const WorkerStatusIcon = workerStatus === 'connected' ? Wifi : workerStatus === 'disconnected' ? WifiOff : Server;

  return (
    <div className={`h-full flex flex-col ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      <div className={`flex-shrink-0 border-b ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
        <div className="px-5 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/flows')} className={`p-1.5 rounded-md ${dark ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold truncate">{flow.name}</h1>
              {flow.lastExecution && <StatusBadge status={flow.lastExecution.status} size="sm" />}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{flow.namespace}</span>
              {worker && (
                <>
                  <span className={`text-xs ${dark ? 'text-gray-700' : 'text-gray-300'}`}>-</span>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: worker.color }} />
                    <span className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{worker.name}</span>
                    <WorkerStatusIcon className={`w-3 h-3 ${
                      workerStatus === 'connected' ? 'text-emerald-400' :
                      workerStatus === 'disconnected' ? 'text-red-400' : 'text-gray-400'
                    }`} />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSchedule(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
                flow.schedule
                  ? dark ? 'border-blue-700 bg-blue-900/20 text-blue-400' : 'border-blue-300 bg-blue-50 text-blue-700'
                  : dark ? 'border-gray-700 hover:border-gray-600 text-gray-400' : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {flow.schedule ? flow.schedule.cron : 'Schedule'}
            </button>
            <button
              onClick={handleDelete}
              className={`p-2 rounded-lg ${deleteConfirm ? 'bg-red-500/20 text-red-400 border border-red-500/30' : dark ? 'hover:bg-gray-800 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}
            >
              {deleteConfirm ? <AlertTriangle className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            </button>
            <button
              onClick={handleExecute}
              disabled={running || !canRun}
              title={canRun ? 'Execute flow' : worker ? 'Worker offline' : 'No worker configured'}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? 'Running...' : 'Execute'}
            </button>
          </div>
        </div>

        <div className="flex items-center px-5">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-400'
                    : `border-transparent ${dark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'}`
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'executions' && (
          <ExecutionsTab flowId={flow.id} dark={dark} highlightId={highlightExec} onSelectExec={handleExecSelect} />
        )}
        {activeTab === 'edit' && <EditorTab flow={flow} />}
      </div>

      {showSchedule && (
        <ScheduleModal flow={flow} onClose={() => setShowSchedule(false)} onSave={handleScheduleSave} />
      )}
    </div>
  );
};

export default FlowDetail;
