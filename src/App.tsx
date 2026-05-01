import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import KestrasLayout from './components/kestra/KestrasLayout';
import FlowsList from './components/kestra/FlowsList';
import FlowDetail from './components/kestra/FlowDetail';
import ExecutionsList from './components/kestra/ExecutionsList';
import WorkersPanel from './components/kestra/WorkersPanel';
import EditorPage from './components/kestra/EditorPage';
import { useSessionStore } from './store/sessionStore';
import { useWorkerStore } from './store/workerStore';
import { useKestraStore } from './store/kestraStore';

function App() {
  const { loadSessions } = useSessionStore();
  const { loadWorkers, checkAllStatuses } = useWorkerStore();
  const { loadAll, resumePolling, startScheduler } = useKestraStore();

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
        <Route element={<KestrasLayout />}>
          <Route path="/flows" element={<FlowsList />} />
          <Route path="/flows/:id" element={<FlowDetail />} />
          <Route path="/executions" element={<ExecutionsList />} />
          <Route path="/workers" element={<WorkersPanel />} />
          <Route path="/editor" element={<EditorPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
