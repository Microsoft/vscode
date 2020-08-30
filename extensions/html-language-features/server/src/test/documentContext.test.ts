/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { getDocumentContext } from '../utils/documentContext';

suite('HTML Document Context', () => {

	test('Context', function (): any {
		const docURI = 'file:///users/test/folder/test.html';
		const rootFolders = [{ name: '', uri: 'file:///users/test/' }];

		let context = getDocumentContext(docURI, rootFolders);
		assert.equal(context.resolveReference('/', docURI), 'file:///users/test/');
		assert.equal(context.resolveReference('/message.html', docURI), 'file:///users/test/message.html');
		assert.equal(context.resolveReference('message.html', docURI), 'file:///users/test/folder/message.html');
		assert.equal(context.resolveReference('message.html', 'file:///users/test/'), 'file:///users/test/message.html');
	});
});
