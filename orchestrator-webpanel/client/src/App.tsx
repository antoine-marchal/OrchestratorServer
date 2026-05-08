import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/flows/AppLayout';
import FlowsList from './components/flows/FlowsList';
import FlowDetail from './components/flows/FlowDetail';
import ExecutionsList from './components/flows/ExecutionsList';
import WorkersPanel from './components/flows/WorkersPanel';
import AdminLayout from './components/admin/AdminLayout';
import LoginPage from './components/LoginPage';
import { getJwt } from './utils/apiClient';
import { useSessionStore } from './store/sessionStore';
import { useFlowLibraryStore } from './store/flowLibraryStore';

// Redirects to /login if no JWT is present.
const PrivateRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  return getJwt() ? element : <Navigate to="/login" replace />;
};

function App() {
  const { loadSessions } = useSessionStore();
  const { loadAll, resumePolling, startScheduler } = useFlowLibraryStore();

  useEffect(() => {
    if (!getJwt()) return; // don't load if not authenticated
    loadSessions();
    loadAll();
    resumePolling();
    startScheduler();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute element={<Navigate to="/flows" replace />} />} />
        <Route element={<PrivateRoute element={<AppLayout />} />}>
          <Route path="/flows" element={<FlowsList />} />
          <Route path="/flows/:id" element={<FlowDetail />} />
          <Route path="/executions" element={<ExecutionsList />} />
          <Route path="/workers" element={<WorkersPanel />} />
          <Route path="/admin" element={<AdminLayout />} />
        </Route>
        <Route path="/editor" element={<Navigate to="/flows" replace />} />
        <Route path="*" element={<Navigate to="/flows" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;
