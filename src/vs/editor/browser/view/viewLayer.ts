/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { IStringBuilder, createStringBuilder } from 'vs/editor/common/core/stringBuilder';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { ViewportData } from 'vs/editor/common/viewLayout/viewLinesViewportData';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

/**
 * Represents a visible line
 */
export interface IVisibleLine extends ILine {
	getDomNode(): HTMLElement | null;
	setDomNode(domNode: HTMLElement): void;

	/**
	 * Return null if the HTML should not be touched.
	 * Return the new HTML otherwise.
	 */
	renderLine(lineNumber: number, deltaTop: number, viewportData: ViewportData, sb: IStringBuilder): boolean;

	/**
	 * Layout the line.
	 */
	layoutLine(lineNumber: number, deltaTop: number): void;
}

export interface ILine {
	onContentChanged(): void;
	onTokensChanged(): void;
}

export class RenderedLinesCollection<T extends ILine> {
	private readonly _createLine: () => T;
	private _lines!: T[];
	private _rendLineNumberStart!: number;

	constructor(createLine: () => T) {
		this._createLine = createLine;
		this._set(1, []);
	}

	public flush(): void {
		this._set(1, []);
	}

	_set(rendLineNumberStart: number, lines: T[]): void {
		this._lines = lines;
		this._rendLineNumberStart = rendLineNumberStart;
	}

	_get(): { rendLineNumberStart: number; lines: T[]; } {
		return {
			rendLineNumberStart: this._rendLineNumberStart,
			lines: this._lines
		};
	}

	/**
	 * @returns Inclusive line number that is inside this collection
	 */
	public getStartLineNumber(): number {
		return this._rendLineNumberStart;
	}

	/**
	 * @returns Inclusive line number that is inside this collection
	 */
	public getEndLineNumber(): number {
		return this._rendLineNumberStart + this._lines.length - 1;
	}

	public getCount(): number {
		return this._lines.length;
	}

	public getLine(lineNumber: number): T {
		const lineIndex = lineNumber - this._rendLineNumberStart;
		if (lineIndex < 0 || lineIndex >= this._lines.length) {
			throw new Error('Illegal value for lineNumber');
		}
		return this._lines[lineIndex];
	}

	/**
	 * @returns Lines that were removed from this collection
	 */
	public onLinesDeleted(deleteFromLineNumber: number, deleteToLineNumber: number): T[] | null {
		if (this.getCount() === 0) {
			// no lines
			return null;
		}

		const startLineNumber = this.getStartLineNumber();
		const endLineNumber = this.getEndLineNumber();

		if (deleteToLineNumber < startLineNumber) {
			// deleting above the viewport
			const deleteCnt = deleteToLineNumber - deleteFromLineNumber + 1;
			this._rendLineNumberStart -= deleteCnt;
			return null;
		}

		if (deleteFromLineNumber > endLineNumber) {
			// deleted below the viewport
			return null;
		}

		// Record what needs to be deleted
		let deleteStartIndex = 0;
		let deleteCount = 0;
		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const lineIndex = lineNumber - this._rendLineNumberStart;

			if (deleteFromLineNumber <= lineNumber && lineNumber <= deleteToLineNumber) {
				// this is a line to be deleted
				if (deleteCount === 0) {
					// this is the first line to be deleted
					deleteStartIndex = lineIndex;
					deleteCount = 1;
				} else {
					deleteCount++;
				}
			}
		}

		// Adjust this._rendLineNumberStart for lines deleted above
		if (deleteFromLineNumber < startLineNumber) {
			// Something was deleted above
			let deleteAboveCount = 0;

			if (deleteToLineNumber < startLineNumber) {
				// the entire deleted lines are above
				deleteAboveCount = deleteToLineNumber - deleteFromLineNumber + 1;
			} else {
				deleteAboveCount = startLineNumber - deleteFromLineNumber;
			}

			this._rendLineNumberStart -= deleteAboveCount;
		}

		const deleted = this._lines.splice(deleteStartIndex, deleteCount);
		return deleted;
	}

	public onLinesChanged(changeFromLineNumber: number, changeToLineNumber: number): boolean {
		if (this.getCount() === 0) {
			// no lines
			return false;
		}

		const startLineNumber = this.getStartLineNumber();
		const endLineNumber = this.getEndLineNumber();

		let someoneNotified = false;

		for (let changedLineNumber = changeFromLineNumber; changedLineNumber <= changeToLineNumber; changedLineNumber++) {
			if (changedLineNumber >= startLineNumber && changedLineNumber <= endLineNumber) {
				// Notify the line
				this._lines[changedLineNumber - this._rendLineNumberStart].onContentChanged();
				someoneNotified = true;
			}
		}

		return someoneNotified;
	}

	public onLinesInserted(insertFromLineNumber: number, insertToLineNumber: number): T[] | null {
		if (this.getCount() === 0) {
			// no lines
			return null;
		}

		const insertCnt = insertToLineNumber - insertFromLineNumber + 1;
		const startLineNumber = this.getStartLineNumber();
		const endLineNumber = this.getEndLineNumber();

		if (insertFromLineNumber <= startLineNumber) {
			// inserting above the viewport
			this._rendLineNumberStart += insertCnt;
			return null;
		}

		if (insertFromLineNumber > endLineNumber) {
			// inserting below the viewport
			return null;
		}

		if (insertCnt + insertFromLineNumber > endLineNumber) {
			// insert inside the viewport in such a way that all remaining lines are pushed outside
			const deleted = this._lines.splice(insertFromLineNumber - this._rendLineNumberStart, endLineNumber - insertFromLineNumber + 1);
			return deleted;
		}

		// insert inside the viewport, push out some lines, but not all remaining lines
		const newLines: T[] = [];
		for (let i = 0; i < insertCnt; i++) {
			newLines[i] = this._createLine();
		}
		const insertIndex = insertFromLineNumber - this._rendLineNumberStart;
		const beforeLines = this._lines.slice(0, insertIndex);
		const afterLines = this._lines.slice(insertIndex, this._lines.length - insertCnt);
		const deletedLines = this._lines.slice(this._lines.length - insertCnt, this._lines.length);

		this._lines = beforeLines.concat(newLines).concat(afterLines);

		return deletedLines;
	}

	public onTokensChanged(ranges: { fromLineNumber: number; toLineNumber: number; }[]): boolean {
		if (this.getCount() === 0) {
			// no lines
			return false;
		}

		const startLineNumber = this.getStartLineNumber();
		const endLineNumber = this.getEndLineNumber();

		let notifiedSomeone = false;
		for (let i = 0, len = ranges.length; i < len; i++) {
			const rng = ranges[i];

			if (rng.toLineNumber < startLineNumber || rng.fromLineNumber > endLineNumber) {
				// range outside viewport
				continue;
			}

			const from = Math.max(startLineNumber, rng.fromLineNumber);
			const to = Math.min(endLineNumber, rng.toLineNumber);

			for (let lineNumber = from; lineNumber <= to; lineNumber++) {
				const lineIndex = lineNumber - this._rendLineNumberStart;
				this._lines[lineIndex].onTokensChanged();
				notifiedSomeone = true;
			}
		}

		return notifiedSomeone;
	}
}

export interface IVisibleLinesHost<T extends IVisibleLine> {
	createVisibleLine(): T;
}

export class VisibleLinesCollection<T extends IVisibleLine> {

	private readonly _host: IVisibleLinesHost<T>;
	public readonly domNode: FastDomNode<HTMLElement>;
	private readonly _linesCollection: RenderedLinesCollection<T>;

	constructor(host: IVisibleLinesHost<T>) {
		this._host = host;
		this.domNode = this._createDomNode();
		this._linesCollection = new RenderedLinesCollection<T>(() => this._host.createVisibleLine());
	}

	private _createDomNode(): FastDomNode<HTMLElement> {
		const domNode = createFastDomNode(document.createElement('div'));
		domNode.setClassName('view-layer');
		domNode.setPosition('absolute');
		domNode.domNode.setAttribute('role', 'presentation');
		domNode.domNode.setAttribute('aria-hidden', 'true');
		return domNode;
	}

	// ---- begin view event handlers

	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		if (e.hasChanged(EditorOption.layoutInfo)) {
			return true;
		}
		return false;
	}

	public onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		this._linesCollection.flush();
		// No need to clear the dom node because a full .innerHTML will occur in ViewLayerRenderer._render
		return true;
	}

	public onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return this._linesCollection.onLinesChanged(e.fromLineNumber, e.toLineNumber);
	}

	public onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		const deleted = this._linesCollection.onLinesDeleted(e.fromLineNumber, e.toLineNumber);
		if (deleted) {
			// Remove from DOM
			for (let i = 0, len = deleted.length; i < len; i++) {
				const lineDomNode = deleted[i].getDomNode();
				if (lineDomNode) {
					this.domNode.domNode.removeChild(lineDomNode);
				}
			}
		}

		return true;
	}

	public onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		const deleted = this._linesCollection.onLinesInserted(e.fromLineNumber, e.toLineNumber);
		if (deleted) {
			// Remove from DOM
			for (let i = 0, len = deleted.length; i < len; i++) {
				const lineDomNode = deleted[i].getDomNode();
				if (lineDomNode) {
					this.domNode.domNode.removeChild(lineDomNode);
				}
			}
		}

		return true;
	}

	public onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollTopChanged;
	}

	public onTokensChanged(e: viewEvents.ViewTokensChangedEvent): boolean {
		return this._linesCollection.onTokensChanged(e.ranges);
	}

	public onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}

	// ---- end view event handlers

	public getStartLineNumber(): number {
		return this._linesCollection.getStartLineNumber();
	}

	public getEndLineNumber(): number {
		return this._linesCollection.getEndLineNumber();
	}

	public getVisibleLine(lineNumber: number): T {
		return this._linesCollection.getLine(lineNumber);
	}

	public renderLines(viewportData: ViewportData): void {

		const inp = this._linesCollection._get();

		const renderer = new ViewLayerRenderer<T>(this.domNode.domNode, this._host, viewportData);

		const ctx: IRendererContext<T> = {
			rendLineNumberStart: inp.rendLineNumberStart,
			lines: inp.lines,
			linesLength: inp.lines.length
		};

		// Decide if this render will do a single update (single large .innerHTML) or many updates (inserting/removing dom nodes)
		const resCtx = renderer.render(ctx, viewportData.startLineNumber, viewportData.endLineNumber, viewportData.relativeVerticalOffset);

		this._linesCollection._set(resCtx.rendLineNumberStart, resCtx.lines);
	}
}

interface IRendererContext<T extends IVisibleLine> {
	rendLineNumberStart: number;
	lines: T[];
	linesLength: number;
}

class ViewLayerRenderer<T extends IVisibleLine> {

	readonly domNode: HTMLElement;
	readonly host: IVisibleLinesHost<T>;
	readonly viewportData: ViewportData;

	constructor(domNode: HTMLElement, host: IVisibleLinesHost<T>, viewportData: ViewportData) {
		this.domNode = domNode;
		this.host = host;
		this.viewportData = viewportData;
	}

	public render(inContext: IRendererContext<T>, startLineNumber: number, stopLineNumber: number, deltaTop: number[]): IRendererContext<T> {

		const ctx: IRendererContext<T> = {
			rendLineNumberStart: inContext.rendLineNumberStart,
			lines: inContext.lines.slice(0),
			linesLength: inContext.linesLength
		};

		if ((ctx.rendLineNumberStart + ctx.linesLength - 1 < startLineNumber) || (stopLineNumber < ctx.rendLineNumberStart)) {
			// There is no overlap whatsoever
			ctx.rendLineNumberStart = startLineNumber;
			ctx.linesLength = stopLineNumber - startLineNumber + 1;
			ctx.lines = [];
			for (let x = startLineNumber; x <= stopLineNumber; x++) {
				ctx.lines[x - startLineNumber] = this.host.createVisibleLine();
			}
			this._finishRendering(ctx, true, deltaTop);
			return ctx;
		}

		// Update lines which will remain untouched
		this._renderUntouchedLines(
			ctx,
			Math.max(startLineNumber - ctx.rendLineNumberStart, 0),
			Math.min(stopLineNumber - ctx.rendLineNumberStart, ctx.linesLength - 1),
			deltaTop,
			startLineNumber
		);

		if (ctx.rendLineNumberStart > startLineNumber) {
			// Insert lines before
			const fromLineNumber = startLineNumber;
			const toLineNumber = Math.min(stopLineNumber, ctx.rendLineNumberStart - 1);
			if (fromLineNumber <= toLineNumber) {
				this._insertLinesBefore(ctx, fromLineNumber, toLineNumber, deltaTop, startLineNumber);
				ctx.linesLength += toLineNumber - fromLineNumber + 1;
			}
		} else if (ctx.rendLineNumberStart < startLineNumber) {
			// Remove lines before
			const removeCnt = Math.min(ctx.linesLength, startLineNumber - ctx.rendLineNumberStart);
			if (removeCnt > 0) {
				this._removeLinesBefore(ctx, removeCnt);
				ctx.linesLength -= removeCnt;
			}
		}

		ctx.rendLineNumberStart = startLineNumber;

		if (ctx.rendLineNumberStart + ctx.linesLength - 1 < stopLineNumber) {
			// Insert lines after
			const fromLineNumber = ctx.rendLineNumberStart + ctx.linesLength;
			const toLineNumber = stopLineNumber;

			if (fromLineNumber <= toLineNumber) {
				this._insertLinesAfter(ctx, fromLineNumber, toLineNumber, deltaTop, startLineNumber);
				ctx.linesLength += toLineNumber - fromLineNumber + 1;
			}

		} else if (ctx.rendLineNumberStart + ctx.linesLength - 1 > stopLineNumber) {
			// Remove lines after
			const fromLineNumber = Math.max(0, stopLineNumber - ctx.rendLineNumberStart + 1);
			const toLineNumber = ctx.linesLength - 1;
			const removeCnt = toLineNumber - fromLineNumber + 1;

			if (removeCnt > 0) {
				this._removeLinesAfter(ctx, removeCnt);
				ctx.linesLength -= removeCnt;
			}
		}

		this._finishRendering(ctx, false, deltaTop);

		return ctx;
	}

	private _renderUntouchedLines(ctx: IRendererContext<T>, startIndex: number, endIndex: number, deltaTop: number[], deltaLN: number): void {
		const rendLineNumberStart = ctx.rendLineNumberStart;
		const lines = ctx.lines;

		for (let i = startIndex; i <= endIndex; i++) {
			const lineNumber = rendLineNumberStart + i;
			lines[i].layoutLine(lineNumber, deltaTop[lineNumber - deltaLN]);
		}
	}

	private _insertLinesBefore(ctx: IRendererContext<T>, fromLineNumber: number, toLineNumber: number, deltaTop: number[], deltaLN: number): void {
		const newLines: T[] = [];
		let newLinesLen = 0;
		for (let lineNumber = fromLineNumber; lineNumber <= toLineNumber; lineNumber++) {
			newLines[newLinesLen++] = this.host.createVisibleLine();
		}
		ctx.lines = newLines.concat(ctx.lines);
	}

	private _removeLinesBefore(ctx: IRendererContext<T>, removeCount: number): void {
		for (let i = 0; i < removeCount; i++) {
			const lineDomNode = ctx.lines[i].getDomNode();
			if (lineDomNode) {
				this.domNode.removeChild(lineDomNode);
			}
		}
		ctx.lines.splice(0, removeCount);
	}

	private _insertLinesAfter(ctx: IRendererContext<T>, fromLineNumber: number, toLineNumber: number, deltaTop: number[], deltaLN: number): void {
		const newLines: T[] = [];
		let newLinesLen = 0;
		for (let lineNumber = fromLineNumber; lineNumber <= toLineNumber; lineNumber++) {
			newLines[newLinesLen++] = this.host.createVisibleLine();
		}
		ctx.lines = ctx.lines.concat(newLines);
	}

	private _removeLinesAfter(ctx: IRendererContext<T>, removeCount: number): void {
		const removeIndex = ctx.linesLength - removeCount;

		for (let i = 0; i < removeCount; i++) {
			const lineDomNode = ctx.lines[removeIndex + i].getDomNode();
			if (lineDomNode) {
				this.domNode.removeChild(lineDomNode);
			}
		}
		ctx.lines.splice(removeIndex, removeCount);
	}

	private _finishRenderingNewLines(ctx: IRendererContext<T>, domNodeIsEmpty: boolean, newLinesHTML: string, wasNew: boolean[]): void {
		const lastChild = <HTMLElement>this.domNode.lastChild;
		if (domNodeIsEmpty || !lastChild) {
			this.domNode.innerHTML = newLinesHTML;
		} else {
			lastChild.insertAdjacentHTML('afterend', newLinesHTML);
		}

		let currChild = <HTMLElement>this.domNode.lastChild;
		for (let i = ctx.linesLength - 1; i >= 0; i--) {
			const line = ctx.lines[i];
			if (wasNew[i]) {
				line.setDomNode(currChild);
				currChild = <HTMLElement>currChild.previousSibling;
			}
		}
	}

	private _finishRenderingInvalidLines(ctx: IRendererContext<T>, invalidLinesHTML: string, wasInvalid: boolean[]): void {
		const hugeDomNode = document.createElement('div');

		hugeDomNode.innerHTML = invalidLinesHTML;

		for (let i = 0; i < ctx.linesLength; i++) {
			const line = ctx.lines[i];
			if (wasInvalid[i]) {
				const source = <HTMLElement>hugeDomNode.firstChild;
				const lineDomNode = line.getDomNode()!;
				lineDomNode.parentNode!.replaceChild(source, lineDomNode);
				line.setDomNode(source);
			}
		}
	}

	private static readonly _sb = createStringBuilder(100000);

	private _finishRendering(ctx: IRendererContext<T>, domNodeIsEmpty: boolean, deltaTop: number[]): void {

		const sb = ViewLayerRenderer._sb;
		const linesLength = ctx.linesLength;
		const lines = ctx.lines;
		const rendLineNumberStart = ctx.rendLineNumberStart;

		const wasNew: boolean[] = [];
		{
			sb.reset();
			let hadNewLine = false;

			for (let i = 0; i < linesLength; i++) {
				const line = lines[i];
				wasNew[i] = false;

				const lineDomNode = line.getDomNode();
				if (lineDomNode) {
					// line is not new
					continue;
				}

				const renderResult = line.renderLine(i + rendLineNumberStart, deltaTop[i], this.viewportData, sb);
				if (!renderResult) {
					// line does not need rendering
					continue;
				}

				wasNew[i] = true;
				hadNewLine = true;
			}

			if (hadNewLine) {
				this._finishRenderingNewLines(ctx, domNodeIsEmpty, sb.build(), wasNew);
			}
		}

		{
			sb.reset();

			let hadInvalidLine = false;
			const wasInvalid: boolean[] = [];

			for (let i = 0; i < linesLength; i++) {
				const line = lines[i];
				wasInvalid[i] = false;

				if (wasNew[i]) {
					// line was new
					continue;
				}

				const renderResult = line.renderLine(i + rendLineNumberStart, deltaTop[i], this.viewportData, sb);
				if (!renderResult) {
					// line does not need rendering
					continue;
				}

				wasInvalid[i] = true;
				hadInvalidLine = true;
			}

			if (hadInvalidLine) {
				this._finishRenderingInvalidLines(ctx, sb.build(), wasInvalid);
			}
		}
	}
}
