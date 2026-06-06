// Central API client for the Orchestrator webpanel.
// Always talks to the same server (relative URLs — proxied in dev, served directly in prod).
// Auth: JWT token stored in localStorage under 'orchestrator_jwt'.

const JWT_KEY = 'orchestrator_jwt';
const REFRESH_KEY = 'orchestrator_refresh';

interface JobRequest {
  type: string;
  code?: string;
  codeFilePath?: string;
  input?: any;
  timeout?: number;
  basePath?: string;
  variables?: Record<string, any>;
}

interface StreamLogEntry {
  type: 'log' | 'error' | 'output' | 'input' | 'flow';
  message: string;
  nodeId?: string | null;
  /** Ancestor flow-node scope of the emitting node (see execScope.ts). */
  parentScope?: string | null;
  timestamp: number;
}

interface JobResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  output?: any;
  error?: string;
  log?: string;
  executionTime?: number;
  startTime: string;
  endTime?: string;
  variables?: Record<string, any>;
  streamLogs?: StreamLogEntry[];
  totalLogCount?: number;
}

export function getJwt(): string | null {
  return localStorage.getItem(JWT_KEY);
}

export function setJwt(token: string): void {
  localStorage.setItem(JWT_KEY, token);
}

export function clearJwt(): void {
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem('orchestrator_refresh');
  localStorage.removeItem('orchestrator_user');
}

class ApiClient {
  private baseUrl = '/api/v1';
  private refreshPromise: Promise<boolean> | null = null;

  // Legacy stubs — kept so existing callers don't break.
  // The webpanel always talks to its own server, so these are no-ops.
  setApiKey(_key: string): void { }
  getApiKey(): string { return ''; }
  setWorkerReady(_ready: boolean): void { }
  isWorkerReady(): boolean { return true; }
  setBaseUrl(_address: string): void { }
  getBaseUrl(): string { return this.baseUrl; }

  private async tryRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data: any = await res.json();
        if (data?.token) {
          setJwt(data.token);
          if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retryAfterRefresh = true): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const jwt = getJwt();
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      if (retryAfterRefresh && await this.tryRefresh()) {
        return this.request<T>(endpoint, options, false);
      }
      clearJwt();
      window.location.hash = '/login';
      throw new Error('Session expired. Please log in again.');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(err.error?.message || err.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async ping(): Promise<{ status: string; version: string }> {
    return this.request<{ status: string; version: string }>('/ping');
  }

  async submitJob(jobRequest: JobRequest): Promise<{ jobId: string }> {
    return this.request<{ jobId: string }>('/jobs', {
      method: 'POST',
      body: JSON.stringify(jobRequest),
    });
  }

  async getJobStatus(jobId: string, lastLogIndex?: number): Promise<JobResponse> {
    const query = lastLogIndex !== undefined ? `?lastLogIndex=${lastLogIndex}` : '';
    return this.request<JobResponse>(`/jobs/${jobId}${query}`);
  }

  async stopJob(jobId: string): Promise<void> {
    await this.request(`/jobs/${jobId}/stop`, { method: 'POST' });
  }

  async pollJobStatus(
    jobId: string,
    onProgress?: (status: JobResponse) => void,
    pollInterval = 1000,
    onStreamLog?: (log: StreamLogEntry) => void
  ): Promise<JobResponse> {
    return new Promise((resolve, reject) => {
      let lastLogIndex = 0;
      const poll = async () => {
        try {
          const status = await this.getJobStatus(jobId, lastLogIndex);
          if (onStreamLog && status.streamLogs?.length) {
            for (const log of status.streamLogs) onStreamLog(log);
          }
          if (status.totalLogCount !== undefined) lastLogIndex = status.totalLogCount;
          onProgress?.(status);
          if (['completed', 'failed', 'stopped'].includes(status.status)) resolve(status);
          else setTimeout(poll, pollInterval);
        } catch (error) { reject(error); }
      };
      poll();
    });
  }

  async get<T = any>(path: string): Promise<T> {
    return this.request<T>(path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path);
  }

  async post<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>(path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async put<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>(path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>(path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  // Raw binary POST (artifact upload). Bypasses JSON serialization so large
  // files don't hit the V8 string limit ("allocation size overflow") the way
  // base64-in-JSON did. Body is the File/Blob/ArrayBuffer itself.
  async postBinary<T = any>(path: string, body: BodyInit): Promise<T> {
    const endpoint = path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    const jwt = getJwt();
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
    const response = await fetch(`${this.baseUrl}${endpoint}`, { method: 'POST', body, headers });
    if (response.status === 401) {
      clearJwt();
      window.location.hash = '/login';
      throw new Error('Session expired. Please log in again.');
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(err.error?.message || err.message || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async delete<T = any>(path: string): Promise<T> {
    return this.request<T>(path.startsWith('/api/v1') ? path.slice('/api/v1'.length) : path, {
      method: 'DELETE',
    });
  }
}

export const apiClient = new ApiClient();
export type { StreamLogEntry };
