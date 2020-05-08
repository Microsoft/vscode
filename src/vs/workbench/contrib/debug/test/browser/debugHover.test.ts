/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { findExpressionInStackFrame } from 'vs/workbench/contrib/debug/browser/debugHover';
import { createMockSession } from 'vs/workbench/contrib/debug/test/browser/callStack.test';
import { StackFrame, Thread, Scope, Variable } from 'vs/workbench/contrib/debug/common/debugModel';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import type { IScope, IExpression } from 'vs/workbench/contrib/debug/common/debug';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/common/mockDebug';

suite('Debug - Hover', () => {
	test('find expression in stack frame', async () => {
		const model = createMockDebugModel();
		const session = createMockSession(model);
		let stackFrame: StackFrame;

		const thread = new class extends Thread {
			public getCallStack(): StackFrame[] {
				return [stackFrame];
			}
		}(session, 'mockthread', 1);

		const firstSource = new Source({
			name: 'internalModule.js',
			path: 'a/b/c/d/internalModule.js',
			sourceReference: 10,
		}, 'aDebugSessionId');

		let scope: Scope;
		stackFrame = new class extends StackFrame {
			getScopes(): Promise<IScope[]> {
				return Promise.resolve([scope]);
			}
		}(thread, 1, firstSource, 'app.js', 'normal', { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }, 1);


		let variableA: Variable;
		let variableB: Variable;
		scope = new class extends Scope {
			getChildren(): Promise<IExpression[]> {
				return Promise.resolve([variableA]);
			}
		}(stackFrame, 1, 'local', 1, false, 10, 10);

		variableA = new class extends Variable {
			getChildren(): Promise<IExpression[]> {
				return Promise.resolve([variableB]);
			}
		}(session, 1, scope, 2, 'A', 'A', undefined!, 0, 0, {}, 'string');
		variableB = new Variable(session, 1, scope, 2, 'B', 'A.B', undefined!, 0, 0, {}, 'string');

		assert.equal(await findExpressionInStackFrame(stackFrame, []), undefined);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['A']), variableA);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['doesNotExist', 'no']), undefined);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['a']), undefined);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['B']), undefined);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['A', 'B']), variableB);
		assert.equal(await findExpressionInStackFrame(stackFrame, ['A', 'C']), undefined);

		// We do not search in expensive scopes
		scope.expensive = true;
		assert.equal(await findExpressionInStackFrame(stackFrame, ['A']), undefined);
	});
});
