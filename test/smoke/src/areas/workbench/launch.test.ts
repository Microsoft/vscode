/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { Application, ApplicationOptions } from '../../../../automation';

export function setup() {

	describe('Launch', () => {

		let app: Application;

		after(async function () {
			if (app) {
				await app.stop();
			}
		});

		afterEach(async function () {
			if (app) {
				if (this.currentTest.state === 'failed') {
					const name = this.currentTest.fullTitle().replace(/[^a-z0-9\-]/ig, '_');
					await app.captureScreenshot(name);
				}
			}
		});

		it(`verifies that application launches when user data directory has non-ascii characters`, async function () {
			const defaultOptions = this.defaultOptions as ApplicationOptions;
			const options: ApplicationOptions = { ...defaultOptions, userDataDir: path.join(defaultOptions.userDataDir, 'abcdø') };
			app = new Application(options);
			await app.start();
		});

	});
}
