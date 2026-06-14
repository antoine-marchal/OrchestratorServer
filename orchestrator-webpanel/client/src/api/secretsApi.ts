// Secrets domain client — named methods over the HTTP transport so views/stores
// don't hand-write URL strings.
import { apiClient } from './http';

export const secretsApi = {
  list: <T = any>(): Promise<T> => apiClient.get('/api/v1/secrets'),
  create: <T = any>(body: any): Promise<T> => apiClient.post('/api/v1/secrets', body),
  remove: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/secrets/${id}`),
  reveal: <T = any>(id: string): Promise<T> => apiClient.get(`/api/v1/secrets/${id}/reveal`),
};
