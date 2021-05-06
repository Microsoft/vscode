/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { QuickInputController } from 'vs/base/parts/quickinput/browser/quickInput';
import { IWorkbenchListOptions } from 'vs/platform/list/browser/listService';

// Simple promisify of setTimeout
function wait(delayMS: number) {
	return new Promise(function (resolve) {
		setTimeout(resolve, delayMS);
	});
}

suite('QuickInput', () => {
	let fixture: HTMLElement, controller: QuickInputController;

	setup(() => {
		fixture = document.createElement('div');
		document.body.appendChild(fixture);

		controller = new QuickInputController({
			container: fixture,
			idPrefix: 'testQuickInput',
			ignoreFocusOut() { return false; },
			isScreenReaderOptimized() { return false; },
			returnFocus() { },
			backKeybindingLabel() { return undefined; },
			setContextKey() { return undefined; },
			createList: <T>(
				user: string,
				container: HTMLElement,
				delegate: IListVirtualDelegate<T>,
				renderers: IListRenderer<T, any>[],
				options: IWorkbenchListOptions<T>,
			) => new List<T>(user, container, delegate, renderers, options),
			styles: {
				button: {},
				countBadge: {},
				inputBox: {},
				keybindingLabel: {},
				list: {},
				progressBar: {},
				widget: {}
			}
		});
	});

	teardown(() => {
		controller.dispose();
		document.body.removeChild(fixture);
	});

	test('onDidChangeValue gets triggered when .value is set', async () => {
		const quickpick = controller.createQuickPick();

		let value: string | undefined = undefined;
		quickpick.onDidChangeValue((e) => value = e);

		// Trigger a change
		quickpick.value = 'changed';

		try {
			// wait a bit to let the event play out.
			await wait(200);
			assert.strictEqual(value, quickpick.value);
		} finally {
			quickpick.dispose();
		}
	});
});
