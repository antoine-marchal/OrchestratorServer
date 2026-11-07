#!/usr/bin/env bash
# Build the RPM inside a rockylinux:9 container (same toolchain as CI). Use this
# on non-RPM hosts (Ubuntu/WSL/macOS) where rpmbuild can't satisfy the RPM
# BuildRequires or lacks systemd-rpm-macros.
#
#   ./build-in-docker.sh [git-ref]
#
# Output RPM(s) are copied to packaging/rpm/dist/ on the host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REF="${1:-HEAD}"
IMAGE=rockylinux:9
OUT_DIR="$SCRIPT_DIR/dist"

command -v docker >/dev/null || { echo "ERROR: docker not found." >&2; exit 1; }
mkdir -p "$OUT_DIR"

# Mount the repo read-write: git archive reads .git, and `git stash create`
# (used by build-rpm.sh to capture uncommitted tracked changes) writes a
# throwaway object into .git/objects. The worktree itself is not modified.
docker run --rm \
  -v "$REPO_ROOT":/src \
  -v "$OUT_DIR":/out \
  -e REF="$REF" \
  "$IMAGE" bash -euo pipefail -c '
    # Rocky 9 default nodejs stream is 16; the project needs 18.
    dnf -y module reset nodejs
    dnf -y --nogpgcheck module enable nodejs:24
    dnf -y --nogpgcheck install rpm-build rpmdevtools systemd-rpm-macros \
      git tar gzip nodejs npm java-17-openjdk-headless
    node --version
    # build-rpm.sh only reads the tree (git archive -> $HOME/rpmbuild), so the
    # read-only /src mount is fine — no copy needed.
    git config --global --add safe.directory /src
    cd /src
    # Build straight off the mount; build-rpm.sh writes only to $HOME/rpmbuild
    # (plus a throwaway git stash object in .git/objects).
    bash orchestrator-webpanel/packaging/rpm/build-rpm.sh "$REF"
    cp ~/rpmbuild/RPMS/x86_64/*.rpm /out/
  '

echo ">> RPM(s) in: $OUT_DIR"
ls -1 "$OUT_DIR"/*.rpm
