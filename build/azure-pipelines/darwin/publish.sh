#!/usr/bin/env bash
set -e

# Publish DEB
case $VSCODE_ARCH in
	x64) ASSET_ID="darwin" ;;
	arm64) ASSET_ID="darwin-arm64" ;;
esac

# publish the build
node build/azure-pipelines/common/createAsset.js \
	"$ASSET_ID" \
	archive \
	"VSCode-$ASSET_ID.zip" \
	../VSCode-darwin-$VSCODE_ARCH.zip

if [ "$VSCODE_ARCH" == "x64" ]; then
	# package Remote Extension Host
	pushd .. && mv vscode-reh-darwin vscode-server-darwin && zip -Xry vscode-server-darwin.zip vscode-server-darwin && popd

	# publish Remote Extension Host
	node build/azure-pipelines/common/createAsset.js \
		server-darwin \
		archive-unsigned \
		"vscode-server-darwin.zip" \
		../vscode-server-darwin.zip
fi
