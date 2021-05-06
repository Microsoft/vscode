/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { KeyCode } from 'vs/base/common/keyCodes';
import * as dom from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { SelectBox, ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IDebugService, IDebugSession, IDebugConfiguration, IConfig, ILaunch, State } from 'vs/workbench/contrib/debug/common/debug';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { selectBorder, selectBackground } from 'vs/platform/theme/common/colorRegistry';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ADD_CONFIGURATION_ID } from 'vs/workbench/contrib/debug/browser/debugCommands';
import { BaseActionViewItem, SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { debugStart } from 'vs/workbench/contrib/debug/browser/debugIcons';

const $ = dom.$;

export class StartDebugActionViewItem extends BaseActionViewItem {

	private static readonly SEPARATOR = '─────────';

	private container!: HTMLElement;
	private start!: HTMLElement;
	private selectBox: SelectBox;
	private debugOptions: { label: string, handler: (() => Promise<boolean>) }[] = [];
	private toDispose: IDisposable[];
	private selected = 0;
	private providers: { label: string, type: string, pick: () => Promise<{ launch: ILaunch, config: IConfig } | undefined> }[] = [];

	constructor(
		private context: unknown,
		private action: IAction,
		@IDebugService private readonly debugService: IDebugService,
		@IThemeService private readonly themeService: IThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super(context, action);
		this.toDispose = [];
		this.selectBox = new SelectBox([], -1, contextViewService, undefined, { ariaLabel: nls.localize('debugLaunchConfigurations', 'Debug Launch Configurations') });
		this.selectBox.setFocusable(false);
		this.toDispose.push(this.selectBox);
		this.toDispose.push(attachSelectBoxStyler(this.selectBox, themeService));

		this.registerListeners();
	}

	private registerListeners(): void {
		this.toDispose.push(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('launch')) {
				this.updateOptions();
			}
		}));
		this.toDispose.push(this.debugService.getConfigurationManager().onDidSelectConfiguration(() => {
			this.updateOptions();
		}));
	}

	override render(container: HTMLElement): void {
		this.container = container;
		container.classList.add('start-debug-action-item');
		this.start = dom.append(container, $(ThemeIcon.asCSSSelector(debugStart)));
		this.start.title = this.action.label;
		this.start.setAttribute('role', 'button');

		this.toDispose.push(dom.addDisposableListener(this.start, dom.EventType.CLICK, () => {
			this.start.blur();
			if (this.debugService.state !== State.Initializing) {
				this.actionRunner.run(this.action, this.context);
			}
		}));

		this.toDispose.push(dom.addDisposableListener(this.start, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (this.action.enabled && e.button === 0) {
				this.start.classList.add('active');
			}
		}));
		this.toDispose.push(dom.addDisposableListener(this.start, dom.EventType.MOUSE_UP, () => {
			this.start.classList.remove('active');
		}));
		this.toDispose.push(dom.addDisposableListener(this.start, dom.EventType.MOUSE_OUT, () => {
			this.start.classList.remove('active');
		}));

		this.toDispose.push(dom.addDisposableListener(this.start, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) && this.debugService.state !== State.Initializing) {
				this.actionRunner.run(this.action, this.context);
			}
			if (event.equals(KeyCode.RightArrow)) {
				this.start.tabIndex = -1;
				this.selectBox.focus();
				event.stopPropagation();
			}
		}));
		this.toDispose.push(this.selectBox.onDidSelect(async e => {
			const target = this.debugOptions[e.index];
			const shouldBeSelected = target.handler ? await target.handler() : false;
			if (shouldBeSelected) {
				this.selected = e.index;
			} else {
				// Some select options should not remain selected https://github.com/microsoft/vscode/issues/31526
				this.selectBox.select(this.selected);
			}
		}));

		const selectBoxContainer = $('.configuration');
		this.selectBox.render(dom.append(container, selectBoxContainer));
		this.toDispose.push(dom.addDisposableListener(selectBoxContainer, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.LeftArrow)) {
				this.selectBox.setFocusable(false);
				this.start.tabIndex = 0;
				this.start.focus();
				event.stopPropagation();
			}
		}));
		this.toDispose.push(attachStylerCallback(this.themeService, { selectBorder, selectBackground }, colors => {
			this.container.style.border = colors.selectBorder ? `1px solid ${colors.selectBorder}` : '';
			selectBoxContainer.style.borderLeft = colors.selectBorder ? `1px solid ${colors.selectBorder}` : '';
			const selectBackgroundColor = colors.selectBackground ? `${colors.selectBackground}` : '';
			this.container.style.backgroundColor = selectBackgroundColor;
		}));
		this.debugService.getConfigurationManager().getDynamicProviders().then(providers => {
			this.providers = providers;
			if (this.providers.length > 0) {
				this.updateOptions();
			}
		});

		this.updateOptions();
	}

	override setActionContext(context: any): void {
		this.context = context;
	}

	override isEnabled(): boolean {
		return true;
	}

	override focus(fromRight?: boolean): void {
		if (fromRight) {
			this.selectBox.focus();
		} else {
			this.start.tabIndex = 0;
			this.start.focus();
		}
	}

	override blur(): void {
		this.start.tabIndex = -1;
		this.selectBox.blur();
		this.container.blur();
	}

	override setFocusable(focusable: boolean): void {
		if (focusable) {
			this.start.tabIndex = 0;
		} else {
			this.start.tabIndex = -1;
			this.selectBox.setFocusable(false);
		}
	}

	override dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}

	private updateOptions(): void {
		this.selected = 0;
		this.debugOptions = [];
		const manager = this.debugService.getConfigurationManager();
		const inWorkspace = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE;
		let lastGroup: string | undefined;
		const disabledIdxs: number[] = [];
		manager.getAllConfigurations().forEach(({ launch, name, presentation }) => {
			if (lastGroup !== presentation?.group) {
				lastGroup = presentation?.group;
				if (this.debugOptions.length) {
					this.debugOptions.push({ label: StartDebugActionViewItem.SEPARATOR, handler: () => Promise.resolve(false) });
					disabledIdxs.push(this.debugOptions.length - 1);
				}
			}
			if (name === manager.selectedConfiguration.name && launch === manager.selectedConfiguration.launch) {
				this.selected = this.debugOptions.length;
			}

			const label = inWorkspace ? `${name} (${launch.name})` : name;
			this.debugOptions.push({
				label, handler: async () => {
					await manager.selectConfiguration(launch, name);
					return true;
				}
			});
		});

		// Only take 3 elements from the recent dynamic configurations to not clutter the dropdown
		manager.getRecentDynamicConfigurations().slice(0, 3).forEach(({ name, type }) => {
			if (type === manager.selectedConfiguration.type && manager.selectedConfiguration.name === name) {
				this.selected = this.debugOptions.length;
			}
			this.debugOptions.push({
				label: name,
				handler: async () => {
					await manager.selectConfiguration(undefined, name, undefined, { type });
					return true;
				}
			});
		});

		if (this.debugOptions.length === 0) {
			this.debugOptions.push({ label: nls.localize('noConfigurations', "No Configurations"), handler: async () => false });
		}

		this.debugOptions.push({ label: StartDebugActionViewItem.SEPARATOR, handler: () => Promise.resolve(false) });
		disabledIdxs.push(this.debugOptions.length - 1);

		this.providers.forEach(p => {

			this.debugOptions.push({
				label: `${p.label}...`,
				handler: async () => {
					const picked = await p.pick();
					if (picked) {
						await manager.selectConfiguration(picked.launch, picked.config.name, picked.config, { type: p.type });
						return true;
					}
					return false;
				}
			});
		});

		manager.getLaunches().filter(l => !l.hidden).forEach(l => {
			const label = inWorkspace ? nls.localize("addConfigTo", "Add Config ({0})...", l.name) : nls.localize('addConfiguration', "Add Configuration...");
			this.debugOptions.push({
				label, handler: async () => {
					await this.commandService.executeCommand(ADD_CONFIGURATION_ID, l.uri.toString());
					return false;
				}
			});
		});

		this.selectBox.setOptions(this.debugOptions.map((data, index) => <ISelectOptionItem>{ text: data.label, isDisabled: disabledIdxs.indexOf(index) !== -1 }), this.selected);
	}
}

export class FocusSessionActionViewItem extends SelectActionViewItem {
	constructor(
		action: IAction,
		session: IDebugSession | undefined,
		@IDebugService protected readonly debugService: IDebugService,
		@IThemeService themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(null, action, [], -1, contextViewService, { ariaLabel: nls.localize('debugSession', 'Debug Session') });

		this._register(attachSelectBoxStyler(this.selectBox, themeService));

		this._register(this.debugService.getViewModel().onDidFocusSession(() => {
			const session = this.getSelectedSession();
			if (session) {
				const index = this.getSessions().indexOf(session);
				this.select(index);
			}
		}));

		this._register(this.debugService.onDidNewSession(session => {
			const sessionListeners: IDisposable[] = [];
			sessionListeners.push(session.onDidChangeName(() => this.update()));
			sessionListeners.push(session.onDidEndAdapter(() => dispose(sessionListeners)));
			this.update();
		}));
		this.getSessions().forEach(session => {
			this._register(session.onDidChangeName(() => this.update()));
		});
		this._register(this.debugService.onDidEndSession(() => this.update()));

		const selectedSession = session ? this.mapFocusedSessionToSelected(session) : undefined;
		this.update(selectedSession);
	}

	protected override getActionContext(_: string, index: number): any {
		return this.getSessions()[index];
	}

	private update(session?: IDebugSession) {
		if (!session) {
			session = this.getSelectedSession();
		}
		const sessions = this.getSessions();
		const names = sessions.map(s => {
			const label = s.getLabel();
			if (s.parentSession) {
				// Indent child sessions so they look like children
				return `\u00A0\u00A0${label}`;
			}

			return label;
		});
		this.setOptions(names.map(data => <ISelectOptionItem>{ text: data }), session ? sessions.indexOf(session) : undefined);
	}

	private getSelectedSession(): IDebugSession | undefined {
		const session = this.debugService.getViewModel().focusedSession;
		return session ? this.mapFocusedSessionToSelected(session) : undefined;
	}

	protected getSessions(): ReadonlyArray<IDebugSession> {
		const showSubSessions = this.configurationService.getValue<IDebugConfiguration>('debug').showSubSessionsInToolBar;
		const sessions = this.debugService.getModel().getSessions();

		return showSubSessions ? sessions : sessions.filter(s => !s.parentSession);
	}

	protected mapFocusedSessionToSelected(focusedSession: IDebugSession): IDebugSession {
		const showSubSessions = this.configurationService.getValue<IDebugConfiguration>('debug').showSubSessionsInToolBar;
		while (focusedSession.parentSession && !showSubSessions) {
			focusedSession = focusedSession.parentSession;
		}
		return focusedSession;
	}
}
