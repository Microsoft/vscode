/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EndOfLineSequence } from 'vs/editor/common/model';
import { SingleModelEditStackData } from 'vs/editor/common/model/editStack';
import { Selection } from 'vs/editor/common/core/selection';
import { TextChange } from 'vs/editor/common/model/textChange';

suite('EditStack', () => {

	test('issue #118041: unicode character undo bug', () => {
		const stackData = new SingleModelEditStackData(
			1,
			2,
			EndOfLineSequence.LF,
			EndOfLineSequence.LF,
			[new Selection(10, 2, 10, 2)],
			[new Selection(10, 1, 10, 1)],
			[new TextChange(428, '﻿', 428, '')]
		);

		const buff = stackData.serialize();
		const actual = SingleModelEditStackData.deserialize(buff);

		assert.deepStrictEqual(actual, stackData);
	});

});
