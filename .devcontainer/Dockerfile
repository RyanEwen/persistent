# Dev container image for Persistent.
#
# Mirrors printstream's devcontainer base (typescript-node) but thinned: we have
# no in-workspace slicer, so the BambuStudio/qemu/wine/ffmpeg runtime layers are
# dropped. We keep the common CLI tooling (gh, ripgrep, jq, postgres-client, …)
# plus a JDK + Android command-line tools so the Capacitor Android client
# (apps/mobile) can be built from inside the container later.
FROM mcr.microsoft.com/devcontainers/typescript-node:4.0.6-20-trixie

ARG DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bat \
      ca-certificates \
      curl \
      docker.io \
      fd-find \
      gh \
      git \
      htop \
      jq \
      less \
      postgresql-client \
      ripgrep \
      tree \
      unzip; \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd; \
    ln -sf /usr/bin/batcat /usr/local/bin/bat; \
    rm -rf /var/lib/apt/lists/*

# Pre-create /home/node/.vscode-server owned by node. This MUST live in the
# image, not in fix-volume-perms.sh (postCreateCommand): the persist overlay
# mounts a named volume at the SUB-path .vscode-server/extensions, so Docker
# auto-creates the parent .vscode-server as root. VS Code then installs its
# server before postCreate runs, so a postCreate chown is too late. Creating the
# parent (and the extensions mountpoint) node-owned here fixes that.
RUN set -eux; \
    mkdir -p /home/node/.vscode-server/extensions; \
    chown -R node:node /home/node/.vscode-server
