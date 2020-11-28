/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOptions, IEditorOpenContext } from 'vs/workbench/common/editor';
import { notebookCellBorder, NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { NotebookDiffEditorInput } from '../notebookDiffEditorInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { CellDiffViewModel } from 'vs/workbench/contrib/notebook/browser/diff/celllDiffViewModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CellDiffRenderer, NotebookCellTextDiffListDelegate, NotebookTextDiffList } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffList';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { diffDiagonalFill, diffInserted, diffRemoved, editorBackground, focusBorder, foreground } from 'vs/platform/theme/common/colorRegistry';
import { INotebookEditorWorkerService } from 'vs/workbench/contrib/notebook/common/services/notebookWorkerService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { getZoomLevel } from 'vs/base/browser/browser';
import { NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DIFF_CELL_MARGIN, INotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/common';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { NotebookDiffEditorEventDispatcher, NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { INotebookDiffEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { IDiffChange } from 'vs/base/common/diff/diff';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';

export const IN_NOTEBOOK_TEXT_DIFF_EDITOR = new RawContextKey<boolean>('isInNotebookTextDiffEditor', false);

export class NotebookTextDiffEditor extends EditorPane implements INotebookTextDiffEditor {
	static readonly ID: string = 'workbench.editor.notebookTextDiffEditor';

	private _rootElement!: HTMLElement;
	private _overflowContainer!: HTMLElement;
	private _dimension: DOM.Dimension | null = null;
	private _list!: WorkbenchList<CellDiffViewModel>;
	private _fontInfo: BareFontInfo | undefined;

	private readonly _onMouseUp = this._register(new Emitter<{ readonly event: MouseEvent; readonly target: CellDiffViewModel; }>());
	public readonly onMouseUp = this._onMouseUp.event;
	private _eventDispatcher: NotebookDiffEditorEventDispatcher | undefined;
	protected _scopeContextKeyService!: IContextKeyService;
	private _model: INotebookDiffEditorModel | null = null;
	private _modifiedResourceDisposableStore = new DisposableStore();

	get textModel() {
		return this._model?.modified.notebook;
	}

	private _revealFirst: boolean;

	constructor(
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IThemeService readonly themeService: IThemeService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@INotebookEditorWorkerService readonly notebookEditorWorkerService: INotebookEditorWorkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly _fileService: FileService,

		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
	) {
		super(NotebookTextDiffEditor.ID, telemetryService, themeService, storageService);
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._fontInfo = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel());
		this._revealFirst = true;

		this._register(this._modifiedResourceDisposableStore);
	}

	protected createEditor(parent: HTMLElement): void {
		this._rootElement = DOM.append(parent, DOM.$('.notebook-text-diff-editor'));
		this._overflowContainer = document.createElement('div');
		this._overflowContainer.classList.add('notebook-overflow-widget-container', 'monaco-editor');
		DOM.append(parent, this._overflowContainer);

		const renderer = this.instantiationService.createInstance(CellDiffRenderer, this);

		this._list = this.instantiationService.createInstance(
			NotebookTextDiffList,
			'NotebookTextDiff',
			this._rootElement,
			this.instantiationService.createInstance(NotebookCellTextDiffListDelegate),
			[
				renderer
			],
			this.contextKeyService,
			{
				setRowLineHeight: false,
				setRowHeight: false,
				supportDynamicHeights: true,
				horizontalScrolling: false,
				keyboardSupport: false,
				mouseSupport: true,
				multipleSelectionSupport: false,
				enableKeyboardNavigation: true,
				additionalScrollHeight: 0,
				// transformOptimization: (isMacintosh && isNative) || getTitleBarStyle(this.configurationService, this.environmentService) === 'native',
				styleController: (_suffix: string) => { return this._list!; },
				overrideStyles: {
					listBackground: editorBackground,
					listActiveSelectionBackground: editorBackground,
					listActiveSelectionForeground: foreground,
					listFocusAndSelectionBackground: editorBackground,
					listFocusAndSelectionForeground: foreground,
					listFocusBackground: editorBackground,
					listFocusForeground: foreground,
					listHoverForeground: foreground,
					listHoverBackground: editorBackground,
					listHoverOutline: focusBorder,
					listFocusOutline: focusBorder,
					listInactiveSelectionBackground: editorBackground,
					listInactiveSelectionForeground: foreground,
					listInactiveFocusBackground: editorBackground,
					listInactiveFocusOutline: editorBackground,
				},
				accessibilityProvider: {
					getAriaLabel() { return null; },
					getWidgetAriaLabel() {
						return nls.localize('notebookTreeAriaLabel', "Notebook Text Diff");
					}
				},
				// focusNextPreviousDelegate: {
				// 	onFocusNext: (applyFocusNext: () => void) => this._updateForCursorNavigationMode(applyFocusNext),
				// 	onFocusPrevious: (applyFocusPrevious: () => void) => this._updateForCursorNavigationMode(applyFocusPrevious),
				// }
			}
		);

		this._register(this._list.onMouseUp(e => {
			if (e.element) {
				this._onMouseUp.fire({ event: e.browserEvent, target: e.element });
			}
		}));
	}

	async setInput(input: NotebookDiffEditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this._model = await input.resolve();
		if (this._model === null) {
			return;
		}

		this._revealFirst = true;

		this._modifiedResourceDisposableStore.add(this._fileService.watch(this._model.modified.resource));
		this._modifiedResourceDisposableStore.add(this._fileService.onDidFilesChange(async e => {
			if (this._model === null) {
				return;
			}

			if (e.contains(this._model!.modified.resource)) {
				if (this._model.modified.isDirty()) {
					return;
				}

				const modified = this._model.modified;
				const lastResolvedFileStat = modified.lastResolvedFileStat;
				const currFileStat = await this._resolveStats(modified.resource);

				if (lastResolvedFileStat && currFileStat && currFileStat.mtime > lastResolvedFileStat.mtime) {
					await this._model.resolveModifiedFromDisk();
					await this.updateLayout();
					return;
				}
			}

			if (e.contains(this._model!.original.resource)) {
				if (this._model.original.isDirty()) {
					return;
				}

				const original = this._model.original;
				const lastResolvedFileStat = original.lastResolvedFileStat;
				const currFileStat = await this._resolveStats(original.resource);

				if (lastResolvedFileStat && currFileStat && currFileStat.mtime > lastResolvedFileStat.mtime) {
					await this._model.resolveOriginalFromDisk();
					await this.updateLayout();
					return;
				}
			}
		}));


		this._eventDispatcher = new NotebookDiffEditorEventDispatcher();
		await this.updateLayout();
	}

	private async _resolveStats(resource: URI) {
		if (resource.scheme === Schemas.untitled) {
			return undefined;
		}

		try {
			const newStats = await this._fileService.resolve(resource, { resolveMetadata: true });
			return newStats;
		} catch (e) {
			return undefined;
		}
	}

	async updateLayout() {
		if (!this._model) {
			return;
		}

		const diffResult = await this.notebookEditorWorkerService.computeDiff(this._model.original.resource, this._model.modified.resource);
		const cellChanges = diffResult.cellsDiff.changes;

		const cellDiffViewModels: CellDiffViewModel[] = [];
		const originalModel = this._model.original.notebook;
		const modifiedModel = this._model.modified.notebook;
		let originalCellIndex = 0;
		let modifiedCellIndex = 0;

		let firstChangeIndex = -1;

		for (let i = 0; i < cellChanges.length; i++) {
			const change = cellChanges[i];
			// common cells

			for (let j = 0; j < change.originalStart - originalCellIndex; j++) {
				const originalCell = originalModel.cells[originalCellIndex + j];
				const modifiedCell = modifiedModel.cells[modifiedCellIndex + j];
				if (originalCell.getHashValue() === modifiedCell.getHashValue()) {
					cellDiffViewModels.push(new CellDiffViewModel(
						originalCell,
						modifiedCell,
						'unchanged',
						this._eventDispatcher!
					));
				} else {
					if (firstChangeIndex === -1) {
						firstChangeIndex = cellDiffViewModels.length;
					}

					cellDiffViewModels.push(new CellDiffViewModel(
						originalCell,
						modifiedCell,
						'modified',
						this._eventDispatcher!
					));
				}
			}

			const modifiedLCS = this._computeModifiedLCS(change, originalModel, modifiedModel);
			if (modifiedLCS.length && firstChangeIndex === -1) {
				firstChangeIndex = cellDiffViewModels.length;
			}

			cellDiffViewModels.push(...modifiedLCS);
			originalCellIndex = change.originalStart + change.originalLength;
			modifiedCellIndex = change.modifiedStart + change.modifiedLength;
		}

		for (let i = originalCellIndex; i < originalModel.cells.length; i++) {
			cellDiffViewModels.push(new CellDiffViewModel(
				originalModel.cells[i],
				modifiedModel.cells[i - originalCellIndex + modifiedCellIndex],
				'unchanged',
				this._eventDispatcher!
			));
		}

		this._list.splice(0, this._list.length, cellDiffViewModels);

		if (this._revealFirst && firstChangeIndex !== -1) {
			this._revealFirst = false;
			this._list.setFocus([firstChangeIndex]);
			this._list.reveal(firstChangeIndex, 0.3);
		}
	}

	private _computeModifiedLCS(change: IDiffChange, originalModel: NotebookTextModel, modifiedModel: NotebookTextModel) {
		const result: CellDiffViewModel[] = [];
		// modified cells
		const modifiedLen = Math.min(change.originalLength, change.modifiedLength);

		for (let j = 0; j < modifiedLen; j++) {
			result.push(new CellDiffViewModel(
				originalModel.cells[change.originalStart + j],
				modifiedModel.cells[change.modifiedStart + j],
				'modified',
				this._eventDispatcher!
			));
		}

		for (let j = modifiedLen; j < change.originalLength; j++) {
			// deletion
			result.push(new CellDiffViewModel(
				originalModel.cells[change.originalStart + j],
				undefined,
				'delete',
				this._eventDispatcher!
			));
		}

		for (let j = modifiedLen; j < change.modifiedLength; j++) {
			// insertion
			result.push(new CellDiffViewModel(
				undefined,
				modifiedModel.cells[change.modifiedStart + j],
				'insert',
				this._eventDispatcher!
			));
		}

		return result;
	}

	private pendingLayouts = new WeakMap<CellDiffViewModel, IDisposable>();


	layoutNotebookCell(cell: CellDiffViewModel, height: number) {
		const relayout = (cell: CellDiffViewModel, height: number) => {
			const viewIndex = this._list!.indexOf(cell);

			this._list?.updateElementHeight(viewIndex, height);
		};

		if (this.pendingLayouts.has(cell)) {
			this.pendingLayouts.get(cell)!.dispose();
		}

		let r: () => void;
		const layoutDisposable = DOM.scheduleAtNextAnimationFrame(() => {
			this.pendingLayouts.delete(cell);

			relayout(cell, height);
			r();
		});

		this.pendingLayouts.set(cell, toDisposable(() => {
			layoutDisposable.dispose();
			r();
		}));

		return new Promise<void>(resolve => { r = resolve; });
	}

	getDomNode() {
		return this._rootElement;
	}

	getOverflowContainerDomNode(): HTMLElement {
		return this._overflowContainer;
	}

	getControl(): NotebookEditorWidget | undefined {
		return undefined;
	}

	setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
	}

	focus() {
		super.focus();
	}

	clearInput(): void {
		super.clearInput();

		this._modifiedResourceDisposableStore.clear();
		this._list?.splice(0, this._list?.length || 0);
	}

	getLayoutInfo(): NotebookLayoutInfo {
		if (!this._list) {
			throw new Error('Editor is not initalized successfully');
		}

		return {
			width: this._dimension!.width,
			height: this._dimension!.height,
			fontInfo: this._fontInfo!
		};
	}

	layout(dimension: DOM.Dimension): void {
		this._rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this._rootElement.classList.toggle('narrow-width', dimension.width < 600);
		this._dimension = dimension;
		this._rootElement.style.height = `${dimension.height}px`;

		this._list?.layout(this._dimension.height, this._dimension.width);
		this._eventDispatcher?.emit([new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);
	}
}

registerThemingParticipant((theme, collector) => {
	const cellBorderColor = theme.getColor(notebookCellBorder);
	if (cellBorderColor) {
		collector.addRule(`.notebook-text-diff-editor .cell-body { border: 1px solid ${cellBorderColor};}`);
		collector.addRule(`.notebook-text-diff-editor .cell-diff-editor-container .output-header-container,
		.notebook-text-diff-editor .cell-diff-editor-container .metadata-header-container {
			border-top: 1px solid ${cellBorderColor};
		}`);
	}

	const diffDiagonalFillColor = theme.getColor(diffDiagonalFill);
	collector.addRule(`
	.notebook-text-diff-editor .diagonal-fill {
		background-image: linear-gradient(
			-45deg,
			${diffDiagonalFillColor} 12.5%,
			#0000 12.5%, #0000 50%,
			${diffDiagonalFillColor} 50%, ${diffDiagonalFillColor} 62.5%,
			#0000 62.5%, #0000 100%
		);
		background-size: 8px 8px;
	}
	`);

	const added = theme.getColor(diffInserted);
	if (added) {
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-header-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-header-container { background-color: ${added}; }
		`
		);
	}
	const removed = theme.getColor(diffRemoved);
	if (added) {
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-header-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-header-container { background-color: ${removed}; }
		`
		);
	}

	// const changed = theme.getColor(editorGutterModifiedBackground);

	// if (changed) {
	// 	collector.addRule(`
	// 		.notebook-text-diff-editor .cell-diff-editor-container .metadata-header-container.modified {
	// 			background-color: ${changed};
	// 		}
	// 	`);
	// }

	collector.addRule(`.notebook-text-diff-editor .cell-body { margin: ${DIFF_CELL_MARGIN}px; }`);
});
