#!/usr/bin/env bash
# Build the orchestrator-webpanel RPM from a clean git-archive of the repo.
# Run on a Linux host with rpm-build, nodejs>=18, npm (and a JDK if you use Groovy).
#   ./orchestrator-webpanel/packaging/rpm/build-rpm.sh
set -euo pipefail

# Repo root = two levels up from this script (packaging/rpm/ -> webpanel -> root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

NAME=orchestrator-webpanel
VERSION="$(tr -d ' \t\r\n' < .version)"
PREFIX="${NAME}-${VERSION}"
REF="${1:-HEAD}"   # build from this git ref (default HEAD; tarball ignores uncommitted files)

echo ">> Building ${PREFIX} from ref '${REF}'"

# Spec Version: must match .version (tarball prefix + %prep dir depend on it).
SPEC_VER="$(awk '/^Version:/{print $2; exit}' "$SCRIPT_DIR/${NAME}.spec")"
if [ "$SPEC_VER" != "$VERSION" ]; then
  echo "ERROR: spec Version ($SPEC_VER) != .version ($VERSION). Sync them." >&2
  exit 1
fi

mkdir -p "$HOME/rpmbuild"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# Source tarball: whole repo (webpanel + worker/groovyExec.jar) under the prefix.
git archive --format=tar.gz --prefix="${PREFIX}/" \
  -o "$HOME/rpmbuild/SOURCES/${PREFIX}.tar.gz" "${REF}"

cp "$SCRIPT_DIR/${NAME}.service" "$HOME/rpmbuild/SOURCES/"
cp "$SCRIPT_DIR/${NAME}.env"     "$HOME/rpmbuild/SOURCES/"
cp "$SCRIPT_DIR/gen-secrets.sh"  "$HOME/rpmbuild/SOURCES/"
cp "$SCRIPT_DIR/${NAME}.spec"    "$HOME/rpmbuild/SPECS/"

rpmbuild -ba "$HOME/rpmbuild/SPECS/${NAME}.spec"

echo ">> RPM(s):"
ls -1 "$HOME/rpmbuild/RPMS/x86_64/${NAME}-${VERSION}"-*.x86_64.rpm
