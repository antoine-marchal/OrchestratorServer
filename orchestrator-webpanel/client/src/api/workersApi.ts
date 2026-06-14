// Workers domain client.
import { apiClient } from './http';

export const workersApi = {
  list: <T = any>(): Promise<T> => apiClient.get('/api/v1/workers'),
  update: <T = any>(id: string, body: any): Promise<T> => apiClient.patch(`/api/v1/workers/${id}`, body),
  setGroupAccess: <T = any>(group: string, body: any): Promise<T> => apiClient.patch(`/api/v1/workers/groups/${group}/access`, body),
  deleteRecord: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/workers/${id}/record`),
};
