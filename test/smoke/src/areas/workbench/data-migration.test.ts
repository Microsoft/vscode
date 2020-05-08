/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, ApplicationOptions } from '../../../../automation';
import { join } from 'path';

export function setup(stableCodePath: string, testDataPath: string) {

	describe('Datamigration', () => {
		it(`verifies opened editors are restored`, async function () {
			if (!stableCodePath) {
				this.skip();
			}

			const userDataDir = join(testDataPath, 'd2'); // different data dir from the other tests

			const stableOptions: ApplicationOptions = Object.assign({}, this.defaultOptions);
			stableOptions.codePath = stableCodePath;
			stableOptions.userDataDir = userDataDir;

			const stableApp = new Application(stableOptions);
			await stableApp!.start();

			// Open 3 editors and pin 2 of them
			await stableApp.workbench.quickaccess.openFile('www');
			await stableApp.workbench.quickaccess.runCommand('View: Keep Editor');

			await stableApp.workbench.quickaccess.openFile('app.js');
			await stableApp.workbench.quickaccess.runCommand('View: Keep Editor');

			await stableApp.workbench.editors.newUntitledFile();

			await stableApp.stop();

			const insiderOptions: ApplicationOptions = Object.assign({}, this.defaultOptions);
			insiderOptions.userDataDir = userDataDir;

			const insidersApp = new Application(insiderOptions);
			await insidersApp!.start(false /* not expecting walkthrough path */);

			// Verify 3 editors are open
			await insidersApp.workbench.editors.waitForEditorFocus('Untitled-1');
			await insidersApp.workbench.editors.selectTab('app.js');
			await insidersApp.workbench.editors.selectTab('www');

			await insidersApp.stop();
		});

		it(`verifies that 'hot exit' works for dirty files`, async function () {
			if (!stableCodePath) {
				this.skip();
			}

			const userDataDir = join(testDataPath, 'd3'); // different data dir from the other tests

			const stableOptions: ApplicationOptions = Object.assign({}, this.defaultOptions);
			stableOptions.codePath = stableCodePath;
			stableOptions.userDataDir = userDataDir;

			const stableApp = new Application(stableOptions);
			await stableApp!.start();

			await stableApp.workbench.editors.newUntitledFile();

			const untitled = 'Untitled-1';
			const textToTypeInUntitled = 'Hello from Untitled';
			await stableApp.workbench.editor.waitForTypeInEditor(untitled, textToTypeInUntitled);

			const readmeMd = 'readme.md';
			const textToType = 'Hello, Code';
			await stableApp.workbench.quickaccess.openFile(readmeMd);
			await stableApp.workbench.editor.waitForTypeInEditor(readmeMd, textToType);

			await stableApp.stop();

			const insiderOptions: ApplicationOptions = Object.assign({}, this.defaultOptions);
			insiderOptions.userDataDir = userDataDir;

			const insidersApp = new Application(insiderOptions);
			await insidersApp!.start(false /* not expecting walkthrough path */);

			await insidersApp.workbench.editors.waitForActiveTab(readmeMd, true);
			await insidersApp.workbench.editor.waitForEditorContents(readmeMd, c => c.indexOf(textToType) > -1);

			await insidersApp.workbench.editors.waitForTab(untitled, true);
			await insidersApp.workbench.editors.selectTab(untitled);
			await insidersApp.workbench.editor.waitForEditorContents(untitled, c => c.indexOf(textToTypeInUntitled) > -1);

			await insidersApp.stop();
		});
	});
}
