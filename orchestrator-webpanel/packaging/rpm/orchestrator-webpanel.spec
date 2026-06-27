# The payload is a prebuilt `pkg` Node binary — no debug sources to extract.
# Disable the auto debuginfo/debugsource subpackage (else: "Empty %files").
%global debug_package %{nil}

# @yao-pkg/pkg appends its payload (prelude + bundled assets) AFTER the ELF and
# records byte offsets into the produced file. RPM's default post-install steps
# run `strip` on every ELF in the buildroot, which rewrites the binary and
# discards that trailing appended data — the payload is lost, the recorded
# offsets point past EOF, and the binary dies at startup with:
#     Pkg: Error reading from file.
# Disable all automatic binary post-processing so the pkg output ships verbatim.
%global __os_install_post %{nil}

Name:           orchestrator-webpanel
Version:        3.3.0
Release:        1%{?dist}
Summary:        Orchestrator Server with bundled Web UI

License:        Proprietary
URL:            https://github.com/antoine-marchal/OrchestratorServer
Source0:        %{name}-%{version}.tar.gz
Source1:        orchestrator-webpanel.service
Source2:        orchestrator-webpanel.env
Source3:        gen-secrets.sh

BuildArch:      x86_64

BuildRequires:  nodejs >= 18
BuildRequires:  npm
BuildRequires:  systemd-rpm-macros

Requires:       systemd
Requires(pre):  shadow-utils
# openssl is only needed by %post to auto-fill the machine secrets. Keep it a
# weak dep so a host without it (or without the repo) still installs — %post
# detects the absence and warns instead of failing the transaction.
Recommends:     openssl

# groovyExec.jar is bundled and extracted at runtime; running Groovy nodes
# needs a JRE on the host. Enable if you use Groovy execution.
# Requires:       java-17-openjdk-headless

%description
Orchestrator Server: API server plus a bundled React/Vite web panel, shipped as
a self-contained Linux binary built with @yao-pkg/pkg. Runs as a systemd service
under a dedicated unprivileged user with data under /var/lib/orchestrator-webpanel.

%prep
%autosetup -n %{name}-%{version}

%build
# The git-archive tarball nests the project under orchestrator-webpanel/ and the
# Groovy JAR under orchestrator-worker/. prepare-pkg.mjs does not look there, so
# point it at the tracked JAR via GROOVY_JAR (absolute path) before pkg:linux.
export GROOVY_JAR="$(pwd)/orchestrator-worker/groovyExec.jar"

# Vite/tsc bundle the client in one Node process; the default ~2GB heap (Node 18)
# OOMs ("Reached heap limit") on this build. Give it room.
export NODE_OPTIONS="--max-old-space-size=4096"

cd orchestrator-webpanel

cd client
npm ci || npm install
npm run build

cd ../server
npm ci || npm install
npm run build
npm run pkg:linux

%install
rm -rf %{buildroot}

# pkg:linux writes to <project>/release/ (../../release from server dir).
install -d %{buildroot}/opt/orchestrator-webpanel
install -m 0755 release/orchestrator-server-linux \
  %{buildroot}/opt/orchestrator-webpanel/orchestrator-server

install -d %{buildroot}/etc/orchestrator-webpanel
install -m 0640 %{SOURCE2} \
  %{buildroot}/etc/orchestrator-webpanel/orchestrator-webpanel.env

install -d %{buildroot}%{_unitdir}
install -m 0644 %{SOURCE1} \
  %{buildroot}%{_unitdir}/orchestrator-webpanel.service

install -d %{buildroot}%{_bindir}
install -m 0755 %{SOURCE3} \
  %{buildroot}%{_bindir}/orchestrator-webpanel-gen-secrets

install -d %{buildroot}/var/lib/orchestrator-webpanel
install -d %{buildroot}/var/log/orchestrator-webpanel

# Bundle the canonical env reference (parity with build-server.bat, which copies
# it to release/server.env.example). The active config is the /etc env above;
# this is the full documented variable list.
install -d %{buildroot}%{_docdir}/%{name}
install -m 0644 orchestrator-webpanel/server/.env.example \
  %{buildroot}%{_docdir}/%{name}/server.env.example

%pre
getent group orchestrator >/dev/null || groupadd -r orchestrator
getent passwd orchestrator >/dev/null || \
  useradd -r -g orchestrator -d /var/lib/orchestrator-webpanel \
  -s /sbin/nologin -c "Orchestrator service user" orchestrator
exit 0

%post
%systemd_post orchestrator-webpanel.service
# Fill the machine secrets (JWT_SECRET, ORCHESTRATOR_MASTER_KEY,
# WORKER_REGISTRATION_SECRET) with random values so the service starts without
# manual setup — the server refuses to boot in production while these hold their
# placeholders. Idempotent: real values already present are left untouched, so
# this is safe on upgrade too. ADMIN_PASSWORD is intentionally skipped
# (--no-admin) to avoid randomizing the login; set it via gen-secrets or the UI.
#
# openssl is a weak dep (Recommends), so it may be absent. Never fail the
# transaction over secret generation: warn and let the operator run gen-secrets
# later — the server's startup check will remind them if placeholders remain.
if command -v openssl >/dev/null 2>&1; then
  %{_bindir}/orchestrator-webpanel-gen-secrets --no-admin >/dev/null 2>&1 || :
else
  echo "orchestrator-webpanel: openssl not found; machine secrets were NOT generated." >&2
  echo "  Install openssl, then run: orchestrator-webpanel-gen-secrets" >&2
fi

%preun
%systemd_preun orchestrator-webpanel.service

%postun
%systemd_postun_with_restart orchestrator-webpanel.service

%files
%dir /opt/orchestrator-webpanel
/opt/orchestrator-webpanel/orchestrator-server

%dir %attr(0750,root,orchestrator) /etc/orchestrator-webpanel
%config(noreplace) %attr(0640,root,orchestrator) /etc/orchestrator-webpanel/orchestrator-webpanel.env

%{_unitdir}/orchestrator-webpanel.service

%{_bindir}/orchestrator-webpanel-gen-secrets

%dir %attr(0750,orchestrator,orchestrator) /var/lib/orchestrator-webpanel
%dir %attr(0750,orchestrator,orchestrator) /var/log/orchestrator-webpanel

%doc %{_docdir}/%{name}/server.env.example

%changelog
* Wed Jun 10 2026 Antoine Marchal <antoine.marchal@pm.me> - 3.2.7-1
- Initial RPM package for orchestrator-webpanel (pkg binary + systemd service)
