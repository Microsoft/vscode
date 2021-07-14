/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument } from 'vscode-css-languageservice';

export interface LanguageModelCache<T> {
	get(document: TextDocument): T;
	onDocumentRemoved(document: TextDocument): void;
	dispose(): void;
}

export function getLanguageModelCache<T>(maxEntries: number, cleanupIntervalTimeInSec: number, parse: (document: TextDocument) => T): LanguageModelCache<T> {
	let languageModels: { [uri: string]: { version: number, languageId: string, cTime: number, languageModel: T } } = {};
	let nModels = 0;

	let cleanupInterval: NodeJS.Timer | undefined = undefined;
	if (cleanupIntervalTimeInSec > 0) {
		cleanupInterval = setInterval(() => {
			let cutoffTime = Date.now() - cleanupIntervalTimeInSec * 1000;
			let uris = Object.keys(languageModels);
			for (let uri of uris) {
				let languageModelInfo = languageModels[uri];
				if (languageModelInfo.cTime < cutoffTime) {
					delete languageModels[uri];
					nModels--;
				}
			}
		}, cleanupIntervalTimeInSec * 1000);
	}

	return {
		get(document: TextDocument): T {
			let version = document.version;
			let languageId = document.languageId;
			let languageModelInfo = languageModels[document.uri];
			if (languageModelInfo && languageModelInfo.version === version && languageModelInfo.languageId === languageId) {
				languageModelInfo.cTime = Date.now();
				return languageModelInfo.languageModel;
			}
			let languageModel = parse(document);
			languageModels[document.uri] = { languageModel, version, languageId, cTime: Date.now() };
			if (!languageModelInfo) {
				nModels++;
			}

			if (nModels === maxEntries) {
				let oldestTime = Number.MAX_VALUE;
				let oldestUri = null;
				for (let uri in languageModels) {
					let languageModelInfo = languageModels[uri];
					if (languageModelInfo.cTime < oldestTime) {
						oldestUri = uri;
						oldestTime = languageModelInfo.cTime;
					}
				}
				if (oldestUri) {
					delete languageModels[oldestUri];
					nModels--;
				}
			}
			return languageModel;

		},
		onDocumentRemoved(document: TextDocument) {
			let uri = document.uri;
			if (languageModels[uri]) {
				delete languageModels[uri];
				nModels--;
			}
		},
		dispose() {
			if (typeof cleanupInterval !== 'undefined') {
				clearInterval(cleanupInterval);
				cleanupInterval = undefined;
				languageModels = {};
				nModels = 0;
			}
		}
	};
}
