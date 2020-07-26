/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { deduceExtensionKind } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IExtensionManifest, ExtensionKind } from 'vs/platform/extensions/common/extensions';

suite('ExtensionKind', () => {

	function check(manifest: Partial<IExtensionManifest>, expected: ExtensionKind[]): void {
		assert.deepEqual(deduceExtensionKind(<IExtensionManifest>manifest), expected);
	}

	test('declarative with extension dependencies => workspace', () => {
		check({ extensionDependencies: ['ext1'] }, ['workspace']);
	});

	test('declarative extension pack => workspace', () => {
		check({ extensionPack: ['ext1', 'ext2'] }, ['workspace']);
	});

	test('declarative with unknown contribution point => workspace', () => {
		check({ contributes: <any>{ 'unknownPoint': { something: true } } }, ['workspace']);
	});

	test('simple declarative => ui, workspace, web', () => {
		check({}, ['ui', 'workspace', 'web']);
	});

	test('only browser => web', () => {
		check({ browser: 'main.browser.js' }, ['web']);
	});

	test('only main => workspace', () => {
		check({ main: 'main.js' }, ['workspace']);
	});

	test('main and browser => workspace, web', () => {
		check({ main: 'main.js', browser: 'main.browser.js' }, ['workspace', 'web']);
	});
});
