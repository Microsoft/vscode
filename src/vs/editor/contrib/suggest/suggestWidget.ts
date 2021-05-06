/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/suggest';
import 'vs/base/browser/ui/codicons/codiconStyles'; // The codicon symbol styles are defined here and must be loaded
import 'vs/editor/contrib/symbolIcons/symbolIcons'; // The codicon symbol colors are defined here and must be loaded to get colors
import * as nls from 'vs/nls';
import * as strings from 'vs/base/common/strings';
import * as dom from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IListEvent, IListMouseEvent, IListGestureEvent } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { Context as SuggestContext, CompletionItem } from './suggest';
import { CompletionModel } from './completionModel';
import { attachListStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, IColorTheme, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { registerColor, editorWidgetBackground, quickInputListFocusBackground, activeContrastBorder, listHighlightForeground, editorForeground, editorWidgetBorder, focusBorder, textLinkForeground, textCodeBlockBackground, quickInputListFocusForeground, listFocusHighlightForeground } from 'vs/platform/theme/common/colorRegistry';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { TimeoutTimer, CancelablePromise, createCancelablePromise, disposableTimeout } from 'vs/base/common/async';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { SuggestDetailsWidget, canExpandCompletionItem, SuggestDetailsOverlay } from './suggestWidgetDetails';
import { SuggestWidgetStatus } from 'vs/editor/contrib/suggest/suggestWidgetStatus';
import { getAriaId, ItemRenderer } from './suggestWidgetRenderer';
import { ResizableHTMLElement } from './resizable';
import { EmbeddedCodeEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { IPosition } from 'vs/editor/common/core/position';
import { clamp } from 'vs/base/common/numbers';

/**
 * Suggest widget colors
 */
export const editorSuggestWidgetBackground = registerColor('editorSuggestWidget.background', { dark: editorWidgetBackground, light: editorWidgetBackground, hc: editorWidgetBackground }, nls.localize('editorSuggestWidgetBackground', 'Background color of the suggest widget.'));
export const editorSuggestWidgetBorder = registerColor('editorSuggestWidget.border', { dark: editorWidgetBorder, light: editorWidgetBorder, hc: editorWidgetBorder }, nls.localize('editorSuggestWidgetBorder', 'Border color of the suggest widget.'));
export const editorSuggestWidgetForeground = registerColor('editorSuggestWidget.foreground', { dark: editorForeground, light: editorForeground, hc: editorForeground }, nls.localize('editorSuggestWidgetForeground', 'Foreground color of the suggest widget.'));
export const editorSuggestWidgetSelectedForeground = registerColor('editorSuggestWidget.selectedForeground', { dark: quickInputListFocusForeground, light: quickInputListFocusForeground, hc: quickInputListFocusForeground }, nls.localize('editorSuggestWidgetSelectedForeground', 'Foreground color of the selected entry in the suggest widget.'));
export const editorSuggestWidgetSelectedBackground = registerColor('editorSuggestWidget.selectedBackground', { dark: quickInputListFocusBackground, light: quickInputListFocusBackground, hc: quickInputListFocusBackground }, nls.localize('editorSuggestWidgetSelectedBackground', 'Background color of the selected entry in the suggest widget.'));
export const editorSuggestWidgetHighlightForeground = registerColor('editorSuggestWidget.highlightForeground', { dark: listHighlightForeground, light: listHighlightForeground, hc: listHighlightForeground }, nls.localize('editorSuggestWidgetHighlightForeground', 'Color of the match highlights in the suggest widget.'));
export const editorSuggestWidgetHighlightFocusForeground = registerColor('editorSuggestWidget.focusHighlightForeground', { dark: listFocusHighlightForeground, light: listFocusHighlightForeground, hc: listFocusHighlightForeground }, nls.localize('editorSuggestWidgetFocusHighlightForeground', 'Color of the match highlights in the suggest widget when an item is focused.'));

const enum State {
	Hidden,
	Loading,
	Empty,
	Open,
	Frozen,
	Details
}

export interface ISelectedSuggestion {
	item: CompletionItem;
	index: number;
	model: CompletionModel;
}

class PersistedWidgetSize {

	private readonly _key: string;

	constructor(
		private readonly _service: IStorageService,
		editor: ICodeEditor
	) {
		this._key = `suggestWidget.size/${editor.getEditorType()}/${editor instanceof EmbeddedCodeEditorWidget}`;
	}

	restore(): dom.Dimension | undefined {
		const raw = this._service.get(this._key, StorageScope.GLOBAL) ?? '';
		try {
			const obj = JSON.parse(raw);
			if (dom.Dimension.is(obj)) {
				return dom.Dimension.lift(obj);
			}
		} catch {
			// ignore
		}
		return undefined;
	}

	store(size: dom.Dimension) {
		this._service.store(this._key, JSON.stringify(size), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	reset(): void {
		this._service.remove(this._key, StorageScope.GLOBAL);
	}
}

export class SuggestWidget implements IDisposable {

	private static LOADING_MESSAGE: string = nls.localize('suggestWidget.loading', "Loading...");
	private static NO_SUGGESTIONS_MESSAGE: string = nls.localize('suggestWidget.noSuggestions', "No suggestions.");

	private _state: State = State.Hidden;
	private _isAuto: boolean = false;
	private _loadingTimeout?: IDisposable;
	private _currentSuggestionDetails?: CancelablePromise<void>;
	private _focusedItem?: CompletionItem;
	private _ignoreFocusEvents: boolean = false;
	private _completionModel?: CompletionModel;
	private _cappedHeight?: { wanted: number; capped: number; };
	private _explainMode: boolean = false;

	readonly element: ResizableHTMLElement;
	private readonly _messageElement: HTMLElement;
	private readonly _listElement: HTMLElement;
	private readonly _list: List<CompletionItem>;
	private readonly _status: SuggestWidgetStatus;
	private readonly _details: SuggestDetailsOverlay;
	private readonly _contentWidget: SuggestContentWidget;
	private readonly _persistedSize: PersistedWidgetSize;

	private readonly _ctxSuggestWidgetVisible: IContextKey<boolean>;
	private readonly _ctxSuggestWidgetDetailsVisible: IContextKey<boolean>;
	private readonly _ctxSuggestWidgetMultipleSuggestions: IContextKey<boolean>;

	private readonly _showTimeout = new TimeoutTimer();
	private readonly _disposables = new DisposableStore();


	private readonly _onDidSelect = new Emitter<ISelectedSuggestion>();
	private readonly _onDidFocus = new Emitter<ISelectedSuggestion>();
	private readonly _onDidHide = new Emitter<this>();
	private readonly _onDidShow = new Emitter<this>();

	readonly onDidSelect: Event<ISelectedSuggestion> = this._onDidSelect.event;
	readonly onDidFocus: Event<ISelectedSuggestion> = this._onDidFocus.event;
	readonly onDidHide: Event<this> = this._onDidHide.event;
	readonly onDidShow: Event<this> = this._onDidShow.event;

	private readonly _onDetailsKeydown = new Emitter<IKeyboardEvent>();
	readonly onDetailsKeyDown: Event<IKeyboardEvent> = this._onDetailsKeydown.event;

	private _detailsFocusBorderColor?: string;
	private _detailsBorderColor?: string;

	constructor(
		private readonly editor: ICodeEditor,
		@IStorageService private readonly _storageService: IStorageService,
		@IContextKeyService _contextKeyService: IContextKeyService,
		@IThemeService _themeService: IThemeService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this.element = new ResizableHTMLElement();
		this.element.domNode.classList.add('editor-widget', 'suggest-widget');

		this._contentWidget = new SuggestContentWidget(this, editor);
		this._persistedSize = new PersistedWidgetSize(_storageService, editor);

		class ResizeState {
			constructor(
				readonly persistedSize: dom.Dimension | undefined,
				readonly currentSize: dom.Dimension,
				public persistHeight = false,
				public persistWidth = false,
			) { }
		}

		let state: ResizeState | undefined;
		this._disposables.add(this.element.onDidWillResize(() => {
			this._contentWidget.lockPreference();
			state = new ResizeState(this._persistedSize.restore(), this.element.size);
		}));
		this._disposables.add(this.element.onDidResize(e => {

			this._resize(e.dimension.width, e.dimension.height);

			if (state) {
				state.persistHeight = state.persistHeight || !!e.north || !!e.south;
				state.persistWidth = state.persistWidth || !!e.east || !!e.west;
			}

			if (!e.done) {
				return;
			}

			if (state) {
				// only store width or height value that have changed and also
				// only store changes that are above a certain threshold
				const { itemHeight, defaultSize } = this.getLayoutInfo();
				const threshold = Math.round(itemHeight / 2);
				let { width, height } = this.element.size;
				if (!state.persistHeight || Math.abs(state.currentSize.height - height) <= threshold) {
					height = state.persistedSize?.height ?? defaultSize.height;
				}
				if (!state.persistWidth || Math.abs(state.currentSize.width - width) <= threshold) {
					width = state.persistedSize?.width ?? defaultSize.width;
				}
				this._persistedSize.store(new dom.Dimension(width, height));
			}

			// reset working state
			this._contentWidget.unlockPreference();
			state = undefined;
		}));

		this._messageElement = dom.append(this.element.domNode, dom.$('.message'));
		this._listElement = dom.append(this.element.domNode, dom.$('.tree'));

		const details = instantiationService.createInstance(SuggestDetailsWidget, this.editor);
		details.onDidClose(this.toggleDetails, this, this._disposables);
		this._details = new SuggestDetailsOverlay(details, this.editor);

		const applyIconStyle = () => this.element.domNode.classList.toggle('no-icons', !this.editor.getOption(EditorOption.suggest).showIcons);
		applyIconStyle();

		const renderer = instantiationService.createInstance(ItemRenderer, this.editor);
		this._disposables.add(renderer);
		this._disposables.add(renderer.onDidToggleDetails(() => this.toggleDetails()));

		this._list = new List('SuggestWidget', this._listElement, {
			getHeight: (_element: CompletionItem): number => this.getLayoutInfo().itemHeight,
			getTemplateId: (_element: CompletionItem): string => 'suggestion'
		}, [renderer], {
			alwaysConsumeMouseWheel: true,
			useShadows: false,
			mouseSupport: false,
			accessibilityProvider: {
				getRole: () => 'option',
				getAriaLabel: (item: CompletionItem) => {
					if (item.isResolved && this._isDetailsVisible()) {
						const { documentation, detail } = item.completion;
						const docs = strings.format(
							'{0}{1}',
							detail || '',
							documentation ? (typeof documentation === 'string' ? documentation : documentation.value) : '');

						return nls.localize('ariaCurrenttSuggestionReadDetails', "{0}, docs: {1}", item.textLabel, docs);
					} else {
						return item.textLabel;
					}
				},
				getWidgetAriaLabel: () => nls.localize('suggest', "Suggest"),
				getWidgetRole: () => 'listbox'
			}
		});

		this._status = instantiationService.createInstance(SuggestWidgetStatus, this.element.domNode);
		const applyStatusBarStyle = () => this.element.domNode.classList.toggle('with-status-bar', this.editor.getOption(EditorOption.suggest).showStatusBar);
		applyStatusBarStyle();

		this._disposables.add(attachListStyler(this._list, _themeService, {
			listInactiveFocusBackground: editorSuggestWidgetSelectedBackground,
			listInactiveFocusOutline: activeContrastBorder
		}));
		this._disposables.add(_themeService.onDidColorThemeChange(t => this._onThemeChange(t)));
		this._onThemeChange(_themeService.getColorTheme());

		this._disposables.add(this._list.onMouseDown(e => this._onListMouseDownOrTap(e)));
		this._disposables.add(this._list.onTap(e => this._onListMouseDownOrTap(e)));
		this._disposables.add(this._list.onDidChangeSelection(e => this._onListSelection(e)));
		this._disposables.add(this._list.onDidChangeFocus(e => this._onListFocus(e)));
		this._disposables.add(this.editor.onDidChangeCursorSelection(() => this._onCursorSelectionChanged()));
		this._disposables.add(this.editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.suggest)) {
				applyStatusBarStyle();
				applyIconStyle();
			}
		}));

		this._ctxSuggestWidgetVisible = SuggestContext.Visible.bindTo(_contextKeyService);
		this._ctxSuggestWidgetDetailsVisible = SuggestContext.DetailsVisible.bindTo(_contextKeyService);
		this._ctxSuggestWidgetMultipleSuggestions = SuggestContext.MultipleSuggestions.bindTo(_contextKeyService);


		this._disposables.add(dom.addStandardDisposableListener(this._details.widget.domNode, 'keydown', e => {
			this._onDetailsKeydown.fire(e);
		}));

		this._disposables.add(this.editor.onMouseDown((e: IEditorMouseEvent) => this._onEditorMouseDown(e)));
	}

	dispose(): void {
		this._details.widget.dispose();
		this._details.dispose();
		this._list.dispose();
		this._status.dispose();
		this._disposables.dispose();
		this._loadingTimeout?.dispose();
		this._showTimeout.dispose();
		this._contentWidget.dispose();
		this.element.dispose();
	}

	private _onEditorMouseDown(mouseEvent: IEditorMouseEvent): void {
		if (this._details.widget.domNode.contains(mouseEvent.target.element)) {
			// Clicking inside details
			this._details.widget.domNode.focus();
		} else {
			// Clicking outside details and inside suggest
			if (this.element.domNode.contains(mouseEvent.target.element)) {
				this.editor.focus();
			}
		}
	}

	private _onCursorSelectionChanged(): void {
		if (this._state !== State.Hidden) {
			this._contentWidget.layout();
		}
	}

	private _onListMouseDownOrTap(e: IListMouseEvent<CompletionItem> | IListGestureEvent<CompletionItem>): void {
		if (typeof e.element === 'undefined' || typeof e.index === 'undefined') {
			return;
		}

		// prevent stealing browser focus from the editor
		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		this._select(e.element, e.index);
	}

	private _onListSelection(e: IListEvent<CompletionItem>): void {
		if (e.elements.length) {
			this._select(e.elements[0], e.indexes[0]);
		}
	}

	private _select(item: CompletionItem, index: number): void {
		const completionModel = this._completionModel;
		if (completionModel) {
			this._onDidSelect.fire({ item, index, model: completionModel });
			this.editor.focus();
		}
	}

	private _onThemeChange(theme: IColorTheme) {
		const backgroundColor = theme.getColor(editorSuggestWidgetBackground);
		if (backgroundColor) {
			this.element.domNode.style.backgroundColor = backgroundColor.toString();
			this._messageElement.style.backgroundColor = backgroundColor.toString();
			this._details.widget.domNode.style.backgroundColor = backgroundColor.toString();
		}
		const borderColor = theme.getColor(editorSuggestWidgetBorder);
		if (borderColor) {
			this.element.domNode.style.borderColor = borderColor.toString();
			this._messageElement.style.borderColor = borderColor.toString();
			this._status.element.style.borderTopColor = borderColor.toString();
			this._details.widget.domNode.style.borderColor = borderColor.toString();
			this._detailsBorderColor = borderColor.toString();
		}
		const focusBorderColor = theme.getColor(focusBorder);
		if (focusBorderColor) {
			this._detailsFocusBorderColor = focusBorderColor.toString();
		}
		this._details.widget.borderWidth = theme.type === 'hc' ? 2 : 1;
	}

	private _onListFocus(e: IListEvent<CompletionItem>): void {
		if (this._ignoreFocusEvents) {
			return;
		}

		if (!e.elements.length) {
			if (this._currentSuggestionDetails) {
				this._currentSuggestionDetails.cancel();
				this._currentSuggestionDetails = undefined;
				this._focusedItem = undefined;
			}

			this.editor.setAriaOptions({ activeDescendant: undefined });
			return;
		}

		if (!this._completionModel) {
			return;
		}

		const item = e.elements[0];
		const index = e.indexes[0];

		if (item !== this._focusedItem) {

			this._currentSuggestionDetails?.cancel();
			this._currentSuggestionDetails = undefined;

			this._focusedItem = item;

			this._list.reveal(index);

			this._currentSuggestionDetails = createCancelablePromise(async token => {
				const loading = disposableTimeout(() => {
					if (this._isDetailsVisible()) {
						this.showDetails(true);
					}
				}, 250);
				token.onCancellationRequested(() => loading.dispose());
				const result = await item.resolve(token);
				loading.dispose();
				return result;
			});

			this._currentSuggestionDetails.then(() => {
				if (index >= this._list.length || item !== this._list.element(index)) {
					return;
				}

				// item can have extra information, so re-render
				this._ignoreFocusEvents = true;
				this._list.splice(index, 1, [item]);
				this._list.setFocus([index]);
				this._ignoreFocusEvents = false;

				if (this._isDetailsVisible()) {
					this.showDetails(false);
				} else {
					this.element.domNode.classList.remove('docs-side');
				}

				this.editor.setAriaOptions({ activeDescendant: getAriaId(index) });
			}).catch(onUnexpectedError);
		}

		// emit an event
		this._onDidFocus.fire({ item, index, model: this._completionModel });
	}

	private _setState(state: State): void {

		if (this._state === state) {
			return;
		}
		this._state = state;

		this.element.domNode.classList.toggle('frozen', state === State.Frozen);
		this.element.domNode.classList.remove('message');

		switch (state) {
			case State.Hidden:
				dom.hide(this._messageElement, this._listElement, this._status.element);
				this._details.hide(true);
				this._status.hide();
				this._contentWidget.hide();
				this._ctxSuggestWidgetVisible.reset();
				this._ctxSuggestWidgetMultipleSuggestions.reset();
				this._showTimeout.cancel();
				this.element.domNode.classList.remove('visible');
				this._list.splice(0, this._list.length);
				this._focusedItem = undefined;
				this._cappedHeight = undefined;
				this._explainMode = false;
				break;
			case State.Loading:
				this.element.domNode.classList.add('message');
				this._messageElement.textContent = SuggestWidget.LOADING_MESSAGE;
				dom.hide(this._listElement, this._status.element);
				dom.show(this._messageElement);
				this._details.hide();
				this._show();
				this._focusedItem = undefined;
				break;
			case State.Empty:
				this.element.domNode.classList.add('message');
				this._messageElement.textContent = SuggestWidget.NO_SUGGESTIONS_MESSAGE;
				dom.hide(this._listElement, this._status.element);
				dom.show(this._messageElement);
				this._details.hide();
				this._show();
				this._focusedItem = undefined;
				break;
			case State.Open:
				dom.hide(this._messageElement);
				dom.show(this._listElement, this._status.element);
				this._show();
				break;
			case State.Frozen:
				dom.hide(this._messageElement);
				dom.show(this._listElement, this._status.element);
				this._show();
				break;
			case State.Details:
				dom.hide(this._messageElement);
				dom.show(this._listElement, this._status.element);
				this._details.show();
				this._show();
				break;
		}
	}

	private _show(): void {
		this._status.show();
		this._contentWidget.show();
		this._layout(this._persistedSize.restore());
		this._ctxSuggestWidgetVisible.set(true);

		this._showTimeout.cancelAndSet(() => {
			this.element.domNode.classList.add('visible');
			this._onDidShow.fire(this);
		}, 100);
	}

	showTriggered(auto: boolean, delay: number) {
		if (this._state !== State.Hidden) {
			return;
		}
		this._contentWidget.setPosition(this.editor.getPosition());
		this._isAuto = !!auto;

		if (!this._isAuto) {
			this._loadingTimeout = disposableTimeout(() => this._setState(State.Loading), delay);
		}
	}

	showSuggestions(completionModel: CompletionModel, selectionIndex: number, isFrozen: boolean, isAuto: boolean): void {

		this._contentWidget.setPosition(this.editor.getPosition());
		this._loadingTimeout?.dispose();

		this._currentSuggestionDetails?.cancel();
		this._currentSuggestionDetails = undefined;

		if (this._completionModel !== completionModel) {
			this._completionModel = completionModel;
		}

		if (isFrozen && this._state !== State.Empty && this._state !== State.Hidden) {
			this._setState(State.Frozen);
			return;
		}

		const visibleCount = this._completionModel.items.length;
		const isEmpty = visibleCount === 0;
		this._ctxSuggestWidgetMultipleSuggestions.set(visibleCount > 1);

		if (isEmpty) {
			this._setState(isAuto ? State.Hidden : State.Empty);
			this._completionModel = undefined;
			return;
		}

		this._focusedItem = undefined;
		this._list.splice(0, this._list.length, this._completionModel.items);
		this._setState(isFrozen ? State.Frozen : State.Open);
		this._list.reveal(selectionIndex, 0);
		this._list.setFocus([selectionIndex]);

		this._layout(this.element.size);
		// Reset focus border
		if (this._detailsBorderColor) {
			this._details.widget.domNode.style.borderColor = this._detailsBorderColor;
		}
	}

	selectNextPage(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Details:
				this._details.widget.pageDown();
				return true;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusNextPage();
				return true;
		}
	}

	selectNext(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusNext(1, true);
				return true;
		}
	}

	selectLast(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Details:
				this._details.widget.scrollBottom();
				return true;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusLast();
				return true;
		}
	}

	selectPreviousPage(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Details:
				this._details.widget.pageUp();
				return true;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusPreviousPage();
				return true;
		}
	}

	selectPrevious(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusPrevious(1, true);
				return false;
		}
	}

	selectFirst(): boolean {
		switch (this._state) {
			case State.Hidden:
				return false;
			case State.Details:
				this._details.widget.scrollTop();
				return true;
			case State.Loading:
				return !this._isAuto;
			default:
				this._list.focusFirst();
				return true;
		}
	}

	getFocusedItem(): ISelectedSuggestion | undefined {
		if (this._state !== State.Hidden
			&& this._state !== State.Empty
			&& this._state !== State.Loading
			&& this._completionModel
		) {

			return {
				item: this._list.getFocusedElements()[0],
				index: this._list.getFocus()[0],
				model: this._completionModel
			};
		}
		return undefined;
	}

	toggleDetailsFocus(): void {
		if (this._state === State.Details) {
			this._setState(State.Open);
			if (this._detailsBorderColor) {
				this._details.widget.domNode.style.borderColor = this._detailsBorderColor;
			}
		} else if (this._state === State.Open && this._isDetailsVisible()) {
			this._setState(State.Details);
			if (this._detailsFocusBorderColor) {
				this._details.widget.domNode.style.borderColor = this._detailsFocusBorderColor;
			}
		}
	}

	toggleDetails(): void {
		if (this._isDetailsVisible()) {
			// hide details widget
			this._ctxSuggestWidgetDetailsVisible.set(false);
			this._setDetailsVisible(false);
			this._details.hide();
			this.element.domNode.classList.remove('shows-details');

		} else if ((canExpandCompletionItem(this._list.getFocusedElements()[0]) || this._explainMode) && (this._state === State.Open || this._state === State.Details || this._state === State.Frozen)) {
			// show details widget (iff possible)
			this._ctxSuggestWidgetDetailsVisible.set(true);
			this._setDetailsVisible(true);
			this.showDetails(false);
		}
	}

	showDetails(loading: boolean): void {
		this._details.show();
		if (loading) {
			this._details.widget.renderLoading();
		} else {
			this._details.widget.renderItem(this._list.getFocusedElements()[0], this._explainMode);
		}
		this._positionDetails();
		this.editor.focus();
		this.element.domNode.classList.add('shows-details');
	}

	toggleExplainMode(): void {
		if (this._list.getFocusedElements()[0]) {
			this._explainMode = !this._explainMode;
			if (!this._isDetailsVisible()) {
				this.toggleDetails();
			} else {
				this.showDetails(false);
			}
		}
	}

	resetPersistedSize(): void {
		this._persistedSize.reset();
	}

	hideWidget(): void {
		this._loadingTimeout?.dispose();
		this._setState(State.Hidden);
		this._onDidHide.fire(this);
		this.element.clearSashHoverState();

		// ensure that a reasonable widget height is persisted so that
		// accidential "resize-to-single-items" cases aren't happening
		const dim = this._persistedSize.restore();
		const minPersistedHeight = Math.ceil(this.getLayoutInfo().itemHeight * 4.3);
		if (dim && dim.height < minPersistedHeight) {
			this._persistedSize.store(dim.with(undefined, minPersistedHeight));
		}
	}

	isFrozen(): boolean {
		return this._state === State.Frozen;
	}

	_afterRender(position: ContentWidgetPositionPreference | null) {
		if (position === null) {
			if (this._isDetailsVisible()) {
				this._details.hide(); //todo@jrieken soft-hide
			}
			return;
		}
		if (this._state === State.Empty || this._state === State.Loading) {
			// no special positioning when widget isn't showing list
			return;
		}
		if (this._isDetailsVisible()) {
			this._details.show();
		}
		this._positionDetails();
	}

	private _layout(size: dom.Dimension | undefined): void {
		if (!this.editor.hasModel()) {
			return;
		}
		if (!this.editor.getDomNode()) {
			// happens when running tests
			return;
		}

		const bodyBox = dom.getClientArea(document.body);
		const info = this.getLayoutInfo();

		if (!size) {
			size = info.defaultSize;
		}

		let height = size.height;
		let width = size.width;

		// status bar
		this._status.element.style.lineHeight = `${info.itemHeight}px`;

		if (this._state === State.Empty || this._state === State.Loading) {
			// showing a message only
			height = info.itemHeight + info.borderHeight;
			width = info.defaultSize.width / 2;
			this.element.enableSashes(false, false, false, false);
			this.element.minSize = this.element.maxSize = new dom.Dimension(width, height);
			this._contentWidget.setPreference(ContentWidgetPositionPreference.BELOW);

		} else {
			// showing items

			// width math
			const maxWidth = bodyBox.width - info.borderHeight - 2 * info.horizontalPadding;
			if (width > maxWidth) {
				width = maxWidth;
			}
			const preferredWidth = this._completionModel ? this._completionModel.stats.pLabelLen * info.typicalHalfwidthCharacterWidth : width;

			// height math
			const fullHeight = info.statusBarHeight + this._list.contentHeight + info.borderHeight;
			const minHeight = info.itemHeight + info.statusBarHeight;
			const editorBox = dom.getDomNodePagePosition(this.editor.getDomNode());
			const cursorBox = this.editor.getScrolledVisiblePosition(this.editor.getPosition());
			const cursorBottom = editorBox.top + cursorBox.top + cursorBox.height;
			const maxHeightBelow = Math.min(bodyBox.height - cursorBottom - info.verticalPadding, fullHeight);
			const maxHeightAbove = Math.min(editorBox.top + cursorBox.top - info.verticalPadding, fullHeight);
			let maxHeight = Math.min(Math.max(maxHeightAbove, maxHeightBelow) + info.borderHeight, fullHeight);

			if (height === this._cappedHeight?.capped) {
				// Restore the old (wanted) height when the current
				// height is capped to fit
				height = this._cappedHeight.wanted;
			}

			if (height < minHeight) {
				height = minHeight;
			}
			if (height > maxHeight) {
				height = maxHeight;
			}

			if (height > maxHeightBelow) {
				this._contentWidget.setPreference(ContentWidgetPositionPreference.ABOVE);
				this.element.enableSashes(true, true, false, false);
				maxHeight = maxHeightAbove;

			} else {
				this._contentWidget.setPreference(ContentWidgetPositionPreference.BELOW);
				this.element.enableSashes(false, true, true, false);
				maxHeight = maxHeightBelow;
			}
			this.element.preferredSize = new dom.Dimension(preferredWidth, info.defaultSize.height);
			this.element.maxSize = new dom.Dimension(maxWidth, maxHeight);
			this.element.minSize = new dom.Dimension(220, minHeight);

			// Know when the height was capped to fit and remember
			// the wanted height for later. This is required when going
			// left to widen suggestions.
			this._cappedHeight = height === fullHeight
				? { wanted: this._cappedHeight?.wanted ?? size.height, capped: height }
				: undefined;
		}
		this._resize(width, height);
	}

	private _resize(width: number, height: number): void {

		const { width: maxWidth, height: maxHeight } = this.element.maxSize;
		width = Math.min(maxWidth, width);
		height = Math.min(maxHeight, height);

		const { statusBarHeight } = this.getLayoutInfo();
		this._list.layout(height - statusBarHeight, width);
		this._listElement.style.height = `${height - statusBarHeight}px`;
		this.element.layout(height, width);
		this._contentWidget.layout();

		this._positionDetails();
	}

	private _positionDetails(): void {
		if (this._isDetailsVisible()) {
			this._details.placeAtAnchor(this.element.domNode);
		}
	}

	getLayoutInfo() {
		const fontInfo = this.editor.getOption(EditorOption.fontInfo);
		const itemHeight = clamp(this.editor.getOption(EditorOption.suggestLineHeight) || fontInfo.lineHeight, 8, 1000);
		const statusBarHeight = !this.editor.getOption(EditorOption.suggest).showStatusBar || this._state === State.Empty || this._state === State.Loading ? 0 : itemHeight;
		const borderWidth = this._details.widget.borderWidth;
		const borderHeight = 2 * borderWidth;

		return {
			itemHeight,
			statusBarHeight,
			borderWidth,
			borderHeight,
			typicalHalfwidthCharacterWidth: fontInfo.typicalHalfwidthCharacterWidth,
			verticalPadding: 22,
			horizontalPadding: 14,
			defaultSize: new dom.Dimension(430, statusBarHeight + 12 * itemHeight + borderHeight)
		};
	}

	private _isDetailsVisible(): boolean {
		return this._storageService.getBoolean('expandSuggestionDocs', StorageScope.GLOBAL, false);
	}

	private _setDetailsVisible(value: boolean) {
		this._storageService.store('expandSuggestionDocs', value, StorageScope.GLOBAL, StorageTarget.USER);
	}
}

export class SuggestContentWidget implements IContentWidget {

	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = false;

	private _position?: IPosition | null;
	private _preference?: ContentWidgetPositionPreference;
	private _preferenceLocked = false;

	private _added: boolean = false;
	private _hidden: boolean = false;

	constructor(
		private readonly _widget: SuggestWidget,
		private readonly _editor: ICodeEditor
	) { }

	dispose(): void {
		if (this._added) {
			this._added = false;
			this._editor.removeContentWidget(this);
		}
	}

	getId(): string {
		return 'editor.widget.suggestWidget';
	}

	getDomNode(): HTMLElement {
		return this._widget.element.domNode;
	}

	show(): void {
		this._hidden = false;
		if (!this._added) {
			this._added = true;
			this._editor.addContentWidget(this);
		}
	}

	hide(): void {
		if (!this._hidden) {
			this._hidden = true;
			this.layout();
		}
	}

	layout(): void {
		this._editor.layoutContentWidget(this);
	}

	getPosition(): IContentWidgetPosition | null {
		if (this._hidden || !this._position || !this._preference) {
			return null;
		}
		return {
			position: this._position,
			preference: [this._preference]
		};
	}

	beforeRender() {
		const { height, width } = this._widget.element.size;
		const { borderWidth, horizontalPadding } = this._widget.getLayoutInfo();
		return new dom.Dimension(width + 2 * borderWidth + horizontalPadding, height + 2 * borderWidth);
	}

	afterRender(position: ContentWidgetPositionPreference | null) {
		this._widget._afterRender(position);
	}

	setPreference(preference: ContentWidgetPositionPreference) {
		if (!this._preferenceLocked) {
			this._preference = preference;
		}
	}

	lockPreference() {
		this._preferenceLocked = true;
	}

	unlockPreference() {
		this._preferenceLocked = false;
	}

	setPosition(position: IPosition | null): void {
		this._position = position;
	}
}

registerThemingParticipant((theme, collector) => {
	const matchHighlight = theme.getColor(editorSuggestWidgetHighlightForeground);
	if (matchHighlight) {
		collector.addRule(`.monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-highlighted-label .highlight { color: ${matchHighlight}; }`);
	}

	const matchHighlightFocus = theme.getColor(editorSuggestWidgetHighlightFocusForeground);
	if (matchHighlight) {
		collector.addRule(`.monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused .monaco-highlighted-label .highlight { color: ${matchHighlightFocus}; }`);
	}

	const foreground = theme.getColor(editorSuggestWidgetForeground);
	if (foreground) {
		collector.addRule(`.monaco-editor .suggest-widget, .monaco-editor .suggest-details { color: ${foreground}; }`);
	}

	const selectedForeground = theme.getColor(editorSuggestWidgetSelectedForeground);
	if (selectedForeground) {
		collector.addRule(`.monaco-editor .suggest-widget .monaco-list .monaco-list-row.focused { color: ${selectedForeground}; }`);
	}

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-editor .suggest-details a { color: ${link}; }`);
	}

	const codeBackground = theme.getColor(textCodeBlockBackground);
	if (codeBackground) {
		collector.addRule(`.monaco-editor .suggest-details code { background-color: ${codeBackground}; }`);
	}
});
