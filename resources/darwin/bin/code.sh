#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

function realpath() { python -c "import os,sys; print(os.path.realpath(os.path.join(sys.argv[1],'..','..','..','..')))" "$0"; }
CONTENTS="$(realpath "$0")"
ELECTRON="$CONTENTS/MacOS/Electron"
CLI="$CONTENTS/Resources/app/out/cli.js"
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
