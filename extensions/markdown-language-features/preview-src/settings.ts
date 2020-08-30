/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PreviewSettings {
	readonly source: string;
	readonly line?: number;
	readonly fragment?: string
	readonly lineCount: number;
	readonly scrollPreviewWithEditor?: boolean;
	readonly scrollEditorWithPreview: boolean;
	readonly disableSecurityWarnings: boolean;
	readonly doubleClickToSwitchToEditor: boolean;
	readonly webviewResourceRoot: string;
}

let cachedSettings: PreviewSettings | undefined = undefined;

export function getData<T = {}>(key: string): T {
	const element = document.getElementById('vscode-markdown-preview-data');
	if (element) {
		const data = element.getAttribute(key);
		if (data) {
			return JSON.parse(data);
		}
	}

	throw new Error(`Could not load data for ${key}`);
}

export function getSettings(): PreviewSettings {
	if (cachedSettings) {
		return cachedSettings;
	}

	cachedSettings = getData('data-settings');
	if (cachedSettings) {
		return cachedSettings;
	}

	throw new Error('Could not load settings');
}
