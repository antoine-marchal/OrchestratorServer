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
    // Admin section is visible to operators too — but they only see the
    // Secrets tab (no Users management) and can't reveal/delete secrets.
    canAccessAdmin: role === 'admin' || role === 'operator',
    canManageUsers: role === 'admin',
    canRevealSecret: role === 'admin',
    canDeleteSecret: role === 'admin',
    canCreateSecret: role === 'admin' || role === 'operator',
  };
}
