/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { readFileSync } from 'fs';
import { getPathFromAmdModule } from 'vs/base/test/node/testUtils';

suite('URI - perf', function () {

	let manyFileUris: URI[];
	setup(function () {
		manyFileUris = [];
		let data = readFileSync(getPathFromAmdModule(require, './uri.test.data.txt')).toString();
		let lines = data.split('\n');
		for (let line of lines) {
			manyFileUris.push(URI.file(line));
		}
	});

	function perfTest(name: string, callback: Function) {
		test(name, _done => {
			let t1 = Date.now();
			callback();
			let d = Date.now() - t1;
			console.log(`${name} took ${d}ms (${(d / manyFileUris.length).toPrecision(3)} ms/uri)`);
			_done();
		});
	}

	perfTest('toString', function () {
		for (const uri of manyFileUris) {
			let data = uri.toString();
			assert.ok(data);
		}
	});

	perfTest('toString(skipEncoding)', function () {
		for (const uri of manyFileUris) {
			let data = uri.toString(true);
			assert.ok(data);
		}
	});

	perfTest('fsPath', function () {
		for (const uri of manyFileUris) {
			let data = uri.fsPath;
			assert.ok(data);
		}
	});

	perfTest('toJSON', function () {
		for (const uri of manyFileUris) {
			let data = uri.toJSON();
			assert.ok(data);
		}
	});

});
