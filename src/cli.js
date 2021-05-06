/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const bootstrap = require('./bootstrap');
const bootstrapNode = require('./bootstrap-node');
const product = require('../product.json');

// Avoid Monkey Patches from Application Insights
bootstrap.avoidMonkeyPatchFromAppInsights();

// Enable portable support
bootstrapNode.configurePortable(product);

// Enable ASAR support
bootstrap.enableASARSupport(undefined);

// Signal processes that we got launched as CLI
process.env['VSCODE_CLI'] = '1';

// Load CLI through AMD loader
require('./bootstrap-amd').load('vs/code/node/cli');
