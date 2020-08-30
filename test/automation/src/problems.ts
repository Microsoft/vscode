/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

export const enum ProblemSeverity {
	WARNING = 0,
	ERROR = 1
}

export class Problems {

	static PROBLEMS_VIEW_SELECTOR = '.panel .markers-panel';

	constructor(private code: Code) { }

	public async showProblemsView(): Promise<any> {
		await this.toggleProblemsView();
		await this.waitForProblemsView();
	}

	public async hideProblemsView(): Promise<any> {
		await this.toggleProblemsView();
		await this.code.waitForElement(Problems.PROBLEMS_VIEW_SELECTOR, el => !el);
	}

	private async toggleProblemsView(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+shift+m');
		} else {
			await this.code.dispatchKeybinding('ctrl+shift+m');
		}
	}

	public async waitForProblemsView(): Promise<void> {
		await this.code.waitForElement(Problems.PROBLEMS_VIEW_SELECTOR);
	}

	public static getSelectorInProblemsView(problemType: ProblemSeverity): string {
		let selector = problemType === ProblemSeverity.WARNING ? 'codicon-warning' : 'codicon-error';
		return `div[id="workbench.panel.markers"] .monaco-tl-contents .marker-icon.${selector}`;
	}

	public static getSelectorInEditor(problemType: ProblemSeverity): string {
		let selector = problemType === ProblemSeverity.WARNING ? 'squiggly-warning' : 'squiggly-error';
		return `.view-overlays .cdr.${selector}`;
	}
}
