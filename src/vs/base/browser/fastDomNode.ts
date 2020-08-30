/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';

export class FastDomNode<T extends HTMLElement> {

	public readonly domNode: T;
	private _maxWidth: number;
	private _width: number;
	private _height: number;
	private _top: number;
	private _left: number;
	private _bottom: number;
	private _right: number;
	private _fontFamily: string;
	private _fontWeight: string;
	private _fontSize: number;
	private _fontFeatureSettings: string;
	private _lineHeight: number;
	private _letterSpacing: number;
	private _className: string;
	private _display: string;
	private _position: string;
	private _visibility: string;
	private _backgroundColor: string;
	private _layerHint: boolean;
	private _contain: 'none' | 'strict' | 'content' | 'size' | 'layout' | 'style' | 'paint';
	private _boxShadow: string;

	constructor(domNode: T) {
		this.domNode = domNode;
		this._maxWidth = -1;
		this._width = -1;
		this._height = -1;
		this._top = -1;
		this._left = -1;
		this._bottom = -1;
		this._right = -1;
		this._fontFamily = '';
		this._fontWeight = '';
		this._fontSize = -1;
		this._fontFeatureSettings = '';
		this._lineHeight = -1;
		this._letterSpacing = -100;
		this._className = '';
		this._display = '';
		this._position = '';
		this._visibility = '';
		this._backgroundColor = '';
		this._layerHint = false;
		this._contain = 'none';
		this._boxShadow = '';
	}

	public setMaxWidth(maxWidth: number): void {
		if (this._maxWidth === maxWidth) {
			return;
		}
		this._maxWidth = maxWidth;
		this.domNode.style.maxWidth = this._maxWidth + 'px';
	}

	public setWidth(width: number): void {
		if (this._width === width) {
			return;
		}
		this._width = width;
		this.domNode.style.width = this._width + 'px';
	}

	public setHeight(height: number): void {
		if (this._height === height) {
			return;
		}
		this._height = height;
		this.domNode.style.height = this._height + 'px';
	}

	public setTop(top: number): void {
		if (this._top === top) {
			return;
		}
		this._top = top;
		this.domNode.style.top = this._top + 'px';
	}

	public unsetTop(): void {
		if (this._top === -1) {
			return;
		}
		this._top = -1;
		this.domNode.style.top = '';
	}

	public setLeft(left: number): void {
		if (this._left === left) {
			return;
		}
		this._left = left;
		this.domNode.style.left = this._left + 'px';
	}

	public setBottom(bottom: number): void {
		if (this._bottom === bottom) {
			return;
		}
		this._bottom = bottom;
		this.domNode.style.bottom = this._bottom + 'px';
	}

	public setRight(right: number): void {
		if (this._right === right) {
			return;
		}
		this._right = right;
		this.domNode.style.right = this._right + 'px';
	}

	public setFontFamily(fontFamily: string): void {
		if (this._fontFamily === fontFamily) {
			return;
		}
		this._fontFamily = fontFamily;
		this.domNode.style.fontFamily = this._fontFamily;
	}

	public setFontWeight(fontWeight: string): void {
		if (this._fontWeight === fontWeight) {
			return;
		}
		this._fontWeight = fontWeight;
		this.domNode.style.fontWeight = this._fontWeight;
	}

	public setFontSize(fontSize: number): void {
		if (this._fontSize === fontSize) {
			return;
		}
		this._fontSize = fontSize;
		this.domNode.style.fontSize = this._fontSize + 'px';
	}

	public setFontFeatureSettings(fontFeatureSettings: string): void {
		if (this._fontFeatureSettings === fontFeatureSettings) {
			return;
		}
		this._fontFeatureSettings = fontFeatureSettings;
		this.domNode.style.fontFeatureSettings = this._fontFeatureSettings;
	}

	public setLineHeight(lineHeight: number): void {
		if (this._lineHeight === lineHeight) {
			return;
		}
		this._lineHeight = lineHeight;
		this.domNode.style.lineHeight = this._lineHeight + 'px';
	}

	public setLetterSpacing(letterSpacing: number): void {
		if (this._letterSpacing === letterSpacing) {
			return;
		}
		this._letterSpacing = letterSpacing;
		this.domNode.style.letterSpacing = this._letterSpacing + 'px';
	}

	public setClassName(className: string): void {
		if (this._className === className) {
			return;
		}
		this._className = className;
		this.domNode.className = this._className;
	}

	public toggleClassName(className: string, shouldHaveIt?: boolean): void {
		dom.toggleClass(this.domNode, className, shouldHaveIt);
		this._className = this.domNode.className;
	}

	public setDisplay(display: string): void {
		if (this._display === display) {
			return;
		}
		this._display = display;
		this.domNode.style.display = this._display;
	}

	public setPosition(position: string): void {
		if (this._position === position) {
			return;
		}
		this._position = position;
		this.domNode.style.position = this._position;
	}

	public setVisibility(visibility: string): void {
		if (this._visibility === visibility) {
			return;
		}
		this._visibility = visibility;
		this.domNode.style.visibility = this._visibility;
	}

	public setBackgroundColor(backgroundColor: string): void {
		if (this._backgroundColor === backgroundColor) {
			return;
		}
		this._backgroundColor = backgroundColor;
		this.domNode.style.backgroundColor = this._backgroundColor;
	}

	public setLayerHinting(layerHint: boolean): void {
		if (this._layerHint === layerHint) {
			return;
		}
		this._layerHint = layerHint;
		this.domNode.style.transform = this._layerHint ? 'translate3d(0px, 0px, 0px)' : '';
	}

	public setBoxShadow(boxShadow: string): void {
		if (this._boxShadow === boxShadow) {
			return;
		}
		this._boxShadow = boxShadow;
		this.domNode.style.boxShadow = boxShadow;
	}

	public setContain(contain: 'none' | 'strict' | 'content' | 'size' | 'layout' | 'style' | 'paint'): void {
		if (this._contain === contain) {
			return;
		}
		this._contain = contain;
		(<any>this.domNode.style).contain = this._contain;
	}

	public setAttribute(name: string, value: string): void {
		this.domNode.setAttribute(name, value);
	}

	public removeAttribute(name: string): void {
		this.domNode.removeAttribute(name);
	}

	public appendChild(child: FastDomNode<T>): void {
		this.domNode.appendChild(child.domNode);
	}

	public removeChild(child: FastDomNode<T>): void {
		this.domNode.removeChild(child.domNode);
	}
}

export function createFastDomNode<T extends HTMLElement>(domNode: T): FastDomNode<T> {
	return new FastDomNode(domNode);
}
