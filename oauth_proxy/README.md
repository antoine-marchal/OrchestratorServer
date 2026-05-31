# oauth_proxy

Tiny OAuth2 (Authorization Code) provider for testing **Grafana Generic OAuth**.
It has no password store — authentication is delegated to the CAS-style
[`authent_test_service`](../authent_test_service) (`/login` + `/validate`).
NeDB persists pending requests, codes, and tokens.

## Protocol bridge

```
Grafana                 oauth_proxy                 authent_test_service (CAS)
   │  GET /authorize         │                              │
   │ ──────────────────────► │  302 /login?service=…/cas/callback?sid=
   │                         │ ───────────────────────────► │  mint ticket
   │                         │  302 /cas/callback?sid=&ticket=
   │                         │ ◄─────────────────────────── │
   │                         │  GET /validate?ticket=&service=
   │                         │ ───────────────────────────► │  <cas:user>marchala</cas:user>
   │  302 redirect_uri?code= │ ◄─────────────────────────── │
   │ ◄────────────────────── │
   │  POST /token (code)     │
   │ ──────────────────────► │  → { access_token }
   │  GET /userinfo (Bearer) │
   │ ──────────────────────► │  → { sub, email, … }
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/authorize` | OAuth2 auth endpoint → redirects to CAS login |
| GET | `/cas/callback` | CAS return → validates ticket, mints OAuth code |
| POST | `/token` | Swap single-use code for an access token |
| GET | `/userinfo` | OpenID UserInfo JSON (Bearer token) |
| GET | `/.well-known/openid-configuration` | OIDC discovery |

## Run

```bash
# 1. Start the CAS sim (see ../authent_test_service)
cd authent_test_service && npm install && npm start   # :8443

# 2. Start the OAuth proxy
cd oauth_proxy && npm install && cp .env.example .env && npm start   # :9000
```

## Grafana "Generic OAuth" config

Set these in Grafana (Administration → Authentication → Generic OAuth), or paste
the discovery URL `http://localhost:9000/.well-known/openid-configuration` into
**OpenID Connect Discovery URL** to auto-fill Auth/Token/API URLs.

| Field | Value |
|-------|-------|
| Client ID | `some_id` (matches `CLIENT_ID`) |
| Client secret | *(blank, or set `CLIENT_SECRET`)* |
| Scopes | `user:email` |
| Auth URL | `http://localhost:9000/authorize` |
| Token URL | `http://localhost:9000/token` |
| API URL | `http://localhost:9000/userinfo` |
| Allow sign up | on |

Grafana redirect URI is `http://<grafana>/login/generic_oauth` — the proxy echoes
whatever `redirect_uri` Grafana sends, no allow-list (test tool).

The logged-in identity is whatever `authent_test_service` returns
(`DEFAULT_USER`, default `marchala`); email is `<login>@EMAIL_DOMAIN`.
