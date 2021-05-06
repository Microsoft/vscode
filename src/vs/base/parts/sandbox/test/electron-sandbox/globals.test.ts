/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ipcRenderer, crashReporter, webFrame, context, process } from 'vs/base/parts/sandbox/electron-sandbox/globals';

suite('Sandbox', () => {
	test('globals', async () => {
		assert.ok(typeof ipcRenderer.send === 'function');
		assert.ok(typeof crashReporter.addExtraParameter === 'function');
		assert.ok(typeof webFrame.setZoomLevel === 'function');
		assert.ok(typeof process.platform === 'string');

		const config = await context.resolveConfiguration();
		assert.ok(config);
		assert.ok(context.configuration());
	});
});
