/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

export class References {

	private static readonly REFERENCES_WIDGET = '.monaco-editor .zone-widget .zone-widget-container.peekview-widget.reference-zone-widget.results-loaded';
	private static readonly REFERENCES_TITLE_FILE_NAME = `${References.REFERENCES_WIDGET} .head .peekview-title .filename`;
	private static readonly REFERENCES_TITLE_COUNT = `${References.REFERENCES_WIDGET} .head .peekview-title .meta`;
	private static readonly REFERENCES = `${References.REFERENCES_WIDGET} .body .ref-tree.inline .monaco-list-row .highlight`;

	constructor(private code: Code) { }

	async waitUntilOpen(): Promise<void> {
		await this.code.waitForElement(References.REFERENCES_WIDGET);
	}

	async waitForReferencesCountInTitle(count: number): Promise<void> {
		await this.code.waitForTextContent(References.REFERENCES_TITLE_COUNT, undefined, titleCount => {
			const matches = titleCount.match(/\d+/);
			return matches ? parseInt(matches[0]) === count : false;
		});
	}

	async waitForReferencesCount(count: number): Promise<void> {
		await this.code.waitForElements(References.REFERENCES, false, result => result && result.length === count);
	}

	async waitForFile(file: string): Promise<void> {
		await this.code.waitForTextContent(References.REFERENCES_TITLE_FILE_NAME, file);
	}

	async close(): Promise<void> {
		// Sometimes someone else eats up the `Escape` key
		let count = 0;
		while (true) {
			await this.code.dispatchKeybinding('escape');

			try {
				await this.code.waitForElement(References.REFERENCES_WIDGET, el => !el, 10);
				return;
			} catch (err) {
				if (++count > 5) {
					throw err;
				}
			}
		}
	}
}
