#!/usr/bin/env bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
	# --disable-setuid-sandbox: setuid sandboxes requires root and is used in containers so we disable this
	# --disable-dev-shm-usage --use-gl=swiftshader: when run on docker containers where size of /dev/shm
	# partition < 64MB which causes OOM failure for chromium compositor that uses the partition for shared memory
	LINUX_EXTRA_ARGS="--disable-setuid-sandbox --disable-dev-shm-usage --use-gl=swiftshader"
fi

VSCODEUSERDATADIR=`mktemp -d 2>/dev/null`
VSCODECRASHDIR=$ROOT/.build/crashes
cd $ROOT

# Figure out which Electron to use for running tests
if [ -z "$INTEGRATION_TEST_ELECTRON_PATH" ]
then
	# Run out of sources: no need to compile as code.sh takes care of it
	INTEGRATION_TEST_ELECTRON_PATH="./scripts/code.sh"

	echo "Storing crash reports into '$VSCODECRASHDIR'."
	echo "Running integration tests out of sources."
else
	# Run from a built: need to compile all test extensions
	# because we run extension tests from their source folders
	# and the build bundles extensions into .build webpacked
	yarn gulp 	compile-extension:vscode-api-tests \
				compile-extension:vscode-colorize-tests \
				compile-extension:vscode-custom-editor-tests \
				compile-extension:vscode-notebook-tests \
				compile-extension:markdown-language-features \
				compile-extension:typescript-language-features \
				compile-extension:emmet \
				compile-extension:css-language-features-server \
				compile-extension:html-language-features-server \
				compile-extension:json-language-features-server \
				compile-extension:git \
				compile-extension-media

	# Configuration for more verbose output
	export VSCODE_CLI=1
	export ELECTRON_ENABLE_STACK_DUMPING=1
	export ELECTRON_ENABLE_LOGGING=1

	echo "Storing crash reports into '$VSCODECRASHDIR'."
	echo "Running integration tests with '$INTEGRATION_TEST_ELECTRON_PATH' as build."
fi

if [ -z "$INTEGRATION_TEST_APP_NAME" ]; then
	after_suite() { true; }
else
	after_suite() { killall $INTEGRATION_TEST_APP_NAME || true; }
fi

# Integration tests in AMD
./scripts/test.sh --runGlob **/*.integrationTest.js "$@"
after_suite

# Tests in the extension host

ALL_PLATFORMS_API_TESTS_EXTRA_ARGS="--disable-telemetry --crash-reporter-directory=$VSCODECRASHDIR --no-cached-data --disable-updates --disable-keytar --disable-extensions --user-data-dir=$VSCODEUSERDATADIR"

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/vscode-api-tests/testWorkspace --enable-proposed-api=vscode.vscode-api-tests --extensionDevelopmentPath=$ROOT/extensions/vscode-api-tests --extensionTestsPath=$ROOT/extensions/vscode-api-tests/out/singlefolder-tests $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/vscode-api-tests/testworkspace.code-workspace --enable-proposed-api=vscode.vscode-api-tests --extensionDevelopmentPath=$ROOT/extensions/vscode-api-tests --extensionTestsPath=$ROOT/extensions/vscode-api-tests/out/workspace-tests $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/vscode-colorize-tests/test --extensionDevelopmentPath=$ROOT/extensions/vscode-colorize-tests --extensionTestsPath=$ROOT/extensions/vscode-colorize-tests/out $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/markdown-language-features/test-workspace --extensionDevelopmentPath=$ROOT/extensions/markdown-language-features --extensionTestsPath=$ROOT/extensions/markdown-language-features/out/test $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/typescript-language-features/test-workspace --extensionDevelopmentPath=$ROOT/extensions/typescript-language-features --extensionTestsPath=$ROOT/extensions/typescript-language-features/out/test/unit $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/emmet/test-workspace --extensionDevelopmentPath=$ROOT/extensions/emmet --extensionTestsPath=$ROOT/extensions/emmet/out/test $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $(mktemp -d 2>/dev/null) --enable-proposed-api=vscode.git --extensionDevelopmentPath=$ROOT/extensions/git --extensionTestsPath=$ROOT/extensions/git/out/test $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_EXTRA_ARGS $ROOT/extensions/vscode-notebook-tests/test --enable-proposed-api=vscode.vscode-notebook-tests --extensionDevelopmentPath=$ROOT/extensions/vscode-notebook-tests --extensionTestsPath=$ROOT/extensions/vscode-notebook-tests/out/ $ALL_PLATFORMS_API_TESTS_EXTRA_ARGS
after_suite

# Tests in commonJS (CSS, HTML)
cd $ROOT/extensions/css-language-features/server && $ROOT/scripts/node-electron.sh test/index.js
after_suite

cd $ROOT/extensions/html-language-features/server && $ROOT/scripts/node-electron.sh test/index.js
after_suite

rm -rf $VSCODEUSERDATADIR
