/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { RawContextKey, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IMarker } from 'vs/platform/markers/common/markers';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { registerEditorAction, registerEditorContribution, ServicesAccessor, IActionOptions, EditorAction, EditorCommand, registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { MarkerNavigationWidget } from './gotoErrorWidget';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { MenuId } from 'vs/platform/actions/common/actions';
import { TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { Codicon } from 'vs/base/common/codicons';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMarkerNavigationService, MarkerList } from 'vs/editor/contrib/gotoError/markerNavigationService';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export class MarkerController implements IEditorContribution {

	static readonly ID = 'editor.contrib.markerController';

	static get(editor: ICodeEditor): MarkerController {
		return editor.getContribution<MarkerController>(MarkerController.ID);
	}

	private readonly _editor: ICodeEditor;

	private readonly _widgetVisible: IContextKey<boolean>;
	private readonly _sessionDispoables = new DisposableStore();

	private _model?: MarkerList;
	private _widget?: MarkerNavigationWidget;

	constructor(
		editor: ICodeEditor,
		@IMarkerNavigationService private readonly _markerNavigationService: IMarkerNavigationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		this._editor = editor;
		this._widgetVisible = CONTEXT_MARKERS_NAVIGATION_VISIBLE.bindTo(this._contextKeyService);
	}

	dispose(): void {
		this._cleanUp();
		this._sessionDispoables.dispose();
	}

	private _cleanUp(): void {
		this._widgetVisible.reset();
		this._sessionDispoables.clear();
		this._widget = undefined;
		this._model = undefined;
	}

	private _getOrCreateModel(uri: URI | undefined): MarkerList {

		if (this._model && this._model.matches(uri)) {
			return this._model;
		}
		let reusePosition = false;
		if (this._model) {
			reusePosition = true;
			this._cleanUp();
		}

		this._model = this._markerNavigationService.getMarkerList(uri);
		if (reusePosition) {
			this._model.move(true, this._editor.getModel()!, this._editor.getPosition()!);
		}

		this._widget = this._instantiationService.createInstance(MarkerNavigationWidget, this._editor);
		this._widget.onDidClose(() => this.close(), this, this._sessionDispoables);
		this._widgetVisible.set(true);

		this._sessionDispoables.add(this._model);
		this._sessionDispoables.add(this._widget);

		// follow cursor
		this._sessionDispoables.add(this._editor.onDidChangeCursorPosition(e => {
			if (!this._model?.selected || !Range.containsPosition(this._model?.selected.marker, e.position)) {
				this._model?.resetIndex();
			}
		}));

		// update markers
		this._sessionDispoables.add(this._model.onDidChange(() => {
			if (!this._widget || !this._widget.position || !this._model) {
				return;
			}
			const info = this._model.find(this._editor.getModel()!.uri, this._widget!.position!);
			if (info) {
				this._widget.updateMarker(info.marker);
			} else {
				this._widget.showStale();
			}
		}));

		// open related
		this._sessionDispoables.add(this._widget.onDidSelectRelatedInformation(related => {
			this._editorService.openCodeEditor({
				resource: related.resource,
				options: { pinned: true, revealIfOpened: true, selection: Range.lift(related).collapseToStart() }
			}, this._editor);
			this.close(false);
		}));
		this._sessionDispoables.add(this._editor.onDidChangeModel(() => this._cleanUp()));

		return this._model;
	}

	close(focusEditor: boolean = true): void {
		this._cleanUp();
		if (focusEditor) {
			this._editor.focus();
		}
	}

	showAtMarker(marker: IMarker): void {
		if (this._editor.hasModel()) {
			const model = this._getOrCreateModel(this._editor.getModel().uri);
			model.resetIndex();
			model.move(true, this._editor.getModel(), new Position(marker.startLineNumber, marker.startColumn));
			if (model.selected) {
				this._widget!.showAtMarker(model.selected.marker, model.selected.index, model.selected.total);
			}
		}
	}

	async nagivate(next: boolean, multiFile: boolean) {
		if (this._editor.hasModel()) {
			const model = this._getOrCreateModel(multiFile ? undefined : this._editor.getModel().uri);
			model.move(next, this._editor.getModel(), this._editor.getPosition());
			if (!model.selected) {
				return;
			}
			if (model.selected.marker.resource.toString() !== this._editor.getModel().uri.toString()) {
				// show in different editor
				this._cleanUp();
				const otherEditor = await this._editorService.openCodeEditor({
					resource: model.selected.marker.resource,
					options: { pinned: false, revealIfOpened: true, selectionRevealType: TextEditorSelectionRevealType.NearTop, selection: model.selected.marker }
				}, this._editor);

				if (otherEditor) {
					MarkerController.get(otherEditor).close();
					MarkerController.get(otherEditor).nagivate(next, multiFile);
				}

			} else {
				// show in this editor
				this._widget!.showAtMarker(model.selected.marker, model.selected.index, model.selected.total);
			}
		}
	}
}

class MarkerNavigationAction extends EditorAction {

	constructor(
		private readonly _next: boolean,
		private readonly _multiFile: boolean,
		opts: IActionOptions
	) {
		super(opts);
	}

	async run(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (editor.hasModel()) {
			MarkerController.get(editor).nagivate(this._next, this._multiFile);
		}
	}
}

export class NextMarkerAction extends MarkerNavigationAction {
	static ID: string = 'editor.action.marker.next';
	static LABEL: string = nls.localize('markerAction.next.label', "Go to Next Problem (Error, Warning, Info)");
	constructor() {
		super(true, false, {
			id: NextMarkerAction.ID,
			label: NextMarkerAction.LABEL,
			alias: 'Go to Next Problem (Error, Warning, Info)',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.Alt | KeyCode.F8,
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MarkerNavigationWidget.TitleMenu,
				title: NextMarkerAction.LABEL,
				icon: registerIcon('marker-navigation-next', Codicon.chevronDown, nls.localize('nextMarkerIcon', 'Icon for goto next marker.')),
				group: 'navigation',
				order: 1
			}
		});
	}
}

class PrevMarkerAction extends MarkerNavigationAction {
	static ID: string = 'editor.action.marker.prev';
	static LABEL: string = nls.localize('markerAction.previous.label', "Go to Previous Problem (Error, Warning, Info)");
	constructor() {
		super(false, false, {
			id: PrevMarkerAction.ID,
			label: PrevMarkerAction.LABEL,
			alias: 'Go to Previous Problem (Error, Warning, Info)',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.F8,
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MarkerNavigationWidget.TitleMenu,
				title: NextMarkerAction.LABEL,
				icon: registerIcon('marker-navigation-previous', Codicon.chevronUp, nls.localize('previousMarkerIcon', 'Icon for goto previous marker.')),
				group: 'navigation',
				order: 2
			}
		});
	}
}

class NextMarkerInFilesAction extends MarkerNavigationAction {
	constructor() {
		super(true, true, {
			id: 'editor.action.marker.nextInFiles',
			label: nls.localize('markerAction.nextInFiles.label', "Go to Next Problem in Files (Error, Warning, Info)"),
			alias: 'Go to Next Problem in Files (Error, Warning, Info)',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.F8,
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarGoMenu,
				title: nls.localize({ key: 'miGotoNextProblem', comment: ['&& denotes a mnemonic'] }, "Next &&Problem"),
				group: '6_problem_nav',
				order: 1
			}
		});
	}
}

class PrevMarkerInFilesAction extends MarkerNavigationAction {
	constructor() {
		super(false, true, {
			id: 'editor.action.marker.prevInFiles',
			label: nls.localize('markerAction.previousInFiles.label', "Go to Previous Problem in Files (Error, Warning, Info)"),
			alias: 'Go to Previous Problem in Files (Error, Warning, Info)',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.Shift | KeyCode.F8,
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarGoMenu,
				title: nls.localize({ key: 'miGotoPreviousProblem', comment: ['&& denotes a mnemonic'] }, "Previous &&Problem"),
				group: '6_problem_nav',
				order: 2
			}
		});
	}
}

registerEditorContribution(MarkerController.ID, MarkerController);
registerEditorAction(NextMarkerAction);
registerEditorAction(PrevMarkerAction);
registerEditorAction(NextMarkerInFilesAction);
registerEditorAction(PrevMarkerInFilesAction);

const CONTEXT_MARKERS_NAVIGATION_VISIBLE = new RawContextKey<boolean>('markersNavigationVisible', false);

const MarkerCommand = EditorCommand.bindToContribution<MarkerController>(MarkerController.get);

registerEditorCommand(new MarkerCommand({
	id: 'closeMarkersNavigation',
	precondition: CONTEXT_MARKERS_NAVIGATION_VISIBLE,
	handler: x => x.close(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 50,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));
