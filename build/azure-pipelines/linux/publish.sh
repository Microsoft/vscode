#!/usr/bin/env bash
set -e
REPO="$(pwd)"
ROOT="$REPO/.."

# Publish tarball
PLATFORM_LINUX="linux-x64"
BUILDNAME="VSCode-$PLATFORM_LINUX"
BUILD="$ROOT/$BUILDNAME"
BUILD_VERSION="$(date +%s)"
[ -z "$VSCODE_QUALITY" ] && TARBALL_FILENAME="code-$BUILD_VERSION.tar.gz" || TARBALL_FILENAME="code-$VSCODE_QUALITY-$BUILD_VERSION.tar.gz"
TARBALL_PATH="$ROOT/$TARBALL_FILENAME"

rm -rf $ROOT/code-*.tar.*
(cd $ROOT && tar -czf $TARBALL_PATH $BUILDNAME)

node build/azure-pipelines/common/createAsset.js "$PLATFORM_LINUX" archive-unsigned "$TARBALL_FILENAME" "$TARBALL_PATH"

# Publish Remote Extension Host
LEGACY_SERVER_BUILD_NAME="vscode-reh-$PLATFORM_LINUX"
SERVER_BUILD_NAME="vscode-server-$PLATFORM_LINUX"
SERVER_TARBALL_FILENAME="vscode-server-$PLATFORM_LINUX.tar.gz"
SERVER_TARBALL_PATH="$ROOT/$SERVER_TARBALL_FILENAME"

rm -rf $ROOT/vscode-server-*.tar.*
(cd $ROOT && mv $LEGACY_SERVER_BUILD_NAME $SERVER_BUILD_NAME && tar --owner=0 --group=0 -czf $SERVER_TARBALL_PATH $SERVER_BUILD_NAME)

node build/azure-pipelines/common/createAsset.js "server-$PLATFORM_LINUX" archive-unsigned "$SERVER_TARBALL_FILENAME" "$SERVER_TARBALL_PATH"

# Publish DEB
PLATFORM_DEB="linux-deb-x64"
DEB_ARCH="amd64"
DEB_FILENAME="$(ls $REPO/.build/linux/deb/$DEB_ARCH/deb/)"
DEB_PATH="$REPO/.build/linux/deb/$DEB_ARCH/deb/$DEB_FILENAME"

node build/azure-pipelines/common/createAsset.js "$PLATFORM_DEB" package "$DEB_FILENAME" "$DEB_PATH"

# Publish RPM
PLATFORM_RPM="linux-rpm-x64"
RPM_ARCH="x86_64"
RPM_FILENAME="$(ls $REPO/.build/linux/rpm/$RPM_ARCH/ | grep .rpm)"
RPM_PATH="$REPO/.build/linux/rpm/$RPM_ARCH/$RPM_FILENAME"

node build/azure-pipelines/common/createAsset.js "$PLATFORM_RPM" package "$RPM_FILENAME" "$RPM_PATH"

# Publish Snap
# Pack snap tarball artifact, in order to preserve file perms
mkdir -p $REPO/.build/linux/snap-tarball
SNAP_TARBALL_PATH="$REPO/.build/linux/snap-tarball/snap-x64.tar.gz"
rm -rf $SNAP_TARBALL_PATH
(cd .build/linux && tar -czf $SNAP_TARBALL_PATH snap)
