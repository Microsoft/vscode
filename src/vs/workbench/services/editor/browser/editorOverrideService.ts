/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { distinct, firstOrDefault, flatten, insert } from 'vs/base/common/arrays';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { basename, extname, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EditorActivation, EditorOverride, IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { EditorResourceAccessor, IEditorInput, IEditorInputWithOptions, IEditorInputWithOptionsAndGroup } from 'vs/workbench/common/editor';
import { IEditorGroup, IEditorGroupsService, preferredSideBySideGroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { Schemas } from 'vs/base/common/network';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { ContributedEditorInfo, ContributedEditorPriority, ContributionPointOptions, DEFAULT_EDITOR_ASSOCIATION, DiffEditorInputFactoryFunction, EditorAssociation, EditorAssociations, EditorInputFactoryFunction, editorsAssociationsSettingId, globMatchesResource, IEditorOverrideService, priorityToRank } from 'vs/workbench/services/editor/common/editorOverrideService';
import { IKeyMods, IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { localize } from 'vs/nls';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

interface IContributedEditorInput extends IEditorInput {
	viewType?: string;
}

interface ContributionPoint {
	globPattern: string | glob.IRelativePattern,
	editorInfo: ContributedEditorInfo,
	options?: ContributionPointOptions,
	createEditorInput: EditorInputFactoryFunction
	createDiffEditorInput?: DiffEditorInputFactoryFunction
}

type ContributionPoints = Array<ContributionPoint>;

export class EditorOverrideService extends Disposable implements IEditorOverrideService {
	readonly _serviceBrand: undefined;

	private static readonly configureDefaultID = 'promptOpenWith.configureDefault';
	private _contributionPoints: Map<string | glob.IRelativePattern, ContributionPoints> = new Map<string | glob.IRelativePattern, ContributionPoints>();
	private static readonly overrideCacheStorageID = 'editorOverrideService.cache';
	private cache: Set<string> | undefined;

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super();
		// Read in the cache on statup
		this.cache = new Set<string>(JSON.parse(this.storageService.get(EditorOverrideService.overrideCacheStorageID, StorageScope.GLOBAL, JSON.stringify([]))));
		this.storageService.remove(EditorOverrideService.overrideCacheStorageID, StorageScope.GLOBAL);

		this._register(this.storageService.onWillSaveState(() => {
			// We want to store the glob patterns we would activate on, this allows us to know if we need to await the ext host on startup for opening a resource
			this.cacheContributionPoints();
		}));

		// When extensions have registered we no longer need the cache
		this.extensionService.onDidRegisterExtensions(() => {
			this.cache = undefined;
		});
	}

	async resolveEditorOverride(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): Promise<IEditorInputWithOptionsAndGroup | undefined> {
		// If it was an override before we await for the extensions to activate and then proceed with overriding or else they won't be registered
		if (this.cache && editor.resource && this.resourceMatchesCache(editor.resource)) {
			await this.extensionService.whenInstalledExtensionsRegistered();
		}

		if (options?.override === EditorOverride.DISABLED) {
			throw new Error(`Calling resolve editor override when override is explicitly disabled!`);
		}

		// Always ensure inputs have populated resource fields
		if (editor instanceof DiffEditorInput) {
			if ((!editor.modifiedInput.resource || !editor.originalInput.resource)) {
				return { editor, options, group };
			}
		} else if (!editor.resource) {
			return { editor, options, group };
		}

		let override = typeof options?.override === 'string' ? options.override : undefined;
		// If the editor passed in already has a type and the user didn't explicitly override the editor choice, use the editor type.
		override = override ?? (editor as IContributedEditorInput).viewType;

		if (options?.override === EditorOverride.PICK) {
			const picked = await this.doPickEditorOverride(editor, options, group);
			// If the picker was cancelled we will stop resolving the override
			if (!picked) {
				return;
			}
			// Deconstruct the return picked options and overrides if the user selected something
			override = picked[0].override as string | undefined;
			options = picked[0];
			group = picked[1] ?? group;
		}

		// Resolved the override as much as possible, now find a given contribution
		const { contributionPoint, conflictingDefault } = this.getContributionPoint(editor instanceof DiffEditorInput ? editor.modifiedInput.resource! : editor.resource!, override);
		const selectedContribution = contributionPoint;
		if (!selectedContribution) {
			return { editor, options, group };
		}

		const handlesDiff = typeof selectedContribution.options?.canHandleDiff === 'function' ? selectedContribution.options.canHandleDiff() : selectedContribution.options?.canHandleDiff;
		if (editor instanceof DiffEditorInput && handlesDiff === false) {
			return { editor, options, group };
		}

		// If it's the currently active editor we shouldn't do anything
		if (selectedContribution.editorInfo.describes(editor)) {
			return;
		}
		const input = await this.doOverrideEditorInput(editor, options, group, selectedContribution);
		if (conflictingDefault && input) {
			// Wait one second to give the user ample time to see the current editor then ask them to configure a default
			setTimeout(() => {
				this.doHandleConflictingDefaults(selectedContribution.editorInfo.label, input.editor, input.options ?? options, group);
			}, 1200);
		}
		// Add the group as we might've changed it with the quickpick
		if (input) {
			this.sendOverrideTelemetry(input.editor);
			return { ...input, group };
		}
		return input;
	}

	registerContributionPoint(
		globPattern: string | glob.IRelativePattern,
		editorInfo: ContributedEditorInfo,
		options: ContributionPointOptions,
		createEditorInput: EditorInputFactoryFunction,
		createDiffEditorInput?: DiffEditorInputFactoryFunction
	): IDisposable {
		if (this._contributionPoints.get(globPattern) === undefined) {
			this._contributionPoints.set(globPattern, []);
		}
		const remove = insert(this._contributionPoints.get(globPattern)!, {
			globPattern,
			editorInfo,
			options,
			createEditorInput,
			createDiffEditorInput
		});
		return toDisposable(() => remove());
	}

	hasContributionPoint(schemeOrGlob: string): boolean {
		return this._contributionPoints.has(schemeOrGlob);
	}

	getAssociationsForResource(resource: URI): EditorAssociations {
		const rawAssociations = this.configurationService.getValue<EditorAssociations>(editorsAssociationsSettingId) || [];
		return rawAssociations.filter(association => association.filenamePattern && globMatchesResource(association.filenamePattern, resource));
	}

	updateUserAssociations(globPattern: string, editorID: string): void {
		const newAssociation: EditorAssociation = { viewType: editorID, filenamePattern: globPattern };
		const currentAssociations = [...this.configurationService.getValue<EditorAssociations>(editorsAssociationsSettingId)];

		// First try updating existing association
		for (let i = 0; i < currentAssociations.length; ++i) {
			const existing = currentAssociations[i];
			if (existing.filenamePattern === newAssociation.filenamePattern) {
				currentAssociations.splice(i, 1, newAssociation);
				this.configurationService.updateValue(editorsAssociationsSettingId, currentAssociations);
				return;
			}
		}

		// Otherwise, create a new one
		currentAssociations.unshift(newAssociation);
		this.configurationService.updateValue(editorsAssociationsSettingId, currentAssociations);
	}

	private findMatchingContributions(resource: URI): ContributionPoint[] {
		let contributions: ContributionPoint[] = [];
		// Then all glob patterns
		for (const key of this._contributionPoints.keys()) {
			const contributionPoints = this._contributionPoints.get(key)!;
			for (const contributionPoint of contributionPoints) {
				if (globMatchesResource(key, resource)) {
					contributions.push(contributionPoint);
				}
			}
		}
		// Return the contributions sorted by their priority
		return contributions.sort((a, b) => priorityToRank(b.editorInfo.priority) - priorityToRank(a.editorInfo.priority));
	}

	/**
	 * Given a resource and an override selects the best possible contribution point
	 * @returns The contribution point and whether there was another default which conflicted with it
	 */
	private getContributionPoint(resource: URI, override: string | undefined): { contributionPoint: ContributionPoint | undefined, conflictingDefault: boolean } {
		const findMatchingContribPoint = (contributionPoints: ContributionPoints, viewType: string) => {
			return contributionPoints.find((contribPoint) => {
				if (contribPoint.options && contribPoint.options.canSupportResource !== undefined) {
					return contribPoint.editorInfo.id === viewType && contribPoint.options.canSupportResource(resource);
				}
				return contribPoint.editorInfo.id === viewType;
			});
		};
		if (override) {
			// Specific overried passed in doesn't have to match the reosurce, it can be anything
			const contributionPoints = flatten(Array.from(this._contributionPoints.values()));
			return {
				contributionPoint: findMatchingContribPoint(contributionPoints, override),
				conflictingDefault: false
			};
		}

		let contributionPoints = this.findMatchingContributions(resource);

		const associationsFromSetting = this.getAssociationsForResource(resource);
		// We only want built-in+ if no user defined setting is found, else we won't override
		const possibleContributionPoints = contributionPoints.filter(contribPoint => priorityToRank(contribPoint.editorInfo.priority) >= priorityToRank(ContributedEditorPriority.builtin) && contribPoint.editorInfo.id !== DEFAULT_EDITOR_ASSOCIATION.id);
		// If the contribution is exclusive we use that, else use the user setting, else use the built-in+ contribution
		const selectedViewType = possibleContributionPoints[0]?.editorInfo.priority === ContributedEditorPriority.exclusive ?
			possibleContributionPoints[0]?.editorInfo.id :
			associationsFromSetting[0]?.viewType || possibleContributionPoints[0]?.editorInfo.id;

		let conflictingDefault = false;
		if (associationsFromSetting.length === 0 && possibleContributionPoints.length > 1) {
			conflictingDefault = true;
		}

		return {
			contributionPoint: findMatchingContribPoint(contributionPoints, selectedViewType),
			conflictingDefault
		};
	}

	private async doOverrideEditorInput(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup, selectedContribution: ContributionPoint): Promise<IEditorInputWithOptions | undefined> {

		// If no activation option is provided, populate it.
		if (options && typeof options.activation === 'undefined') {
			options = { ...options, activation: options.preserveFocus ? EditorActivation.RESTORE : undefined };
		}

		// If it's a diff editor we trigger the create diff editor input
		if (editor instanceof DiffEditorInput) {
			if (!selectedContribution.createDiffEditorInput) {
				return;
			}
			const inputWithOptions = selectedContribution.createDiffEditorInput(editor, options, group);
			return inputWithOptions;
		}

		// We only call this function from one place and there we do the check to ensure editor.resource is not undefined
		const resource = editor.resource!;

		// Respect options passed back
		const inputWithOptions = selectedContribution.createEditorInput(resource, options, group);
		options = inputWithOptions.options ?? options;
		const input = inputWithOptions.editor;

		// If the editor states it can only be opened once per resource we must close all existing ones first
		const singleEditorPerResource = typeof selectedContribution.options?.singlePerResource === 'function' ? selectedContribution.options.singlePerResource() : selectedContribution.options?.singlePerResource;
		if (singleEditorPerResource) {
			this.closeExistingEditorsForResource(resource, selectedContribution.editorInfo.id, group);
		}

		return { editor: input, options };
	}

	private closeExistingEditorsForResource(
		resource: URI,
		viewType: string,
		targetGroup: IEditorGroup,
	): void {
		const editorInfoForResource = this.findExistingEditorsForResource(resource, viewType);
		if (!editorInfoForResource.length) {
			return;
		}

		const editorToUse = editorInfoForResource[0];

		// Replace all other editors
		for (const { editor, group } of editorInfoForResource) {
			if (editor !== editorToUse.editor) {
				group.closeEditor(editor);
			}
		}

		if (targetGroup.id !== editorToUse.group.id) {
			editorToUse.group.closeEditor(editorToUse.editor);
		}
		return;
	}

	/**
	 * Given a resource and a viewType, returns all editors open for that resouce and viewType.
	 * @param resource The resource specified
	 * @param viewType The viewtype
	 * @returns A list of editors
	 */
	private findExistingEditorsForResource(
		resource: URI,
		viewType: string,
	): Array<{ editor: IEditorInput, group: IEditorGroup }> {
		const out: Array<{ editor: IEditorInput, group: IEditorGroup }> = [];
		const orderedGroups = distinct([
			...this.editorGroupService.groups,
		]);

		for (const group of orderedGroups) {
			for (const editor of group.editors) {
				if (isEqual(editor.resource, resource) && (editor as IContributedEditorInput).viewType === viewType) {
					out.push({ editor, group });
				}
			}
		}
		return out;
	}

	private async doHandleConflictingDefaults(editorName: string, currentEditor: IContributedEditorInput, options: IEditorOptions | undefined, group: IEditorGroup) {
		const makeCurrentEditorDefault = () => {
			const viewType = currentEditor.viewType;
			if (viewType) {
				this.updateUserAssociations(`*${extname(currentEditor.resource!)}`, viewType);
			}
		};

		const handle = this.notificationService.prompt(Severity.Warning,
			localize('editorOverride.conflictingDefaults', 'Multiple editors want to be your default editor for this resource.'),
			[{
				label: localize('editorOverride.configureDefault', 'Configure Default'),
				run: async () => {
					// Show the picker and tell it to update the setting to whatever the user selected
					const picked = await this.doPickEditorOverride(currentEditor, options, group, true);
					if (!picked) {
						return;
					}
					const replacementEditor = await this.resolveEditorOverride(currentEditor, picked[0], picked[1] ?? group);
					if (!replacementEditor) {
						return;
					}
					// Replace the current editor with the picked one
					(replacementEditor.group ?? picked[1] ?? group).replaceEditors([
						{
							editor: currentEditor,
							replacement: replacementEditor.editor,
							options: replacementEditor.options ?? picked[0],
						}
					]);
				}
			},
			{
				label: localize('editorOverride.keepDefault', 'Keep {0}', editorName),
				run: makeCurrentEditorDefault
			}
			]);
		// If the user pressed X we assume they want to keep the current editor as default
		const onCloseListener = handle.onDidClose(() => {
			makeCurrentEditorDefault();
			onCloseListener.dispose();
		});
	}

	private mapContributionsToQuickPickEntry(resource: URI, group: IEditorGroup, showDefaultPicker?: boolean) {
		const currentEditor = firstOrDefault(group.findEditors(resource));
		// If untitled, we want all contribution points
		let contributionPoints = resource.scheme === Schemas.untitled ? distinct(flatten(Array.from(this._contributionPoints.values())), (contrib) => contrib.editorInfo.id) : this.findMatchingContributions(resource);
		const defaultSetting = this.getAssociationsForResource(resource)[0]?.viewType;
		// Not the most efficient way to do this, but we want to ensure the text editor is at the top of the quickpick
		contributionPoints = contributionPoints.sort((a, b) => {
			if (a.editorInfo.id === DEFAULT_EDITOR_ASSOCIATION.id) {
				return -1;
			} else if (b.editorInfo.id === DEFAULT_EDITOR_ASSOCIATION.id) {
				return 1;
			} else {
				return priorityToRank(b.editorInfo.priority) - priorityToRank(a.editorInfo.priority);
			}
		});
		const quickPickEntries: Array<IQuickPickItem | IQuickPickSeparator> = [];
		const currentlyActiveLabel = localize('promptOpenWith.currentlyActive', "Active");
		const currentDefaultLabel = localize('promptOpenWith.currentDefault', "Default");
		const currentDefaultAndActiveLabel = localize('promptOpenWith.currentDefaultAndActive', "Active and Default");
		// Default order = setting -> highest priority -> text
		let defaultViewType = defaultSetting;
		if (!defaultViewType && contributionPoints.length > 2 && contributionPoints[1]?.editorInfo.priority !== ContributedEditorPriority.option) {
			defaultViewType = contributionPoints[1]?.editorInfo.id;
		}
		if (!defaultViewType) {
			defaultViewType = DEFAULT_EDITOR_ASSOCIATION.id;
		}
		// Get the matching contribtuions and call resolve whether they're active for the picker
		contributionPoints.forEach(contribPoint => {
			const isActive = currentEditor ? contribPoint.editorInfo.describes(currentEditor) : false;
			const isDefault = contribPoint.editorInfo.id === defaultViewType;
			const quickPickEntry: IQuickPickItem = {
				id: contribPoint.editorInfo.id,
				label: contribPoint.editorInfo.label,
				description: isActive && isDefault ? currentDefaultAndActiveLabel : isActive ? currentlyActiveLabel : isDefault ? currentDefaultLabel : undefined,
				detail: contribPoint.editorInfo.detail ?? contribPoint.editorInfo.priority,
			};
			quickPickEntries.push(quickPickEntry);
		});
		if (!showDefaultPicker) {
			const separator: IQuickPickSeparator = { type: 'separator' };
			quickPickEntries.push(separator);
			const configureDefaultEntry = {
				id: EditorOverrideService.configureDefaultID,
				label: localize('promptOpenWith.configureDefault', "Configure default editor....")
			};
			quickPickEntries.push(configureDefaultEntry);
		}
		return quickPickEntries;
	}

	private async doPickEditorOverride(editor: IEditorInput, options: IEditorOptions | undefined, group: IEditorGroup, showDefaultPicker?: boolean): Promise<[IEditorOptions, IEditorGroup | undefined] | undefined> {

		type EditorOverridePick = {
			readonly item: IQuickPickItem;
			readonly keyMods?: IKeyMods;
			readonly openInBackground: boolean;
		};

		const resource = EditorResourceAccessor.getOriginalUri(editor);

		if (!resource) {
			return;
		}

		// Text editor has the lowest priority because we
		const editorOverridePicks = this.mapContributionsToQuickPickEntry(resource, group, showDefaultPicker);

		// Create editor override picker
		const editorOverridePicker = this.quickInputService.createQuickPick<IQuickPickItem>();
		const placeHolderMessage = showDefaultPicker ?
			localize('prompOpenWith.updateDefaultPlaceHolder', "Select new default editor for '{0}'", basename(resource)) :
			localize('promptOpenWith.placeHolder', "Select editor for '{0}'", basename(resource));
		editorOverridePicker.placeholder = placeHolderMessage;
		editorOverridePicker.canAcceptInBackground = true;
		editorOverridePicker.items = editorOverridePicks;
		const firstItem = editorOverridePicker.items.find(item => item.type === 'item') as IQuickPickItem | undefined;
		if (firstItem) {
			editorOverridePicker.selectedItems = [firstItem];
		}

		// Prompt the user to select an override
		const picked: EditorOverridePick | undefined = await new Promise<EditorOverridePick | undefined>(resolve => {
			editorOverridePicker.onDidAccept(e => {
				let result: EditorOverridePick | undefined = undefined;

				if (editorOverridePicker.selectedItems.length === 1) {
					result = {
						item: editorOverridePicker.selectedItems[0],
						keyMods: editorOverridePicker.keyMods,
						openInBackground: e.inBackground
					};
				}

				// If asked to always update the setting then update it even if the gear isn't clicked
				if (showDefaultPicker && result?.item.id) {
					this.updateUserAssociations(`*${extname(resource)}`, result.item.id,);
				}

				resolve(result);
			});

			editorOverridePicker.onDidTriggerItemButton(e => {

				// Trigger opening and close picker
				resolve({ item: e.item, openInBackground: false });

				// Persist setting
				if (resource && e.item && e.item.id) {
					this.updateUserAssociations(`*${extname(resource)}`, e.item.id,);
				}
			});

			editorOverridePicker.show();
		});

		// Close picker
		editorOverridePicker.dispose();

		// If the user picked an override, look at how the picker was
		// used (e.g. modifier keys, open in background) and create the
		// options and group to use accordingly
		if (picked) {

			// If the user selected to configure default we trigger this picker again and tell it to show the default picker
			if (picked.item.id === EditorOverrideService.configureDefaultID) {
				return this.doPickEditorOverride(editor, options, group, true);
			}

			// Figure out target group
			let targetGroup: IEditorGroup | undefined;
			if (picked.keyMods?.alt || picked.keyMods?.ctrlCmd) {
				const direction = preferredSideBySideGroupDirection(this.configurationService);
				targetGroup = this.editorGroupService.findGroup({ direction }, group.id);
				targetGroup = targetGroup ?? this.editorGroupService.addGroup(group, direction);
			}

			// Figure out options
			const targetOptions: IEditorOptions = {
				...options,
				override: picked.item.id,
				preserveFocus: picked.openInBackground || options?.preserveFocus,
			};

			return [targetOptions, targetGroup];
		}

		return undefined;
	}

	private sendOverrideTelemetry(chosenInput: IContributedEditorInput): void {
		type editorOverrideClassification = {
			viewType: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
		};
		type editorOverrideEvent = {
			viewType: string
		};
		if (chosenInput.viewType) {
			this.telemetryService.publicLog2<editorOverrideEvent, editorOverrideClassification>('override.viewType', { viewType: chosenInput.viewType });
		}
	}

	private cacheContributionPoints() {
		// Create a set to store contributed glob patterns
		const cacheStorage: Set<string> = new Set<string>();

		// Store just the relative pattern pieces without any path info
		for (const globPattern of this._contributionPoints.keys()) {
			const contribPoint = this._contributionPoints.get(globPattern)!;
			const nonOptional = !!contribPoint.find(c => c.editorInfo.priority !== ContributedEditorPriority.option && c.editorInfo.id !== DEFAULT_EDITOR_ASSOCIATION.id);
			// Don't keep a cache of the optional ones as those wouldn't be opened on start anyways
			if (!nonOptional) {
				continue;
			}
			if (glob.isRelativePattern(globPattern)) {
				cacheStorage.add(`${globPattern.pattern}`);
			} else {
				cacheStorage.add(globPattern);
			}
		}

		// Also store the users settings as those would have to activate on startup as well
		const userAssociations = this.configurationService.getValue<EditorAssociations>(editorsAssociationsSettingId) || [];
		for (const association of userAssociations) {
			if (association.filenamePattern) {
				cacheStorage.add(association.filenamePattern);
			}
		}
		this.storageService.store(EditorOverrideService.overrideCacheStorageID, JSON.stringify(Array.from(cacheStorage)), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private resourceMatchesCache(resource: URI): boolean {
		if (!this.cache) {
			return false;
		}

		for (const cacheEntry of this.cache) {
			if (globMatchesResource(cacheEntry, resource)) {
				return true;
			}
		}
		return false;
	}
}

registerSingleton(IEditorOverrideService, EditorOverrideService);
