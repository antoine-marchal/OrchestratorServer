# Orchestrator Webpanel — RPM packaging

Builds an **applicative RPM** for RHEL/Rocky/Alma/Fedora: the self-contained
Linux binary produced by `pkg` (`@yao-pkg/pkg`, target `node18-linux-x64`),
plus a systemd service, an environment file, and data directories.

It does **not** ship `node_modules` or run `npm start` on the target — the
binary already embeds the server, the static web panel (`dist/webpanel`), and
`groovyExec.jar`.

## Layout on the target

| Path | Purpose |
|------|---------|
| `/opt/orchestrator-webpanel/orchestrator-server` | The `pkg` binary (`ExecStart`) |
| `/etc/orchestrator-webpanel/orchestrator-webpanel.env` | Config + secrets (`%config(noreplace)`) |
| `/var/lib/orchestrator-webpanel` | `ORCHESTRATOR_WORK_DIR` — groovyExec.jar, inbox, certs, NeDB store |
| `/var/log/orchestrator-webpanel` | Logs |
| `/usr/lib/systemd/system/orchestrator-webpanel.service` | systemd unit |
| `/usr/share/doc/orchestrator-webpanel/server.env.example` | Full documented env reference (every variable) |

Runs as the unprivileged `orchestrator` user/group (created in `%pre`).

## Files here

- `orchestrator-webpanel.spec` — RPM spec (build + install + scriptlets).
- `orchestrator-webpanel.service` — systemd unit.
- `orchestrator-webpanel.env` — env template installed to `/etc`.
- `build-rpm.sh` — one-shot builder (tarball → rpmbuild).

## Build (Linux host)

Needs `rpm-build`, `nodejs >= 18`, `npm`, and a JDK if you use Groovy nodes.

```bash
# From repo root. Builds from HEAD (uncommitted files are NOT included).
./orchestrator-webpanel/packaging/rpm/build-rpm.sh
# or build from a tag:
./orchestrator-webpanel/packaging/rpm/build-rpm.sh v3.2.7
```

Output: `~/rpmbuild/RPMS/x86_64/orchestrator-webpanel-<version>-1*.x86_64.rpm`.

> The version comes from the repo `.version` file and must match the `Version:`
> tag in the spec — `build-rpm.sh` aborts if they differ. Bump both with
> `set-version.bat` (or edit by hand) before tagging a release.

### What the build does

1. `git archive` the whole repo under prefix `orchestrator-webpanel-<version>/`
   (includes `orchestrator-worker/groovyExec.jar`).
2. In `%build`: export `GROOVY_JAR` → the tracked JAR, build the client
   (`client && npm run build`), build the server, run `npm run pkg:linux`.
3. In `%install`: drop the binary, env file, unit, and data dirs into the buildroot.

> **Why `GROOVY_JAR`:** `prepare-pkg.mjs` looks for `groovyExec.jar` next to
> `server/package.json`, at the repo root, or in `$GROOVY_JAR`. In this repo the
> tracked JAR lives at `orchestrator-worker/groovyExec.jar`, so the spec exports
> `GROOVY_JAR` to bundle it. Without it, Groovy nodes won't work in the binary.

## Install & configure

```bash
sudo dnf install ./orchestrator-webpanel-3.2.7-1*.x86_64.rpm

# Generate the required secrets in place (JWT_SECRET, ORCHESTRATOR_MASTER_KEY,
# WORKER_REGISTRATION_SECRET, ADMIN_PASSWORD). Idempotent — only fills
# placeholders; pass --force to regenerate all. Backs up to *.env.bak.
sudo orchestrator-webpanel-gen-secrets
# Note the generated ADMIN_PASSWORD before first login:
sudo grep '^ADMIN_PASSWORD=' /etc/orchestrator-webpanel/orchestrator-webpanel.env
# Adjust anything else (DOMAIN, MONGO_URI, ...) by hand:
# sudoedit /etc/orchestrator-webpanel/orchestrator-webpanel.env

sudo systemctl daemon-reload
sudo systemctl enable --now orchestrator-webpanel
sudo systemctl status orchestrator-webpanel

curl http://localhost:3939/api/v1/ping   # -> status + version
```

If the service fails to start, check `journalctl -u orchestrator-webpanel` —
the most common cause is a secret left at its `change_me_in_production`
placeholder (or `ADMIN_PASSWORD=admin`), which is a hard fail in production.

## CI

`.github/workflows/rpm.yml` builds the RPM in a `rockylinux:9` container on every
`vX.Y.Z` tag and attaches it to the GitHub Release (and uploads it as an artifact
on manual `workflow_dispatch`).
