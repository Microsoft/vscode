/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { IPosition } from 'vs/editor/common/core/position';
import * as modes from 'vs/editor/common/modes';
import { CompletionModel } from 'vs/editor/contrib/suggest/completionModel';
import { CompletionItem, getSuggestionComparator, SnippetSortOrder } from 'vs/editor/contrib/suggest/suggest';
import { WordDistance } from 'vs/editor/contrib/suggest/wordDistance';
import { EditorOptions, InternalSuggestOptions } from 'vs/editor/common/config/editorOptions';

export function createSuggestItem(label: string, overwriteBefore: number, kind = modes.CompletionItemKind.Property, incomplete: boolean = false, position: IPosition = { lineNumber: 1, column: 1 }, sortText?: string, filterText?: string): CompletionItem {
	const suggestion: modes.CompletionItem = {
		label,
		sortText,
		filterText,
		range: { startLineNumber: position.lineNumber, startColumn: position.column - overwriteBefore, endLineNumber: position.lineNumber, endColumn: position.column },
		insertText: label,
		kind
	};
	const container: modes.CompletionList = {
		incomplete,
		suggestions: [suggestion]
	};
	const provider: modes.CompletionItemProvider = {
		provideCompletionItems(): any {
			return;
		}
	};

	return new CompletionItem(position, suggestion, container, provider);
}
suite('CompletionModel', function () {

	let defaultOptions = <InternalSuggestOptions>{
		insertMode: 'insert',
		snippetsPreventQuickSuggestions: true,
		filterGraceful: true,
		localityBonus: false,
		shareSuggestSelections: false,
		showIcons: true,
		showMethods: true,
		showFunctions: true,
		showConstructors: true,
		showFields: true,
		showVariables: true,
		showClasses: true,
		showStructs: true,
		showInterfaces: true,
		showModules: true,
		showProperties: true,
		showEvents: true,
		showOperators: true,
		showUnits: true,
		showValues: true,
		showConstants: true,
		showEnums: true,
		showEnumMembers: true,
		showKeywords: true,
		showWords: true,
		showColors: true,
		showFiles: true,
		showReferences: true,
		showFolders: true,
		showTypeParameters: true,
		showSnippets: true,
	};

	let model: CompletionModel;

	setup(function () {

		model = new CompletionModel([
			createSuggestItem('foo', 3),
			createSuggestItem('Foo', 3),
			createSuggestItem('foo', 2),
		], 1, {
			leadingLineContent: 'foo',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);
	});

	test('filtering - cached', function () {

		const itemsNow = model.items;
		let itemsThen = model.items;
		assert.ok(itemsNow === itemsThen);

		// still the same context
		model.lineContext = { leadingLineContent: 'foo', characterCountDelta: 0 };
		itemsThen = model.items;
		assert.ok(itemsNow === itemsThen);

		// different context, refilter
		model.lineContext = { leadingLineContent: 'foo1', characterCountDelta: 1 };
		itemsThen = model.items;
		assert.ok(itemsNow !== itemsThen);
	});


	test('complete/incomplete', () => {

		assert.strictEqual(model.incomplete.size, 0);

		let incompleteModel = new CompletionModel([
			createSuggestItem('foo', 3, undefined, true),
			createSuggestItem('foo', 2),
		], 1, {
			leadingLineContent: 'foo',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);
		assert.strictEqual(incompleteModel.incomplete.size, 1);
	});

	test('replaceIncomplete', () => {

		const completeItem = createSuggestItem('foobar', 1, undefined, false, { lineNumber: 1, column: 2 });
		const incompleteItem = createSuggestItem('foofoo', 1, undefined, true, { lineNumber: 1, column: 2 });

		const model = new CompletionModel([completeItem, incompleteItem], 2, { leadingLineContent: 'f', characterCountDelta: 0 }, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);
		assert.strictEqual(model.incomplete.size, 1);
		assert.strictEqual(model.items.length, 2);

		const { incomplete } = model;
		const complete = model.adopt(incomplete);

		assert.strictEqual(incomplete.size, 1);
		assert.ok(incomplete.has(incompleteItem.provider));
		assert.strictEqual(complete.length, 1);
		assert.ok(complete[0] === completeItem);
	});

	test('Fuzzy matching of snippets stopped working with inline snippet suggestions #49895', function () {
		const completeItem1 = createSuggestItem('foobar1', 1, undefined, false, { lineNumber: 1, column: 2 });
		const completeItem2 = createSuggestItem('foobar2', 1, undefined, false, { lineNumber: 1, column: 2 });
		const completeItem3 = createSuggestItem('foobar3', 1, undefined, false, { lineNumber: 1, column: 2 });
		const completeItem4 = createSuggestItem('foobar4', 1, undefined, false, { lineNumber: 1, column: 2 });
		const completeItem5 = createSuggestItem('foobar5', 1, undefined, false, { lineNumber: 1, column: 2 });
		const incompleteItem1 = createSuggestItem('foofoo1', 1, undefined, true, { lineNumber: 1, column: 2 });

		const model = new CompletionModel(
			[
				completeItem1,
				completeItem2,
				completeItem3,
				completeItem4,
				completeItem5,
				incompleteItem1,
			], 2, { leadingLineContent: 'f', characterCountDelta: 0 }, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined
		);
		assert.strictEqual(model.incomplete.size, 1);
		assert.strictEqual(model.items.length, 6);

		const { incomplete } = model;
		const complete = model.adopt(incomplete);

		assert.strictEqual(incomplete.size, 1);
		assert.ok(incomplete.has(incompleteItem1.provider));
		assert.strictEqual(complete.length, 5);
	});

	test('proper current word when length=0, #16380', function () {

		model = new CompletionModel([
			createSuggestItem('    </div', 4),
			createSuggestItem('a', 0),
			createSuggestItem('p', 0),
			createSuggestItem('    </tag', 4),
			createSuggestItem('    XYZ', 4),
		], 1, {
			leadingLineContent: '   <',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		assert.strictEqual(model.items.length, 4);

		const [a, b, c, d] = model.items;
		assert.strictEqual(a.completion.label, '    </div');
		assert.strictEqual(b.completion.label, '    </tag');
		assert.strictEqual(c.completion.label, 'a');
		assert.strictEqual(d.completion.label, 'p');
	});

	test('keep snippet sorting with prefix: top, #25495', function () {

		model = new CompletionModel([
			createSuggestItem('Snippet1', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('tnippet2', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('semver', 1, modes.CompletionItemKind.Property),
		], 1, {
			leadingLineContent: 's',
			characterCountDelta: 0
		}, WordDistance.None, defaultOptions, 'top', undefined);

		assert.strictEqual(model.items.length, 2);
		const [a, b] = model.items;
		assert.strictEqual(a.completion.label, 'Snippet1');
		assert.strictEqual(b.completion.label, 'semver');
		assert.ok(a.score < b.score); // snippet really promoted

	});

	test('keep snippet sorting with prefix: bottom, #25495', function () {

		model = new CompletionModel([
			createSuggestItem('snippet1', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('tnippet2', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('Semver', 1, modes.CompletionItemKind.Property),
		], 1, {
			leadingLineContent: 's',
			characterCountDelta: 0
		}, WordDistance.None, defaultOptions, 'bottom', undefined);

		assert.strictEqual(model.items.length, 2);
		const [a, b] = model.items;
		assert.strictEqual(a.completion.label, 'Semver');
		assert.strictEqual(b.completion.label, 'snippet1');
		assert.ok(a.score < b.score); // snippet really demoted
	});

	test('keep snippet sorting with prefix: inline, #25495', function () {

		model = new CompletionModel([
			createSuggestItem('snippet1', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('tnippet2', 1, modes.CompletionItemKind.Snippet),
			createSuggestItem('Semver', 1),
		], 1, {
			leadingLineContent: 's',
			characterCountDelta: 0
		}, WordDistance.None, defaultOptions, 'inline', undefined);

		assert.strictEqual(model.items.length, 2);
		const [a, b] = model.items;
		assert.strictEqual(a.completion.label, 'snippet1');
		assert.strictEqual(b.completion.label, 'Semver');
		assert.ok(a.score > b.score); // snippet really demoted
	});

	test('filterText seems ignored in autocompletion, #26874', function () {

		const item1 = createSuggestItem('Map - java.util', 1, undefined, undefined, undefined, undefined, 'Map');
		const item2 = createSuggestItem('Map - java.util', 1);

		model = new CompletionModel([item1, item2], 1, {
			leadingLineContent: 'M',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		assert.strictEqual(model.items.length, 2);

		model.lineContext = {
			leadingLineContent: 'Map ',
			characterCountDelta: 3
		};
		assert.strictEqual(model.items.length, 1);
	});

	test('Vscode 1.12 no longer obeys \'sortText\' in completion items (from language server), #26096', function () {

		const item1 = createSuggestItem('<- groups', 2, modes.CompletionItemKind.Property, false, { lineNumber: 1, column: 3 }, '00002', '  groups');
		const item2 = createSuggestItem('source', 0, modes.CompletionItemKind.Property, false, { lineNumber: 1, column: 3 }, '00001', 'source');
		const items = [item1, item2].sort(getSuggestionComparator(SnippetSortOrder.Inline));

		model = new CompletionModel(items, 3, {
			leadingLineContent: '  ',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		assert.strictEqual(model.items.length, 2);

		const [first, second] = model.items;
		assert.strictEqual(first.completion.label, 'source');
		assert.strictEqual(second.completion.label, '<- groups');
	});

	test('Score only filtered items when typing more, score all when typing less', function () {
		model = new CompletionModel([
			createSuggestItem('console', 0),
			createSuggestItem('co_new', 0),
			createSuggestItem('bar', 0),
			createSuggestItem('car', 0),
			createSuggestItem('foo', 0),
		], 1, {
			leadingLineContent: '',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		assert.strictEqual(model.items.length, 5);

		// narrow down once
		model.lineContext = { leadingLineContent: 'c', characterCountDelta: 1 };
		assert.strictEqual(model.items.length, 3);

		// query gets longer, narrow down the narrow-down'ed-set from before
		model.lineContext = { leadingLineContent: 'cn', characterCountDelta: 2 };
		assert.strictEqual(model.items.length, 2);

		// query gets shorter, refilter everything
		model.lineContext = { leadingLineContent: '', characterCountDelta: 0 };
		assert.strictEqual(model.items.length, 5);
	});

	test('Have more relaxed suggest matching algorithm #15419', function () {
		model = new CompletionModel([
			createSuggestItem('result', 0),
			createSuggestItem('replyToUser', 0),
			createSuggestItem('randomLolut', 0),
			createSuggestItem('car', 0),
			createSuggestItem('foo', 0),
		], 1, {
			leadingLineContent: '',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		// query gets longer, narrow down the narrow-down'ed-set from before
		model.lineContext = { leadingLineContent: 'rlut', characterCountDelta: 4 };
		assert.strictEqual(model.items.length, 3);

		const [first, second, third] = model.items;
		assert.strictEqual(first.completion.label, 'result'); // best with `rult`
		assert.strictEqual(second.completion.label, 'replyToUser');  // best with `rltu`
		assert.strictEqual(third.completion.label, 'randomLolut');  // best with `rlut`
	});

	test('Emmet suggestion not appearing at the top of the list in jsx files, #39518', function () {
		model = new CompletionModel([
			createSuggestItem('from', 0),
			createSuggestItem('form', 0),
			createSuggestItem('form:get', 0),
			createSuggestItem('testForeignMeasure', 0),
			createSuggestItem('fooRoom', 0),
		], 1, {
			leadingLineContent: '',
			characterCountDelta: 0
		}, WordDistance.None, EditorOptions.suggest.defaultValue, EditorOptions.snippetSuggestions.defaultValue, undefined);

		model.lineContext = { leadingLineContent: 'form', characterCountDelta: 4 };
		assert.strictEqual(model.items.length, 5);
		const [first, second, third] = model.items;
		assert.strictEqual(first.completion.label, 'form'); // best with `form`
		assert.strictEqual(second.completion.label, 'form:get');  // best with `form`
		assert.strictEqual(third.completion.label, 'from');  // best with `from`
	});
});
