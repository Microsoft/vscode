/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../../automation';

export function setup() {
	describe('Editor', () => {
		it('shows correct quick outline', async function () {
			const app = this.app as Application;
			await app.workbench.quickaccess.openFile('www');

			await app.workbench.quickaccess.openQuickOutline();
			await app.workbench.quickinput.waitForQuickInputElements(names => names.length >= 6);
		});

		// it('folds/unfolds the code correctly', async function () {
		// 	await app.workbench.quickaccess.openFile('www');

		// 	// Fold
		// 	await app.workbench.editor.foldAtLine(3);
		// 	await app.workbench.editor.waitUntilShown(3);
		// 	await app.workbench.editor.waitUntilHidden(4);
		// 	await app.workbench.editor.waitUntilHidden(5);

		// 	// Unfold
		// 	await app.workbench.editor.unfoldAtLine(3);
		// 	await app.workbench.editor.waitUntilShown(3);
		// 	await app.workbench.editor.waitUntilShown(4);
		// 	await app.workbench.editor.waitUntilShown(5);
		// });
	});
}
