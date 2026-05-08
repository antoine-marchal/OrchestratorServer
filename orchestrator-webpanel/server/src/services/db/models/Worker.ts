export interface Worker {
  _id: string;
  name: string;
  platform: 'win32' | 'linux' | 'darwin' | 'unknown';
  status: 'online' | 'offline';
  lastSeenAt: string;
  registeredAt: string;
  assignedUserId?: string;
}
