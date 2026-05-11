import { Node } from 'reactflow';
import { FlowState, ConsoleMessage } from '../types';
import { apiClient, StreamLogEntry } from '../../utils/apiClient';
import { pathUtils } from '../../utils/pathUtils';
import { prettyFormat } from '../utils/formatUtils';
import { collectVariables, updateVariableNodes } from '../utils/variableUtils';
import { useFlowLibraryStore } from '../flowLibraryStore';
import { useSessionStore } from '../sessionStore';

// Resolve the workerId for the current session's linked flow, if any.
// Single-node executions and the local flow walker pass this through to the
// server so script-type jobs get dispatched to the assigned worker.
function resolveWorkerIdForActiveSession(): string | null {
  try {
    const active = useSessionStore.getState().getActiveSession();
    const linkedFlowId = active?.linkedFlowId;
    if (!linkedFlowId) return null;
    const flow = useFlowLibraryStore.getState().flows.find(f => f.id === linkedFlowId);
    return flow?.workerId || null;
  } catch { return null; }
}

/**
 * Node execution logic
 * Handles execution of individual nodes based on their type
 */

type SessionStoreGetter = () => {
  getActiveFlowState: () => FlowState | null;
  updateActiveFlowState: (updates: Partial<FlowState>) => void;
  getSession: (sessionId: string) => any;
};

/**
 * Internal node executor - handles all node types
 * @param nodeId - The ID of the node to execute
 * @param fromFlowExecution - Whether this is called from flow execution (affects input handling)
 * @param sessionStore - Session store getter function
 */
export async function executeNode(
  nodeId: string,
  fromFlowExecution: boolean,
  sessionStore: SessionStoreGetter
): Promise<{ error?: any }> {
  let activeFlowState = sessionStore().getActiveFlowState();
  if (!activeFlowState) return {};

  const updateFlowState = (updates: Partial<FlowState>) => {
    sessionStore().updateActiveFlowState(updates);
  };

  // Check if the node is already executing
  if (activeFlowState.nodeLoading[nodeId]) {
    // Node is already running, show a message in the console
    updateFlowState({
      consoleMessages: [...activeFlowState.consoleMessages, {
        nodeId,
        type: 'error',
        message: `Cannot execute node: already running`,
        timestamp: Date.now(),
      }],
    });
    return { error: 'already running' };
  }

  updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: true } });
  const node = activeFlowState.nodes.find((n) => n.id === nodeId);
  if (!node) return {};

  // Live status overlay (consumed by the node file tree). Cleared/refreshed by
  // the flow walker at the start of each run.
  activeFlowState = sessionStore().getActiveFlowState()!;
  updateFlowState({
    nodes: activeFlowState.nodes.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, executionStatus: 'running' } } : n
    ),
  });

  const addLog = (type: ConsoleMessage['type'], message: string) => {
    activeFlowState = sessionStore().getActiveFlowState()!;
    updateFlowState({
      consoleMessages: [...activeFlowState.consoleMessages, {
        nodeId,
        type,
        message,
        timestamp: Date.now(),
      }],
    });
  };

  try {
    let result: any, log: any, error: any;
    let hasStreamedError = false; // Track if errors were already streamed via polling

    if (node.data.type === 'goto') {
      await executeGotoNode(nodeId, sessionStore, updateFlowState, addLog);
      return {};
    } else if (node.data.type === 'variable') {
      result = executeVariableNode(node);
    } else if (node.data.type === 'flow') {
      const executionResult = await executeFlowNode(nodeId, node, sessionStore, updateFlowState, addLog);
      result = executionResult.result;
      error = executionResult.error;
      hasStreamedError = executionResult.hasStreamedError;
    } else {
      const executionResult = await executeRegularNode(
        nodeId,
        node,
        fromFlowExecution,
        sessionStore,
        updateFlowState,
        addLog
      );
      result = executionResult.result;
      error = executionResult.error;
      hasStreamedError = executionResult.hasStreamedError;
    }

    updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });

    // Display final output
    if (result !== undefined && result !== null && typeof result === 'object' && 'output' in result) {
      addLog('output', prettyFormat(result.output));
    } else if (result !== undefined && result !== null) {
      addLog('output', prettyFormat(result));
    }

    // Log error if job failed or timed out (only if not already streamed)
    if (error && !hasStreamedError) {
      addLog('error', error);
    }

    // Update node data with result, status overlay and clear jobId
    updateFlowState({
      nodes: activeFlowState.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, output: result, jobId: undefined, executionStatus: error ? 'failed' : 'success' } } : n
      ),
    });

    return { error: error || undefined };
  } catch (error: any) {
    addLog('error', `Error: ${error instanceof Error ? error.message : String(error)}`);
    updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });

    // Clear the job ID when an error occurs
    updateFlowState({
      nodes: activeFlowState.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, jobId: undefined, executionStatus: 'failed' } } : n
      ),
    });

    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute a goto node
 */
async function executeGotoNode(
  nodeId: string,
  sessionStore: SessionStoreGetter,
  updateFlowState: (updates: Partial<FlowState>) => void,
  addLog: (type: ConsoleMessage['type'], message: string) => void
): Promise<void> {
  // When executing individually, goto nodes just pass through their input
  // They don't evaluate conditions or forward input
  let activeFlowState = sessionStore().getActiveFlowState()!;
  const inEdges = activeFlowState.edges.filter(e => e.target === nodeId);
  const inputNodes = inEdges
    .map(e => {
      activeFlowState = sessionStore().getActiveFlowState()!;
      return activeFlowState.nodes.find(n => n.id === e.source);
    })
    .filter((n): n is Node => n !== undefined);
  const inputs = await Promise.all(inputNodes.map(n => n.data.type === 'variable' ? n.data.value : n.data.output));
  const processedInputs = inputs.length === 1 ? inputs[0] : inputs;

  updateFlowState({
    nodes: activeFlowState.nodes.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, output: processedInputs, gotoDecision: null } } : n
    ),
  });
  updateFlowState({ nodeLoading: { ...activeFlowState.nodeLoading, [nodeId]: false } });
}

/**
 * Execute a variable node
 */
function executeVariableNode(node: Node): any {
  // Parse JSON if possible, otherwise use raw value
  const rawValue = node.data.value || '';
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * Execute a flow node (nested flow execution)
 */
async function executeFlowNode(
  nodeId: string,
  node: Node,
  sessionStore: SessionStoreGetter,
  updateFlowState: (updates: Partial<FlowState>) => void,
  addLog: (type: ConsoleMessage['type'], message: string) => void
): Promise<{ result: any; error: any; hasStreamedError: boolean }> {
  let activeFlowState = sessionStore().getActiveFlowState()!;
  let result: any, error: any;
  let hasStreamedError = false;

  try {
    // Start execution time tracking
    const startTime = Date.now();

    // Get the flow content - either from linked session or from node's code
    let flowContent = node.data.code;

    // If flow node is linked to a session, get current content from that session
    if (node.data.linkedSessionId) {
      const linkedSession = sessionStore().getSession(node.data.linkedSessionId);
      if (linkedSession && linkedSession.flowState) {
        // Serialize the linked session's current flow state
        flowContent = JSON.stringify({
          nodes: linkedSession.flowState.nodes,
          edges: linkedSession.flowState.edges
        });
      }
    }

    if (!flowContent) {
      throw new Error('No flow content specified');
    }

    // Find input nodes and sort them by connection order
    activeFlowState = sessionStore().getActiveFlowState()!;
    const inputEdges = activeFlowState.edges.filter(e => e.target === nodeId);
    const inputNodes = inputEdges
      .map(e => {
        activeFlowState = sessionStore().getActiveFlowState()!;
        return activeFlowState.nodes.find(n => n.id === e.source);
      })
      .filter((n): n is Node => n !== undefined);

    // Get input values from connected nodes
    const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
      if (inputNode.data.type === 'variable') {
        // Parse JSON if possible
        try {
          return JSON.parse(inputNode.data.value || '');
        } catch {
          return inputNode.data.value;
        }
      }
      return inputNode.data.output;
    }));

    // When executing individually, always use predecessor outputs, never injected input
    const processedInputs = inputs.length === 1 ? inputs[0] : inputs;
    if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));

    addLog('log', `Executing flow: ${node.data.label || 'Flow'}`);

    // Submit job via HTTP API - flow content is always JSON
    const jobRequest: any = {
      type: 'flow',
      code: flowContent,
      input: processedInputs,
      timeout: activeFlowState.nodeExecutionTimeout,
      workerId: resolveWorkerIdForActiveSession(),
    };

    try {
      const { jobId } = await apiClient.submitJob(jobRequest);

      // Store the job ID in the node data for potential termination
      activeFlowState = sessionStore().getActiveFlowState()!;
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, jobId } } : n
        ),
      });

      // Poll for job completion with streaming logs
      const jobResult = await apiClient.pollJobStatus(
        jobId,
        undefined, // onProgress
        500, // poll interval (faster for real-time feel)
        (logEntry: StreamLogEntry) => {
          if (logEntry.type === 'error') hasStreamedError = true;
          addLog(logEntry.type as ConsoleMessage['type'], logEntry.message);
        }
      );

      // Process the result from the flow execution
      result = jobResult.output;
      error = jobResult.error;

      // Calculate execution time - use the one from backend if available, otherwise calculate locally
      const executionTime = jobResult.executionTime || (Date.now() - startTime);

      // Store execution time in node data
      node.data.executionTime = executionTime;

      // Ensure the node data is updated with the nested flow execution result and clear jobId
      activeFlowState = sessionStore().getActiveFlowState()!;
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, output: result, executionTime, jobId: undefined } } : n
        ),
      });
    } catch (err) {
      error = (err as Error).message;
      // Clear jobId on error as well
      activeFlowState = sessionStore().getActiveFlowState()!;
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, jobId: undefined } } : n
        ),
      });
    }
  } catch (err) {
    error = (err as Error).message;
  }

  return { result, error, hasStreamedError };
}

/**
 * Execute a regular node (JavaScript, backend, etc.)
 */
async function executeRegularNode(
  nodeId: string,
  node: Node,
  fromFlowExecution: boolean,
  sessionStore: SessionStoreGetter,
  updateFlowState: (updates: Partial<FlowState>) => void,
  addLog: (type: ConsoleMessage['type'], message: string) => void
): Promise<{ result: any; error: any; hasStreamedError: boolean }> {
  let activeFlowState = sessionStore().getActiveFlowState()!;
  let result: any, error: any;
  let hasStreamedError = false;

  // Find input nodes and sort them by connection order
  activeFlowState = sessionStore().getActiveFlowState()!;
  const inputEdges = activeFlowState.edges.filter(e => e.target === nodeId);
  const inputNodes = inputEdges
    .map(e => {
      activeFlowState = sessionStore().getActiveFlowState()!;
      return activeFlowState.nodes.find(n => n.id === e.source);
    })
    .filter((n): n is Node => n !== undefined);

  // Check for injected input ONLY when called from flow execution
  let processedInputs: any;
  const injected = fromFlowExecution ? (node.data as any)?._injectedInput : undefined;

  if (typeof injected !== 'undefined') {
    processedInputs = injected;
    delete (node.data as any)?._injectedInput;
    addLog('input', prettyFormat(processedInputs));
    // clear it so it's single-use
    activeFlowState = sessionStore().getActiveFlowState()!;
    updateFlowState({
      nodes: activeFlowState.nodes.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, _injectedInput: undefined } } : n
      ),
    });
  } else {
    const inputs = await Promise.all(inputNodes.map(async (inputNode) => {
      if (inputNode.data.type === 'variable') {
        // Parse JSON if possible
        try {
          return JSON.parse(inputNode.data.value || '');
        } catch {
          return inputNode.data.value;
        }
      }
      return inputNode.data.output;
    }));
    processedInputs = inputs.length === 1 ? inputs[0] : inputs;
    if (inputs.length > 0) addLog('input', prettyFormat(processedInputs));
  }

  const originalConsoleLog = console.log;
  let code = node.data.code?.trim() || '';

  // --- NEW: Run JS directly if language is javascript ---
  if (node.data.language === 'javascript') {
    try {
      // Start execution time tracking
      const startTime = Date.now();

      // Generate a job ID for this execution
      const jobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2);

      // Store the job ID in the node data for potential termination
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, jobId } } : n
        ),
      });

      // Collect variables from all Variable nodes
      activeFlowState = sessionStore().getActiveFlowState()!;
      const variables = collectVariables(activeFlowState.nodes);
      const varNames = Object.keys(variables);

      let code = node.data.code?.trim() || '';
      const logBuffer: any[] = [];
      console.log = (...args) => {
        args.forEach(arg => addLog('log', prettyFormat(arg)));
        logBuffer.push(args);
      };

      // Build wrapped code that injects variables and captures them after execution
      if (/^function\s*\w*\s*\(/.test(code)) {
        // Function-style code
        const fn = new Function(`${code}; return process(arguments[0]);`);
        result = fn(processedInputs);
      } else {
        // Expression or statement-style code
        // Inject variables as parameters and capture them after execution
        const varDeclarations = varNames.map(name => `let ${name} = __variables["${name}"];`).join('\n');
        const varCapture = `const __capturedVars = { ${varNames.join(', ')} };`;

        const wrappedCode = `
          ${varDeclarations}
          let __result;
          ${code.includes('return') ? `__result = (function(input) { ${code} })(input);` : `__result = (${code});`}
          ${varCapture}
          return { __result, __capturedVars };
        `;

        const fn = new Function('input', '__variables', wrappedCode);
        const execResult = fn(processedInputs, variables);
        result = execResult.__result;

        // Update variable nodes with modified values
        if (execResult.__capturedVars && Object.keys(execResult.__capturedVars).length > 0) {
          activeFlowState = sessionStore().getActiveFlowState()!;
          const updatedNodes = updateVariableNodes(activeFlowState.nodes, execResult.__capturedVars);
          updateFlowState({ nodes: updatedNodes });
        }
      }
      console.log = originalConsoleLog;

      // Calculate execution time
      const executionTime = Date.now() - startTime;

      // Store execution time in node data
      node.data.executionTime = executionTime;
    } catch (err) {
      console.log = originalConsoleLog;
      error = (err as Error).message;
    }
  } else {
    // --- FALLBACK: Use backend for Groovy/Batch etc ---
    if (node.data.code) {
      // Start execution time tracking
      const startTime = Date.now();

      let codeFilePath = node.data.codeFilePath;
      const flowPath = activeFlowState.flowPath;
      const basePath = flowPath ? pathUtils.dirname(flowPath) : undefined;
      if (codeFilePath) {
        if (!pathUtils.isAbsolute(codeFilePath) && flowPath) {
          codeFilePath = pathUtils.join(pathUtils.dirname(flowPath), codeFilePath);
        }
      }

      // Collect variables from all Variable nodes
      activeFlowState = sessionStore().getActiveFlowState()!;
      const variables = collectVariables(activeFlowState.nodes);

      // Submit job via HTTP API
      const jobRequest: any = {
        type: node.data.type,
        code: node.data.code,
        codeFilePath: codeFilePath,
        input: processedInputs,
        timeout: activeFlowState.nodeExecutionTimeout,
        basePath: basePath,
        variables: variables,
        workerId: resolveWorkerIdForActiveSession(),
      };

      const { jobId } = await apiClient.submitJob(jobRequest);

      // Store the job ID in the node data for potential termination
      updateFlowState({
        nodes: activeFlowState.nodes.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, jobId } } : n
        ),
      });

      // Poll for job completion with streaming logs
      const jobResult = await apiClient.pollJobStatus(
        jobId,
        undefined, // onProgress
        500, // poll interval (faster for real-time feel)
        (logEntry: StreamLogEntry) => {
          if (logEntry.type === 'error') hasStreamedError = true;
          addLog(logEntry.type as ConsoleMessage['type'], logEntry.message);
        }
      );

      result = jobResult.output !== '[]' ? jobResult.output : null;
      error = jobResult.error;

      // Update variable nodes with returned modified variables
      if (jobResult.variables && Object.keys(jobResult.variables).length > 0) {
        activeFlowState = sessionStore().getActiveFlowState()!;
        const updatedNodes = updateVariableNodes(activeFlowState.nodes, jobResult.variables);
        updateFlowState({ nodes: updatedNodes });
      }

      // Calculate execution time
      const executionTime = jobResult.executionTime || (Date.now() - startTime);

      // Store execution time in node data
      node.data.executionTime = executionTime;
    }
  }

  return { result, error, hasStreamedError };
}
