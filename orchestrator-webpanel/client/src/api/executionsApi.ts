// Executions domain client.
import { apiClient } from './http';

export const executionsApi = {
  get: <T = any>(id: string): Promise<T> => apiClient.get(`/api/v1/executions/${id}`),
  list: <T = any>(query = ''): Promise<T> => apiClient.get(`/api/v1/executions${query}`),
  kill: <T = any>(id: string): Promise<T> => apiClient.post(`/api/v1/executions/${id}/kill`),
  rename: <T = any>(id: string, displayName: string): Promise<T> => apiClient.patch(`/api/v1/executions/${id}`, { displayName }),
  remove: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/executions/${encodeURIComponent(id)}`),
};
