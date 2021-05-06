/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { SyntaxRangeProvider } from 'vs/editor/contrib/folding/syntaxRangeProvider';
import { FoldingRangeProvider, FoldingRange, FoldingContext, ProviderResult } from 'vs/editor/common/modes';
import { ITextModel } from 'vs/editor/common/model';
import { CancellationToken } from 'vs/base/common/cancellation';

interface IndentRange {
	start: number;
	end: number;
}

class TestFoldingRangeProvider implements FoldingRangeProvider {
	constructor(private model: ITextModel, private ranges: IndentRange[]) {
	}

	provideFoldingRanges(model: ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]> {
		if (model === this.model) {
			return this.ranges;
		}
		return null;
	}
}

suite('Syntax folding', () => {
	function r(start: number, end: number): IndentRange {
		return { start, end };
	}

	test('Limit by nesting level', async () => {
		let lines = [
			/* 1*/	'{',
			/* 2*/	'  A',
			/* 3*/	'  {',
			/* 4*/	'    {',
			/* 5*/	'      B',
			/* 6*/	'    }',
			/* 7*/	'    {',
			/* 8*/	'      A',
			/* 9*/	'      {',
			/* 10*/	'         A',
			/* 11*/	'      }',
			/* 12*/	'      {',
			/* 13*/	'        {',
			/* 14*/	'          {',
			/* 15*/	'             A',
			/* 16*/	'          }',
			/* 17*/	'        }',
			/* 18*/	'      }',
			/* 19*/	'    }',
			/* 20*/	'  }',
			/* 21*/	'}',
			/* 22*/	'{',
			/* 23*/	'  A',
			/* 24*/	'}',
		];

		let r1 = r(1, 20);  //0
		let r2 = r(3, 19);  //1
		let r3 = r(4, 5);   //2
		let r4 = r(7, 18);  //2
		let r5 = r(9, 10);  //3
		let r6 = r(12, 17); //4
		let r7 = r(13, 16); //5
		let r8 = r(14, 15); //6
		let r9 = r(22, 23); //0

		let model = createTextModel(lines.join('\n'));
		let ranges = [r1, r2, r3, r4, r5, r6, r7, r8, r9];
		let providers = [new TestFoldingRangeProvider(model, ranges)];

		async function assertLimit(maxEntries: number, expectedRanges: IndentRange[], message: string) {
			let indentRanges = await new SyntaxRangeProvider(model, providers, () => { }, maxEntries).compute(CancellationToken.None);
			let actual: IndentRange[] = [];
			if (indentRanges) {
				for (let i = 0; i < indentRanges.length; i++) {
					actual.push({ start: indentRanges.getStartLineNumber(i), end: indentRanges.getEndLineNumber(i) });
				}
			}
			assert.deepStrictEqual(actual, expectedRanges, message);
		}

		await assertLimit(1000, [r1, r2, r3, r4, r5, r6, r7, r8, r9], '1000');
		await assertLimit(9, [r1, r2, r3, r4, r5, r6, r7, r8, r9], '9');
		await assertLimit(8, [r1, r2, r3, r4, r5, r6, r7, r9], '8');
		await assertLimit(7, [r1, r2, r3, r4, r5, r6, r9], '7');
		await assertLimit(6, [r1, r2, r3, r4, r5, r9], '6');
		await assertLimit(5, [r1, r2, r3, r4, r9], '5');
		await assertLimit(4, [r1, r2, r3, r9], '4');
		await assertLimit(3, [r1, r2, r9], '3');
		await assertLimit(2, [r1, r9], '2');
		await assertLimit(1, [r1], '1');
		await assertLimit(0, [], '0');
	});

});
