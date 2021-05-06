/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';
import { CompletionProviderRegistry, CompletionItemKind, CompletionItemProvider } from 'vs/editor/common/modes';
import { provideSuggestionItems, SnippetSortOrder, CompletionOptions } from 'vs/editor/contrib/suggest/suggest';
import { Position } from 'vs/editor/common/core/position';
import { TextModel } from 'vs/editor/common/model/textModel';
import { Range } from 'vs/editor/common/core/range';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';


suite('Suggest', function () {

	let model: TextModel;
	let registration: IDisposable;

	setup(function () {

		model = createTextModel('FOO\nbar\BAR\nfoo', undefined, undefined, URI.parse('foo:bar/path'));
		registration = CompletionProviderRegistry.register({ pattern: 'bar/path', scheme: 'foo' }, {
			provideCompletionItems(_doc, pos) {
				return {
					incomplete: false,
					suggestions: [{
						label: 'aaa',
						kind: CompletionItemKind.Snippet,
						insertText: 'aaa',
						range: Range.fromPositions(pos)
					}, {
						label: 'zzz',
						kind: CompletionItemKind.Snippet,
						insertText: 'zzz',
						range: Range.fromPositions(pos)
					}, {
						label: 'fff',
						kind: CompletionItemKind.Property,
						insertText: 'fff',
						range: Range.fromPositions(pos)
					}]
				};
			}
		});
	});

	teardown(() => {
		registration.dispose();
		model.dispose();
	});

	test('sort - snippet inline', async function () {
		const { items } = await provideSuggestionItems(model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'aaa');
		assert.strictEqual(items[1].completion.label, 'fff');
		assert.strictEqual(items[2].completion.label, 'zzz');
	});

	test('sort - snippet top', async function () {
		const { items } = await provideSuggestionItems(model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Top));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'aaa');
		assert.strictEqual(items[1].completion.label, 'zzz');
		assert.strictEqual(items[2].completion.label, 'fff');
	});

	test('sort - snippet bottom', async function () {
		const { items } = await provideSuggestionItems(model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Bottom));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'fff');
		assert.strictEqual(items[1].completion.label, 'aaa');
		assert.strictEqual(items[2].completion.label, 'zzz');
	});

	test('sort - snippet none', async function () {
		const { items } = await provideSuggestionItems(model, new Position(1, 1), new CompletionOptions(undefined, new Set<CompletionItemKind>().add(CompletionItemKind.Snippet)));
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].completion.label, 'fff');
	});

	test('only from', function () {

		const foo: any = {
			triggerCharacters: [],
			provideCompletionItems() {
				return {
					currentWord: '',
					incomplete: false,
					suggestions: [{
						label: 'jjj',
						type: 'property',
						insertText: 'jjj'
					}]
				};
			}
		};
		const registration = CompletionProviderRegistry.register({ pattern: 'bar/path', scheme: 'foo' }, foo);

		provideSuggestionItems(model, new Position(1, 1), new CompletionOptions(undefined, undefined, new Set<CompletionItemProvider>().add(foo))).then(({ items }) => {
			registration.dispose();

			assert.strictEqual(items.length, 1);
			assert.ok(items[0].provider === foo);
		});
	});

	test('Ctrl+space completions stopped working with the latest Insiders, #97650', async function () {


		const foo = new class implements CompletionItemProvider {

			triggerCharacters = [];

			provideCompletionItems() {
				return {
					suggestions: [{
						label: 'one',
						kind: CompletionItemKind.Class,
						insertText: 'one',
						range: {
							insert: new Range(0, 0, 0, 0),
							replace: new Range(0, 0, 0, 10)
						}
					}, {
						label: 'two',
						kind: CompletionItemKind.Class,
						insertText: 'two',
						range: {
							insert: new Range(0, 0, 0, 0),
							replace: new Range(0, 1, 0, 10)
						}
					}]
				};
			}
		};

		const registration = CompletionProviderRegistry.register({ pattern: 'bar/path', scheme: 'foo' }, foo);
		const { items } = await provideSuggestionItems(model, new Position(0, 0), new CompletionOptions(undefined, undefined, new Set<CompletionItemProvider>().add(foo)));
		registration.dispose();

		assert.strictEqual(items.length, 2);
		const [a, b] = items;

		assert.strictEqual(a.completion.label, 'one');
		assert.strictEqual(a.isInvalid, false);
		assert.strictEqual(b.completion.label, 'two');
		assert.strictEqual(b.isInvalid, true);
	});
});
