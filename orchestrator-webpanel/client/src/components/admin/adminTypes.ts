// Shared types for the admin views (AdminLayout + extracted pieces).

export interface ApiKey {
  id: string;
  label: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface User {
  _id: string;
  login: string;
  role: string;
  createdAt: string;
  apiKeys: ApiKey[];
}

export interface Secret {
  _id: string;
  name: string;
  scope: 'global' | 'flow' | 'worker';
  flowId?: string;
  workerId?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerOption {
  _id: string;
  name: string;
}

export type AdminTab = 'users' | 'secrets';
