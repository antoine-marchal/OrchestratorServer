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
- `gen-secrets.sh` — fills the required secrets in the installed env file
  (`--no-admin` skips `ADMIN_PASSWORD`; used by `%post`).
- `build-rpm.sh` — one-shot builder (tarball → rpmbuild) on an RPM host.
- `build-in-docker.sh` — builds in a `rockylinux:9` container (for non-RPM hosts).

## Build

The RPM **must** be built on an RPM-based distro: it needs `systemd-rpm-macros`
(absent on Debian/Ubuntu), and the `BuildRequires` use RPM package names.

### Option A — Docker (works on Ubuntu/WSL/macOS) — recommended

```bash
./orchestrator-webpanel/packaging/rpm/build-in-docker.sh        # from HEAD
./orchestrator-webpanel/packaging/rpm/build-in-docker.sh v3.2.7 # from a tag
```

Builds inside `rockylinux:9` (same toolchain as CI). Output RPM(s) land in
`orchestrator-webpanel/packaging/rpm/dist/`.

### Option B — native RPM host (Rocky/Alma/Fedora/RHEL)

Needs `rpm-build`, `nodejs >= 18`, `npm`, and a JDK if you use Groovy nodes.

```bash
# From repo root. Builds from HEAD (uncommitted files are NOT included).
./orchestrator-webpanel/packaging/rpm/build-rpm.sh
# or build from a tag (use the value in the repo .version file):
./orchestrator-webpanel/packaging/rpm/build-rpm.sh v<version>
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

> **Why strip is disabled (`%global __os_install_post %{nil}`):** `pkg` appends
> its payload (prelude + `dist/webpanel` + `groovyExec.jar`) *after* the ELF and
> records byte offsets into the produced file. RPM's default post-install step
> runs `strip` on every ELF in the buildroot, which rewrites the binary and
> discards that trailing data — the payload is lost and the binary dies at
> startup with `Pkg: Error reading from file.`. Disabling `__os_install_post`
> ships the `pkg` output verbatim (installed size jumps accordingly, ~110 MB).

> **Why `GROOVY_JAR`:** `prepare-pkg.mjs` looks for `groovyExec.jar` next to
> `server/package.json`, at the repo root, or in `$GROOVY_JAR`. In this repo the
> tracked JAR lives at `orchestrator-worker/groovyExec.jar`, so the spec exports
> `GROOVY_JAR` to bundle it. Without it, Groovy nodes won't work in the binary.

## Install & configure

```bash
sudo dnf install ./orchestrator-webpanel-<version>-1*.x86_64.rpm
```

`%post` auto-generates the three **machine secrets** the server fatally
requires — `JWT_SECRET`, `ORCHESTRATOR_MASTER_KEY`, `WORKER_REGISTRATION_SECRET`
— with `openssl rand` (via `gen-secrets --no-admin`). Idempotent: existing real
values are never overwritten, so it is safe on upgrade. The service can start
immediately after install.

`openssl` is a **weak dependency** (`Recommends`): if it is absent, the install
still completes — `%post` prints a warning and skips secret generation; run
`orchestrator-webpanel-gen-secrets` once openssl is available.

`ADMIN_PASSWORD` is **not** auto-randomized (that would lock you out). Set it
before first login, then adjust any other config:

```bash
# Set/regenerate the admin password (and note it):
sudo orchestrator-webpanel-gen-secrets   # fills ADMIN_PASSWORD if still a placeholder
sudo grep '^ADMIN_PASSWORD=' /etc/orchestrator-webpanel/orchestrator-webpanel.env
# Adjust anything else (DOMAIN, MONGO_URI, ...) by hand:
# sudoedit /etc/orchestrator-webpanel/orchestrator-webpanel.env

sudo systemctl enable --now orchestrator-webpanel
sudo systemctl status orchestrator-webpanel

curl http://localhost:3939/api/v1/ping   # -> status + version
```

### Change configuration later

The active config lives at
`/etc/orchestrator-webpanel/orchestrator-webpanel.env` (one `KEY=value` per line,
no quotes). It is `%config(noreplace)`, so package upgrades keep your edits. The
service reads it once at boot (systemd `EnvironmentFile`), so **edit then
restart**:

```bash
sudoedit /etc/orchestrator-webpanel/orchestrator-webpanel.env
sudo systemctl restart orchestrator-webpanel
sudo systemctl status orchestrator-webpanel        # confirm it came back up
sudo journalctl -u orchestrator-webpanel -n 20 --no-pager   # check for errors
```

Full documented variable reference (every option, with comments):
`/usr/share/doc/orchestrator-webpanel/server.env.example`.

### LAN access

The server binds `0.0.0.0:3939` (all interfaces). To reach it from other hosts,
open the port in firewalld:

```bash
sudo firewall-cmd --add-port=3939/tcp --permanent
sudo firewall-cmd --reload
```

Then browse `http://<server-ip>:3939`.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Pkg: Error reading from file.` | `pkg` payload stripped off the binary. Rebuild — the spec disables strip (`%global __os_install_post %{nil}`). A correct install is ~110 MB, not ~49 MB. |
| `FATAL: refusing to start ... placeholder secrets` | A secret is still `change_me_in_production` (or `ADMIN_PASSWORD=admin`). Run `sudo orchestrator-webpanel-gen-secrets`, then restart. |
| `200` on `localhost` but no LAN access | firewalld — open `3939/tcp` (see above). |
| `[node-exec] No system Node found` | Groovy/`.mjs` node execution needs a host Node **≥ 18** (the bundled binary is self-contained for the web panel itself). Install `nodejs >= 18` or set `NODE_EXECUTABLE_PATH`. |

Check `journalctl -u orchestrator-webpanel` for the exact startup error.

## Execution runtimes (optional)

The bundled binary serves the web panel and API on its own. Running **nodes**
shells out to host interpreters per runtime — install only the ones you use
(Rocky/Alma/RHEL 9 shown):

```bash
# Groovy nodes — JRE 17 (groovyExec.jar is bundled; only the JRE is needed)
sudo dnf install -y java-17-openjdk-headless

# JavaScript / .mjs nodes — Node.js >= 18 (Rocky's default stream is 16)
sudo dnf module reset  -y nodejs
sudo dnf module enable -y nodejs:18
sudo dnf install -y nodejs
# point the server at it if auto-detection misses it:
#   NODE_EXECUTABLE_PATH=/usr/bin/node   in the env file

# PowerShell nodes — pwsh from Microsoft's repo
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
curl -sSL https://packages.microsoft.com/config/rhel/9/prod.repo \
  | sudo tee /etc/yum.repos.d/microsoft-prod.repo
sudo dnf install -y powershell

# Python / Shell nodes — python3 and bash are already present on a base install.
```

After installing a runtime, restart so the server re-detects it:

```bash
sudo systemctl restart orchestrator-webpanel
```

## Uninstall

```bash
# Stop + remove the package (systemd scriptlets disable the unit).
sudo dnf remove -y orchestrator-webpanel
```

`dnf remove` leaves behind, by design:

- `/etc/orchestrator-webpanel/orchestrator-webpanel.env` → saved as `*.env.rpmsave`
  (it is `%config(noreplace)`).
- `/var/lib/orchestrator-webpanel` and `/var/log/orchestrator-webpanel` (data + logs).
- the `orchestrator` user/group.

To purge completely:

```bash
sudo rm -rf /etc/orchestrator-webpanel /var/lib/orchestrator-webpanel \
            /var/log/orchestrator-webpanel /opt/orchestrator-webpanel
sudo userdel orchestrator        # may warn if the group has other members
sudo groupdel orchestrator 2>/dev/null || true
```

> ⚠️ Removing `/var/lib/orchestrator-webpanel` deletes the NeDB store, inbox, and
> certs — back it up first if you might reinstall.

## CI

`.github/workflows/rpm.yml` builds the RPM in a `rockylinux:9` container on every
`vX.Y.Z` tag and attaches it to the GitHub Release (and uploads it as an artifact
on manual `workflow_dispatch`).
