/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { CharacterPair, IndentAction } from 'vs/editor/common/modes/languageConfiguration';
import { OnEnterSupport } from 'vs/editor/common/modes/supports/onEnter';
import { javascriptOnEnterRules } from 'vs/editor/test/common/modes/supports/javascriptOnEnterRules';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

suite('OnEnter', () => {

	test('uses brackets', () => {
		let brackets: CharacterPair[] = [
			['(', ')'],
			['begin', 'end']
		];
		let support = new OnEnterSupport({
			brackets: brackets
		});
		let testIndentAction = (beforeText: string, afterText: string, expected: IndentAction) => {
			let actual = support.onEnter(EditorAutoIndentStrategy.Advanced, '', beforeText, afterText);
			if (expected === IndentAction.None) {
				assert.equal(actual, null);
			} else {
				assert.equal(actual!.indentAction, expected);
			}
		};

		testIndentAction('a', '', IndentAction.None);
		testIndentAction('', 'b', IndentAction.None);
		testIndentAction('(', 'b', IndentAction.Indent);
		testIndentAction('a', ')', IndentAction.None);
		testIndentAction('begin', 'ending', IndentAction.Indent);
		testIndentAction('abegin', 'end', IndentAction.None);
		testIndentAction('begin', ')', IndentAction.Indent);
		testIndentAction('begin', 'end', IndentAction.IndentOutdent);
		testIndentAction('begin ', ' end', IndentAction.IndentOutdent);
		testIndentAction(' begin', 'end//as', IndentAction.IndentOutdent);
		testIndentAction('(', ')', IndentAction.IndentOutdent);
		testIndentAction('( ', ')', IndentAction.IndentOutdent);
		testIndentAction('a(', ')b', IndentAction.IndentOutdent);

		testIndentAction('(', '', IndentAction.Indent);
		testIndentAction('(', 'foo', IndentAction.Indent);
		testIndentAction('begin', 'foo', IndentAction.Indent);
		testIndentAction('begin', '', IndentAction.Indent);
	});

	test('uses regExpRules', () => {
		let support = new OnEnterSupport({
			onEnterRules: javascriptOnEnterRules
		});
		let testIndentAction = (oneLineAboveText: string, beforeText: string, afterText: string, expectedIndentAction: IndentAction | null, expectedAppendText: string | null, removeText: number = 0) => {
			let actual = support.onEnter(EditorAutoIndentStrategy.Advanced, oneLineAboveText, beforeText, afterText);
			if (expectedIndentAction === null) {
				assert.equal(actual, null, 'isNull:' + beforeText);
			} else {
				assert.equal(actual !== null, true, 'isNotNull:' + beforeText);
				assert.equal(actual!.indentAction, expectedIndentAction, 'indentAction:' + beforeText);
				if (expectedAppendText !== null) {
					assert.equal(actual!.appendText, expectedAppendText, 'appendText:' + beforeText);
				}
				if (removeText !== 0) {
					assert.equal(actual!.removeText, removeText, 'removeText:' + beforeText);
				}
			}
		};

		testIndentAction('', '\t/**', ' */', IndentAction.IndentOutdent, ' * ');
		testIndentAction('', '\t/**', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/** * / * / * /', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/** /*', '', IndentAction.None, ' * ');
		testIndentAction('', '/**', '', IndentAction.None, ' * ');
		testIndentAction('', '\t/**/', '', null, null);
		testIndentAction('', '\t/***/', '', null, null);
		testIndentAction('', '\t/*******/', '', null, null);
		testIndentAction('', '\t/** * * * * */', '', null, null);
		testIndentAction('', '\t/** */', '', null, null);
		testIndentAction('', '\t/** asdfg */', '', null, null);
		testIndentAction('', '\t/* asdfg */', '', null, null);
		testIndentAction('', '\t/* asdfg */', '', null, null);
		testIndentAction('', '\t/** asdfg */', '', null, null);
		testIndentAction('', '*/', '', null, null);
		testIndentAction('', '\t/*', '', null, null);
		testIndentAction('', '\t*', '', null, null);

		testIndentAction('\t/**', '\t *', '', IndentAction.None, '* ');
		testIndentAction('\t * something', '\t *', '', IndentAction.None, '* ');
		testIndentAction('\t *', '\t *', '', IndentAction.None, '* ');

		testIndentAction('', '\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t * */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t * * / * / * / */', '', null, null);

		testIndentAction('\t/**', '\t * ', '', IndentAction.None, '* ');
		testIndentAction('\t * something', '\t * ', '', IndentAction.None, '* ');
		testIndentAction('\t *', '\t * ', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * ', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * ', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * * * ', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * /*', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * /*', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * /*', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * / * / * /', '', IndentAction.None, '* ');

		testIndentAction('/**', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');
		testIndentAction(' * something', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');
		testIndentAction(' *', ' * asdfsfagadfg * / * / * /*', '', IndentAction.None, '* ');

		testIndentAction('', ' */', '', IndentAction.None, null, 1);
		testIndentAction(' */', ' * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t\t */', '', IndentAction.None, null, 1);
		testIndentAction('', '   */', '', IndentAction.None, null, 1);
		testIndentAction('', '     */', '', IndentAction.None, null, 1);
		testIndentAction('', '\t     */', '', IndentAction.None, null, 1);
		testIndentAction('', ' *--------------------------------------------------------------------------------------------*/', '', IndentAction.None, null, 1);

		// issue #43469
		testIndentAction('class A {', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('    ', '    * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('class A {', '  * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('', '  * test() {', '', IndentAction.Indent, null, 0);
		testIndentAction('  ', '  * test() {', '', IndentAction.Indent, null, 0);
	});
});
