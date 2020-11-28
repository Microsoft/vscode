/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as aria from 'vs/base/browser/ui/aria/aria';
import { Disposable, IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor, IDiffEditor, IEditorConstructionOptions } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { IDiffEditorOptions, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { InternalEditorAction } from 'vs/editor/common/editorAction';
import { IModelChangedEvent } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { StandaloneKeybindingService, applyConfigurationValues } from 'vs/editor/standalone/browser/simpleServices';
import { IStandaloneThemeService } from 'vs/editor/standalone/common/standaloneThemeService';
import { IMenuItem, MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandHandler, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ContextViewService } from 'vs/platform/contextview/browser/contextViewService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { StandaloneCodeEditorNLS } from 'vs/editor/common/standaloneStrings';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IEditorProgressService } from 'vs/platform/progress/common/progress';
import { StandaloneThemeServiceImpl } from 'vs/editor/standalone/browser/standaloneThemeServiceImpl';

/**
 * Description of an action contribution
 */
export interface IActionDescriptor {
	/**
	 * An unique identifier of the contributed action.
	 */
	id: string;
	/**
	 * A label of the action that will be presented to the user.
	 */
	label: string;
	/**
	 * Precondition rule.
	 */
	precondition?: string;
	/**
	 * An array of keybindings for the action.
	 */
	keybindings?: number[];
	/**
	 * The keybinding rule (condition on top of precondition).
	 */
	keybindingContext?: string;
	/**
	 * Control if the action should show up in the context menu and where.
	 * The context menu of the editor has these default:
	 *   navigation - The navigation group comes first in all cases.
	 *   1_modification - This group comes next and contains commands that modify your code.
	 *   9_cutcopypaste - The last default group with the basic editing commands.
	 * You can also create your own group.
	 * Defaults to null (don't show in context menu).
	 */
	contextMenuGroupId?: string;
	/**
	 * Control the order in the context menu group.
	 */
	contextMenuOrder?: number;
	/**
	 * Method that will be executed when the action is triggered.
	 * @param editor The editor instance is passed in as a convenience
	 */
	run(editor: ICodeEditor, ...args: any[]): void | Promise<void>;
}

/**
 * Options which apply for all editors.
 */
export interface IGlobalEditorOptions {
	/**
	 * The number of spaces a tab is equal to.
	 * This setting is overridden based on the file contents when `detectIndentation` is on.
	 * Defaults to 4.
	 */
	tabSize?: number;
	/**
	 * Insert spaces when pressing `Tab`.
	 * This setting is overridden based on the file contents when `detectIndentation` is on.
	 * Defaults to true.
	 */
	insertSpaces?: boolean;
	/**
	 * Controls whether `tabSize` and `insertSpaces` will be automatically detected when a file is opened based on the file contents.
	 * Defaults to true.
	 */
	detectIndentation?: boolean;
	/**
	 * Remove trailing auto inserted whitespace.
	 * Defaults to true.
	 */
	trimAutoWhitespace?: boolean;
	/**
	 * Special handling for large files to disable certain memory intensive features.
	 * Defaults to true.
	 */
	largeFileOptimizations?: boolean;
	/**
	 * Controls whether completions should be computed based on words in the document.
	 * Defaults to true.
	 */
	wordBasedSuggestions?: boolean;
	/**
	 * Controls whether word based completions should be included from opened documents of the same language or any language.
	 */
	wordBasedSuggestionsOnlySameLanguage?: boolean;
	/**
	 * Controls whether the semanticHighlighting is shown for the languages that support it.
	 * true: semanticHighlighting is enabled for all themes
	 * false: semanticHighlighting is disabled for all themes
	 * 'configuredByTheme': semanticHighlighting is controlled by the current color theme's semanticHighlighting setting.
	 * Defaults to 'byTheme'.
	 */
	'semanticHighlighting.enabled'?: true | false | 'configuredByTheme';
	/**
	 * Keep peek editors open even when double clicking their content or when hitting `Escape`.
	 * Defaults to false.
	 */
	stablePeek?: boolean;
	/**
	 * Lines above this length will not be tokenized for performance reasons.
	 * Defaults to 20000.
	 */
	maxTokenizationLineLength?: number;
	/**
	 * Theme to be used for rendering.
	 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
	 * You can create custom themes via `monaco.editor.defineTheme`.
	 * To switch a theme, use `monaco.editor.setTheme`
	 */
	theme?: string;
}

/**
 * The options to create an editor.
 */
export interface IStandaloneEditorConstructionOptions extends IEditorConstructionOptions, IGlobalEditorOptions {
	/**
	 * The initial model associated with this code editor.
	 */
	model?: ITextModel | null;
	/**
	 * The initial value of the auto created model in the editor.
	 * To not create automatically a model, use `model: null`.
	 */
	value?: string;
	/**
	 * The initial language of the auto created model in the editor.
	 * To not create automatically a model, use `model: null`.
	 */
	language?: string;
	/**
	 * Initial theme to be used for rendering.
	 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
	 * You can create custom themes via `monaco.editor.defineTheme`.
	 * To switch a theme, use `monaco.editor.setTheme`
	 */
	theme?: string;
	/**
	 * An URL to open when Ctrl+H (Windows and Linux) or Cmd+H (OSX) is pressed in
	 * the accessibility help dialog in the editor.
	 *
	 * Defaults to "https://go.microsoft.com/fwlink/?linkid=852450"
	 */
	accessibilityHelpUrl?: string;
}

/**
 * The options to create a diff editor.
 */
export interface IDiffEditorConstructionOptions extends IDiffEditorOptions {
	/**
	 * Initial theme to be used for rendering.
	 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
	 * You can create custom themes via `monaco.editor.defineTheme`.
	 * To switch a theme, use `monaco.editor.setTheme`
	 */
	theme?: string;
}

export interface IStandaloneCodeEditor extends ICodeEditor {
	updateOptions(newOptions: IEditorOptions & IGlobalEditorOptions): void;
	addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
	createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;
}

export interface IStandaloneDiffEditor extends IDiffEditor {
	addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
	createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
	addAction(descriptor: IActionDescriptor): IDisposable;

	getOriginalEditor(): IStandaloneCodeEditor;
	getModifiedEditor(): IStandaloneCodeEditor;
}

let LAST_GENERATED_COMMAND_ID = 0;

let ariaDomNodeCreated = false;
function createAriaDomNode() {
	if (ariaDomNodeCreated) {
		return;
	}
	ariaDomNodeCreated = true;
	aria.setARIAContainer(document.body);
}

/**
 * A code editor to be used both by the standalone editor and the standalone diff editor.
 */
export class StandaloneCodeEditor extends CodeEditorWidget implements IStandaloneCodeEditor {

	private readonly _standaloneKeybindingService: StandaloneKeybindingService | null;

	constructor(
		domElement: HTMLElement,
		options: IStandaloneEditorConstructionOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService themeService: IThemeService,
		@INotificationService notificationService: INotificationService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		options = options || {};
		options.ariaLabel = options.ariaLabel || StandaloneCodeEditorNLS.editorViewAccessibleLabel;
		options.ariaLabel = options.ariaLabel + ';' + (StandaloneCodeEditorNLS.accessibilityHelpMessage);
		super(domElement, options, {}, instantiationService, codeEditorService, commandService, contextKeyService, themeService, notificationService, accessibilityService);

		if (keybindingService instanceof StandaloneKeybindingService) {
			this._standaloneKeybindingService = keybindingService;
		} else {
			this._standaloneKeybindingService = null;
		}

		// Create the ARIA dom node as soon as the first editor is instantiated
		createAriaDomNode();
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null {
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add command because the editor is configured with an unrecognized KeybindingService');
			return null;
		}
		let commandId = 'DYNAMIC_' + (++LAST_GENERATED_COMMAND_ID);
		let whenExpression = ContextKeyExpr.deserialize(context);
		this._standaloneKeybindingService.addDynamicKeybinding(commandId, keybinding, handler, whenExpression);
		return commandId;
	}

	public createContextKey<T>(key: string, defaultValue: T): IContextKey<T> {
		return this._contextKeyService.createKey(key, defaultValue);
	}

	public addAction(_descriptor: IActionDescriptor): IDisposable {
		if ((typeof _descriptor.id !== 'string') || (typeof _descriptor.label !== 'string') || (typeof _descriptor.run !== 'function')) {
			throw new Error('Invalid action descriptor, `id`, `label` and `run` are required properties!');
		}
		if (!this._standaloneKeybindingService) {
			console.warn('Cannot add keybinding because the editor is configured with an unrecognized KeybindingService');
			return Disposable.None;
		}

		// Read descriptor options
		const id = _descriptor.id;
		const label = _descriptor.label;
		const precondition = ContextKeyExpr.and(
			ContextKeyExpr.equals('editorId', this.getId()),
			ContextKeyExpr.deserialize(_descriptor.precondition)
		);
		const keybindings = _descriptor.keybindings;
		const keybindingsWhen = ContextKeyExpr.and(
			precondition,
			ContextKeyExpr.deserialize(_descriptor.keybindingContext)
		);
		const contextMenuGroupId = _descriptor.contextMenuGroupId || null;
		const contextMenuOrder = _descriptor.contextMenuOrder || 0;
		const run = (accessor?: ServicesAccessor, ...args: any[]): Promise<void> => {
			return Promise.resolve(_descriptor.run(this, ...args));
		};


		const toDispose = new DisposableStore();

		// Generate a unique id to allow the same descriptor.id across multiple editor instances
		const uniqueId = this.getId() + ':' + id;

		// Register the command
		toDispose.add(CommandsRegistry.registerCommand(uniqueId, run));

		// Register the context menu item
		if (contextMenuGroupId) {
			let menuItem: IMenuItem = {
				command: {
					id: uniqueId,
					title: label
				},
				when: precondition,
				group: contextMenuGroupId,
				order: contextMenuOrder
			};
			toDispose.add(MenuRegistry.appendMenuItem(MenuId.EditorContext, menuItem));
		}

		// Register the keybindings
		if (Array.isArray(keybindings)) {
			for (const kb of keybindings) {
				toDispose.add(this._standaloneKeybindingService.addDynamicKeybinding(uniqueId, kb, run, keybindingsWhen));
			}
		}

		// Finally, register an internal editor action
		let internalAction = new InternalEditorAction(
			uniqueId,
			label,
			label,
			precondition,
			run,
			this._contextKeyService
		);

		// Store it under the original id, such that trigger with the original id will work
		this._actions[id] = internalAction;
		toDispose.add(toDisposable(() => {
			delete this._actions[id];
		}));

		return toDispose;
	}
}

export class StandaloneEditor extends StandaloneCodeEditor implements IStandaloneCodeEditor {

	private readonly _contextViewService: ContextViewService;
	private readonly _configurationService: IConfigurationService;
	private readonly _standaloneThemeService: IStandaloneThemeService;
	private _ownsModel: boolean;

	constructor(
		domElement: HTMLElement,
		options: IStandaloneEditorConstructionOptions | undefined,
		toDispose: IDisposable,
		@IInstantiationService instantiationService: IInstantiationService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextViewService contextViewService: IContextViewService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		applyConfigurationValues(configurationService, options, false);
		const themeDomRegistration = (<StandaloneThemeServiceImpl>themeService).registerEditorContainer(domElement);
		options = options || {};
		if (typeof options.theme === 'string') {
			themeService.setTheme(options.theme);
		}
		let _model: ITextModel | null | undefined = options.model;
		delete options.model;
		super(domElement, options, instantiationService, codeEditorService, commandService, contextKeyService, keybindingService, themeService, notificationService, accessibilityService);

		this._contextViewService = <ContextViewService>contextViewService;
		this._configurationService = configurationService;
		this._standaloneThemeService = themeService;
		this._register(toDispose);
		this._register(themeDomRegistration);

		let model: ITextModel | null;
		if (typeof _model === 'undefined') {
			model = (<any>self).monaco.editor.createModel(options.value || '', options.language || 'text/plain');
			this._ownsModel = true;
		} else {
			model = _model;
			this._ownsModel = false;
		}

		this._attachModel(model);
		if (model) {
			let e: IModelChangedEvent = {
				oldModelUrl: null,
				newModelUrl: model.uri
			};
			this._onDidChangeModel.fire(e);
		}
	}

	public dispose(): void {
		super.dispose();
	}

	public updateOptions(newOptions: IEditorOptions & IGlobalEditorOptions): void {
		applyConfigurationValues(this._configurationService, newOptions, false);
		if (typeof newOptions.theme === 'string') {
			this._standaloneThemeService.setTheme(newOptions.theme);
		}
		super.updateOptions(newOptions);
	}

	_attachModel(model: ITextModel | null): void {
		super._attachModel(model);
		if (this._modelData) {
			this._contextViewService.setContainer(this._modelData.view.domNode.domNode);
		}
	}

	_postDetachModelCleanup(detachedModel: ITextModel): void {
		super._postDetachModelCleanup(detachedModel);
		if (detachedModel && this._ownsModel) {
			detachedModel.dispose();
			this._ownsModel = false;
		}
	}
}

export class StandaloneDiffEditor extends DiffEditorWidget implements IStandaloneDiffEditor {

	private readonly _contextViewService: ContextViewService;
	private readonly _configurationService: IConfigurationService;
	private readonly _standaloneThemeService: IStandaloneThemeService;

	constructor(
		domElement: HTMLElement,
		options: IDiffEditorConstructionOptions | undefined,
		toDispose: IDisposable,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextViewService contextViewService: IContextViewService,
		@IEditorWorkerService editorWorkerService: IEditorWorkerService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IStandaloneThemeService themeService: IStandaloneThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IEditorProgressService editorProgressService: IEditorProgressService,
		@IClipboardService clipboardService: IClipboardService,
	) {
		applyConfigurationValues(configurationService, options, true);
		const themeDomRegistration = (<StandaloneThemeServiceImpl>themeService).registerEditorContainer(domElement);
		options = options || {};
		if (typeof options.theme === 'string') {
			options.theme = themeService.setTheme(options.theme);
		}

		super(domElement, options, clipboardService, editorWorkerService, contextKeyService, instantiationService, codeEditorService, themeService, notificationService, contextMenuService, editorProgressService);

		this._contextViewService = <ContextViewService>contextViewService;
		this._configurationService = configurationService;
		this._standaloneThemeService = themeService;

		this._register(toDispose);
		this._register(themeDomRegistration);

		this._contextViewService.setContainer(this._containerDomElement);
	}

	public dispose(): void {
		super.dispose();
	}

	public updateOptions(newOptions: IDiffEditorOptions & IGlobalEditorOptions): void {
		applyConfigurationValues(this._configurationService, newOptions, true);
		if (typeof newOptions.theme === 'string') {
			this._standaloneThemeService.setTheme(newOptions.theme);
		}
		super.updateOptions(newOptions);
	}

	protected _createInnerEditor(instantiationService: IInstantiationService, container: HTMLElement, options: IEditorOptions): CodeEditorWidget {
		return instantiationService.createInstance(StandaloneCodeEditor, container, options);
	}

	public getOriginalEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getOriginalEditor();
	}

	public getModifiedEditor(): IStandaloneCodeEditor {
		return <StandaloneCodeEditor>super.getModifiedEditor();
	}

	public addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null {
		return this.getModifiedEditor().addCommand(keybinding, handler, context);
	}

	public createContextKey<T>(key: string, defaultValue: T): IContextKey<T> {
		return this.getModifiedEditor().createContextKey(key, defaultValue);
	}

	public addAction(descriptor: IActionDescriptor): IDisposable {
		return this.getModifiedEditor().addAction(descriptor);
	}
}
