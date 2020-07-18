/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReferencesModel, OneReference } from 'vs/editor/contrib/gotoSymbol/referencesModel';
import { RawContextKey, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode } from 'vs/base/common/keyCodes';
import { registerEditorCommand, EditorCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Range } from 'vs/editor/common/core/range';
import { dispose, IDisposable, combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { localize } from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { isEqual } from 'vs/base/common/resources';
import { TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';

export const ctxHasSymbols = new RawContextKey('hasSymbols', false);

export const ISymbolNavigationService = createDecorator<ISymbolNavigationService>('ISymbolNavigationService');

export interface ISymbolNavigationService {
	readonly _serviceBrand: undefined;
	reset(): void;
	put(anchor: OneReference): void;
	revealNext(source: ICodeEditor): Promise<any>;
}

class SymbolNavigationService implements ISymbolNavigationService {

	declare readonly _serviceBrand: undefined;

	private readonly _ctxHasSymbols: IContextKey<boolean>;

	private _currentModel?: ReferencesModel = undefined;
	private _currentIdx: number = -1;
	private _currentState?: IDisposable;
	private _currentMessage?: IDisposable;
	private _ignoreEditorChange: boolean = false;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		this._ctxHasSymbols = ctxHasSymbols.bindTo(contextKeyService);
	}

	reset(): void {
		this._ctxHasSymbols.reset();
		dispose(this._currentState);
		dispose(this._currentMessage);
		this._currentModel = undefined;
		this._currentIdx = -1;
	}

	put(anchor: OneReference): void {
		const refModel = anchor.parent.parent;

		if (refModel.references.length <= 1) {
			this.reset();
			return;
		}

		this._currentModel = refModel;
		this._currentIdx = refModel.references.indexOf(anchor);
		this._ctxHasSymbols.set(true);
		this._showMessage();

		const editorState = new EditorState(this._editorService);
		const listener = editorState.onDidChange(_ => {

			if (this._ignoreEditorChange) {
				return;
			}

			const editor = this._editorService.getActiveCodeEditor();
			if (!editor) {
				return;
			}
			const model = editor.getModel();
			const position = editor.getPosition();
			if (!model || !position) {
				return;
			}

			let seenUri: boolean = false;
			let seenPosition: boolean = false;
			for (const reference of refModel.references) {
				if (isEqual(reference.uri, model.uri)) {
					seenUri = true;
					seenPosition = seenPosition || Range.containsPosition(reference.range, position);
				} else if (seenUri) {
					break;
				}
			}
			if (!seenUri || !seenPosition) {
				this.reset();
			}
		});

		this._currentState = combinedDisposable(editorState, listener);
	}

	revealNext(source: ICodeEditor): Promise<any> {
		if (!this._currentModel) {
			return Promise.resolve();
		}

		// get next result and advance
		this._currentIdx += 1;
		this._currentIdx %= this._currentModel.references.length;
		const reference = this._currentModel.references[this._currentIdx];

		// status
		this._showMessage();

		// open editor, ignore events while that happens
		this._ignoreEditorChange = true;
		return this._editorService.openCodeEditor({
			resource: reference.uri,
			options: {
				selection: Range.collapseToStart(reference.range),
				selectionRevealType: TextEditorSelectionRevealType.NearTopIfOutsideViewport
			}
		}, source).finally(() => {
			this._ignoreEditorChange = false;
		});

	}

	private _showMessage(): void {

		dispose(this._currentMessage);

		const kb = this._keybindingService.lookupKeybinding('editor.gotoNextSymbolFromResult');
		const message = kb
			? localize('location.kb', "Symbol {0} of {1}, {2} for next", this._currentIdx + 1, this._currentModel!.references.length, kb.getLabel())
			: localize('location', "Symbol {0} of {1}", this._currentIdx + 1, this._currentModel!.references.length);

		this._currentMessage = this._notificationService.status(message);
	}
}

registerSingleton(ISymbolNavigationService, SymbolNavigationService, true);

registerEditorCommand(new class extends EditorCommand {

	constructor() {
		super({
			id: 'editor.gotoNextSymbolFromResult',
			precondition: ctxHasSymbols,
			kbOpts: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyCode.F12
			}
		});
	}

	runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor): void | Promise<void> {
		return accessor.get(ISymbolNavigationService).revealNext(editor);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'editor.gotoNextSymbolFromResult.cancel',
	weight: KeybindingWeight.EditorContrib,
	when: ctxHasSymbols,
	primary: KeyCode.Escape,
	handler(accessor) {
		accessor.get(ISymbolNavigationService).reset();
	}
});

//

class EditorState {

	private readonly _listener = new Map<ICodeEditor, IDisposable>();
	private readonly _disposables = new DisposableStore();

	private readonly _onDidChange = new Emitter<{ editor: ICodeEditor }>();
	readonly onDidChange: Event<{ editor: ICodeEditor }> = this._onDidChange.event;

	constructor(@ICodeEditorService editorService: ICodeEditorService) {
		this._disposables.add(editorService.onCodeEditorRemove(this._onDidRemoveEditor, this));
		this._disposables.add(editorService.onCodeEditorAdd(this._onDidAddEditor, this));
		editorService.listCodeEditors().forEach(this._onDidAddEditor, this);
	}

	dispose(): void {
		this._disposables.dispose();
		this._onDidChange.dispose();
		dispose(this._listener.values());
	}

	private _onDidAddEditor(editor: ICodeEditor): void {
		this._listener.set(editor, combinedDisposable(
			editor.onDidChangeCursorPosition(_ => this._onDidChange.fire({ editor })),
			editor.onDidChangeModelContent(_ => this._onDidChange.fire({ editor })),
		));
	}

	private _onDidRemoveEditor(editor: ICodeEditor): void {
		dispose(this._listener.get(editor));
		this._listener.delete(editor);
	}
}
