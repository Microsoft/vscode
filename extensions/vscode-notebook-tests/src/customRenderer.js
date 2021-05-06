/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = acquireVsCodeApi();

const notebook = acquireNotebookRendererApi();

notebook.onDidCreateOutput(({ element, mimeType }) => {
	const div = document.createElement('div');
	div.innerText = `Hello ${mimeType}!`;
	element.appendChild(div);
});
