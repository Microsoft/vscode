/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

export const enum StatusBarElement {
	BRANCH_STATUS = 0,
	SYNC_STATUS = 1,
	PROBLEMS_STATUS = 2,
	SELECTION_STATUS = 3,
	INDENTATION_STATUS = 4,
	ENCODING_STATUS = 5,
	EOL_STATUS = 6,
	LANGUAGE_STATUS = 7,
	FEEDBACK_ICON = 8
}

export class StatusBar {

	private readonly mainSelector = 'footer[id="workbench.parts.statusbar"]';

	constructor(private code: Code) { }

	async waitForStatusbarElement(element: StatusBarElement): Promise<void> {
		await this.code.waitForElement(this.getSelector(element));
	}

	async clickOn(element: StatusBarElement): Promise<void> {
		await this.code.waitAndClick(this.getSelector(element));
	}

	async waitForEOL(eol: string): Promise<string> {
		return this.code.waitForTextContent(this.getSelector(StatusBarElement.EOL_STATUS), eol);
	}

	async waitForStatusbarText(title: string, text: string): Promise<void> {
		await this.code.waitForTextContent(`${this.mainSelector} .statusbar-item[title="${title}"]`, text);
	}

	private getSelector(element: StatusBarElement): string {
		switch (element) {
			case StatusBarElement.BRANCH_STATUS:
				return `.statusbar-item[id="status.scm"] .codicon.codicon-git-branch`;
			case StatusBarElement.SYNC_STATUS:
				return `.statusbar-item[id="status.scm"] .codicon.codicon-sync`;
			case StatusBarElement.PROBLEMS_STATUS:
				return `.statusbar-item[id="status.problems"]`;
			case StatusBarElement.SELECTION_STATUS:
				return `.statusbar-item[id="status.editor.selection"]`;
			case StatusBarElement.INDENTATION_STATUS:
				return `.statusbar-item[id="status.editor.indentation"]`;
			case StatusBarElement.ENCODING_STATUS:
				return `.statusbar-item[id="status.editor.encoding"]`;
			case StatusBarElement.EOL_STATUS:
				return `.statusbar-item[id="status.editor.eol"]`;
			case StatusBarElement.LANGUAGE_STATUS:
				return `.statusbar-item[id="status.editor.mode"]`;
			case StatusBarElement.FEEDBACK_ICON:
				return `.statusbar-item[id="status.feedback"]`;
			default:
				throw new Error(element);
		}
	}
}
