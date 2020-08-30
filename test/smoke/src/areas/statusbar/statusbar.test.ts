/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Quality, StatusBarElement } from '../../../../automation';

export function setup(isWeb) {
	describe('Statusbar', () => {
		it('verifies presence of all default status bar elements', async function () {
			const app = this.app as Application;

			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.BRANCH_STATUS);
			if (app.quality !== Quality.Dev) {
				await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.FEEDBACK_ICON);
			}
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.SYNC_STATUS);
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.PROBLEMS_STATUS);

			await app.workbench.quickaccess.openFile('app.js');
			if (!isWeb) {
				// Encoding picker currently hidden in web (only UTF-8 supported)
				await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.ENCODING_STATUS);
			}
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.EOL_STATUS);
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.INDENTATION_STATUS);
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.LANGUAGE_STATUS);
			await app.workbench.statusbar.waitForStatusbarElement(StatusBarElement.SELECTION_STATUS);
		});

		it(`verifies that 'quick input' opens when clicking on status bar elements`, async function () {
			const app = this.app as Application;

			await app.workbench.statusbar.clickOn(StatusBarElement.BRANCH_STATUS);
			await app.workbench.quickinput.waitForQuickInputOpened();
			await app.workbench.quickinput.closeQuickInput();

			await app.workbench.quickaccess.openFile('app.js');
			await app.workbench.statusbar.clickOn(StatusBarElement.INDENTATION_STATUS);
			await app.workbench.quickinput.waitForQuickInputOpened();
			await app.workbench.quickinput.closeQuickInput();
			if (!isWeb) {
				// Encoding picker currently hidden in web (only UTF-8 supported)
				await app.workbench.statusbar.clickOn(StatusBarElement.ENCODING_STATUS);
				await app.workbench.quickinput.waitForQuickInputOpened();
				await app.workbench.quickinput.closeQuickInput();
			}
			await app.workbench.statusbar.clickOn(StatusBarElement.EOL_STATUS);
			await app.workbench.quickinput.waitForQuickInputOpened();
			await app.workbench.quickinput.closeQuickInput();
			await app.workbench.statusbar.clickOn(StatusBarElement.LANGUAGE_STATUS);
			await app.workbench.quickinput.waitForQuickInputOpened();
			await app.workbench.quickinput.closeQuickInput();
		});

		it(`verifies that 'Problems View' appears when clicking on 'Problems' status element`, async function () {
			const app = this.app as Application;

			await app.workbench.statusbar.clickOn(StatusBarElement.PROBLEMS_STATUS);
			await app.workbench.problems.waitForProblemsView();
		});

		it(`verifies that 'Tweet us feedback' pop-up appears when clicking on 'Feedback' icon`, async function () {
			const app = this.app as Application;

			if (app.quality === Quality.Dev) {
				return this.skip();
			}

			await app.workbench.statusbar.clickOn(StatusBarElement.FEEDBACK_ICON);
			await app.code.waitForElement('.feedback-form');
		});

		it(`checks if 'Go to Line' works if called from the status bar`, async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile('app.js');
			await app.workbench.statusbar.clickOn(StatusBarElement.SELECTION_STATUS);

			await app.workbench.quickinput.waitForQuickInputOpened();

			await app.workbench.quickinput.submit(':15');
			await app.workbench.editor.waitForHighlightingLine('app.js', 15);
		});

		it(`verifies if changing EOL is reflected in the status bar`, async function () {
			const app = this.app as Application;

			await app.workbench.quickaccess.openFile('app.js');
			await app.workbench.statusbar.clickOn(StatusBarElement.EOL_STATUS);

			await app.workbench.quickinput.waitForQuickInputOpened();
			await app.workbench.quickinput.selectQuickInputElement(1);

			await app.workbench.statusbar.waitForEOL('CRLF');
		});
	});
}
