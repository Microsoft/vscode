/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Expression, DebugModel } from 'vs/workbench/contrib/debug/common/debugModel';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/common/mockDebug';

// Expressions

function assertWatchExpressions(watchExpressions: Expression[], expectedName: string) {
	assert.equal(watchExpressions.length, 2);
	watchExpressions.forEach(we => {
		assert.equal(we.available, false);
		assert.equal(we.reference, 0);
		assert.equal(we.name, expectedName);
	});
}

suite('Debug - Watch', () => {

	let model: DebugModel;

	setup(() => {
		model = createMockDebugModel();
	});

	test('watch expressions', () => {
		assert.equal(model.getWatchExpressions().length, 0);
		model.addWatchExpression('console');
		model.addWatchExpression('console');
		let watchExpressions = model.getWatchExpressions();
		assertWatchExpressions(watchExpressions, 'console');

		model.renameWatchExpression(watchExpressions[0].getId(), 'new_name');
		model.renameWatchExpression(watchExpressions[1].getId(), 'new_name');
		assertWatchExpressions(model.getWatchExpressions(), 'new_name');

		assertWatchExpressions(model.getWatchExpressions(), 'new_name');

		model.addWatchExpression('mockExpression');
		model.moveWatchExpression(model.getWatchExpressions()[2].getId(), 1);
		watchExpressions = model.getWatchExpressions();
		assert.equal(watchExpressions[0].name, 'new_name');
		assert.equal(watchExpressions[1].name, 'mockExpression');
		assert.equal(watchExpressions[2].name, 'new_name');

		model.removeWatchExpressions();
		assert.equal(model.getWatchExpressions().length, 0);
	});
});
