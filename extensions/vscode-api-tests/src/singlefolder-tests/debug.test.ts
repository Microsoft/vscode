/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { debug, workspace, Disposable, commands, window } from 'vscode';
import { assertNoRpc, disposeAll } from '../utils';
import { basename } from 'path';

suite('vscode API - debug', function () {

	teardown(assertNoRpc);

	test('breakpoints', async function () {
		assert.strictEqual(debug.breakpoints.length, 0);
		let onDidChangeBreakpointsCounter = 0;
		const toDispose: Disposable[] = [];

		toDispose.push(debug.onDidChangeBreakpoints(() => {
			onDidChangeBreakpointsCounter++;
		}));

		debug.addBreakpoints([{ id: '1', enabled: true }, { id: '2', enabled: false, condition: '2 < 5' }]);
		assert.strictEqual(onDidChangeBreakpointsCounter, 1);
		assert.strictEqual(debug.breakpoints.length, 2);
		assert.strictEqual(debug.breakpoints[0].id, '1');
		assert.strictEqual(debug.breakpoints[1].id, '2');
		assert.strictEqual(debug.breakpoints[1].condition, '2 < 5');

		debug.removeBreakpoints([{ id: '1', enabled: true }]);
		assert.strictEqual(onDidChangeBreakpointsCounter, 2);
		assert.strictEqual(debug.breakpoints.length, 1);

		debug.removeBreakpoints([{ id: '2', enabled: false }]);
		assert.strictEqual(onDidChangeBreakpointsCounter, 3);
		assert.strictEqual(debug.breakpoints.length, 0);

		disposeAll(toDispose);
	});

	test.skip('start debugging', async function () {
		let stoppedEvents = 0;
		let variablesReceived: () => void;
		let initializedReceived: () => void;
		let configurationDoneReceived: () => void;
		const toDispose: Disposable[] = [];
		if (debug.activeDebugSession) {
			// We are re-running due to flakyness, make sure to clear out state
			let sessionTerminatedRetry: () => void;
			toDispose.push(debug.onDidTerminateDebugSession(() => {
				sessionTerminatedRetry();
			}));
			const sessionTerminatedPromise = new Promise<void>(resolve => sessionTerminatedRetry = resolve);
			await commands.executeCommand('workbench.action.debug.stop');
			await sessionTerminatedPromise;
		}

		const firstVariablesRetrieved = new Promise<void>(resolve => variablesReceived = resolve);
		toDispose.push(debug.registerDebugAdapterTrackerFactory('*', {
			createDebugAdapterTracker: () => ({
				onDidSendMessage: m => {
					if (m.event === 'stopped') {
						stoppedEvents++;
					}
					if (m.type === 'response' && m.command === 'variables') {
						variablesReceived();
					}
					if (m.event === 'initialized') {
						initializedReceived();
					}
					if (m.command === 'configurationDone') {
						configurationDoneReceived();
					}
				}
			})
		}));

		const initializedPromise = new Promise<void>(resolve => initializedReceived = resolve);
		const configurationDonePromise = new Promise<void>(resolve => configurationDoneReceived = resolve);
		const success = await debug.startDebugging(workspace.workspaceFolders![0], 'Launch debug.js');
		assert.strictEqual(success, true);
		await initializedPromise;
		await configurationDonePromise;

		await firstVariablesRetrieved;
		assert.notStrictEqual(debug.activeDebugSession, undefined);
		assert.strictEqual(stoppedEvents, 1);

		const secondVariablesRetrieved = new Promise<void>(resolve => variablesReceived = resolve);
		await commands.executeCommand('workbench.action.debug.stepOver');
		await secondVariablesRetrieved;
		assert.strictEqual(stoppedEvents, 2);
		const editor = window.activeTextEditor;
		assert.notStrictEqual(editor, undefined);
		assert.strictEqual(basename(editor!.document.fileName), 'debug.js');

		const thirdVariablesRetrieved = new Promise<void>(resolve => variablesReceived = resolve);
		await commands.executeCommand('workbench.action.debug.stepOver');
		await thirdVariablesRetrieved;
		assert.strictEqual(stoppedEvents, 3);

		const fourthVariablesRetrieved = new Promise<void>(resolve => variablesReceived = resolve);
		await commands.executeCommand('workbench.action.debug.stepInto');
		await fourthVariablesRetrieved;
		assert.strictEqual(stoppedEvents, 4);

		const fifthVariablesRetrieved = new Promise<void>(resolve => variablesReceived = resolve);
		await commands.executeCommand('workbench.action.debug.stepOut');
		await fifthVariablesRetrieved;
		assert.strictEqual(stoppedEvents, 5);

		let sessionTerminated: () => void;
		toDispose.push(debug.onDidTerminateDebugSession(() => {
			sessionTerminated();
		}));
		const sessionTerminatedPromise = new Promise<void>(resolve => sessionTerminated = resolve);
		await commands.executeCommand('workbench.action.debug.stop');
		await sessionTerminatedPromise;
		disposeAll(toDispose);
	});

	test('start debugging failure', async function () {
		let errorCount = 0;
		try {
			await debug.startDebugging(workspace.workspaceFolders![0], 'non existent');
		} catch (e) {
			errorCount++;
		}
		assert.strictEqual(errorCount, 1);
	});
});
