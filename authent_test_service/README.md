# authent_test_service

Tiny CAS/SSO simulator for testing the Orchestrator server's proxy-auth
(ticket-based SSO) login flow. Backed by NeDB (`@seald-io/nedb`).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/login?service=http://domain:port/authen` | Mint a single-use ticket and 302-redirect to `service?ticket=ST-...` |
| GET | `/validate?ticket=<ticket>&service=<url>` | Validate the ticket **once**, return CAS XML |

A ticket is **generated once** (one NeDB row at `/login`) and **validated once**
(the row is consumed on the first `/validate`). Replays return
`<cas:authenticationFailure>`.

On success `/validate` returns:

```xml
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess>
    <cas:user>marchala</cas:user>
  </cas:authenticationSuccess>
</cas:serviceResponse>
```

## Run

```bash
cd authent_test_service
npm install
cp .env.example .env   # adjust PORT / DEFAULT_USER
npm start
```

## Wiring to the Orchestrator server

Set these in the server's `.env` (see `release/server.env.example`,
"Proxy / SSO authentication"). The server calls
`<URL>?ticket=<ticket>&service=<DOMAIN>:<PORT>` and extracts login via the regex:

```env
ORCHESTRATOR_PROXYAUTH_NAME=ticket
ORCHESTRATOR_PROXYAUTH_URL=http://localhost:8443/validate
ORCHESTRATOR_PROXYAUTH_REGEX=<cas:user>([^<]+)</cas:user>
```

`DEFAULT_USER` (default `marchala`) must match an existing Orchestrator user
login, or the server's `/authProxy` exchange returns `User not found`.

### Manual end-to-end

```bash
# 1. Get a ticket (follow the redirect to read the ?ticket= value)
curl -i "http://localhost:8443/login?service=http://localhost:3939/authen"

# 2. Validate it (first call succeeds, second fails — single use)
curl "http://localhost:8443/validate?ticket=ST-...&service=http://localhost:3939/authen"
```
