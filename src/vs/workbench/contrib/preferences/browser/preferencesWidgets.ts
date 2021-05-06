/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IKeyboardEvent, StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { HistoryInputBox, IHistoryInputOptions } from 'vs/base/browser/ui/inputbox/inputBox';
import { Widget } from 'vs/base/browser/ui/widget';
import { Action, IAction } from 'vs/base/common/actions';
import { Emitter, Event } from 'vs/base/common/event';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IMarginData } from 'vs/editor/browser/controller/mouseTarget';
import { ICodeEditor, IEditorMouseEvent, IViewZone, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { Position } from 'vs/editor/common/core/position';
import { IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { Schemas } from 'vs/base/common/network';
import { activeContrastBorder, badgeBackground, badgeForeground, contrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { attachInputBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { ICssStyleCollector, IColorTheme, IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { isWorkspaceFolder, IWorkspaceContextService, IWorkspaceFolder, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { PANEL_ACTIVE_TITLE_BORDER, PANEL_ACTIVE_TITLE_FOREGROUND, PANEL_INACTIVE_TITLE_FOREGROUND } from 'vs/workbench/common/theme';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ISettingsGroup, IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { isEqual } from 'vs/base/common/resources';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { settingsEditIcon, settingsGroupCollapsedIcon, settingsGroupExpandedIcon, settingsScopeDropDownIcon } from 'vs/workbench/contrib/preferences/browser/preferencesIcons';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';

export class SettingsHeaderWidget extends Widget implements IViewZone {

	private id!: string;
	private _domNode!: HTMLElement;

	protected titleContainer!: HTMLElement;
	private messageElement!: HTMLElement;

	constructor(protected editor: ICodeEditor, private title: string) {
		super();
		this.create();
		this._register(this.editor.onDidChangeConfiguration(() => this.layout()));
		this._register(this.editor.onDidLayoutChange(() => this.layout()));
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}

	get heightInLines(): number {
		return 1;
	}

	get afterLineNumber(): number {
		return 0;
	}

	protected create() {
		this._domNode = DOM.$('.settings-header-widget');

		this.titleContainer = DOM.append(this._domNode, DOM.$('.title-container'));
		if (this.title) {
			DOM.append(this.titleContainer, DOM.$('.title')).textContent = this.title;
		}
		this.messageElement = DOM.append(this.titleContainer, DOM.$('.message'));
		if (this.title) {
			this.messageElement.style.paddingLeft = '12px';
		}

		this.editor.changeViewZones(accessor => {
			this.id = accessor.addZone(this);
			this.layout();
		});
	}

	setMessage(message: string): void {
		this.messageElement.textContent = message;
	}

	private layout(): void {
		const options = this.editor.getOptions();
		const fontInfo = options.get(EditorOption.fontInfo);
		this.titleContainer.style.fontSize = fontInfo.fontSize + 'px';
		if (!options.get(EditorOption.folding)) {
			this.titleContainer.style.paddingLeft = '6px';
		}
	}

	override dispose() {
		this.editor.changeViewZones(accessor => {
			accessor.removeZone(this.id);
		});
		super.dispose();
	}
}

export class DefaultSettingsHeaderWidget extends SettingsHeaderWidget {

	private _onClick = this._register(new Emitter<void>());
	readonly onClick: Event<void> = this._onClick.event;

	protected override create() {
		super.create();

		this.toggleMessage(true);
	}

	toggleMessage(hasSettings: boolean): void {
		if (hasSettings) {
			this.setMessage(localize('defaultSettings', "Place your settings in the right hand side editor to override."));
		} else {
			this.setMessage(localize('noSettingsFound', "No Settings Found."));
		}
	}
}

export class SettingsGroupTitleWidget extends Widget implements IViewZone {

	private id!: string;
	private _afterLineNumber!: number;
	private _domNode!: HTMLElement;

	private titleContainer!: HTMLElement;
	private icon!: HTMLElement;
	private title!: HTMLElement;

	private _onToggled = this._register(new Emitter<boolean>());
	readonly onToggled: Event<boolean> = this._onToggled.event;

	private previousPosition: Position | null = null;

	constructor(private editor: ICodeEditor, public settingsGroup: ISettingsGroup) {
		super();
		this.create();
		this._register(this.editor.onDidChangeConfiguration(() => this.layout()));
		this._register(this.editor.onDidLayoutChange(() => this.layout()));
		this._register(this.editor.onDidChangeCursorPosition((e) => this.onCursorChange(e)));
	}

	get domNode(): HTMLElement {
		return this._domNode;
	}

	get heightInLines(): number {
		return 1.5;
	}

	get afterLineNumber(): number {
		return this._afterLineNumber;
	}

	private create() {
		this._domNode = DOM.$('.settings-group-title-widget');

		this.titleContainer = DOM.append(this._domNode, DOM.$('.title-container'));
		this.titleContainer.tabIndex = 0;
		this.onclick(this.titleContainer, () => this.toggle());
		this.onkeydown(this.titleContainer, (e) => this.onKeyDown(e));
		const focusTracker = this._register(DOM.trackFocus(this.titleContainer));

		this._register(focusTracker.onDidFocus(() => this.toggleFocus(true)));
		this._register(focusTracker.onDidBlur(() => this.toggleFocus(false)));

		this.icon = DOM.append(this.titleContainer, DOM.$(''));
		this.title = DOM.append(this.titleContainer, DOM.$('.title'));
		this.title.textContent = this.settingsGroup.title + ` (${this.settingsGroup.sections.reduce((count, section) => count + section.settings.length, 0)})`;

		this.updateTwisty(false);
		this.layout();
	}

	private getTwistyIcon(isCollapsed: boolean): ThemeIcon {
		return isCollapsed ? settingsGroupCollapsedIcon : settingsGroupExpandedIcon;
	}

	private updateTwisty(collapse: boolean) {
		this.icon.classList.remove(...ThemeIcon.asClassNameArray(this.getTwistyIcon(!collapse)));
		this.icon.classList.add(...ThemeIcon.asClassNameArray(this.getTwistyIcon(collapse)));
	}

	render() {
		if (!this.settingsGroup.range) {
			// #61352
			return;
		}

		this._afterLineNumber = this.settingsGroup.range.startLineNumber - 2;
		this.editor.changeViewZones(accessor => {
			this.id = accessor.addZone(this);
			this.layout();
		});
	}

	toggleCollapse(collapse: boolean) {
		this.titleContainer.classList.toggle('collapsed', collapse);
		this.updateTwisty(collapse);
	}

	toggleFocus(focus: boolean): void {
		this.titleContainer.classList.toggle('focused', focus);
	}

	isCollapsed(): boolean {
		return this.titleContainer.classList.contains('collapsed');
	}

	private layout(): void {
		const options = this.editor.getOptions();
		const fontInfo = options.get(EditorOption.fontInfo);
		const layoutInfo = this.editor.getLayoutInfo();
		this._domNode.style.width = layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth + 'px';
		this.titleContainer.style.lineHeight = options.get(EditorOption.lineHeight) + 3 + 'px';
		this.titleContainer.style.height = options.get(EditorOption.lineHeight) + 3 + 'px';
		this.titleContainer.style.fontSize = fontInfo.fontSize + 'px';
		this.icon.style.minWidth = `${this.getIconSize(16)}px`;
	}

	private getIconSize(minSize: number): number {
		const fontSize = this.editor.getOption(EditorOption.fontInfo).fontSize;
		return fontSize > 8 ? Math.max(fontSize, minSize) : 12;
	}

	private onKeyDown(keyboardEvent: IKeyboardEvent): void {
		switch (keyboardEvent.keyCode) {
			case KeyCode.Enter:
			case KeyCode.Space:
				this.toggle();
				break;
			case KeyCode.LeftArrow:
				this.collapse(true);
				break;
			case KeyCode.RightArrow:
				this.collapse(false);
				break;
			case KeyCode.UpArrow:
				if (this.settingsGroup.range.startLineNumber - 3 !== 1) {
					this.editor.focus();
					const lineNumber = this.settingsGroup.range.startLineNumber - 2;
					if (this.editor.hasModel()) {
						this.editor.setPosition({ lineNumber, column: this.editor.getModel().getLineMinColumn(lineNumber) });
					}
				}
				break;
			case KeyCode.DownArrow:
				const lineNumber = this.isCollapsed() ? this.settingsGroup.range.startLineNumber : this.settingsGroup.range.startLineNumber - 1;
				this.editor.focus();
				if (this.editor.hasModel()) {
					this.editor.setPosition({ lineNumber, column: this.editor.getModel().getLineMinColumn(lineNumber) });
				}
				break;
		}
	}

	private toggle() {
		this.collapse(!this.isCollapsed());
	}

	private collapse(collapse: boolean) {
		if (collapse !== this.isCollapsed()) {
			this.titleContainer.classList.toggle('collapsed', collapse);
			this.updateTwisty(collapse);
			this._onToggled.fire(collapse);
		}
	}

	private onCursorChange(e: ICursorPositionChangedEvent): void {
		if (e.source !== 'mouse' && this.focusTitle(e.position)) {
			this.titleContainer.focus();
		}
	}

	private focusTitle(currentPosition: Position): boolean {
		const previousPosition = this.previousPosition;
		this.previousPosition = currentPosition;
		if (!previousPosition) {
			return false;
		}
		if (previousPosition.lineNumber === currentPosition.lineNumber) {
			return false;
		}
		if (!this.settingsGroup.range) {
			// #60460?
			return false;
		}
		if (currentPosition.lineNumber === this.settingsGroup.range.startLineNumber - 1 || currentPosition.lineNumber === this.settingsGroup.range.startLineNumber - 2) {
			return true;
		}
		if (this.isCollapsed() && currentPosition.lineNumber === this.settingsGroup.range.endLineNumber) {
			return true;
		}
		return false;
	}

	override dispose() {
		this.editor.changeViewZones(accessor => {
			accessor.removeZone(this.id);
		});
		super.dispose();
	}
}

export class FolderSettingsActionViewItem extends BaseActionViewItem {

	private _folder: IWorkspaceFolder | null;
	private _folderSettingCounts = new Map<string, number>();

	private container!: HTMLElement;
	private anchorElement!: HTMLElement;
	private labelElement!: HTMLElement;
	private detailsElement!: HTMLElement;
	private dropDownElement!: HTMLElement;

	constructor(
		action: IAction,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
	) {
		super(null, action);
		const workspace = this.contextService.getWorkspace();
		this._folder = workspace.folders.length === 1 ? workspace.folders[0] : null;
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.onWorkspaceFoldersChanged()));
	}

	get folder(): IWorkspaceFolder | null {
		return this._folder;
	}

	set folder(folder: IWorkspaceFolder | null) {
		this._folder = folder;
		this.update();
	}

	setCount(settingsTarget: URI, count: number): void {
		const workspaceFolder = this.contextService.getWorkspaceFolder(settingsTarget);
		if (!workspaceFolder) {
			throw new Error('unknown folder');
		}
		const folder = workspaceFolder.uri;
		this._folderSettingCounts.set(folder.toString(), count);
		this.update();
	}

	override render(container: HTMLElement): void {
		this.element = container;

		this.container = container;
		this.labelElement = DOM.$('.action-title');
		this.detailsElement = DOM.$('.action-details');
		this.dropDownElement = DOM.$('.dropdown-icon.hide' + ThemeIcon.asCSSSelector(settingsScopeDropDownIcon));
		this.anchorElement = DOM.$('a.action-label.folder-settings', {
			role: 'button',
			'aria-haspopup': 'true',
			'tabindex': '0'
		}, this.labelElement, this.detailsElement, this.dropDownElement);
		this._register(DOM.addDisposableListener(this.anchorElement, DOM.EventType.MOUSE_DOWN, e => DOM.EventHelper.stop(e)));
		this._register(DOM.addDisposableListener(this.anchorElement, DOM.EventType.CLICK, e => this.onClick(e)));
		this._register(DOM.addDisposableListener(this.anchorElement, DOM.EventType.KEY_UP, e => this.onKeyUp(e)));

		DOM.append(this.container, this.anchorElement);

		this.update();
	}

	private onKeyUp(event: any): void {
		const keyboardEvent = new StandardKeyboardEvent(event);
		switch (keyboardEvent.keyCode) {
			case KeyCode.Enter:
			case KeyCode.Space:
				this.onClick(event);
				return;
		}
	}

	override onClick(event: DOM.EventLike): void {
		DOM.EventHelper.stop(event, true);
		if (!this.folder || this._action.checked) {
			this.showMenu();
		} else {
			this._action.run(this._folder);
		}
	}

	protected override updateEnabled(): void {
		this.update();
	}

	protected override updateChecked(): void {
		this.update();
	}

	private onWorkspaceFoldersChanged(): void {
		const oldFolder = this._folder;
		const workspace = this.contextService.getWorkspace();
		if (oldFolder) {
			this._folder = workspace.folders.filter(folder => isEqual(folder.uri, oldFolder.uri))[0] || workspace.folders[0];
		}
		this._folder = this._folder ? this._folder : workspace.folders.length === 1 ? workspace.folders[0] : null;

		this.update();

		if (this._action.checked) {
			this._action.run(this._folder);
		}
	}

	private async update(): Promise<void> {
		let total = 0;
		this._folderSettingCounts.forEach(n => total += n);

		const workspace = this.contextService.getWorkspace();
		if (this._folder) {
			this.labelElement.textContent = this._folder.name;
			this.anchorElement.title = (await this.preferencesService.getEditableSettingsURI(ConfigurationTarget.WORKSPACE_FOLDER, this._folder.uri))?.fsPath || '';
			const detailsText = this.labelWithCount(this._action.label, total);
			this.detailsElement.textContent = detailsText;
			this.dropDownElement.classList.toggle('hide', workspace.folders.length === 1 || !this._action.checked);
		} else {
			const labelText = this.labelWithCount(this._action.label, total);
			this.labelElement.textContent = labelText;
			this.detailsElement.textContent = '';
			this.anchorElement.title = this._action.label;
			this.dropDownElement.classList.remove('hide');
		}

		this.anchorElement.classList.toggle('checked', this._action.checked);
		this.container.classList.toggle('disabled', !this._action.enabled);
	}

	private showMenu(): void {
		this.contextMenuService.showContextMenu({
			getAnchor: () => this.container,
			getActions: () => this.getDropdownMenuActions(),
			getActionViewItem: () => undefined,
			onHide: () => {
				this.anchorElement.blur();
			}
		});
	}

	private getDropdownMenuActions(): IAction[] {
		const actions: IAction[] = [];
		const workspaceFolders = this.contextService.getWorkspace().folders;
		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE && workspaceFolders.length > 0) {
			actions.push(...workspaceFolders.map((folder, index) => {
				const folderCount = this._folderSettingCounts.get(folder.uri.toString());
				return <IAction>{
					id: 'folderSettingsTarget' + index,
					label: this.labelWithCount(folder.name, folderCount),
					checked: this.folder && isEqual(this.folder.uri, folder.uri),
					enabled: true,
					run: () => this._action.run(folder)
				};
			}));
		}
		return actions;
	}

	private labelWithCount(label: string, count: number | undefined): string {
		// Append the count if it's >0 and not undefined
		if (count) {
			label += ` (${count})`;
		}

		return label;
	}
}

export type SettingsTarget = ConfigurationTarget.USER_LOCAL | ConfigurationTarget.USER_REMOTE | ConfigurationTarget.WORKSPACE | URI;

export interface ISettingsTargetsWidgetOptions {
	enableRemoteSettings?: boolean;
}

export class SettingsTargetsWidget extends Widget {

	private settingsSwitcherBar!: ActionBar;
	private userLocalSettings!: Action;
	private userRemoteSettings!: Action;
	private workspaceSettings!: Action;
	private folderSettings!: FolderSettingsActionViewItem;
	private options: ISettingsTargetsWidgetOptions;

	private _settingsTarget: SettingsTarget | null = null;

	private readonly _onDidTargetChange = this._register(new Emitter<SettingsTarget>());
	readonly onDidTargetChange: Event<SettingsTarget> = this._onDidTargetChange.event;

	constructor(
		parent: HTMLElement,
		options: ISettingsTargetsWidgetOptions | undefined,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ILabelService private readonly labelService: ILabelService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
	) {
		super();
		this.options = options || {};
		this.create(parent);
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.onWorkbenchStateChanged()));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.update()));
	}

	private create(parent: HTMLElement): void {
		const settingsTabsWidget = DOM.append(parent, DOM.$('.settings-tabs-widget'));
		this.settingsSwitcherBar = this._register(new ActionBar(settingsTabsWidget, {
			orientation: ActionsOrientation.HORIZONTAL,
			ariaLabel: localize('settingsSwitcherBarAriaLabel', "Settings Switcher"),
			animated: false,
			actionViewItemProvider: (action: IAction) => action.id === 'folderSettings' ? this.folderSettings : undefined
		}));

		this.userLocalSettings = new Action('userSettings', localize('userSettings', "User"), '.settings-tab', true, () => this.updateTarget(ConfigurationTarget.USER_LOCAL));
		this.preferencesService.getEditableSettingsURI(ConfigurationTarget.USER_LOCAL).then(uri => {
			// Don't wait to create UI on resolving remote
			this.userLocalSettings.tooltip = uri?.fsPath || '';
		});

		const remoteAuthority = this.environmentService.remoteAuthority;
		const hostLabel = remoteAuthority && this.labelService.getHostLabel(Schemas.vscodeRemote, remoteAuthority);
		const remoteSettingsLabel = localize('userSettingsRemote', "Remote") +
			(hostLabel ? ` [${hostLabel}]` : '');
		this.userRemoteSettings = new Action('userSettingsRemote', remoteSettingsLabel, '.settings-tab', true, () => this.updateTarget(ConfigurationTarget.USER_REMOTE));
		this.preferencesService.getEditableSettingsURI(ConfigurationTarget.USER_REMOTE).then(uri => {
			this.userRemoteSettings.tooltip = uri?.fsPath || '';
		});

		this.workspaceSettings = new Action('workspaceSettings', localize('workspaceSettings', "Workspace"), '.settings-tab', false, () => this.updateTarget(ConfigurationTarget.WORKSPACE));

		const folderSettingsAction = new Action('folderSettings', localize('folderSettings', "Folder"), '.settings-tab', false, async folder => {
			this.updateTarget(isWorkspaceFolder(folder) ? folder.uri : ConfigurationTarget.USER_LOCAL);
		});
		this.folderSettings = this.instantiationService.createInstance(FolderSettingsActionViewItem, folderSettingsAction);

		this.update();

		this.settingsSwitcherBar.push([this.userLocalSettings, this.userRemoteSettings, this.workspaceSettings, folderSettingsAction]);
	}

	get settingsTarget(): SettingsTarget | null {
		return this._settingsTarget;
	}

	set settingsTarget(settingsTarget: SettingsTarget | null) {
		this._settingsTarget = settingsTarget;
		this.userLocalSettings.checked = ConfigurationTarget.USER_LOCAL === this.settingsTarget;
		this.userRemoteSettings.checked = ConfigurationTarget.USER_REMOTE === this.settingsTarget;
		this.workspaceSettings.checked = ConfigurationTarget.WORKSPACE === this.settingsTarget;
		if (this.settingsTarget instanceof URI) {
			this.folderSettings.getAction().checked = true;
			this.folderSettings.folder = this.contextService.getWorkspaceFolder(this.settingsTarget as URI);
		} else {
			this.folderSettings.getAction().checked = false;
		}
	}

	setResultCount(settingsTarget: SettingsTarget, count: number): void {
		if (settingsTarget === ConfigurationTarget.WORKSPACE) {
			let label = localize('workspaceSettings', "Workspace");
			if (count) {
				label += ` (${count})`;
			}

			this.workspaceSettings.label = label;
		} else if (settingsTarget === ConfigurationTarget.USER_LOCAL) {
			let label = localize('userSettings', "User");
			if (count) {
				label += ` (${count})`;
			}

			this.userLocalSettings.label = label;
		} else if (settingsTarget instanceof URI) {
			this.folderSettings.setCount(settingsTarget, count);
		}
	}

	private onWorkbenchStateChanged(): void {
		this.folderSettings.folder = null;
		this.update();
		if (this.settingsTarget === ConfigurationTarget.WORKSPACE && this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			this.updateTarget(ConfigurationTarget.USER_LOCAL);
		}
	}

	updateTarget(settingsTarget: SettingsTarget): Promise<void> {
		const isSameTarget = this.settingsTarget === settingsTarget ||
			settingsTarget instanceof URI &&
			this.settingsTarget instanceof URI &&
			isEqual(this.settingsTarget, settingsTarget);

		if (!isSameTarget) {
			this.settingsTarget = settingsTarget;
			this._onDidTargetChange.fire(this.settingsTarget);
		}

		return Promise.resolve(undefined);
	}

	private async update(): Promise<void> {
		this.settingsSwitcherBar.domNode.classList.toggle('empty-workbench', this.contextService.getWorkbenchState() === WorkbenchState.EMPTY);
		this.userRemoteSettings.enabled = !!(this.options.enableRemoteSettings && this.environmentService.remoteAuthority);
		this.workspaceSettings.enabled = this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY;
		this.folderSettings.getAction().enabled = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE && this.contextService.getWorkspace().folders.length > 0;

		this.workspaceSettings.tooltip = (await this.preferencesService.getEditableSettingsURI(ConfigurationTarget.WORKSPACE))?.fsPath || '';
	}
}

export interface SearchOptions extends IHistoryInputOptions {
	focusKey?: IContextKey<boolean>;
	showResultCount?: boolean;
	ariaLive?: string;
	ariaLabelledBy?: string;
}

export class SearchWidget extends Widget {

	domNode!: HTMLElement;

	private countElement!: HTMLElement;
	private searchContainer!: HTMLElement;
	inputBox!: HistoryInputBox;
	private controlsDiv!: HTMLElement;

	private readonly _onDidChange: Emitter<string> = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	private readonly _onFocus: Emitter<void> = this._register(new Emitter<void>());
	readonly onFocus: Event<void> = this._onFocus.event;

	constructor(parent: HTMLElement, protected options: SearchOptions,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();
		this.create(parent);
	}

	private create(parent: HTMLElement) {
		this.domNode = DOM.append(parent, DOM.$('div.settings-header-widget'));
		this.createSearchContainer(DOM.append(this.domNode, DOM.$('div.settings-search-container')));
		this.controlsDiv = DOM.append(this.domNode, DOM.$('div.settings-search-controls'));

		if (this.options.showResultCount) {
			this.countElement = DOM.append(this.controlsDiv, DOM.$('.settings-count-widget'));
			this._register(attachStylerCallback(this.themeService, { badgeBackground, contrastBorder }, colors => {
				const background = colors.badgeBackground ? colors.badgeBackground.toString() : '';
				const border = colors.contrastBorder ? colors.contrastBorder.toString() : '';

				this.countElement.style.backgroundColor = background;

				this.countElement.style.borderWidth = border ? '1px' : '';
				this.countElement.style.borderStyle = border ? 'solid' : '';
				this.countElement.style.borderColor = border;

				const color = this.themeService.getColorTheme().getColor(badgeForeground);
				this.countElement.style.color = color ? color.toString() : '';
			}));
		}

		this.inputBox.inputElement.setAttribute('aria-live', this.options.ariaLive || 'off');
		if (this.options.ariaLabelledBy) {
			this.inputBox.inputElement.setAttribute('aria-labelledBy', this.options.ariaLabelledBy);
		}
		const focusTracker = this._register(DOM.trackFocus(this.inputBox.inputElement));
		this._register(focusTracker.onDidFocus(() => this._onFocus.fire()));

		const focusKey = this.options.focusKey;
		if (focusKey) {
			this._register(focusTracker.onDidFocus(() => focusKey.set(true)));
			this._register(focusTracker.onDidBlur(() => focusKey.set(false)));
		}
	}

	private createSearchContainer(searchContainer: HTMLElement) {
		this.searchContainer = searchContainer;
		const searchInput = DOM.append(this.searchContainer, DOM.$('div.settings-search-input'));
		this.inputBox = this._register(this.createInputBox(searchInput));
		this._register(this.inputBox.onDidChange(value => this._onDidChange.fire(value)));
	}

	protected createInputBox(parent: HTMLElement): HistoryInputBox {
		const box = this._register(new ContextScopedHistoryInputBox(parent, this.contextViewService, this.options, this.contextKeyService));
		this._register(attachInputBoxStyler(box, this.themeService));

		return box;
	}

	showMessage(message: string): void {
		// Avoid setting the aria-label unnecessarily, the screenreader will read the count every time it's set, since it's aria-live:assertive. #50968
		if (this.countElement && message !== this.countElement.textContent) {
			this.countElement.textContent = message;
			this.inputBox.inputElement.setAttribute('aria-label', message);
			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
		}
	}

	layout(dimension: DOM.Dimension) {
		if (dimension.width < 400) {
			if (this.countElement) {
				this.countElement.classList.add('hide');
			}

			this.inputBox.inputElement.style.paddingRight = '0px';
		} else {
			if (this.countElement) {
				this.countElement.classList.remove('hide');
			}

			this.inputBox.inputElement.style.paddingRight = this.getControlsWidth() + 'px';
		}
	}

	private getControlsWidth(): number {
		const countWidth = this.countElement ? DOM.getTotalWidth(this.countElement) : 0;
		return countWidth + 20;
	}

	focus() {
		this.inputBox.focus();
		if (this.getValue()) {
			this.inputBox.select();
		}
	}

	hasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	clear() {
		this.inputBox.value = '';
	}

	getValue(): string {
		return this.inputBox.value;
	}

	setValue(value: string): string {
		return this.inputBox.value = value;
	}

	override dispose(): void {
		if (this.options.focusKey) {
			this.options.focusKey.set(false);
		}
		super.dispose();
	}
}

export class EditPreferenceWidget<T> extends Disposable {

	private _line: number = -1;
	private _preferences: T[] = [];

	private _editPreferenceDecoration: string[];

	private readonly _onClick = this._register(new Emitter<IEditorMouseEvent>());
	readonly onClick: Event<IEditorMouseEvent> = this._onClick.event;

	constructor(private editor: ICodeEditor
	) {
		super();
		this._editPreferenceDecoration = [];
		this._register(this.editor.onMouseDown((e: IEditorMouseEvent) => {
			const data = e.target.detail as IMarginData;
			if (e.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || data.isAfterLines || !this.isVisible()) {
				return;
			}
			this._onClick.fire(e);
		}));
	}

	get preferences(): T[] {
		return this._preferences;
	}

	getLine(): number {
		return this._line;
	}

	show(line: number, hoverMessage: string, preferences: T[]): void {
		this._preferences = preferences;
		const newDecoration: IModelDeltaDecoration[] = [];
		this._line = line;
		newDecoration.push({
			options: {
				glyphMarginClassName: ThemeIcon.asClassName(settingsEditIcon),
				glyphMarginHoverMessage: new MarkdownString().appendText(hoverMessage),
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
			},
			range: {
				startLineNumber: line,
				startColumn: 1,
				endLineNumber: line,
				endColumn: 1
			}
		});
		this._editPreferenceDecoration = this.editor.deltaDecorations(this._editPreferenceDecoration, newDecoration);
	}

	hide(): void {
		this._editPreferenceDecoration = this.editor.deltaDecorations(this._editPreferenceDecoration, []);
	}

	isVisible(): boolean {
		return this._editPreferenceDecoration.length > 0;
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	collector.addRule(`
		.settings-tabs-widget > .monaco-action-bar .action-item .action-label:focus,
		.settings-tabs-widget > .monaco-action-bar .action-item .action-label.checked {
			border-bottom: 1px solid;
		}
	`);
	// Title Active
	const titleActive = theme.getColor(PANEL_ACTIVE_TITLE_FOREGROUND);
	const titleActiveBorder = theme.getColor(PANEL_ACTIVE_TITLE_BORDER);
	if (titleActive || titleActiveBorder) {
		collector.addRule(`
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label:hover,
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label.checked {
				color: ${titleActive};
				border-bottom-color: ${titleActiveBorder};
			}
		`);
	}

	// Title Inactive
	const titleInactive = theme.getColor(PANEL_INACTIVE_TITLE_FOREGROUND);
	if (titleInactive) {
		collector.addRule(`
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label {
				color: ${titleInactive};
			}
		`);
	}

	// Title focus
	const focusBorderColor = theme.getColor(focusBorder);
	if (focusBorderColor) {
		collector.addRule(`
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label:focus {
				border-bottom-color: ${focusBorderColor} !important;
			}
			`);
		collector.addRule(`
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label:focus {
				outline: none;
			}
			`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const outline = theme.getColor(activeContrastBorder);
	if (outline) {
		const outline = theme.getColor(activeContrastBorder);

		collector.addRule(`
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label.checked,
			.settings-tabs-widget > .monaco-action-bar .action-item .action-label:hover {
				outline-color: ${outline};
				outline-width: 1px;
				outline-style: solid;
				border-bottom: none;
				padding-bottom: 0;
				outline-offset: -1px;
			}

			.settings-tabs-widget > .monaco-action-bar .action-item .action-label:not(.checked):hover {
				outline-style: dashed;
			}
		`);
	}
});
