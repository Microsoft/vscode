/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./welcomeOverlay';
import * as dom from 'vs/base/browser/dom';
import { Registry } from 'vs/platform/registry/common/platform';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ShowAllCommandsAction } from 'vs/workbench/contrib/quickaccess/browser/commandsQuickAccess';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IWorkbenchActionRegistry, Extensions, CATEGORIES } from 'vs/workbench/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Disposable } from 'vs/base/common/lifecycle';
import { RawContextKey, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { textPreformatForeground, foreground } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';
import { Codicon } from 'vs/base/common/codicons';

const $ = dom.$;

interface Key {
	id: string;
	arrow?: string;
	label: string;
	command?: string;
	arrowLast?: boolean;
	withEditor?: boolean;
}

const keys: Key[] = [
	{
		id: 'explorer',
		arrow: '\u2190', // &larr;
		label: localize('welcomeOverlay.explorer', "File explorer"),
		command: 'workbench.view.explorer'
	},
	{
		id: 'search',
		arrow: '\u2190', // &larr;
		label: localize('welcomeOverlay.search', "Search across files"),
		command: 'workbench.view.search'
	},
	{
		id: 'git',
		arrow: '\u2190', // &larr;
		label: localize('welcomeOverlay.git', "Source code management"),
		command: 'workbench.view.scm'
	},
	{
		id: 'debug',
		arrow: '\u2190', // &larr;
		label: localize('welcomeOverlay.debug', "Launch and debug"),
		command: 'workbench.view.debug'
	},
	{
		id: 'extensions',
		arrow: '\u2190', // &larr;
		label: localize('welcomeOverlay.extensions', "Manage extensions"),
		command: 'workbench.view.extensions'
	},
	// {
	// 	id: 'watermark',
	// 	arrow: '&larrpl;',
	// 	label: localize('welcomeOverlay.watermark', "Command Hints"),
	// 	withEditor: false
	// },
	{
		id: 'problems',
		arrow: '\u2939', // &larrpl;
		label: localize('welcomeOverlay.problems', "View errors and warnings"),
		command: 'workbench.actions.view.problems'
	},
	{
		id: 'terminal',
		label: localize('welcomeOverlay.terminal', "Toggle integrated terminal"),
		command: 'workbench.action.terminal.toggleTerminal'
	},
	// {
	// 	id: 'openfile',
	// 	arrow: '&cudarrl;',
	// 	label: localize('welcomeOverlay.openfile', "File Properties"),
	// 	arrowLast: true,
	// 	withEditor: true
	// },
	{
		id: 'commandPalette',
		arrow: '\u2196', // &nwarr;
		label: localize('welcomeOverlay.commandPalette', "Find and run all commands"),
		command: ShowAllCommandsAction.ID
	},
	{
		id: 'notifications',
		arrow: '\u2935', // &cudarrr;
		arrowLast: true,
		label: localize('welcomeOverlay.notifications', "Show notifications"),
		command: 'notifications.showList'
	}
];

const OVERLAY_VISIBLE = new RawContextKey<boolean>('interfaceOverviewVisible', false);

let welcomeOverlay: WelcomeOverlay;

export class WelcomeOverlayAction extends Action {

	public static readonly ID = 'workbench.action.showInterfaceOverview';
	public static readonly LABEL = localize('welcomeOverlay', "User Interface Overview");

	constructor(
		id: string,
		label: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, label);
	}

	public override run(): Promise<void> {
		if (!welcomeOverlay) {
			welcomeOverlay = this.instantiationService.createInstance(WelcomeOverlay);
		}
		welcomeOverlay.show();
		return Promise.resolve();
	}
}

export class HideWelcomeOverlayAction extends Action {

	public static readonly ID = 'workbench.action.hideInterfaceOverview';
	public static readonly LABEL = localize('hideWelcomeOverlay', "Hide Interface Overview");

	constructor(
		id: string,
		label: string
	) {
		super(id, label);
	}

	public override run(): Promise<void> {
		if (welcomeOverlay) {
			welcomeOverlay.hide();
		}
		return Promise.resolve();
	}
}

class WelcomeOverlay extends Disposable {

	private _overlayVisible: IContextKey<boolean>;
	private _overlay!: HTMLElement;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IEditorService private readonly editorService: IEditorService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super();
		this._overlayVisible = OVERLAY_VISIBLE.bindTo(this._contextKeyService);
		this.create();
	}

	private create(): void {
		const offset = this.layoutService.offset?.top ?? 0;
		this._overlay = dom.append(this.layoutService.container, $('.welcomeOverlay'));
		this._overlay.style.top = `${offset}px`;
		this._overlay.style.height = `calc(100% - ${offset}px)`;
		this._overlay.style.display = 'none';
		this._overlay.tabIndex = -1;

		this._register(dom.addStandardDisposableListener(this._overlay, 'click', () => this.hide()));
		this.commandService.onWillExecuteCommand(() => this.hide());

		dom.append(this._overlay, $('.commandPalettePlaceholder'));

		const editorOpen = !!this.editorService.visibleEditors.length;
		keys.filter(key => !('withEditor' in key) || key.withEditor === editorOpen)
			.forEach(({ id, arrow, label, command, arrowLast }) => {
				const div = dom.append(this._overlay, $(`.key.${id}`));
				if (arrow && !arrowLast) {
					dom.append(div, $('span.arrow', undefined, arrow));
				}
				dom.append(div, $('span.label')).textContent = label;
				if (command) {
					const shortcut = this.keybindingService.lookupKeybinding(command);
					if (shortcut) {
						dom.append(div, $('span.shortcut')).textContent = shortcut.getLabel();
					}
				}
				if (arrow && arrowLast) {
					dom.append(div, $('span.arrow', undefined, arrow));
				}
			});
	}

	public show() {
		if (this._overlay.style.display !== 'block') {
			this._overlay.style.display = 'block';
			const workbench = document.querySelector('.monaco-workbench') as HTMLElement;
			workbench.classList.add('blur-background');
			this._overlayVisible.set(true);
			this.updateProblemsKey();
			this.updateActivityBarKeys();
			this._overlay.focus();
		}
	}

	private updateProblemsKey() {
		const problems = document.querySelector(`footer[id="workbench.parts.statusbar"] .statusbar-item.left ${Codicon.warning.cssSelector}`);
		const key = this._overlay.querySelector('.key.problems') as HTMLElement;
		if (problems instanceof HTMLElement) {
			const target = problems.getBoundingClientRect();
			const bounds = this._overlay.getBoundingClientRect();
			const bottom = bounds.bottom - target.top + 3;
			const left = (target.left + target.right) / 2 - bounds.left;
			key.style.bottom = bottom + 'px';
			key.style.left = left + 'px';
		} else {
			key.style.bottom = '';
			key.style.left = '';
		}
	}

	private updateActivityBarKeys() {
		const ids = ['explorer', 'search', 'git', 'debug', 'extensions'];
		const activityBar = document.querySelector('.activitybar .composite-bar');
		if (activityBar instanceof HTMLElement) {
			const target = activityBar.getBoundingClientRect();
			const bounds = this._overlay.getBoundingClientRect();
			for (let i = 0; i < ids.length; i++) {
				const key = this._overlay.querySelector(`.key.${ids[i]}`) as HTMLElement;
				const top = target.top - bounds.top + 50 * i + 13;
				key.style.top = top + 'px';
			}
		} else {
			for (let i = 0; i < ids.length; i++) {
				const key = this._overlay.querySelector(`.key.${ids[i]}`) as HTMLElement;
				key.style.top = '';
			}
		}
	}

	public hide() {
		if (this._overlay.style.display !== 'none') {
			this._overlay.style.display = 'none';
			const workbench = document.querySelector('.monaco-workbench') as HTMLElement;
			workbench.classList.remove('blur-background');
			this._overlayVisible.reset();
		}
	}
}

Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions)
	.registerWorkbenchAction(SyncActionDescriptor.from(WelcomeOverlayAction), 'Help: User Interface Overview', CATEGORIES.Help.value);

Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions)
	.registerWorkbenchAction(SyncActionDescriptor.from(HideWelcomeOverlayAction, { primary: KeyCode.Escape }, OVERLAY_VISIBLE), 'Help: Hide Interface Overview', CATEGORIES.Help.value);

// theming

registerThemingParticipant((theme, collector) => {
	const key = theme.getColor(foreground);
	if (key) {
		collector.addRule(`.monaco-workbench > .welcomeOverlay > .key { color: ${key}; }`);
	}
	const backgroundColor = Color.fromHex(theme.type === 'light' ? '#FFFFFF85' : '#00000085');
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench > .welcomeOverlay { background: ${backgroundColor}; }`);
	}
	const shortcut = theme.getColor(textPreformatForeground);
	if (shortcut) {
		collector.addRule(`.monaco-workbench > .welcomeOverlay > .key > .shortcut { color: ${shortcut}; }`);
	}
});
