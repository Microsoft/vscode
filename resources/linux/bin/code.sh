#!/usr/bin/env sh
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

# test that VSCode wasn't installed inside WSL
if grep -qi Microsoft /proc/version && [ -z "$DONT_PROMPT_WSL_INSTALL" ]; then
	echo "To use @@PRODNAME@@ with the Windows Subsystem for Linux, please install @@PRODNAME@@ in Windows and uninstall the Linux version in WSL. You can then use the \`@@NAME@@\` command in a WSL terminal just as you would in a normal command prompt." 1>&2
	printf "Do you want to continue anyway? [y/N] " 1>&2
	read -r YN
	YN=$(printf '%s' "$YN" | tr '[:upper:]' '[:lower:]')
	case "$YN" in
		y | yes )
		;;
		* )
			exit 1
		;;
	esac
	echo "To no longer see this prompt, start @@PRODNAME@@ with the environment variable DONT_PROMPT_WSL_INSTALL defined." 1>&2
fi

# If root, ensure that --user-data-dir or --file-write is specified
if [ "$(id -u)" = "0" ]; then
	for i in "$@"
	do
		case "$i" in
			--user-data-dir | --user-data-dir=* | --file-write )
				CAN_LAUNCH_AS_ROOT=1
			;;
		esac
	done
	if [ -z $CAN_LAUNCH_AS_ROOT ]; then
		echo "You are trying to start @@PRODNAME@@ as a super user which isn't recommended. If this was intended, please specify an alternate user data directory using the \`--user-data-dir\` argument." 1>&2
		exit 1
	fi
fi

if [ ! -L "$0" ]; then
	# if path is not a symlink, find relatively
	VSCODE_PATH="$(dirname "$0")/.."
else
	if command -v readlink >/dev/null; then
		# if readlink exists, follow the symlink and find relatively
		VSCODE_PATH="$(dirname "$(readlink -f "$0")")/.."
	else
		# else use the standard install location
		VSCODE_PATH="/usr/share/@@NAME@@"
	fi
fi

ELECTRON="$VSCODE_PATH/@@NAME@@"
CLI="$VSCODE_PATH/resources/app/out/cli.js"
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
