// Schedules domain client (cron + api-trigger).
import { apiClient } from './http';

export const schedulesApi = {
  listAll: <T = any>(): Promise<T> => apiClient.get('/api/v1/schedules'),
  listByFlow: <T = any>(flowId: string): Promise<T> => apiClient.get(`/api/v1/schedules?flowId=${encodeURIComponent(flowId)}`),
  create: <T = any>(target: string, body: any): Promise<T> => apiClient.post(`/api/v1/schedules/${target}`, body),
  update: <T = any>(id: string, body: any): Promise<T> => apiClient.patch(`/api/v1/schedules/${id}`, body),
  setEnabled: <T = any>(id: string, enabled: boolean): Promise<T> => apiClient.patch(`/api/v1/schedules/${id}`, { enabled }),
  remove: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/schedules/${id}`),
};
