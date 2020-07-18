#!/usr/bin/env sh
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
if [ "$VSCODE_WSL_DEBUG_INFO" = true ]; then
	set -x
fi

COMMIT="@@COMMIT@@"
APP_NAME="@@APPNAME@@"
QUALITY="@@QUALITY@@"
NAME="@@NAME@@"
DATAFOLDER="@@DATAFOLDER@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$VSCODE_PATH/$NAME.exe"

IN_WSL=false
if [ -n "$WSL_DISTRO_NAME" ]; then
	# $WSL_DISTRO_NAME is available since WSL builds 18362, also for WSL2
	IN_WSL=true
else
	WSL_BUILD=$(uname -r | sed -E 's/^[0-9.]+-([0-9]+)-Microsoft.*|.*/\1/')
	if [ -n "$WSL_BUILD" ]; then
		if [ "$WSL_BUILD" -ge 17063 ]; then
			# WSLPATH is available since WSL build 17046
			# WSLENV is available since WSL build 17063
			IN_WSL=true
		else
			# If running under older WSL, don't pass cli.js to Electron as
			# environment vars cannot be transferred from WSL to Windows
			# See: https://github.com/Microsoft/BashOnWindows/issues/1363
			#      https://github.com/Microsoft/BashOnWindows/issues/1494
			"$ELECTRON" "$@"
			exit $?
		fi
	fi
fi
if [ $IN_WSL = true ]; then

	export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
	CLI=$(wslpath -m "$VSCODE_PATH/resources/app/out/cli.js")

	# use the Remote WSL extension if installed
	WSL_EXT_ID="ms-vscode-remote.remote-wsl"

	ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" --locate-extension $WSL_EXT_ID >/tmp/remote-wsl-loc.txt 2>/dev/null
	WSL_EXT_WLOC=$(cat /tmp/remote-wsl-loc.txt)

	if [ -n "$WSL_EXT_WLOC" ]; then
		# replace \r\n with \n in WSL_EXT_WLOC
		WSL_CODE=$(wslpath -u "${WSL_EXT_WLOC%%[[:cntrl:]]}")/scripts/wslCode.sh
		"$WSL_CODE" "$COMMIT" "$QUALITY" "$ELECTRON" "$APP_NAME" "$DATAFOLDER" "$@"
		exit $?
	fi

elif [ -x "$(command -v cygpath)" ]; then
	CLI=$(cygpath -m "$VSCODE_PATH/resources/app/out/cli.js")
else
	CLI="$VSCODE_PATH/resources/app/out/cli.js"
fi
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
