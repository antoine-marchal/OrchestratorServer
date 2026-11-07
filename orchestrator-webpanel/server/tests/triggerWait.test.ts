import { describe, expect, it } from 'vitest';
import {
  httpStatusForExecution,
  parseWaitSeconds,
  triggerInput,
  waitForExecution,
} from '../src/http/routes/triggers';

describe('API trigger wait mode', () => {
  it('parses ?wait into a capped number of seconds', () => {
    expect(parseWaitSeconds(undefined, 300)).toBeNull();
    expect(parseWaitSeconds('', 300)).toBe(300);
    expect(parseWaitSeconds('true', 300)).toBe(300);
    expect(parseWaitSeconds('30', 300)).toBe(30);
    expect(parseWaitSeconds('2.5', 300)).toBe(2.5);
    expect(parseWaitSeconds('9999', 300)).toBe(300);
    expect(parseWaitSeconds('0', 300)).toBeNull();
    expect(parseWaitSeconds('false', 300)).toBeNull();
    expect(parseWaitSeconds('abc', 300)).toBeNull();
    expect(parseWaitSeconds(['5', '10'], 300)).toBe(10);
  });

  it('uses a non-empty POST body as input, else the path segment', () => {
    expect(triggerInput('POST', { orderId: 42 }, 'seg')).toEqual({ orderId: 42 });
    expect(triggerInput('POST', 'plain text', 'seg')).toBe('plain text');
    expect(triggerInput('POST', {}, 'seg')).toBe('seg');
    expect(triggerInput('POST', '   ', 'seg')).toBe('seg');
    expect(triggerInput('GET', { orderId: 42 }, 'seg')).toBe('seg');
    expect(triggerInput('GET', {}, undefined)).toBeUndefined();
  });

  it('maps execution status to an HTTP status', () => {
    expect(httpStatusForExecution('SUCCESS')).toBe(200);
    expect(httpStatusForExecution('FAILED')).toBe(500);
    expect(httpStatusForExecution('KILLED')).toBe(500);
    expect(httpStatusForExecution('RUNNING')).toBe(202);
    expect(httpStatusForExecution(undefined)).toBe(202);
  });

  it('returns as soon as the execution is terminal', async () => {
    const states = ['QUEUED', 'RUNNING', 'SUCCESS'];
    let calls = 0;
    const exec = await waitForExecution('e1', 5_000, {
      pollMs: 1,
      load: async () => ({ _id: 'e1', status: states[Math.min(calls++, states.length - 1)], output: { ok: true } }),
    });
    expect(exec.status).toBe('SUCCESS');
    expect(exec.output).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('gives up at the deadline with the last seen state', async () => {
    const started = Date.now();
    const exec = await waitForExecution('e2', 50, {
      pollMs: 10,
      load: async () => ({ _id: 'e2', status: 'RUNNING' }),
    });
    expect(exec.status).toBe('RUNNING');
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('stops polling when the caller disconnects', async () => {
    let calls = 0;
    const exec = await waitForExecution('e3', 5_000, {
      pollMs: 1,
      load: async () => { calls++; return { _id: 'e3', status: 'RUNNING' }; },
      isAborted: () => calls >= 2,
    });
    expect(exec.status).toBe('RUNNING');
    expect(calls).toBe(2);
  });
});
