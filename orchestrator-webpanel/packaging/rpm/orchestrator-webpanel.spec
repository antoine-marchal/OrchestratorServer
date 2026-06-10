Name:           orchestrator-webpanel
Version:        3.2.7
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
