/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	const textArea = document.querySelector('textarea');

	const initialState = vscode.getState();
	if (initialState) {
		textArea.value = initialState.value;
	}

	window.addEventListener('message', e => {
		switch (e.data.type) {
			case 'fakeInput':
				{
					const value = e.data.value;
					textArea.value = value;
					onInput();
					break;
				}

			case 'setValue':
				{
					const value = e.data.value;
					textArea.value = value;
					vscode.setState({ value });

					vscode.postMessage({
						type: 'didChangeContent',
						value: value
					});
					break;
				}
		}
	});

	const onInput = () => {
		const value = textArea.value;
		vscode.setState({ value });
		vscode.postMessage({
			type: 'edit',
			value: value
		});
		vscode.postMessage({
			type: 'didChangeContent',
			value: value
		});
	};

	textArea.addEventListener('input', onInput);
}());
