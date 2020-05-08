/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DebugModel, StackFrame, Thread } from 'vs/workbench/contrib/debug/common/debugModel';
import * as sinon from 'sinon';
import { MockRawSession, createMockDebugModel } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { DebugSession } from 'vs/workbench/contrib/debug/browser/debugSession';
import { Range } from 'vs/editor/common/core/range';
import { IDebugSessionOptions, State } from 'vs/workbench/contrib/debug/common/debug';
import { NullOpenerService } from 'vs/platform/opener/common/opener';
import { createDecorationsForStackFrame } from 'vs/workbench/contrib/debug/browser/callStackEditorContribution';
import { Constants } from 'vs/base/common/uint';
import { getContext, getContextForContributedActions, getSpecificSourceName } from 'vs/workbench/contrib/debug/browser/callStackView';
import { getStackFrameThreadAndSessionToFocus } from 'vs/workbench/contrib/debug/browser/debugService';
import { generateUuid } from 'vs/base/common/uuid';

export function createMockSession(model: DebugModel, name = 'mockSession', options?: IDebugSessionOptions): DebugSession {
	return new DebugSession(generateUuid(), { resolved: { name, type: 'node', request: 'launch' }, unresolved: undefined }, undefined!, model, options, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, NullOpenerService, undefined!, undefined!);
}

function createTwoStackFrames(session: DebugSession): { firstStackFrame: StackFrame, secondStackFrame: StackFrame } {
	let firstStackFrame: StackFrame;
	let secondStackFrame: StackFrame;
	const thread = new class extends Thread {
		public getCallStack(): StackFrame[] {
			return [firstStackFrame, secondStackFrame];
		}
	}(session, 'mockthread', 1);

	const firstSource = new Source({
		name: 'internalModule.js',
		path: 'a/b/c/d/internalModule.js',
		sourceReference: 10,
	}, 'aDebugSessionId');
	const secondSource = new Source({
		name: 'internalModule.js',
		path: 'z/x/c/d/internalModule.js',
		sourceReference: 11,
	}, 'aDebugSessionId');

	firstStackFrame = new StackFrame(thread, 1, firstSource, 'app.js', 'normal', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, 1);
	secondStackFrame = new StackFrame(thread, 1, secondSource, 'app.js', 'normal', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, 1);

	return { firstStackFrame, secondStackFrame };
}

suite('Debug - CallStack', () => {
	let model: DebugModel;
	let rawSession: MockRawSession;

	setup(() => {
		model = createMockDebugModel();
		rawSession = new MockRawSession();
	});

	// Threads

	test('threads simple', () => {
		const threadId = 1;
		const threadName = 'firstThread';
		const session = createMockSession(model);
		model.addSession(session);

		assert.equal(model.getSessions(true).length, 1);
		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: threadId,
				name: threadName
			}]
		});

		assert.equal(session.getThread(threadId)!.name, threadName);

		model.clearThreads(session.getId(), true);
		assert.equal(session.getThread(threadId), undefined);
		assert.equal(model.getSessions(true).length, 1);
	});

	test('threads multiple wtih allThreadsStopped', () => {
		const threadId1 = 1;
		const threadName1 = 'firstThread';
		const threadId2 = 2;
		const threadName2 = 'secondThread';
		const stoppedReason = 'breakpoint';

		// Add the threads
		const session = createMockSession(model);
		model.addSession(session);

		session['raw'] = <any>rawSession;

		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: threadId1,
				name: threadName1
			}]
		});

		// Stopped event with all threads stopped
		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: threadId1,
				name: threadName1
			}, {
				id: threadId2,
				name: threadName2
			}],
			stoppedDetails: {
				reason: stoppedReason,
				threadId: 1,
				allThreadsStopped: true
			},
		});

		const thread1 = session.getThread(threadId1)!;
		const thread2 = session.getThread(threadId2)!;

		// at the beginning, callstacks are obtainable but not available
		assert.equal(session.getAllThreads().length, 2);
		assert.equal(thread1.name, threadName1);
		assert.equal(thread1.stopped, true);
		assert.equal(thread1.getCallStack().length, 0);
		assert.equal(thread1.stoppedDetails!.reason, stoppedReason);
		assert.equal(thread2.name, threadName2);
		assert.equal(thread2.stopped, true);
		assert.equal(thread2.getCallStack().length, 0);
		assert.equal(thread2.stoppedDetails!.reason, undefined);

		// after calling getCallStack, the callstack becomes available
		// and results in a request for the callstack in the debug adapter
		thread1.fetchCallStack().then(() => {
			assert.notEqual(thread1.getCallStack().length, 0);
		});

		thread2.fetchCallStack().then(() => {
			assert.notEqual(thread2.getCallStack().length, 0);
		});

		// calling multiple times getCallStack doesn't result in multiple calls
		// to the debug adapter
		thread1.fetchCallStack().then(() => {
			return thread2.fetchCallStack();
		});

		// clearing the callstack results in the callstack not being available
		thread1.clearCallStack();
		assert.equal(thread1.stopped, true);
		assert.equal(thread1.getCallStack().length, 0);

		thread2.clearCallStack();
		assert.equal(thread2.stopped, true);
		assert.equal(thread2.getCallStack().length, 0);

		model.clearThreads(session.getId(), true);
		assert.equal(session.getThread(threadId1), undefined);
		assert.equal(session.getThread(threadId2), undefined);
		assert.equal(session.getAllThreads().length, 0);
	});

	test('threads mutltiple without allThreadsStopped', () => {
		const sessionStub = sinon.spy(rawSession, 'stackTrace');

		const stoppedThreadId = 1;
		const stoppedThreadName = 'stoppedThread';
		const runningThreadId = 2;
		const runningThreadName = 'runningThread';
		const stoppedReason = 'breakpoint';
		const session = createMockSession(model);
		model.addSession(session);

		session['raw'] = <any>rawSession;

		// Add the threads
		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: stoppedThreadId,
				name: stoppedThreadName
			}]
		});

		// Stopped event with only one thread stopped
		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: 1,
				name: stoppedThreadName
			}, {
				id: runningThreadId,
				name: runningThreadName
			}],
			stoppedDetails: {
				reason: stoppedReason,
				threadId: 1,
				allThreadsStopped: false
			}
		});

		const stoppedThread = session.getThread(stoppedThreadId)!;
		const runningThread = session.getThread(runningThreadId)!;

		// the callstack for the stopped thread is obtainable but not available
		// the callstack for the running thread is not obtainable nor available
		assert.equal(stoppedThread.name, stoppedThreadName);
		assert.equal(stoppedThread.stopped, true);
		assert.equal(session.getAllThreads().length, 2);
		assert.equal(stoppedThread.getCallStack().length, 0);
		assert.equal(stoppedThread.stoppedDetails!.reason, stoppedReason);
		assert.equal(runningThread.name, runningThreadName);
		assert.equal(runningThread.stopped, false);
		assert.equal(runningThread.getCallStack().length, 0);
		assert.equal(runningThread.stoppedDetails, undefined);

		// after calling getCallStack, the callstack becomes available
		// and results in a request for the callstack in the debug adapter
		stoppedThread.fetchCallStack().then(() => {
			assert.notEqual(stoppedThread.getCallStack().length, 0);
			assert.equal(runningThread.getCallStack().length, 0);
			assert.equal(sessionStub.callCount, 1);
		});

		// calling getCallStack on the running thread returns empty array
		// and does not return in a request for the callstack in the debug
		// adapter
		runningThread.fetchCallStack().then(() => {
			assert.equal(runningThread.getCallStack().length, 0);
			assert.equal(sessionStub.callCount, 1);
		});

		// clearing the callstack results in the callstack not being available
		stoppedThread.clearCallStack();
		assert.equal(stoppedThread.stopped, true);
		assert.equal(stoppedThread.getCallStack().length, 0);

		model.clearThreads(session.getId(), true);
		assert.equal(session.getThread(stoppedThreadId), undefined);
		assert.equal(session.getThread(runningThreadId), undefined);
		assert.equal(session.getAllThreads().length, 0);
	});

	test('stack frame get specific source name', () => {
		const session = createMockSession(model);
		model.addSession(session);
		const { firstStackFrame, secondStackFrame } = createTwoStackFrames(session);

		assert.equal(getSpecificSourceName(firstStackFrame), '.../b/c/d/internalModule.js');
		assert.equal(getSpecificSourceName(secondStackFrame), '.../x/c/d/internalModule.js');
	});

	test('stack frame toString()', () => {
		const session = createMockSession(model);
		const thread = new Thread(session, 'mockthread', 1);
		const firstSource = new Source({
			name: 'internalModule.js',
			path: 'a/b/c/d/internalModule.js',
			sourceReference: 10,
		}, 'aDebugSessionId');
		const stackFrame = new StackFrame(thread, 1, firstSource, 'app', 'normal', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, 1);
		assert.equal(stackFrame.toString(), 'app (internalModule.js:1)');

		const secondSource = new Source(undefined, 'aDebugSessionId');
		const stackFrame2 = new StackFrame(thread, 2, secondSource, 'module', 'normal', { startLineNumber: undefined!, startColumn: undefined!, endLineNumber: undefined!, endColumn: undefined! }, 2);
		assert.equal(stackFrame2.toString(), 'module');
	});

	test('debug child sessions are added in correct order', () => {
		const session = createMockSession(model);
		model.addSession(session);
		const secondSession = createMockSession(model, 'mockSession2');
		model.addSession(secondSession);
		const firstChild = createMockSession(model, 'firstChild', { parentSession: session });
		model.addSession(firstChild);
		const secondChild = createMockSession(model, 'secondChild', { parentSession: session });
		model.addSession(secondChild);
		const thirdSession = createMockSession(model, 'mockSession3');
		model.addSession(thirdSession);
		const anotherChild = createMockSession(model, 'secondChild', { parentSession: secondSession });
		model.addSession(anotherChild);

		const sessions = model.getSessions();
		assert.equal(sessions[0].getId(), session.getId());
		assert.equal(sessions[1].getId(), firstChild.getId());
		assert.equal(sessions[2].getId(), secondChild.getId());
		assert.equal(sessions[3].getId(), secondSession.getId());
		assert.equal(sessions[4].getId(), anotherChild.getId());
		assert.equal(sessions[5].getId(), thirdSession.getId());
	});

	test('decorations', () => {
		const session = createMockSession(model);
		model.addSession(session);
		const { firstStackFrame, secondStackFrame } = createTwoStackFrames(session);
		let decorations = createDecorationsForStackFrame(firstStackFrame, firstStackFrame.range);
		assert.equal(decorations.length, 2);
		assert.deepEqual(decorations[0].range, new Range(1, 2, 1, 1));
		assert.equal(decorations[0].options.glyphMarginClassName, 'codicon-debug-stackframe');
		assert.deepEqual(decorations[1].range, new Range(1, Constants.MAX_SAFE_SMALL_INTEGER, 1, 1));
		assert.equal(decorations[1].options.className, 'debug-top-stack-frame-line');
		assert.equal(decorations[1].options.isWholeLine, true);

		decorations = createDecorationsForStackFrame(secondStackFrame, firstStackFrame.range);
		assert.equal(decorations.length, 2);
		assert.deepEqual(decorations[0].range, new Range(1, 2, 1, 1));
		assert.equal(decorations[0].options.glyphMarginClassName, 'codicon-debug-stackframe-focused');
		assert.deepEqual(decorations[1].range, new Range(1, Constants.MAX_SAFE_SMALL_INTEGER, 1, 1));
		assert.equal(decorations[1].options.className, 'debug-focused-stack-frame-line');
		assert.equal(decorations[1].options.isWholeLine, true);

		decorations = createDecorationsForStackFrame(firstStackFrame, new Range(1, 5, 1, 6));
		assert.equal(decorations.length, 3);
		assert.deepEqual(decorations[0].range, new Range(1, 2, 1, 1));
		assert.equal(decorations[0].options.glyphMarginClassName, 'codicon-debug-stackframe');
		assert.deepEqual(decorations[1].range, new Range(1, Constants.MAX_SAFE_SMALL_INTEGER, 1, 1));
		assert.equal(decorations[1].options.className, 'debug-top-stack-frame-line');
		assert.equal(decorations[1].options.isWholeLine, true);
		// Inline decoration gets rendered in this case
		assert.equal(decorations[2].options.beforeContentClassName, 'debug-top-stack-frame-column');
		assert.deepEqual(decorations[2].range, new Range(1, Constants.MAX_SAFE_SMALL_INTEGER, 1, 1));
	});

	test('contexts', () => {
		const session = createMockSession(model);
		model.addSession(session);
		const { firstStackFrame, secondStackFrame } = createTwoStackFrames(session);
		let context = getContext(firstStackFrame);
		assert.equal(context.sessionId, firstStackFrame.thread.session.getId());
		assert.equal(context.threadId, firstStackFrame.thread.getId());
		assert.equal(context.frameId, firstStackFrame.getId());

		context = getContext(secondStackFrame.thread);
		assert.equal(context.sessionId, secondStackFrame.thread.session.getId());
		assert.equal(context.threadId, secondStackFrame.thread.getId());
		assert.equal(context.frameId, undefined);

		context = getContext(session);
		assert.equal(context.sessionId, session.getId());
		assert.equal(context.threadId, undefined);
		assert.equal(context.frameId, undefined);

		let contributedContext = getContextForContributedActions(firstStackFrame);
		assert.equal(contributedContext, firstStackFrame.source.raw.path);
		contributedContext = getContextForContributedActions(firstStackFrame.thread);
		assert.equal(contributedContext, firstStackFrame.thread.threadId);
		contributedContext = getContextForContributedActions(session);
		assert.equal(contributedContext, session.getId());
	});

	test('focusStackFrameThreadAndSesion', () => {
		const threadId1 = 1;
		const threadName1 = 'firstThread';
		const threadId2 = 2;
		const threadName2 = 'secondThread';
		const stoppedReason = 'breakpoint';

		// Add the threads
		const session = new class extends DebugSession {
			get state(): State {
				return State.Stopped;
			}
		}(generateUuid(), { resolved: { name: 'stoppedSession', type: 'node', request: 'launch' }, unresolved: undefined }, undefined!, model, undefined, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, NullOpenerService, undefined!, undefined!);

		const runningSession = createMockSession(model);
		model.addSession(runningSession);
		model.addSession(session);

		session['raw'] = <any>rawSession;

		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: threadId1,
				name: threadName1
			}]
		});

		// Stopped event with all threads stopped
		model.rawUpdate({
			sessionId: session.getId(),
			threads: [{
				id: threadId1,
				name: threadName1
			}, {
				id: threadId2,
				name: threadName2
			}],
			stoppedDetails: {
				reason: stoppedReason,
				threadId: 1,
				allThreadsStopped: true
			},
		});

		const thread = session.getThread(threadId1)!;
		const runningThread = session.getThread(threadId2);

		let toFocus = getStackFrameThreadAndSessionToFocus(model, undefined);
		// Verify stopped session and stopped thread get focused
		assert.deepEqual(toFocus, { stackFrame: undefined, thread: thread, session: session });

		toFocus = getStackFrameThreadAndSessionToFocus(model, undefined, undefined, runningSession);
		assert.deepEqual(toFocus, { stackFrame: undefined, thread: undefined, session: runningSession });

		toFocus = getStackFrameThreadAndSessionToFocus(model, undefined, thread);
		assert.deepEqual(toFocus, { stackFrame: undefined, thread: thread, session: session });

		toFocus = getStackFrameThreadAndSessionToFocus(model, undefined, runningThread);
		assert.deepEqual(toFocus, { stackFrame: undefined, thread: runningThread, session: session });

		const stackFrame = new StackFrame(thread, 5, undefined!, 'stackframename2', undefined, undefined!, 1);
		toFocus = getStackFrameThreadAndSessionToFocus(model, stackFrame);
		assert.deepEqual(toFocus, { stackFrame: stackFrame, thread: thread, session: session });
	});
});
