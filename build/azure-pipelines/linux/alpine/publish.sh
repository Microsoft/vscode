#!/usr/bin/env bash
set -e
REPO="$(pwd)"
ROOT="$REPO/.."

PLATFORM_LINUX="linux-alpine"

# Publish Remote Extension Host
LEGACY_SERVER_BUILD_NAME="vscode-reh-$PLATFORM_LINUX"
SERVER_BUILD_NAME="vscode-server-$PLATFORM_LINUX"
SERVER_TARBALL_FILENAME="vscode-server-$PLATFORM_LINUX.tar.gz"
SERVER_TARBALL_PATH="$ROOT/$SERVER_TARBALL_FILENAME"

rm -rf $ROOT/vscode-server-*.tar.*
(cd $ROOT && mv $LEGACY_SERVER_BUILD_NAME $SERVER_BUILD_NAME && tar --owner=0 --group=0 -czf $SERVER_TARBALL_PATH $SERVER_BUILD_NAME)

node build/azure-pipelines/common/createAsset.js "server-$PLATFORM_LINUX" archive-unsigned "$SERVER_TARBALL_FILENAME" "$SERVER_TARBALL_PATH"

# Publish Remote Extension Host (Web)
LEGACY_SERVER_BUILD_NAME="vscode-reh-web-$PLATFORM_LINUX"
SERVER_BUILD_NAME="vscode-server-$PLATFORM_LINUX-web"
SERVER_TARBALL_FILENAME="vscode-server-$PLATFORM_LINUX-web.tar.gz"
SERVER_TARBALL_PATH="$ROOT/$SERVER_TARBALL_FILENAME"

rm -rf $ROOT/vscode-server-*.tar.*
(cd $ROOT && mv $LEGACY_SERVER_BUILD_NAME $SERVER_BUILD_NAME && tar --owner=0 --group=0 -czf $SERVER_TARBALL_PATH $SERVER_BUILD_NAME)

node build/azure-pipelines/common/createAsset.js "server-$PLATFORM_LINUX-web" archive-unsigned "$SERVER_TARBALL_FILENAME" "$SERVER_TARBALL_PATH"
