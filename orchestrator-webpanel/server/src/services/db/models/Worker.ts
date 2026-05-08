export interface Worker {
  _id: string;
  name: string;
  assignedUserId: string;
  apiKeyId: string;
  capabilities: string[];
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
}
