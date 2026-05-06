interface Session {
  sessionId: string;
  token: string;
  expiresAt: string;
}

interface JobRequest {
  type: string;
  code?: string;
  codeFilePath?: string;
  input?: any;
  timeout?: number;
  dontWaitForOutput?: boolean;
  basePath?: string;
  variables?: Record<string, any>;
}

interface StreamLogEntry {
  type: 'log' | 'error' | 'output';
  message: string;
  nodeId?: string | null;
  timestamp: number;
}

interface JobResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  progress?: number;
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

class ApiClient {
  private baseUrl = import.meta.env.VITE_API_BASE || '/api/v1';
  private session: Session | null = null;
  private apiKey: string = '';
  private workerReady = false;

  setApiKey(key: string): void {
    this.apiKey = key.trim();
  }

  getApiKey(): string {
    return this.apiKey;
  }

  setWorkerReady(ready: boolean): void {
    this.workerReady = ready;
  }

  isWorkerReady(): boolean {
    return this.workerReady;
  }

  setBaseUrl(address: string): void {
    // Format the address to create a proper base URL
    const formattedAddress = address.trim();
    if (formattedAddress) {
      // Check if it already has http:// or https://
      if (formattedAddress.startsWith('http://') || formattedAddress.startsWith('https://')) {
        this.baseUrl = `${formattedAddress}/api/v1`;
      } else {
        // Default to http:// for localhost or IP addresses
        this.baseUrl = `http://${formattedAddress}/api/v1`;
      }
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!this.workerReady) {
      throw new Error('No worker available');
    }
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.session?.token) {
      headers.Authorization = `Bearer ${this.session.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async ping(): Promise<{ status: string; version: string }> {
    return this.request<{ status: string; version: string }>('/ping');
  }

  async createSession(metadata?: any): Promise<Session> {
    const session = await this.request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ metadata: metadata || {} }),
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
    });
    this.session = session;
    return session;
  }

  async extendSession(): Promise<void> {
    if (!this.session) throw new Error('No active session');
    await this.request(`/sessions/${this.session.sessionId}/extend`, {
      method: 'POST',
    });
  }

  async submitJob(jobRequest: JobRequest): Promise<{ jobId: string }> {
    if (!this.session) {
      await this.createSession();
    }

    const doSubmit = () => {
      const requestWithSession = { ...jobRequest, sessionId: this.session?.sessionId };
      return this.request<{ jobId: string }>('/jobs', {
        method: 'POST',
        body: JSON.stringify(requestWithSession),
      });
    };

    try {
      return await doSubmit();
    } catch (error) {
      // Session token is stale (backend restarted) — recreate and retry once
      if (error instanceof Error && error.message.includes('Invalid session token')) {
        this.session = null;
        await this.createSession();
        return doSubmit();
      }
      throw error;
    }
  }

  async getJobStatus(jobId: string, lastLogIndex?: number): Promise<JobResponse> {
    const query = lastLogIndex !== undefined ? `?lastLogIndex=${lastLogIndex}` : '';
    return this.request<JobResponse>(`/jobs/${jobId}${query}`);
  }

  async stopJob(jobId: string): Promise<void> {
    await this.request(`/jobs/${jobId}/stop`, {
      method: 'POST',
    });
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

          // Process new streaming logs
          if (onStreamLog && status.streamLogs && status.streamLogs.length > 0) {
            for (const log of status.streamLogs) {
              onStreamLog(log);
            }
          }
          // Update log index for next poll
          if (status.totalLogCount !== undefined) {
            lastLogIndex = status.totalLogCount;
          }

          onProgress?.(status);

          if (status.status === 'completed' || status.status === 'failed' || status.status === 'stopped') {
            resolve(status);
          } else {
            setTimeout(poll, pollInterval);
          }
        } catch (error) {
          reject(error);
        }
      };
      poll();
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  getSession(): Session | null {
    return this.session;
  }
}

export const apiClient = new ApiClient();
export type { StreamLogEntry };