export function useAuth() {
  const raw = localStorage.getItem('orchestrator_user');
  let role = 'viewer';
  if (raw) {
    try { role = JSON.parse(raw)?.role ?? 'viewer'; } catch { /* */ }
  }
  return {
    role,
    isAdmin: role === 'admin',
    isOperator: role === 'operator' || role === 'admin',
    isViewer: role === 'viewer',
    canEdit: role === 'admin' || role === 'operator',
    canDeleteWorker: role === 'admin',
    canAccessAdmin: role === 'admin',
  };
}
