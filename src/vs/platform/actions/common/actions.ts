/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { SyncDescriptor, SyncDescriptor0 } from 'vs/platform/instantiation/common/descriptors';
import { IConstructorSignature2, createDecorator, BrandedService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindings, KeybindingsRegistry, IKeybindingRule } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ContextKeyExpr, IContextKeyService, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService, CommandsRegistry, ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { IDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { UriDto } from 'vs/base/common/types';
import { Iterable } from 'vs/base/common/iterator';
import { LinkedList } from 'vs/base/common/linkedList';
import { CSSIcon } from 'vs/base/common/codicons';

export interface ILocalizedString {
	/**
	 * The localized value of the string.
	 */
	value: string;
	/**
	 * The original (non localized value of the string)
	 */
	original: string;
}

export interface ICommandActionTitle extends ILocalizedString {
	/**
	 * The title with a mnemonic designation. && precedes the mnemonic.
	 */
	mnemonicTitle?: string;
}

export type Icon = { dark?: URI; light?: URI; } | ThemeIcon;

export interface ICommandAction {
	id: string;
	title: string | ICommandActionTitle;
	shortTitle?: string | ICommandActionTitle;
	category?: string | ILocalizedString;
	tooltip?: string;
	icon?: Icon;
	precondition?: ContextKeyExpression;
	toggled?: ContextKeyExpression | { condition: ContextKeyExpression, icon?: Icon, tooltip?: string, title?: string | ILocalizedString };
}

export type ISerializableCommandAction = UriDto<ICommandAction>;

export interface IMenuItem {
	command: ICommandAction;
	alt?: ICommandAction;
	when?: ContextKeyExpression;
	group?: 'navigation' | string;
	order?: number;
}

export interface ISubmenuItem {
	title: string | ICommandActionTitle;
	submenu: MenuId;
	icon?: Icon;
	when?: ContextKeyExpression;
	group?: 'navigation' | string;
	order?: number;
	rememberDefaultAction?: boolean;	// for dropdown menu: if true the last executed action is remembered as the default action
}

export function isIMenuItem(item: IMenuItem | ISubmenuItem): item is IMenuItem {
	return (item as IMenuItem).command !== undefined;
}

export function isISubmenuItem(item: IMenuItem | ISubmenuItem): item is ISubmenuItem {
	return (item as ISubmenuItem).submenu !== undefined;
}

export class MenuId {

	private static _idPool = 0;

	static readonly CommandPalette = new MenuId('CommandPalette');
	static readonly DebugBreakpointsContext = new MenuId('DebugBreakpointsContext');
	static readonly DebugCallStackContext = new MenuId('DebugCallStackContext');
	static readonly DebugConsoleContext = new MenuId('DebugConsoleContext');
	static readonly DebugVariablesContext = new MenuId('DebugVariablesContext');
	static readonly DebugWatchContext = new MenuId('DebugWatchContext');
	static readonly DebugToolBar = new MenuId('DebugToolBar');
	static readonly EditorContext = new MenuId('EditorContext');
	static readonly SimpleEditorContext = new MenuId('SimpleEditorContext');
	static readonly EditorContextCopy = new MenuId('EditorContextCopy');
	static readonly EditorContextPeek = new MenuId('EditorContextPeek');
	static readonly EditorTitle = new MenuId('EditorTitle');
	static readonly EditorTitleRun = new MenuId('EditorTitleRun');
	static readonly EditorTitleContext = new MenuId('EditorTitleContext');
	static readonly EmptyEditorGroupContext = new MenuId('EmptyEditorGroupContext');
	static readonly ExplorerContext = new MenuId('ExplorerContext');
	static readonly ExtensionContext = new MenuId('ExtensionContext');
	static readonly GlobalActivity = new MenuId('GlobalActivity');
	static readonly MenubarMainMenu = new MenuId('MenubarMainMenu');
	static readonly MenubarAppearanceMenu = new MenuId('MenubarAppearanceMenu');
	static readonly MenubarDebugMenu = new MenuId('MenubarDebugMenu');
	static readonly MenubarEditMenu = new MenuId('MenubarEditMenu');
	static readonly MenubarCopy = new MenuId('MenubarCopy');
	static readonly MenubarFileMenu = new MenuId('MenubarFileMenu');
	static readonly MenubarGoMenu = new MenuId('MenubarGoMenu');
	static readonly MenubarHelpMenu = new MenuId('MenubarHelpMenu');
	static readonly MenubarLayoutMenu = new MenuId('MenubarLayoutMenu');
	static readonly MenubarNewBreakpointMenu = new MenuId('MenubarNewBreakpointMenu');
	static readonly MenubarPreferencesMenu = new MenuId('MenubarPreferencesMenu');
	static readonly MenubarRecentMenu = new MenuId('MenubarRecentMenu');
	static readonly MenubarSelectionMenu = new MenuId('MenubarSelectionMenu');
	static readonly MenubarSwitchEditorMenu = new MenuId('MenubarSwitchEditorMenu');
	static readonly MenubarSwitchGroupMenu = new MenuId('MenubarSwitchGroupMenu');
	static readonly MenubarTerminalMenu = new MenuId('MenubarTerminalMenu');
	static readonly MenubarViewMenu = new MenuId('MenubarViewMenu');
	static readonly MenubarHomeMenu = new MenuId('MenubarHomeMenu');
	static readonly OpenEditorsContext = new MenuId('OpenEditorsContext');
	static readonly ProblemsPanelContext = new MenuId('ProblemsPanelContext');
	static readonly SCMChangeContext = new MenuId('SCMChangeContext');
	static readonly SCMResourceContext = new MenuId('SCMResourceContext');
	static readonly SCMResourceFolderContext = new MenuId('SCMResourceFolderContext');
	static readonly SCMResourceGroupContext = new MenuId('SCMResourceGroupContext');
	static readonly SCMSourceControl = new MenuId('SCMSourceControl');
	static readonly SCMTitle = new MenuId('SCMTitle');
	static readonly SearchContext = new MenuId('SearchContext');
	static readonly StatusBarWindowIndicatorMenu = new MenuId('StatusBarWindowIndicatorMenu');
	static readonly StatusBarRemoteIndicatorMenu = new MenuId('StatusBarRemoteIndicatorMenu');
	static readonly TestItem = new MenuId('TestItem');
	static readonly TestPeekElement = new MenuId('TestPeekElement');
	static readonly TestPeekTitle = new MenuId('TestPeekTitle');
	static readonly TouchBarContext = new MenuId('TouchBarContext');
	static readonly TitleBarContext = new MenuId('TitleBarContext');
	static readonly TunnelContext = new MenuId('TunnelContext');
	static readonly TunnelProtocol = new MenuId('TunnelProtocol');
	static readonly TunnelPortInline = new MenuId('TunnelInline');
	static readonly TunnelTitle = new MenuId('TunnelTitle');
	static readonly TunnelLocalAddressInline = new MenuId('TunnelLocalAddressInline');
	static readonly TunnelOriginInline = new MenuId('TunnelOriginInline');
	static readonly ViewItemContext = new MenuId('ViewItemContext');
	static readonly ViewContainerTitle = new MenuId('ViewContainerTitle');
	static readonly ViewContainerTitleContext = new MenuId('ViewContainerTitleContext');
	// TODO@wendell: third panel context
	static readonly ViewTitle = new MenuId('ViewTitle');
	static readonly ViewTitleContext = new MenuId('ViewTitleContext');
	static readonly CommentThreadTitle = new MenuId('CommentThreadTitle');
	static readonly CommentThreadActions = new MenuId('CommentThreadActions');
	static readonly CommentTitle = new MenuId('CommentTitle');
	static readonly CommentActions = new MenuId('CommentActions');
	static readonly InteractiveToolbar = new MenuId('InteractiveToolbar');
	static readonly InteractiveCellTitle = new MenuId('InteractiveCellTitle');
	static readonly InteractiveCellExecute = new MenuId('InteractiveCellExecute');
	static readonly NotebookToolbar = new MenuId('NotebookToolbar');
	static readonly NotebookCellTitle = new MenuId('NotebookCellTitle');
	static readonly NotebookCellInsert = new MenuId('NotebookCellInsert');
	static readonly NotebookCellBetween = new MenuId('NotebookCellBetween');
	static readonly NotebookCellListTop = new MenuId('NotebookCellTop');
	static readonly NotebookCellExecute = new MenuId('NotebookCellExecute');
	static readonly NotebookDiffCellInputTitle = new MenuId('NotebookDiffCellInputTitle');
	static readonly NotebookDiffCellMetadataTitle = new MenuId('NotebookDiffCellMetadataTitle');
	static readonly NotebookDiffCellOutputsTitle = new MenuId('NotebookDiffCellOutputsTitle');
	static readonly NotebookOutputToolbar = new MenuId('NotebookOutputToolbar');
	static readonly BulkEditTitle = new MenuId('BulkEditTitle');
	static readonly BulkEditContext = new MenuId('BulkEditContext');
	static readonly TimelineItemContext = new MenuId('TimelineItemContext');
	static readonly TimelineTitle = new MenuId('TimelineTitle');
	static readonly TimelineTitleContext = new MenuId('TimelineTitleContext');
	static readonly AccountsContext = new MenuId('AccountsContext');
	static readonly PanelTitle = new MenuId('PanelTitle');
	static readonly TerminalInstanceContext = new MenuId('TerminalInstanceContext');
	static readonly TerminalNewDropdownContext = new MenuId('TerminalNewDropdownContext');
	static readonly TerminalTabContext = new MenuId('TerminalTabContext');
	static readonly TerminalTabEmptyAreaContext = new MenuId('TerminalTabEmptyAreaContext');
	static readonly TerminalInlineTabContext = new MenuId('TerminalInlineTabContext');
	static readonly WebviewContext = new MenuId('WebviewContext');
	static readonly InlineCompletionsActions = new MenuId('InlineCompletionsActions');
	static readonly NewFile = new MenuId('NewFile');

	readonly id: number;
	readonly _debugName: string;

	constructor(debugName: string) {
		this.id = MenuId._idPool++;
		this._debugName = debugName;
	}
}

export interface IMenuActionOptions {
	arg?: any;
	shouldForwardArgs?: boolean;
	renderShortTitle?: boolean;
}

export interface IMenu extends IDisposable {
	readonly onDidChange: Event<IMenu>;
	getActions(options?: IMenuActionOptions): [string, Array<MenuItemAction | SubmenuItemAction>][];
}

export const IMenuService = createDecorator<IMenuService>('menuService');

export interface IMenuService {

	readonly _serviceBrand: undefined;

	createMenu(id: MenuId, contextKeyService: IContextKeyService, emitEventsForSubmenuChanges?: boolean): IMenu;
}

export type ICommandsMap = Map<string, ICommandAction>;

export interface IMenuRegistryChangeEvent {
	has(id: MenuId): boolean;
}

export interface IMenuRegistry {
	readonly onDidChangeMenu: Event<IMenuRegistryChangeEvent>;
	addCommands(newCommands: Iterable<ICommandAction>): IDisposable;
	addCommand(userCommand: ICommandAction): IDisposable;
	getCommand(id: string): ICommandAction | undefined;
	getCommands(): ICommandsMap;
	appendMenuItems(items: Iterable<{ id: MenuId, item: IMenuItem | ISubmenuItem }>): IDisposable;
	appendMenuItem(menu: MenuId, item: IMenuItem | ISubmenuItem): IDisposable;
	getMenuItems(loc: MenuId): Array<IMenuItem | ISubmenuItem>;
}

export const MenuRegistry: IMenuRegistry = new class implements IMenuRegistry {

	private readonly _commands = new Map<string, ICommandAction>();
	private readonly _menuItems = new Map<MenuId, LinkedList<IMenuItem | ISubmenuItem>>();
	private readonly _onDidChangeMenu = new Emitter<IMenuRegistryChangeEvent>();

	readonly onDidChangeMenu: Event<IMenuRegistryChangeEvent> = this._onDidChangeMenu.event;

	addCommand(command: ICommandAction): IDisposable {
		return this.addCommands(Iterable.single(command));
	}

	private readonly _commandPaletteChangeEvent: IMenuRegistryChangeEvent = {
		has: id => id === MenuId.CommandPalette
	};

	addCommands(commands: Iterable<ICommandAction>): IDisposable {
		for (const command of commands) {
			this._commands.set(command.id, command);
		}
		this._onDidChangeMenu.fire(this._commandPaletteChangeEvent);
		return toDisposable(() => {
			let didChange = false;
			for (const command of commands) {
				didChange = this._commands.delete(command.id) || didChange;
			}
			if (didChange) {
				this._onDidChangeMenu.fire(this._commandPaletteChangeEvent);
			}
		});
	}

	getCommand(id: string): ICommandAction | undefined {
		return this._commands.get(id);
	}

	getCommands(): ICommandsMap {
		const map = new Map<string, ICommandAction>();
		this._commands.forEach((value, key) => map.set(key, value));
		return map;
	}

	appendMenuItem(id: MenuId, item: IMenuItem | ISubmenuItem): IDisposable {
		return this.appendMenuItems(Iterable.single({ id, item }));
	}

	appendMenuItems(items: Iterable<{ id: MenuId, item: IMenuItem | ISubmenuItem }>): IDisposable {

		const changedIds = new Set<MenuId>();
		const toRemove = new LinkedList<Function>();

		for (const { id, item } of items) {
			let list = this._menuItems.get(id);
			if (!list) {
				list = new LinkedList();
				this._menuItems.set(id, list);
			}
			toRemove.push(list.push(item));
			changedIds.add(id);
		}

		this._onDidChangeMenu.fire(changedIds);

		return toDisposable(() => {
			if (toRemove.size > 0) {
				for (let fn of toRemove) {
					fn();
				}
				this._onDidChangeMenu.fire(changedIds);
				toRemove.clear();
			}
		});
	}

	getMenuItems(id: MenuId): Array<IMenuItem | ISubmenuItem> {
		let result: Array<IMenuItem | ISubmenuItem>;
		if (this._menuItems.has(id)) {
			result = [...this._menuItems.get(id)!];
		} else {
			result = [];
		}
		if (id === MenuId.CommandPalette) {
			// CommandPalette is special because it shows
			// all commands by default
			this._appendImplicitItems(result);
		}
		return result;
	}

	private _appendImplicitItems(result: Array<IMenuItem | ISubmenuItem>) {
		const set = new Set<string>();

		for (const item of result) {
			if (isIMenuItem(item)) {
				set.add(item.command.id);
				if (item.alt) {
					set.add(item.alt.id);
				}
			}
		}
		this._commands.forEach((command, id) => {
			if (!set.has(id)) {
				result.push({ command });
			}
		});
	}
};

export class ExecuteCommandAction extends Action {

	constructor(
		id: string,
		label: string,
		@ICommandService private readonly _commandService: ICommandService) {

		super(id, label);
	}

	override run(...args: any[]): Promise<void> {
		return this._commandService.executeCommand(this.id, ...args);
	}
}

export class SubmenuItemAction extends SubmenuAction {

	constructor(
		readonly item: ISubmenuItem,
		private readonly _menuService: IMenuService,
		private readonly _contextKeyService: IContextKeyService,
		private readonly _options?: IMenuActionOptions
	) {
		super(`submenuitem.${item.submenu.id}`, typeof item.title === 'string' ? item.title : item.title.value, [], 'submenu');
	}

	override get actions(): readonly IAction[] {
		const result: IAction[] = [];
		const menu = this._menuService.createMenu(this.item.submenu, this._contextKeyService);
		const groups = menu.getActions(this._options);
		menu.dispose();
		for (const [, actions] of groups) {
			if (actions.length > 0) {
				result.push(...actions);
				result.push(new Separator());
			}
		}
		if (result.length) {
			result.pop(); // remove last separator
		}
		return result;
	}
}

// implements IAction, does NOT extend Action, so that no one
// subscribes to events of Action or modified properties
export class MenuItemAction implements IAction {

	readonly item: ICommandAction;
	readonly alt: MenuItemAction | undefined;

	private readonly _options: IMenuActionOptions | undefined;

	readonly id: string;
	readonly label: string;
	readonly tooltip: string;
	readonly class: string | undefined;
	readonly enabled: boolean;
	readonly checked: boolean;

	constructor(
		item: ICommandAction,
		alt: ICommandAction | undefined,
		options: IMenuActionOptions | undefined,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService private _commandService: ICommandService
	) {
		this.id = item.id;
		this.label = options?.renderShortTitle && item.shortTitle
			? (typeof item.shortTitle === 'string' ? item.shortTitle : item.shortTitle.value)
			: (typeof item.title === 'string' ? item.title : item.title.value);
		this.tooltip = item.tooltip ?? '';
		this.enabled = !item.precondition || contextKeyService.contextMatchesRules(item.precondition);
		this.checked = false;

		if (item.toggled) {
			const toggled = ((item.toggled as { condition: ContextKeyExpression }).condition ? item.toggled : { condition: item.toggled }) as {
				condition: ContextKeyExpression, icon?: Icon, tooltip?: string | ILocalizedString, title?: string | ILocalizedString
			};
			this.checked = contextKeyService.contextMatchesRules(toggled.condition);
			if (this.checked && toggled.tooltip) {
				this.tooltip = typeof toggled.tooltip === 'string' ? toggled.tooltip : toggled.tooltip.value;
			}

			if (toggled.title) {
				this.label = typeof toggled.title === 'string' ? toggled.title : toggled.title.value;
			}
		}

		this.item = item;
		this.alt = alt ? new MenuItemAction(alt, undefined, options, contextKeyService, _commandService) : undefined;
		this._options = options;
		if (ThemeIcon.isThemeIcon(item.icon)) {
			this.class = CSSIcon.asClassName(item.icon);
		}
	}

	dispose(): void {
		// there is NOTHING to dispose and the MenuItemAction should
		// never have anything to dispose as it is a convenience type
		// to bridge into the rendering world.
	}

	run(...args: any[]): Promise<void> {
		let runArgs: any[] = [];

		if (this._options?.arg) {
			runArgs = [...runArgs, this._options.arg];
		}

		if (this._options?.shouldForwardArgs) {
			runArgs = [...runArgs, ...args];
		}

		return this._commandService.executeCommand(this.id, ...runArgs);
	}
}

export class SyncActionDescriptor {

	private readonly _descriptor: SyncDescriptor0<Action>;

	private readonly _id: string;
	private readonly _label?: string;
	private readonly _keybindings: IKeybindings | undefined;
	private readonly _keybindingContext: ContextKeyExpression | undefined;
	private readonly _keybindingWeight: number | undefined;

	public static create<Services extends BrandedService[]>(ctor: { new(id: string, label: string, ...services: Services): Action },
		id: string, label: string | undefined, keybindings?: IKeybindings, keybindingContext?: ContextKeyExpression, keybindingWeight?: number
	): SyncActionDescriptor {
		return new SyncActionDescriptor(ctor as IConstructorSignature2<string, string | undefined, Action>, id, label, keybindings, keybindingContext, keybindingWeight);
	}

	public static from<Services extends BrandedService[]>(
		ctor: {
			new(id: string, label: string, ...services: Services): Action;
			readonly ID: string;
			readonly LABEL: string;
		},
		keybindings?: IKeybindings, keybindingContext?: ContextKeyExpression, keybindingWeight?: number
	): SyncActionDescriptor {
		return SyncActionDescriptor.create(ctor, ctor.ID, ctor.LABEL, keybindings, keybindingContext, keybindingWeight);
	}

	private constructor(ctor: IConstructorSignature2<string, string | undefined, Action>,
		id: string, label: string | undefined, keybindings?: IKeybindings, keybindingContext?: ContextKeyExpression, keybindingWeight?: number
	) {
		this._id = id;
		this._label = label;
		this._keybindings = keybindings;
		this._keybindingContext = keybindingContext;
		this._keybindingWeight = keybindingWeight;
		this._descriptor = new SyncDescriptor(ctor, [this._id, this._label]) as unknown as SyncDescriptor0<Action>;
	}

	public get syncDescriptor(): SyncDescriptor0<Action> {
		return this._descriptor;
	}

	public get id(): string {
		return this._id;
	}

	public get label(): string | undefined {
		return this._label;
	}

	public get keybindings(): IKeybindings | undefined {
		return this._keybindings;
	}

	public get keybindingContext(): ContextKeyExpression | undefined {
		return this._keybindingContext;
	}

	public get keybindingWeight(): number | undefined {
		return this._keybindingWeight;
	}
}

//#region --- IAction2

type OneOrN<T> = T | T[];

export interface IAction2Options extends ICommandAction {

	/**
	 * Shorthand to add this command to the command palette
	 */
	f1?: boolean;

	/**
	 * One or many menu items.
	 */
	menu?: OneOrN<{ id: MenuId } & Omit<IMenuItem, 'command'>>;

	/**
	 * One keybinding.
	 */
	keybinding?: OneOrN<Omit<IKeybindingRule, 'id'>>;

	/**
	 * Metadata about this command, used for API commands or when
	 * showing keybindings that have no other UX.
	 */
	description?: ICommandHandlerDescription;
}

export abstract class Action2 {
	constructor(readonly desc: Readonly<IAction2Options>) { }
	abstract run(accessor: ServicesAccessor, ...args: any[]): void;
}

export function registerAction2(ctor: { new(): Action2 }): IDisposable {
	const disposables = new DisposableStore();
	const action = new ctor();

	const { f1, menu, keybinding, description, ...command } = action.desc;

	// command
	disposables.add(CommandsRegistry.registerCommand({
		id: command.id,
		handler: (accessor, ...args) => action.run(accessor, ...args),
		description: description,
	}));

	// menu
	if (Array.isArray(menu)) {
		disposables.add(MenuRegistry.appendMenuItems(menu.map(item => ({ id: item.id, item: { command, ...item } }))));

	} else if (menu) {
		disposables.add(MenuRegistry.appendMenuItem(menu.id, { command, ...menu }));
	}
	if (f1) {
		disposables.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command, when: command.precondition }));
		disposables.add(MenuRegistry.addCommand(command));
	}

	// keybinding
	if (Array.isArray(keybinding)) {
		for (let item of keybinding) {
			KeybindingsRegistry.registerKeybindingRule({
				...item,
				id: command.id,
				when: command.precondition ? ContextKeyExpr.and(command.precondition, item.when) : item.when
			});
		}
	} else if (keybinding) {
		KeybindingsRegistry.registerKeybindingRule({
			...keybinding,
			id: command.id,
			when: command.precondition ? ContextKeyExpr.and(command.precondition, keybinding.when) : keybinding.when
		});
	}

	return disposables;
}
//#endregion
