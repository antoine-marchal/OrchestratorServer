// Flow git-versioning domain client: branches, versions, checkout/reset/restore.
import { apiClient } from './http';

export const flowGitApi = {
  branches: <T = any>(flowId: string): Promise<T> => apiClient.get(`/api/v1/flows/${flowId}/branches`),
  versions: <T = any>(flowId: string): Promise<T> => apiClient.get(`/api/v1/flows/${flowId}/versions`),
  version: <T = any>(flowId: string, vid: string): Promise<T> => apiClient.get(`/api/v1/flows/${flowId}/versions/${vid}`),
  checkout: <T = any>(flowId: string, branch: string): Promise<T> => apiClient.post(`/api/v1/flows/${flowId}/branches/${encodeURIComponent(branch)}/checkout`, {}),
  createBranch: <T = any>(flowId: string, name: string): Promise<T> => apiClient.post(`/api/v1/flows/${flowId}/branches`, { name }),
  deleteBranch: <T = any>(flowId: string, branch: string): Promise<T> => apiClient.delete(`/api/v1/flows/${flowId}/branches/${encodeURIComponent(branch)}`),
  reset: <T = any>(flowId: string, branch: string, commit: string, mode: string): Promise<T> => apiClient.post(`/api/v1/flows/${flowId}/branches/${encodeURIComponent(branch)}/reset`, { commit, mode }),
  restoreVersion: <T = any>(flowId: string, vid: string): Promise<T> => apiClient.post(`/api/v1/flows/${flowId}/versions/${vid}/restore`, {}),
};
