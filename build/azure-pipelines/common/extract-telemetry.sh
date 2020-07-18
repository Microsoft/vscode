#!/usr/bin/env bash
set -e

cd $BUILD_STAGINGDIRECTORY
mkdir extraction
cd extraction
git clone --depth 1 https://github.com/Microsoft/vscode-extension-telemetry.git
git clone --depth 1 https://github.com/Microsoft/vscode-chrome-debug-core.git
git clone --depth 1 https://github.com/Microsoft/vscode-node-debug2.git
git clone --depth 1 https://github.com/Microsoft/vscode-node-debug.git
git clone --depth 1 https://github.com/Microsoft/vscode-html-languageservice.git
git clone --depth 1 https://github.com/Microsoft/vscode-json-languageservice.git
node $BUILD_SOURCESDIRECTORY/build/node_modules/.bin/vscode-telemetry-extractor --sourceDir $BUILD_SOURCESDIRECTORY --excludedDir $BUILD_SOURCESDIRECTORY/extensions --outputDir . --applyEndpoints
node $BUILD_SOURCESDIRECTORY/build/node_modules/.bin/vscode-telemetry-extractor --config $BUILD_SOURCESDIRECTORY/build/azure-pipelines/common/telemetry-config.json -o .
mkdir -p $BUILD_SOURCESDIRECTORY/.build/telemetry
mv declarations-resolved.json $BUILD_SOURCESDIRECTORY/.build/telemetry/telemetry-core.json
mv config-resolved.json $BUILD_SOURCESDIRECTORY/.build/telemetry/telemetry-extensions.json
cd ..
rm -rf extraction
