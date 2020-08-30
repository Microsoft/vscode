/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import 'mocha';
// import * as assert from 'assert';
// import { Selection } from 'vscode';
// import { withRandomFileEditor, closeAllEditors } from './testUtils';
// import { updateImageSize } from '../updateImageSize';

// suite('Tests for Emmet actions on html tags', () => {
// 	teardown(closeAllEditors);

	// test('update image css with multiple cursors in css file', () => {
	// 	const cssContents = `
	// 	.one {
	// 		margin: 10px;
	// 		padding: 10px;
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 	}
	// 	.two {
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 		height: 42px;
	// 	}
	// 	.three {
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 		width: 42px;
	// 	}
	// `;
	// 	const expectedContents = `
	// 	.one {
	// 		margin: 10px;
	// 		padding: 10px;
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 		width: 32px;
	// 		height: 32px;
	// 	}
	// 	.two {
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 		width: 32px;
	// 		height: 32px;
	// 	}
	// 	.three {
	// 		background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 		height: 32px;
	// 		width: 32px;
	// 	}
	// `;
	// 	return withRandomFileEditor(cssContents, 'css', (editor, doc) => {
	// 		editor.selections = [
	// 			new Selection(4, 50, 4, 50),
	// 			new Selection(7, 50, 7, 50),
	// 			new Selection(11, 50, 11, 50)
	// 		];

	// 		return updateImageSize()!.then(() => {
	// 			assert.equal(doc.getText(), expectedContents);
	// 			return Promise.resolve();
	// 		});
	// 	});
	// });

	// test('update image size in css in html file with multiple cursors', () => {
	// 	const htmlWithCssContents = `
	// 	<html>
	// 		<style>
	// 			.one {
	// 				margin: 10px;
	// 				padding: 10px;
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 			}
	// 			.two {
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 				height: 42px;
	// 			}
	// 			.three {
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 				width: 42px;
	// 			}
	// 		</style>
	// 	</html>
	// `;
	// 	const expectedContents = `
	// 	<html>
	// 		<style>
	// 			.one {
	// 				margin: 10px;
	// 				padding: 10px;
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 				width: 32px;
	// 				height: 32px;
	// 			}
	// 			.two {
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 				width: 32px;
	// 				height: 32px;
	// 			}
	// 			.three {
	// 				background-image: url(https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png);
	// 				height: 32px;
	// 				width: 32px;
	// 			}
	// 		</style>
	// 	</html>
	// `;
	// 	return withRandomFileEditor(htmlWithCssContents, 'html', (editor, doc) => {
	// 		editor.selections = [
	// 			new Selection(6, 50, 6, 50),
	// 			new Selection(9, 50, 9, 50),
	// 			new Selection(13, 50, 13, 50)
	// 		];

	// 		return updateImageSize()!.then(() => {
	// 			assert.equal(doc.getText(), expectedContents);
	// 			return Promise.resolve();
	// 		});
	// 	});
	// });

	// test('update image size in img tag in html file with multiple cursors', () => {
	// 	const htmlwithimgtag = `
	// 	<html>
	// 		<img id="one" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" />
	// 		<img id="two" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" width="56" />
	// 		<img id="three" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" height="56" />
	// 	</html>
	// `;
	// 	const expectedContents = `
	// 	<html>
	// 		<img id="one" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" width="32" height="32" />
	// 		<img id="two" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" width="32" height="32" />
	// 		<img id="three" src="https://github.com/Microsoft/vscode/blob/master/resources/linux/code.png" height="32" width="32" />
	// 	</html>
	// `;
	// 	return withRandomFileEditor(htmlwithimgtag, 'html', (editor, doc) => {
	// 		editor.selections = [
	// 			new Selection(2, 50, 2, 50),
	// 			new Selection(3, 50, 3, 50),
	// 			new Selection(4, 50, 4, 50)
	// 		];

	// 		return updateImageSize()!.then(() => {
	// 			assert.equal(doc.getText(), expectedContents);
	// 			return Promise.resolve();
	// 		});
	// 	});
	// });

// });
