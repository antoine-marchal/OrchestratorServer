// Back-compat shim. The HTTP transport moved to ../api/http as part of the api/
// layer (transport + per-domain clients). Existing imports of
// `../utils/apiClient` keep working; new code should import from `../api`.
export { apiClient, getJwt, setJwt, clearJwt } from '../api/http';
export type { StreamLogEntry } from '../api/http';
