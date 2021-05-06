/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Widget } from 'vs/base/browser/ui/widget';
import { IOverlayWidget, ICodeEditor, IOverlayWidgetPosition, OverlayWidgetPositionPreference, isCodeEditor, isCompositeEditor } from 'vs/editor/browser/editorBrowser';
import { Emitter } from 'vs/base/common/event';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { $, append, clearNode } from 'vs/base/browser/dom';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { buttonBackground, buttonForeground, editorBackground, editorForeground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { isEqual } from 'vs/base/common/resources';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IRange } from 'vs/editor/common/core/range';
import { CursorChangeReason, ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { TrackedRangeStickiness, IModelDecorationsChangeAccessor } from 'vs/editor/common/model';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

export interface IRangeHighlightDecoration {
	resource: URI;
	range: IRange;
	isWholeLine?: boolean;
}

export class RangeHighlightDecorations extends Disposable {

	private readonly _onHighlightRemoved = this._register(new Emitter<void>());
	readonly onHighlightRemoved = this._onHighlightRemoved.event;

	private rangeHighlightDecorationId: string | null = null;
	private editor: ICodeEditor | null = null;
	private readonly editorDisposables = this._register(new DisposableStore());

	constructor(@IEditorService private readonly editorService: IEditorService) {
		super();
	}

	removeHighlightRange() {
		if (this.editor?.getModel() && this.rangeHighlightDecorationId) {
			this.editor.deltaDecorations([this.rangeHighlightDecorationId], []);
			this._onHighlightRemoved.fire();
		}

		this.rangeHighlightDecorationId = null;
	}

	highlightRange(range: IRangeHighlightDecoration, editor?: any) {
		editor = editor ?? this.getEditor(range);
		if (isCodeEditor(editor)) {
			this.doHighlightRange(editor, range);
		} else if (isCompositeEditor(editor) && isCodeEditor(editor.activeCodeEditor)) {
			this.doHighlightRange(editor.activeCodeEditor, range);
		}
	}

	private doHighlightRange(editor: ICodeEditor, selectionRange: IRangeHighlightDecoration) {
		this.removeHighlightRange();

		editor.changeDecorations((changeAccessor: IModelDecorationsChangeAccessor) => {
			this.rangeHighlightDecorationId = changeAccessor.addDecoration(selectionRange.range, this.createRangeHighlightDecoration(selectionRange.isWholeLine));
		});

		this.setEditor(editor);
	}

	private getEditor(resourceRange: IRangeHighlightDecoration): ICodeEditor | undefined {
		const resource = this.editorService.activeEditor?.resource;
		if (resource && isEqual(resource, resourceRange.resource) && isCodeEditor(this.editorService.activeTextEditorControl)) {
			return this.editorService.activeTextEditorControl;
		}

		return undefined;
	}

	private setEditor(editor: ICodeEditor) {
		if (this.editor !== editor) {
			this.editorDisposables.clear();
			this.editor = editor;
			this.editorDisposables.add(this.editor.onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
				if (
					e.reason === CursorChangeReason.NotSet
					|| e.reason === CursorChangeReason.Explicit
					|| e.reason === CursorChangeReason.Undo
					|| e.reason === CursorChangeReason.Redo
				) {
					this.removeHighlightRange();
				}
			}));
			this.editorDisposables.add(this.editor.onDidChangeModel(() => { this.removeHighlightRange(); }));
			this.editorDisposables.add(this.editor.onDidDispose(() => {
				this.removeHighlightRange();
				this.editor = null;
			}));
		}
	}

	private static readonly _WHOLE_LINE_RANGE_HIGHLIGHT = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight',
		isWholeLine: true
	});

	private static readonly _RANGE_HIGHLIGHT = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight'
	});

	private createRangeHighlightDecoration(isWholeLine: boolean = true): ModelDecorationOptions {
		return (isWholeLine ? RangeHighlightDecorations._WHOLE_LINE_RANGE_HIGHLIGHT : RangeHighlightDecorations._RANGE_HIGHLIGHT);
	}

	override dispose() {
		super.dispose();

		if (this.editor?.getModel()) {
			this.removeHighlightRange();
			this.editor = null;
		}
	}
}

export class FloatingClickWidget extends Widget implements IOverlayWidget {

	private readonly _onClick = this._register(new Emitter<void>());
	readonly onClick = this._onClick.event;

	private _domNode: HTMLElement;

	constructor(
		private editor: ICodeEditor,
		private label: string,
		keyBindingAction: string | null,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		this._domNode = $('.floating-click-widget');
		this._domNode.style.padding = '10px';
		this._domNode.style.cursor = 'pointer';

		if (keyBindingAction) {
			const keybinding = keybindingService.lookupKeybinding(keyBindingAction);
			if (keybinding) {
				this.label += ` (${keybinding.getLabel()})`;
			}
		}
	}

	getId(): string {
		return 'editor.overlayWidget.floatingClickWidget';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER
		};
	}

	render() {
		clearNode(this._domNode);

		this._register(attachStylerCallback(this.themeService, { buttonBackground, buttonForeground, editorBackground, editorForeground, contrastBorder }, colors => {
			const backgroundColor = colors.buttonBackground ? colors.buttonBackground : colors.editorBackground;
			if (backgroundColor) {
				this._domNode.style.backgroundColor = backgroundColor.toString();
			}

			const foregroundColor = colors.buttonForeground ? colors.buttonForeground : colors.editorForeground;
			if (foregroundColor) {
				this._domNode.style.color = foregroundColor.toString();
			}

			const borderColor = colors.contrastBorder ? colors.contrastBorder.toString() : '';
			this._domNode.style.borderWidth = borderColor ? '1px' : '';
			this._domNode.style.borderStyle = borderColor ? 'solid' : '';
			this._domNode.style.borderColor = borderColor;
		}));

		append(this._domNode, $('')).textContent = this.label;

		this.onclick(this._domNode, e => this._onClick.fire());

		this.editor.addOverlayWidget(this);
	}

	override dispose(): void {
		this.editor.removeOverlayWidget(this);

		super.dispose();
	}
}

export class OpenWorkspaceButtonContribution extends Disposable implements IEditorContribution {

	static get(editor: ICodeEditor): OpenWorkspaceButtonContribution {
		return editor.getContribution<OpenWorkspaceButtonContribution>(OpenWorkspaceButtonContribution.ID);
	}

	public static readonly ID = 'editor.contrib.openWorkspaceButton';

	private openWorkspaceButton: FloatingClickWidget | undefined;

	constructor(
		private editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editor.onDidChangeModel(e => this.update()));
	}

	private update(): void {
		if (!this.shouldShowButton(this.editor)) {
			this.disposeOpenWorkspaceWidgetRenderer();
			return;
		}

		this.createOpenWorkspaceWidgetRenderer();
	}

	private shouldShowButton(editor: ICodeEditor): boolean {
		const model = editor.getModel();
		if (!model) {
			return false; // we need a model
		}

		if (!hasWorkspaceFileExtension(model.uri)) {
			return false; // we need a workspace file
		}

		if (!this.fileService.canHandleResource(model.uri)) {
			return false; // needs to be backed by a file service
		}

		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			const workspaceConfiguration = this.contextService.getWorkspace().configuration;
			if (workspaceConfiguration && isEqual(workspaceConfiguration, model.uri)) {
				return false; // already inside workspace
			}
		}

		if (editor.getOption(EditorOption.inDiffEditor)) {
			// in diff editor
			return false;
		}

		return true;
	}

	private createOpenWorkspaceWidgetRenderer(): void {
		if (!this.openWorkspaceButton) {
			this.openWorkspaceButton = this.instantiationService.createInstance(FloatingClickWidget, this.editor, localize('openWorkspace', "Open Workspace"), null);
			this._register(this.openWorkspaceButton.onClick(() => {
				const model = this.editor.getModel();
				if (model) {
					this.hostService.openWindow([{ workspaceUri: model.uri }]);
				}
			}));

			this.openWorkspaceButton.render();
		}
	}

	private disposeOpenWorkspaceWidgetRenderer(): void {
		dispose(this.openWorkspaceButton);
		this.openWorkspaceButton = undefined;
	}

	override dispose(): void {
		this.disposeOpenWorkspaceWidgetRenderer();

		super.dispose();
	}
}
