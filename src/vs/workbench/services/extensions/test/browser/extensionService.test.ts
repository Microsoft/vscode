/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ExtensionService as BrowserExtensionService } from 'vs/workbench/services/extensions/browser/extensionService';
import { ExtensionRunningLocation, ExtensionRunningPreference } from 'vs/workbench/services/extensions/common/abstractExtensionService';

suite('BrowserExtensionService', () => {
	test('pickRunningLocation', () => {
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation([], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation([], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation([], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation([], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.None);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);


		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);


		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'web', 'workspace'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['ui', 'workspace', 'web'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'ui', 'workspace'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['web', 'workspace', 'ui'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);

		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'ui', 'web'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], false, false, ExtensionRunningPreference.None), ExtensionRunningLocation.None);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], false, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], true, false, ExtensionRunningPreference.None), ExtensionRunningLocation.LocalWebWorker);
		assert.deepStrictEqual(BrowserExtensionService.pickRunningLocation(['workspace', 'web', 'ui'], true, true, ExtensionRunningPreference.None), ExtensionRunningLocation.Remote);
	});
});
