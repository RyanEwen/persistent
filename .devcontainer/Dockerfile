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

# --- JDK 17 + Android SDK for the Capacitor Android build (apps/mobile) ---
# Capacitor 6 pins Gradle 8.2.1 / Android Gradle Plugin 8.2, which require JDK 17
# (Gradle 8.2 can't run on JDK 21 — the only OpenJDK Debian trixie ships). We
# pull JDK 17 from Amazon Corretto, whose apt suite is codename-agnostic
# ("stable main"), so it serves trixie on both amd64 and arm64. Java must live in
# the image (not a devcontainer feature, which would layer on too late) because
# the sdkmanager step below needs it at build time. The key is stored armored;
# apt's signed-by reads .asc directly, so no gnupg dependency.
RUN set -eux; \
    install -d -m 0755 /usr/share/keyrings; \
    curl -fsSL https://apt.corretto.aws/corretto.key -o /usr/share/keyrings/corretto.asc; \
    echo "deb [signed-by=/usr/share/keyrings/corretto.asc] https://apt.corretto.aws stable main" \
      > /etc/apt/sources.list.d/corretto.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends java-17-amazon-corretto-jdk; \
    rm -rf /var/lib/apt/lists/*; \
    # arch-independent JAVA_HOME symlink (Corretto installs to a fixed path, but
    # resolve it from `java` so this keeps working if that ever changes).
    ln -sfn "$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")" /usr/lib/jvm/current-jdk

# Google ships only x86_64 Linux Android build tools (aapt2/aapt are x86_64
# ELF binaries). On an arm64 host they execute through the host's qemu binfmt,
# but qemu needs the x86_64 glibc/libstdc++ runtime to exist inside the
# container — otherwise the AAPT2 daemon dies with "Could not open
# /lib64/ld-linux-x86-64.so.2" and the Gradle build fails. Adding the amd64
# multiarch runtime libs makes the emulated tools runnable. (No-op cost on an
# amd64 host, where the libs are the native ones.)
RUN set -eux; \
    dpkg --add-architecture amd64; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      libc6:amd64 \
      libstdc++6:amd64 \
      zlib1g:amd64; \
    rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/current-jdk
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="${PATH}:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools"

# Builds find the SDK via ANDROID_HOME (inherited everywhere), but the PATH
# additions above are dropped by login shells, which re-source /etc/profile and
# reset PATH. The devcontainer probes a login shell (userEnvProbe), so without
# this drop-in `sdkmanager`/`adb` would be missing from the integrated terminal.
RUN printf 'export PATH="$PATH:%s:%s"\n' \
      /opt/android-sdk/cmdline-tools/latest/bin \
      /opt/android-sdk/platform-tools \
      > /etc/profile.d/android-sdk.sh

# Pin the SDK levels to what Capacitor 6 targets (compileSdk 34).
ARG ANDROID_CMDLINE_TOOLS_VERSION=11076708
ARG ANDROID_COMPILE_SDK=34
ARG ANDROID_BUILD_TOOLS=34.0.0
RUN set -eux; \
    mkdir -p "${ANDROID_HOME}/cmdline-tools"; \
    curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip"; \
    unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools"; \
    mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"; \
    rm /tmp/cmdline-tools.zip; \
    yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null; \
    "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" \
      "platform-tools" \
      "platforms;android-${ANDROID_COMPILE_SDK}" \
      "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null; \
    chown -R node:node "${ANDROID_HOME}"

# Pre-create /home/node/.vscode-server owned by node. This MUST live in the
# image, not in fix-volume-perms.sh (postCreateCommand): the persist overlay
# mounts a named volume at the SUB-path .vscode-server/extensions, so Docker
# auto-creates the parent .vscode-server as root. VS Code then installs its
# server before postCreate runs, so a postCreate chown is too late. Creating the
# parent (and the extensions mountpoint) node-owned here fixes that.
RUN set -eux; \
    mkdir -p /home/node/.vscode-server/extensions; \
    chown -R node:node /home/node/.vscode-server
