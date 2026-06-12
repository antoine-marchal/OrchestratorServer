// Accessibility policy for a worker. When absent the worker is open to every
// user. `mode: 'allow'` = ONLY the listed roles/users may select & execute on
// it; `mode: 'deny'` = the listed roles/users are forbidden, everyone else may.
// Roles are role names (admin/operator/viewer); users are logins. Admins always
// retain access regardless of policy (so they can never lock themselves out).
export interface WorkerAccess {
  mode: 'allow' | 'deny';
  roles: string[];
  users: string[];
}

export interface Worker {
  _id: string;
  name: string;
  platform: 'win32' | 'linux' | 'darwin' | 'unknown';
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
  assignedUserId?: string;
  group?: string;
  access?: WorkerAccess | null;
}
