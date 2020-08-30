/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BareFontInfo } from 'vs/editor/common/config/fontInfo';

export const enum CharWidthRequestType {
	Regular = 0,
	Italic = 1,
	Bold = 2
}

export class CharWidthRequest {

	public readonly chr: string;
	public readonly type: CharWidthRequestType;
	public width: number;

	constructor(chr: string, type: CharWidthRequestType) {
		this.chr = chr;
		this.type = type;
		this.width = 0;
	}

	public fulfill(width: number) {
		this.width = width;
	}
}

class DomCharWidthReader {

	private readonly _bareFontInfo: BareFontInfo;
	private readonly _requests: CharWidthRequest[];

	private _container: HTMLElement | null;
	private _testElements: HTMLSpanElement[] | null;

	constructor(bareFontInfo: BareFontInfo, requests: CharWidthRequest[]) {
		this._bareFontInfo = bareFontInfo;
		this._requests = requests;

		this._container = null;
		this._testElements = null;
	}

	public read(): void {
		// Create a test container with all these test elements
		this._createDomElements();

		// Add the container to the DOM
		document.body.appendChild(this._container!);

		// Read character widths
		this._readFromDomElements();

		// Remove the container from the DOM
		document.body.removeChild(this._container!);

		this._container = null;
		this._testElements = null;
	}

	private _createDomElements(): void {
		const container = document.createElement('div');
		container.style.position = 'absolute';
		container.style.top = '-50000px';
		container.style.width = '50000px';

		const regularDomNode = document.createElement('div');
		regularDomNode.style.fontFamily = this._bareFontInfo.getMassagedFontFamily();
		regularDomNode.style.fontWeight = this._bareFontInfo.fontWeight;
		regularDomNode.style.fontSize = this._bareFontInfo.fontSize + 'px';
		regularDomNode.style.fontFeatureSettings = this._bareFontInfo.fontFeatureSettings;
		regularDomNode.style.lineHeight = this._bareFontInfo.lineHeight + 'px';
		regularDomNode.style.letterSpacing = this._bareFontInfo.letterSpacing + 'px';
		container.appendChild(regularDomNode);

		const boldDomNode = document.createElement('div');
		boldDomNode.style.fontFamily = this._bareFontInfo.getMassagedFontFamily();
		boldDomNode.style.fontWeight = 'bold';
		boldDomNode.style.fontSize = this._bareFontInfo.fontSize + 'px';
		boldDomNode.style.fontFeatureSettings = this._bareFontInfo.fontFeatureSettings;
		boldDomNode.style.lineHeight = this._bareFontInfo.lineHeight + 'px';
		boldDomNode.style.letterSpacing = this._bareFontInfo.letterSpacing + 'px';
		container.appendChild(boldDomNode);

		const italicDomNode = document.createElement('div');
		italicDomNode.style.fontFamily = this._bareFontInfo.getMassagedFontFamily();
		italicDomNode.style.fontWeight = this._bareFontInfo.fontWeight;
		italicDomNode.style.fontSize = this._bareFontInfo.fontSize + 'px';
		italicDomNode.style.fontFeatureSettings = this._bareFontInfo.fontFeatureSettings;
		italicDomNode.style.lineHeight = this._bareFontInfo.lineHeight + 'px';
		italicDomNode.style.letterSpacing = this._bareFontInfo.letterSpacing + 'px';
		italicDomNode.style.fontStyle = 'italic';
		container.appendChild(italicDomNode);

		const testElements: HTMLSpanElement[] = [];
		for (const request of this._requests) {

			let parent: HTMLElement;
			if (request.type === CharWidthRequestType.Regular) {
				parent = regularDomNode;
			}
			if (request.type === CharWidthRequestType.Bold) {
				parent = boldDomNode;
			}
			if (request.type === CharWidthRequestType.Italic) {
				parent = italicDomNode;
			}

			parent!.appendChild(document.createElement('br'));

			const testElement = document.createElement('span');
			DomCharWidthReader._render(testElement, request);
			parent!.appendChild(testElement);

			testElements.push(testElement);
		}

		this._container = container;
		this._testElements = testElements;
	}

	private static _render(testElement: HTMLElement, request: CharWidthRequest): void {
		if (request.chr === ' ') {
			let htmlString = '\u00a0';
			// Repeat character 256 (2^8) times
			for (let i = 0; i < 8; i++) {
				htmlString += htmlString;
			}
			testElement.innerText = htmlString;
		} else {
			let testString = request.chr;
			// Repeat character 256 (2^8) times
			for (let i = 0; i < 8; i++) {
				testString += testString;
			}
			testElement.textContent = testString;
		}
	}

	private _readFromDomElements(): void {
		for (let i = 0, len = this._requests.length; i < len; i++) {
			const request = this._requests[i];
			const testElement = this._testElements![i];

			request.fulfill(testElement.offsetWidth / 256);
		}
	}
}

export function readCharWidths(bareFontInfo: BareFontInfo, requests: CharWidthRequest[]): void {
	const reader = new DomCharWidthReader(bareFontInfo, requests);
	reader.read();
}
