import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { consumeProxyAuthFallback, requestIpAddress, scheduleProxyAuthFallback, triggerCallbackUrl, withTriggerAttempt } from '../src/http/routes/triggers';

afterEach(() => {
  vi.useRealTimers();
});

describe('API trigger helpers', () => {
  it('normalizes IPv4-mapped and loopback addresses', () => {
    expect(requestIpAddress({ ip: '::ffff:192.0.2.8' } as Request)).toBe('192.0.2.8');
    expect(requestIpAddress({ ip: '::1' } as Request)).toBe('127.0.0.1');
  });

  it('removes the proxy ticket from the callback service URL', () => {
    const oldDomain = process.env.DOMAIN;
    process.env.DOMAIN = 'https://orchestrator.example.test';
    try {
      const req = {
        originalUrl: '/api/v1/trigger/abc/hello?ticket=ST-1&trace=yes',
        query: { ticket: 'ST-1', trace: 'yes' },
      } as unknown as Request;

      expect(triggerCallbackUrl(req, 'ticket')).toBe(
        'https://orchestrator.example.test/api/v1/trigger/abc/hello?trace=yes',
      );
    } finally {
      if (oldDomain === undefined) delete process.env.DOMAIN;
      else process.env.DOMAIN = oldDomain;
    }
  });

  it('adds an opaque attempt id to correlate the callback with its fallback', () => {
    const result = new URL(withTriggerAttempt(
      'https://orchestrator.example.test/api/v1/trigger/abc/value?trace=yes',
      'attempt-123',
    ));

    expect(result.searchParams.get('trace')).toBe('yes');
    expect(result.searchParams.get('_triggerAttempt')).toBe('attempt-123');
  });

  it('runs the fallback after five seconds', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    scheduleProxyAuthFallback('timeout-attempt', 'token-a', fallback);

    vi.advanceTimersByTime(4_999);
    expect(fallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('cancels the fallback when the matching callback arrives', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    scheduleProxyAuthFallback('callback-attempt', 'token-a', fallback);

    expect(consumeProxyAuthFallback('callback-attempt', 'token-a')).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('does not let a callback for another token cancel the fallback', () => {
    vi.useFakeTimers();
    const fallback = vi.fn();
    scheduleProxyAuthFallback('scoped-attempt', 'token-a', fallback);

    expect(consumeProxyAuthFallback('scoped-attempt', 'token-b')).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(fallback).toHaveBeenCalledOnce();
  });
});
