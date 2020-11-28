/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { isEqual } from 'vs/base/common/resources';
import { isElectronSandboxed } from 'vs/base/common/platform';

suite('network', () => {
	const enableTest = isElectronSandboxed;

	(!enableTest ? test.skip : test)('FileAccess: URI (native)', () => {

		// asCodeUri() & asFileUri(): simple, without authority
		let originalFileUri = URI.file('network.test.ts');
		let browserUri = FileAccess.asBrowserUri(originalFileUri);
		assert.ok(browserUri.authority.length > 0);
		let fileUri = FileAccess.asFileUri(browserUri);
		assert.equal(fileUri.authority.length, 0);
		assert(isEqual(originalFileUri, fileUri));

		// asCodeUri() & asFileUri(): with authority
		originalFileUri = URI.file('network.test.ts').with({ authority: 'test-authority' });
		browserUri = FileAccess.asBrowserUri(originalFileUri);
		assert.equal(browserUri.authority, originalFileUri.authority);
		fileUri = FileAccess.asFileUri(browserUri);
		assert(isEqual(originalFileUri, fileUri));
	});

	(!enableTest ? test.skip : test)('FileAccess: moduleId (native)', () => {
		const browserUri = FileAccess.asBrowserUri('vs/base/test/node/network.test', require);
		assert.equal(browserUri.scheme, Schemas.vscodeFileResource);

		const fileUri = FileAccess.asFileUri('vs/base/test/node/network.test', require);
		assert.equal(fileUri.scheme, Schemas.file);
	});

	(!enableTest ? test.skip : test)('FileAccess: query and fragment is dropped (native)', () => {
		let originalFileUri = URI.file('network.test.ts').with({ query: 'foo=bar', fragment: 'something' });
		let browserUri = FileAccess.asBrowserUri(originalFileUri);
		assert.equal(browserUri.query, '');
		assert.equal(browserUri.fragment, '');
	});

	(!enableTest ? test.skip : test)('FileAccess: query and fragment is kept if URI is already of same scheme (native)', () => {
		let originalFileUri = URI.file('network.test.ts').with({ query: 'foo=bar', fragment: 'something' });
		let browserUri = FileAccess.asBrowserUri(originalFileUri.with({ scheme: Schemas.vscodeFileResource }));
		assert.equal(browserUri.query, 'foo=bar');
		assert.equal(browserUri.fragment, 'something');

		let fileUri = FileAccess.asFileUri(originalFileUri);
		assert.equal(fileUri.query, 'foo=bar');
		assert.equal(fileUri.fragment, 'something');
	});

	(!enableTest ? test.skip : test)('FileAccess: web', () => {
		const originalHttpsUri = URI.file('network.test.ts').with({ scheme: 'https' });
		const browserUri = FileAccess.asBrowserUri(originalHttpsUri);
		assert.equal(originalHttpsUri.toString(), browserUri.toString());
	});

	test('FileAccess: remote URIs', () => {
		const originalRemoteUri = URI.file('network.test.ts').with({ scheme: Schemas.vscodeRemote });
		const browserUri = FileAccess.asBrowserUri(originalRemoteUri);
		assert.notEqual(originalRemoteUri.scheme, browserUri.scheme);
	});
});
