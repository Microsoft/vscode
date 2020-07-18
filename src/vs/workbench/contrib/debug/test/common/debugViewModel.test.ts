/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ViewModel } from 'vs/workbench/contrib/debug/common/debugViewModel';
import { StackFrame, Expression, Thread } from 'vs/workbench/contrib/debug/common/debugModel';
import { MockSession } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';

suite('Debug - View Model', () => {
	let model: ViewModel;

	setup(() => {
		model = new ViewModel(new MockContextKeyService());
	});

	test('focused stack frame', () => {
		assert.equal(model.focusedStackFrame, null);
		assert.equal(model.focusedThread, null);
		const session = new MockSession();
		const thread = new Thread(session, 'myThread', 1);
		const source = new Source({
			name: 'internalModule.js',
			sourceReference: 11,
			presentationHint: 'deemphasize'
		}, 'aDebugSessionId');
		const frame = new StackFrame(thread, 1, source, 'app.js', 'normal', { startColumn: 1, startLineNumber: 1, endColumn: 1, endLineNumber: 1 }, 0);
		model.setFocus(frame, thread, session, false);

		assert.equal(model.focusedStackFrame!.getId(), frame.getId());
		assert.equal(model.focusedThread!.threadId, 1);
		assert.equal(model.focusedSession!.getId(), session.getId());
	});

	test('selected expression', () => {
		assert.equal(model.getSelectedExpression(), null);
		const expression = new Expression('my expression');
		model.setSelectedExpression(expression);

		assert.equal(model.getSelectedExpression(), expression);
	});

	test('multi session view and changed workbench state', () => {
		assert.equal(model.isMultiSessionView(), false);
		model.setMultiSessionView(true);
		assert.equal(model.isMultiSessionView(), true);
	});
});
