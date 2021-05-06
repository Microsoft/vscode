/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { TokenizationResult2 } from 'vs/editor/common/core/token';
import { Handler } from 'vs/editor/common/editorCommon';
import { TextModel } from 'vs/editor/common/model/textModel';
import { IState, CompletionList, CompletionItemProvider, LanguageIdentifier, MetadataConsts, CompletionProviderRegistry, CompletionTriggerKind, TokenizationRegistry, CompletionItemKind } from 'vs/editor/common/modes';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { NULL_STATE } from 'vs/editor/common/modes/nullMode';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { SuggestController } from 'vs/editor/contrib/suggest/suggestController';
import { LineContext, SuggestModel } from 'vs/editor/contrib/suggest/suggestModel';
import { ISelectedSuggestion } from 'vs/editor/contrib/suggest/suggestWidget';
import { ITestCodeEditor, createTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IStorageService, InMemoryStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { ISuggestMemoryService } from 'vs/editor/contrib/suggest/suggestMemory';
import { ITextModel } from 'vs/editor/common/model';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MockKeybindingService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { mock } from 'vs/base/test/common/mock';
import { NullLogService } from 'vs/platform/log/common/log';


function createMockEditor(model: TextModel): ITestCodeEditor {
	let editor = createTestCodeEditor({
		model: model,
		serviceCollection: new ServiceCollection(
			[ITelemetryService, NullTelemetryService],
			[IStorageService, new InMemoryStorageService()],
			[IKeybindingService, new MockKeybindingService()],
			[ISuggestMemoryService, new class implements ISuggestMemoryService {
				declare readonly _serviceBrand: undefined;
				memorize(): void {
				}
				select(): number {
					return -1;
				}
			}],
		),
	});
	editor.registerAndInstantiateContribution(SnippetController2.ID, SnippetController2);
	return editor;
}

suite('SuggestModel - Context', function () {
	const OUTER_LANGUAGE_ID = new LanguageIdentifier('outerMode', 3);
	const INNER_LANGUAGE_ID = new LanguageIdentifier('innerMode', 4);

	class OuterMode extends MockMode {
		constructor() {
			super(OUTER_LANGUAGE_ID);
			this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {}));

			this._register(TokenizationRegistry.register(this.getLanguageIdentifier().language, {
				getInitialState: (): IState => NULL_STATE,
				tokenize: undefined!,
				tokenize2: (line: string, hasEOL: boolean, state: IState): TokenizationResult2 => {
					const tokensArr: number[] = [];
					let prevLanguageId: LanguageIdentifier | undefined = undefined;
					for (let i = 0; i < line.length; i++) {
						const languageId = (line.charAt(i) === 'x' ? INNER_LANGUAGE_ID : OUTER_LANGUAGE_ID);
						if (prevLanguageId !== languageId) {
							tokensArr.push(i);
							tokensArr.push((languageId.id << MetadataConsts.LANGUAGEID_OFFSET));
						}
						prevLanguageId = languageId;
					}

					const tokens = new Uint32Array(tokensArr.length);
					for (let i = 0; i < tokens.length; i++) {
						tokens[i] = tokensArr[i];
					}
					return new TokenizationResult2(tokens, state);
				}
			}));
		}
	}

	class InnerMode extends MockMode {
		constructor() {
			super(INNER_LANGUAGE_ID);
			this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {}));
		}
	}

	const assertAutoTrigger = (model: TextModel, offset: number, expected: boolean, message?: string): void => {
		const pos = model.getPositionAt(offset);
		const editor = createMockEditor(model);
		editor.setPosition(pos);
		assert.strictEqual(LineContext.shouldAutoTrigger(editor), expected, message);
		editor.dispose();
	};

	let disposables: Disposable[] = [];

	setup(() => {
		disposables = [];
	});

	teardown(function () {
		dispose(disposables);
		disposables = [];
	});

	test('Context - shouldAutoTrigger', function () {
		const model = createTextModel('Das Pferd frisst keinen Gurkensalat - Philipp Reis 1861.\nWer hat\'s erfunden?');
		disposables.push(model);

		assertAutoTrigger(model, 3, true, 'end of word, Das|');
		assertAutoTrigger(model, 4, false, 'no word Das |');
		assertAutoTrigger(model, 1, false, 'middle of word D|as');
		assertAutoTrigger(model, 55, false, 'number, 1861|');
	});

	test('shouldAutoTrigger at embedded language boundaries', () => {
		const outerMode = new OuterMode();
		const innerMode = new InnerMode();
		disposables.push(outerMode, innerMode);

		const model = createTextModel('a<xx>a<x>', undefined, outerMode.getLanguageIdentifier());
		disposables.push(model);

		assertAutoTrigger(model, 1, true, 'a|<x — should trigger at end of word');
		assertAutoTrigger(model, 2, false, 'a<|x — should NOT trigger at start of word');
		assertAutoTrigger(model, 3, false, 'a<x|x —  should NOT trigger in middle of word');
		assertAutoTrigger(model, 4, true, 'a<xx|> — should trigger at boundary between languages');
		assertAutoTrigger(model, 5, false, 'a<xx>|a — should NOT trigger at start of word');
		assertAutoTrigger(model, 6, true, 'a<xx>a|< — should trigger at end of word');
		assertAutoTrigger(model, 8, true, 'a<xx>a<x|> — should trigger at end of word at boundary');
	});
});

suite('SuggestModel - TriggerAndCancelOracle', function () {


	function getDefaultSuggestRange(model: ITextModel, position: Position) {
		const wordUntil = model.getWordUntilPosition(position);
		return new Range(position.lineNumber, wordUntil.startColumn, position.lineNumber, wordUntil.endColumn);
	}

	const alwaysEmptySupport: CompletionItemProvider = {
		provideCompletionItems(doc, pos): CompletionList {
			return {
				incomplete: false,
				suggestions: []
			};
		}
	};

	const alwaysSomethingSupport: CompletionItemProvider = {
		provideCompletionItems(doc, pos): CompletionList {
			return {
				incomplete: false,
				suggestions: [{
					label: doc.getWordUntilPosition(pos).word,
					kind: CompletionItemKind.Property,
					insertText: 'foofoo',
					range: getDefaultSuggestRange(doc, pos)
				}]
			};
		}
	};

	let disposables: IDisposable[] = [];
	let model: TextModel;

	setup(function () {
		disposables = dispose(disposables);
		model = createTextModel('abc def', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(model);
	});

	function withOracle(callback: (model: SuggestModel, editor: ITestCodeEditor) => any): Promise<any> {

		return new Promise((resolve, reject) => {
			const editor = createMockEditor(model);
			const oracle = new SuggestModel(
				editor,
				new class extends mock<IEditorWorkerService>() {
					override computeWordRanges() {
						return Promise.resolve({});
					}
				},
				new class extends mock<IClipboardService>() {
					override readText() {
						return Promise.resolve('CLIPPY');
					}
				},
				NullTelemetryService,
				new NullLogService()
			);
			disposables.push(oracle, editor);

			try {
				resolve(callback(oracle, editor));
			} catch (err) {
				reject(err);
			}
		});
	}

	function assertEvent<E>(event: Event<E>, action: () => any, assert: (e: E) => any) {
		return new Promise((resolve, reject) => {
			const sub = event(e => {
				sub.dispose();
				try {
					resolve(assert(e));
				} catch (err) {
					reject(err);
				}
			});
			try {
				action();
			} catch (err) {
				sub.dispose();
				reject(err);
			}
		});
	}

	test('events - cancel/trigger', function () {
		return withOracle(model => {

			return Promise.all([

				assertEvent(model.onDidTrigger, function () {
					model.trigger({ auto: true, shy: false });
				}, function (event) {
					assert.strictEqual(event.auto, true);

					return assertEvent(model.onDidCancel, function () {
						model.cancel();
					}, function (event) {
						assert.strictEqual(event.retrigger, false);
					});
				}),

				assertEvent(model.onDidTrigger, function () {
					model.trigger({ auto: true, shy: false });
				}, function (event) {
					assert.strictEqual(event.auto, true);
				}),

				assertEvent(model.onDidTrigger, function () {
					model.trigger({ auto: false, shy: false });
				}, function (event) {
					assert.strictEqual(event.auto, false);
				})
			]);
		});
	});


	test('events - suggest/empty', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysEmptySupport));

		return withOracle(model => {
			return Promise.all([
				assertEvent(model.onDidCancel, function () {
					model.trigger({ auto: true, shy: false });
				}, function (event) {
					assert.strictEqual(event.retrigger, false);
				}),
				assertEvent(model.onDidSuggest, function () {
					model.trigger({ auto: false, shy: false });
				}, function (event) {
					assert.strictEqual(event.auto, false);
					assert.strictEqual(event.isFrozen, false);
					assert.strictEqual(event.completionModel.items.length, 0);
				})
			]);
		});
	});

	test('trigger - on type', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysSomethingSupport));

		return withOracle((model, editor) => {
			return assertEvent(model.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 4 });
				editor.trigger('keyboard', Handler.Type, { text: 'd' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;

				assert.strictEqual(first.provider, alwaysSomethingSupport);
			});
		});
	});

	test('#17400: Keep filtering suggestModel.ts after space', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: false,
					suggestions: [{
						label: 'My Table',
						kind: CompletionItemKind.Property,
						insertText: 'My Table',
						range: getDefaultSuggestRange(doc, pos)
					}]
				};
			}
		}));

		model.setValue('');

		return withOracle((model, editor) => {

			return assertEvent(model.onDidSuggest, () => {
				// make sure completionModel starts here!
				model.trigger({ auto: true, shy: false });
			}, event => {

				return assertEvent(model.onDidSuggest, () => {
					editor.setPosition({ lineNumber: 1, column: 1 });
					editor.trigger('keyboard', Handler.Type, { text: 'My' });

				}, event => {
					assert.strictEqual(event.auto, true);
					assert.strictEqual(event.completionModel.items.length, 1);
					const [first] = event.completionModel.items;
					assert.strictEqual(first.completion.label, 'My Table');

					return assertEvent(model.onDidSuggest, () => {
						editor.setPosition({ lineNumber: 1, column: 3 });
						editor.trigger('keyboard', Handler.Type, { text: ' ' });

					}, event => {
						assert.strictEqual(event.auto, true);
						assert.strictEqual(event.completionModel.items.length, 1);
						const [first] = event.completionModel.items;
						assert.strictEqual(first.completion.label, 'My Table');
					});
				});
			});
		});
	});

	test('#21484: Trigger character always force a new completion session', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: false,
					suggestions: [{
						label: 'foo.bar',
						kind: CompletionItemKind.Property,
						insertText: 'foo.bar',
						range: Range.fromPositions(pos.with(undefined, 1), pos)
					}]
				};
			}
		}));

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			triggerCharacters: ['.'],
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: false,
					suggestions: [{
						label: 'boom',
						kind: CompletionItemKind.Property,
						insertText: 'boom',
						range: Range.fromPositions(
							pos.delta(0, doc.getLineContent(pos.lineNumber)[pos.column - 2] === '.' ? 0 : -1),
							pos
						)
					}]
				};
			}
		}));

		model.setValue('');

		return withOracle((model, editor) => {

			return assertEvent(model.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 1 });
				editor.trigger('keyboard', Handler.Type, { text: 'foo' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;
				assert.strictEqual(first.completion.label, 'foo.bar');

				return assertEvent(model.onDidSuggest, () => {
					editor.trigger('keyboard', Handler.Type, { text: '.' });

				}, event => {
					assert.strictEqual(event.auto, true);
					assert.strictEqual(event.completionModel.items.length, 2);
					const [first, second] = event.completionModel.items;
					assert.strictEqual(first.completion.label, 'foo.bar');
					assert.strictEqual(second.completion.label, 'boom');
				});
			});
		});
	});

	test('Intellisense Completion doesn\'t respect space after equal sign (.html file), #29353 [1/2]', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysSomethingSupport));

		return withOracle((model, editor) => {

			editor.getModel()!.setValue('fo');
			editor.setPosition({ lineNumber: 1, column: 3 });

			return assertEvent(model.onDidSuggest, () => {
				model.trigger({ auto: false, shy: false });
			}, event => {
				assert.strictEqual(event.auto, false);
				assert.strictEqual(event.isFrozen, false);
				assert.strictEqual(event.completionModel.items.length, 1);

				return assertEvent(model.onDidCancel, () => {
					editor.trigger('keyboard', Handler.Type, { text: '+' });
				}, event => {
					assert.strictEqual(event.retrigger, false);
				});
			});
		});
	});

	test('Intellisense Completion doesn\'t respect space after equal sign (.html file), #29353 [2/2]', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysSomethingSupport));

		return withOracle((model, editor) => {

			editor.getModel()!.setValue('fo');
			editor.setPosition({ lineNumber: 1, column: 3 });

			return assertEvent(model.onDidSuggest, () => {
				model.trigger({ auto: false, shy: false });
			}, event => {
				assert.strictEqual(event.auto, false);
				assert.strictEqual(event.isFrozen, false);
				assert.strictEqual(event.completionModel.items.length, 1);

				return assertEvent(model.onDidCancel, () => {
					editor.trigger('keyboard', Handler.Type, { text: ' ' });
				}, event => {
					assert.strictEqual(event.retrigger, false);
				});
			});
		});
	});

	test('Incomplete suggestion results cause re-triggering when typing w/o further context, #28400 (1/2)', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: true,
					suggestions: [{
						label: 'foo',
						kind: CompletionItemKind.Property,
						insertText: 'foo',
						range: Range.fromPositions(pos.with(undefined, 1), pos)
					}]
				};
			}
		}));

		return withOracle((model, editor) => {

			editor.getModel()!.setValue('foo');
			editor.setPosition({ lineNumber: 1, column: 4 });

			return assertEvent(model.onDidSuggest, () => {
				model.trigger({ auto: false, shy: false });
			}, event => {
				assert.strictEqual(event.auto, false);
				assert.strictEqual(event.completionModel.incomplete.size, 1);
				assert.strictEqual(event.completionModel.items.length, 1);

				return assertEvent(model.onDidCancel, () => {
					editor.trigger('keyboard', Handler.Type, { text: ';' });
				}, event => {
					assert.strictEqual(event.retrigger, false);
				});
			});
		});
	});

	test('Incomplete suggestion results cause re-triggering when typing w/o further context, #28400 (2/2)', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: true,
					suggestions: [{
						label: 'foo;',
						kind: CompletionItemKind.Property,
						insertText: 'foo',
						range: Range.fromPositions(pos.with(undefined, 1), pos)
					}]
				};
			}
		}));

		return withOracle((model, editor) => {

			editor.getModel()!.setValue('foo');
			editor.setPosition({ lineNumber: 1, column: 4 });

			return assertEvent(model.onDidSuggest, () => {
				model.trigger({ auto: false, shy: false });
			}, event => {
				assert.strictEqual(event.auto, false);
				assert.strictEqual(event.completionModel.incomplete.size, 1);
				assert.strictEqual(event.completionModel.items.length, 1);

				return assertEvent(model.onDidSuggest, () => {
					// while we cancel incrementally enriching the set of
					// completions we still filter against those that we have
					// until now
					editor.trigger('keyboard', Handler.Type, { text: ';' });
				}, event => {
					assert.strictEqual(event.auto, false);
					assert.strictEqual(event.completionModel.incomplete.size, 1);
					assert.strictEqual(event.completionModel.items.length, 1);

				});
			});
		});
	});

	test('Trigger character is provided in suggest context', function () {
		let triggerCharacter = '';
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			triggerCharacters: ['.'],
			provideCompletionItems(doc, pos, context): CompletionList {
				assert.strictEqual(context.triggerKind, CompletionTriggerKind.TriggerCharacter);
				triggerCharacter = context.triggerCharacter!;
				return {
					incomplete: false,
					suggestions: [
						{
							label: 'foo.bar',
							kind: CompletionItemKind.Property,
							insertText: 'foo.bar',
							range: Range.fromPositions(pos.with(undefined, 1), pos)
						}
					]
				};
			}
		}));

		model.setValue('');

		return withOracle((model, editor) => {

			return assertEvent(model.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 1 });
				editor.trigger('keyboard', Handler.Type, { text: 'foo.' });
			}, event => {
				assert.strictEqual(triggerCharacter, '.');
			});
		});
	});

	test('Mac press and hold accent character insertion does not update suggestions, #35269', function () {
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: true,
					suggestions: [{
						label: 'abc',
						kind: CompletionItemKind.Property,
						insertText: 'abc',
						range: Range.fromPositions(pos.with(undefined, 1), pos)
					}, {
						label: 'äbc',
						kind: CompletionItemKind.Property,
						insertText: 'äbc',
						range: Range.fromPositions(pos.with(undefined, 1), pos)
					}]
				};
			}
		}));

		model.setValue('');
		return withOracle((model, editor) => {

			return assertEvent(model.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 1 });
				editor.trigger('keyboard', Handler.Type, { text: 'a' });
			}, event => {
				assert.strictEqual(event.completionModel.items.length, 1);
				assert.strictEqual(event.completionModel.items[0].completion.label, 'abc');

				return assertEvent(model.onDidSuggest, () => {
					editor.executeEdits('test', [EditOperation.replace(new Range(1, 1, 1, 2), 'ä')]);

				}, event => {
					// suggest model changed to äbc
					assert.strictEqual(event.completionModel.items.length, 1);
					assert.strictEqual(event.completionModel.items[0].completion.label, 'äbc');

				});
			});
		});
	});

	test('Backspace should not always cancel code completion, #36491', function () {
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysSomethingSupport));

		return withOracle(async (model, editor) => {
			await assertEvent(model.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 4 });
				editor.trigger('keyboard', Handler.Type, { text: 'd' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;

				assert.strictEqual(first.provider, alwaysSomethingSupport);
			});

			await assertEvent(model.onDidSuggest, () => {
				CoreEditingCommands.DeleteLeft.runEditorCommand(null, editor, null);

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;

				assert.strictEqual(first.provider, alwaysSomethingSupport);
			});
		});
	});

	test('Text changes for completion CodeAction are affected by the completion #39893', function () {
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos): CompletionList {
				return {
					incomplete: true,
					suggestions: [{
						label: 'bar',
						kind: CompletionItemKind.Property,
						insertText: 'bar',
						range: Range.fromPositions(pos.delta(0, -2), pos),
						additionalTextEdits: [{
							text: ', bar',
							range: { startLineNumber: 1, endLineNumber: 1, startColumn: 17, endColumn: 17 }
						}]
					}]
				};
			}
		}));

		model.setValue('ba; import { foo } from "./b"');

		return withOracle(async (sugget, editor) => {
			class TestCtrl extends SuggestController {
				override _insertSuggestion(item: ISelectedSuggestion, flags: number = 0) {
					super._insertSuggestion(item, flags);
				}
			}
			const ctrl = <TestCtrl>editor.registerAndInstantiateContribution(TestCtrl.ID, TestCtrl);
			editor.registerAndInstantiateContribution(SnippetController2.ID, SnippetController2);

			await assertEvent(sugget.onDidSuggest, () => {
				editor.setPosition({ lineNumber: 1, column: 3 });
				sugget.trigger({ auto: false, shy: false });
			}, event => {

				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;
				assert.strictEqual(first.completion.label, 'bar');

				ctrl._insertSuggestion({ item: first, index: 0, model: event.completionModel });
			});

			assert.strictEqual(
				model.getValue(),
				'bar; import { foo, bar } from "./b"'
			);
		});
	});

	test('Completion unexpectedly triggers on second keypress of an edit group in a snippet #43523', function () {

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, alwaysSomethingSupport));

		return withOracle((model, editor) => {
			return assertEvent(model.onDidSuggest, () => {
				editor.setValue('d');
				editor.setSelection(new Selection(1, 1, 1, 2));
				editor.trigger('keyboard', Handler.Type, { text: 'e' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				const [first] = event.completionModel.items;

				assert.strictEqual(first.provider, alwaysSomethingSupport);
			});
		});
	});


	test('Fails to render completion details #47988', function () {

		let disposeA = 0;
		let disposeB = 0;

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos) {
				return {
					incomplete: true,
					suggestions: [{
						kind: CompletionItemKind.Folder,
						label: 'CompleteNot',
						insertText: 'Incomplete',
						sortText: 'a',
						range: getDefaultSuggestRange(doc, pos)
					}],
					dispose() { disposeA += 1; }
				};
			}
		}));
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos) {
				return {
					incomplete: false,
					suggestions: [{
						kind: CompletionItemKind.Folder,
						label: 'Complete',
						insertText: 'Complete',
						sortText: 'z',
						range: getDefaultSuggestRange(doc, pos)
					}],
					dispose() { disposeB += 1; }
				};
			},
			resolveCompletionItem(item) {
				return item;
			},
		}));

		return withOracle(async (model, editor) => {

			await assertEvent(model.onDidSuggest, () => {
				editor.setValue('');
				editor.setSelection(new Selection(1, 1, 1, 1));
				editor.trigger('keyboard', Handler.Type, { text: 'c' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 2);
				assert.strictEqual(disposeA, 0);
				assert.strictEqual(disposeB, 0);
			});

			await assertEvent(model.onDidSuggest, () => {
				editor.trigger('keyboard', Handler.Type, { text: 'o' });
			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 2);

				// clean up
				model.clear();
				assert.strictEqual(disposeA, 2); // provide got called two times!
				assert.strictEqual(disposeB, 1);
			});

		});
	});


	test('Trigger (full) completions when (incomplete) completions are already active #99504', function () {

		let countA = 0;
		let countB = 0;

		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos) {
				countA += 1;
				return {
					incomplete: false, // doesn't matter if incomplete or not
					suggestions: [{
						kind: CompletionItemKind.Class,
						label: 'Z aaa',
						insertText: 'Z aaa',
						range: new Range(1, 1, pos.lineNumber, pos.column)
					}],
				};
			}
		}));
		disposables.push(CompletionProviderRegistry.register({ scheme: 'test' }, {
			provideCompletionItems(doc, pos) {
				countB += 1;
				if (!doc.getWordUntilPosition(pos).word.startsWith('a')) {
					return;
				}
				return {
					incomplete: false,
					suggestions: [{
						kind: CompletionItemKind.Folder,
						label: 'aaa',
						insertText: 'aaa',
						range: getDefaultSuggestRange(doc, pos)
					}],
				};
			},
		}));

		return withOracle(async (model, editor) => {

			await assertEvent(model.onDidSuggest, () => {
				editor.setValue('');
				editor.setSelection(new Selection(1, 1, 1, 1));
				editor.trigger('keyboard', Handler.Type, { text: 'Z' });

			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 1);
				assert.strictEqual(event.completionModel.items[0].textLabel, 'Z aaa');
			});

			await assertEvent(model.onDidSuggest, () => {
				// started another word: Z a|
				// item should be: Z aaa, aaa
				editor.trigger('keyboard', Handler.Type, { text: ' a' });
			}, event => {
				assert.strictEqual(event.auto, true);
				assert.strictEqual(event.completionModel.items.length, 2);
				assert.strictEqual(event.completionModel.items[0].textLabel, 'Z aaa');
				assert.strictEqual(event.completionModel.items[1].textLabel, 'aaa');

				assert.strictEqual(countA, 1); // should we keep the suggestions from the "active" provider?, Yes! See: #106573
				assert.strictEqual(countB, 2);
			});
		});
	});
});
