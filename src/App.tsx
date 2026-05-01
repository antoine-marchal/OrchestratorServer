import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/flows/AppLayout';
import FlowsList from './components/flows/FlowsList';
import FlowDetail from './components/flows/FlowDetail';
import ExecutionsList from './components/flows/ExecutionsList';
import WorkersPanel from './components/flows/WorkersPanel';
import { useSessionStore } from './store/sessionStore';
import { useWorkerStore } from './store/workerStore';
import { useFlowLibraryStore } from './store/flowLibraryStore';

function App() {
  const { loadSessions } = useSessionStore();
  const { loadWorkers, checkAllStatuses } = useWorkerStore();
  const { loadAll, resumePolling, startScheduler } = useFlowLibraryStore();

  useEffect(() => {
    loadSessions();
    loadWorkers();
    loadAll();
    resumePolling();
    startScheduler();
    checkAllStatuses();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route element={<AppLayout />}>
          <Route path="/flows" element={<FlowsList />} />
          <Route path="/flows/:id" element={<FlowDetail />} />
          <Route path="/executions" element={<ExecutionsList />} />
          <Route path="/workers" element={<WorkersPanel />} />
        </Route>
        <Route path="/editor" element={<Navigate to="/flows" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
