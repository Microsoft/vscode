/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { CallHierarchyProviderRegistry, CallHierarchyDirection, CallHierarchyModel } from 'vs/workbench/contrib/callHierarchy/common/callHierarchy';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { CallHierarchyTreePeekWidget } from 'vs/workbench/contrib/callHierarchy/browser/callHierarchyPeek';
import { Event } from 'vs/base/common/event';
import { registerEditorContribution, EditorAction2 } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextKeyService, RawContextKey, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { PeekContext } from 'vs/editor/contrib/peekView/peekView';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Range } from 'vs/editor/common/core/range';
import { IPosition } from 'vs/editor/common/core/position';
import { MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

const _ctxHasCallHierarchyProvider = new RawContextKey<boolean>('editorHasCallHierarchyProvider', false);
const _ctxCallHierarchyVisible = new RawContextKey<boolean>('callHierarchyVisible', false);
const _ctxCallHierarchyDirection = new RawContextKey<string>('callHierarchyDirection', undefined);

function sanitizedDirection(candidate: string): CallHierarchyDirection {
	return candidate === CallHierarchyDirection.CallsFrom || candidate === CallHierarchyDirection.CallsTo
		? candidate
		: CallHierarchyDirection.CallsTo;
}

class CallHierarchyController implements IEditorContribution {

	static readonly Id = 'callHierarchy';

	static get(editor: ICodeEditor): CallHierarchyController {
		return editor.getContribution<CallHierarchyController>(CallHierarchyController.Id);
	}

	private static readonly _StorageDirection = 'callHierarchy/defaultDirection';

	private readonly _ctxHasProvider: IContextKey<boolean>;
	private readonly _ctxIsVisible: IContextKey<boolean>;
	private readonly _ctxDirection: IContextKey<string>;
	private readonly _dispoables = new DisposableStore();
	private readonly _sessionDisposables = new DisposableStore();

	private _widget?: CallHierarchyTreePeekWidget;

	constructor(
		private readonly _editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IStorageService private readonly _storageService: IStorageService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		this._ctxIsVisible = _ctxCallHierarchyVisible.bindTo(this._contextKeyService);
		this._ctxHasProvider = _ctxHasCallHierarchyProvider.bindTo(this._contextKeyService);
		this._ctxDirection = _ctxCallHierarchyDirection.bindTo(this._contextKeyService);
		this._dispoables.add(Event.any<any>(_editor.onDidChangeModel, _editor.onDidChangeModelLanguage, CallHierarchyProviderRegistry.onDidChange)(() => {
			this._ctxHasProvider.set(_editor.hasModel() && CallHierarchyProviderRegistry.has(_editor.getModel()));
		}));
		this._dispoables.add(this._sessionDisposables);
	}

	dispose(): void {
		this._ctxHasProvider.reset();
		this._ctxIsVisible.reset();
		this._dispoables.dispose();
	}

	async startCallHierarchyFromEditor(): Promise<void> {
		this._sessionDisposables.clear();

		if (!this._editor.hasModel()) {
			return;
		}

		const document = this._editor.getModel();
		const position = this._editor.getPosition();
		if (!CallHierarchyProviderRegistry.has(document)) {
			return;
		}

		const cts = new CancellationTokenSource();
		const model = CallHierarchyModel.create(document, position, cts.token);
		const direction = sanitizedDirection(this._storageService.get(CallHierarchyController._StorageDirection, StorageScope.GLOBAL, CallHierarchyDirection.CallsTo));

		this._showCallHierarchyWidget(position, direction, model, cts);
	}

	async startCallHierarchyFromCallHierarchy(): Promise<void> {
		if (!this._widget) {
			return;
		}
		const model = this._widget.getModel();
		const call = this._widget.getFocused();
		if (!call || !model) {
			return;
		}
		const newEditor = await this._editorService.openCodeEditor({ resource: call.item.uri }, this._editor);
		if (!newEditor) {
			return;
		}
		const newModel = model.fork(call.item);
		this._sessionDisposables.clear();

		CallHierarchyController.get(newEditor)._showCallHierarchyWidget(
			Range.lift(newModel.root.selectionRange).getStartPosition(),
			this._widget.direction,
			Promise.resolve(newModel),
			new CancellationTokenSource()
		);
	}

	private _showCallHierarchyWidget(position: IPosition, direction: CallHierarchyDirection, model: Promise<CallHierarchyModel | undefined>, cts: CancellationTokenSource) {

		this._ctxIsVisible.set(true);
		this._ctxDirection.set(direction);
		Event.any<any>(this._editor.onDidChangeModel, this._editor.onDidChangeModelLanguage)(this.endCallHierarchy, this, this._sessionDisposables);
		this._widget = this._instantiationService.createInstance(CallHierarchyTreePeekWidget, this._editor, position, direction);
		this._widget.showLoading();
		this._sessionDisposables.add(this._widget.onDidClose(() => {
			this.endCallHierarchy();
			this._storageService.store(CallHierarchyController._StorageDirection, this._widget!.direction, StorageScope.GLOBAL, StorageTarget.USER);
		}));
		this._sessionDisposables.add({ dispose() { cts.dispose(true); } });
		this._sessionDisposables.add(this._widget);

		model.then(model => {
			if (cts.token.isCancellationRequested) {
				return; // nothing
			}
			if (model) {
				this._sessionDisposables.add(model);
				this._widget!.showModel(model);
			}
			else {
				this._widget!.showMessage(localize('no.item', "No results"));
			}
		}).catch(e => {
			this._widget!.showMessage(localize('error', "Failed to show call hierarchy"));
			console.error(e);
		});
	}

	showOutgoingCalls(): void {
		this._widget?.updateDirection(CallHierarchyDirection.CallsFrom);
		this._ctxDirection.set(CallHierarchyDirection.CallsFrom);
	}

	showIncomingCalls(): void {
		this._widget?.updateDirection(CallHierarchyDirection.CallsTo);
		this._ctxDirection.set(CallHierarchyDirection.CallsTo);
	}

	endCallHierarchy(): void {
		this._sessionDisposables.clear();
		this._ctxIsVisible.set(false);
		this._editor.focus();
	}
}

registerEditorContribution(CallHierarchyController.Id, CallHierarchyController);

registerAction2(class extends EditorAction2 {

	constructor() {
		super({
			id: 'editor.showCallHierarchy',
			title: { value: localize('title', "Peek Call Hierarchy"), original: 'Peek Call Hierarchy' },
			menu: {
				id: MenuId.EditorContextPeek,
				group: 'navigation',
				order: 1000,
				when: ContextKeyExpr.and(
					_ctxHasCallHierarchyProvider,
					PeekContext.notInPeekEditor
				),
			},
			keybinding: {
				when: EditorContextKeys.editorTextFocus,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift + KeyMod.Alt + KeyCode.KEY_H
			},
			precondition: ContextKeyExpr.and(
				_ctxHasCallHierarchyProvider,
				PeekContext.notInPeekEditor
			)
		});
	}

	async runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		return CallHierarchyController.get(editor).startCallHierarchyFromEditor();
	}
});

registerAction2(class extends EditorAction2 {

	constructor() {
		super({
			id: 'editor.showIncomingCalls',
			title: { value: localize('title.incoming', "Show Incoming Calls"), original: 'Show Incoming Calls' },
			icon: registerIcon('callhierarchy-incoming', Codicon.callIncoming, localize('showIncomingCallsIcons', 'Icon for incoming calls in the call hierarchy view.')),
			precondition: ContextKeyExpr.and(_ctxCallHierarchyVisible, _ctxCallHierarchyDirection.isEqualTo(CallHierarchyDirection.CallsFrom)),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift + KeyMod.Alt + KeyCode.KEY_H,
			},
			menu: {
				id: CallHierarchyTreePeekWidget.TitleMenu,
				when: _ctxCallHierarchyDirection.isEqualTo(CallHierarchyDirection.CallsFrom),
				order: 1,
			}
		});
	}

	runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor) {
		return CallHierarchyController.get(editor).showIncomingCalls();
	}
});

registerAction2(class extends EditorAction2 {

	constructor() {
		super({
			id: 'editor.showOutgoingCalls',
			title: { value: localize('title.outgoing', "Show Outgoing Calls"), original: 'Show Outgoing Calls' },
			icon: registerIcon('callhierarchy-outgoing', Codicon.callOutgoing, localize('showOutgoingCallsIcon', 'Icon for outgoing calls in the call hierarchy view.')),
			precondition: ContextKeyExpr.and(_ctxCallHierarchyVisible, _ctxCallHierarchyDirection.isEqualTo(CallHierarchyDirection.CallsTo)),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift + KeyMod.Alt + KeyCode.KEY_H,
			},
			menu: {
				id: CallHierarchyTreePeekWidget.TitleMenu,
				when: _ctxCallHierarchyDirection.isEqualTo(CallHierarchyDirection.CallsTo),
				order: 1
			}
		});
	}

	runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor) {
		return CallHierarchyController.get(editor).showOutgoingCalls();
	}
});


registerAction2(class extends EditorAction2 {

	constructor() {
		super({
			id: 'editor.refocusCallHierarchy',
			title: { value: localize('title.refocus', "Refocus Call Hierarchy"), original: 'Refocus Call Hierarchy' },
			precondition: _ctxCallHierarchyVisible,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Shift + KeyCode.Enter
			}
		});
	}

	async runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		return CallHierarchyController.get(editor).startCallHierarchyFromCallHierarchy();
	}
});


registerAction2(class extends EditorAction2 {

	constructor() {
		super({
			id: 'editor.closeCallHierarchy',
			title: localize('close', 'Close'),
			icon: Codicon.close,
			precondition: ContextKeyExpr.and(
				_ctxCallHierarchyVisible,
				ContextKeyExpr.not('config.editor.stablePeek')
			),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 10,
				primary: KeyCode.Escape
			},
			menu: {
				id: CallHierarchyTreePeekWidget.TitleMenu,
				order: 1000
			}
		});
	}

	runEditorCommand(_accessor: ServicesAccessor, editor: ICodeEditor): void {
		return CallHierarchyController.get(editor).endCallHierarchy();
	}
});
