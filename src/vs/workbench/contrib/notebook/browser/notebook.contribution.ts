/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, distinct } from 'vs/base/common/arrays';
import { Schemas } from 'vs/base/common/network';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { parse } from 'vs/base/common/marshalling';
import { isEqual } from 'vs/base/common/resources';
import { assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ITextModel, ITextBufferFactory, DefaultEndOfLine, ITextBuffer } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import * as nls from 'vs/nls';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorOptions, ITextEditorOptions, IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { EditorInput, Extensions as EditorInputExtensions, IEditorInput, IEditorInputFactory, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookService } from 'vs/workbench/contrib/notebook/browser/notebookServiceImpl';
import { CellKind, CellToolbarLocKey, CellUri, DisplayOrderKey, getCellUndoRedoComparisonKey, NotebookDocumentBackupData, NotebookEditorPriority, NotebookTextDiffEditorPreview, ShowCellStatusBarKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, IOpenEditorOverride } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CustomEditorsAssociations, customEditorsAssociationsSettingId } from 'vs/workbench/services/editor/common/editorOpenWith';
import { CustomEditorInfo } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { INotebookEditor, NotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { INotebookEditorModelResolverService, NotebookModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { NotebookDiffEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookDiffEditorInput';
import { NotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffEditor';
import { INotebookEditorWorkerService } from 'vs/workbench/contrib/notebook/common/services/notebookWorkerService';
import { NotebookEditorWorkerServiceImpl } from 'vs/workbench/contrib/notebook/common/services/notebookWorkerServiceImpl';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { NotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/browser/notebookCellStatusBarServiceImpl';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { Event } from 'vs/base/common/event';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

// Editor Contribution

import 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import 'vs/workbench/contrib/notebook/browser/contrib/find/findController';
import 'vs/workbench/contrib/notebook/browser/contrib/fold/folding';
import 'vs/workbench/contrib/notebook/browser/contrib/format/formatting';
import 'vs/workbench/contrib/notebook/browser/contrib/toc/tocProvider';
import 'vs/workbench/contrib/notebook/browser/contrib/marker/markerProvider';
import 'vs/workbench/contrib/notebook/browser/contrib/status/editorStatus';
// import 'vs/workbench/contrib/notebook/browser/contrib/scm/scm';

// Diff Editor Contribution
import 'vs/workbench/contrib/notebook/browser/diff/notebookDiffActions';

// Output renderers registration

import 'vs/workbench/contrib/notebook/browser/view/output/transforms/streamTransform';
import 'vs/workbench/contrib/notebook/browser/view/output/transforms/errorTransform';
import 'vs/workbench/contrib/notebook/browser/view/output/transforms/richTransform';

/*--------------------------------------------------------------------------------------------- */

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		NotebookEditor,
		NotebookEditor.ID,
		'Notebook Editor'
	),
	[
		new SyncDescriptor(NotebookEditorInput)
	]
);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		NotebookTextDiffEditor,
		NotebookTextDiffEditor.ID,
		'Notebook Diff Editor'
	),
	[
		new SyncDescriptor(NotebookDiffEditorInput)
	]
);

class NotebookDiffEditorFactory implements IEditorInputFactory {
	canSerialize(): boolean {
		return true;
	}

	serialize(input: EditorInput): string {
		assertType(input instanceof NotebookDiffEditorInput);
		return JSON.stringify({
			resource: input.resource,
			originalResource: input.originalResource,
			name: input.name,
			originalName: input.originalName,
			textDiffName: input.textDiffName,
			viewType: input.viewType,
		});
	}

	deserialize(instantiationService: IInstantiationService, raw: string) {
		type Data = { resource: URI, originalResource: URI, name: string, originalName: string, viewType: string, textDiffName: string | undefined, group: number };
		const data = <Data>parse(raw);
		if (!data) {
			return undefined;
		}
		const { resource, originalResource, name, originalName, textDiffName, viewType } = data;
		if (!data || !URI.isUri(resource) || !URI.isUri(originalResource) || typeof name !== 'string' || typeof originalName !== 'string' || typeof viewType !== 'string') {
			return undefined;
		}

		const input = NotebookDiffEditorInput.create(instantiationService, resource, name, originalResource, originalName,
			textDiffName || nls.localize('diffLeftRightLabel', "{0} ⟷ {1}", originalResource.toString(true), resource.toString(true)),
			viewType);
		return input;
	}

	static canResolveBackup(editorInput: IEditorInput, backupResource: URI): boolean {
		return false;
	}

}
class NotebookEditorFactory implements IEditorInputFactory {
	canSerialize(): boolean {
		return true;
	}
	serialize(input: EditorInput): string {
		assertType(input instanceof NotebookEditorInput);
		return JSON.stringify({
			resource: input.resource,
			name: input.name,
			viewType: input.viewType,
		});
	}
	deserialize(instantiationService: IInstantiationService, raw: string) {
		type Data = { resource: URI, name: string, viewType: string, group: number };
		const data = <Data>parse(raw);
		if (!data) {
			return undefined;
		}
		const { resource, name, viewType } = data;
		if (!data || !URI.isUri(resource) || typeof name !== 'string' || typeof viewType !== 'string') {
			return undefined;
		}

		const input = NotebookEditorInput.create(instantiationService, resource, name, viewType);
		return input;
	}

	static async createCustomEditorInput(resource: URI, instantiationService: IInstantiationService): Promise<NotebookEditorInput> {
		return instantiationService.invokeFunction(async accessor => {
			const backupFileService = accessor.get<IBackupFileService>(IBackupFileService);

			const backup = await backupFileService.resolve<NotebookDocumentBackupData>(resource);
			if (!backup?.meta) {
				throw new Error(`No backup found for Notebook editor: ${resource}`);
			}

			const input = NotebookEditorInput.create(instantiationService, resource, backup.meta.name, backup.meta.viewType, { startDirty: true });
			return input;
		});
	}

	static canResolveBackup(editorInput: IEditorInput, backupResource: URI): boolean {
		if (editorInput instanceof NotebookEditorInput) {
			if (isEqual(editorInput.resource.with({ scheme: Schemas.vscodeNotebook }), backupResource)) {
				return true;
			}
		}

		return false;
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(
	NotebookEditorInput.ID,
	NotebookEditorFactory
);

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerCustomEditorInputFactory(
	Schemas.vscodeNotebook,
	NotebookEditorFactory
);

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(
	NotebookDiffEditorInput.ID,
	NotebookDiffEditorFactory
);

export class NotebookContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@INotebookService private readonly notebookService: INotebookService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IUndoRedoService undoRedoService: IUndoRedoService,
	) {
		super();

		this._register(undoRedoService.registerUriComparisonKeyComputer(CellUri.scheme, {
			getComparisonKey: (uri: URI): string => {
				return getCellUndoRedoComparisonKey(uri);
			}
		}));

		this._register(this.editorService.overrideOpenEditor({
			getEditorOverrides: (resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined) => {

				const currentEditorForResource = group?.editors.find(editor => isEqual(editor.resource, resource));

				const associatedEditors = distinct([
					...this.getUserAssociatedNotebookEditors(resource),
					...this.getContributedEditors(resource)
				], editor => editor.id);

				return associatedEditors.map(info => {
					return {
						label: info.displayName,
						id: info.id,
						active: currentEditorForResource instanceof NotebookEditorInput && currentEditorForResource.viewType === info.id,
						detail: info.providerDisplayName
					};
				});
			},
			open: (editor, options, group) => {
				return this.onEditorOpening(editor, options, group);
			}
		}));

		this._register(this.editorService.onDidVisibleEditorsChange(() => {
			const visibleNotebookEditors = editorService.visibleEditorPanes
				.filter(pane => (pane as unknown as { isNotebookEditor?: boolean }).isNotebookEditor)
				.map(pane => pane.getControl() as INotebookEditor)
				.filter(control => !!control)
				.map(editor => editor.getId());

			this.notebookService.updateVisibleNotebookEditor(visibleNotebookEditors);
		}));

		this._register(this.editorService.onDidActiveEditorChange(() => {
			const activeEditorPane = editorService.activeEditorPane as { isNotebookEditor?: boolean } | undefined;
			const notebookEditor = activeEditorPane?.isNotebookEditor ? (editorService.activeEditorPane?.getControl() as INotebookEditor) : undefined;
			if (notebookEditor) {
				this.notebookService.updateActiveNotebookEditor(notebookEditor);
			} else {
				this.notebookService.updateActiveNotebookEditor(null);
			}
		}));
	}

	getUserAssociatedEditors(resource: URI) {
		const rawAssociations = this.configurationService.getValue<CustomEditorsAssociations>(customEditorsAssociationsSettingId) || [];

		return coalesce(rawAssociations
			.filter(association => CustomEditorInfo.selectorMatches(association, resource)));
	}

	getUserAssociatedNotebookEditors(resource: URI) {
		const rawAssociations = this.configurationService.getValue<CustomEditorsAssociations>(customEditorsAssociationsSettingId) || [];

		return coalesce(rawAssociations
			.filter(association => CustomEditorInfo.selectorMatches(association, resource))
			.map(association => this.notebookService.getContributedNotebookProvider(association.viewType)));
	}

	getContributedEditors(resource: URI) {
		return this.notebookService.getContributedNotebookProviders(resource);
	}

	private onEditorOpening(originalInput: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): IOpenEditorOverride | undefined {

		let id = typeof options?.override === 'string' ? options.override : undefined;
		if (id === undefined && originalInput.resource?.scheme === Schemas.untitled) {
			return undefined;
		}

		if (originalInput instanceof DiffEditorInput && this.configurationService.getValue(NotebookTextDiffEditorPreview) && !this._accessibilityService.isScreenReaderOptimized()) {
			return this._handleDiffEditorInput(originalInput, options, group);
		}

		if (!originalInput.resource) {
			return undefined;
		}

		if (originalInput instanceof NotebookEditorInput) {
			return undefined;
		}

		if (originalInput instanceof NotebookDiffEditorInput) {
			return undefined;
		}

		let notebookUri: URI = originalInput.resource;
		let cellOptions: IResourceEditorInput | undefined;

		const data = CellUri.parse(originalInput.resource);
		if (data) {
			notebookUri = data.notebook;
			cellOptions = { resource: originalInput.resource, options };
		}

		if (id === undefined && originalInput instanceof ResourceEditorInput) {
			const exitingNotebookEditor = <NotebookEditorInput | undefined>group.editors.find(editor => editor instanceof NotebookEditorInput && isEqual(editor.resource, notebookUri));
			id = exitingNotebookEditor?.viewType;
		}

		if (id === undefined) {
			const existingEditors = group.editors.filter(editor =>
				editor.resource
				&& isEqual(editor.resource, notebookUri)
				&& !(editor instanceof NotebookEditorInput)
				&& !(editor instanceof NotebookDiffEditorInput)
			);

			if (existingEditors.length) {
				return undefined;
			}

			const userAssociatedEditors = this.getUserAssociatedEditors(notebookUri);
			const notebookEditor = userAssociatedEditors.filter(association => this.notebookService.getContributedNotebookProvider(association.viewType));

			if (userAssociatedEditors.length && !notebookEditor.length) {
				// user pick a non-notebook editor for this resource
				return undefined;
			}

			// user might pick a notebook editor

			const associatedEditors = distinct([
				...this.getUserAssociatedNotebookEditors(notebookUri),
				...(this.getContributedEditors(notebookUri).filter(editor => editor.priority === NotebookEditorPriority.default))
			], editor => editor.id);

			if (!associatedEditors.length) {
				// there is no notebook editor contribution which is enabled by default
				return undefined;
			}
		}

		const infos = this.notebookService.getContributedNotebookProviders(notebookUri);
		let info = infos.find(info => (!id || info.id === id) && info.exclusive) || infos.find(info => !id || info.id === id);

		if (!info && id !== undefined) {
			info = this.notebookService.getContributedNotebookProvider(id);
		}

		if (!info) {
			return undefined;
		}


		/**
		 * Scenario: we are reopening a file editor input which is pinned, we should open in a new editor tab.
		 */
		let index = undefined;
		if (group.activeEditor === originalInput && isEqual(originalInput.resource, notebookUri)) {
			const originalEditorIndex = group.getIndexOfEditor(originalInput);
			index = group.isPinned(originalInput) ? originalEditorIndex + 1 : originalEditorIndex;
		}

		const notebookInput = NotebookEditorInput.create(this.instantiationService, notebookUri, originalInput.getName(), info.id);
		const notebookOptions = new NotebookEditorOptions({ ...options, cellOptions, override: false, index });
		return { override: this.editorService.openEditor(notebookInput, notebookOptions, group) };
	}

	private _handleDiffEditorInput(diffEditorInput: DiffEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): IOpenEditorOverride | undefined {
		const modifiedInput = diffEditorInput.modifiedInput;
		const originalInput = diffEditorInput.originalInput;
		const notebookUri = modifiedInput.resource;
		const originalNotebookUri = originalInput.resource;

		if (!notebookUri || !originalNotebookUri) {
			return undefined;
		}

		const existingEditors = group.editors.filter(editor => editor.resource && isEqual(editor.resource, notebookUri) && !(editor instanceof NotebookEditorInput));

		if (existingEditors.length) {
			return undefined;
		}

		const userAssociatedEditors = this.getUserAssociatedEditors(notebookUri);
		const notebookEditor = userAssociatedEditors.filter(association => this.notebookService.getContributedNotebookProvider(association.viewType));

		if (userAssociatedEditors.length && !notebookEditor.length) {
			// user pick a non-notebook editor for this resource
			return undefined;
		}

		// user might pick a notebook editor

		const associatedEditors = distinct([
			...this.getUserAssociatedNotebookEditors(notebookUri),
			...(this.getContributedEditors(notebookUri).filter(editor => editor.priority === NotebookEditorPriority.default))
		], editor => editor.id);

		if (!associatedEditors.length) {
			// there is no notebook editor contribution which is enabled by default
			return undefined;
		}

		const info = associatedEditors[0];

		const notebookInput = NotebookDiffEditorInput.create(this.instantiationService, notebookUri, modifiedInput.getName(), originalNotebookUri, originalInput.getName(), diffEditorInput.getName(), info.id);
		const notebookOptions = new NotebookEditorOptions({ ...options, override: false });
		return { override: this.editorService.openEditor(notebookInput, notebookOptions, group) };
	}
}

class CellContentProvider implements ITextModelContentProvider {

	private readonly _registration: IDisposable;

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
	) {
		this._registration = textModelService.registerTextModelContentProvider(CellUri.scheme, this);
	}

	dispose(): void {
		this._registration.dispose();
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);
		if (existing) {
			return existing;
		}
		const data = CellUri.parse(resource);
		// const data = parseCellUri(resource);
		if (!data) {
			return null;
		}

		const ref = await this._notebookModelResolverService.resolve(data.notebook);
		let result: ITextModel | null = null;

		for (const cell of ref.object.notebook.cells) {
			if (cell.uri.toString() === resource.toString()) {
				const bufferFactory: ITextBufferFactory = {
					create: (defaultEOL) => {
						const newEOL = (defaultEOL === DefaultEndOfLine.CRLF ? '\r\n' : '\n');
						(cell.textBuffer as ITextBuffer).setEOL(newEOL);
						return cell.textBuffer as ITextBuffer;
					},
					getFirstLineText: (limit: number) => {
						return cell.textBuffer.getLineContent(1).substr(0, limit);
					}
				};
				const language = cell.cellKind === CellKind.Markdown ? this._modeService.create('markdown') : (cell.language ? this._modeService.create(cell.language) : this._modeService.createByFilepathOrFirstLine(resource, cell.textBuffer.getLineContent(1)));
				result = this._modelService.createModel(
					bufferFactory,
					language,
					resource
				);
				break;
			}
		}

		if (result) {
			const once = result.onWillDispose(() => {
				once.dispose();
				ref.dispose();
			});
		}

		return result;
	}
}

class RegisterSchemasContribution extends Disposable implements IWorkbenchContribution {
	constructor() {
		super();
		this.registerMetadataSchemas();
	}

	private registerMetadataSchemas(): void {
		const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
		const metadataSchema: IJSONSchema = {
			properties: {
				['language']: {
					type: 'string',
					description: 'The language for the cell'
				},
				['editable']: {
					type: 'boolean',
					description: `Controls whether a cell's editor is editable/readonly`
				},
				['runnable']: {
					type: 'boolean',
					description: 'Controls if the cell is executable'
				},
				['breakpointMargin']: {
					type: 'boolean',
					description: 'Controls if the cell has a margin to support the breakpoint UI'
				},
				['hasExecutionOrder']: {
					type: 'boolean',
					description: 'Whether the execution order indicator will be displayed'
				},
				['executionOrder']: {
					type: 'number',
					description: 'The order in which this cell was executed'
				},
				['statusMessage']: {
					type: 'string',
					description: `A status message to be shown in the cell's status bar`
				},
				['runState']: {
					type: 'integer',
					description: `The cell's current run state`
				},
				['runStartTime']: {
					type: 'number',
					description: 'If the cell is running, the time at which the cell started running'
				},
				['lastRunDuration']: {
					type: 'number',
					description: `The total duration of the cell's last run`
				},
				['inputCollapsed']: {
					type: 'boolean',
					description: `Whether a code cell's editor is collapsed`
				},
				['outputCollapsed']: {
					type: 'boolean',
					description: `Whether a code cell's outputs are collapsed`
				}
			},
			// patternProperties: allSettings.patternProperties,
			additionalProperties: true,
			allowTrailingCommas: true,
			allowComments: true
		};

		jsonRegistry.registerSchema('vscode://schemas/notebook/cellmetadata', metadataSchema);
	}
}

// makes sure that every dirty notebook gets an editor
class NotebookFileTracker implements IWorkbenchContribution {

	private readonly _dirtyListener: IDisposable;

	constructor(
		@INotebookService private readonly _notebookService: INotebookService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkingCopyService private readonly _workingCopyService: IWorkingCopyService,
	) {
		this._dirtyListener = Event.debounce(_workingCopyService.onDidChangeDirty, () => { }, 100)(() => {
			const inputs = this._createMissingNotebookEditors();
			this._editorService.openEditors(inputs);
		});
	}

	dispose(): void {
		this._dirtyListener.dispose();
	}

	private _createMissingNotebookEditors(): IResourceEditorInput[] {
		const result: IResourceEditorInput[] = [];

		for (const notebook of this._notebookService.getNotebookTextModels()) {
			if (this._workingCopyService.isDirty(notebook.uri.with({ scheme: Schemas.vscodeNotebook })) && !this._editorService.isOpen({ resource: notebook.uri })) {
				result.push({
					resource: notebook.uri,
					options: { inactive: true, preserveFocus: true, pinned: true }
				});
			}
		}
		return result;
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookContribution, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(CellContentProvider, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(RegisterSchemasContribution, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookFileTracker, LifecyclePhase.Ready);

registerSingleton(INotebookService, NotebookService);
registerSingleton(INotebookEditorWorkerService, NotebookEditorWorkerServiceImpl);
registerSingleton(INotebookEditorModelResolverService, NotebookModelResolverService, true);
registerSingleton(INotebookCellStatusBarService, NotebookCellStatusBarService, true);

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'notebook',
	order: 100,
	title: nls.localize('notebookConfigurationTitle', "Notebook"),
	type: 'object',
	properties: {
		[DisplayOrderKey]: {
			description: nls.localize('notebook.displayOrder.description', "Priority list for output mime types"),
			type: ['array'],
			items: {
				type: 'string'
			},
			default: []
		},
		[CellToolbarLocKey]: {
			description: nls.localize('notebook.cellToolbarLocation.description', "Where the cell toolbar should be shown, or whether it should be hidden."),
			type: 'string',
			enum: ['left', 'right', 'hidden'],
			default: 'right'
		},
		[ShowCellStatusBarKey]: {
			description: nls.localize('notebook.showCellStatusbar.description', "Whether the cell status bar should be shown."),
			type: 'boolean',
			default: true
		},
		[NotebookTextDiffEditorPreview]: {
			description: nls.localize('notebook.diff.enablePreview.description', "Whether to use the enhanced text diff editor for notebook."),
			type: 'boolean',
			default: true
		}
	}
});
