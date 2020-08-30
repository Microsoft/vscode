/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { URI } from 'vs/base/common/uri';
import { sep } from 'vs/base/common/path';
import { isWindows } from 'vs/base/common/platform';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { TestNativePathService, TestEnvironmentService } from 'vs/workbench/test/electron-browser/workbenchTestServices';

suite('URI Label', () => {

	let labelService: LabelService;

	setup(() => {
		labelService = new LabelService(TestEnvironmentService, new TestContextService(), new TestNativePathService(TestEnvironmentService));
	});

	test('file scheme', function () {
		labelService.registerFormatter({
			scheme: 'file',
			formatting: {
				label: '${path}',
				separator: sep,
				tildify: !isWindows,
				normalizeDriveLetter: isWindows
			}
		});

		const uri1 = TestWorkspace.folders[0].uri.with({ path: TestWorkspace.folders[0].uri.path.concat('/a/b/c/d') });
		assert.equal(labelService.getUriLabel(uri1, { relative: true }), isWindows ? 'a\\b\\c\\d' : 'a/b/c/d');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), isWindows ? 'C:\\testWorkspace\\a\\b\\c\\d' : '/testWorkspace/a/b/c/d');
		assert.equal(labelService.getUriBasenameLabel(uri1), 'd');

		const uri2 = URI.file('c:\\1/2/3');
		assert.equal(labelService.getUriLabel(uri2, { relative: false }), isWindows ? 'C:\\1\\2\\3' : '/c:\\1/2/3');
		assert.equal(labelService.getUriBasenameLabel(uri2), '3');
	});
});
