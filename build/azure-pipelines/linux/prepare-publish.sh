#!/usr/bin/env bash
set -e
REPO="$(pwd)"
ROOT="$REPO/.."

# Publish tarball
PLATFORM_LINUX="linux-$VSCODE_ARCH"
BUILDNAME="VSCode-$PLATFORM_LINUX"
BUILD_VERSION="$(date +%s)"
[ -z "$VSCODE_QUALITY" ] && TARBALL_FILENAME="code-$VSCODE_ARCH-$BUILD_VERSION.tar.gz" || TARBALL_FILENAME="code-$VSCODE_QUALITY-$VSCODE_ARCH-$BUILD_VERSION.tar.gz"
TARBALL_PATH="$ROOT/$TARBALL_FILENAME"

rm -rf $ROOT/code-*.tar.*
(cd $ROOT && tar -czf $TARBALL_PATH $BUILDNAME)

# Publish Remote Extension Host
LEGACY_SERVER_BUILD_NAME="vscode-reh-$PLATFORM_LINUX"
SERVER_BUILD_NAME="vscode-server-$PLATFORM_LINUX"
SERVER_TARBALL_FILENAME="vscode-server-$PLATFORM_LINUX.tar.gz"
SERVER_TARBALL_PATH="$ROOT/$SERVER_TARBALL_FILENAME"

rm -rf $ROOT/vscode-server-*.tar.*
(cd $ROOT && mv $LEGACY_SERVER_BUILD_NAME $SERVER_BUILD_NAME && tar --owner=0 --group=0 -czf $SERVER_TARBALL_PATH $SERVER_BUILD_NAME)

# Publish Remote Extension Host (Web)
LEGACY_SERVER_BUILD_NAME="vscode-reh-web-$PLATFORM_LINUX"
SERVER_BUILD_NAME="vscode-server-$PLATFORM_LINUX-web"
SERVER_TARBALL_FILENAME="vscode-server-$PLATFORM_LINUX-web.tar.gz"
SERVER_TARBALL_PATH="$ROOT/$SERVER_TARBALL_FILENAME"

rm -rf $ROOT/vscode-server-*-web.tar.*
(cd $ROOT && mv $LEGACY_SERVER_BUILD_NAME $SERVER_BUILD_NAME && tar --owner=0 --group=0 -czf $SERVER_TARBALL_PATH $SERVER_BUILD_NAME)

# Publish DEB
case $VSCODE_ARCH in
	x64) DEB_ARCH="amd64" ;;
	*) DEB_ARCH="$VSCODE_ARCH" ;;
esac

PLATFORM_DEB="linux-deb-$VSCODE_ARCH"
DEB_FILENAME="$(ls $REPO/.build/linux/deb/$DEB_ARCH/deb/)"
DEB_PATH="$REPO/.build/linux/deb/$DEB_ARCH/deb/$DEB_FILENAME"

# Publish RPM
case $VSCODE_ARCH in
	x64) RPM_ARCH="x86_64" ;;
	armhf) RPM_ARCH="armv7hl" ;;
	arm64) RPM_ARCH="aarch64" ;;
	*) RPM_ARCH="$VSCODE_ARCH" ;;
esac

PLATFORM_RPM="linux-rpm-$VSCODE_ARCH"
RPM_FILENAME="$(ls $REPO/.build/linux/rpm/$RPM_ARCH/ | grep .rpm)"
RPM_PATH="$REPO/.build/linux/rpm/$RPM_ARCH/$RPM_FILENAME"

# Publish Snap
# Pack snap tarball artifact, in order to preserve file perms
mkdir -p $REPO/.build/linux/snap-tarball
SNAP_TARBALL_PATH="$REPO/.build/linux/snap-tarball/snap-$VSCODE_ARCH.tar.gz"
rm -rf $SNAP_TARBALL_PATH
(cd .build/linux && tar -czf $SNAP_TARBALL_PATH snap)

# Export DEB_PATH, RPM_PATH
echo "##vso[task.setvariable variable=DEB_PATH]$DEB_PATH"
echo "##vso[task.setvariable variable=RPM_PATH]$RPM_PATH"
echo "##vso[task.setvariable variable=TARBALL_PATH]$TARBALL_PATH"
