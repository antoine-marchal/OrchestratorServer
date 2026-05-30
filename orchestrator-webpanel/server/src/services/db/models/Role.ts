export interface Role {
  _id: string;
  name: string;
  permissions: string[];
}

export const DEFAULT_ROLES: Omit<Role, '_id'>[] = [
  {
    name: 'admin',
    permissions: ['*'],
  },
  {
    name: 'operator',
    permissions: ['flows:read', 'flows:write', 'executions:read', 'executions:write', 'secrets:read', 'schedules:read', 'schedules:write'],
  },
  {
    name: 'viewer',
    permissions: ['flows:read', 'executions:read'],
  },
];
