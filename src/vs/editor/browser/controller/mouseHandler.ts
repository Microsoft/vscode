/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { StandardWheelEvent, IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { TimeoutTimer } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { HitTestContext, IViewZoneData, MouseTarget, MouseTargetFactory, PointerHandlerLastRenderData } from 'vs/editor/browser/controller/mouseTarget';
import { IMouseTarget, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { ClientCoordinates, EditorMouseEvent, EditorMouseEventFactory, GlobalEditorMouseMoveMonitor, createEditorPagePosition } from 'vs/editor/browser/editorDom';
import { ViewController } from 'vs/editor/browser/view/viewController';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { HorizontalPosition } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

/**
 * Merges mouse events when mouse move events are throttled
 */
export function createMouseMoveEventMerger(mouseTargetFactory: MouseTargetFactory | null) {
	return function (lastEvent: EditorMouseEvent | null, currentEvent: EditorMouseEvent): EditorMouseEvent {
		let targetIsWidget = false;
		if (mouseTargetFactory) {
			targetIsWidget = mouseTargetFactory.mouseTargetIsWidget(currentEvent);
		}
		if (!targetIsWidget) {
			currentEvent.preventDefault();
		}
		return currentEvent;
	};
}

export interface IPointerHandlerHelper {
	viewDomNode: HTMLElement;
	linesContentDomNode: HTMLElement;

	focusTextArea(): void;
	dispatchTextAreaEvent(event: CustomEvent): void;

	/**
	 * Get the last rendered information for cursors & textarea.
	 */
	getLastRenderData(): PointerHandlerLastRenderData;

	shouldSuppressMouseDownOnViewZone(viewZoneId: string): boolean;
	shouldSuppressMouseDownOnWidget(widgetId: string): boolean;

	/**
	 * Decode a position from a rendered dom node
	 */
	getPositionFromDOMInfo(spanNode: HTMLElement, offset: number): Position | null;

	visibleRangeForPosition(lineNumber: number, column: number): HorizontalPosition | null;
	getLineWidth(lineNumber: number): number;
}

export class MouseHandler extends ViewEventHandler {

	static readonly MOUSE_MOVE_MINIMUM_TIME = 100; // ms

	protected _context: ViewContext;
	protected viewController: ViewController;
	protected viewHelper: IPointerHandlerHelper;
	protected mouseTargetFactory: MouseTargetFactory;
	protected readonly _mouseDownOperation: MouseDownOperation;
	private lastMouseLeaveTime: number;
	private _height: number;

	constructor(context: ViewContext, viewController: ViewController, viewHelper: IPointerHandlerHelper) {
		super();

		this._context = context;
		this.viewController = viewController;
		this.viewHelper = viewHelper;
		this.mouseTargetFactory = new MouseTargetFactory(this._context, viewHelper);

		this._mouseDownOperation = this._register(new MouseDownOperation(
			this._context,
			this.viewController,
			this.viewHelper,
			(e, testEventTarget) => this._createMouseTarget(e, testEventTarget),
			(e) => this._getMouseColumn(e)
		));

		this.lastMouseLeaveTime = -1;
		this._height = this._context.configuration.options.get(EditorOption.layoutInfo).height;

		const mouseEvents = new EditorMouseEventFactory(this.viewHelper.viewDomNode);

		this._register(mouseEvents.onContextMenu(this.viewHelper.viewDomNode, (e) => this._onContextMenu(e, true)));

		this._register(mouseEvents.onMouseMoveThrottled(this.viewHelper.viewDomNode,
			(e) => this._onMouseMove(e),
			createMouseMoveEventMerger(this.mouseTargetFactory), MouseHandler.MOUSE_MOVE_MINIMUM_TIME));

		this._register(mouseEvents.onMouseUp(this.viewHelper.viewDomNode, (e) => this._onMouseUp(e)));

		this._register(mouseEvents.onMouseLeave(this.viewHelper.viewDomNode, (e) => this._onMouseLeave(e)));

		this._register(mouseEvents.onMouseDown(this.viewHelper.viewDomNode, (e) => this._onMouseDown(e)));

		const onMouseWheel = (browserEvent: IMouseWheelEvent) => {
			this.viewController.emitMouseWheel(browserEvent);

			if (!this._context.configuration.options.get(EditorOption.mouseWheelZoom)) {
				return;
			}
			const e = new StandardWheelEvent(browserEvent);
			const doMouseWheelZoom = (
				platform.isMacintosh
					// on macOS we support cmd + two fingers scroll (`metaKey` set)
					// and also the two fingers pinch gesture (`ctrKey` set)
					? ((browserEvent.metaKey || browserEvent.ctrlKey) && !browserEvent.shiftKey && !browserEvent.altKey)
					: (browserEvent.ctrlKey && !browserEvent.metaKey && !browserEvent.shiftKey && !browserEvent.altKey)
			);
			if (doMouseWheelZoom) {
				const zoomLevel: number = EditorZoom.getZoomLevel();
				const delta = e.deltaY > 0 ? 1 : -1;
				EditorZoom.setZoomLevel(zoomLevel + delta);
				e.preventDefault();
				e.stopPropagation();
			}
		};
		this._register(dom.addDisposableListener(this.viewHelper.viewDomNode, dom.EventType.MOUSE_WHEEL, onMouseWheel, { capture: true, passive: false }));

		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		super.dispose();
	}

	// --- begin event handlers
	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		if (e.hasChanged(EditorOption.layoutInfo)) {
			// layout change
			const height = this._context.configuration.options.get(EditorOption.layoutInfo).height;
			if (this._height !== height) {
				this._height = height;
				this._mouseDownOperation.onHeightChanged();
			}
		}
		return false;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		this._mouseDownOperation.onCursorStateChanged(e);
		return false;
	}
	public override onFocusChanged(e: viewEvents.ViewFocusChangedEvent): boolean {
		return false;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		this._mouseDownOperation.onScrollChanged();
		return false;
	}
	// --- end event handlers

	public getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null {
		const clientPos = new ClientCoordinates(clientX, clientY);
		const pos = clientPos.toPageCoordinates();
		const editorPos = createEditorPagePosition(this.viewHelper.viewDomNode);

		if (pos.y < editorPos.y || pos.y > editorPos.y + editorPos.height || pos.x < editorPos.x || pos.x > editorPos.x + editorPos.width) {
			return null;
		}

		return this.mouseTargetFactory.createMouseTarget(this.viewHelper.getLastRenderData(), editorPos, pos, null);
	}

	protected _createMouseTarget(e: EditorMouseEvent, testEventTarget: boolean): IMouseTarget {
		return this.mouseTargetFactory.createMouseTarget(this.viewHelper.getLastRenderData(), e.editorPos, e.pos, testEventTarget ? e.target : null);
	}

	private _getMouseColumn(e: EditorMouseEvent): number {
		return this.mouseTargetFactory.getMouseColumn(e.editorPos, e.pos);
	}

	protected _onContextMenu(e: EditorMouseEvent, testEventTarget: boolean): void {
		this.viewController.emitContextMenu({
			event: e,
			target: this._createMouseTarget(e, testEventTarget)
		});
	}

	public _onMouseMove(e: EditorMouseEvent): void {
		if (this._mouseDownOperation.isActive()) {
			// In selection/drag operation
			return;
		}
		const actualMouseMoveTime = e.timestamp;
		if (actualMouseMoveTime < this.lastMouseLeaveTime) {
			// Due to throttling, this event occurred before the mouse left the editor, therefore ignore it.
			return;
		}

		this.viewController.emitMouseMove({
			event: e,
			target: this._createMouseTarget(e, true)
		});
	}

	public _onMouseLeave(e: EditorMouseEvent): void {
		this.lastMouseLeaveTime = (new Date()).getTime();
		this.viewController.emitMouseLeave({
			event: e,
			target: null
		});
	}

	public _onMouseUp(e: EditorMouseEvent): void {
		this.viewController.emitMouseUp({
			event: e,
			target: this._createMouseTarget(e, true)
		});
	}

	public _onMouseDown(e: EditorMouseEvent): void {
		const t = this._createMouseTarget(e, true);

		const targetIsContent = (t.type === MouseTargetType.CONTENT_TEXT || t.type === MouseTargetType.CONTENT_EMPTY);
		const targetIsGutter = (t.type === MouseTargetType.GUTTER_GLYPH_MARGIN || t.type === MouseTargetType.GUTTER_LINE_NUMBERS || t.type === MouseTargetType.GUTTER_LINE_DECORATIONS);
		const targetIsLineNumbers = (t.type === MouseTargetType.GUTTER_LINE_NUMBERS);
		const selectOnLineNumbers = this._context.configuration.options.get(EditorOption.selectOnLineNumbers);
		const targetIsViewZone = (t.type === MouseTargetType.CONTENT_VIEW_ZONE || t.type === MouseTargetType.GUTTER_VIEW_ZONE);
		const targetIsWidget = (t.type === MouseTargetType.CONTENT_WIDGET);

		let shouldHandle = e.leftButton || e.middleButton;
		if (platform.isMacintosh && e.leftButton && e.ctrlKey) {
			shouldHandle = false;
		}

		const focus = () => {
			e.preventDefault();
			this.viewHelper.focusTextArea();
		};

		if (shouldHandle && (targetIsContent || (targetIsLineNumbers && selectOnLineNumbers))) {
			focus();
			this._mouseDownOperation.start(t.type, e);

		} else if (targetIsGutter) {
			// Do not steal focus
			e.preventDefault();
		} else if (targetIsViewZone) {
			const viewZoneData = <IViewZoneData>t.detail;
			if (this.viewHelper.shouldSuppressMouseDownOnViewZone(viewZoneData.viewZoneId)) {
				focus();
				this._mouseDownOperation.start(t.type, e);
				e.preventDefault();
			}
		} else if (targetIsWidget && this.viewHelper.shouldSuppressMouseDownOnWidget(<string>t.detail)) {
			focus();
			e.preventDefault();
		}

		this.viewController.emitMouseDown({
			event: e,
			target: t
		});
	}

	public _onMouseWheel(e: IMouseWheelEvent): void {
		this.viewController.emitMouseWheel(e);
	}
}

class MouseDownOperation extends Disposable {

	private readonly _context: ViewContext;
	private readonly _viewController: ViewController;
	private readonly _viewHelper: IPointerHandlerHelper;
	private readonly _createMouseTarget: (e: EditorMouseEvent, testEventTarget: boolean) => IMouseTarget;
	private readonly _getMouseColumn: (e: EditorMouseEvent) => number;

	private readonly _mouseMoveMonitor: GlobalEditorMouseMoveMonitor;
	private readonly _onScrollTimeout: TimeoutTimer;
	private readonly _mouseState: MouseDownState;

	private _currentSelection: Selection;
	private _isActive: boolean;
	private _lastMouseEvent: EditorMouseEvent | null;

	constructor(
		context: ViewContext,
		viewController: ViewController,
		viewHelper: IPointerHandlerHelper,
		createMouseTarget: (e: EditorMouseEvent, testEventTarget: boolean) => IMouseTarget,
		getMouseColumn: (e: EditorMouseEvent) => number
	) {
		super();
		this._context = context;
		this._viewController = viewController;
		this._viewHelper = viewHelper;
		this._createMouseTarget = createMouseTarget;
		this._getMouseColumn = getMouseColumn;

		this._mouseMoveMonitor = this._register(new GlobalEditorMouseMoveMonitor(this._viewHelper.viewDomNode));
		this._onScrollTimeout = this._register(new TimeoutTimer());
		this._mouseState = new MouseDownState();

		this._currentSelection = new Selection(1, 1, 1, 1);
		this._isActive = false;
		this._lastMouseEvent = null;
	}

	public override dispose(): void {
		super.dispose();
	}

	public isActive(): boolean {
		return this._isActive;
	}

	private _onMouseDownThenMove(e: EditorMouseEvent): void {
		this._lastMouseEvent = e;
		this._mouseState.setModifiers(e);

		const position = this._findMousePosition(e, true);
		if (!position) {
			// Ignoring because position is unknown
			return;
		}

		if (this._mouseState.isDragAndDrop) {
			this._viewController.emitMouseDrag({
				event: e,
				target: position
			});
		} else {
			this._dispatchMouse(position, true);
		}
	}

	public start(targetType: MouseTargetType, e: EditorMouseEvent): void {
		this._lastMouseEvent = e;

		this._mouseState.setStartedOnLineNumbers(targetType === MouseTargetType.GUTTER_LINE_NUMBERS);
		this._mouseState.setStartButtons(e);
		this._mouseState.setModifiers(e);
		const position = this._findMousePosition(e, true);
		if (!position || !position.position) {
			// Ignoring because position is unknown
			return;
		}

		this._mouseState.trySetCount(e.detail, position.position);

		// Overwrite the detail of the MouseEvent, as it will be sent out in an event and contributions might rely on it.
		e.detail = this._mouseState.count;

		const options = this._context.configuration.options;

		if (!options.get(EditorOption.readOnly)
			&& options.get(EditorOption.dragAndDrop)
			&& !options.get(EditorOption.columnSelection)
			&& !this._mouseState.altKey // we don't support multiple mouse
			&& e.detail < 2 // only single click on a selection can work
			&& !this._isActive // the mouse is not down yet
			&& !this._currentSelection.isEmpty() // we don't drag single cursor
			&& (position.type === MouseTargetType.CONTENT_TEXT) // single click on text
			&& position.position && this._currentSelection.containsPosition(position.position) // single click on a selection
		) {
			this._mouseState.isDragAndDrop = true;
			this._isActive = true;

			this._mouseMoveMonitor.startMonitoring(
				e.target,
				e.buttons,
				createMouseMoveEventMerger(null),
				(e) => this._onMouseDownThenMove(e),
				(browserEvent?: MouseEvent | KeyboardEvent) => {
					const position = this._findMousePosition(this._lastMouseEvent!, true);

					if (browserEvent && browserEvent instanceof KeyboardEvent) {
						// cancel
						this._viewController.emitMouseDropCanceled();
					} else {
						this._viewController.emitMouseDrop({
							event: this._lastMouseEvent!,
							target: (position ? this._createMouseTarget(this._lastMouseEvent!, true) : null) // Ignoring because position is unknown, e.g., Content View Zone
						});
					}

					this._stop();
				}
			);

			return;
		}

		this._mouseState.isDragAndDrop = false;
		this._dispatchMouse(position, e.shiftKey);

		if (!this._isActive) {
			this._isActive = true;
			this._mouseMoveMonitor.startMonitoring(
				e.target,
				e.buttons,
				createMouseMoveEventMerger(null),
				(e) => this._onMouseDownThenMove(e),
				() => this._stop()
			);
		}
	}

	private _stop(): void {
		this._isActive = false;
		this._onScrollTimeout.cancel();
	}

	public onHeightChanged(): void {
		this._mouseMoveMonitor.stopMonitoring();
	}

	public onScrollChanged(): void {
		if (!this._isActive) {
			return;
		}
		this._onScrollTimeout.setIfNotSet(() => {
			if (!this._lastMouseEvent) {
				return;
			}
			const position = this._findMousePosition(this._lastMouseEvent, false);
			if (!position) {
				// Ignoring because position is unknown
				return;
			}
			if (this._mouseState.isDragAndDrop) {
				// Ignoring because users are dragging the text
				return;
			}
			this._dispatchMouse(position, true);
		}, 10);
	}

	public onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): void {
		this._currentSelection = e.selections[0];
	}

	private _getPositionOutsideEditor(e: EditorMouseEvent): MouseTarget | null {
		const editorContent = e.editorPos;
		const model = this._context.model;
		const viewLayout = this._context.viewLayout;

		const mouseColumn = this._getMouseColumn(e);

		if (e.posy < editorContent.y) {
			const verticalOffset = Math.max(viewLayout.getCurrentScrollTop() - (editorContent.y - e.posy), 0);
			const viewZoneData = HitTestContext.getZoneAtCoord(this._context, verticalOffset);
			if (viewZoneData) {
				const newPosition = this._helpPositionJumpOverViewZone(viewZoneData);
				if (newPosition) {
					return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, newPosition);
				}
			}

			const aboveLineNumber = viewLayout.getLineNumberAtVerticalOffset(verticalOffset);
			return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, new Position(aboveLineNumber, 1));
		}

		if (e.posy > editorContent.y + editorContent.height) {
			const verticalOffset = viewLayout.getCurrentScrollTop() + (e.posy - editorContent.y);
			const viewZoneData = HitTestContext.getZoneAtCoord(this._context, verticalOffset);
			if (viewZoneData) {
				const newPosition = this._helpPositionJumpOverViewZone(viewZoneData);
				if (newPosition) {
					return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, newPosition);
				}
			}

			const belowLineNumber = viewLayout.getLineNumberAtVerticalOffset(verticalOffset);
			return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, new Position(belowLineNumber, model.getLineMaxColumn(belowLineNumber)));
		}

		const possibleLineNumber = viewLayout.getLineNumberAtVerticalOffset(viewLayout.getCurrentScrollTop() + (e.posy - editorContent.y));

		if (e.posx < editorContent.x) {
			return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, new Position(possibleLineNumber, 1));
		}

		if (e.posx > editorContent.x + editorContent.width) {
			return new MouseTarget(null, MouseTargetType.OUTSIDE_EDITOR, mouseColumn, new Position(possibleLineNumber, model.getLineMaxColumn(possibleLineNumber)));
		}

		return null;
	}

	private _findMousePosition(e: EditorMouseEvent, testEventTarget: boolean): MouseTarget | null {
		const positionOutsideEditor = this._getPositionOutsideEditor(e);
		if (positionOutsideEditor) {
			return positionOutsideEditor;
		}

		const t = this._createMouseTarget(e, testEventTarget);
		const hintedPosition = t.position;
		if (!hintedPosition) {
			return null;
		}

		if (t.type === MouseTargetType.CONTENT_VIEW_ZONE || t.type === MouseTargetType.GUTTER_VIEW_ZONE) {
			const newPosition = this._helpPositionJumpOverViewZone(<IViewZoneData>t.detail);
			if (newPosition) {
				return new MouseTarget(t.element, t.type, t.mouseColumn, newPosition, null, t.detail);
			}
		}

		return t;
	}

	private _helpPositionJumpOverViewZone(viewZoneData: IViewZoneData): Position | null {
		// Force position on view zones to go above or below depending on where selection started from
		const selectionStart = new Position(this._currentSelection.selectionStartLineNumber, this._currentSelection.selectionStartColumn);
		const positionBefore = viewZoneData.positionBefore;
		const positionAfter = viewZoneData.positionAfter;

		if (positionBefore && positionAfter) {
			if (positionBefore.isBefore(selectionStart)) {
				return positionBefore;
			} else {
				return positionAfter;
			}
		}
		return null;
	}

	private _dispatchMouse(position: MouseTarget, inSelectionMode: boolean): void {
		if (!position.position) {
			return;
		}
		this._viewController.dispatchMouse({
			position: position.position,
			mouseColumn: position.mouseColumn,
			startedOnLineNumbers: this._mouseState.startedOnLineNumbers,

			inSelectionMode: inSelectionMode,
			mouseDownCount: this._mouseState.count,
			altKey: this._mouseState.altKey,
			ctrlKey: this._mouseState.ctrlKey,
			metaKey: this._mouseState.metaKey,
			shiftKey: this._mouseState.shiftKey,

			leftButton: this._mouseState.leftButton,
			middleButton: this._mouseState.middleButton,
		});
	}
}

class MouseDownState {

	private static readonly CLEAR_MOUSE_DOWN_COUNT_TIME = 400; // ms

	private _altKey: boolean;
	public get altKey(): boolean { return this._altKey; }

	private _ctrlKey: boolean;
	public get ctrlKey(): boolean { return this._ctrlKey; }

	private _metaKey: boolean;
	public get metaKey(): boolean { return this._metaKey; }

	private _shiftKey: boolean;
	public get shiftKey(): boolean { return this._shiftKey; }

	private _leftButton: boolean;
	public get leftButton(): boolean { return this._leftButton; }

	private _middleButton: boolean;
	public get middleButton(): boolean { return this._middleButton; }

	private _startedOnLineNumbers: boolean;
	public get startedOnLineNumbers(): boolean { return this._startedOnLineNumbers; }

	private _lastMouseDownPosition: Position | null;
	private _lastMouseDownPositionEqualCount: number;
	private _lastMouseDownCount: number;
	private _lastSetMouseDownCountTime: number;
	public isDragAndDrop: boolean;

	constructor() {
		this._altKey = false;
		this._ctrlKey = false;
		this._metaKey = false;
		this._shiftKey = false;
		this._leftButton = false;
		this._middleButton = false;
		this._startedOnLineNumbers = false;
		this._lastMouseDownPosition = null;
		this._lastMouseDownPositionEqualCount = 0;
		this._lastMouseDownCount = 0;
		this._lastSetMouseDownCountTime = 0;
		this.isDragAndDrop = false;
	}

	public get count(): number {
		return this._lastMouseDownCount;
	}

	public setModifiers(source: EditorMouseEvent) {
		this._altKey = source.altKey;
		this._ctrlKey = source.ctrlKey;
		this._metaKey = source.metaKey;
		this._shiftKey = source.shiftKey;
	}

	public setStartButtons(source: EditorMouseEvent) {
		this._leftButton = source.leftButton;
		this._middleButton = source.middleButton;
	}

	public setStartedOnLineNumbers(startedOnLineNumbers: boolean): void {
		this._startedOnLineNumbers = startedOnLineNumbers;
	}

	public trySetCount(setMouseDownCount: number, newMouseDownPosition: Position): void {
		// a. Invalidate multiple clicking if too much time has passed (will be hit by IE because the detail field of mouse events contains garbage in IE10)
		const currentTime = (new Date()).getTime();
		if (currentTime - this._lastSetMouseDownCountTime > MouseDownState.CLEAR_MOUSE_DOWN_COUNT_TIME) {
			setMouseDownCount = 1;
		}
		this._lastSetMouseDownCountTime = currentTime;

		// b. Ensure that we don't jump from single click to triple click in one go (will be hit by IE because the detail field of mouse events contains garbage in IE10)
		if (setMouseDownCount > this._lastMouseDownCount + 1) {
			setMouseDownCount = this._lastMouseDownCount + 1;
		}

		// c. Invalidate multiple clicking if the logical position is different
		if (this._lastMouseDownPosition && this._lastMouseDownPosition.equals(newMouseDownPosition)) {
			this._lastMouseDownPositionEqualCount++;
		} else {
			this._lastMouseDownPositionEqualCount = 1;
		}
		this._lastMouseDownPosition = newMouseDownPosition;

		// Finally set the lastMouseDownCount
		this._lastMouseDownCount = Math.min(setMouseDownCount, this._lastMouseDownPositionEqualCount);
	}

}
