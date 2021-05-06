/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorCommand, registerEditorCommand, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { CompletionItem, CompletionItemKind } from 'vs/editor/common/modes';
import { Choice } from 'vs/editor/contrib/snippet/snippetParser';
import { showSimpleSuggestions } from 'vs/editor/contrib/suggest/suggest';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ILogService } from 'vs/platform/log/common/log';
import { SnippetSession } from './snippetSession';
import { OvertypingCapturer } from 'vs/editor/contrib/suggest/suggestOvertypingCapturer';
import { localize } from 'vs/nls';

export interface ISnippetInsertOptions {
	overwriteBefore: number;
	overwriteAfter: number;
	adjustWhitespace: boolean;
	undoStopBefore: boolean;
	undoStopAfter: boolean;
	clipboardText: string | undefined;
	overtypingCapturer: OvertypingCapturer | undefined;
}

const _defaultOptions: ISnippetInsertOptions = {
	overwriteBefore: 0,
	overwriteAfter: 0,
	undoStopBefore: true,
	undoStopAfter: true,
	adjustWhitespace: true,
	clipboardText: undefined,
	overtypingCapturer: undefined
};

export class SnippetController2 implements IEditorContribution {

	public static readonly ID = 'snippetController2';

	static get(editor: ICodeEditor): SnippetController2 {
		return editor.getContribution<SnippetController2>(SnippetController2.ID);
	}

	static readonly InSnippetMode = new RawContextKey('inSnippetMode', false, localize('inSnippetMode', "Whether the editor in current in snippet mode"));
	static readonly HasNextTabstop = new RawContextKey('hasNextTabstop', false, localize('hasNextTabstop', "Whether there is a next tab stop when in snippet mode"));
	static readonly HasPrevTabstop = new RawContextKey('hasPrevTabstop', false, localize('hasPrevTabstop', "Whether there is a previous tab stop when in snippet mode"));

	private readonly _inSnippet: IContextKey<boolean>;
	private readonly _hasNextTabstop: IContextKey<boolean>;
	private readonly _hasPrevTabstop: IContextKey<boolean>;

	private _session?: SnippetSession;
	private _snippetListener = new DisposableStore();
	private _modelVersionId: number = -1;
	private _currentChoice?: Choice;

	constructor(
		private readonly _editor: ICodeEditor,
		@ILogService private readonly _logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		this._inSnippet = SnippetController2.InSnippetMode.bindTo(contextKeyService);
		this._hasNextTabstop = SnippetController2.HasNextTabstop.bindTo(contextKeyService);
		this._hasPrevTabstop = SnippetController2.HasPrevTabstop.bindTo(contextKeyService);
	}

	dispose(): void {
		this._inSnippet.reset();
		this._hasPrevTabstop.reset();
		this._hasNextTabstop.reset();
		this._session?.dispose();
		this._snippetListener.dispose();
	}

	insert(
		template: string,
		opts?: Partial<ISnippetInsertOptions>
	): void {
		// this is here to find out more about the yet-not-understood
		// error that sometimes happens when we fail to inserted a nested
		// snippet
		try {
			this._doInsert(template, typeof opts === 'undefined' ? _defaultOptions : { ..._defaultOptions, ...opts });

		} catch (e) {
			this.cancel();
			this._logService.error(e);
			this._logService.error('snippet_error');
			this._logService.error('insert_template=', template);
			this._logService.error('existing_template=', this._session ? this._session._logInfo() : '<no_session>');
		}
	}

	private _doInsert(
		template: string,
		opts: ISnippetInsertOptions
	): void {
		if (!this._editor.hasModel()) {
			return;
		}

		// don't listen while inserting the snippet
		// as that is the inflight state causing cancelation
		this._snippetListener.clear();

		if (opts.undoStopBefore) {
			this._editor.getModel().pushStackElement();
		}

		if (!this._session) {
			this._modelVersionId = this._editor.getModel().getAlternativeVersionId();
			this._session = new SnippetSession(this._editor, template, opts);
			this._session.insert();
		} else {
			this._session.merge(template, opts);
		}

		if (opts.undoStopAfter) {
			this._editor.getModel().pushStackElement();
		}

		this._updateState();

		this._snippetListener.add(this._editor.onDidChangeModelContent(e => e.isFlush && this.cancel()));
		this._snippetListener.add(this._editor.onDidChangeModel(() => this.cancel()));
		this._snippetListener.add(this._editor.onDidChangeCursorSelection(() => this._updateState()));
	}

	private _updateState(): void {
		if (!this._session || !this._editor.hasModel()) {
			// canceled in the meanwhile
			return;
		}

		if (this._modelVersionId === this._editor.getModel().getAlternativeVersionId()) {
			// undo until the 'before' state happened
			// and makes use cancel snippet mode
			return this.cancel();
		}

		if (!this._session.hasPlaceholder) {
			// don't listen for selection changes and don't
			// update context keys when the snippet is plain text
			return this.cancel();
		}

		if (this._session.isAtLastPlaceholder || !this._session.isSelectionWithinPlaceholders()) {
			return this.cancel();
		}

		this._inSnippet.set(true);
		this._hasPrevTabstop.set(!this._session.isAtFirstPlaceholder);
		this._hasNextTabstop.set(!this._session.isAtLastPlaceholder);

		this._handleChoice();
	}

	private _handleChoice(): void {
		if (!this._session || !this._editor.hasModel()) {
			this._currentChoice = undefined;
			return;
		}

		const { choice } = this._session;
		if (!choice) {
			this._currentChoice = undefined;
			return;
		}
		if (this._currentChoice !== choice) {
			this._currentChoice = choice;

			this._editor.setSelections(this._editor.getSelections()
				.map(s => Selection.fromPositions(s.getStartPosition()))
			);

			const [first] = choice.options;

			showSimpleSuggestions(this._editor, choice.options.map((option, i) => {

				// let before = choice.options.slice(0, i);
				// let after = choice.options.slice(i);

				return <CompletionItem>{
					kind: CompletionItemKind.Value,
					label: option.value,
					insertText: option.value,
					// insertText: `\${1|${after.concat(before).join(',')}|}$0`,
					// snippetType: 'textmate',
					sortText: 'a'.repeat(i + 1),
					range: Range.fromPositions(this._editor.getPosition()!, this._editor.getPosition()!.delta(0, first.value.length))
				};
			}));
		}
	}

	finish(): void {
		while (this._inSnippet.get()) {
			this.next();
		}
	}

	cancel(resetSelection: boolean = false): void {
		this._inSnippet.reset();
		this._hasPrevTabstop.reset();
		this._hasNextTabstop.reset();
		this._snippetListener.clear();
		this._session?.dispose();
		this._session = undefined;
		this._modelVersionId = -1;
		if (resetSelection) {
			// reset selection to the primary cursor when being asked
			// for. this happens when explicitly cancelling snippet mode,
			// e.g. when pressing ESC
			this._editor.setSelections([this._editor.getSelection()!]);
		}
	}

	prev(): void {
		if (this._session) {
			this._session.prev();
		}
		this._updateState();
	}

	next(): void {
		if (this._session) {
			this._session.next();
		}
		this._updateState();
	}

	isInSnippet(): boolean {
		return Boolean(this._inSnippet.get());
	}

	getSessionEnclosingRange(): Range | undefined {
		if (this._session) {
			return this._session.getEnclosingRange();
		}
		return undefined;
	}
}


registerEditorContribution(SnippetController2.ID, SnippetController2);

const CommandCtor = EditorCommand.bindToContribution<SnippetController2>(SnippetController2.get);

registerEditorCommand(new CommandCtor({
	id: 'jumpToNextSnippetPlaceholder',
	precondition: ContextKeyExpr.and(SnippetController2.InSnippetMode, SnippetController2.HasNextTabstop),
	handler: ctrl => ctrl.next(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 30,
		kbExpr: EditorContextKeys.editorTextFocus,
		primary: KeyCode.Tab
	}
}));
registerEditorCommand(new CommandCtor({
	id: 'jumpToPrevSnippetPlaceholder',
	precondition: ContextKeyExpr.and(SnippetController2.InSnippetMode, SnippetController2.HasPrevTabstop),
	handler: ctrl => ctrl.prev(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 30,
		kbExpr: EditorContextKeys.editorTextFocus,
		primary: KeyMod.Shift | KeyCode.Tab
	}
}));
registerEditorCommand(new CommandCtor({
	id: 'leaveSnippet',
	precondition: SnippetController2.InSnippetMode,
	handler: ctrl => ctrl.cancel(true),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 30,
		kbExpr: EditorContextKeys.editorTextFocus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

registerEditorCommand(new CommandCtor({
	id: 'acceptSnippet',
	precondition: SnippetController2.InSnippetMode,
	handler: ctrl => ctrl.finish(),
	// kbOpts: {
	// 	weight: KeybindingWeight.EditorContrib + 30,
	// 	kbExpr: EditorContextKeys.textFocus,
	// 	primary: KeyCode.Enter,
	// }
}));
