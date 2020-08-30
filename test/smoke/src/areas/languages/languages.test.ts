/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, ProblemSeverity, Problems } from '../../../../automation/out';

export function setup() {
	describe('Language Features', () => {
		it('verifies quick outline', async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.openFile('style.css');

			await app.workbench.quickaccess.openQuickOutline();
			await app.workbench.quickinput.waitForQuickInputElements(names => names.length === 2);
		});

		it('verifies problems view', async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.openFile('style.css');
			await app.workbench.editor.waitForTypeInEditor('style.css', '.foo{}');

			await app.code.waitForElement(Problems.getSelectorInEditor(ProblemSeverity.WARNING));

			await app.workbench.problems.showProblemsView();
			await app.code.waitForElement(Problems.getSelectorInProblemsView(ProblemSeverity.WARNING));
			await app.workbench.problems.hideProblemsView();
		});

		it('verifies settings', async function () {
			const app = this.app as Application;
			await app.workbench.settingsEditor.addUserSetting('css.lint.emptyRules', '"error"');
			await app.workbench.quickaccess.openFile('style.css');

			await app.code.waitForElement(Problems.getSelectorInEditor(ProblemSeverity.ERROR));

			const problems = new Problems(app.code);
			await problems.showProblemsView();
			await app.code.waitForElement(Problems.getSelectorInProblemsView(ProblemSeverity.ERROR));
			await problems.hideProblemsView();
		});
	});
}
