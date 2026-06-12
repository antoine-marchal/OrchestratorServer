// api/ layer barrel. `apiClient` is the low-level HTTP transport (auth, refresh,
// generic verbs, binary up/download); the per-domain clients wrap it with named
// methods so views and stores call `secretsApi.list()` instead of hand-writing
// URL strings. Binary upload/download stay on apiClient directly.
export { apiClient, getJwt, setJwt, clearJwt } from './http';
export type { StreamLogEntry } from './http';

export { flowsApi } from './flowsApi';
export { flowGitApi } from './flowGitApi';
export { executionsApi } from './executionsApi';
export { secretsApi } from './secretsApi';
export { workersApi } from './workersApi';
export { schedulesApi } from './schedulesApi';
export { usersApi } from './usersApi';
