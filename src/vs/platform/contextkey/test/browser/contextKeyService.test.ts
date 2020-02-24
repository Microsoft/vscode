/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Context } from 'vs/platform/contextkey/browser/contextKeyService';

suite('ContextKeyService', () => {
	test('Context.getValue', () => {
		const ctx = new Context(1, null);

		ctx.setValue('object', {
			trueProp: true,
			falseProp: false,
			stringProp: 'stringValue',
			objectProp: {
				nestedString: 'nestedStringValue',
				numberProp: 12
			}
		});

		assert(ctx.getValue('object.trueProp') === true, 'Expected true value');
		assert(ctx.getValue('object.falseProp') === false, 'Expected false value');
		assert(ctx.getValue('object.stringProp') === 'stringValue', 'Expected string value');
		assert(ctx.getValue('object.objectProp.nestedString') === 'nestedStringValue', 'Expected string value');
		assert(ctx.getValue('object.objectProp.numberProp') === 12, 'Expected number value');
		assert(ctx.getValue('object.missingProp') === undefined, 'Expected undefined value');
		assert(ctx.getValue('object.objectProp.missingNestedProp') === undefined, 'Expected undefined value');
	});
});
