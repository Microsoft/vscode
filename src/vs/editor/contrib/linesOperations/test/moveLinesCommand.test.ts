/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Selection } from 'vs/editor/common/core/selection';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { IndentationRule } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { MoveLinesCommand } from 'vs/editor/contrib/linesOperations/moveLinesCommand';
import { testCommand } from 'vs/editor/test/browser/testCommand';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

function testMoveLinesDownCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, null, selection, (sel) => new MoveLinesCommand(sel, true, EditorAutoIndentStrategy.Advanced), expectedLines, expectedSelection);
}

function testMoveLinesUpCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, null, selection, (sel) => new MoveLinesCommand(sel, false, EditorAutoIndentStrategy.Advanced), expectedLines, expectedSelection);
}

function testMoveLinesDownWithIndentCommand(languageId: LanguageIdentifier, lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, languageId, selection, (sel) => new MoveLinesCommand(sel, true, EditorAutoIndentStrategy.Full), expectedLines, expectedSelection);
}

function testMoveLinesUpWithIndentCommand(languageId: LanguageIdentifier, lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, languageId, selection, (sel) => new MoveLinesCommand(sel, false, EditorAutoIndentStrategy.Full), expectedLines, expectedSelection);
}

suite('Editor Contrib - Move Lines Command', () => {

	test('move first up / last down disabled', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1)
		);

		testMoveLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 1, 5, 1),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 1, 5, 1)
		);
	});

	test('move first line down', function () {
		testMoveLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 1, 1),
			[
				'second line',
				'first',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 2, 1)
		);
	});

	test('move 2nd line up', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 2, 1),
			[
				'second line',
				'first',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	test('issue #1322a: move 2nd line up', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 12, 2, 12),
			[
				'second line',
				'first',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 12, 1, 12)
		);
	});

	test('issue #1322b: move last line up', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 6, 5, 6),
			[
				'first',
				'second line',
				'third line',
				'fifth',
				'fourth line'
			],
			new Selection(4, 6, 4, 6)
		);
	});

	test('issue #1322c: move last line selected up', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 6, 5, 1),
			[
				'first',
				'second line',
				'third line',
				'fifth',
				'fourth line'
			],
			new Selection(4, 6, 4, 1)
		);
	});

	test('move last line up', function () {
		testMoveLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 1, 5, 1),
			[
				'first',
				'second line',
				'third line',
				'fifth',
				'fourth line'
			],
			new Selection(4, 1, 4, 1)
		);
	});

	test('move 4th line down', function () {
		testMoveLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 1, 4, 1),
			[
				'first',
				'second line',
				'third line',
				'fifth',
				'fourth line'
			],
			new Selection(5, 1, 5, 1)
		);
	});

	test('move multiple lines down', function () {
		testMoveLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 4, 2, 2),
			[
				'first',
				'fifth',
				'second line',
				'third line',
				'fourth line'
			],
			new Selection(5, 4, 3, 2)
		);
	});

	test('invisible selection is ignored', function () {
		testMoveLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 1),
			[
				'second line',
				'first',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 1, 2, 1)
		);
	});
});

class IndentRulesMode extends MockMode {
	private static readonly _id = new LanguageIdentifier('moveLinesIndentMode', 7);
	constructor(indentationRules: IndentationRule) {
		super(IndentRulesMode._id);
		this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
			indentationRules: indentationRules
		}));
	}
}

suite('Editor contrib - Move Lines Command honors Indentation Rules', () => {
	let indentRules = {
		decreaseIndentPattern: /^\s*((?!\S.*\/[*]).*[*]\/\s*)?[})\]]|^\s*(case\b.*|default):\s*(\/\/.*|\/[*].*[*]\/\s*)?$/,
		increaseIndentPattern: /(\{[^}"'`]*|\([^)"']*|\[[^\]"']*|^\s*(\{\}|\(\)|\[\]|(case\b.*|default):))\s*(\/\/.*|\/[*].*[*]\/\s*)?$/,
		indentNextLinePattern: /^\s*(for|while|if|else)\b(?!.*[;{}]\s*(\/\/.*|\/[*].*[*]\/\s*)?$)/,
		unIndentedLinePattern: /^(?!.*([;{}]|\S:)\s*(\/\/.*|\/[*].*[*]\/\s*)?$)(?!.*(\{[^}"']*|\([^)"']*|\[[^\]"']*|^\s*(\{\}|\(\)|\[\]|(case\b.*|default):))\s*(\/\/.*|\/[*].*[*]\/\s*)?$)(?!^\s*((?!\S.*\/[*]).*[*]\/\s*)?[})\]]|^\s*(case\b.*|default):\s*(\/\/.*|\/[*].*[*]\/\s*)?$)(?!^\s*(for|while|if|else)\b(?!.*[;{}]\s*(\/\/.*|\/[*].*[*]\/\s*)?$))/
	};

	// https://github.com/Microsoft/vscode/issues/28552#issuecomment-307862797
	test('first line indentation adjust to 0', () => {
		let mode = new IndentRulesMode(indentRules);

		testMoveLinesUpWithIndentCommand(
			mode.getLanguageIdentifier(),
			[
				'class X {',
				'\tz = 2',
				'}'
			],
			new Selection(2, 1, 2, 1),
			[
				'z = 2',
				'class X {',
				'}'
			],
			new Selection(1, 1, 1, 1)
		);

		mode.dispose();
	});

	// https://github.com/Microsoft/vscode/issues/28552#issuecomment-307867717
	test('move lines across block', () => {
		let mode = new IndentRulesMode(indentRules);

		testMoveLinesDownWithIndentCommand(
			mode.getLanguageIdentifier(),
			[
				'const value = 2;',
				'const standardLanguageDescriptions = [',
				'    {',
				'        diagnosticSource: \'js\',',
				'    }',
				'];'
			],
			new Selection(1, 1, 1, 1),
			[
				'const standardLanguageDescriptions = [',
				'    const value = 2;',
				'    {',
				'        diagnosticSource: \'js\',',
				'    }',
				'];'
			],
			new Selection(2, 5, 2, 5)
		);

		mode.dispose();
	});

	test('move line should still work as before if there is no indentation rules', () => {
		testMoveLinesUpWithIndentCommand(
			null!,
			[
				'if (true) {',
				'    var task = new Task(() => {',
				'        var work = 1234;',
				'    });',
				'}'
			],
			new Selection(3, 1, 3, 1),
			[
				'if (true) {',
				'        var work = 1234;',
				'    var task = new Task(() => {',
				'    });',
				'}'
			],
			new Selection(2, 1, 2, 1)
		);
	});
});
