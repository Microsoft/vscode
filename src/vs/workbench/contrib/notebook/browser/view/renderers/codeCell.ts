/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IDimension } from 'vs/editor/common/editorCommon';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { EDITOR_BOTTOM_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellFocusMode, CodeCellRenderTemplate, getEditorTopPadding, IActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ClickTargetType, getExecuteCellPlaceholder } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';
import { OutputContainer } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellOutput';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';


export class CodeCell extends Disposable {
	private _outputContainerRenderer: OutputContainer;
	private _activeCellRunPlaceholder: IDisposable | null = null;
	private _untrustedStatusItem: IDisposable | null = null;

	constructor(
		private notebookEditor: IActiveNotebookEditor,
		private viewCell: CodeCellViewModel,
		private templateData: CodeCellRenderTemplate,
		@INotebookService notebookService: INotebookService,
		@IQuickInputService quickInputService: IQuickInputService,
		@INotebookCellStatusBarService readonly notebookCellStatusBarService: INotebookCellStatusBarService,
		@IOpenerService readonly openerService: IOpenerService,
		@ITextFileService readonly textFileService: ITextFileService,
		@IModeService private readonly _modeService: IModeService,
		// @IKeybindingService private readonly _keybindingService: IKeybindingService,

	) {
		super();

		const width = this.viewCell.layoutInfo.editorWidth;
		const lineNum = this.viewCell.lineCount;
		const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
		const editorHeight = this.viewCell.layoutInfo.editorHeight === 0
			? lineNum * lineHeight + getEditorTopPadding() + EDITOR_BOTTOM_PADDING
			: this.viewCell.layoutInfo.editorHeight;

		this.layoutEditor(
			{
				width: width,
				height: editorHeight
			}
		);

		const cts = new CancellationTokenSource();
		this._register({ dispose() { cts.dispose(true); } });
		raceCancellation(viewCell.resolveTextModel(), cts.token).then(model => {
			if (model && templateData.editor) {
				templateData.editor.setModel(model);
				viewCell.attachTextEditor(templateData.editor);
				if (notebookEditor.getActiveCell() === viewCell && viewCell.focusMode === CellFocusMode.Editor && this.notebookEditor.hasFocus()) {
					templateData.editor?.focus();
				}

				const realContentHeight = templateData.editor?.getContentHeight();
				if (realContentHeight !== undefined && realContentHeight !== editorHeight) {
					this.onCellHeightChange(realContentHeight);
				}

				if (this.notebookEditor.getActiveCell() === this.viewCell && viewCell.focusMode === CellFocusMode.Editor && this.notebookEditor.hasFocus()) {
					templateData.editor?.focus();
				}
			}
		});

		const updateForFocusMode = () => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				templateData.editor?.focus();
			}

			templateData.container.classList.toggle('cell-editor-focus', viewCell.focusMode === CellFocusMode.Editor);
		};
		const updateForCollapseState = () => {
			this.viewUpdate();
		};
		this._register(viewCell.onDidChangeState((e) => {
			if (e.focusModeChanged) {
				updateForFocusMode();
			}
		}));
		updateForFocusMode();

		templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel.metadata).editable) });
		this._register(viewCell.onDidChangeState((e) => {
			if (e.metadataChanged) {
				templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel.metadata).editable) });

				// TODO@rob this isn't nice
				this.viewCell.layoutChange({});
				updateForCollapseState();
				this.relayoutCell();
			}
		}));

		this._register(viewCell.onDidChangeState((e) => {
			if (e.languageChanged) {
				const mode = this._modeService.create(viewCell.language);
				templateData.editor?.getModel()?.setMode(mode.languageIdentifier);
			}
		}));

		this._register(viewCell.onDidChangeLayout((e) => {
			if (e.outerWidth !== undefined) {
				const layoutInfo = templateData.editor.getLayoutInfo();
				if (layoutInfo.width !== viewCell.layoutInfo.editorWidth) {
					this.onCellWidthChange();
				}
			}
		}));

		this._register(templateData.editor.onDidContentSizeChange((e) => {
			if (e.contentHeightChanged) {
				if (this.viewCell.layoutInfo.editorHeight !== e.contentHeight) {
					this.onCellHeightChange(e.contentHeight);
				}
			}
		}));

		this._register(templateData.editor.onDidChangeCursorSelection((e) => {
			if (e.source === 'restoreState') {
				// do not reveal the cell into view if this selection change was caused by restoring editors...
				return;
			}

			const primarySelection = templateData.editor.getSelection();

			if (primarySelection) {
				this.notebookEditor.revealLineInViewAsync(viewCell, primarySelection.positionLineNumber);
			}
		}));

		// Apply decorations
		this._register(viewCell.onCellDecorationsChanged((e) => {
			e.added.forEach(options => {
				if (options.className) {
					templateData.rootContainer.classList.add(options.className);
				}

				if (options.outputClassName) {
					this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [options.outputClassName], []);
				}
			});

			e.removed.forEach(options => {
				if (options.className) {
					templateData.rootContainer.classList.remove(options.className);
				}

				if (options.outputClassName) {
					this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [], [options.outputClassName]);
				}
			});
		}));

		viewCell.getCellDecorations().forEach(options => {
			if (options.className) {
				templateData.rootContainer.classList.add(options.className);
			}

			if (options.outputClassName) {
				this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [options.outputClassName], []);
			}
		});

		// Mouse click handlers
		this._register(templateData.statusBar.onDidClick(e => {
			if (e.type !== ClickTargetType.ContributedCommandItem) {
				const target = templateData.editor.getTargetAtClientPoint(e.event.clientX, e.event.clientY - viewCell.getEditorStatusbarHeight());
				if (target?.position) {
					templateData.editor.setPosition(target.position);
					templateData.editor.focus();
				}
			}
		}));

		this._register(templateData.editor.onMouseDown(e => {
			// prevent default on right mouse click, otherwise it will trigger unexpected focus changes
			// the catch is, it means we don't allow customization of right button mouse down handlers other than the built in ones.
			if (e.event.rightButton) {
				e.event.preventDefault();
			}
		}));

		// Focus Mode
		const updateFocusMode = () => viewCell.focusMode = templateData.editor.hasWidgetFocus() ? CellFocusMode.Editor : CellFocusMode.Container;
		this._register(templateData.editor.onDidFocusEditorWidget(() => {
			updateFocusMode();
		}));
		this._register(templateData.editor.onDidBlurEditorWidget(() => {
			// this is for a special case:
			// users click the status bar empty space, which we will then focus the editor
			// so we don't want to update the focus state too eagerly
			if (document.activeElement?.contains(this.templateData.container)) {
				setTimeout(() => {
					updateFocusMode();
				}, 300);
			} else {
				updateFocusMode();
			}
		}));
		updateFocusMode();

		// Render Outputs
		this._outputContainerRenderer = new OutputContainer(notebookEditor, viewCell, templateData, notebookService, quickInputService, openerService, textFileService);
		this._outputContainerRenderer.render(editorHeight);
		// Need to do this after the intial renderOutput
		updateForCollapseState();

		const updatePlaceholder = () => {
			if (this.notebookEditor.viewModel
				&& this.notebookEditor.getActiveCell() === this.viewCell
				&& viewCell.getEvaluatedMetadata(this.notebookEditor.viewModel.metadata).runnable
				&& viewCell.metadata.runState === undefined
				&& viewCell.metadata.lastRunDuration === undefined
			) {
				// active cell and no run status
				if (this._activeCellRunPlaceholder === null) {
					// const keybinding = this._keybindingService.lookupKeybinding(EXECUTE_CELL_COMMAND_ID);
					this._activeCellRunPlaceholder = this.notebookCellStatusBarService.addEntry(getExecuteCellPlaceholder(this.viewCell));
				}

				return;
			}

			this._activeCellRunPlaceholder?.dispose();
			this._activeCellRunPlaceholder = null;
		};

		this._register(this.notebookEditor.onDidChangeActiveCell(() => {
			updatePlaceholder();
		}));

		this._register(this.viewCell.model.onDidChangeMetadata(() => {
			updatePlaceholder();
		}));

		// const updateUntrustedStatus = () => {
		// 	if (this.notebookEditor.viewModel
		// 		&& this.notebookEditor.viewModel.metadata.trusted) {
		// 		this._untrustedStatusItem?.dispose();
		// 		this._untrustedStatusItem = null;
		// 	} else {
		// 		if (this._untrustedStatusItem === null) {
		// 			this._untrustedStatusItem = this.notebookCellStatusBarService.addEntry({
		// 				alignment: CellStatusbarAlignment.LEFT,
		// 				priority: -1,
		// 				cellResource: viewCell.uri,
		// 				command: TRUST_NOTEBOOK_COMMAND_ID,
		// 				text: 'Untrusted',
		// 				tooltip: 'Untrusted notebook',
		// 				visible: true,
		// 			});
		// 		}
		// 	}
		// };

		this._register(this.notebookEditor.viewModel.notebookDocument.onDidChangeContent(e => {
			if (e.rawEvents.find(event => event.kind === NotebookCellsChangeType.ChangeDocumentMetadata)) {
				updatePlaceholder();
				// updateUntrustedStatus();
			}
		}));

		updatePlaceholder();
		// updateUntrustedStatus();
	}

	private viewUpdate(): void {
		if (this.viewCell.metadata?.inputCollapsed && this.viewCell.metadata.outputCollapsed) {
			this.viewUpdateAllCollapsed();
		} else if (this.viewCell.metadata?.inputCollapsed) {
			this.viewUpdateInputCollapsed();
		} else if (this.viewCell.metadata?.outputCollapsed && this.viewCell.outputs.length) {
			this.viewUpdateOutputCollapsed();
		} else {
			this.viewUpdateExpanded();
		}
	}

	private viewUpdateInputCollapsed(): void {
		DOM.hide(this.templateData.cellContainer);
		DOM.hide(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.show(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', true);
		this._outputContainerRenderer.viewUpdateShowOutputs();

		this.relayoutCell();
	}

	private viewUpdateOutputCollapsed(): void {
		DOM.show(this.templateData.cellContainer);
		DOM.show(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.hide(this.templateData.outputContainer);

		this._outputContainerRenderer.viewUpdateHideOuputs();

		this.templateData.container.classList.toggle('collapsed', false);
		this.templateData.container.classList.toggle('output-collapsed', true);

		this.relayoutCell();
	}

	private viewUpdateAllCollapsed(): void {
		DOM.hide(this.templateData.cellContainer);
		DOM.hide(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.hide(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', true);
		this.templateData.container.classList.toggle('output-collapsed', true);
		this._outputContainerRenderer.viewUpdateHideOuputs();
		this.relayoutCell();
	}

	private viewUpdateExpanded(): void {
		DOM.show(this.templateData.cellContainer);
		DOM.show(this.templateData.runButtonContainer);
		DOM.hide(this.templateData.collapsedPart);
		DOM.show(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', false);
		this.templateData.container.classList.toggle('output-collapsed', false);
		this._outputContainerRenderer.viewUpdateShowOutputs();
		this.relayoutCell();
	}

	private layoutEditor(dimension: IDimension): void {
		this.templateData.editor?.layout(dimension);
		this.templateData.statusBar.layout(dimension.width);
	}

	private onCellWidthChange(): void {
		const realContentHeight = this.templateData.editor.getContentHeight();
		this.viewCell.editorHeight = realContentHeight;
		this.relayoutCell();

		this.layoutEditor(
			{
				width: this.viewCell.layoutInfo.editorWidth,
				height: realContentHeight
			}
		);

		// for contents for which we don't observe for dynamic height, update them manually
		this._outputContainerRenderer.onCellWidthChange();
	}

	private onCellHeightChange(newHeight: number): void {
		const viewLayout = this.templateData.editor.getLayoutInfo();
		this.viewCell.editorHeight = newHeight;
		this.relayoutCell();
		this.layoutEditor(
			{
				width: viewLayout.width,
				height: newHeight
			}
		);
	}

	relayoutCell() {
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	private _timer: number | null = null;

	relayoutCellDebounced() {
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this._timer = setTimeout(() => {
			this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
			this._timer = null;
		}, 200) as unknown as number | null;
	}

	dispose() {
		this.viewCell.detachTextEditor();
		this._outputContainerRenderer.dispose();
		this._activeCellRunPlaceholder?.dispose();
		this._untrustedStatusItem?.dispose();
		this.templateData.focusIndicatorLeft.style.height = 'initial';

		super.dispose();
	}
}
