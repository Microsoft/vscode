/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { parse } from 'vs/base/common/marshalling';
import { basename, isEqual } from 'vs/base/common/resources';
import { assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ITextModel, ITextBufferFactory, DefaultEndOfLine, ITextBuffer } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import * as nls from 'vs/nls';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { EditorInput, Extensions as EditorInputExtensions, IEditorInput, IEditorInputFactory, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { NotebookEditor, NotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookService } from 'vs/workbench/contrib/notebook/browser/notebookServiceImpl';
import { CellKind, CellUri } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, IOpenEditorOverride } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CustomEditorsAssociations, customEditorsAssociationsSettingId } from 'vs/workbench/services/editor/common/editorAssociationsSetting';
import { coalesce, distinct } from 'vs/base/common/arrays';
import { CustomEditorInfo } from 'vs/workbench/contrib/customEditor/common/customEditor';

// Editor Contribution

import 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import 'vs/workbench/contrib/notebook/browser/contrib/find/findController';
import 'vs/workbench/contrib/notebook/browser/contrib/fold/folding';
import 'vs/workbench/contrib/notebook/browser/contrib/format/formatting';
import 'vs/workbench/contrib/notebook/browser/contrib/toc/tocProvider';

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

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(
	NotebookEditorInput.ID,
	class implements IEditorInputFactory {
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
			type Data = { resource: URI, name: string, viewType: string };
			const data = <Data>parse(raw);
			if (!data) {
				return undefined;
			}
			const { resource, name, viewType } = data;
			if (!data || !URI.isUri(resource) || typeof name !== 'string' || typeof viewType !== 'string') {
				return undefined;
			}
			return NotebookEditorInput.getOrCreate(instantiationService, resource, name, viewType);
		}
	}
);

function getFirstNotebookInfo(notebookService: INotebookService, uri: URI): NotebookProviderInfo | undefined {
	return notebookService.getContributedNotebookProviders(uri)[0];
}

export class NotebookContribution implements IWorkbenchContribution {
	private _resourceMapping = new ResourceMap<NotebookEditorInput>();

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@INotebookService private readonly notebookService: INotebookService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService

	) {
		this.editorService.overrideOpenEditor({
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
			open: (editor, options, group, id) => this.onEditorOpening(editor, options, group, id)
		});

		this.editorService.onDidActiveEditorChange(() => {
			if (this.editorService.activeEditor && this.editorService.activeEditor! instanceof NotebookEditorInput) {
				let editorInput = this.editorService.activeEditor! as NotebookEditorInput;
				this.notebookService.updateActiveNotebookDocument(editorInput.viewType!, editorInput.resource!);
			}
		});
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

	private onEditorOpening(originalInput: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup, id: string | undefined): IOpenEditorOverride | undefined {
		let resource = originalInput.resource;
		if (!resource) {
			return undefined;
		}

		if (id === undefined) {
			const existingEditors = group.editors.filter(editor => editor.resource && isEqual(editor.resource, resource) && !(editor instanceof NotebookEditorInput));

			if (existingEditors.length) {
				return undefined;
			}

			const userAssociatedEditors = this.getUserAssociatedEditors(resource);
			const notebookEditor = userAssociatedEditors.filter(association => this.notebookService.getContributedNotebookProvider(association.viewType));

			if (userAssociatedEditors.length && !notebookEditor.length) {
				// user pick a non-notebook editor for this resource
				return undefined;
			}
		}

		if (this._resourceMapping.has(resource)) {
			const input = this._resourceMapping.get(resource);

			if (!input!.isDisposed()) {
				return { override: this.editorService.openEditor(input!, new NotebookEditorOptions(options || {}).with({ ignoreOverrides: true }), group) };
			}
		}

		let info: NotebookProviderInfo | undefined;
		const data = CellUri.parse(resource);
		if (data) {
			const infos = this.getContributedEditors(data.notebook);

			if (infos.length) {
				const info = id === undefined ? infos[0] : (infos.find(info => info.id === id) || infos[0]);
				// cell-uri -> open (container) notebook
				const name = basename(data.notebook);
				let input = this._resourceMapping.get(data.notebook);
				if (!input || input.isDisposed()) {
					input = NotebookEditorInput.getOrCreate(this.instantiationService, data.notebook, name, info.id);
					this._resourceMapping.set(data.notebook, input);
				}
				return { override: this.editorService.openEditor(input, new NotebookEditorOptions({ ...options, forceReload: true, cellOptions: { resource, options } }), group) };
			}
		}

		const infos = this.notebookService.getContributedNotebookProviders(resource);
		info = id === undefined ? infos[0] : infos.find(info => info.id === id);

		if (!info) {
			return undefined;
		}

		const input = NotebookEditorInput.getOrCreate(this.instantiationService, resource, originalInput.getName(), info.id);
		this._resourceMapping.set(resource, input);

		return { override: this.editorService.openEditor(input, options, group) };
	}
}

class CellContentProvider implements ITextModelContentProvider {

	private readonly _registration: IDisposable;

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		this._registration = textModelService.registerTextModelContentProvider('vscode-notebook', this);
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
		const info = getFirstNotebookInfo(this._notebookService, data.notebook);
		if (!info) {
			return null;
		}

		const editorModel = await this._notebookService.modelManager.get(data.notebook);
		if (!editorModel) {
			return null;
		}

		for (let cell of editorModel.notebook.cells) {
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
				return this._modelService.createModel(
					bufferFactory,
					language,
					resource
				);
			}
		}

		return null;
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookContribution, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(CellContentProvider, LifecyclePhase.Starting);

registerSingleton(INotebookService, NotebookService);

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'notebook',
	order: 100,
	title: nls.localize('notebookConfigurationTitle', "Notebook"),
	type: 'object',
	properties: {
		'notebook.displayOrder': {
			markdownDescription: nls.localize('notebook.displayOrder.description', "Priority list for output mime types"),
			type: ['array'],
			items: {
				type: 'string'
			},
			default: []
		}
	}
});
