/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { dispose, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as strings from 'vs/base/common/strings';
import * as objects from 'vs/base/common/objects';
import * as json from 'vs/base/common/json';
import { URI as uri } from 'vs/base/common/uri';
import * as resources from 'vs/base/common/resources';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorPane } from 'vs/workbench/common/editor';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, IWorkspaceFolder, WorkbenchState, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IDebugConfigurationProvider, ICompound, IDebugConfiguration, IConfig, IGlobalConfig, IConfigurationManager, ILaunch, IDebugAdapterDescriptorFactory, IDebugAdapter, IDebugSession, IAdapterDescriptor, CONTEXT_DEBUG_CONFIGURATION_TYPE, IDebugAdapterFactory, IConfigPresentation } from 'vs/workbench/contrib/debug/common/debug';
import { Debugger } from 'vs/workbench/contrib/debug/common/debugger';
import { IEditorService, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { launchSchemaId } from 'vs/workbench/services/configuration/common/configuration';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { Registry } from 'vs/platform/registry/common/platform';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { launchSchema, debuggersExtPoint, breakpointsExtPoint } from 'vs/workbench/contrib/debug/common/debugSchemas';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { sequence } from 'vs/base/common/async';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { first, flatten } from 'vs/base/common/arrays';
import { getVisibleAndSorted } from 'vs/workbench/contrib/debug/common/debugUtils';
import { DebugConfigurationProviderTriggerKind } from 'vs/workbench/api/common/extHostTypes';

const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
jsonRegistry.registerSchema(launchSchemaId, launchSchema);

const DEBUG_SELECTED_CONFIG_NAME_KEY = 'debug.selectedconfigname';
const DEBUG_SELECTED_ROOT = 'debug.selectedroot';

interface IDynamicPickItem { label: string, launch: ILaunch, config: IConfig }

export class ConfigurationManager implements IConfigurationManager {
	private debuggers: Debugger[];
	private breakpointModeIdsSet = new Set<string>();
	private launches!: ILaunch[];
	private selectedName: string | undefined;
	private selectedLaunch: ILaunch | undefined;
	private selectedConfig: IConfig | undefined;
	private toDispose: IDisposable[];
	private readonly _onDidSelectConfigurationName = new Emitter<void>();
	private configProviders: IDebugConfigurationProvider[];
	private adapterDescriptorFactories: IDebugAdapterDescriptorFactory[];
	private debugAdapterFactories = new Map<string, IDebugAdapterFactory>();
	private debugConfigurationTypeContext: IContextKey<string>;
	private readonly _onDidRegisterDebugger = new Emitter<void>();

	constructor(
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IHistoryService private readonly historyService: IHistoryService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		this.configProviders = [];
		this.adapterDescriptorFactories = [];
		this.debuggers = [];
		this.toDispose = [];
		this.initLaunches();
		this.registerListeners();
		const previousSelectedRoot = this.storageService.get(DEBUG_SELECTED_ROOT, StorageScope.WORKSPACE);
		const previousSelectedLaunch = this.launches.find(l => l.uri.toString() === previousSelectedRoot);
		this.debugConfigurationTypeContext = CONTEXT_DEBUG_CONFIGURATION_TYPE.bindTo(contextKeyService);
		if (previousSelectedLaunch && previousSelectedLaunch.getConfigurationNames().length) {
			this.selectConfiguration(previousSelectedLaunch, this.storageService.get(DEBUG_SELECTED_CONFIG_NAME_KEY, StorageScope.WORKSPACE));
		} else if (this.launches.length > 0) {
			this.selectConfiguration(undefined);
		}
	}

	// debuggers

	registerDebugAdapterFactory(debugTypes: string[], debugAdapterLauncher: IDebugAdapterFactory): IDisposable {
		debugTypes.forEach(debugType => this.debugAdapterFactories.set(debugType, debugAdapterLauncher));
		return {
			dispose: () => {
				debugTypes.forEach(debugType => this.debugAdapterFactories.delete(debugType));
			}
		};
	}

	createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined {
		let factory = this.debugAdapterFactories.get(session.configuration.type);
		if (factory) {
			return factory.createDebugAdapter(session);
		}
		return undefined;
	}

	substituteVariables(debugType: string, folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig> {
		let factory = this.debugAdapterFactories.get(debugType);
		if (factory) {
			return factory.substituteVariables(folder, config);
		}
		return Promise.resolve(config);
	}

	runInTerminal(debugType: string, args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined> {
		let factory = this.debugAdapterFactories.get(debugType);
		if (factory) {
			return factory.runInTerminal(args);
		}
		return Promise.resolve(void 0);
	}

	// debug adapter

	registerDebugAdapterDescriptorFactory(debugAdapterProvider: IDebugAdapterDescriptorFactory): IDisposable {
		this.adapterDescriptorFactories.push(debugAdapterProvider);
		return {
			dispose: () => {
				this.unregisterDebugAdapterDescriptorFactory(debugAdapterProvider);
			}
		};
	}

	unregisterDebugAdapterDescriptorFactory(debugAdapterProvider: IDebugAdapterDescriptorFactory): void {
		const ix = this.adapterDescriptorFactories.indexOf(debugAdapterProvider);
		if (ix >= 0) {
			this.adapterDescriptorFactories.splice(ix, 1);
		}
	}

	getDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor | undefined> {

		const config = session.configuration;

		// first try legacy proposed API: DebugConfigurationProvider.debugAdapterExecutable
		const providers0 = this.configProviders.filter(p => p.type === config.type && p.debugAdapterExecutable);
		if (providers0.length === 1 && providers0[0].debugAdapterExecutable) {
			return providers0[0].debugAdapterExecutable(session.root ? session.root.uri : undefined);
		} else {
			// TODO@AW handle n > 1 case
		}

		// new API
		const providers = this.adapterDescriptorFactories.filter(p => p.type === config.type && p.createDebugAdapterDescriptor);
		if (providers.length === 1) {
			return providers[0].createDebugAdapterDescriptor(session);
		} else {
			// TODO@AW handle n > 1 case
		}
		return Promise.resolve(undefined);
	}

	getDebuggerLabel(type: string): string | undefined {
		const dbgr = this.getDebugger(type);
		if (dbgr) {
			return dbgr.label;
		}

		return undefined;
	}

	get onDidRegisterDebugger(): Event<void> {
		return this._onDidRegisterDebugger.event;
	}

	// debug configurations

	registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable {
		this.configProviders.push(debugConfigurationProvider);
		return {
			dispose: () => {
				this.unregisterDebugConfigurationProvider(debugConfigurationProvider);
			}
		};
	}

	unregisterDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): void {
		const ix = this.configProviders.indexOf(debugConfigurationProvider);
		if (ix >= 0) {
			this.configProviders.splice(ix, 1);
		}
	}

	/**
	 * if scope is not specified,a value of DebugConfigurationProvideTrigger.Initial is assumed.
	 */
	hasDebugConfigurationProvider(debugType: string, triggerKind?: DebugConfigurationProviderTriggerKind): boolean {
		if (triggerKind === undefined) {
			triggerKind = DebugConfigurationProviderTriggerKind.Initial;
		}
		// check if there are providers for the given type that contribute a provideDebugConfigurations method
		const provider = this.configProviders.find(p => p.provideDebugConfigurations && (p.type === debugType) && (p.triggerKind === triggerKind));
		return !!provider;
	}

	async resolveConfigurationByProviders(folderUri: uri | undefined, type: string | undefined, config: IConfig, token: CancellationToken): Promise<IConfig | null | undefined> {
		await this.activateDebuggers('onDebugResolve', type);
		// pipe the config through the promises sequentially. Append at the end the '*' types
		const providers = this.configProviders.filter(p => p.type === type && p.resolveDebugConfiguration)
			.concat(this.configProviders.filter(p => p.type === '*' && p.resolveDebugConfiguration));

		let result: IConfig | null | undefined = config;
		await sequence(providers.map(provider => async () => {
			// If any provider returned undefined or null make sure to respect that and do not pass the result to more resolver
			if (result) {
				result = await provider.resolveDebugConfiguration!(folderUri, result, token);
			}
		}));

		return result;
	}

	async resolveDebugConfigurationWithSubstitutedVariables(folderUri: uri | undefined, type: string | undefined, config: IConfig, token: CancellationToken): Promise<IConfig | null | undefined> {
		// pipe the config through the promises sequentially. Append at the end the '*' types
		const providers = this.configProviders.filter(p => p.type === type && p.resolveDebugConfigurationWithSubstitutedVariables)
			.concat(this.configProviders.filter(p => p.type === '*' && p.resolveDebugConfigurationWithSubstitutedVariables));

		let result: IConfig | null | undefined = config;
		await sequence(providers.map(provider => async () => {
			// If any provider returned undefined or null make sure to respect that and do not pass the result to more resolver
			if (result) {
				result = await provider.resolveDebugConfigurationWithSubstitutedVariables!(folderUri, result, token);
			}
		}));

		return result;
	}

	async provideDebugConfigurations(folderUri: uri | undefined, type: string, token: CancellationToken): Promise<any[]> {
		await this.activateDebuggers('onDebugInitialConfigurations');
		const results = await Promise.all(this.configProviders.filter(p => p.type === type && p.triggerKind === DebugConfigurationProviderTriggerKind.Initial && p.provideDebugConfigurations).map(p => p.provideDebugConfigurations!(folderUri, token)));

		return results.reduce((first, second) => first.concat(second), []);
	}

	async getDynamicProviders(): Promise<{ label: string, pick: () => Promise<{ launch: ILaunch, config: IConfig } | undefined> }[]> {
		const extensions = await this.extensionService.getExtensions();
		const onDebugDynamicConfigurationsName = 'onDebugDynamicConfigurations';
		const debugDynamicExtensionsTypes = extensions.reduce((acc, e) => {
			if (!e.activationEvents) {
				return acc;
			}

			const explicitTypes: string[] = [];
			let hasGenericEvent = false;
			for (const event of e.activationEvents) {
				if (event === onDebugDynamicConfigurationsName) {
					hasGenericEvent = true;
				} else if (event.startsWith(`${onDebugDynamicConfigurationsName}:`)) {
					explicitTypes.push(event.slice(onDebugDynamicConfigurationsName.length + 1));
				}
			}

			if (explicitTypes.length) {
				return acc.concat(explicitTypes);
			}

			if (hasGenericEvent) {
				const debuggerType = e.contributes?.debuggers?.[0].type;
				return debuggerType ? acc.concat(debuggerType) : acc;
			}

			return acc;
		}, [] as string[]);

		return debugDynamicExtensionsTypes.map(type => {
			return {
				label: this.getDebuggerLabel(type)!,
				pick: async () => {
					const disposables = new DisposableStore();
					const input = disposables.add(this.quickInputService.createQuickPick<IDynamicPickItem>());
					input.busy = true;
					input.placeholder = nls.localize('selectConfiguration', "Select Launch Configuration");
					input.show();

					let chosenDidCancel = false;
					const chosenPromise = new Promise<IDynamicPickItem | undefined>(resolve => {
						disposables.add(input.onDidAccept(() => resolve(input.activeItems[0])));
						disposables.add(input.onDidTriggerItemButton(async (context) => {
							resolve(undefined);
							const { launch, config } = context.item;
							await launch.openConfigFile(false, config.type);
							// Only Launch have a pin trigger button
							await (launch as Launch).writeConfiguration(config);
							this.selectConfiguration(launch, config.name);
						}));
						disposables.add(input.onDidHide(() => { chosenDidCancel = true; resolve(); }));
					});

					await this.activateDebuggers(onDebugDynamicConfigurationsName, type);
					const token = new CancellationTokenSource();
					const picks: Promise<IDynamicPickItem[]>[] = [];
					const provider = this.configProviders.filter(p => p.type === type && p.triggerKind === DebugConfigurationProviderTriggerKind.Dynamic && p.provideDebugConfigurations)[0];
					this.getLaunches().forEach(launch => {
						if (launch.workspace && provider) {
							picks.push(provider.provideDebugConfigurations!(launch.workspace.uri, token.token).then(configurations => configurations.map(config => ({
								label: config.name,
								config,
								buttons: [{
									iconClass: 'codicon-gear',
									tooltip: nls.localize('editLaunchConfig', "Edit Debug Configuration in launch.json")
								}],
								launch
							}))));
						}
					});

					const nestedPicks = await Promise.all(picks);
					const items = flatten(nestedPicks);

					let chosen: IDynamicPickItem | undefined;

					// If there's exactly one item to choose from, pick it automatically
					if (items.length === 1 && !chosenDidCancel) {
						chosen = items[0];
					} else {
						input.items = items;
						input.busy = false;
						chosen = await chosenPromise;
					}

					disposables.dispose();

					if (!chosen) {
						// User canceled quick input we should notify the provider to cancel computing configurations
						token.cancel();
						return;
					}

					return chosen;
				}
			};
		});
	}

	getAllConfigurations(): { launch: ILaunch; name: string; presentation?: IConfigPresentation }[] {
		const all: { launch: ILaunch, name: string, presentation?: IConfigPresentation }[] = [];
		for (let l of this.launches) {
			for (let name of l.getConfigurationNames()) {
				const config = l.getConfiguration(name) || l.getCompound(name);
				if (config) {
					all.push({ launch: l, name, presentation: config.presentation });
				}
			}
		}

		return getVisibleAndSorted(all);
	}

	private registerListeners(): void {
		debuggersExtPoint.setHandler((extensions, delta) => {
			delta.added.forEach(added => {
				added.value.forEach(rawAdapter => {
					if (!rawAdapter.type || (typeof rawAdapter.type !== 'string')) {
						added.collector.error(nls.localize('debugNoType', "Debugger 'type' can not be omitted and must be of type 'string'."));
					}
					if (rawAdapter.enableBreakpointsFor) {
						rawAdapter.enableBreakpointsFor.languageIds.forEach(modeId => {
							this.breakpointModeIdsSet.add(modeId);
						});
					}

					if (rawAdapter.type !== '*') {
						const existing = this.getDebugger(rawAdapter.type);
						if (existing) {
							existing.merge(rawAdapter, added.description);
						} else {
							this.debuggers.push(this.instantiationService.createInstance(Debugger, this, rawAdapter, added.description));
						}
					}
				});
			});

			// take care of all wildcard contributions
			extensions.forEach(extension => {
				extension.value.forEach(rawAdapter => {
					if (rawAdapter.type === '*') {
						this.debuggers.forEach(dbg => dbg.merge(rawAdapter, extension.description));
					}
				});
			});

			delta.removed.forEach(removed => {
				const removedTypes = removed.value.map(rawAdapter => rawAdapter.type);
				this.debuggers = this.debuggers.filter(d => removedTypes.indexOf(d.type) === -1);
			});

			// update the schema to include all attributes, snippets and types from extensions.
			this.debuggers.forEach(adapter => {
				const items = (<IJSONSchema>launchSchema.properties!['configurations'].items);
				const schemaAttributes = adapter.getSchemaAttributes();
				if (schemaAttributes && items.oneOf) {
					items.oneOf.push(...schemaAttributes);
				}
				const configurationSnippets = adapter.configurationSnippets;
				if (configurationSnippets && items.defaultSnippets) {
					items.defaultSnippets.push(...configurationSnippets);
				}
			});

			this.setCompoundSchemaValues();
			this._onDidRegisterDebugger.fire();
		});

		breakpointsExtPoint.setHandler((extensions, delta) => {
			delta.removed.forEach(removed => {
				removed.value.forEach(breakpoints => this.breakpointModeIdsSet.delete(breakpoints.language));
			});
			delta.added.forEach(added => {
				added.value.forEach(breakpoints => this.breakpointModeIdsSet.add(breakpoints.language));
			});
		});

		this.toDispose.push(Event.any<IWorkspaceFoldersChangeEvent | WorkbenchState>(this.contextService.onDidChangeWorkspaceFolders, this.contextService.onDidChangeWorkbenchState)(() => {
			this.initLaunches();
			this.selectConfiguration(undefined);
			this.setCompoundSchemaValues();
		}));
		this.toDispose.push(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('launch')) {
				// A change happen in the launch.json. If there is already a launch configuration selected, do not change the selection.
				this.selectConfiguration(undefined);
				this.setCompoundSchemaValues();
			}
		}));
	}

	private initLaunches(): void {
		this.launches = this.contextService.getWorkspace().folders.map(folder => this.instantiationService.createInstance(Launch, this, folder));
		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			this.launches.push(this.instantiationService.createInstance(WorkspaceLaunch, this));
		}
		this.launches.push(this.instantiationService.createInstance(UserLaunch, this));

		if (this.selectedLaunch && this.launches.indexOf(this.selectedLaunch) === -1) {
			this.selectConfiguration(undefined);
		}
	}

	private setCompoundSchemaValues(): void {
		const compoundConfigurationsSchema = (<IJSONSchema>launchSchema.properties!['compounds'].items).properties!['configurations'];
		const launchNames = this.launches.map(l =>
			l.getConfigurationNames(true)).reduce((first, second) => first.concat(second), []);
		(<IJSONSchema>compoundConfigurationsSchema.items).oneOf![0].enum = launchNames;
		(<IJSONSchema>compoundConfigurationsSchema.items).oneOf![1].properties!.name.enum = launchNames;

		const folderNames = this.contextService.getWorkspace().folders.map(f => f.name);
		(<IJSONSchema>compoundConfigurationsSchema.items).oneOf![1].properties!.folder.enum = folderNames;

		jsonRegistry.registerSchema(launchSchemaId, launchSchema);
	}

	getLaunches(): ILaunch[] {
		return this.launches;
	}

	getLaunch(workspaceUri: uri | undefined): ILaunch | undefined {
		if (!uri.isUri(workspaceUri)) {
			return undefined;
		}

		return this.launches.find(l => l.workspace && l.workspace.uri.toString() === workspaceUri.toString());
	}

	get selectedConfiguration(): { launch: ILaunch | undefined, name: string | undefined, config: IConfig | undefined } {
		return {
			launch: this.selectedLaunch,
			name: this.selectedName,
			config: this.selectedConfig
		};
	}

	get onDidSelectConfiguration(): Event<void> {
		return this._onDidSelectConfigurationName.event;
	}

	getWorkspaceLaunch(): ILaunch | undefined {
		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			return this.launches[this.launches.length - 1];
		}

		return undefined;
	}

	selectConfiguration(launch: ILaunch | undefined, name?: string, config?: IConfig): void {
		if (typeof launch === 'undefined') {
			const rootUri = this.historyService.getLastActiveWorkspaceRoot();
			launch = this.getLaunch(rootUri);
			if (!launch || launch.getConfigurationNames().length === 0) {
				launch = first(this.launches, l => !!(l && l.getConfigurationNames().length), launch) || this.launches[0];
			}
		}

		const previousLaunch = this.selectedLaunch;
		const previousName = this.selectedName;
		this.selectedLaunch = launch;

		if (this.selectedLaunch) {
			this.storageService.store(DEBUG_SELECTED_ROOT, this.selectedLaunch.uri.toString(), StorageScope.WORKSPACE);
		} else {
			this.storageService.remove(DEBUG_SELECTED_ROOT, StorageScope.WORKSPACE);
		}
		const names = launch ? launch.getConfigurationNames() : [];
		if ((name && names.indexOf(name) >= 0) || config) {
			this.setSelectedLaunchName(name);
		} else if (!this.selectedName || names.indexOf(this.selectedName) === -1) {
			this.setSelectedLaunchName(names.length ? names[0] : undefined);
		}

		this.selectedConfig = config;
		const configForType = this.selectedConfig || (this.selectedLaunch && this.selectedName ? this.selectedLaunch.getConfiguration(this.selectedName) : undefined);
		if (configForType) {
			this.debugConfigurationTypeContext.set(configForType.type);
		} else {
			this.debugConfigurationTypeContext.reset();
		}

		if (this.selectedLaunch !== previousLaunch || this.selectedName !== previousName) {
			this._onDidSelectConfigurationName.fire();
		}
	}

	canSetBreakpointsIn(model: ITextModel): boolean {
		const modeId = model.getLanguageIdentifier().language;
		if (!modeId || modeId === 'jsonc' || modeId === 'log') {
			// do not allow breakpoints in our settings files and output
			return false;
		}
		if (this.configurationService.getValue<IDebugConfiguration>('debug').allowBreakpointsEverywhere) {
			return true;
		}

		return this.breakpointModeIdsSet.has(modeId);
	}

	getDebugger(type: string): Debugger | undefined {
		return this.debuggers.find(dbg => strings.equalsIgnoreCase(dbg.type, type));
	}

	isDebuggerInterestedInLanguage(language: string): boolean {
		return !!this.debuggers.find(a => language && a.languages && a.languages.indexOf(language) >= 0);
	}

	async guessDebugger(type?: string): Promise<Debugger | undefined> {
		if (type) {
			const adapter = this.getDebugger(type);
			return Promise.resolve(adapter);
		}

		const activeTextEditorControl = this.editorService.activeTextEditorControl;
		let candidates: Debugger[] | undefined;
		if (isCodeEditor(activeTextEditorControl)) {
			const model = activeTextEditorControl.getModel();
			const language = model ? model.getLanguageIdentifier().language : undefined;
			const adapters = this.debuggers.filter(a => language && a.languages && a.languages.indexOf(language) >= 0);
			if (adapters.length === 1) {
				return adapters[0];
			}
			if (adapters.length > 1) {
				candidates = adapters;
			}
		}

		if (!candidates) {
			await this.activateDebuggers('onDebugInitialConfigurations');
			candidates = this.debuggers.filter(dbg => dbg.hasInitialConfiguration() || dbg.hasConfigurationProvider());
		}

		candidates.sort((first, second) => first.label.localeCompare(second.label));
		const picks = candidates.map(c => ({ label: c.label, debugger: c }));
		return this.quickInputService.pick<{ label: string, debugger: Debugger | undefined }>([...picks, { type: 'separator' }, { label: nls.localize('more', "More..."), debugger: undefined }], { placeHolder: nls.localize('selectDebug', "Select Environment") })
			.then(picked => {
				if (picked && picked.debugger) {
					return picked.debugger;
				}
				if (picked) {
					this.commandService.executeCommand('debug.installAdditionalDebuggers');
				}
				return undefined;
			});
	}

	async activateDebuggers(activationEvent: string, debugType?: string): Promise<void> {
		const promises: Promise<any>[] = [
			this.extensionService.activateByEvent(activationEvent),
			this.extensionService.activateByEvent('onDebug')
		];
		if (debugType) {
			promises.push(this.extensionService.activateByEvent(`${activationEvent}:${debugType}`));
		}
		await Promise.all(promises);
	}

	private setSelectedLaunchName(selectedName: string | undefined): void {
		this.selectedName = selectedName;

		if (this.selectedName) {
			this.storageService.store(DEBUG_SELECTED_CONFIG_NAME_KEY, this.selectedName, StorageScope.WORKSPACE);
		} else {
			this.storageService.remove(DEBUG_SELECTED_CONFIG_NAME_KEY, StorageScope.WORKSPACE);
		}
	}

	dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}
}

abstract class AbstractLaunch {
	protected abstract getConfig(): IGlobalConfig | undefined;

	constructor(protected configurationManager: ConfigurationManager) {
	}

	getCompound(name: string): ICompound | undefined {
		const config = this.getConfig();
		if (!config || !config.compounds) {
			return undefined;
		}

		return config.compounds.find(compound => compound.name === name);
	}

	getConfigurationNames(ignoreCompoundsAndPresentation = false): string[] {
		const config = this.getConfig();
		if (!config || (!Array.isArray(config.configurations) && !Array.isArray(config.compounds))) {
			return [];
		} else {
			const configurations: (IConfig | ICompound)[] = [];
			if (config.configurations) {
				configurations.push(...config.configurations.filter(cfg => cfg && typeof cfg.name === 'string'));
			}

			if (ignoreCompoundsAndPresentation) {
				return configurations.map(c => c.name);
			}

			if (config.compounds) {
				configurations.push(...config.compounds.filter(compound => typeof compound.name === 'string' && compound.configurations && compound.configurations.length));
			}
			return getVisibleAndSorted(configurations).map(c => c.name);
		}
	}

	getConfiguration(name: string): IConfig | undefined {
		// We need to clone the configuration in order to be able to make changes to it #42198
		const config = objects.deepClone(this.getConfig());
		if (!config || !config.configurations) {
			return undefined;
		}

		return config.configurations.find(config => config && config.name === name);
	}

	async getInitialConfigurationContent(folderUri?: uri, type?: string, token?: CancellationToken): Promise<string> {
		let content = '';
		const adapter = await this.configurationManager.guessDebugger(type);
		if (adapter) {
			const initialConfigs = await this.configurationManager.provideDebugConfigurations(folderUri, adapter.type, token || CancellationToken.None);
			content = await adapter.getInitialConfigurationContent(initialConfigs);
		}
		return content;
	}

	get hidden(): boolean {
		return false;
	}
}

class Launch extends AbstractLaunch implements ILaunch {

	constructor(
		configurationManager: ConfigurationManager,
		public workspace: IWorkspaceFolder,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(configurationManager);
	}

	get uri(): uri {
		return resources.joinPath(this.workspace.uri, '/.vscode/launch.json');
	}

	get name(): string {
		return this.workspace.name;
	}

	protected getConfig(): IGlobalConfig | undefined {
		return this.configurationService.inspect<IGlobalConfig>('launch', { resource: this.workspace.uri }).workspaceFolderValue;
	}

	async openConfigFile(preserveFocus: boolean, type?: string, token?: CancellationToken): Promise<{ editor: IEditorPane | null, created: boolean }> {
		const resource = this.uri;
		let created = false;
		let content = '';
		try {
			const fileContent = await this.fileService.readFile(resource);
			content = fileContent.value.toString();
		} catch {
			// launch.json not found: create one by collecting launch configs from debugConfigProviders
			content = await this.getInitialConfigurationContent(this.workspace.uri, type, token);
			if (content) {
				created = true; // pin only if config file is created #8727
				try {
					await this.textFileService.write(resource, content);
				} catch (error) {
					throw new Error(nls.localize('DebugConfig.failed', "Unable to create 'launch.json' file inside the '.vscode' folder ({0}).", error.message));
				}
			}
		}

		if (content === '') {
			return { editor: null, created: false };
		}

		const index = content.indexOf(`"${this.configurationManager.selectedConfiguration.name}"`);
		let startLineNumber = 1;
		for (let i = 0; i < index; i++) {
			if (content.charAt(i) === '\n') {
				startLineNumber++;
			}
		}
		const selection = startLineNumber > 1 ? { startLineNumber, startColumn: 4 } : undefined;

		const editor = await this.editorService.openEditor({
			resource,
			options: {
				selection,
				preserveFocus,
				pinned: created,
				revealIfVisible: true
			},
		}, ACTIVE_GROUP);

		return ({
			editor: withUndefinedAsNull(editor),
			created
		});
	}

	async writeConfiguration(configuration: IConfig): Promise<void> {
		const fullConfig = objects.deepClone(this.getConfig()!);
		if (!fullConfig.configurations) {
			fullConfig.configurations = [];
		}
		fullConfig.configurations.push(configuration);
		await this.configurationService.updateValue('launch', fullConfig, { resource: this.workspace.uri }, ConfigurationTarget.WORKSPACE_FOLDER);
	}
}

class WorkspaceLaunch extends AbstractLaunch implements ILaunch {
	constructor(
		configurationManager: ConfigurationManager,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) {
		super(configurationManager);
	}

	get workspace(): undefined {
		return undefined;
	}

	get uri(): uri {
		return this.contextService.getWorkspace().configuration!;
	}

	get name(): string {
		return nls.localize('workspace', "workspace");
	}

	protected getConfig(): IGlobalConfig | undefined {
		return this.configurationService.inspect<IGlobalConfig>('launch').workspaceValue;
	}

	async openConfigFile(preserveFocus: boolean, type?: string, token?: CancellationToken): Promise<{ editor: IEditorPane | null, created: boolean }> {
		let launchExistInFile = !!this.getConfig();
		if (!launchExistInFile) {
			// Launch property in workspace config not found: create one by collecting launch configs from debugConfigProviders
			let content = await this.getInitialConfigurationContent(undefined, type, token);
			if (content) {
				await this.configurationService.updateValue('launch', json.parse(content), ConfigurationTarget.WORKSPACE);
			} else {
				return { editor: null, created: false };
			}
		}

		const editor = await this.editorService.openEditor({
			resource: this.contextService.getWorkspace().configuration!,
			options: { preserveFocus }
		}, ACTIVE_GROUP);

		return ({
			editor: withUndefinedAsNull(editor),
			created: false
		});
	}
}

class UserLaunch extends AbstractLaunch implements ILaunch {

	constructor(
		configurationManager: ConfigurationManager,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IPreferencesService private readonly preferencesService: IPreferencesService
	) {
		super(configurationManager);
	}

	get workspace(): undefined {
		return undefined;
	}

	get uri(): uri {
		return this.preferencesService.userSettingsResource;
	}

	get name(): string {
		return nls.localize('user settings', "user settings");
	}

	get hidden(): boolean {
		return true;
	}

	protected getConfig(): IGlobalConfig | undefined {
		return this.configurationService.inspect<IGlobalConfig>('launch').userValue;
	}

	async openConfigFile(preserveFocus: boolean): Promise<{ editor: IEditorPane | null, created: boolean }> {
		const editor = await this.preferencesService.openGlobalSettings(true, { preserveFocus });
		return ({
			editor: withUndefinedAsNull(editor),
			created: false
		});
	}
}
