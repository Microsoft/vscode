/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI as uri } from 'vs/base/common/uri';
import { DebugModel, Breakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { DebugSession } from 'vs/workbench/contrib/debug/browser/debugSession';
import { NullOpenerService } from 'vs/platform/opener/common/opener';
import { getExpandedBodySize, getBreakpointMessageAndClassName } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { dispose } from 'vs/base/common/lifecycle';
import { Range } from 'vs/editor/common/core/range';
import { IBreakpointData, IDebugSessionOptions, IBreakpointUpdateData, State } from 'vs/workbench/contrib/debug/common/debug';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LanguageIdentifier, LanguageId } from 'vs/editor/common/modes';
import { createBreakpointDecorations } from 'vs/workbench/contrib/debug/browser/breakpointEditorContribution';
import { OverviewRulerLane } from 'vs/editor/common/model';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { generateUuid } from 'vs/base/common/uuid';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/common/mockDebug';

function createMockSession(model: DebugModel, name = 'mockSession', options?: IDebugSessionOptions): DebugSession {
	return new DebugSession(generateUuid(), { resolved: { name, type: 'node', request: 'launch' }, unresolved: undefined }, undefined!, model, options, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, NullOpenerService, undefined!, undefined!);
}

function addBreakpointsAndCheckEvents(model: DebugModel, uri: uri, data: IBreakpointData[]): void {
	let eventCount = 0;
	const toDispose = model.onDidChangeBreakpoints(e => {
		assert.equal(e?.sessionOnly, false);
		assert.equal(e?.changed, undefined);
		assert.equal(e?.removed, undefined);
		const added = e?.added;
		assert.notEqual(added, undefined);
		assert.equal(added!.length, data.length);
		eventCount++;
		dispose(toDispose);
		for (let i = 0; i < data.length; i++) {
			assert.equal(e!.added![i] instanceof Breakpoint, true);
			assert.equal((e!.added![i] as Breakpoint).lineNumber, data[i].lineNumber);
		}
	});
	model.addBreakpoints(uri, data);
	assert.equal(eventCount, 1);
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
		assert.equal(model.areBreakpointsActivated(), true);
		assert.equal(model.getBreakpoints().length, 2);

		let eventCount = 0;
		const toDispose = model.onDidChangeBreakpoints(e => {
			eventCount++;
			assert.equal(e?.added, undefined);
			assert.equal(e?.sessionOnly, false);
			assert.equal(e?.removed?.length, 2);
			assert.equal(e?.changed, undefined);

			dispose(toDispose);
		});

		model.removeBreakpoints(model.getBreakpoints());
		assert.equal(eventCount, 1);
		assert.equal(model.getBreakpoints().length, 0);
	});

	test('toggling', () => {
		const modelUri = uri.file('/myfolder/myfile.js');

		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 5, enabled: true }, { lineNumber: 10, enabled: false }]);
		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 12, enabled: true, condition: 'fake condition' }]);
		assert.equal(model.getBreakpoints().length, 3);
		const bp = model.getBreakpoints().pop();
		if (bp) {
			model.removeBreakpoints([bp]);
		}
		assert.equal(model.getBreakpoints().length, 2);

		model.setBreakpointsActivated(false);
		assert.equal(model.areBreakpointsActivated(), false);
		model.setBreakpointsActivated(true);
		assert.equal(model.areBreakpointsActivated(), true);
	});

	test('two files', () => {
		const modelUri1 = uri.file('/myfolder/my file first.js');
		const modelUri2 = uri.file('/secondfolder/second/second file.js');
		addBreakpointsAndCheckEvents(model, modelUri1, [{ lineNumber: 5, enabled: true }, { lineNumber: 10, enabled: false }]);
		assert.equal(getExpandedBodySize(model, 9), 44);

		addBreakpointsAndCheckEvents(model, modelUri2, [{ lineNumber: 1, enabled: true }, { lineNumber: 2, enabled: true }, { lineNumber: 3, enabled: false }]);
		assert.equal(getExpandedBodySize(model, 9), 110);

		assert.equal(model.getBreakpoints().length, 5);
		assert.equal(model.getBreakpoints({ uri: modelUri1 }).length, 2);
		assert.equal(model.getBreakpoints({ uri: modelUri2 }).length, 3);
		assert.equal(model.getBreakpoints({ lineNumber: 5 }).length, 1);
		assert.equal(model.getBreakpoints({ column: 5 }).length, 0);

		const bp = model.getBreakpoints()[0];
		const update = new Map<string, IBreakpointUpdateData>();
		update.set(bp.getId(), { lineNumber: 100 });
		let eventFired = false;
		const toDispose = model.onDidChangeBreakpoints(e => {
			eventFired = true;
			assert.equal(e?.added, undefined);
			assert.equal(e?.removed, undefined);
			assert.equal(e?.changed?.length, 1);
			dispose(toDispose);
		});
		model.updateBreakpoints(update);
		assert.equal(eventFired, true);
		assert.equal(bp.lineNumber, 100);

		assert.equal(model.getBreakpoints({ enabledOnly: true }).length, 3);
		model.enableOrDisableAllBreakpoints(false);
		model.getBreakpoints().forEach(bp => {
			assert.equal(bp.enabled, false);
		});
		assert.equal(model.getBreakpoints({ enabledOnly: true }).length, 0);

		model.setEnablement(bp, true);
		assert.equal(bp.enabled, true);

		model.removeBreakpoints(model.getBreakpoints({ uri: modelUri1 }));
		assert.equal(getExpandedBodySize(model, 9), 66);

		assert.equal(model.getBreakpoints().length, 3);
	});

	test('conditions', () => {
		const modelUri1 = uri.file('/myfolder/my file first.js');
		addBreakpointsAndCheckEvents(model, modelUri1, [{ lineNumber: 5, condition: 'i < 5', hitCondition: '17' }, { lineNumber: 10, condition: 'j < 3' }]);
		const breakpoints = model.getBreakpoints();

		assert.equal(breakpoints[0].condition, 'i < 5');
		assert.equal(breakpoints[0].hitCondition, '17');
		assert.equal(breakpoints[1].condition, 'j < 3');
		assert.equal(!!breakpoints[1].hitCondition, false);

		assert.equal(model.getBreakpoints().length, 2);
		model.removeBreakpoints(model.getBreakpoints());
		assert.equal(model.getBreakpoints().length, 0);
	});

	test('function breakpoints', () => {
		model.addFunctionBreakpoint('foo', '1');
		model.addFunctionBreakpoint('bar', '2');
		model.renameFunctionBreakpoint('1', 'fooUpdated');
		model.renameFunctionBreakpoint('2', 'barUpdated');

		const functionBps = model.getFunctionBreakpoints();
		assert.equal(functionBps[0].name, 'fooUpdated');
		assert.equal(functionBps[1].name, 'barUpdated');

		model.removeFunctionBreakpoints();
		assert.equal(model.getFunctionBreakpoints().length, 0);
	});

	test('multiple sessions', () => {
		const modelUri = uri.file('/myfolder/myfile.js');
		addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 5, enabled: true, condition: 'x > 5' }, { lineNumber: 10, enabled: false }]);
		const breakpoints = model.getBreakpoints();
		const session = createMockSession(model);
		const data = new Map<string, DebugProtocol.Breakpoint>();

		assert.equal(breakpoints[0].lineNumber, 5);
		assert.equal(breakpoints[1].lineNumber, 10);

		data.set(breakpoints[0].getId(), { verified: false, line: 10 });
		data.set(breakpoints[1].getId(), { verified: true, line: 50 });
		model.setBreakpointSessionData(session.getId(), {}, data);
		assert.equal(breakpoints[0].lineNumber, 5);
		assert.equal(breakpoints[1].lineNumber, 50);

		const session2 = createMockSession(model);
		const data2 = new Map<string, DebugProtocol.Breakpoint>();
		data2.set(breakpoints[0].getId(), { verified: true, line: 100 });
		data2.set(breakpoints[1].getId(), { verified: true, line: 500 });
		model.setBreakpointSessionData(session2.getId(), {}, data2);

		// Breakpoint is verified only once, show that line
		assert.equal(breakpoints[0].lineNumber, 100);
		// Breakpoint is verified two times, show the original line
		assert.equal(breakpoints[1].lineNumber, 10);

		model.setBreakpointSessionData(session.getId(), {}, undefined);
		// No more double session verification
		assert.equal(breakpoints[0].lineNumber, 100);
		assert.equal(breakpoints[1].lineNumber, 500);

		assert.equal(breakpoints[0].supported, false);
		const data3 = new Map<string, DebugProtocol.Breakpoint>();
		data3.set(breakpoints[0].getId(), { verified: true, line: 500 });
		model.setBreakpointSessionData(session2.getId(), { supportsConditionalBreakpoints: true }, data2);
		assert.equal(breakpoints[0].supported, true);
	});

	test('exception breakpoints', () => {
		let eventCount = 0;
		model.onDidChangeBreakpoints(() => eventCount++);
		model.setExceptionBreakpoints([{ filter: 'uncaught', label: 'UNCAUGHT', default: true }]);
		assert.equal(eventCount, 1);
		let exceptionBreakpoints = model.getExceptionBreakpoints();
		assert.equal(exceptionBreakpoints.length, 1);
		assert.equal(exceptionBreakpoints[0].filter, 'uncaught');
		assert.equal(exceptionBreakpoints[0].enabled, true);

		model.setExceptionBreakpoints([{ filter: 'uncaught', label: 'UNCAUGHT' }, { filter: 'caught', label: 'CAUGHT' }]);
		assert.equal(eventCount, 2);
		exceptionBreakpoints = model.getExceptionBreakpoints();
		assert.equal(exceptionBreakpoints.length, 2);
		assert.equal(exceptionBreakpoints[0].filter, 'uncaught');
		assert.equal(exceptionBreakpoints[0].enabled, true);
		assert.equal(exceptionBreakpoints[1].filter, 'caught');
		assert.equal(exceptionBreakpoints[1].label, 'CAUGHT');
		assert.equal(exceptionBreakpoints[1].enabled, false);
	});

	test('data breakpoints', () => {
		let eventCount = 0;
		model.onDidChangeBreakpoints(() => eventCount++);

		model.addDataBreakpoint('label', 'id', true, ['read']);
		model.addDataBreakpoint('second', 'secondId', false, ['readWrite']);
		const dataBreakpoints = model.getDataBreakpoints();
		assert.equal(dataBreakpoints[0].canPersist, true);
		assert.equal(dataBreakpoints[0].dataId, 'id');
		assert.equal(dataBreakpoints[1].canPersist, false);
		assert.equal(dataBreakpoints[1].description, 'second');

		assert.equal(eventCount, 2);

		model.removeDataBreakpoints(dataBreakpoints[0].getId());
		assert.equal(eventCount, 3);
		assert.equal(model.getDataBreakpoints().length, 1);

		model.removeDataBreakpoints();
		assert.equal(model.getDataBreakpoints().length, 0);
		assert.equal(eventCount, 4);
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

		let result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[0]);
		assert.equal(result.message, 'Expression: x > 5');
		assert.equal(result.className, 'codicon-debug-breakpoint-conditional');

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[1]);
		assert.equal(result.message, 'Disabled Breakpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint-disabled');

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[2]);
		assert.equal(result.message, 'Log Message: hello');
		assert.equal(result.className, 'codicon-debug-breakpoint-log');

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[3]);
		assert.equal(result.message, 'Hit Count: 12');
		assert.equal(result.className, 'codicon-debug-breakpoint-conditional');

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[4]);
		assert.equal(result.message, 'Breakpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint');

		result = getBreakpointMessageAndClassName(State.Stopped, false, breakpoints[2]);
		assert.equal(result.message, 'Disabled Logpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint-log-disabled');

		model.addDataBreakpoint('label', 'id', true, ['read']);
		const dataBreakpoints = model.getDataBreakpoints();
		result = getBreakpointMessageAndClassName(State.Stopped, true, dataBreakpoints[0]);
		assert.equal(result.message, 'Data Breakpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint-data');

		const functionBreakpoint = model.addFunctionBreakpoint('foo', '1');
		result = getBreakpointMessageAndClassName(State.Stopped, true, functionBreakpoint);
		assert.equal(result.message, 'Function Breakpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint-function');

		const data = new Map<string, DebugProtocol.Breakpoint>();
		data.set(breakpoints[0].getId(), { verified: false, line: 10 });
		data.set(breakpoints[1].getId(), { verified: true, line: 50 });
		data.set(breakpoints[2].getId(), { verified: true, line: 50, message: 'world' });
		data.set(functionBreakpoint.getId(), { verified: true });
		model.setBreakpointSessionData('mocksessionid', { supportsFunctionBreakpoints: false, supportsDataBreakpoints: true, supportsLogPoints: true }, data);

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[0]);
		assert.equal(result.message, 'Unverified Breakpoint');
		assert.equal(result.className, 'codicon-debug-breakpoint-unverified');

		result = getBreakpointMessageAndClassName(State.Stopped, true, functionBreakpoint);
		assert.equal(result.message, 'Function breakpoints not supported by this debug type');
		assert.equal(result.className, 'codicon-debug-breakpoint-function-unverified');

		result = getBreakpointMessageAndClassName(State.Stopped, true, breakpoints[2]);
		assert.equal(result.message, 'Log Message: hello, world');
		assert.equal(result.className, 'codicon-debug-breakpoint-log');
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
		assert.equal(decorations.length, 3); // last breakpoint filtered out since it has a large line number
		assert.deepEqual(decorations[0].range, new Range(1, 1, 1, 2));
		assert.deepEqual(decorations[1].range, new Range(2, 4, 2, 5));
		assert.deepEqual(decorations[2].range, new Range(3, 5, 3, 6));
		assert.equal(decorations[0].options.beforeContentClassName, undefined);
		assert.equal(decorations[1].options.beforeContentClassName, `debug-breakpoint-placeholder`);
		assert.equal(decorations[0].options.overviewRuler?.position, OverviewRulerLane.Left);
		const expected = new MarkdownString().appendCodeblock(languageIdentifier.language, 'Expression: x > 5');
		assert.deepEqual(decorations[0].options.glyphMarginHoverMessage, expected);

		decorations = createBreakpointDecorations(textModel, breakpoints, State.Running, true, false);
		assert.equal(decorations[0].options.overviewRuler, null);
	});
});
