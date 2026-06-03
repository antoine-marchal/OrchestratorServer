import React, { useRef, useEffect, useCallback, memo } from "react";
import { NodeData } from '../../types/node';
import { useFlowStore } from '../../store/sessionFlowStore';
import { useSessionStore } from '../../store/sessionStore';

// Function to format execution time in seconds or minutes
const formatExecutionTime = (timeMs: number): string => {
  if (timeMs < 60000) return `${(timeMs / 1000).toFixed(1)} sec`;
  return `${(timeMs / 60000).toFixed(1)} min`;
};

interface NodeBodyProps {
  data: NodeData;
  nodeId: string;
  isEditing: boolean;
  onCodeChange: (value: string | undefined) => void;
  expanded: boolean;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

export const NodeBody: React.FC<NodeBodyProps> = memo((
  { data, nodeId, expanded, setExpanded }
) => {
  const { updateZoomOnScroll, updatePanOnDrag, updateNodeDraggable, setOutputZoneActive } = useFlowStore();
  const outputRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    updateNodeDraggable(nodeId, false);
    updatePanOnDrag(false);
    updateZoomOnScroll(false);
    setOutputZoneActive(true);
  }, [nodeId, updateNodeDraggable, updatePanOnDrag, updateZoomOnScroll, setOutputZoneActive]);

  const handleMouseLeave = useCallback(() => {
    updateNodeDraggable(nodeId, true);
    updatePanOnDrag(true);
    updateZoomOnScroll(true);
    setOutputZoneActive(false);
  }, [nodeId, updateNodeDraggable, updatePanOnDrag, updateZoomOnScroll, setOutputZoneActive]);

  // Make the output zone scroll independently
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLDivElement;
      target.scrollTop += e.deltaY;
    };
    const el = outputRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => { if (el) el.removeEventListener('wheel', handleWheel); };
  }, []);

  // VARIABLE node - show current runtime value if modified
  if (data.type === 'variable') {
    // If the variable has been modified (output differs from value), show it
    if (data.output !== undefined && data.output !== data.value) {
      const displayValue = typeof data.output === 'object'
        ? JSON.stringify(data.output, null, 1)
        : String(data.output);
      return (
        <div
          className="flex-1 overflow-hidden px-3 py-2 border-b border-gray-400"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-[10px] uppercase tracking-wider text-purple-600 dark:text-purple-400 font-medium mb-1">
            Current Value
          </div>
          <div
            ref={outputRef}
            className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs p-2 font-mono whitespace-pre-wrap w-full break-words max-h-32 overflow-y-auto select-text rounded"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              e.stopPropagation();
              const div = e.currentTarget;
              div.scrollTop += e.deltaY;
            }}
          >
            {displayValue}
          </div>
        </div>
      );
    }
    return null;
  }

  // FLOW node
  if (data.type === 'flow') {
    const { sessions } = useSessionStore();
    const linkedSession = data.linkedSessionId
      ? sessions.find(s => s.id === data.linkedSessionId)
      : null;
    // What the node points at. The session ID is the STABLE identity and is
    // shown verbatim — it must not track the node's title (issue 3).
    const kind = data.linkedSessionId ? 'session' : data.flowRef ? 'flowRef' : 'embedded';
    const headerLabel = kind === 'session'
      ? (linkedSession ? 'Linked Session' : 'Linked Session (closed)')
      : kind === 'flowRef' ? 'Library Flow' : 'Flow';
    const displayName = kind === 'session'
      ? (linkedSession?.name || 'closed session')
      : kind === 'flowRef' ? (data.flowRef as string) : (data.label || 'Unlinked Flow');

    return (
      <div
        className="flex-1 overflow-hidden p-4 border-b border-gray-400"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="text-[10px] uppercase tracking-wider text-emerald-800 dark:text-emerald-400 font-medium">
          {headerLabel}
        </div>
        <div className="text-sm text-gray-400 space-y-2 relative">
          <div className="bg-emerald-100 dark:bg-emerald-900/30 rounded p-2 border border-emerald-700/30">
            <div className="text-emerald-600 dark:text-emerald-300 text-xs font-mono truncate">{displayName}</div>
            {data.linkedSessionId && (
              <div className="text-emerald-700/70 dark:text-emerald-400/60 text-[10px] font-mono truncate mt-0.5" title={data.linkedSessionId}>
                id: {data.linkedSessionId}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-800 dark:text-emerald-400 font-medium">
            {data.executionTime !== undefined ? <>Output ({formatExecutionTime(data.executionTime)}): <br /></> : <>Output: <br /></>}
          </div>
          {data.output !== undefined && (
            <>
              <div
                ref={outputRef}
                className={
                  "bg-emerald-100 text-emerald-600 dark:bg-gray-900 dark:text-green-400 text-xs p-2 font-mono whitespace-pre-wrap w-full break-words " +
                  (expanded ? "max-h-[80vh]" : "max-h-64") +
                  " overflow-y-auto select-text"
                }
                key={`flow-output-${nodeId}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  if (window.getSelection()?.toString()) e.preventDefault();
                }}
                onWheel={(e) => {
                  e.stopPropagation();
                  const div = e.currentTarget;
                  div.scrollTop += e.deltaY;
                }}
              >
                {typeof data.output === 'object' && data.output !== null && 'output' in data.output
                  ? (typeof (data.output as any).output === 'string'
                    ? (data.output as any).output
                    : JSON.stringify((data.output as any).output, null, 1))
                  : (typeof data.output === 'string'
                    ? data.output
                    : JSON.stringify(data.output, null, 1))}
              </div>
              <button
                className="absolute right-5 top-[66px] dark:bg-gray-900 rounded hover:bg-gray-300 dark:hover:bg-gray-800"
                onClick={() => {
                  setExpanded(e => !e);
                  setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
                }}
                aria-label={expanded ? "Collapse output" : "Expand output"}
              >
                {expanded ? "🔼" : "🔽"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // GOTO node
  if (data.type === 'goto') {
    const { nodes, updateNodeData } = useFlowStore();
    const selectableTargets = nodes
      .filter(n => n.data?.type !== 'comment' && n.data?.type !== 'goto')
      .map(n => ({ id: n.id, label: n.data?.label || n.id }));
    type Rule = { expr: string; goto: string | string[]; forwardInput?: boolean };
    const asTargets = (g: string | string[] | undefined): string[] =>
      (Array.isArray(g) ? g : g ? [g] : []).filter(Boolean);
    const [localConds, setLocalConds] = React.useState<Rule[]>(
      Array.isArray(data.conditions) ? data.conditions : []
    );

    React.useEffect(() => {
      setLocalConds(Array.isArray(data.conditions) ? data.conditions : []);
    }, [nodeId, data.conditions]);
    const commit = (next: Rule[]) => {
      setLocalConds(next);
      updateNodeData(nodeId, { conditions: next });
    };
    const updateLocal = (idx: number, patch: Partial<Rule>) => {
      commit(localConds.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    };

    const addCondition = () => {
      commit([...localConds, { expr: '', goto: [], forwardInput: false }]);
    };

    const removeCondition = (idx: number) => {
      commit(localConds.filter((_, i) => i !== idx));
    };



    const commitRow = (idx?: number) => {
      const next = localConds;
      updateNodeData(nodeId, { conditions: next });
    };



    return (
      <div className="px-3 py-2 text-xs text-gray-800 dark:text-gray-200 space-y-2 flex-1 overflow-hidden p-4 border-b border-gray-400">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
          Goto Conditions (JS)
        </div>

        <div className="space-y-3">
          {localConds.map((cond, i) => (
            <div key={i} className="rounded bg-gray-200 dark:bg-gray-800 p-2 space-y-2 border border-gray-400 dark:border-gray-700">
              <label className="block text-[10px] text-gray-800 dark:text-gray-400">Condition</label>
              <input
                value={cond.expr}
                onChange={(e) => updateLocal(i, { expr: e.target.value })}
                onBlur={() => commitRow(i)}
                placeholder="e.g. input < 50"
                className="w-full text-xs bg-gray-100 dark:bg-gray-900 border border-gray-400 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />

              {/* Header row with 'Goto Node(s)' label on the left and the forward toggle on the right */}
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-800 dark:text-gray-400">Goto Node(s)</label>

                <label className="inline-flex items-center gap-2 text-[10px] text-gray-800 dark:text-gray-400">
                  <span>Forward input</span>
                  <input
                    id={`forward-input-${nodeId}-${i}`}
                    type="checkbox"
                    checked={!!cond.forwardInput}
                    onChange={(e) => updateLocal(i, { forwardInput: e.target.checked })}
                    className="h-3 w-3 accent-blue-500"
                  />
                </label>
              </div>

              {/* Multiple destinations: Ctrl/Cmd-click to select more than one.
                  All selected targets execute when the condition matches (issue 4). */}
              <select
                multiple
                value={asTargets(cond.goto)}
                onChange={(e) => updateLocal(i, { goto: Array.from(e.target.selectedOptions, o => o.value) })}
                size={Math.min(Math.max(selectableTargets.length, 2), 6)}
                // Stop ReactFlow's drag/pan from swallowing the click so options
                // are actually selectable with the mouse, and disable node drag
                // while the cursor is over the list.
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 w-full text-xs bg-gray-100 dark:bg-gray-900 border border-gray-400 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {selectableTargets.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
              <div className="text-[9px] text-gray-500 dark:text-gray-500">Ctrl/Cmd-click to target multiple nodes</div>



              <div className="flex justify-end">
                <button
                  onClick={() => removeCondition(i)}
                  className="text-[10px] px-2 py-1 bg-gray-300 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 rounded"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addCondition}
          className="text-[10px] px-2 py-1 bg-gray-200 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 rounded"
        >
          + Add Condition
        </button>
      </div>
    );
  }

  // Regular nodes
  return (
    <div
      className="flex-1 overflow-hidden p-4 border-b border-gray-400"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="text-sm text-gray-400 space-y-2 relative">
        {data.output !== undefined && (
          <>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              {data.executionTime !== undefined ? <>Output ({formatExecutionTime(data.executionTime)}) <br /></> : <>Output <br /></>}
            </div>
            <div
              ref={outputRef}
              className={
                "bg-gray-200 dark:bg-gray-900 text-green-700 dark:text-green-400 text-xs p-2 font-mono whitespace-pre-wrap w-full break-words " +
                (expanded ? "max-h-[80vh]" : "max-h-64") +
                " overflow-y-auto select-text"
              }
              key={`output-${nodeId}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onMouseUp={(e) => {
                e.stopPropagation();
                if (window.getSelection()?.toString()) e.preventDefault();
              }}
              onWheel={(e) => {
                e.stopPropagation();
                const div = e.currentTarget;
                div.scrollTop += e.deltaY;
              }}
            >
              {typeof data.output === 'object' && data.output !== null && 'output' in data.output
                ? (typeof (data.output as any).output === 'string'
                  ? (data.output as any).output
                  : JSON.stringify((data.output as any).output, null, 1))
                : (typeof data.output === 'string'
                  ? data.output
                  : JSON.stringify(data.output, null, 1))}
            </div>
            <button
              className="absolute right-5 top-6 dark:bg-gray-900 rounded hover:bg-gray-300 dark:hover:bg-gray-800"
              onClick={() => {
                setExpanded(e => !e);
                setTimeout(() => window.dispatchEvent(new Event('resize')), 10);
              }}
              aria-label={expanded ? "Collapse output" : "Expand output"}
            >
              {expanded ? "🔼" : "🔽"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  const prevConds = JSON.stringify(prev.data?.conditions ?? []);
  const nextConds = JSON.stringify(next.data?.conditions ?? []);
  return (
    prev.nodeId === next.nodeId &&
    prev.expanded === next.expanded &&
    prev.data?.output === next.data?.output &&
    prevConds === nextConds
  );
});
