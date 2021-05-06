/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI as uri } from 'vs/base/common/uri';
import { DebugModel, Breakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { getExpandedBodySize, getBreakpointMessageAndIcon } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { dispose } from 'vs/base/common/lifecycle';
import { Range } from 'vs/editor/common/core/range';
import { IBreakpointData, IBreakpointUpdateData, State } from 'vs/workbench/contrib/debug/common/debug';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LanguageIdentifier, LanguageId } from 'vs/editor/common/modes';
import { createBreakpointDecorations } from 'vs/workbench/contrib/debug/browser/breakpointEditorContribution';
import { OverviewRulerLane } from 'vs/editor/common/model';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { createMockSession } from 'vs/workbench/contrib/debug/test/browser/callStack.test';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/browser/mockDebug';

function addBreakpointsAndCheckEvents(model: DebugModel, uri: uri, data: IBreakpointData[]): void {
	let eventCount = 0;
	const toDispose = model.onDidChangeBreakpoints(e => {
		assert.strictEqual(e?.sessionOnly, false);
		assert.strictEqual(e?.changed, undefined);
		assert.strictEqual(e?.removed, undefined);
		const added = e?.added;
		assert.notStrictEqual(added, undefined);
		assert.strictEqual(added!.length, data.length);
		eventCount++;
		dispose(toDispose);
		for (let i = 0; i < data.length; i++) {
			assert.strictEqual(e!.added![i] instanceof Breakpoint, true);
			assert.strictEqual((e!.added![i] as Breakpoint).lineNumber, data[i].lineNumber);
		}
	});
	model.addBreakpoints(uri, data);
	assert.strictEqual(eventCount, 1);
}

suite('Debug - Breakpoints', () => {
	let model: DebugModel;

	setup(() => {
		model = createMockDebugModel();
	});

	// Breakpoints

	test('simple', () => {
		const modelUri = uri.file('/myfolder/myfile.js');

		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 5, enabled: true }, { lineNumber: 10, enabled: false }]);
		assert.strictEqual(model.areBreakpointsActivated(), true);
		assert.strictEqual(model.getBreakpoints().length, 2);

		let eventCount = 0;
		const toDispose = model.onDidChangeBreakpoints(e => {
			eventCount++;
			assert.strictEqual(e?.added, undefined);
			assert.strictEqual(e?.sessionOnly, false);
			assert.strictEqual(e?.removed?.length, 2);
			assert.strictEqual(e?.changed, undefined);

			dispose(toDispose);
		});

		model.removeBreakpoints(model.getBreakpoints());
		assert.strictEqual(eventCount, 1);
		assert.strictEqual(model.getBreakpoints().length, 0);
	});

	test('toggling', () => {
		const modelUri = uri.file('/myfolder/myfile.js');

		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 5, enabled: true }, { lineNumber: 10, enabled: false }]);
		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 12, enabled: true, condition: 'fake condition' }]);
		assert.strictEqual(model.getBreakpoints().length, 3);
		const bp = model.getBreakpoints().pop();
		if (bp) {
			model.removeBreakpoints([bp]);
		}
		assert.strictEqual(model.getBreakpoints().length, 2);

		model.setBreakpointsActivated(false);
		assert.strictEqual(model.areBreakpointsActivated(), false);
		model.setBreakpointsActivated(true);
		assert.strictEqual(model.areBreakpointsActivated(), true);
	});

	test('two files', () => {
		const modelUri1 = uri.file('/myfolder/my file first.js');
		const modelUri2 = uri.file('/secondfolder/second/second file.js');
		addBreakpointsAndCheckEvents(model, modelUri1, [{ lineNumber: 5, enabled: true }, { lineNumber: 10, enabled: false }]);
		assert.strictEqual(getExpandedBodySize(model, 9), 44);

		addBreakpointsAndCheckEvents(model, modelUri2, [{ lineNumber: 1, enabled: true }, { lineNumber: 2, enabled: true }, { lineNumber: 3, enabled: false }]);
		assert.strictEqual(getExpandedBodySize(model, 9), 110);

		assert.strictEqual(model.getBreakpoints().length, 5);
		assert.strictEqual(model.getBreakpoints({ uri: modelUri1 }).length, 2);
		assert.strictEqual(model.getBreakpoints({ uri: modelUri2 }).length, 3);
		assert.strictEqual(model.getBreakpoints({ lineNumber: 5 }).length, 1);
		assert.strictEqual(model.getBreakpoints({ column: 5 }).length, 0);

		const bp = model.getBreakpoints()[0];
		const update = new Map<string, IBreakpointUpdateData>();
		update.set(bp.getId(), { lineNumber: 100 });
		let eventFired = false;
		const toDispose = model.onDidChangeBreakpoints(e => {
			eventFired = true;
			assert.strictEqual(e?.added, undefined);
			assert.strictEqual(e?.removed, undefined);
			assert.strictEqual(e?.changed?.length, 1);
			dispose(toDispose);
		});
		model.updateBreakpoints(update);
		assert.strictEqual(eventFired, true);
		assert.strictEqual(bp.lineNumber, 100);

		assert.strictEqual(model.getBreakpoints({ enabledOnly: true }).length, 3);
		model.enableOrDisableAllBreakpoints(false);
		model.getBreakpoints().forEach(bp => {
			assert.strictEqual(bp.enabled, false);
		});
		assert.strictEqual(model.getBreakpoints({ enabledOnly: true }).length, 0);

		model.setEnablement(bp, true);
		assert.strictEqual(bp.enabled, true);

		model.removeBreakpoints(model.getBreakpoints({ uri: modelUri1 }));
		assert.strictEqual(getExpandedBodySize(model, 9), 66);

		assert.strictEqual(model.getBreakpoints().length, 3);
	});

	test('conditions', () => {
		const modelUri1 = uri.file('/myfolder/my file first.js');
		addBreakpointsAndCheckEvents(model, modelUri1, [{ lineNumber: 5, condition: 'i < 5', hitCondition: '17' }, { lineNumber: 10, condition: 'j < 3' }]);
		const breakpoints = model.getBreakpoints();

		assert.strictEqual(breakpoints[0].condition, 'i < 5');
		assert.strictEqual(breakpoints[0].hitCondition, '17');
		assert.strictEqual(breakpoints[1].condition, 'j < 3');
		assert.strictEqual(!!breakpoints[1].hitCondition, false);

		assert.strictEqual(model.getBreakpoints().length, 2);
		model.removeBreakpoints(model.getBreakpoints());
		assert.strictEqual(model.getBreakpoints().length, 0);
	});

	test('function breakpoints', () => {
		model.addFunctionBreakpoint('foo', '1');
		model.addFunctionBreakpoint('bar', '2');
		model.updateFunctionBreakpoint('1', { name: 'fooUpdated' });
		model.updateFunctionBreakpoint('2', { name: 'barUpdated' });

		const functionBps = model.getFunctionBreakpoints();
		assert.strictEqual(functionBps[0].name, 'fooUpdated');
		assert.strictEqual(functionBps[1].name, 'barUpdated');

		model.removeFunctionBreakpoints();
		assert.strictEqual(model.getFunctionBreakpoints().length, 0);
	});

	test('multiple sessions', () => {
		const modelUri = uri.file('/myfolder/myfile.js');
		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 5, enabled: true, condition: 'x > 5' }, { lineNumber: 10, enabled: false }]);
		const breakpoints = model.getBreakpoints();
		const session = createMockSession(model);
		const data = new Map<string, DebugProtocol.Breakpoint>();

		assert.strictEqual(breakpoints[0].lineNumber, 5);
		assert.strictEqual(breakpoints[1].lineNumber, 10);

		data.set(breakpoints[0].getId(), { verified: false, line: 10 });
		data.set(breakpoints[1].getId(), { verified: true, line: 50 });
		model.setBreakpointSessionData(session.getId(), {}, data);
		assert.strictEqual(breakpoints[0].lineNumber, 5);
		assert.strictEqual(breakpoints[1].lineNumber, 50);

		const session2 = createMockSession(model);
		const data2 = new Map<string, DebugProtocol.Breakpoint>();
		data2.set(breakpoints[0].getId(), { verified: true, line: 100 });
		data2.set(breakpoints[1].getId(), { verified: true, line: 500 });
		model.setBreakpointSessionData(session2.getId(), {}, data2);

		// Breakpoint is verified only once, show that line
		assert.strictEqual(breakpoints[0].lineNumber, 100);
		// Breakpoint is verified two times, show the original line
		assert.strictEqual(breakpoints[1].lineNumber, 10);

		model.setBreakpointSessionData(session.getId(), {}, undefined);
		// No more double session verification
		assert.strictEqual(breakpoints[0].lineNumber, 100);
		assert.strictEqual(breakpoints[1].lineNumber, 500);

		assert.strictEqual(breakpoints[0].supported, false);
		const data3 = new Map<string, DebugProtocol.Breakpoint>();
		data3.set(breakpoints[0].getId(), { verified: true, line: 500 });
		model.setBreakpointSessionData(session2.getId(), { supportsConditionalBreakpoints: true }, data2);
		assert.strictEqual(breakpoints[0].supported, true);
	});

	test('exception breakpoints', () => {
		let eventCount = 0;
		model.onDidChangeBreakpoints(() => eventCount++);
		model.setExceptionBreakpoints([{ filter: 'uncaught', label: 'UNCAUGHT', default: true }]);
		assert.strictEqual(eventCount, 1);
		let exceptionBreakpoints = model.getExceptionBreakpoints();
		assert.strictEqual(exceptionBreakpoints.length, 1);
		assert.strictEqual(exceptionBreakpoints[0].filter, 'uncaught');
		assert.strictEqual(exceptionBreakpoints[0].enabled, true);

		model.setExceptionBreakpoints([{ filter: 'uncaught', label: 'UNCAUGHT' }, { filter: 'caught', label: 'CAUGHT' }]);
		assert.strictEqual(eventCount, 2);
		exceptionBreakpoints = model.getExceptionBreakpoints();
		assert.strictEqual(exceptionBreakpoints.length, 2);
		assert.strictEqual(exceptionBreakpoints[0].filter, 'uncaught');
		assert.strictEqual(exceptionBreakpoints[0].enabled, true);
		assert.strictEqual(exceptionBreakpoints[1].filter, 'caught');
		assert.strictEqual(exceptionBreakpoints[1].label, 'CAUGHT');
		assert.strictEqual(exceptionBreakpoints[1].enabled, false);
	});

	test('data breakpoints', () => {
		let eventCount = 0;
		model.onDidChangeBreakpoints(() => eventCount++);

		model.addDataBreakpoint('label', 'id', true, ['read'], 'read');
		model.addDataBreakpoint('second', 'secondId', false, ['readWrite'], 'readWrite');
		const dataBreakpoints = model.getDataBreakpoints();
		assert.strictEqual(dataBreakpoints[0].canPersist, true);
		assert.strictEqual(dataBreakpoints[0].dataId, 'id');
		assert.strictEqual(dataBreakpoints[0].accessType, 'read');
		assert.strictEqual(dataBreakpoints[1].canPersist, false);
		assert.strictEqual(dataBreakpoints[1].description, 'second');
		assert.strictEqual(dataBreakpoints[1].accessType, 'readWrite');

		assert.strictEqual(eventCount, 2);

		model.removeDataBreakpoints(dataBreakpoints[0].getId());
		assert.strictEqual(eventCount, 3);
		assert.strictEqual(model.getDataBreakpoints().length, 1);

		model.removeDataBreakpoints();
		assert.strictEqual(model.getDataBreakpoints().length, 0);
		assert.strictEqual(eventCount, 4);
	});

	test('message and class name', () => {
		const modelUri = uri.file('/myfolder/my file first.js');
		addBreakpointsAndCheckEvents(model, modelUri, [
			{ lineNumber: 5, enabled: true, condition: 'x > 5' },
			{ lineNumber: 10, enabled: false },
			{ lineNumber: 12, enabled: true, logMessage: 'hello' },
			{ lineNumber: 15, enabled: true, hitCondition: '12' },
			{ lineNumber: 500, enabled: true },
		]);
		const breakpoints = model.getBreakpoints();

		let result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[0]);
		assert.strictEqual(result.message, 'Expression condition: x > 5');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-conditional');

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[1]);
		assert.strictEqual(result.message, 'Disabled Breakpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-disabled');

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[2]);
		assert.strictEqual(result.message, 'Log Message: hello');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-log');

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[3]);
		assert.strictEqual(result.message, 'Hit Count: 12');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-conditional');

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[4]);
		assert.strictEqual(result.message, 'Breakpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint');

		result = getBreakpointMessageAndIcon(State.Stopped, false, breakpoints[2]);
		assert.strictEqual(result.message, 'Disabled Logpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-log-disabled');

		model.addDataBreakpoint('label', 'id', true, ['read'], 'read');
		const dataBreakpoints = model.getDataBreakpoints();
		result = getBreakpointMessageAndIcon(State.Stopped, true, dataBreakpoints[0]);
		assert.strictEqual(result.message, 'Data Breakpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-data');

		const functionBreakpoint = model.addFunctionBreakpoint('foo', '1');
		result = getBreakpointMessageAndIcon(State.Stopped, true, functionBreakpoint);
		assert.strictEqual(result.message, 'Function Breakpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-function');

		const data = new Map<string, DebugProtocol.Breakpoint>();
		data.set(breakpoints[0].getId(), { verified: false, line: 10 });
		data.set(breakpoints[1].getId(), { verified: true, line: 50 });
		data.set(breakpoints[2].getId(), { verified: true, line: 50, message: 'world' });
		data.set(functionBreakpoint.getId(), { verified: true });
		model.setBreakpointSessionData('mocksessionid', { supportsFunctionBreakpoints: false, supportsDataBreakpoints: true, supportsLogPoints: true }, data);

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[0]);
		assert.strictEqual(result.message, 'Unverified Breakpoint');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-unverified');

		result = getBreakpointMessageAndIcon(State.Stopped, true, functionBreakpoint);
		assert.strictEqual(result.message, 'Function breakpoints not supported by this debug type');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-function-unverified');

		result = getBreakpointMessageAndIcon(State.Stopped, true, breakpoints[2]);
		assert.strictEqual(result.message, 'Log Message: hello, world');
		assert.strictEqual(result.icon.id, 'debug-breakpoint-log');
	});

	test('decorations', () => {
		const modelUri = uri.file('/myfolder/my file first.js');
		const languageIdentifier = new LanguageIdentifier('testMode', LanguageId.PlainText);
		const textModel = createTextModel(
			['this is line one', 'this is line two', '    this is line three it has whitespace at start', 'this is line four', 'this is line five'].join('\n'),
			TextModel.DEFAULT_CREATION_OPTIONS,
			languageIdentifier
		);
		addBreakpointsAndCheckEvents(model, modelUri, [
			{ lineNumber: 1, enabled: true, condition: 'x > 5' },
			{ lineNumber: 2, column: 4, enabled: false },
			{ lineNumber: 3, enabled: true, logMessage: 'hello' },
			{ lineNumber: 500, enabled: true },
		]);
		const breakpoints = model.getBreakpoints();

		let decorations = createBreakpointDecorations(textModel, breakpoints, State.Running, true, true);
		assert.strictEqual(decorations.length, 3); // last breakpoint filtered out since it has a large line number
		assert.deepStrictEqual(decorations[0].range, new Range(1, 1, 1, 2));
		assert.deepStrictEqual(decorations[1].range, new Range(2, 4, 2, 5));
		assert.deepStrictEqual(decorations[2].range, new Range(3, 5, 3, 6));
		assert.strictEqual(decorations[0].options.beforeContentClassName, undefined);
		assert.strictEqual(decorations[1].options.beforeContentClassName, `debug-breakpoint-placeholder`);
		assert.strictEqual(decorations[0].options.overviewRuler?.position, OverviewRulerLane.Left);
		const expected = new MarkdownString().appendCodeblock(languageIdentifier.language, 'Expression condition: x > 5');
		assert.deepStrictEqual(decorations[0].options.glyphMarginHoverMessage, expected);

		decorations = createBreakpointDecorations(textModel, breakpoints, State.Running, true, false);
		assert.strictEqual(decorations[0].options.overviewRuler, null);
	});
});
