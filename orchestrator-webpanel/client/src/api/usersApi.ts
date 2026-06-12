// Users domain client (accounts + API keys + password).
import { apiClient } from './http';

export const usersApi = {
  list: <T = any>(): Promise<T> => apiClient.get('/api/v1/users'),
  create: <T = any>(body: any): Promise<T> => apiClient.post('/api/v1/users', body),
  remove: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/users/${id}`),
  createApiKey: <T = any>(userId: string, body: any): Promise<T> => apiClient.post(`/api/v1/users/${userId}/apikeys`, body),
  deleteApiKey: <T = any>(userId: string, keyId: string): Promise<T> => apiClient.delete(`/api/v1/users/${userId}/apikeys/${keyId}`),
  setPassword: <T = any>(userId: string, password: string): Promise<T> => apiClient.patch(`/api/v1/users/${userId}/password`, { password }),
};
