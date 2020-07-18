/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IViewZone, IViewZoneChangeAccessor } from 'vs/editor/browser/editorBrowser';
import { ViewPart } from 'vs/editor/browser/view/viewPart';
import { Position } from 'vs/editor/common/core/position';
import { RenderingContext, RestrictedRenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { IViewWhitespaceViewportData } from 'vs/editor/common/viewModel/viewModel';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IWhitespaceChangeAccessor, IEditorWhitespace } from 'vs/editor/common/viewLayout/linesLayout';

export interface IMyViewZone {
	whitespaceId: string;
	delegate: IViewZone;
	isVisible: boolean;
	domNode: FastDomNode<HTMLElement>;
	marginDomNode: FastDomNode<HTMLElement> | null;
}

interface IComputedViewZoneProps {
	afterViewLineNumber: number;
	heightInPx: number;
	minWidthInPx: number;
}

const invalidFunc = () => { throw new Error(`Invalid change accessor`); };

export class ViewZones extends ViewPart {

	private _zones: { [id: string]: IMyViewZone; };
	private _lineHeight: number;
	private _contentWidth: number;
	private _contentLeft: number;

	public domNode: FastDomNode<HTMLElement>;

	public marginDomNode: FastDomNode<HTMLElement>;

	constructor(context: ViewContext) {
		super(context);
		const options = this._context.configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._contentWidth = layoutInfo.contentWidth;
		this._contentLeft = layoutInfo.contentLeft;

		this.domNode = createFastDomNode(document.createElement('div'));
		this.domNode.setClassName('view-zones');
		this.domNode.setPosition('absolute');
		this.domNode.setAttribute('role', 'presentation');
		this.domNode.setAttribute('aria-hidden', 'true');

		this.marginDomNode = createFastDomNode(document.createElement('div'));
		this.marginDomNode.setClassName('margin-view-zones');
		this.marginDomNode.setPosition('absolute');
		this.marginDomNode.setAttribute('role', 'presentation');
		this.marginDomNode.setAttribute('aria-hidden', 'true');

		this._zones = {};
	}

	public dispose(): void {
		super.dispose();
		this._zones = {};
	}

	// ---- begin view event handlers

	private _recomputeWhitespacesProps(): boolean {
		const whitespaces = this._context.viewLayout.getWhitespaces();
		const oldWhitespaces = new Map<string, IEditorWhitespace>();
		for (const whitespace of whitespaces) {
			oldWhitespaces.set(whitespace.id, whitespace);
		}
		let hadAChange = false;
		this._context.model.changeWhitespace((whitespaceAccessor: IWhitespaceChangeAccessor) => {
			const keys = Object.keys(this._zones);
			for (let i = 0, len = keys.length; i < len; i++) {
				const id = keys[i];
				const zone = this._zones[id];
				const props = this._computeWhitespaceProps(zone.delegate);
				const oldWhitespace = oldWhitespaces.get(id);
				if (oldWhitespace && (oldWhitespace.afterLineNumber !== props.afterViewLineNumber || oldWhitespace.height !== props.heightInPx)) {
					whitespaceAccessor.changeOneWhitespace(id, props.afterViewLineNumber, props.heightInPx);
					this._safeCallOnComputedHeight(zone.delegate, props.heightInPx);
					hadAChange = true;
				}
			}
		});
		return hadAChange;
	}

	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._contentWidth = layoutInfo.contentWidth;
		this._contentLeft = layoutInfo.contentLeft;

		if (e.hasChanged(EditorOption.lineHeight)) {
			this._recomputeWhitespacesProps();
		}

		return true;
	}

	public onLineMappingChanged(e: viewEvents.ViewLineMappingChangedEvent): boolean {
		return this._recomputeWhitespacesProps();
	}

	public onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return true;
	}

	public onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollTopChanged || e.scrollWidthChanged;
	}

	public onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}

	public onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return true;
	}

	// ---- end view event handlers

	private _getZoneOrdinal(zone: IViewZone): number {

		if (typeof zone.afterColumn !== 'undefined') {
			return zone.afterColumn;
		}

		return 10000;
	}

	private _computeWhitespaceProps(zone: IViewZone): IComputedViewZoneProps {
		if (zone.afterLineNumber === 0) {
			return {
				afterViewLineNumber: 0,
				heightInPx: this._heightInPixels(zone),
				minWidthInPx: this._minWidthInPixels(zone)
			};
		}

		let zoneAfterModelPosition: Position;
		if (typeof zone.afterColumn !== 'undefined') {
			zoneAfterModelPosition = this._context.model.validateModelPosition({
				lineNumber: zone.afterLineNumber,
				column: zone.afterColumn
			});
		} else {
			const validAfterLineNumber = this._context.model.validateModelPosition({
				lineNumber: zone.afterLineNumber,
				column: 1
			}).lineNumber;

			zoneAfterModelPosition = new Position(
				validAfterLineNumber,
				this._context.model.getModelLineMaxColumn(validAfterLineNumber)
			);
		}

		let zoneBeforeModelPosition: Position;
		if (zoneAfterModelPosition.column === this._context.model.getModelLineMaxColumn(zoneAfterModelPosition.lineNumber)) {
			zoneBeforeModelPosition = this._context.model.validateModelPosition({
				lineNumber: zoneAfterModelPosition.lineNumber + 1,
				column: 1
			});
		} else {
			zoneBeforeModelPosition = this._context.model.validateModelPosition({
				lineNumber: zoneAfterModelPosition.lineNumber,
				column: zoneAfterModelPosition.column + 1
			});
		}

		const viewPosition = this._context.model.coordinatesConverter.convertModelPositionToViewPosition(zoneAfterModelPosition);
		const isVisible = this._context.model.coordinatesConverter.modelPositionIsVisible(zoneBeforeModelPosition);
		return {
			afterViewLineNumber: viewPosition.lineNumber,
			heightInPx: (isVisible ? this._heightInPixels(zone) : 0),
			minWidthInPx: this._minWidthInPixels(zone)
		};
	}

	public changeViewZones(callback: (changeAccessor: IViewZoneChangeAccessor) => any): boolean {
		let zonesHaveChanged = false;

		this._context.model.changeWhitespace((whitespaceAccessor: IWhitespaceChangeAccessor) => {

			const changeAccessor: IViewZoneChangeAccessor = {
				addZone: (zone: IViewZone): string => {
					zonesHaveChanged = true;
					return this._addZone(whitespaceAccessor, zone);
				},
				removeZone: (id: string): void => {
					if (!id) {
						return;
					}
					zonesHaveChanged = this._removeZone(whitespaceAccessor, id) || zonesHaveChanged;
				},
				layoutZone: (id: string): void => {
					if (!id) {
						return;
					}
					zonesHaveChanged = this._layoutZone(whitespaceAccessor, id) || zonesHaveChanged;
				}
			};

			safeInvoke1Arg(callback, changeAccessor);

			// Invalidate changeAccessor
			changeAccessor.addZone = invalidFunc;
			changeAccessor.removeZone = invalidFunc;
			changeAccessor.layoutZone = invalidFunc;
		});

		return zonesHaveChanged;
	}

	private _addZone(whitespaceAccessor: IWhitespaceChangeAccessor, zone: IViewZone): string {
		const props = this._computeWhitespaceProps(zone);
		const whitespaceId = whitespaceAccessor.insertWhitespace(props.afterViewLineNumber, this._getZoneOrdinal(zone), props.heightInPx, props.minWidthInPx);

		const myZone: IMyViewZone = {
			whitespaceId: whitespaceId,
			delegate: zone,
			isVisible: false,
			domNode: createFastDomNode(zone.domNode),
			marginDomNode: zone.marginDomNode ? createFastDomNode(zone.marginDomNode) : null
		};

		this._safeCallOnComputedHeight(myZone.delegate, props.heightInPx);

		myZone.domNode.setPosition('absolute');
		myZone.domNode.domNode.style.width = '100%';
		myZone.domNode.setDisplay('none');
		myZone.domNode.setAttribute('monaco-view-zone', myZone.whitespaceId);
		this.domNode.appendChild(myZone.domNode);

		if (myZone.marginDomNode) {
			myZone.marginDomNode.setPosition('absolute');
			myZone.marginDomNode.domNode.style.width = '100%';
			myZone.marginDomNode.setDisplay('none');
			myZone.marginDomNode.setAttribute('monaco-view-zone', myZone.whitespaceId);
			this.marginDomNode.appendChild(myZone.marginDomNode);
		}

		this._zones[myZone.whitespaceId] = myZone;


		this.setShouldRender();

		return myZone.whitespaceId;
	}

	private _removeZone(whitespaceAccessor: IWhitespaceChangeAccessor, id: string): boolean {
		if (this._zones.hasOwnProperty(id)) {
			const zone = this._zones[id];
			delete this._zones[id];
			whitespaceAccessor.removeWhitespace(zone.whitespaceId);

			zone.domNode.removeAttribute('monaco-visible-view-zone');
			zone.domNode.removeAttribute('monaco-view-zone');
			zone.domNode.domNode.parentNode!.removeChild(zone.domNode.domNode);

			if (zone.marginDomNode) {
				zone.marginDomNode.removeAttribute('monaco-visible-view-zone');
				zone.marginDomNode.removeAttribute('monaco-view-zone');
				zone.marginDomNode.domNode.parentNode!.removeChild(zone.marginDomNode.domNode);
			}

			this.setShouldRender();

			return true;
		}
		return false;
	}

	private _layoutZone(whitespaceAccessor: IWhitespaceChangeAccessor, id: string): boolean {
		if (this._zones.hasOwnProperty(id)) {
			const zone = this._zones[id];
			const props = this._computeWhitespaceProps(zone.delegate);
			// const newOrdinal = this._getZoneOrdinal(zone.delegate);
			whitespaceAccessor.changeOneWhitespace(zone.whitespaceId, props.afterViewLineNumber, props.heightInPx);
			// TODO@Alex: change `newOrdinal` too

			this._safeCallOnComputedHeight(zone.delegate, props.heightInPx);
			this.setShouldRender();

			return true;
		}
		return false;
	}

	public shouldSuppressMouseDownOnViewZone(id: string): boolean {
		if (this._zones.hasOwnProperty(id)) {
			const zone = this._zones[id];
			return Boolean(zone.delegate.suppressMouseDown);
		}
		return false;
	}

	private _heightInPixels(zone: IViewZone): number {
		if (typeof zone.heightInPx === 'number') {
			return zone.heightInPx;
		}
		if (typeof zone.heightInLines === 'number') {
			return this._lineHeight * zone.heightInLines;
		}
		return this._lineHeight;
	}

	private _minWidthInPixels(zone: IViewZone): number {
		if (typeof zone.minWidthInPx === 'number') {
			return zone.minWidthInPx;
		}
		return 0;
	}

	private _safeCallOnComputedHeight(zone: IViewZone, height: number): void {
		if (typeof zone.onComputedHeight === 'function') {
			try {
				zone.onComputedHeight(height);
			} catch (e) {
				onUnexpectedError(e);
			}
		}
	}

	private _safeCallOnDomNodeTop(zone: IViewZone, top: number): void {
		if (typeof zone.onDomNodeTop === 'function') {
			try {
				zone.onDomNodeTop(top);
			} catch (e) {
				onUnexpectedError(e);
			}
		}
	}

	public prepareRender(ctx: RenderingContext): void {
		// Nothing to read
	}

	public render(ctx: RestrictedRenderingContext): void {
		const visibleWhitespaces = ctx.viewportData.whitespaceViewportData;
		const visibleZones: { [id: string]: IViewWhitespaceViewportData; } = {};

		let hasVisibleZone = false;
		for (let i = 0, len = visibleWhitespaces.length; i < len; i++) {
			visibleZones[visibleWhitespaces[i].id] = visibleWhitespaces[i];
			hasVisibleZone = true;
		}

		const keys = Object.keys(this._zones);
		for (let i = 0, len = keys.length; i < len; i++) {
			const id = keys[i];
			const zone = this._zones[id];

			let newTop = 0;
			let newHeight = 0;
			let newDisplay = 'none';
			if (visibleZones.hasOwnProperty(id)) {
				newTop = visibleZones[id].verticalOffset - ctx.bigNumbersDelta;
				newHeight = visibleZones[id].height;
				newDisplay = 'block';
				// zone is visible
				if (!zone.isVisible) {
					zone.domNode.setAttribute('monaco-visible-view-zone', 'true');
					zone.isVisible = true;
				}
				this._safeCallOnDomNodeTop(zone.delegate, ctx.getScrolledTopFromAbsoluteTop(visibleZones[id].verticalOffset));
			} else {
				if (zone.isVisible) {
					zone.domNode.removeAttribute('monaco-visible-view-zone');
					zone.isVisible = false;
				}
				this._safeCallOnDomNodeTop(zone.delegate, ctx.getScrolledTopFromAbsoluteTop(-1000000));
			}
			zone.domNode.setTop(newTop);
			zone.domNode.setHeight(newHeight);
			zone.domNode.setDisplay(newDisplay);

			if (zone.marginDomNode) {
				zone.marginDomNode.setTop(newTop);
				zone.marginDomNode.setHeight(newHeight);
				zone.marginDomNode.setDisplay(newDisplay);
			}
		}

		if (hasVisibleZone) {
			this.domNode.setWidth(Math.max(ctx.scrollWidth, this._contentWidth));
			this.marginDomNode.setWidth(this._contentLeft);
		}
	}
}

function safeInvoke1Arg(func: Function, arg1: any): any {
	try {
		return func(arg1);
	} catch (e) {
		onUnexpectedError(e);
	}
}
