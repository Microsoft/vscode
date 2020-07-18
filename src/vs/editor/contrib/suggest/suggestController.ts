/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { alert } from 'vs/base/browser/ui/aria/aria';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { onUnexpectedError } from 'vs/base/common/errors';
import { KeyCode, KeyMod, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { dispose, IDisposable, DisposableStore, toDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { StableEditorScrollState } from 'vs/editor/browser/core/editorState';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, EditorCommand, registerEditorAction, registerEditorCommand, registerEditorContribution, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { IEditorContribution, ScrollType } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { CompletionItemProvider, CompletionItemInsertTextRule } from 'vs/editor/common/modes';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { SnippetParser } from 'vs/editor/contrib/snippet/snippetParser';
import { ISuggestMemoryService } from 'vs/editor/contrib/suggest/suggestMemory';
import * as nls from 'vs/nls';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Context as SuggestContext, CompletionItem, suggestWidgetStatusbarMenu } from './suggest';
import { SuggestAlternatives } from './suggestAlternatives';
import { State, SuggestModel } from './suggestModel';
import { ISelectedSuggestion, SuggestWidget } from './suggestWidget';
import { WordContextKey } from 'vs/editor/contrib/suggest/wordContextKey';
import { Event } from 'vs/base/common/event';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IdleValue } from 'vs/base/common/async';
import { isObject, assertType } from 'vs/base/common/types';
import { CommitCharacterController } from './suggestCommitCharacters';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { TrackedRangeStickiness, ITextModel } from 'vs/editor/common/model';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import * as platform from 'vs/base/common/platform';
import { MenuRegistry } from 'vs/platform/actions/common/actions';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { StopWatch } from 'vs/base/common/stopwatch';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

// sticky suggest widget which doesn't disappear on focus out and such
let _sticky = false;
// _sticky = Boolean("true"); // done "weirdly" so that a lint warning prevents you from pushing this

class LineSuffix {

	private readonly _marker: string[] | undefined;

	constructor(private readonly _model: ITextModel, private readonly _position: IPosition) {
		// spy on what's happening right of the cursor. two cases:
		// 1. end of line -> check that it's still end of line
		// 2. mid of line -> add a marker and compute the delta
		const maxColumn = _model.getLineMaxColumn(_position.lineNumber);
		if (maxColumn !== _position.column) {
			const offset = _model.getOffsetAt(_position);
			const end = _model.getPositionAt(offset + 1);
			this._marker = _model.deltaDecorations([], [{
				range: Range.fromPositions(_position, end),
				options: { stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
			}]);
		}
	}

	dispose(): void {
		if (this._marker && !this._model.isDisposed()) {
			this._model.deltaDecorations(this._marker, []);
		}
	}

	delta(position: IPosition): number {
		if (this._model.isDisposed() || this._position.lineNumber !== position.lineNumber) {
			// bail out early if things seems fishy
			return 0;
		}
		// read the marker (in case suggest was triggered at line end) or compare
		// the cursor to the line end.
		if (this._marker) {
			const range = this._model.getDecorationRange(this._marker[0]);
			const end = this._model.getOffsetAt(range!.getStartPosition());
			return end - this._model.getOffsetAt(position);
		} else {
			return this._model.getLineMaxColumn(position.lineNumber) - position.column;
		}
	}
}

const enum InsertFlags {
	NoBeforeUndoStop = 1,
	NoAfterUndoStop = 2,
	KeepAlternativeSuggestions = 4,
	AlternativeOverwriteConfig = 8
}

export class SuggestController implements IEditorContribution {

	public static readonly ID: string = 'editor.contrib.suggestController';

	public static get(editor: ICodeEditor): SuggestController {
		return editor.getContribution<SuggestController>(SuggestController.ID);
	}

	readonly editor: ICodeEditor;
	readonly model: SuggestModel;
	readonly widget: IdleValue<SuggestWidget>;

	private readonly _alternatives: IdleValue<SuggestAlternatives>;
	private readonly _lineSuffix = new MutableDisposable<LineSuffix>();
	private readonly _toDispose = new DisposableStore();

	constructor(
		editor: ICodeEditor,
		@IEditorWorkerService editorWorker: IEditorWorkerService,
		@ISuggestMemoryService private readonly _memoryService: ISuggestMemoryService,
		@ICommandService private readonly _commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IClipboardService clipboardService: IClipboardService,
	) {
		this.editor = editor;
		this.model = new SuggestModel(this.editor, editorWorker, clipboardService);

		this.widget = this._toDispose.add(new IdleValue(() => {

			const widget = this._instantiationService.createInstance(SuggestWidget, this.editor);

			this._toDispose.add(widget);
			this._toDispose.add(widget.onDidSelect(item => this._insertSuggestion(item, 0), this));

			// Wire up logic to accept a suggestion on certain characters
			const commitCharacterController = new CommitCharacterController(this.editor, widget, item => this._insertSuggestion(item, InsertFlags.NoAfterUndoStop));
			this._toDispose.add(commitCharacterController);
			this._toDispose.add(this.model.onDidSuggest(e => {
				if (e.completionModel.items.length === 0) {
					commitCharacterController.reset();
				}
			}));

			// Wire up makes text edit context key
			const ctxMakesTextEdit = SuggestContext.MakesTextEdit.bindTo(this._contextKeyService);
			const ctxHasInsertAndReplace = SuggestContext.HasInsertAndReplaceRange.bindTo(this._contextKeyService);
			const ctxCanResolve = SuggestContext.CanResolve.bindTo(this._contextKeyService);

			this._toDispose.add(toDisposable(() => {
				ctxMakesTextEdit.reset();
				ctxHasInsertAndReplace.reset();
				ctxCanResolve.reset();
			}));

			this._toDispose.add(widget.onDidFocus(({ item }) => {

				// (ctx: makesTextEdit)
				const position = this.editor.getPosition()!;
				const startColumn = item.editStart.column;
				const endColumn = position.column;
				let value = true;
				if (
					this.editor.getOption(EditorOption.acceptSuggestionOnEnter) === 'smart'
					&& this.model.state === State.Auto
					&& !item.completion.command
					&& !item.completion.additionalTextEdits
					&& !(item.completion.insertTextRules! & CompletionItemInsertTextRule.InsertAsSnippet)
					&& endColumn - startColumn === item.completion.insertText.length
				) {
					const oldText = this.editor.getModel()!.getValueInRange({
						startLineNumber: position.lineNumber,
						startColumn,
						endLineNumber: position.lineNumber,
						endColumn
					});
					value = oldText !== item.completion.insertText;
				}
				ctxMakesTextEdit.set(value);

				// (ctx: hasInsertAndReplaceRange)
				ctxHasInsertAndReplace.set(!Position.equals(item.editInsertEnd, item.editReplaceEnd));

				// (ctx: canResolve)
				ctxCanResolve.set(Boolean(item.provider.resolveCompletionItem) || Boolean(item.completion.documentation) || item.completion.detail !== item.completion.label);
			}));

			this._toDispose.add(widget.onDetailsKeyDown(e => {
				// cmd + c on macOS, ctrl + c on Win / Linux
				if (
					e.toKeybinding().equals(new SimpleKeybinding(true, false, false, false, KeyCode.KEY_C)) ||
					(platform.isMacintosh && e.toKeybinding().equals(new SimpleKeybinding(false, false, false, true, KeyCode.KEY_C)))
				) {
					e.stopPropagation();
					return;
				}

				if (!e.toKeybinding().isModifierKey()) {
					this.editor.focus();
				}
			}));

			return widget;
		}));

		this._alternatives = this._toDispose.add(new IdleValue(() => {
			return this._toDispose.add(new SuggestAlternatives(this.editor, this._contextKeyService));
		}));

		this._toDispose.add(_instantiationService.createInstance(WordContextKey, editor));

		this._toDispose.add(this.model.onDidTrigger(e => {
			this.widget.value.showTriggered(e.auto, e.shy ? 250 : 50);
			this._lineSuffix.value = new LineSuffix(this.editor.getModel()!, e.position);
		}));
		this._toDispose.add(this.model.onDidSuggest(e => {
			if (!e.shy) {
				let index = this._memoryService.select(this.editor.getModel()!, this.editor.getPosition()!, e.completionModel.items);
				this.widget.value.showSuggestions(e.completionModel, index, e.isFrozen, e.auto);
			}
		}));
		this._toDispose.add(this.model.onDidCancel(e => {
			if (!e.retrigger) {
				this.widget.value.hideWidget();
			}
		}));
		this._toDispose.add(this.editor.onDidBlurEditorWidget(() => {
			if (!_sticky) {
				this.model.cancel();
				this.model.clear();
			}
		}));

		// Manage the acceptSuggestionsOnEnter context key
		let acceptSuggestionsOnEnter = SuggestContext.AcceptSuggestionsOnEnter.bindTo(_contextKeyService);
		let updateFromConfig = () => {
			const acceptSuggestionOnEnter = this.editor.getOption(EditorOption.acceptSuggestionOnEnter);
			acceptSuggestionsOnEnter.set(acceptSuggestionOnEnter === 'on' || acceptSuggestionOnEnter === 'smart');
		};
		this._toDispose.add(this.editor.onDidChangeConfiguration(() => updateFromConfig()));
		updateFromConfig();
	}

	dispose(): void {
		this._alternatives.dispose();
		this._toDispose.dispose();
		this.widget.dispose();
		this.model.dispose();
		this._lineSuffix.dispose();
	}

	protected _insertSuggestion(
		event: ISelectedSuggestion | undefined,
		flags: InsertFlags
	): void {
		if (!event || !event.item) {
			this._alternatives.value.reset();
			this.model.cancel();
			this.model.clear();
			return;
		}
		if (!this.editor.hasModel()) {
			return;
		}

		const model = this.editor.getModel();
		const modelVersionNow = model.getAlternativeVersionId();
		const { item } = event;

		//
		const tasks: Promise<any>[] = [];
		const cts = new CancellationTokenSource();

		// pushing undo stops *before* additional text edits and
		// *after* the main edit
		if (!(flags & InsertFlags.NoBeforeUndoStop)) {
			this.editor.pushUndoStop();
		}

		// compute overwrite[Before|After] deltas BEFORE applying extra edits
		const info = this.getOverwriteInfo(item, Boolean(flags & InsertFlags.AlternativeOverwriteConfig));

		// keep item in memory
		this._memoryService.memorize(model, this.editor.getPosition(), item);


		if (Array.isArray(item.completion.additionalTextEdits)) {
			// sync additional edits
			const scrollState = StableEditorScrollState.capture(this.editor);
			this.editor.executeEdits(
				'suggestController.additionalTextEdits.sync',
				item.completion.additionalTextEdits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text))
			);
			scrollState.restoreRelativeVerticalPositionOfCursor(this.editor);

		} else if (!item.isResolved) {
			// async additional edits
			const sw = new StopWatch(true);
			let position: IPosition | undefined;

			const docListener = model.onDidChangeContent(e => {
				if (e.isFlush) {
					cts.cancel();
					docListener.dispose();
					return;
				}
				for (let change of e.changes) {
					const thisPosition = Range.getEndPosition(change.range);
					if (!position || Position.isBefore(thisPosition, position)) {
						position = thisPosition;
					}
				}
			});

			let oldFlags = flags;
			flags |= InsertFlags.NoAfterUndoStop;
			let didType = false;
			let typeListener = this.editor.onWillType(() => {
				typeListener.dispose();
				didType = true;
				if (!(oldFlags & InsertFlags.NoAfterUndoStop)) {
					this.editor.pushUndoStop();
				}
			});

			tasks.push(item.resolve(cts.token).then(() => {
				if (!item.completion.additionalTextEdits || cts.token.isCancellationRequested) {
					return false;
				}
				if (position && item.completion.additionalTextEdits.some(edit => Position.isBefore(position!, Range.getStartPosition(edit.range)))) {
					return false;
				}
				if (didType) {
					this.editor.pushUndoStop();
				}
				const scrollState = StableEditorScrollState.capture(this.editor);
				this.editor.executeEdits(
					'suggestController.additionalTextEdits.async',
					item.completion.additionalTextEdits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text))
				);
				scrollState.restoreRelativeVerticalPositionOfCursor(this.editor);
				if (didType || !(oldFlags & InsertFlags.NoAfterUndoStop)) {
					this.editor.pushUndoStop();
				}
				return true;
			}).then(applied => {
				this._logService.trace('[suggest] async resolving of edits DONE (ms, applied?)', sw.elapsed(), applied);
				docListener.dispose();
				typeListener.dispose();
			}));
		}

		let { insertText } = item.completion;
		if (!(item.completion.insertTextRules! & CompletionItemInsertTextRule.InsertAsSnippet)) {
			insertText = SnippetParser.escape(insertText);
		}

		SnippetController2.get(this.editor).insert(insertText, {
			overwriteBefore: info.overwriteBefore,
			overwriteAfter: info.overwriteAfter,
			undoStopBefore: false,
			undoStopAfter: false,
			adjustWhitespace: !(item.completion.insertTextRules! & CompletionItemInsertTextRule.KeepWhitespace),
			clipboardText: event.model.clipboardText
		});

		if (!(flags & InsertFlags.NoAfterUndoStop)) {
			this.editor.pushUndoStop();
		}

		if (!item.completion.command) {
			// done
			this.model.cancel();

		} else if (item.completion.command.id === TriggerSuggestAction.id) {
			// retigger
			this.model.trigger({ auto: true, shy: false }, true);

		} else {
			// exec command, done
			tasks.push(this._commandService.executeCommand(item.completion.command.id, ...(item.completion.command.arguments ? [...item.completion.command.arguments] : [])).catch(onUnexpectedError));
			this.model.cancel();
		}

		if (flags & InsertFlags.KeepAlternativeSuggestions) {
			this._alternatives.value.set(event, next => {

				// cancel resolving of additional edits
				cts.cancel();

				// this is not so pretty. when inserting the 'next'
				// suggestion we undo until we are at the state at
				// which we were before inserting the previous suggestion...
				while (model.canUndo()) {
					if (modelVersionNow !== model.getAlternativeVersionId()) {
						model.undo();
					}
					this._insertSuggestion(
						next,
						InsertFlags.NoBeforeUndoStop | InsertFlags.NoAfterUndoStop | (flags & InsertFlags.AlternativeOverwriteConfig ? InsertFlags.AlternativeOverwriteConfig : 0)
					);
					break;
				}
			});
		}

		this._alertCompletionItem(item);

		// clear only now - after all tasks are done
		Promise.all(tasks).finally(() => {
			this.model.clear();
			cts.dispose();
		});
	}

	getOverwriteInfo(item: CompletionItem, toggleMode: boolean): { overwriteBefore: number, overwriteAfter: number } {
		assertType(this.editor.hasModel());

		let replace = this.editor.getOption(EditorOption.suggest).insertMode === 'replace';
		if (toggleMode) {
			replace = !replace;
		}
		const overwriteBefore = item.position.column - item.editStart.column;
		const overwriteAfter = (replace ? item.editReplaceEnd.column : item.editInsertEnd.column) - item.position.column;
		const columnDelta = this.editor.getPosition().column - item.position.column;
		const suffixDelta = this._lineSuffix.value ? this._lineSuffix.value.delta(this.editor.getPosition()) : 0;

		return {
			overwriteBefore: overwriteBefore + columnDelta,
			overwriteAfter: overwriteAfter + suffixDelta
		};
	}

	private _alertCompletionItem({ completion: suggestion }: CompletionItem): void {
		const textLabel = typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.name;
		if (isNonEmptyArray(suggestion.additionalTextEdits)) {
			let msg = nls.localize('arai.alert.snippet', "Accepting '{0}' made {1} additional edits", textLabel, suggestion.additionalTextEdits.length);
			alert(msg);
		}
	}

	triggerSuggest(onlyFrom?: Set<CompletionItemProvider>): void {
		if (this.editor.hasModel()) {
			this.model.trigger({ auto: false, shy: false }, false, onlyFrom);
			this.editor.revealLine(this.editor.getPosition().lineNumber, ScrollType.Smooth);
			this.editor.focus();
		}
	}

	triggerSuggestAndAcceptBest(arg: { fallback: string }): void {
		if (!this.editor.hasModel()) {
			return;

		}
		const positionNow = this.editor.getPosition();

		const fallback = () => {
			if (positionNow.equals(this.editor.getPosition()!)) {
				this._commandService.executeCommand(arg.fallback);
			}
		};

		const makesTextEdit = (item: CompletionItem): boolean => {
			if (item.completion.insertTextRules! & CompletionItemInsertTextRule.InsertAsSnippet || item.completion.additionalTextEdits) {
				// snippet, other editor -> makes edit
				return true;
			}
			const position = this.editor.getPosition()!;
			const startColumn = item.editStart.column;
			const endColumn = position.column;
			if (endColumn - startColumn !== item.completion.insertText.length) {
				// unequal lengths -> makes edit
				return true;
			}
			const textNow = this.editor.getModel()!.getValueInRange({
				startLineNumber: position.lineNumber,
				startColumn,
				endLineNumber: position.lineNumber,
				endColumn
			});
			// unequal text -> makes edit
			return textNow !== item.completion.insertText;
		};

		Event.once(this.model.onDidTrigger)(_ => {
			// wait for trigger because only then the cancel-event is trustworthy
			let listener: IDisposable[] = [];

			Event.any<any>(this.model.onDidTrigger, this.model.onDidCancel)(() => {
				// retrigger or cancel -> try to type default text
				dispose(listener);
				fallback();
			}, undefined, listener);

			this.model.onDidSuggest(({ completionModel }) => {
				dispose(listener);
				if (completionModel.items.length === 0) {
					fallback();
					return;
				}
				const index = this._memoryService.select(this.editor.getModel()!, this.editor.getPosition()!, completionModel.items);
				const item = completionModel.items[index];
				if (!makesTextEdit(item)) {
					fallback();
					return;
				}
				this.editor.pushUndoStop();
				this._insertSuggestion({ index, item, model: completionModel }, InsertFlags.KeepAlternativeSuggestions | InsertFlags.NoBeforeUndoStop | InsertFlags.NoAfterUndoStop);

			}, undefined, listener);
		});

		this.model.trigger({ auto: false, shy: true });
		this.editor.revealLine(positionNow.lineNumber, ScrollType.Smooth);
		this.editor.focus();
	}

	acceptSelectedSuggestion(keepAlternativeSuggestions: boolean, alternativeOverwriteConfig: boolean): void {
		const item = this.widget.value.getFocusedItem();
		let flags = 0;
		if (keepAlternativeSuggestions) {
			flags |= InsertFlags.KeepAlternativeSuggestions;
		}
		if (alternativeOverwriteConfig) {
			flags |= InsertFlags.AlternativeOverwriteConfig;
		}
		this._insertSuggestion(item, flags);
	}
	acceptNextSuggestion() {
		this._alternatives.value.next();
	}

	acceptPrevSuggestion() {
		this._alternatives.value.prev();
	}

	cancelSuggestWidget(): void {
		this.model.cancel();
		this.model.clear();
		this.widget.value.hideWidget();
	}

	selectNextSuggestion(): void {
		this.widget.value.selectNext();
	}

	selectNextPageSuggestion(): void {
		this.widget.value.selectNextPage();
	}

	selectLastSuggestion(): void {
		this.widget.value.selectLast();
	}

	selectPrevSuggestion(): void {
		this.widget.value.selectPrevious();
	}

	selectPrevPageSuggestion(): void {
		this.widget.value.selectPreviousPage();
	}

	selectFirstSuggestion(): void {
		this.widget.value.selectFirst();
	}

	toggleSuggestionDetails(): void {
		this.widget.value.toggleDetails();
	}

	toggleExplainMode(): void {
		this.widget.value.toggleExplainMode();
	}

	toggleSuggestionFocus(): void {
		this.widget.value.toggleDetailsFocus();
	}
}

export class TriggerSuggestAction extends EditorAction {

	static readonly id = 'editor.action.triggerSuggest';

	constructor() {
		super({
			id: TriggerSuggestAction.id,
			label: nls.localize('suggest.trigger.label', "Trigger Suggest"),
			alias: 'Trigger Suggest',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasCompletionItemProvider),
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyCode.Space,
				mac: { primary: KeyMod.WinCtrl | KeyCode.Space, secondary: [KeyMod.Alt | KeyCode.Escape] },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const controller = SuggestController.get(editor);

		if (!controller) {
			return;
		}

		controller.triggerSuggest();
	}
}

registerEditorContribution(SuggestController.ID, SuggestController);
registerEditorAction(TriggerSuggestAction);

const weight = KeybindingWeight.EditorContrib + 90;

const SuggestCommand = EditorCommand.bindToContribution<SuggestController>(SuggestController.get);


registerEditorCommand(new SuggestCommand({
	id: 'acceptSelectedSuggestion',
	precondition: SuggestContext.Visible,
	handler(x) {
		x.acceptSelectedSuggestion(true, false);
	}
}));

// normal tab
KeybindingsRegistry.registerKeybindingRule({
	id: 'acceptSelectedSuggestion',
	when: ContextKeyExpr.and(SuggestContext.Visible, EditorContextKeys.textInputFocus),
	primary: KeyCode.Tab,
	weight
});

// accept on enter has special rules
KeybindingsRegistry.registerKeybindingRule({
	id: 'acceptSelectedSuggestion',
	when: ContextKeyExpr.and(SuggestContext.Visible, EditorContextKeys.textInputFocus, SuggestContext.AcceptSuggestionsOnEnter, SuggestContext.MakesTextEdit),
	primary: KeyCode.Enter,
	weight,
});

MenuRegistry.appendMenuItem(suggestWidgetStatusbarMenu, {
	command: { id: 'acceptSelectedSuggestion', title: nls.localize({ key: 'accept.accept', comment: ['{0} will be a keybinding, e.g "Enter to insert"'] }, "{0} to insert") },
	group: 'left',
	order: 1,
	when: SuggestContext.HasInsertAndReplaceRange.toNegated()
});
MenuRegistry.appendMenuItem(suggestWidgetStatusbarMenu, {
	command: { id: 'acceptSelectedSuggestion', title: nls.localize({ key: 'accept.insert', comment: ['{0} will be a keybinding, e.g "Enter to insert"'] }, "{0} to insert") },
	group: 'left',
	order: 1,
	when: ContextKeyExpr.and(SuggestContext.HasInsertAndReplaceRange, ContextKeyExpr.equals('config.editor.suggest.insertMode', 'insert'))
});
MenuRegistry.appendMenuItem(suggestWidgetStatusbarMenu, {
	command: { id: 'acceptSelectedSuggestion', title: nls.localize({ key: 'accept.replace', comment: ['{0} will be a keybinding, e.g "Enter to replace"'] }, "{0} to replace") },
	group: 'left',
	order: 1,
	when: ContextKeyExpr.and(SuggestContext.HasInsertAndReplaceRange, ContextKeyExpr.equals('config.editor.suggest.insertMode', 'replace'))
});

registerEditorCommand(new SuggestCommand({
	id: 'acceptAlternativeSelectedSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, EditorContextKeys.textInputFocus),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyMod.Shift | KeyCode.Enter,
		secondary: [KeyMod.Shift | KeyCode.Tab],
	},
	handler(x) {
		x.acceptSelectedSuggestion(false, true);
	},
	menuOpts: [{
		menuId: suggestWidgetStatusbarMenu,
		group: 'left',
		order: 2,
		when: ContextKeyExpr.and(SuggestContext.HasInsertAndReplaceRange, ContextKeyExpr.equals('config.editor.suggest.insertMode', 'insert')),
		title: nls.localize({ key: 'accept.replace', comment: ['{0} will be a keybinding, e.g "Enter to replace"'] }, "{0} to replace")
	}, {
		menuId: suggestWidgetStatusbarMenu,
		group: 'left',
		order: 2,
		when: ContextKeyExpr.and(SuggestContext.HasInsertAndReplaceRange, ContextKeyExpr.equals('config.editor.suggest.insertMode', 'replace')),
		title: nls.localize({ key: 'accept.insert', comment: ['{0} will be a keybinding, e.g "Enter to insert"'] }, "{0} to insert")
	}]
}));


// continue to support the old command
CommandsRegistry.registerCommandAlias('acceptSelectedSuggestionOnEnter', 'acceptSelectedSuggestion');

registerEditorCommand(new SuggestCommand({
	id: 'hideSuggestWidget',
	precondition: SuggestContext.Visible,
	handler: x => x.cancelSuggestWidget(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectNextSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectNextSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.DownArrow,
		secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow],
		mac: { primary: KeyCode.DownArrow, secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow, KeyMod.WinCtrl | KeyCode.KEY_N] }
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectNextPageSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectNextPageSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.PageDown,
		secondary: [KeyMod.CtrlCmd | KeyCode.PageDown]
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectLastSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectLastSuggestion()
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectPrevSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectPrevSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.UpArrow,
		secondary: [KeyMod.CtrlCmd | KeyCode.UpArrow],
		mac: { primary: KeyCode.UpArrow, secondary: [KeyMod.CtrlCmd | KeyCode.UpArrow, KeyMod.WinCtrl | KeyCode.KEY_P] }
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectPrevPageSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectPrevPageSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.PageUp,
		secondary: [KeyMod.CtrlCmd | KeyCode.PageUp]
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'selectFirstSuggestion',
	precondition: ContextKeyExpr.and(SuggestContext.Visible, SuggestContext.MultipleSuggestions),
	handler: c => c.selectFirstSuggestion()
}));

registerEditorCommand(new SuggestCommand({
	id: 'toggleSuggestionDetails',
	precondition: SuggestContext.Visible,
	handler: x => x.toggleSuggestionDetails(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyMod.CtrlCmd | KeyCode.Space,
		mac: { primary: KeyMod.WinCtrl | KeyCode.Space }
	},
	menuOpts: [{
		menuId: suggestWidgetStatusbarMenu,
		group: 'right',
		order: 1,
		when: ContextKeyExpr.and(SuggestContext.DetailsVisible, SuggestContext.CanResolve),
		title: nls.localize('detail.more', "show less")
	}, {
		menuId: suggestWidgetStatusbarMenu,
		group: 'right',
		order: 1,
		when: ContextKeyExpr.and(SuggestContext.DetailsVisible.toNegated(), SuggestContext.CanResolve),
		title: nls.localize('detail.less', "show more")
	}]
}));

registerEditorCommand(new SuggestCommand({
	id: 'toggleExplainMode',
	precondition: SuggestContext.Visible,
	handler: x => x.toggleExplainMode(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib,
		primary: KeyMod.CtrlCmd | KeyCode.US_SLASH,
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'toggleSuggestionFocus',
	precondition: SuggestContext.Visible,
	handler: x => x.toggleSuggestionFocus(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Space,
		mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Space }
	}
}));

//#region tab completions

registerEditorCommand(new SuggestCommand({
	id: 'insertBestCompletion',
	precondition: ContextKeyExpr.and(
		EditorContextKeys.textInputFocus,
		ContextKeyExpr.equals('config.editor.tabCompletion', 'on'),
		WordContextKey.AtEnd,
		SuggestContext.Visible.toNegated(),
		SuggestAlternatives.OtherSuggestions.toNegated(),
		SnippetController2.InSnippetMode.toNegated()
	),
	handler: (x, arg) => {

		x.triggerSuggestAndAcceptBest(isObject(arg) ? { fallback: 'tab', ...arg } : { fallback: 'tab' });
	},
	kbOpts: {
		weight,
		primary: KeyCode.Tab
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'insertNextSuggestion',
	precondition: ContextKeyExpr.and(
		EditorContextKeys.textInputFocus,
		ContextKeyExpr.equals('config.editor.tabCompletion', 'on'),
		SuggestAlternatives.OtherSuggestions,
		SuggestContext.Visible.toNegated(),
		SnippetController2.InSnippetMode.toNegated()
	),
	handler: x => x.acceptNextSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyCode.Tab
	}
}));

registerEditorCommand(new SuggestCommand({
	id: 'insertPrevSuggestion',
	precondition: ContextKeyExpr.and(
		EditorContextKeys.textInputFocus,
		ContextKeyExpr.equals('config.editor.tabCompletion', 'on'),
		SuggestAlternatives.OtherSuggestions,
		SuggestContext.Visible.toNegated(),
		SnippetController2.InSnippetMode.toNegated()
	),
	handler: x => x.acceptPrevSuggestion(),
	kbOpts: {
		weight: weight,
		kbExpr: EditorContextKeys.textInputFocus,
		primary: KeyMod.Shift | KeyCode.Tab
	}
}));
