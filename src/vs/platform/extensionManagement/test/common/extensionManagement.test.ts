/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { EXTENSION_IDENTIFIER_PATTERN } from 'vs/platform/extensionManagement/common/extensionManagement';

suite('Extension Identifier Pattern', () => {

	test('extension identifier pattern', () => {
		const regEx = new RegExp(EXTENSION_IDENTIFIER_PATTERN);
		assert.equal(true, regEx.test('publisher.name'));
		assert.equal(true, regEx.test('publiSher.name'));
		assert.equal(true, regEx.test('publisher.Name'));
		assert.equal(true, regEx.test('PUBLISHER.NAME'));
		assert.equal(true, regEx.test('PUBLISHEr.NAMe'));
		assert.equal(true, regEx.test('PUBLISHEr.N-AMe'));
		assert.equal(true, regEx.test('PUB-LISHEr.NAMe'));
		assert.equal(true, regEx.test('PUB-LISHEr.N-AMe'));
		assert.equal(true, regEx.test('PUBLISH12Er90.N-A54Me123'));
		assert.equal(true, regEx.test('111PUBLISH12Er90.N-1111A54Me123'));
		assert.equal(false, regEx.test('publishername'));
		assert.equal(false, regEx.test('-publisher.name'));
		assert.equal(false, regEx.test('publisher.-name'));
		assert.equal(false, regEx.test('-publisher.-name'));
		assert.equal(false, regEx.test('publ_isher.name'));
		assert.equal(false, regEx.test('publisher._name'));
	});
});
