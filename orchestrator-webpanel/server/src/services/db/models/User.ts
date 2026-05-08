export interface ApiKey {
  id: string;
  label: string;
  keyHash: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface User {
  _id: string;
  login: string;
  passwordHash: string;
  role: string;
  apiKeys: ApiKey[];
  createdAt: string;
  updatedAt: string;
}
