import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap, ReactFlowProvider, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ArrowLeft, Play, Pencil, Trash2, Clock, Save,
  Loader2, AlertCircle, LayoutGrid, Activity, Edit3,
  AlertTriangle, CheckCircle2, StopCircle, Server, Wifi, WifiOff,
} from 'lucide-react';
import { useKestraStore } from '../../store/kestraStore';
import { useWorkerStore } from '../../store/workerStore';
import { useTheme } from '../../context/ThemeContext';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';
import StatusBadge from './StatusBadge';
import ScheduleModal from './ScheduleModal';
import FlowEditor from '../FlowEditor';
import type { KestrasFlow, KestrasExecution } from '../../store/kestraStore';

type TabId = 'overview' | 'executions' | 'edit';

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
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

// ── Read-only diagram ──────────────────────────────────────────────────────

const ReadOnlyDiagram: React.FC<{ flow: KestrasFlow; dark: boolean }> = ({ flow, dark }) => {
  const nodes = (flow.nodes || []).map(n => ({
    ...n, draggable: false, selectable: false, connectable: false,
  }));
  const edges = (flow.edges || []).map(e => ({
    ...e, markerEnd: { type: MarkerType.ArrowClosed },
  }));

  if (nodes.length === 0) {
    return (
      <div className={`h-full flex flex-col items-center justify-center gap-3 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
        <LayoutGrid className="w-8 h-8" />
        <p className="text-sm">No nodes yet — go to Edit to build this flow</p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes} edges={edges}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        zoomOnScroll panOnDrag fitView fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={dark ? '#374151' : '#e5e7eb'} gap={20} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={dark ? '#4b5563' : '#d1d5db'}
          maskColor={dark ? 'rgba(17,24,39,0.7)' : 'rgba(255,255,255,0.7)'}
          style={{ background: dark ? '#1f2937' : '#f9fafb' }}
        />
      </ReactFlow>
    </ReactFlowProvider>
  );
};

// ── Editor tab ─────────────────────────────────────────────────────────────

const EditorTab: React.FC<{ flow: KestrasFlow; onSaved: () => void }> = ({ flow, onSaved }) => {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { nodes, edges } = useFlowStore();
  const { updateActiveFlowState } = useSessionStore();
  const { updateFlow } = useKestraStore();
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    if (loadedId.current === flow.id) return;
    loadedId.current = flow.id;
    updateActiveFlowState({ nodes: flow.nodes || [], edges: flow.edges || [], history: [], historyIndex: -1 });
  }, [flow.id]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      updateFlow(flow.id, { nodes, edges });
      setSaveMsg({ ok: true, text: 'Saved' });
      onSaved();
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }, [flow.id, nodes, edges, updateFlow, onSaved]);

  return (
    <div className="h-full flex flex-col">
      <div className={`flex-shrink-0 flex items-center justify-between px-4 py-2 border-b ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
        <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
          Editing <span className={`font-medium ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{flow.name}</span> · saved to browser storage
        </p>
        <div className="flex items-center gap-3">
          {saveMsg && (
            <span className={`text-xs font-medium flex items-center gap-1 ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {saveMsg.text}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <FlowEditor />
      </div>
    </div>
  );
};

// ── Executions tab ─────────────────────────────────────────────────────────

const ExecutionsTab: React.FC<{ flowId: string; dark: boolean; highlightId?: string }> = ({ flowId, dark, highlightId }) => {
  const { executions, killExecution } = useKestraStore();
  const flowExecs = executions.filter(e => e.flowId === flowId);

  if (flowExecs.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-20 gap-3 ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
        <Activity className="w-8 h-8" />
        <p className="text-sm">No executions yet — hit Execute to run this flow</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full">
        <thead>
          <tr className={`text-xs font-medium border-b ${dark ? 'text-gray-500 border-gray-800' : 'text-gray-500 border-gray-200'}`}>
            <th className="text-left px-4 py-3">ID</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Worker</th>
            <th className="text-left px-4 py-3">Triggered by</th>
            <th className="text-left px-4 py-3">Started</th>
            <th className="text-left px-4 py-3">Duration</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {flowExecs.map(exec => (
            <tr
              key={exec.id}
              className={`border-b text-sm ${
                exec.id === highlightId
                  ? dark ? 'bg-purple-900/20 border-purple-800/30' : 'bg-purple-50 border-purple-100'
                  : dark ? 'border-gray-800/50 hover:bg-gray-800/40' : 'border-gray-100 hover:bg-gray-50'
              }`}
            >
              <td className="px-4 py-3">
                <span className={`font-mono text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{exec.id.slice(0, 12)}…</span>
              </td>
              <td className="px-4 py-3"><StatusBadge status={exec.status} size="sm" /></td>
              <td className="px-4 py-3">
                <span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{exec.workerName}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs capitalize ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{exec.triggeredBy}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{formatRelative(exec.startTime)}</span>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{formatDuration(exec.duration)}</span>
              </td>
              <td className="px-4 py-3">
                {exec.status === 'RUNNING' && (
                  <button
                    onClick={() => killExecution(exec.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
                  >
                    <StopCircle className="w-3 h-3" />Kill
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Latest logs */}
      {flowExecs[0]?.logs?.length > 0 && (
        <div className="p-4">
          <h3 className={`text-xs font-medium mb-2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Latest Execution Logs</h3>
          <div className={`rounded-lg p-3 font-mono text-xs space-y-0.5 max-h-48 overflow-auto ${dark ? 'bg-gray-950' : 'bg-gray-900'}`}>
            {flowExecs[0].logs.map((log, i) => (
              <div key={i} className={log.type === 'error' ? 'text-red-400' : log.type === 'output' ? 'text-emerald-400' : 'text-gray-300'}>
                {log.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main FlowDetail ─────────────────────────────────────────────────────────

const FlowDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { flows, deleteFlow, executeFlow, updateFlow } = useKestraStore();
  const { workers, statuses, getWorker } = useWorkerStore();

  const tabParam = (searchParams.get('tab') as TabId) || 'overview';
  const highlightExec = searchParams.get('exec') || undefined;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam);
  const [showSchedule, setShowSchedule] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const flow = flows.find(f => f.id === id);
  const worker = flow ? getWorker(flow.workerId) : undefined;
  const workerStatus = worker ? (statuses[worker.id] ?? 'unknown') : null;
  const canRun = workerStatus === 'connected';

  useEffect(() => { setActiveTab(tabParam); }, [tabParam]);

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
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    if (!id) return;
    deleteFlow(id);
    navigate('/flows');
  };

  const handleScheduleSave = (schedule: { cron: string; enabled: boolean; timezone: string } | null) => {
    if (!id) return;
    updateFlow(id, { schedule });
    setShowSchedule(false);
  };

  if (!flow) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-sm font-medium">Flow not found</p>
        <button onClick={() => navigate('/flows')} className="text-sm text-purple-400 hover:text-purple-300">← Back to Flows</button>
      </div>
    );
  }

  const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'executions', label: 'Executions', icon: Activity },
    { id: 'edit', label: 'Edit', icon: Edit3 },
  ];

  const WorkerStatusIcon = workerStatus === 'connected' ? Wifi : workerStatus === 'disconnected' ? WifiOff : Server;

  return (
    <div className={`h-full flex flex-col ${dark ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
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
                  <span className={`text-xs ${dark ? 'text-gray-700' : 'text-gray-300'}`}>·</span>
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
              {running ? 'Running…' : 'Execute'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-5">
          {TABS.map(tab => {
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

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'overview' && (
          <div className="h-full overflow-auto p-6">
            <div className="grid grid-cols-3 gap-5">
              {/* Diagram */}
              <div className={`col-span-2 rounded-xl border overflow-hidden ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`} style={{ height: 380 }}>
                <ReadOnlyDiagram flow={flow} dark={dark} />
              </div>

              {/* Info sidebar */}
              <div className="space-y-4">
                {/* Worker card */}
                <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                  <h3 className={`text-xs font-medium mb-3 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Worker</h3>
                  {worker ? (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: worker.color + '22' }}>
                        <Server className="w-4 h-4" style={{ color: worker.color }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{worker.name}</p>
                        <p className={`text-xs font-mono ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{worker.url}</p>
                      </div>
                      <WorkerStatusIcon className={`w-4 h-4 ml-auto ${
                        workerStatus === 'connected' ? 'text-emerald-400' :
                        workerStatus === 'disconnected' ? 'text-red-400' : 'text-gray-400'
                      }`} />
                    </div>
                  ) : (
                    <p className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>No worker assigned</p>
                  )}
                </div>

                {/* Flow details */}
                <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                  <h3 className={`text-xs font-medium mb-3 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Details</h3>
                  <dl className="space-y-2 text-sm">
                    {[
                      { label: 'Namespace', value: flow.namespace },
                      { label: 'Nodes', value: (flow.nodes || []).length },
                      { label: 'Created', value: new Date(flow.createdAt).toLocaleDateString() },
                      { label: 'Updated', value: formatRelative(flow.updatedAt) },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between">
                        <dt className={dark ? 'text-gray-500' : 'text-gray-400'}>{label}</dt>
                        <dd className={`font-medium ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* Schedule */}
                <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className={`text-xs font-medium ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Schedule</h3>
                    <button onClick={() => setShowSchedule(true)} className="text-xs text-purple-400 hover:text-purple-300">
                      {flow.schedule ? 'Edit' : 'Add'}
                    </button>
                  </div>
                  {flow.schedule ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${flow.schedule.enabled ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                        <span className={`text-xs ${flow.schedule.enabled ? 'text-emerald-400' : dark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {flow.schedule.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <code className={`block text-sm font-mono ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{flow.schedule.cron}</code>
                    </div>
                  ) : (
                    <p className={`text-xs ${dark ? 'text-gray-600' : 'text-gray-400'}`}>No schedule</p>
                  )}
                </div>

                {/* Last execution */}
                {flow.lastExecution && (
                  <div className={`rounded-xl border p-4 ${dark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                    <h3 className={`text-xs font-medium mb-3 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Last Execution</h3>
                    <div className="space-y-2">
                      <StatusBadge status={flow.lastExecution.status} />
                      <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{formatRelative(flow.lastExecution.startTime)}</p>
                      {flow.lastExecution.duration !== null && (
                        <p className={`text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Duration: {formatDuration(flow.lastExecution.duration)}</p>
                      )}
                      <button onClick={() => switchTab('executions')} className="text-xs text-purple-400 hover:text-purple-300">
                        View all executions →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'executions' && (
          <div className={`h-full overflow-auto ${dark ? 'bg-gray-900' : 'bg-white'}`}>
            <ExecutionsTab flowId={flow.id} dark={dark} highlightId={highlightExec} />
          </div>
        )}

        {activeTab === 'edit' && (
          <EditorTab flow={flow} onSaved={() => {}} />
        )}
      </div>

      {showSchedule && (
        <ScheduleModal
          flow={flow as any}
          onClose={() => setShowSchedule(false)}
          onSave={handleScheduleSave as any}
        />
      )}
    </div>
  );
};

export default FlowDetail;
