/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IThemeService, Themable } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { registerColor, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IDebugService, State, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_NO_FOLDER_FOREGROUND, STATUS_BAR_BACKGROUND, STATUS_BAR_FOREGROUND, STATUS_BAR_NO_FOLDER_BORDER, STATUS_BAR_BORDER } from 'vs/workbench/common/theme';
import { assertIsDefined } from 'vs/base/common/types';
import { createStyleSheet } from 'vs/base/browser/dom';

// colors for theming

export const STATUS_BAR_DEBUGGING_BACKGROUND = registerColor('statusBar.debuggingBackground', {
	dark: '#CC6633',
	light: '#CC6633',
	hc: '#CC6633'
}, localize('statusBarDebuggingBackground', "Status bar background color when a program is being debugged. The status bar is shown in the bottom of the window"));

export const STATUS_BAR_DEBUGGING_FOREGROUND = registerColor('statusBar.debuggingForeground', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hc: STATUS_BAR_FOREGROUND
}, localize('statusBarDebuggingForeground', "Status bar foreground color when a program is being debugged. The status bar is shown in the bottom of the window"));

export const STATUS_BAR_DEBUGGING_BORDER = registerColor('statusBar.debuggingBorder', {
	dark: STATUS_BAR_BORDER,
	light: STATUS_BAR_BORDER,
	hc: STATUS_BAR_BORDER
}, localize('statusBarDebuggingBorder', "Status bar border color separating to the sidebar and editor when a program is being debugged. The status bar is shown in the bottom of the window"));

export class StatusBarColorProvider extends Themable implements IWorkbenchContribution {
	private styleElement: HTMLStyleElement | undefined;

	constructor(
		@IThemeService themeService: IThemeService,
		@IDebugService private readonly debugService: IDebugService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(themeService);

		this.registerListeners();
		this.updateStyles();
	}

	private registerListeners(): void {
		this._register(this.debugService.onDidChangeState(state => this.updateStyles()));
		this._register(this.contextService.onDidChangeWorkbenchState(state => this.updateStyles()));
	}

	protected override updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.layoutService.getContainer(Parts.STATUSBAR_PART));
		if (isStatusbarInDebugMode(this.debugService.state, this.debugService.getViewModel().focusedSession)) {
			container.classList.add('debugging');
		} else {
			container.classList.remove('debugging');
		}

		// Container Colors
		const backgroundColor = this.getColor(this.getColorKey(STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_DEBUGGING_BACKGROUND, STATUS_BAR_BACKGROUND));
		container.style.backgroundColor = backgroundColor || '';
		container.style.color = this.getColor(this.getColorKey(STATUS_BAR_NO_FOLDER_FOREGROUND, STATUS_BAR_DEBUGGING_FOREGROUND, STATUS_BAR_FOREGROUND)) || '';

		// Border Color
		const borderColor = this.getColor(this.getColorKey(STATUS_BAR_NO_FOLDER_BORDER, STATUS_BAR_DEBUGGING_BORDER, STATUS_BAR_BORDER)) || this.getColor(contrastBorder);
		if (borderColor) {
			container.classList.add('status-border-top');
			container.style.setProperty('--status-border-top-color', borderColor.toString());
		} else {
			container.classList.remove('status-border-top');
			container.style.removeProperty('--status-border-top-color');
		}

		// Notification Beak
		if (!this.styleElement) {
			this.styleElement = createStyleSheet(container);
		}

		this.styleElement.textContent = `.monaco-workbench .part.statusbar > .items-container > .statusbar-item.has-beak:before { border-bottom-color: ${backgroundColor} !important; }`;
	}

	private getColorKey(noFolderColor: string, debuggingColor: string, normalColor: string): string {

		// Not debugging
		if (!isStatusbarInDebugMode(this.debugService.state, this.debugService.getViewModel().focusedSession)) {
			if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY) {
				return normalColor;
			}

			return noFolderColor;
		}

		// Debugging
		return debuggingColor;
	}
}

export function isStatusbarInDebugMode(state: State, session: IDebugSession | undefined): boolean {
	if (state === State.Inactive || state === State.Initializing) {
		return false;
	}
	const isRunningWithoutDebug = session?.configuration?.noDebug;
	if (isRunningWithoutDebug) {
		return false;
	}

	return true;
}
