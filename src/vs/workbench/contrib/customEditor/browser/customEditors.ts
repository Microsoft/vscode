/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, distinct } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { Lazy } from 'vs/base/common/lazy';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { basename, extname, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { RedoCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { EditorActivation, IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { FileOperation, IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import * as colorRegistry from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { EditorInput, EditorOptions, Extensions as EditorInputExtensions, GroupIdentifier, IEditorInput, IEditorInputFactoryRegistry, IEditorPane } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { CONTEXT_CUSTOM_EDITORS, CONTEXT_FOCUSED_CUSTOM_EDITOR_IS_EDITABLE, CustomEditorCapabilities, CustomEditorInfo, CustomEditorInfoCollection, CustomEditorPriority, ICustomEditorService } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { CustomEditorModelManager } from 'vs/workbench/contrib/customEditor/common/customEditorModelManager';
import { IWebviewService, webviewHasOwnEditFunctionsContext } from 'vs/workbench/contrib/webview/browser/webview';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { CustomEditorAssociation, CustomEditorsAssociations, customEditorsAssociationsSettingId, defaultEditorOverrideEntry } from 'vs/workbench/services/editor/common/editorOpenWith';
import { ICustomEditorInfo, ICustomEditorViewTypesHandler, IEditorService, IOpenEditorOverride, IOpenEditorOverrideEntry } from 'vs/workbench/services/editor/common/editorService';
import { ContributedCustomEditors, defaultCustomEditor } from '../common/contributedCustomEditors';
import { CustomEditorInput } from './customEditorInput';

export class CustomEditorService extends Disposable implements ICustomEditorService, ICustomEditorViewTypesHandler {
	_serviceBrand: any;

	private readonly _contributedEditors: ContributedCustomEditors;
	private readonly _editorCapabilities = new Map<string, CustomEditorCapabilities>();

	private readonly _models = new CustomEditorModelManager();

	private readonly _customEditorContextKey: IContextKey<string>;
	private readonly _focusedCustomEditorIsEditable: IContextKey<boolean>;
	private readonly _webviewHasOwnEditFunctions: IContextKey<boolean>;
	private readonly _onDidChangeViewTypes = new Emitter<void>();
	onDidChangeViewTypes: Event<void> = this._onDidChangeViewTypes.event;

	private readonly _fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).getFileEditorInputFactory();

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWebviewService private readonly webviewService: IWebviewService,
	) {
		super();

		this._customEditorContextKey = CONTEXT_CUSTOM_EDITORS.bindTo(contextKeyService);
		this._focusedCustomEditorIsEditable = CONTEXT_FOCUSED_CUSTOM_EDITOR_IS_EDITABLE.bindTo(contextKeyService);
		this._webviewHasOwnEditFunctions = webviewHasOwnEditFunctionsContext.bindTo(contextKeyService);

		this._contributedEditors = this._register(new ContributedCustomEditors(storageService));
		this._register(this._contributedEditors.onChange(() => {
			this.updateContexts();
			this._onDidChangeViewTypes.fire();
		}));
		this._register(this.editorService.registerCustomEditorViewTypesHandler('Custom Editor', this));
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateContexts()));

		this._register(fileService.onDidRunOperation(e => {
			if (e.isOperation(FileOperation.MOVE)) {
				this.handleMovedFileInOpenedFileEditors(e.resource, e.target.resource);
			}
		}));

		const PRIORITY = 105;
		this._register(UndoCommand.addImplementation(PRIORITY, () => {
			return this.withActiveCustomEditor(editor => editor.undo());
		}));
		this._register(RedoCommand.addImplementation(PRIORITY, () => {
			return this.withActiveCustomEditor(editor => editor.redo());
		}));

		this.updateContexts();
	}

	getViewTypes(): ICustomEditorInfo[] {
		return [...this._contributedEditors];
	}

	private withActiveCustomEditor(f: (editor: CustomEditorInput) => void): boolean {
		const activeEditor = this.editorService.activeEditor;
		if (activeEditor instanceof CustomEditorInput) {
			f(activeEditor);
			return true;
		}
		return false;
	}

	public get models() { return this._models; }

	public getCustomEditor(viewType: string): CustomEditorInfo | undefined {
		return this._contributedEditors.get(viewType);
	}

	public getContributedCustomEditors(resource: URI): CustomEditorInfoCollection {
		return new CustomEditorInfoCollection(this._contributedEditors.getContributedEditors(resource));
	}

	public getUserConfiguredCustomEditors(resource: URI): CustomEditorInfoCollection {
		const rawAssociations = this.configurationService.getValue<CustomEditorsAssociations>(customEditorsAssociationsSettingId) || [];
		return new CustomEditorInfoCollection(
			coalesce(rawAssociations
				.filter(association => CustomEditorInfo.selectorMatches(association, resource))
				.map(association => this._contributedEditors.get(association.viewType))));
	}

	public getAllCustomEditors(resource: URI): CustomEditorInfoCollection {
		return new CustomEditorInfoCollection([
			...this.getUserConfiguredCustomEditors(resource).allEditors,
			...this.getContributedCustomEditors(resource).allEditors,
		]);
	}

	public async promptOpenWith(
		resource: URI,
		options?: ITextEditorOptions,
		group?: IEditorGroup,
	): Promise<IEditorPane | undefined> {
		const pick = await this.showOpenWithPrompt(resource, group);
		if (!pick) {
			return;
		}

		return this.openWith(resource, pick, options, group);
	}

	private showOpenWithPrompt(
		resource: URI,
		group?: IEditorGroup,
	): Promise<string | undefined> {
		const customEditors = new CustomEditorInfoCollection([
			defaultCustomEditor,
			...this.getAllCustomEditors(resource).allEditors,
		]);

		let currentlyOpenedEditorType: undefined | string;
		for (const editor of group ? group.editors : []) {
			if (editor.resource && isEqual(editor.resource, resource)) {
				currentlyOpenedEditorType = editor instanceof CustomEditorInput ? editor.viewType : defaultCustomEditor.id;
				break;
			}
		}

		const resourceExt = extname(resource);

		const items = customEditors.allEditors.map((editorDescriptor): IQuickPickItem => ({
			label: editorDescriptor.displayName,
			id: editorDescriptor.id,
			description: editorDescriptor.id === currentlyOpenedEditorType
				? nls.localize('openWithCurrentlyActive', "Currently Active")
				: undefined,
			detail: editorDescriptor.providerDisplayName,
			buttons: resourceExt ? [{
				iconClass: 'codicon-settings-gear',
				tooltip: nls.localize('promptOpenWith.setDefaultTooltip', "Set as default editor for '{0}' files", resourceExt)
			}] : undefined
		}));

		const picker = this.quickInputService.createQuickPick();
		picker.items = items;
		picker.placeholder = nls.localize('promptOpenWith.placeHolder', "Select editor to use for '{0}'...", basename(resource));

		return new Promise<string | undefined>(resolve => {
			picker.onDidAccept(() => {
				resolve(picker.selectedItems.length === 1 ? picker.selectedItems[0].id : undefined);
				picker.dispose();
			});
			picker.onDidTriggerItemButton(e => {
				const pick = e.item.id;
				resolve(pick); // open the view
				picker.dispose();

				// And persist the setting
				if (pick) {
					const newAssociation: CustomEditorAssociation = { viewType: pick, filenamePattern: '*' + resourceExt };
					const currentAssociations = [...this.configurationService.getValue<CustomEditorsAssociations>(customEditorsAssociationsSettingId)];

					// First try updating existing association
					for (let i = 0; i < currentAssociations.length; ++i) {
						const existing = currentAssociations[i];
						if (existing.filenamePattern === newAssociation.filenamePattern) {
							currentAssociations.splice(i, 1, newAssociation);
							this.configurationService.updateValue(customEditorsAssociationsSettingId, currentAssociations);
							return;
						}
					}

					// Otherwise, create a new one
					currentAssociations.unshift(newAssociation);
					this.configurationService.updateValue(customEditorsAssociationsSettingId, currentAssociations);
				}
			});
			picker.show();
		});
	}

	public async openWith(
		resource: URI,
		viewType: string,
		options?: ITextEditorOptions,
		group?: IEditorGroup,
	): Promise<IEditorPane | undefined> {
		if (viewType === defaultCustomEditor.id) {
			const fileEditorInput = this.editorService.createEditorInput({ resource, forceFile: true });
			return this.openEditorForResource(resource, fileEditorInput, { ...options, override: false }, group);
		}

		if (!this._contributedEditors.get(viewType)) {
			return this.promptOpenWith(resource, options, group);
		}

		const capabilities = this.getCustomEditorCapabilities(viewType) || {};
		if (!capabilities.supportsMultipleEditorsPerDocument) {
			const movedEditor = await this.tryRevealExistingEditorForResourceInGroup(resource, viewType, options, group);
			if (movedEditor) {
				return movedEditor;
			}
		}

		const input = this.createInput(resource, viewType, group?.id);
		return this.openEditorForResource(resource, input, options, group);
	}

	public createInput(
		resource: URI,
		viewType: string,
		group: GroupIdentifier | undefined,
		options?: { readonly customClasses: string; },
	): IEditorInput {
		if (viewType === defaultCustomEditor.id) {
			return this.editorService.createEditorInput({ resource, forceFile: true });
		}

		const id = generateUuid();
		const webview = new Lazy(() => {
			return this.webviewService.createWebviewOverlay(id, { customClasses: options?.customClasses }, {}, undefined);
		});
		const input = this.instantiationService.createInstance(CustomEditorInput, resource, viewType, id, webview, {});
		if (typeof group !== 'undefined') {
			input.updateGroup(group);
		}
		return input;
	}

	private async openEditorForResource(
		resource: URI,
		input: IEditorInput,
		options?: IEditorOptions,
		group?: IEditorGroup
	): Promise<IEditorPane | undefined> {
		const targetGroup = group || this.editorGroupService.activeGroup;

		if (options && typeof options.activation === 'undefined') {
			options = { ...options, activation: options.preserveFocus ? EditorActivation.RESTORE : undefined };
		}

		// Try to replace existing editors for resource
		const existingEditors = targetGroup.editors.filter(editor => editor.resource && isEqual(editor.resource, resource));
		if (existingEditors.length) {
			const existing = existingEditors[0];
			if (!input.matches(existing)) {
				await this.editorService.replaceEditors([{
					editor: existing,
					replacement: input,
					options: options ? EditorOptions.create(options) : undefined,
				}], targetGroup);

				if (existing instanceof CustomEditorInput) {
					existing.dispose();
				}
			}
		}

		return this.editorService.openEditor(input, options, group);
	}

	public registerCustomEditorCapabilities(viewType: string, options: CustomEditorCapabilities): IDisposable {
		if (this._editorCapabilities.has(viewType)) {
			throw new Error(`Capabilities for ${viewType} already set`);
		}
		this._editorCapabilities.set(viewType, options);
		return toDisposable(() => {
			this._editorCapabilities.delete(viewType);
		});
	}

	private getCustomEditorCapabilities(viewType: string): CustomEditorCapabilities | undefined {
		return this._editorCapabilities.get(viewType);
	}

	private updateContexts() {
		const activeEditorPane = this.editorService.activeEditorPane;
		const resource = activeEditorPane?.input?.resource;
		if (!resource) {
			this._customEditorContextKey.reset();
			this._focusedCustomEditorIsEditable.reset();
			this._webviewHasOwnEditFunctions.reset();
			return;
		}

		const possibleEditors = this.getAllCustomEditors(resource).allEditors;

		this._customEditorContextKey.set(possibleEditors.map(x => x.id).join(','));
		this._focusedCustomEditorIsEditable.set(activeEditorPane?.input instanceof CustomEditorInput);
		this._webviewHasOwnEditFunctions.set(possibleEditors.length > 0);
	}

	private async handleMovedFileInOpenedFileEditors(oldResource: URI, newResource: URI): Promise<void> {
		if (extname(oldResource) === extname(newResource)) {
			return;
		}

		const possibleEditors = this.getAllCustomEditors(newResource);

		// See if we have any non-optional custom editor for this resource
		if (!possibleEditors.allEditors.some(editor => editor.priority !== CustomEditorPriority.option)) {
			return;
		}

		// If so, check all editors to see if there are any file editors open for the new resource
		const editorsToReplace = new Map<GroupIdentifier, IEditorInput[]>();
		for (const group of this.editorGroupService.groups) {
			for (const editor of group.editors) {
				if (this._fileEditorInputFactory.isFileEditorInput(editor)
					&& !(editor instanceof CustomEditorInput)
					&& isEqual(editor.resource, newResource)
				) {
					let entry = editorsToReplace.get(group.id);
					if (!entry) {
						entry = [];
						editorsToReplace.set(group.id, entry);
					}
					entry.push(editor);
				}
			}
		}

		if (!editorsToReplace.size) {
			return;
		}

		let viewType: string | undefined;
		if (possibleEditors.defaultEditor) {
			viewType = possibleEditors.defaultEditor.id;
		} else {
			// If there is, show a single prompt for all editors to see if the user wants to re-open them
			//
			// TODO: instead of prompting eagerly, it'd likely be better to replace all the editors with
			// ones that would prompt when they first become visible
			await new Promise(resolve => setTimeout(resolve, 50));
			viewType = await this.showOpenWithPrompt(newResource);
		}

		if (!viewType) {
			return;
		}

		for (const [group, entries] of editorsToReplace) {
			this.editorService.replaceEditors(entries.map(editor => {
				const replacement = this.createInput(newResource, viewType!, group);
				return {
					editor,
					replacement,
					options: {
						preserveFocus: true,
					}
				};
			}), group);
		}
	}

	private async tryRevealExistingEditorForResourceInGroup(
		resource: URI,
		viewType: string,
		options?: ITextEditorOptions,
		group?: IEditorGroup,
	): Promise<IEditorPane | undefined> {
		const editorInfoForResource = this.findExistingEditorsForResource(resource, viewType);
		if (!editorInfoForResource.length) {
			return undefined;
		}

		const editorToUse = editorInfoForResource[0];

		// Replace all other editors
		for (const { editor, group } of editorInfoForResource) {
			if (editor !== editorToUse.editor) {
				group.closeEditor(editor);
			}
		}

		const targetGroup = group || this.editorGroupService.activeGroup;
		const newEditor = await this.openEditorForResource(resource, editorToUse.editor, { ...options, override: false }, targetGroup);
		if (targetGroup.id !== editorToUse.group.id) {
			editorToUse.group.closeEditor(editorToUse.editor);
		}
		return newEditor;
	}

	private findExistingEditorsForResource(
		resource: URI,
		viewType: string,
	): Array<{ editor: IEditorInput, group: IEditorGroup }> {
		const out: Array<{ editor: IEditorInput, group: IEditorGroup }> = [];
		const orderedGroups = distinct([
			this.editorGroupService.activeGroup,
			...this.editorGroupService.groups,
		]);

		for (const group of orderedGroups) {
			for (const editor of group.editors) {
				if (isMatchingCustomEditor(editor, viewType, resource)) {
					out.push({ editor, group });
				}
			}
		}
		return out;
	}
}

export class CustomEditorContribution extends Disposable implements IWorkbenchContribution {

	private readonly _fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).getFileEditorInputFactory();

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ICustomEditorService private readonly customEditorService: ICustomEditorService,
	) {
		super();

		this._register(this.editorService.overrideOpenEditor({
			open: (editor, options, group) => {
				return this.onEditorOpening(editor, options, group);
			},
			getEditorOverrides: (resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined): IOpenEditorOverrideEntry[] => {
				const currentEditor = group?.editors.find(editor => isEqual(editor.resource, resource));

				const defaultEditorOverride: IOpenEditorOverrideEntry = {
					...defaultEditorOverrideEntry,
					active: this._fileEditorInputFactory.isFileEditorInput(currentEditor),
				};

				const toOverride = (entry: CustomEditorInfo): IOpenEditorOverrideEntry => {
					return {
						id: entry.id,
						active: currentEditor instanceof CustomEditorInput && currentEditor.viewType === entry.id,
						label: entry.displayName,
						detail: entry.providerDisplayName,
					};
				};

				if (typeof options?.override === 'string') {
					// A specific override was requested. Only return it.

					if (options.override === defaultEditorOverride.id) {
						return [defaultEditorOverride];
					}

					const matchingEditor = this.customEditorService.getCustomEditor(options.override);
					return matchingEditor ? [toOverride(matchingEditor)] : [];
				}

				// Otherwise, return all potential overrides.
				const customEditors = this.customEditorService.getAllCustomEditors(resource);
				if (!customEditors.length) {
					return [];
				}

				return [
					defaultEditorOverride,
					...customEditors.allEditors
						.filter(entry => entry.id !== defaultCustomEditor.id)
						.map(toOverride)
				];
			}
		}));
	}

	private onEditorOpening(
		editor: IEditorInput,
		options: ITextEditorOptions | undefined,
		group: IEditorGroup
	): IOpenEditorOverride | undefined {
		const id = typeof options?.override === 'string' ? options.override : undefined;
		if (editor instanceof CustomEditorInput) {
			if (editor.group === group.id && (editor.viewType === id || typeof id !== 'string')) {
				// No need to do anything
				return undefined;
			} else {
				// Create a copy of the input.
				// Unlike normal editor inputs, we do not want to share custom editor inputs
				// between multiple editors / groups.
				return {
					override: this.customEditorService.openWith(editor.resource, id ?? editor.viewType, options, group)
				};
			}
		}

		if (editor instanceof DiffEditorInput) {
			return this.onDiffEditorOpening(editor, options, group);
		}

		const resource = editor.resource;
		if (!resource) {
			return undefined;
		}

		if (id) {
			return {
				override: this.customEditorService.openWith(resource, id, { ...options, override: false }, group)
			};
		}

		return this.onResourceEditorOpening(resource, editor, options, group);
	}

	private onResourceEditorOpening(
		resource: URI,
		editor: IEditorInput,
		options: ITextEditorOptions | undefined,
		group: IEditorGroup,
	): IOpenEditorOverride | undefined {
		const userConfiguredEditors = this.customEditorService.getUserConfiguredCustomEditors(resource);
		const contributedEditors = this.customEditorService.getContributedCustomEditors(resource);
		if (!userConfiguredEditors.length && !contributedEditors.length) {
			return;
		}

		// Check to see if there already an editor for the resource in the group.
		// If there is, we want to open that instead of creating a new editor.
		// This ensures that we preserve whatever type of editor was previously being used
		// when the user switches back to it.
		const strictMatchEditorInput = group.editors.find(e => e === editor && !this._fileEditorInputFactory.isFileEditorInput(e));
		if (strictMatchEditorInput) {
			return;
		}

		const existingEditorForResource = group.editors.find(editor => isEqual(resource, editor.resource));
		if (existingEditorForResource) {
			if (editor === existingEditorForResource) {
				return;
			}

			return {
				override: this.editorService.openEditor(existingEditorForResource, {
					...options,
					override: false,
					activation: options?.preserveFocus ? EditorActivation.RESTORE : undefined,
				}, group)
			};
		}

		if (userConfiguredEditors.length) {
			return {
				override: this.customEditorService.openWith(resource, userConfiguredEditors.allEditors[0].id, options, group),
			};
		}

		if (!contributedEditors.length) {
			return;
		}

		const defaultEditor = contributedEditors.defaultEditor;
		if (defaultEditor) {
			return {
				override: this.customEditorService.openWith(resource, defaultEditor.id, options, group),
			};
		}

		// If we have all optional editors, then open VS Code's standard editor
		if (contributedEditors.allEditors.every(editor => editor.priority === CustomEditorPriority.option)) {
			return;
		}

		// Open VS Code's standard editor but prompt user to see if they wish to use a custom one instead
		return {
			override: (async () => {
				const standardEditor = await this.editorService.openEditor(editor, { ...options, override: false }, group);
				// Give a moment to make sure the editor is showing.
				// Otherwise the focus shift can cause the prompt to be dismissed right away.
				await new Promise(resolve => setTimeout(resolve, 20));
				const selectedEditor = await this.customEditorService.promptOpenWith(resource, options, group);
				if (selectedEditor && selectedEditor.input) {
					await group.replaceEditors([{
						editor,
						replacement: selectedEditor.input
					}]);
					return selectedEditor;
				}

				return standardEditor;
			})()
		};
	}

	private onDiffEditorOpening(
		editor: DiffEditorInput,
		options: ITextEditorOptions | undefined,
		group: IEditorGroup
	): IOpenEditorOverride | undefined {
		const getBestAvailableEditorForSubInput = (subInput: IEditorInput): CustomEditorInfo | undefined => {
			if (subInput instanceof CustomEditorInput) {
				return undefined;
			}
			const resource = subInput.resource;
			if (!resource) {
				return undefined;
			}

			// Prefer default editors in the diff editor case but ultimately always take the first editor
			const allEditors = new CustomEditorInfoCollection([
				...this.customEditorService.getUserConfiguredCustomEditors(resource).allEditors,
				...this.customEditorService.getContributedCustomEditors(resource).allEditors.filter(x => x.priority !== CustomEditorPriority.option),
			]);
			return allEditors.bestAvailableEditor;
		};

		const createEditorForSubInput = (subInput: IEditorInput, editor: CustomEditorInfo | undefined, customClasses: string): EditorInput | undefined => {
			if (!editor) {
				return;
			}
			if (!subInput.resource) {
				return;
			}
			const input = this.customEditorService.createInput(subInput.resource, editor.id, group.id, { customClasses });
			return input instanceof EditorInput ? input : undefined;
		};

		const modifiedEditorInfo = getBestAvailableEditorForSubInput(editor.modifiedInput);
		const originalEditorInfo = getBestAvailableEditorForSubInput(editor.originalInput);

		// If we are only using default editors, no need to override anything
		if (
			(!modifiedEditorInfo || modifiedEditorInfo.id === defaultCustomEditor.id) &&
			(!originalEditorInfo || originalEditorInfo.id === defaultCustomEditor.id)
		) {
			return undefined;
		}

		const modifiedOverride = createEditorForSubInput(editor.modifiedInput, modifiedEditorInfo, 'modified');
		const originalOverride = createEditorForSubInput(editor.originalInput, originalEditorInfo, 'original');
		if (modifiedOverride || originalOverride) {
			return {
				override: (async () => {
					const input = new DiffEditorInput(editor.getName(), editor.getDescription(), originalOverride || editor.originalInput, modifiedOverride || editor.modifiedInput, true);
					return this.editorService.openEditor(input, { ...options, override: false }, group);
				})(),
			};
		}

		return undefined;
	}
}

function isMatchingCustomEditor(editor: IEditorInput, viewType: string, resource: URI): boolean {
	return editor instanceof CustomEditorInput
		&& editor.viewType === viewType
		&& isEqual(editor.resource, resource);
}

registerThemingParticipant((theme, collector) => {
	const shadow = theme.getColor(colorRegistry.scrollbarShadow);
	if (shadow) {
		collector.addRule(`.webview.modified { box-shadow: -6px 0 5px -5px ${shadow}; }`);
	}
});
