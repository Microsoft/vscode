/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { Selection } from 'vs/editor/common/core/selection';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IPointerHandlerHelper } from 'vs/editor/browser/controller/mouseHandler';
import { PointerHandler } from 'vs/editor/browser/controller/pointerHandler';
import { ITextAreaHandlerHelper, TextAreaHandler } from 'vs/editor/browser/controller/textAreaHandler';
import { IContentWidget, IContentWidgetPosition, IOverlayWidget, IOverlayWidgetPosition, IMouseTarget, IViewZoneChangeAccessor, IEditorAriaOptions } from 'vs/editor/browser/editorBrowser';
import { ICommandDelegate, ViewController } from 'vs/editor/browser/view/viewController';
import { ViewUserInputEvents } from 'vs/editor/browser/view/viewUserInputEvents';
import { ContentViewOverlays, MarginViewOverlays } from 'vs/editor/browser/view/viewOverlays';
import { PartFingerprint, PartFingerprints, ViewPart } from 'vs/editor/browser/view/viewPart';
import { ViewContentWidgets } from 'vs/editor/browser/viewParts/contentWidgets/contentWidgets';
import { CurrentLineHighlightOverlay, CurrentLineMarginHighlightOverlay } from 'vs/editor/browser/viewParts/currentLineHighlight/currentLineHighlight';
import { DecorationsOverlay } from 'vs/editor/browser/viewParts/decorations/decorations';
import { EditorScrollbar } from 'vs/editor/browser/viewParts/editorScrollbar/editorScrollbar';
import { GlyphMarginOverlay } from 'vs/editor/browser/viewParts/glyphMargin/glyphMargin';
import { IndentGuidesOverlay } from 'vs/editor/browser/viewParts/indentGuides/indentGuides';
import { LineNumbersOverlay } from 'vs/editor/browser/viewParts/lineNumbers/lineNumbers';
import { ViewLines } from 'vs/editor/browser/viewParts/lines/viewLines';
import { LinesDecorationsOverlay } from 'vs/editor/browser/viewParts/linesDecorations/linesDecorations';
import { Margin } from 'vs/editor/browser/viewParts/margin/margin';
import { MarginViewLineDecorationsOverlay } from 'vs/editor/browser/viewParts/marginDecorations/marginDecorations';
import { Minimap } from 'vs/editor/browser/viewParts/minimap/minimap';
import { ViewOverlayWidgets } from 'vs/editor/browser/viewParts/overlayWidgets/overlayWidgets';
import { DecorationsOverviewRuler } from 'vs/editor/browser/viewParts/overviewRuler/decorationsOverviewRuler';
import { OverviewRuler } from 'vs/editor/browser/viewParts/overviewRuler/overviewRuler';
import { Rulers } from 'vs/editor/browser/viewParts/rulers/rulers';
import { ScrollDecorationViewPart } from 'vs/editor/browser/viewParts/scrollDecoration/scrollDecoration';
import { SelectionsOverlay } from 'vs/editor/browser/viewParts/selections/selections';
import { ViewCursors } from 'vs/editor/browser/viewParts/viewCursors/viewCursors';
import { ViewZones } from 'vs/editor/browser/viewParts/viewZones/viewZones';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IConfiguration, ScrollType } from 'vs/editor/common/editorCommon';
import { RenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { ViewportData } from 'vs/editor/common/viewLayout/viewLinesViewportData';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';
import { IViewModel } from 'vs/editor/common/viewModel/viewModel';
import { IThemeService, getThemeTypeSelector } from 'vs/platform/theme/common/themeService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { PointerHandlerLastRenderData } from 'vs/editor/browser/controller/mouseTarget';


export interface IContentWidgetData {
	widget: IContentWidget;
	position: IContentWidgetPosition | null;
}

export interface IOverlayWidgetData {
	widget: IOverlayWidget;
	position: IOverlayWidgetPosition | null;
}

export class View extends ViewEventHandler {

	private readonly _scrollbar: EditorScrollbar;
	private readonly _context: ViewContext;
	private _selections: Selection[];

	// The view lines
	private readonly _viewLines: ViewLines;

	// These are parts, but we must do some API related calls on them, so we keep a reference
	private readonly _viewZones: ViewZones;
	private readonly _contentWidgets: ViewContentWidgets;
	private readonly _overlayWidgets: ViewOverlayWidgets;
	private readonly _viewCursors: ViewCursors;
	private readonly _viewParts: ViewPart[];

	private readonly _textAreaHandler: TextAreaHandler;
	private readonly _pointerHandler: PointerHandler;

	// Dom nodes
	private readonly _linesContent: FastDomNode<HTMLElement>;
	public readonly domNode: FastDomNode<HTMLElement>;
	private readonly _overflowGuardContainer: FastDomNode<HTMLElement>;

	// Actual mutable state
	private _renderAnimationFrame: IDisposable | null;

	constructor(
		commandDelegate: ICommandDelegate,
		configuration: IConfiguration,
		themeService: IThemeService,
		model: IViewModel,
		userInputEvents: ViewUserInputEvents,
		overflowWidgetsDomNode: HTMLElement | undefined
	) {
		super();
		this._selections = [new Selection(1, 1, 1, 1)];
		this._renderAnimationFrame = null;

		const viewController = new ViewController(configuration, model, userInputEvents, commandDelegate);

		// The view context is passed on to most classes (basically to reduce param. counts in ctors)
		this._context = new ViewContext(configuration, themeService.getColorTheme(), model);

		// Ensure the view is the first event handler in order to update the layout
		this._context.addEventHandler(this);

		this._register(themeService.onDidColorThemeChange(theme => {
			this._context.theme.update(theme);
			this._context.model.onDidColorThemeChange();
			this.render(true, false);
		}));

		this._viewParts = [];

		// Keyboard handler
		this._textAreaHandler = new TextAreaHandler(this._context, viewController, this._createTextAreaHandlerHelper());
		this._viewParts.push(this._textAreaHandler);

		// These two dom nodes must be constructed up front, since references are needed in the layout provider (scrolling & co.)
		this._linesContent = createFastDomNode(document.createElement('div'));
		this._linesContent.setClassName('lines-content' + ' monaco-editor-background');
		this._linesContent.setPosition('absolute');

		this.domNode = createFastDomNode(document.createElement('div'));
		this.domNode.setClassName(this._getEditorClassName());
		// Set role 'code' for better screen reader support https://github.com/microsoft/vscode/issues/93438
		this.domNode.setAttribute('role', 'code');

		this._overflowGuardContainer = createFastDomNode(document.createElement('div'));
		PartFingerprints.write(this._overflowGuardContainer, PartFingerprint.OverflowGuard);
		this._overflowGuardContainer.setClassName('overflow-guard');

		this._scrollbar = new EditorScrollbar(this._context, this._linesContent, this.domNode, this._overflowGuardContainer);
		this._viewParts.push(this._scrollbar);

		// View Lines
		this._viewLines = new ViewLines(this._context, this._linesContent);

		// View Zones
		this._viewZones = new ViewZones(this._context);
		this._viewParts.push(this._viewZones);

		// Decorations overview ruler
		const decorationsOverviewRuler = new DecorationsOverviewRuler(this._context);
		this._viewParts.push(decorationsOverviewRuler);


		const scrollDecoration = new ScrollDecorationViewPart(this._context);
		this._viewParts.push(scrollDecoration);

		const contentViewOverlays = new ContentViewOverlays(this._context);
		this._viewParts.push(contentViewOverlays);
		contentViewOverlays.addDynamicOverlay(new CurrentLineHighlightOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new SelectionsOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new IndentGuidesOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new DecorationsOverlay(this._context));

		const marginViewOverlays = new MarginViewOverlays(this._context);
		this._viewParts.push(marginViewOverlays);
		marginViewOverlays.addDynamicOverlay(new CurrentLineMarginHighlightOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new GlyphMarginOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new MarginViewLineDecorationsOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new LinesDecorationsOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new LineNumbersOverlay(this._context));

		const margin = new Margin(this._context);
		margin.getDomNode().appendChild(this._viewZones.marginDomNode);
		margin.getDomNode().appendChild(marginViewOverlays.getDomNode());
		this._viewParts.push(margin);

		// Content widgets
		this._contentWidgets = new ViewContentWidgets(this._context, this.domNode);
		this._viewParts.push(this._contentWidgets);

		this._viewCursors = new ViewCursors(this._context);
		this._viewParts.push(this._viewCursors);

		// Overlay widgets
		this._overlayWidgets = new ViewOverlayWidgets(this._context);
		this._viewParts.push(this._overlayWidgets);

		const rulers = new Rulers(this._context);
		this._viewParts.push(rulers);

		const minimap = new Minimap(this._context);
		this._viewParts.push(minimap);

		// -------------- Wire dom nodes up

		if (decorationsOverviewRuler) {
			const overviewRulerData = this._scrollbar.getOverviewRulerLayoutInfo();
			overviewRulerData.parent.insertBefore(decorationsOverviewRuler.getDomNode(), overviewRulerData.insertBefore);
		}

		this._linesContent.appendChild(contentViewOverlays.getDomNode());
		this._linesContent.appendChild(rulers.domNode);
		this._linesContent.appendChild(this._viewZones.domNode);
		this._linesContent.appendChild(this._viewLines.getDomNode());
		this._linesContent.appendChild(this._contentWidgets.domNode);
		this._linesContent.appendChild(this._viewCursors.getDomNode());
		this._overflowGuardContainer.appendChild(margin.getDomNode());
		this._overflowGuardContainer.appendChild(this._scrollbar.getDomNode());
		this._overflowGuardContainer.appendChild(scrollDecoration.getDomNode());
		this._overflowGuardContainer.appendChild(this._textAreaHandler.textArea);
		this._overflowGuardContainer.appendChild(this._textAreaHandler.textAreaCover);
		this._overflowGuardContainer.appendChild(this._overlayWidgets.getDomNode());
		this._overflowGuardContainer.appendChild(minimap.getDomNode());
		this.domNode.appendChild(this._overflowGuardContainer);

		if (overflowWidgetsDomNode) {
			overflowWidgetsDomNode.appendChild(this._contentWidgets.overflowingContentWidgetsDomNode.domNode);
		} else {
			this.domNode.appendChild(this._contentWidgets.overflowingContentWidgetsDomNode);
		}

		this._applyLayout();

		// Pointer handler
		this._pointerHandler = this._register(new PointerHandler(this._context, viewController, this._createPointerHandlerHelper()));
	}

	private _flushAccumulatedAndRenderNow(): void {
		this._renderNow();
	}

	private _createPointerHandlerHelper(): IPointerHandlerHelper {
		return {
			viewDomNode: this.domNode.domNode,
			linesContentDomNode: this._linesContent.domNode,

			focusTextArea: () => {
				this.focus();
			},

			getLastRenderData: (): PointerHandlerLastRenderData => {
				const lastViewCursorsRenderData = this._viewCursors.getLastRenderData() || [];
				const lastTextareaPosition = this._textAreaHandler.getLastRenderData();
				return new PointerHandlerLastRenderData(lastViewCursorsRenderData, lastTextareaPosition);
			},
			shouldSuppressMouseDownOnViewZone: (viewZoneId: string) => {
				return this._viewZones.shouldSuppressMouseDownOnViewZone(viewZoneId);
			},
			shouldSuppressMouseDownOnWidget: (widgetId: string) => {
				return this._contentWidgets.shouldSuppressMouseDownOnWidget(widgetId);
			},
			getPositionFromDOMInfo: (spanNode: HTMLElement, offset: number) => {
				this._flushAccumulatedAndRenderNow();
				return this._viewLines.getPositionFromDOMInfo(spanNode, offset);
			},

			visibleRangeForPosition: (lineNumber: number, column: number) => {
				this._flushAccumulatedAndRenderNow();
				return this._viewLines.visibleRangeForPosition(new Position(lineNumber, column));
			},

			getLineWidth: (lineNumber: number) => {
				this._flushAccumulatedAndRenderNow();
				return this._viewLines.getLineWidth(lineNumber);
			}
		};
	}

	private _createTextAreaHandlerHelper(): ITextAreaHandlerHelper {
		return {
			visibleRangeForPositionRelativeToEditor: (lineNumber: number, column: number) => {
				this._flushAccumulatedAndRenderNow();
				return this._viewLines.visibleRangeForPosition(new Position(lineNumber, column));
			}
		};
	}

	private _applyLayout(): void {
		const options = this._context.configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this.domNode.setWidth(layoutInfo.width);
		this.domNode.setHeight(layoutInfo.height);

		this._overflowGuardContainer.setWidth(layoutInfo.width);
		this._overflowGuardContainer.setHeight(layoutInfo.height);

		this._linesContent.setWidth(1000000);
		this._linesContent.setHeight(1000000);
	}

	private _getEditorClassName() {
		const focused = this._textAreaHandler.isFocused() ? ' focused' : '';
		return this._context.configuration.options.get(EditorOption.editorClassName) + ' ' + getThemeTypeSelector(this._context.theme.type) + focused;
	}

	// --- begin event handlers
	public handleEvents(events: viewEvents.ViewEvent[]): void {
		super.handleEvents(events);
		this._scheduleRender();
	}
	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		this.domNode.setClassName(this._getEditorClassName());
		this._applyLayout();
		return false;
	}
	public onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		this._selections = e.selections;
		return false;
	}
	public onFocusChanged(e: viewEvents.ViewFocusChangedEvent): boolean {
		this.domNode.setClassName(this._getEditorClassName());
		return false;
	}
	public onThemeChanged(e: viewEvents.ViewThemeChangedEvent): boolean {
		this.domNode.setClassName(this._getEditorClassName());
		return false;
	}

	// --- end event handlers

	public dispose(): void {
		if (this._renderAnimationFrame !== null) {
			this._renderAnimationFrame.dispose();
			this._renderAnimationFrame = null;
		}

		this._contentWidgets.overflowingContentWidgetsDomNode.domNode.remove();

		this._context.removeEventHandler(this);

		this._viewLines.dispose();

		// Destroy view parts
		for (let i = 0, len = this._viewParts.length; i < len; i++) {
			this._viewParts[i].dispose();
		}

		super.dispose();
	}

	private _scheduleRender(): void {
		if (this._renderAnimationFrame === null) {
			this._renderAnimationFrame = dom.runAtThisOrScheduleAtNextAnimationFrame(this._onRenderScheduled.bind(this), 100);
		}
	}

	private _onRenderScheduled(): void {
		this._renderAnimationFrame = null;
		this._flushAccumulatedAndRenderNow();
	}

	private _renderNow(): void {
		safeInvokeNoArg(() => this._actualRender());
	}

	private _getViewPartsToRender(): ViewPart[] {
		let result: ViewPart[] = [], resultLen = 0;
		for (let i = 0, len = this._viewParts.length; i < len; i++) {
			const viewPart = this._viewParts[i];
			if (viewPart.shouldRender()) {
				result[resultLen++] = viewPart;
			}
		}
		return result;
	}

	private _actualRender(): void {
		if (!dom.isInDOM(this.domNode.domNode)) {
			return;
		}

		let viewPartsToRender = this._getViewPartsToRender();

		if (!this._viewLines.shouldRender() && viewPartsToRender.length === 0) {
			// Nothing to render
			return;
		}

		const partialViewportData = this._context.viewLayout.getLinesViewportData();
		this._context.model.setViewport(partialViewportData.startLineNumber, partialViewportData.endLineNumber, partialViewportData.centeredLineNumber);

		const viewportData = new ViewportData(
			this._selections,
			partialViewportData,
			this._context.viewLayout.getWhitespaceViewportData(),
			this._context.model
		);

		if (this._contentWidgets.shouldRender()) {
			// Give the content widgets a chance to set their max width before a possible synchronous layout
			this._contentWidgets.onBeforeRender(viewportData);
		}

		if (this._viewLines.shouldRender()) {
			this._viewLines.renderText(viewportData);
			this._viewLines.onDidRender();

			// Rendering of viewLines might cause scroll events to occur, so collect view parts to render again
			viewPartsToRender = this._getViewPartsToRender();
		}

		const renderingContext = new RenderingContext(this._context.viewLayout, viewportData, this._viewLines);

		// Render the rest of the parts
		for (let i = 0, len = viewPartsToRender.length; i < len; i++) {
			const viewPart = viewPartsToRender[i];
			viewPart.prepareRender(renderingContext);
		}

		for (let i = 0, len = viewPartsToRender.length; i < len; i++) {
			const viewPart = viewPartsToRender[i];
			viewPart.render(renderingContext);
			viewPart.onDidRender();
		}
	}

	// --- BEGIN CodeEditor helpers

	public delegateVerticalScrollbarMouseDown(browserEvent: IMouseEvent): void {
		this._scrollbar.delegateVerticalScrollbarMouseDown(browserEvent);
	}

	public restoreState(scrollPosition: { scrollLeft: number; scrollTop: number; }): void {
		this._context.model.setScrollPosition({ scrollTop: scrollPosition.scrollTop }, ScrollType.Immediate);
		this._context.model.tokenizeViewport();
		this._renderNow();
		this._viewLines.updateLineWidths();
		this._context.model.setScrollPosition({ scrollLeft: scrollPosition.scrollLeft }, ScrollType.Immediate);
	}

	public getOffsetForColumn(modelLineNumber: number, modelColumn: number): number {
		const modelPosition = this._context.model.validateModelPosition({
			lineNumber: modelLineNumber,
			column: modelColumn
		});
		const viewPosition = this._context.model.coordinatesConverter.convertModelPositionToViewPosition(modelPosition);
		this._flushAccumulatedAndRenderNow();
		const visibleRange = this._viewLines.visibleRangeForPosition(new Position(viewPosition.lineNumber, viewPosition.column));
		if (!visibleRange) {
			return -1;
		}
		return visibleRange.left;
	}

	public getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null {
		const mouseTarget = this._pointerHandler.getTargetAtClientPoint(clientX, clientY);
		if (!mouseTarget) {
			return null;
		}
		return ViewUserInputEvents.convertViewToModelMouseTarget(mouseTarget, this._context.model.coordinatesConverter);
	}

	public createOverviewRuler(cssClassName: string): OverviewRuler {
		return new OverviewRuler(this._context, cssClassName);
	}

	public change(callback: (changeAccessor: IViewZoneChangeAccessor) => any): void {
		this._viewZones.changeViewZones(callback);
		this._scheduleRender();
	}

	public render(now: boolean, everything: boolean): void {
		if (everything) {
			// Force everything to render...
			this._viewLines.forceShouldRender();
			for (let i = 0, len = this._viewParts.length; i < len; i++) {
				const viewPart = this._viewParts[i];
				viewPart.forceShouldRender();
			}
		}
		if (now) {
			this._flushAccumulatedAndRenderNow();
		} else {
			this._scheduleRender();
		}
	}

	public focus(): void {
		this._textAreaHandler.focusTextArea();
	}

	public isFocused(): boolean {
		return this._textAreaHandler.isFocused();
	}

	public refreshFocusState() {
		this._textAreaHandler.refreshFocusState();
	}

	public setAriaOptions(options: IEditorAriaOptions): void {
		this._textAreaHandler.setAriaOptions(options);
	}

	public addContentWidget(widgetData: IContentWidgetData): void {
		this._contentWidgets.addWidget(widgetData.widget);
		this.layoutContentWidget(widgetData);
		this._scheduleRender();
	}

	public layoutContentWidget(widgetData: IContentWidgetData): void {
		let newRange = widgetData.position ? widgetData.position.range || null : null;
		if (newRange === null) {
			const newPosition = widgetData.position ? widgetData.position.position : null;
			if (newPosition !== null) {
				newRange = new Range(newPosition.lineNumber, newPosition.column, newPosition.lineNumber, newPosition.column);
			}
		}
		const newPreference = widgetData.position ? widgetData.position.preference : null;
		this._contentWidgets.setWidgetPosition(widgetData.widget, newRange, newPreference);
		this._scheduleRender();
	}

	public removeContentWidget(widgetData: IContentWidgetData): void {
		this._contentWidgets.removeWidget(widgetData.widget);
		this._scheduleRender();
	}

	public addOverlayWidget(widgetData: IOverlayWidgetData): void {
		this._overlayWidgets.addWidget(widgetData.widget);
		this.layoutOverlayWidget(widgetData);
		this._scheduleRender();
	}

	public layoutOverlayWidget(widgetData: IOverlayWidgetData): void {
		const newPreference = widgetData.position ? widgetData.position.preference : null;
		const shouldRender = this._overlayWidgets.setWidgetPosition(widgetData.widget, newPreference);
		if (shouldRender) {
			this._scheduleRender();
		}
	}

	public removeOverlayWidget(widgetData: IOverlayWidgetData): void {
		this._overlayWidgets.removeWidget(widgetData.widget);
		this._scheduleRender();
	}

	// --- END CodeEditor helpers

}

function safeInvokeNoArg(func: Function): any {
	try {
		return func();
	} catch (e) {
		onUnexpectedError(e);
	}
}
