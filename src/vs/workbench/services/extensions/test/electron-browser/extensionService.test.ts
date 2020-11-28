/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ExtensionService as BrowserExtensionService } from 'vs/workbench/services/extensions/browser/extensionService';
import { ExtensionRunningLocation } from 'vs/workbench/services/extensions/common/abstractExtensionService';

suite('BrowserExtensionService', () => {
	test('pickRunningLocation', () => {
		assert.deepEqual(BrowserExtensionService.pickRunningLocation([], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation([], false, true), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation([], true, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation([], true, true), ExtensionRunningLocation.None);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui'], true, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui'], true, true), ExtensionRunningLocation.Remote);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace'], true, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace'], true, true), ExtensionRunningLocation.Remote);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web'], false, true), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web'], true, true), ExtensionRunningLocation.LocalWebWorker);


		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], true, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], true, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], true, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], true, true), ExtensionRunningLocation.Remote);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], true, true), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], true, true), ExtensionRunningLocation.Remote);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], true, true), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], true, true), ExtensionRunningLocation.LocalWebWorker);


		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], true, true), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], true, true), ExtensionRunningLocation.Remote);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], true, true), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], true, true), ExtensionRunningLocation.LocalWebWorker);

		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], true, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], false, false), ExtensionRunningLocation.None);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], false, true), ExtensionRunningLocation.Remote);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], true, false), ExtensionRunningLocation.LocalWebWorker);
		assert.deepEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], true, true), ExtensionRunningLocation.Remote);
	});
});
