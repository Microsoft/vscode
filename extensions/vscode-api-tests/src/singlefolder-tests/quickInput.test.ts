/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { window, commands } from 'vscode';
import { assertNoRpc, closeAllEditors } from '../utils';

interface QuickPickExpected {
	events: string[];
	activeItems: string[][];
	selectionItems: string[][];
	acceptedItems: {
		active: string[][];
		selection: string[][];
		dispose: boolean[];
	};
}

suite('vscode API - quick input', function () {

	teardown(async function () {
		assertNoRpc();
		await closeAllEditors();
	});

	test('createQuickPick, select second', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], ['zwei']],
			selectionItems: [['zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		(async () => {
			await commands.executeCommand('workbench.action.quickOpenSelectNext');
			await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		})()
			.catch(err => done(err));
	});

	test('createQuickPick, focus second', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'hide'],
			activeItems: [['zwei']],
			selectionItems: [['zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.activeItems = [quickPick.items[1]];
		quickPick.show();

		(async () => {
			await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		})()
			.catch(err => done(err));
	});

	test('createQuickPick, select first and second', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], ['zwei']],
			selectionItems: [['eins'], ['eins', 'zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['eins', 'zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.canSelectMany = true;
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		(async () => {
			await commands.executeCommand('workbench.action.quickOpenSelectNext');
			await commands.executeCommand('workbench.action.quickPickManyToggle');
			await commands.executeCommand('workbench.action.quickOpenSelectNext');
			await commands.executeCommand('workbench.action.quickPickManyToggle');
			await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		})()
			.catch(err => done(err));
	});

	test('createQuickPick, selection events', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'selection', 'accept', 'hide'],
			activeItems: [['eins']],
			selectionItems: [['zwei'], ['drei']],
			acceptedItems: {
				active: [['eins'], ['eins']],
				selection: [['zwei'], ['drei']],
				dispose: [false, true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		quickPick.selectedItems = [quickPick.items[1]];
		setTimeout(() => {
			quickPick.selectedItems = [quickPick.items[2]];
		}, 0);
	});

	test('createQuickPick, continue after first accept', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'active', 'selection', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], [], ['drei']],
			selectionItems: [['eins'], [], ['drei']],
			acceptedItems: {
				active: [['eins'], ['drei']],
				selection: [['eins'], ['drei']],
				dispose: [false, true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei'].map(label => ({ label }));
		quickPick.show();

		(async () => {
			await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
			await timeout(async () => {
				quickPick.items = ['drei', 'vier'].map(label => ({ label }));
				await timeout(async () => {
					await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
				}, 0);
			}, 0);
		})()
			.catch(err => done(err));
	});

	test('createQuickPick, dispose in onDidHide', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		let hidden = false;
		const quickPick = window.createQuickPick();
		quickPick.onDidHide(() => {
			if (hidden) {
				done(new Error('Already hidden'));
			} else {
				hidden = true;
				quickPick.dispose();
				setTimeout(done, 0);
			}
		});
		quickPick.show();
		quickPick.hide();
	});

	test('createQuickPick, hide and dispose', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		let hidden = false;
		const quickPick = window.createQuickPick();
		quickPick.onDidHide(() => {
			if (hidden) {
				done(new Error('Already hidden'));
			} else {
				hidden = true;
				setTimeout(done, 0);
			}
		});
		quickPick.show();
		quickPick.hide();
		quickPick.dispose();
	});
});

function createQuickPick(expected: QuickPickExpected, done: (err?: any) => void, record = false) {
	const quickPick = window.createQuickPick();
	let eventIndex = -1;
	quickPick.onDidChangeActive(items => {
		if (record) {
			console.log(`active: [${items.map(item => item.label).join(', ')}]`);
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('active', expected.events.shift(), `onDidChangeActive (event ${eventIndex})`);
			const expectedItems = expected.activeItems.shift();
			assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeActive event items (event ${eventIndex})`);
			assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedItems, `onDidChangeActive active items (event ${eventIndex})`);
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidChangeSelection(items => {
		if (record) {
			console.log(`selection: [${items.map(item => item.label).join(', ')}]`);
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('selection', expected.events.shift(), `onDidChangeSelection (event ${eventIndex})`);
			const expectedItems = expected.selectionItems.shift();
			assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeSelection event items (event ${eventIndex})`);
			assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedItems, `onDidChangeSelection selected items (event ${eventIndex})`);
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidAccept(() => {
		if (record) {
			console.log('accept');
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('accept', expected.events.shift(), `onDidAccept (event ${eventIndex})`);
			const expectedActive = expected.acceptedItems.active.shift();
			assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedActive, `onDidAccept active items (event ${eventIndex})`);
			const expectedSelection = expected.acceptedItems.selection.shift();
			assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedSelection, `onDidAccept selected items (event ${eventIndex})`);
			if (expected.acceptedItems.dispose.shift()) {
				quickPick.dispose();
			}
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidHide(() => {
		if (record) {
			console.log('hide');
			done();
			return;
		}
		try {
			assert.strictEqual('hide', expected.events.shift());
			done();
		} catch (err) {
			done(err);
		}
	});

	return quickPick;
}

async function timeout<T>(run: () => Promise<T> | T, ms: number): Promise<T> {
	return new Promise<T>(resolve => setTimeout(() => resolve(run()), ms));
}
