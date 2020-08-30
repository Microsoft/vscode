/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

export const enum ActivityBarPosition {
	LEFT = 0,
	RIGHT = 1
}

export class ActivityBar {

	constructor(private code: Code) { }

	async waitForActivityBar(position: ActivityBarPosition): Promise<void> {
		let positionClass: string;

		if (position === ActivityBarPosition.LEFT) {
			positionClass = 'left';
		} else if (position === ActivityBarPosition.RIGHT) {
			positionClass = 'right';
		} else {
			throw new Error('No such position for activity bar defined.');
		}

		await this.code.waitForElement(`.part.activitybar.${positionClass}`);
	}
}
