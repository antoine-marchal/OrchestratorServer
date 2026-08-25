// The single axios instance every module uses to talk to the orchestrator, plus
// the per-worker bearer-token attach. Centralised so the base URL, size limits,
// and auth header live in one place.
import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { ORCHESTRATOR_URL, MAX_HTTP_BYTES, TLS_REJECT_UNAUTHORIZED } from '../config';

const httpsAgent = new https.Agent({
  rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
});

export const http: AxiosInstance = axios.create({
  baseURL: ORCHESTRATOR_URL,
  httpsAgent,
  timeout: 15000,
  maxContentLength: MAX_HTTP_BYTES,
  maxBodyLength: MAX_HTTP_BYTES,
});

// Attach the per-worker token issued at register on every subsequent request.
export function setWorkerToken(token: string): void {
  if (token) http.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete http.defaults.headers.common['Authorization'];
}
