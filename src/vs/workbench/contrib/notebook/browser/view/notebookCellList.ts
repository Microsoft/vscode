/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IListRenderer, IListVirtualDelegate, ListError } from 'vs/base/browser/ui/list/list';
import { Event } from 'vs/base/common/event';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IListService, IWorkbenchListOptions, WorkbenchList } from 'vs/platform/list/browser/listService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { isMacintosh } from 'vs/base/common/platform';
import { NOTEBOOK_EDITOR_CURSOR_BOUNDARY } from 'vs/workbench/services/notebook/common/notebookCommon';
import { Range } from 'vs/editor/common/core/range';
import { CellRevealType, CellRevealPosition, CursorAtBoundary } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IStyleController, IListStyles } from 'vs/base/browser/ui/list/listWidget';

export class NotebookCellList extends WorkbenchList<CellViewModel> implements IDisposable, IStyleController {
	get onWillScroll(): Event<ScrollEvent> { return this.view.onWillScroll; }

	get rowsContainer(): HTMLElement {
		return this.view.containerDomNode;
	}
	private _previousSelectedElements: CellViewModel[] = [];
	private _localDisposableStore = new DisposableStore();
	private styleElement?: HTMLStyleElement;
	constructor(
		private listUser: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<CellViewModel>,
		renderers: IListRenderer<CellViewModel, any>[],
		contextKeyService: IContextKeyService,
		options: IWorkbenchListOptions<CellViewModel>,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService

	) {
		super(listUser, container, delegate, renderers, options, contextKeyService, listService, themeService, configurationService, keybindingService);

		this._previousSelectedElements = this.getSelectedElements();
		this._localDisposableStore.add(this.onDidChangeSelection((e) => {
			this._previousSelectedElements.forEach(element => {
				if (e.elements.indexOf(element) < 0) {
					element.onDeselect();
				}
			});
			this._previousSelectedElements = e.elements;
		}));

		const notebookEditorCursorAtBoundaryContext = NOTEBOOK_EDITOR_CURSOR_BOUNDARY.bindTo(contextKeyService);
		notebookEditorCursorAtBoundaryContext.set('none');

		let cursorSelectionListener: IDisposable | null = null;
		let textEditorAttachListener: IDisposable | null = null;

		const recomputeContext = (element: CellViewModel) => {
			switch (element.cursorAtBoundary()) {
				case CursorAtBoundary.Both:
					notebookEditorCursorAtBoundaryContext.set('both');
					break;
				case CursorAtBoundary.Top:
					notebookEditorCursorAtBoundaryContext.set('top');
					break;
				case CursorAtBoundary.Bottom:
					notebookEditorCursorAtBoundaryContext.set('bottom');
					break;
				default:
					notebookEditorCursorAtBoundaryContext.set('none');
					break;
			}
			return;
		};

		// Cursor Boundary context
		this._localDisposableStore.add(this.onDidChangeSelection((e) => {
			if (e.elements.length) {
				cursorSelectionListener?.dispose();
				textEditorAttachListener?.dispose();
				// we only validate the first focused element
				const focusedElement = e.elements[0];

				cursorSelectionListener = focusedElement.onDidChangeCursorSelection(() => {
					recomputeContext(focusedElement);
				});

				textEditorAttachListener = focusedElement.onDidChangeEditorAttachState(() => {
					if (focusedElement.editorAttached) {
						recomputeContext(focusedElement);
					}
				});

				recomputeContext(focusedElement);
				return;
			}

			// reset context
			notebookEditorCursorAtBoundaryContext.set('none');
		}));

	}

	domElementAtIndex(index: number): HTMLElement | null {
		return this.view.domElement(index);
	}

	focusView() {
		this.view.domNode.focus();
	}

	getAbsoluteTop(index: number): number {
		if (index < 0 || index >= this.length) {
			throw new ListError(this.listUser, `Invalid index ${index}`);
		}

		return this.view.elementTop(index);
	}

	triggerScrollFromMouseWheelEvent(browserEvent: IMouseWheelEvent) {
		this.view.triggerScrollFromMouseWheelEvent(browserEvent);
	}

	updateElementHeight(index: number, size: number): void {
		const focused = this.getSelection();
		this.view.updateElementHeight(index, size, focused.length ? focused[0] : null);
		// this.view.updateElementHeight(index, size, null);
	}

	// override
	domFocus() {
		if (document.activeElement && this.view.domNode.contains(document.activeElement)) {
			// for example, when focus goes into monaco editor, if we refocus the list view, the editor will lose focus.
			return;
		}

		if (!isMacintosh && document.activeElement && isContextMenuFocused()) {
			return;
		}

		super.domFocus();
	}

	private _revealRange(index: number, range: Range, revealType: CellRevealType, newlyCreated: boolean, alignToBottom: boolean) {
		const element = this.view.element(index);
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const startLineNumber = range.startLineNumber;
		const lineOffset = element.getLineScrollTopOffset(startLineNumber);
		const elementTop = this.view.elementTop(index);
		const lineTop = elementTop + lineOffset;

		// TODO@rebornix 30 ---> line height * 1.5
		if (lineTop < scrollTop) {
			this.view.setScrollTop(lineTop - 30);
		} else if (lineTop > wrapperBottom) {
			this.view.setScrollTop(scrollTop + lineTop - wrapperBottom + 30);
		} else if (newlyCreated) {
			// newly scrolled into view
			if (alignToBottom) {
				// align to the bottom
				this.view.setScrollTop(scrollTop + lineTop - wrapperBottom + 30);
			} else {
				// align to to top
				this.view.setScrollTop(lineTop - 30);
			}
		}

		if (revealType === CellRevealType.Range) {
			element.revealRangeInCenter(range);
		}
	}

	// TODO@rebornix TEST & Fix potential bugs
	// List items have real dynamic heights, which means after we set `scrollTop` based on the `elementTop(index)`, the element at `index` might still be removed from the view once all relayouting tasks are done.
	// For example, we scroll item 10 into the view upwards, in the first round, items 7, 8, 9, 10 are all in the viewport. Then item 7 and 8 resize themselves to be larger and finally item 10 is removed from the view.
	// To ensure that item 10 is always there, we need to scroll item 10 to the top edge of the viewport.
	private _revealRangeInternal(index: number, range: Range, revealType: CellRevealType) {
		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);
		const element = this.view.element(index);

		if (element.editorAttached) {
			this._revealRange(index, range, revealType, false, false);
		} else {
			const elementHeight = this.view.elementHeight(index);
			let upwards = false;

			if (elementTop + elementHeight < scrollTop) {
				// scroll downwards
				this.view.setScrollTop(elementTop);
				upwards = false;
			} else if (elementTop > wrapperBottom) {
				// scroll upwards
				this.view.setScrollTop(elementTop - this.view.renderHeight / 2);
				upwards = true;
			}

			const editorAttachedPromise = new Promise((resolve, reject) => {
				element.onDidChangeEditorAttachState(state => state ? resolve() : reject());
			});

			editorAttachedPromise.then(() => {
				this._revealRange(index, range, revealType, true, upwards);
			});
		}
	}

	revealLineInView(index: number, line: number) {
		this._revealRangeInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInView(index: number, range: Range): void {
		this._revealRangeInternal(index, range, CellRevealType.Range);
	}

	private _revealRangeInCenterInternal(index: number, range: Range, revealType: CellRevealType) {
		const reveal = (index: number, range: Range, revealType: CellRevealType) => {
			const element = this.view.element(index);
			let lineOffset = element.getLineScrollTopOffset(range.startLineNumber);
			let lineOffsetInView = this.view.elementTop(index) + lineOffset;
			this.view.setScrollTop(lineOffsetInView - this.view.renderHeight / 2);

			if (revealType === CellRevealType.Range) {
				element.revealRangeInCenter(range);
			}
		};

		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop;
		this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);
		const element = this.view.element(index);

		if (!element.editorAttached) {
			getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
		} else {
			reveal(index, range, revealType);
		}
	}

	revealLineInCenter(index: number, line: number) {
		this._revealRangeInCenterInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInCenter(index: number, range: Range): void {
		this._revealRangeInCenterInternal(index, range, CellRevealType.Range);
	}

	private _revealRangeInCenterIfOutsideViewportInternal(index: number, range: Range, revealType: CellRevealType) {
		const reveal = (index: number, range: Range, revealType: CellRevealType) => {
			const element = this.view.element(index);
			let lineOffset = element.getLineScrollTopOffset(range.startLineNumber);
			let lineOffsetInView = this.view.elementTop(index) + lineOffset;
			this.view.setScrollTop(lineOffsetInView - this.view.renderHeight / 2);

			if (revealType === CellRevealType.Range) {
				setTimeout(() => {
					element.revealRangeInCenter(range);
				}, 240);
			}
		};

		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);
		const viewItemOffset = elementTop;
		const element = this.view.element(index);

		if (viewItemOffset < scrollTop || viewItemOffset > wrapperBottom) {
			// let it render
			this.view.setScrollTop(viewItemOffset - this.view.renderHeight / 2);

			// after rendering, it might be pushed down due to markdown cell dynamic height
			const elementTop = this.view.elementTop(index);
			this.view.setScrollTop(elementTop - this.view.renderHeight / 2);

			// reveal editor
			if (!element.editorAttached) {
				getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
			} else {
				// for example markdown
			}
		} else {
			if (element.editorAttached) {
				element.revealRangeInCenter(range);
			} else {
				// for example, markdown cell in preview mode
				getEditorAttachedPromise(element).then(() => reveal(index, range, revealType));
			}
		}
	}

	revealLineInCenterIfOutsideViewport(index: number, line: number) {
		this._revealRangeInCenterIfOutsideViewportInternal(index, new Range(line, 1, line, 1), CellRevealType.Line);
	}

	revealRangeInCenterIfOutsideViewport(index: number, range: Range): void {
		this._revealRangeInCenterIfOutsideViewportInternal(index, range, CellRevealType.Range);
	}

	private _revealInternal(index: number, ignoreIfInsideViewport: boolean, revealPosition: CellRevealPosition) {
		if (index >= this.view.length) {
			return;
		}

		const scrollTop = this.view.getScrollTop();
		const wrapperBottom = scrollTop + this.view.renderHeight;
		const elementTop = this.view.elementTop(index);

		if (ignoreIfInsideViewport && elementTop >= scrollTop && elementTop < wrapperBottom) {
			// inside the viewport
			return;
		}

		// first render
		const viewItemOffset = revealPosition === CellRevealPosition.Top ? elementTop : (elementTop - this.view.renderHeight / 2);
		this.view.setScrollTop(viewItemOffset);

		// second scroll as markdown cell is dynamic
		const newElementTop = this.view.elementTop(index);
		const newViewItemOffset = revealPosition === CellRevealPosition.Top ? newElementTop : (newElementTop - this.view.renderHeight / 2);
		this.view.setScrollTop(newViewItemOffset);
	}

	revealInView(index: number) {
		this._revealInternal(index, true, CellRevealPosition.Top);
	}

	revealInCenter(index: number) {
		this._revealInternal(index, false, CellRevealPosition.Center);
	}

	revealInCenterIfOutsideViewport(index: number) {
		this._revealInternal(index, true, CellRevealPosition.Center);
	}

	setCellSelection(index: number, range: Range) {
		const element = this.view.element(index);
		if (element.editorAttached) {
			element.setSelection(range);
		} else {
			getEditorAttachedPromise(element).then(() => { element.setSelection(range); });
		}
	}


	style(styles: IListStyles) {
		const selectorSuffix = this.view.domId;
		if (!this.styleElement) {
			this.styleElement = DOM.createStyleSheet(this.view.domNode);
		}
		const suffix = selectorSuffix && `.${selectorSuffix}`;
		const content: string[] = [];

		if (styles.listBackground) {
			if (styles.listBackground.isOpaque()) {
				content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows { background: ${styles.listBackground}; }`);
			} else if (!isMacintosh) { // subpixel AA doesn't exist in macOS
				console.warn(`List with id '${selectorSuffix}' was styled with a non-opaque background color. This will break sub-pixel antialiasing.`);
			}
		}

		if (styles.listFocusBackground) {
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused { background-color: ${styles.listFocusBackground}; }`);
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused:hover { background-color: ${styles.listFocusBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listFocusForeground) {
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused { color: ${styles.listFocusForeground}; }`);
		}

		if (styles.listActiveSelectionBackground) {
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected { background-color: ${styles.listActiveSelectionBackground}; }`);
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected:hover { background-color: ${styles.listActiveSelectionBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listActiveSelectionForeground) {
			content.push(`.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected { color: ${styles.listActiveSelectionForeground}; }`);
		}

		if (styles.listFocusAndSelectionBackground) {
			content.push(`
				.monaco-drag-image,
				.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected.focused { background-color: ${styles.listFocusAndSelectionBackground}; }
			`);
		}

		if (styles.listFocusAndSelectionForeground) {
			content.push(`
				.monaco-drag-image,
				.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected.focused { color: ${styles.listFocusAndSelectionForeground}; }
			`);
		}

		if (styles.listInactiveFocusBackground) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused { background-color:  ${styles.listInactiveFocusBackground}; }`);
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused:hover { background-color:  ${styles.listInactiveFocusBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listInactiveSelectionBackground) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected { background-color:  ${styles.listInactiveSelectionBackground}; }`);
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected:hover { background-color:  ${styles.listInactiveSelectionBackground}; }`); // overwrite :hover style in this case!
		}

		if (styles.listInactiveSelectionForeground) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected { color: ${styles.listInactiveSelectionForeground}; }`);
		}

		if (styles.listHoverBackground) {
			content.push(`.monaco-list${suffix}:not(.drop-target) > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row:hover:not(.selected):not(.focused) { background-color:  ${styles.listHoverBackground}; }`);
		}

		if (styles.listHoverForeground) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row:hover:not(.selected):not(.focused) { color:  ${styles.listHoverForeground}; }`);
		}

		if (styles.listSelectionOutline) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.selected { outline: 1px dotted ${styles.listSelectionOutline}; outline-offset: -1px; }`);
		}

		if (styles.listFocusOutline) {
			content.push(`
				.monaco-drag-image,
				.monaco-list${suffix}:focus > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused { outline: 1px solid ${styles.listFocusOutline}; outline-offset: -1px; }
			`);
		}

		if (styles.listInactiveFocusOutline) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row.focused { outline: 1px dotted ${styles.listInactiveFocusOutline}; outline-offset: -1px; }`);
		}

		if (styles.listHoverOutline) {
			content.push(`.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows > .monaco-list-row:hover { outline: 1px dashed ${styles.listHoverOutline}; outline-offset: -1px; }`);
		}

		if (styles.listDropBackground) {
			content.push(`
				.monaco-list${suffix}.drop-target,
				.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-rows.drop-target,
				.monaco-list${suffix} > div.monaco-scrollable-element > .monaco-list-row.drop-target { background-color: ${styles.listDropBackground} !important; color: inherit !important; }
			`);
		}

		if (styles.listFilterWidgetBackground) {
			content.push(`.monaco-list-type-filter { background-color: ${styles.listFilterWidgetBackground} }`);
		}

		if (styles.listFilterWidgetOutline) {
			content.push(`.monaco-list-type-filter { border: 1px solid ${styles.listFilterWidgetOutline}; }`);
		}

		if (styles.listFilterWidgetNoMatchesOutline) {
			content.push(`.monaco-list-type-filter.no-matches { border: 1px solid ${styles.listFilterWidgetNoMatchesOutline}; }`);
		}

		if (styles.listMatchesShadow) {
			content.push(`.monaco-list-type-filter { box-shadow: 1px 1px 1px ${styles.listMatchesShadow}; }`);
		}

		const newStyles = content.join('\n');
		if (newStyles !== this.styleElement.innerHTML) {
			this.styleElement.innerHTML = newStyles;
		}
	}

	dispose() {
		this._localDisposableStore.dispose();
		super.dispose();
	}
}

function getEditorAttachedPromise(element: CellViewModel) {
	return new Promise((resolve, reject) => {
		Event.once(element.onDidChangeEditorAttachState)(state => state ? resolve() : reject());
	});
}

function isContextMenuFocused() {
	return !!DOM.findParentWithClass(<HTMLElement>document.activeElement, 'context-view');
}
