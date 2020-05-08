/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { RawContextKey, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IMarker, IMarkerService, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { registerEditorAction, registerEditorContribution, ServicesAccessor, IActionOptions, EditorAction, EditorCommand, registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { MarkerNavigationWidget } from './gotoErrorWidget';
import { compare } from 'vs/base/common/strings';
import { binarySearch, find } from 'vs/base/common/arrays';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { onUnexpectedError } from 'vs/base/common/errors';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { isEqual } from 'vs/base/common/resources';
import { TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { Codicon, registerIcon } from 'vs/base/common/codicons';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

class MarkerModel {

	private readonly _editor: ICodeEditor;
	private _markers: IMarker[];
	private _nextIdx: number;
	private readonly _toUnbind = new DisposableStore();
	private _ignoreSelectionChange: boolean;
	private readonly _onCurrentMarkerChanged: Emitter<IMarker | undefined>;
	private readonly _onMarkerSetChanged: Emitter<MarkerModel>;

	constructor(editor: ICodeEditor, markers: IMarker[]) {
		this._editor = editor;
		this._markers = [];
		this._nextIdx = -1;
		this._ignoreSelectionChange = false;
		this._onCurrentMarkerChanged = new Emitter<IMarker | undefined>();
		this._onMarkerSetChanged = new Emitter<MarkerModel>();
		this.setMarkers(markers);

		// listen on editor
		this._toUnbind.add(this._editor.onDidDispose(() => this.dispose()));
		this._toUnbind.add(this._editor.onDidChangeCursorPosition(() => {
			if (this._ignoreSelectionChange) {
				return;
			}
			if (this.currentMarker && this._editor.getPosition() && Range.containsPosition(this.currentMarker, this._editor.getPosition()!)) {
				return;
			}
			this._nextIdx = -1;
		}));
	}

	public get onCurrentMarkerChanged() {
		return this._onCurrentMarkerChanged.event;
	}

	public get onMarkerSetChanged() {
		return this._onMarkerSetChanged.event;
	}

	public setMarkers(markers: IMarker[]): void {

		let oldMarker = this._nextIdx >= 0 ? this._markers[this._nextIdx] : undefined;
		this._markers = markers || [];
		this._markers.sort(MarkerNavigationAction.compareMarker);
		if (!oldMarker) {
			this._nextIdx = -1;
		} else {
			this._nextIdx = Math.max(-1, binarySearch(this._markers, oldMarker, MarkerNavigationAction.compareMarker));
		}
		this._onMarkerSetChanged.fire(this);
	}

	public withoutWatchingEditorPosition(callback: () => void): void {
		this._ignoreSelectionChange = true;
		try {
			callback();
		} finally {
			this._ignoreSelectionChange = false;
		}
	}

	private _initIdx(fwd: boolean): void {
		let found = false;
		const position = this._editor.getPosition();
		for (let i = 0; i < this._markers.length; i++) {
			let range = Range.lift(this._markers[i]);

			if (range.isEmpty() && this._editor.getModel()) {
				const word = this._editor.getModel()!.getWordAtPosition(range.getStartPosition());
				if (word) {
					range = new Range(range.startLineNumber, word.startColumn, range.startLineNumber, word.endColumn);
				}
			}

			if (position && (range.containsPosition(position) || position.isBeforeOrEqual(range.getStartPosition()))) {
				this._nextIdx = i;
				found = true;
				break;
			}
		}
		if (!found) {
			// after the last change
			this._nextIdx = fwd ? 0 : this._markers.length - 1;
		}
		if (this._nextIdx < 0) {
			this._nextIdx = this._markers.length - 1;
		}
	}

	get currentMarker(): IMarker | undefined {
		return this.canNavigate() ? this._markers[this._nextIdx] : undefined;
	}

	set currentMarker(marker: IMarker | undefined) {
		const idx = this._nextIdx;
		this._nextIdx = -1;
		if (marker) {
			this._nextIdx = this.indexOf(marker);
		}
		if (this._nextIdx !== idx) {
			this._onCurrentMarkerChanged.fire(marker);
		}
	}

	public move(fwd: boolean, inCircles: boolean): boolean {
		if (!this.canNavigate()) {
			this._onCurrentMarkerChanged.fire(undefined);
			return !inCircles;
		}

		let oldIdx = this._nextIdx;
		let atEdge = false;

		if (this._nextIdx === -1) {
			this._initIdx(fwd);

		} else if (fwd) {
			if (inCircles || this._nextIdx + 1 < this._markers.length) {
				this._nextIdx = (this._nextIdx + 1) % this._markers.length;
			} else {
				atEdge = true;
			}

		} else if (!fwd) {
			if (inCircles || this._nextIdx > 0) {
				this._nextIdx = (this._nextIdx - 1 + this._markers.length) % this._markers.length;
			} else {
				atEdge = true;
			}
		}

		if (oldIdx !== this._nextIdx) {
			const marker = this._markers[this._nextIdx];
			this._onCurrentMarkerChanged.fire(marker);
		}

		return atEdge;
	}

	public canNavigate(): boolean {
		return this._markers.length > 0;
	}

	public findMarkerAtPosition(pos: Position): IMarker | undefined {
		return find(this._markers, marker => Range.containsPosition(marker, pos));
	}

	public get total() {
		return this._markers.length;
	}

	public indexOf(marker: IMarker): number {
		return 1 + this._markers.indexOf(marker);
	}

	public dispose(): void {
		this._toUnbind.dispose();
	}
}

export class MarkerController implements IEditorContribution {

	public static readonly ID = 'editor.contrib.markerController';

	public static get(editor: ICodeEditor): MarkerController {
		return editor.getContribution<MarkerController>(MarkerController.ID);
	}

	private readonly _editor: ICodeEditor;
	private _model: MarkerModel | null = null;
	private _widget: MarkerNavigationWidget | null = null;
	private readonly _widgetVisible: IContextKey<boolean>;
	private readonly _disposeOnClose = new DisposableStore();

	constructor(
		editor: ICodeEditor,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		this._editor = editor;
		this._widgetVisible = CONTEXT_MARKERS_NAVIGATION_VISIBLE.bindTo(this._contextKeyService);
	}

	public dispose(): void {
		this._cleanUp();
		this._disposeOnClose.dispose();
	}

	private _cleanUp(): void {
		this._widgetVisible.reset();
		this._disposeOnClose.clear();
		this._widget = null;
		this._model = null;
	}

	public getOrCreateModel(): MarkerModel {

		if (this._model) {
			return this._model;
		}

		const markers = this._getMarkers();
		this._model = new MarkerModel(this._editor, markers);
		this._markerService.onMarkerChanged(this._onMarkerChanged, this, this._disposeOnClose);

		this._widget = this._instantiationService.createInstance(MarkerNavigationWidget, this._editor);
		this._widgetVisible.set(true);
		this._widget.onDidClose(() => this.closeMarkersNavigation(), this, this._disposeOnClose);

		this._disposeOnClose.add(this._model);
		this._disposeOnClose.add(this._widget);

		this._disposeOnClose.add(this._widget.onDidSelectRelatedInformation(related => {
			this._editorService.openCodeEditor({
				resource: related.resource,
				options: { pinned: true, revealIfOpened: true, selection: Range.lift(related).collapseToStart() }
			}, this._editor).then(undefined, onUnexpectedError);
			this.closeMarkersNavigation(false);
		}));
		this._disposeOnClose.add(this._editor.onDidChangeModel(() => this._cleanUp()));

		this._disposeOnClose.add(this._model.onCurrentMarkerChanged(marker => {
			if (!marker || !this._model) {
				this._cleanUp();
			} else {
				this._model.withoutWatchingEditorPosition(() => {
					if (!this._widget || !this._model) {
						return;
					}
					this._widget.showAtMarker(marker, this._model.indexOf(marker), this._model.total);
				});
			}
		}));
		this._disposeOnClose.add(this._model.onMarkerSetChanged(() => {
			if (!this._widget || !this._widget.position || !this._model) {
				return;
			}

			const marker = this._model.findMarkerAtPosition(this._widget.position);
			if (marker) {
				this._widget.updateMarker(marker);
			} else {
				this._widget.showStale();
			}
		}));

		return this._model;
	}

	public closeMarkersNavigation(focusEditor: boolean = true): void {
		this._cleanUp();
		if (focusEditor) {
			this._editor.focus();
		}
	}

	public show(marker: IMarker): void {
		const model = this.getOrCreateModel();
		model.currentMarker = marker;
	}

	private _onMarkerChanged(changedResources: readonly URI[]): void {
		const editorModel = this._editor.getModel();
		if (!editorModel) {
			return;
		}

		if (!this._model) {
			return;
		}

		if (!changedResources.some(r => isEqual(editorModel.uri, r))) {
			return;
		}
		this._model.setMarkers(this._getMarkers());
	}

	private _getMarkers(): IMarker[] {
		let model = this._editor.getModel();
		if (!model) {
			return [];
		}

		return this._markerService.read({
			resource: model.uri,
			severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info
		});
	}
}

class MarkerNavigationAction extends EditorAction {

	private readonly _isNext: boolean;

	private readonly _multiFile: boolean;

	constructor(next: boolean, multiFile: boolean, opts: IActionOptions) {
		super(opts);
		this._isNext = next;
		this._multiFile = multiFile;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {

		const markerService = accessor.get(IMarkerService);
		const editorService = accessor.get(ICodeEditorService);
		const controller = MarkerController.get(editor);
		if (!controller) {
			return Promise.resolve(undefined);
		}

		const model = controller.getOrCreateModel();
		const atEdge = model.move(this._isNext, !this._multiFile);
		if (!atEdge || !this._multiFile) {
			return Promise.resolve(undefined);
		}

		// try with the next/prev file
		let markers = markerService.read({ severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info }).sort(MarkerNavigationAction.compareMarker);
		if (markers.length === 0) {
			return Promise.resolve(undefined);
		}

		const editorModel = editor.getModel();
		if (!editorModel) {
			return Promise.resolve(undefined);
		}

		let oldMarker = model.currentMarker || <IMarker>{ resource: editorModel!.uri, severity: MarkerSeverity.Error, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
		let idx = binarySearch(markers, oldMarker, MarkerNavigationAction.compareMarker);
		if (idx < 0) {
			// find best match...
			idx = ~idx;
			idx %= markers.length;
		} else if (this._isNext) {
			idx = (idx + 1) % markers.length;
		} else {
			idx = (idx + markers.length - 1) % markers.length;
		}

		let newMarker = markers[idx];
		if (isEqual(newMarker.resource, editorModel.uri)) {
			// the next `resource` is this resource which
			// means we cycle within this file
			model.move(this._isNext, true);
			return Promise.resolve(undefined);
		}

		// close the widget for this editor-instance, open the resource
		// for the next marker and re-start marker navigation in there
		controller.closeMarkersNavigation();

		return editorService.openCodeEditor({
			resource: newMarker.resource,
			options: { pinned: false, revealIfOpened: true, selectionRevealType: TextEditorSelectionRevealType.NearTop, selection: newMarker }
		}, editor).then(editor => {
			if (!editor) {
				return undefined;
			}
			return editor.getAction(this.id).run();
		});
	}

	static compareMarker(a: IMarker, b: IMarker): number {
		let res = compare(a.resource.toString(), b.resource.toString());
		if (res === 0) {
			res = MarkerSeverity.compare(a.severity, b.severity);
		}
		if (res === 0) {
			res = Range.compareRangesUsingStarts(a, b);
		}
		return res;
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
				icon: registerIcon('marker-navigation-next', Codicon.chevronDown),
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
				icon: registerIcon('marker-navigation-previous', Codicon.chevronUp),
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
	handler: x => x.closeMarkersNavigation(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 50,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

// Go to menu
MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '6_problem_nav',
	command: {
		id: 'editor.action.marker.nextInFiles',
		title: nls.localize({ key: 'miGotoNextProblem', comment: ['&& denotes a mnemonic'] }, "Next &&Problem")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '6_problem_nav',
	command: {
		id: 'editor.action.marker.prevInFiles',
		title: nls.localize({ key: 'miGotoPreviousProblem', comment: ['&& denotes a mnemonic'] }, "Previous &&Problem")
	},
	order: 2
});
