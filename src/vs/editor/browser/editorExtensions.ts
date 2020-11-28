/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor, IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { Position } from 'vs/editor/common/core/position';
import { IEditorContribution, IDiffEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { MenuId, MenuRegistry, Action2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, IContextKeyService, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { IConstructorSignature1, ServicesAccessor as InstantiationServicesAccessor, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindings, KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { withNullAsUndefined, assertType } from 'vs/base/common/types';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';


export type ServicesAccessor = InstantiationServicesAccessor;
export type IEditorContributionCtor = IConstructorSignature1<ICodeEditor, IEditorContribution>;
export type IDiffEditorContributionCtor = IConstructorSignature1<IDiffEditor, IDiffEditorContribution>;

export interface IEditorContributionDescription {
	id: string;
	ctor: IEditorContributionCtor;
}

export interface IDiffEditorContributionDescription {
	id: string;
	ctor: IDiffEditorContributionCtor;
}

//#region Command

export interface ICommandKeybindingsOptions extends IKeybindings {
	kbExpr?: ContextKeyExpression | null;
	weight: number;
	/**
	 * the default keybinding arguments
	 */
	args?: any;
}
export interface ICommandMenuOptions {
	menuId: MenuId;
	group: string;
	order: number;
	when?: ContextKeyExpression;
	title: string;
	icon?: ThemeIcon
}
export interface ICommandOptions {
	id: string;
	precondition: ContextKeyExpression | undefined;
	kbOpts?: ICommandKeybindingsOptions;
	description?: ICommandHandlerDescription;
	menuOpts?: ICommandMenuOptions | ICommandMenuOptions[];
}
export abstract class Command {
	public readonly id: string;
	public readonly precondition: ContextKeyExpression | undefined;
	private readonly _kbOpts: ICommandKeybindingsOptions | undefined;
	private readonly _menuOpts: ICommandMenuOptions | ICommandMenuOptions[] | undefined;
	private readonly _description: ICommandHandlerDescription | undefined;

	constructor(opts: ICommandOptions) {
		this.id = opts.id;
		this.precondition = opts.precondition;
		this._kbOpts = opts.kbOpts;
		this._menuOpts = opts.menuOpts;
		this._description = opts.description;
	}

	public register(): void {

		if (Array.isArray(this._menuOpts)) {
			this._menuOpts.forEach(this._registerMenuItem, this);
		} else if (this._menuOpts) {
			this._registerMenuItem(this._menuOpts);
		}

		if (this._kbOpts) {
			let kbWhen = this._kbOpts.kbExpr;
			if (this.precondition) {
				if (kbWhen) {
					kbWhen = ContextKeyExpr.and(kbWhen, this.precondition);
				} else {
					kbWhen = this.precondition;
				}
			}

			KeybindingsRegistry.registerCommandAndKeybindingRule({
				id: this.id,
				handler: (accessor, args) => this.runCommand(accessor, args),
				weight: this._kbOpts.weight,
				args: this._kbOpts.args,
				when: kbWhen,
				primary: this._kbOpts.primary,
				secondary: this._kbOpts.secondary,
				win: this._kbOpts.win,
				linux: this._kbOpts.linux,
				mac: this._kbOpts.mac,
				description: this._description
			});

		} else {

			CommandsRegistry.registerCommand({
				id: this.id,
				handler: (accessor, args) => this.runCommand(accessor, args),
				description: this._description
			});
		}
	}

	private _registerMenuItem(item: ICommandMenuOptions): void {
		MenuRegistry.appendMenuItem(item.menuId, {
			group: item.group,
			command: {
				id: this.id,
				title: item.title,
				icon: item.icon,
				precondition: this.precondition
			},
			when: item.when,
			order: item.order
		});
	}

	public abstract runCommand(accessor: ServicesAccessor, args: any): void | Promise<void>;
}

//#endregion Command

//#region MultiplexingCommand

/**
 * Potential override for a command.
 *
 * @return `true` if the command was successfully run. This stops other overrides from being executed.
 */
export type CommandImplementation = (accessor: ServicesAccessor, args: unknown) => boolean | Promise<void>;

export class MultiCommand extends Command {

	private readonly _implementations: [number, CommandImplementation][] = [];

	/**
	 * A higher priority gets to be looked at first
	 */
	public addImplementation(priority: number, implementation: CommandImplementation): IDisposable {
		this._implementations.push([priority, implementation]);
		this._implementations.sort((a, b) => b[0] - a[0]);
		return {
			dispose: () => {
				for (let i = 0; i < this._implementations.length; i++) {
					if (this._implementations[i][1] === implementation) {
						this._implementations.splice(i, 1);
						return;
					}
				}
			}
		};
	}

	public runCommand(accessor: ServicesAccessor, args: any): void | Promise<void> {
		for (const impl of this._implementations) {
			const result = impl[1](accessor, args);
			if (result) {
				if (typeof result === 'boolean') {
					return;
				}
				return result;
			}
		}
	}
}

//#endregion

/**
 * A command that delegates to another command's implementation.
 *
 * This lets different commands be registered but share the same implementation
 */
export class ProxyCommand extends Command {
	constructor(
		private readonly command: Command,
		opts: ICommandOptions
	) {
		super(opts);
	}

	public runCommand(accessor: ServicesAccessor, args: any): void | Promise<void> {
		return this.command.runCommand(accessor, args);
	}
}

//#region EditorCommand

export interface IContributionCommandOptions<T> extends ICommandOptions {
	handler: (controller: T, args: any) => void;
}
export interface EditorControllerCommand<T extends IEditorContribution> {
	new(opts: IContributionCommandOptions<T>): EditorCommand;
}
export abstract class EditorCommand extends Command {

	/**
	 * Create a command class that is bound to a certain editor contribution.
	 */
	public static bindToContribution<T extends IEditorContribution>(controllerGetter: (editor: ICodeEditor) => T): EditorControllerCommand<T> {
		return class EditorControllerCommandImpl extends EditorCommand {
			private readonly _callback: (controller: T, args: any) => void;

			constructor(opts: IContributionCommandOptions<T>) {
				super(opts);

				this._callback = opts.handler;
			}

			public runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
				const controller = controllerGetter(editor);
				if (controller) {
					this._callback(controllerGetter(editor), args);
				}
			}
		};
	}

	public runCommand(accessor: ServicesAccessor, args: any): void | Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);

		// Find the editor with text focus or active
		const editor = codeEditorService.getFocusedCodeEditor() || codeEditorService.getActiveCodeEditor();
		if (!editor) {
			// well, at least we tried...
			return;
		}

		return editor.invokeWithinContext((editorAccessor) => {
			const kbService = editorAccessor.get(IContextKeyService);
			if (!kbService.contextMatchesRules(withNullAsUndefined(this.precondition))) {
				// precondition does not hold
				return;
			}

			return this.runEditorCommand(editorAccessor, editor!, args);
		});
	}

	public abstract runEditorCommand(accessor: ServicesAccessor | null, editor: ICodeEditor, args: any): void | Promise<void>;
}

//#endregion EditorCommand

//#region EditorAction

export interface IEditorActionContextMenuOptions {
	group: string;
	order: number;
	when?: ContextKeyExpression;
	menuId?: MenuId;
}
export interface IActionOptions extends ICommandOptions {
	label: string;
	alias: string;
	contextMenuOpts?: IEditorActionContextMenuOptions | IEditorActionContextMenuOptions[];
}

export abstract class EditorAction extends EditorCommand {

	private static convertOptions(opts: IActionOptions): ICommandOptions {

		let menuOpts: ICommandMenuOptions[];
		if (Array.isArray(opts.menuOpts)) {
			menuOpts = opts.menuOpts;
		} else if (opts.menuOpts) {
			menuOpts = [opts.menuOpts];
		} else {
			menuOpts = [];
		}

		function withDefaults(item: Partial<ICommandMenuOptions>): ICommandMenuOptions {
			if (!item.menuId) {
				item.menuId = MenuId.EditorContext;
			}
			if (!item.title) {
				item.title = opts.label;
			}
			item.when = ContextKeyExpr.and(opts.precondition, item.when);
			return <ICommandMenuOptions>item;
		}

		if (Array.isArray(opts.contextMenuOpts)) {
			menuOpts.push(...opts.contextMenuOpts.map(withDefaults));
		} else if (opts.contextMenuOpts) {
			menuOpts.push(withDefaults(opts.contextMenuOpts));
		}

		opts.menuOpts = menuOpts;
		return <ICommandOptions>opts;
	}

	public readonly label: string;
	public readonly alias: string;

	constructor(opts: IActionOptions) {
		super(EditorAction.convertOptions(opts));
		this.label = opts.label;
		this.alias = opts.alias;
	}

	public runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void | Promise<void> {
		this.reportTelemetry(accessor, editor);
		return this.run(accessor, editor, args || {});
	}

	protected reportTelemetry(accessor: ServicesAccessor, editor: ICodeEditor) {
		type EditorActionInvokedClassification = {
			name: { classification: 'SystemMetaData', purpose: 'FeatureInsight', };
			id: { classification: 'SystemMetaData', purpose: 'FeatureInsight', };
		};
		type EditorActionInvokedEvent = {
			name: string;
			id: string;
		};
		accessor.get(ITelemetryService).publicLog2<EditorActionInvokedEvent, EditorActionInvokedClassification>('editorActionInvoked', { name: this.label, id: this.id });
	}

	public abstract run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void | Promise<void>;
}

export abstract class MultiEditorAction extends EditorAction {
	private readonly _implementations: [number, CommandImplementation][] = [];

	constructor(opts: IActionOptions) {
		super(opts);
	}

	public addImplementation(priority: number, implementation: CommandImplementation): IDisposable {
		this._implementations.push([priority, implementation]);
		this._implementations.sort((a, b) => b[0] - a[0]);
		return {
			dispose: () => {
				for (let i = 0; i < this._implementations.length; i++) {
					if (this._implementations[i][1] === implementation) {
						this._implementations.splice(i, 1);
						return;
					}
				}
			}
		};
	}

	public runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void | Promise<void> {
		this.reportTelemetry(accessor, editor);

		for (const impl of this._implementations) {
			if (impl[1](accessor, args)) {
				return;
			}
		}

		return this.run(accessor, editor, args || {});
	}

	public abstract run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void | Promise<void>;

}

//#endregion EditorAction

//#region EditorAction2

export abstract class EditorAction2 extends Action2 {

	run(accessor: ServicesAccessor, ...args: any[]) {
		// Find the editor with text focus or active
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getFocusedCodeEditor() || codeEditorService.getActiveCodeEditor();
		if (!editor) {
			// well, at least we tried...
			return;
		}
		// precondition does hold
		return editor.invokeWithinContext((editorAccessor) => {
			const kbService = editorAccessor.get(IContextKeyService);
			if (kbService.contextMatchesRules(withNullAsUndefined(this.desc.precondition))) {
				return this.runEditorCommand(editorAccessor, editor!, args);
			}
		});
	}

	abstract runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor, ...args: any[]): any;
}

//#endregion

// --- Registration of commands and actions


export function registerModelAndPositionCommand(id: string, handler: (model: ITextModel, position: Position, ...args: any[]) => any) {
	CommandsRegistry.registerCommand(id, function (accessor, ...args) {

		const [resource, position] = args;
		assertType(URI.isUri(resource));
		assertType(Position.isIPosition(position));

		const model = accessor.get(IModelService).getModel(resource);
		if (model) {
			const editorPosition = Position.lift(position);
			return handler(model, editorPosition, ...args.slice(2));
		}

		return accessor.get(ITextModelService).createModelReference(resource).then(reference => {
			return new Promise((resolve, reject) => {
				try {
					const result = handler(reference.object.textEditorModel, Position.lift(position), args.slice(2));
					resolve(result);
				} catch (err) {
					reject(err);
				}
			}).finally(() => {
				reference.dispose();
			});
		});
	});
}

export function registerModelCommand(id: string, handler: (model: ITextModel, ...args: any[]) => any) {
	CommandsRegistry.registerCommand(id, function (accessor, ...args) {

		const [resource] = args;
		assertType(URI.isUri(resource));

		const model = accessor.get(IModelService).getModel(resource);
		if (model) {
			return handler(model, ...args.slice(1));
		}

		return accessor.get(ITextModelService).createModelReference(resource).then(reference => {
			return new Promise((resolve, reject) => {
				try {
					const result = handler(reference.object.textEditorModel, args.slice(1));
					resolve(result);
				} catch (err) {
					reject(err);
				}
			}).finally(() => {
				reference.dispose();
			});
		});
	});
}

export function registerEditorCommand<T extends EditorCommand>(editorCommand: T): T {
	EditorContributionRegistry.INSTANCE.registerEditorCommand(editorCommand);
	return editorCommand;
}

export function registerEditorAction<T extends EditorAction>(ctor: { new(): T; }): T {
	const action = new ctor();
	EditorContributionRegistry.INSTANCE.registerEditorAction(action);
	return action;
}

export function registerMultiEditorAction<T extends MultiEditorAction>(action: T): T {
	EditorContributionRegistry.INSTANCE.registerEditorAction(action);
	return action;
}

export function registerInstantiatedEditorAction(editorAction: EditorAction): void {
	EditorContributionRegistry.INSTANCE.registerEditorAction(editorAction);
}

export function registerEditorContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: ICodeEditor, ...services: Services): IEditorContribution }): void {
	EditorContributionRegistry.INSTANCE.registerEditorContribution(id, ctor);
}

export function registerDiffEditorContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: IDiffEditor, ...services: Services): IEditorContribution }): void {
	EditorContributionRegistry.INSTANCE.registerDiffEditorContribution(id, ctor);
}

export namespace EditorExtensionsRegistry {

	export function getEditorCommand(commandId: string): EditorCommand {
		return EditorContributionRegistry.INSTANCE.getEditorCommand(commandId);
	}

	export function getEditorActions(): EditorAction[] {
		return EditorContributionRegistry.INSTANCE.getEditorActions();
	}

	export function getEditorContributions(): IEditorContributionDescription[] {
		return EditorContributionRegistry.INSTANCE.getEditorContributions();
	}

	export function getSomeEditorContributions(ids: string[]): IEditorContributionDescription[] {
		return EditorContributionRegistry.INSTANCE.getEditorContributions().filter(c => ids.indexOf(c.id) >= 0);
	}

	export function getDiffEditorContributions(): IDiffEditorContributionDescription[] {
		return EditorContributionRegistry.INSTANCE.getDiffEditorContributions();
	}
}

// Editor extension points
const Extensions = {
	EditorCommonContributions: 'editor.contributions'
};

class EditorContributionRegistry {

	public static readonly INSTANCE = new EditorContributionRegistry();

	private readonly editorContributions: IEditorContributionDescription[];
	private readonly diffEditorContributions: IDiffEditorContributionDescription[];
	private readonly editorActions: EditorAction[];
	private readonly editorCommands: { [commandId: string]: EditorCommand; };

	constructor() {
		this.editorContributions = [];
		this.diffEditorContributions = [];
		this.editorActions = [];
		this.editorCommands = Object.create(null);
	}

	public registerEditorContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: ICodeEditor, ...services: Services): IEditorContribution }): void {
		this.editorContributions.push({ id, ctor: ctor as IEditorContributionCtor });
	}

	public getEditorContributions(): IEditorContributionDescription[] {
		return this.editorContributions.slice(0);
	}

	public registerDiffEditorContribution<Services extends BrandedService[]>(id: string, ctor: { new(editor: IDiffEditor, ...services: Services): IEditorContribution }): void {
		this.diffEditorContributions.push({ id, ctor: ctor as IDiffEditorContributionCtor });
	}

	public getDiffEditorContributions(): IDiffEditorContributionDescription[] {
		return this.diffEditorContributions.slice(0);
	}

	public registerEditorAction(action: EditorAction) {
		action.register();
		this.editorActions.push(action);
	}

	public getEditorActions(): EditorAction[] {
		return this.editorActions.slice(0);
	}

	public registerEditorCommand(editorCommand: EditorCommand) {
		editorCommand.register();
		this.editorCommands[editorCommand.id] = editorCommand;
	}

	public getEditorCommand(commandId: string): EditorCommand {
		return (this.editorCommands[commandId] || null);
	}

}
Registry.add(Extensions.EditorCommonContributions, EditorContributionRegistry.INSTANCE);

function registerCommand<T extends Command>(command: T): T {
	command.register();
	return command;
}

export const UndoCommand = registerCommand(new MultiCommand({
	id: 'undo',
	precondition: undefined,
	kbOpts: {
		weight: KeybindingWeight.EditorCore,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_Z
	},
	menuOpts: [{
		menuId: MenuId.MenubarEditMenu,
		group: '1_do',
		title: nls.localize({ key: 'miUndo', comment: ['&& denotes a mnemonic'] }, "&&Undo"),
		order: 1
	}, {
		menuId: MenuId.CommandPalette,
		group: '',
		title: nls.localize('undo', "Undo"),
		order: 1
	}]
}));

registerCommand(new ProxyCommand(UndoCommand, { id: 'default:undo', precondition: undefined }));

export const RedoCommand = registerCommand(new MultiCommand({
	id: 'redo',
	precondition: undefined,
	kbOpts: {
		weight: KeybindingWeight.EditorCore,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_Y,
		secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z],
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z }
	},
	menuOpts: [{
		menuId: MenuId.MenubarEditMenu,
		group: '1_do',
		title: nls.localize({ key: 'miRedo', comment: ['&& denotes a mnemonic'] }, "&&Redo"),
		order: 2
	}, {
		menuId: MenuId.CommandPalette,
		group: '',
		title: nls.localize('redo', "Redo"),
		order: 1
	}]
}));

registerCommand(new ProxyCommand(RedoCommand, { id: 'default:redo', precondition: undefined }));

export const SelectAllCommand = registerCommand(new MultiCommand({
	id: 'editor.action.selectAll',
	precondition: undefined,
	kbOpts: {
		weight: KeybindingWeight.EditorCore,
		kbExpr: null,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_A
	},
	menuOpts: [{
		menuId: MenuId.MenubarSelectionMenu,
		group: '1_basic',
		title: nls.localize({ key: 'miSelectAll', comment: ['&& denotes a mnemonic'] }, "&&Select All"),
		order: 1
	}, {
		menuId: MenuId.CommandPalette,
		group: '',
		title: nls.localize('selectAll', "Select All"),
		order: 1
	}]
}));
