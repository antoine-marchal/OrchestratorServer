import { afterEach, describe, expect, it } from 'vitest';
import { buildProxyAuthLoginRedirect, buildServiceUrl, proxyAuthConfig, proxyAuthTimeoutMs, proxyAuthTlsRejectUnauthorized } from '../src/http/routes/users';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('buildServiceUrl', () => {
  it('uses DOMAIN verbatim without adding the internal protocol or port', () => {
    process.env.DOMAIN = 'https://orchestrator.mydomain.rs';
    process.env.HTTPS = 'false';
    process.env.PORT = '3939';

    expect(buildServiceUrl()).toBe('https://orchestrator.mydomain.rs');
  });

  it('uses ORCHESTRATOR_DOMAIN verbatim when DOMAIN is unset', () => {
    delete process.env.DOMAIN;
    process.env.ORCHESTRATOR_DOMAIN = 'https://orchestrator.example.test/base/';
    process.env.ORCHESTRATOR_HTTPS = 'false';
    process.env.PORT = '8080';

    expect(buildServiceUrl()).toBe('https://orchestrator.example.test/base/');
  });

  it('builds a local URL from protocol and port when no domain is configured', () => {
    delete process.env.DOMAIN;
    delete process.env.ORCHESTRATOR_DOMAIN;
    process.env.ORCHESTRATOR_HTTPS = 'true';
    process.env.PORT = '4443';

    expect(buildServiceUrl()).toBe('https://localhost:4443');
  });
});

describe('proxyAuthTlsRejectUnauthorized', () => {
  it('verifies SSO certificates by default', () => {
    delete process.env.ORCHESTRATOR_PROXYAUTH_TLS_REJECT_UNAUTHORIZED;

    expect(proxyAuthTlsRejectUnauthorized()).toBe(true);
  });

  it('allows certificate verification to be explicitly disabled', () => {
    process.env.ORCHESTRATOR_PROXYAUTH_TLS_REJECT_UNAUTHORIZED = 'false';

    expect(proxyAuthTlsRejectUnauthorized()).toBe(false);
  });
});

describe('proxyAuth helpers', () => {
  it('builds the login redirect without discarding existing query parameters', () => {
    const redirect = new URL(buildProxyAuthLoginRedirect(
      'https://sso.example.test/login?gateway=true',
      'https://orchestrator.example.test/api/v1/trigger/token/value',
    ));

    expect(redirect.searchParams.get('gateway')).toBe('true');
    expect(redirect.searchParams.get('service')).toBe('https://orchestrator.example.test/api/v1/trigger/token/value');
  });

  it('only enables proxy auth when validation URL and regex are both configured', () => {
    process.env.ORCHESTRATOR_PROXYAUTH_URL = 'https://sso.example.test/validate';
    delete process.env.ORCHESTRATOR_PROXYAUTH_REGEX;
    expect(proxyAuthConfig()).toBeNull();

    process.env.ORCHESTRATOR_PROXYAUTH_REGEX = '<user>([^<]+)</user>';
    expect(proxyAuthConfig()).toMatchObject({
      paramName: 'ticket',
      loginUrl: 'https://sso.example.test/login',
    });
  });

  it('uses a five-second validation timeout by default', () => {
    delete process.env.ORCHESTRATOR_PROXYAUTH_TIMEOUT_MS;
    expect(proxyAuthTimeoutMs()).toBe(5_000);

    process.env.ORCHESTRATOR_PROXYAUTH_TIMEOUT_MS = '2500';
    expect(proxyAuthTimeoutMs()).toBe(2_500);
  });
});
