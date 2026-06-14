// Flows domain client (CRUD + execute + artifacts). Binary artifact upload/
// download stay on the transport (apiClient.uploadBinary/downloadBinary) since
// they carry progress callbacks and raw bodies.
import { apiClient } from './http';

export const flowsApi = {
  list: <T = any>(): Promise<T> => apiClient.get('/api/v1/flows'),
  update: <T = any>(id: string, body: any): Promise<T> => apiClient.put(`/api/v1/flows/${id}`, body),
  remove: <T = any>(id: string): Promise<T> => apiClient.delete(`/api/v1/flows/${id}`),
  createVersion: <T = any>(id: string): Promise<T> => apiClient.post(`/api/v1/flows/${id}/versions`, {}),
  execute: <T = any>(id: string, body: any): Promise<T> => apiClient.post(`/api/v1/flows/${id}/execute`, body),
  deleteArtifact: <T = any>(id: string, name: string): Promise<T> => apiClient.delete(`/api/v1/flows/${id}/artifacts/${encodeURIComponent(name)}`),
};
