/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, IEditorRegistry } from 'vs/workbench/browser/editor';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IEditorInputSerializer as IEditorInputSerializer, IEditorInputFactoryRegistry, EditorExtensions } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor2/browser/searchEditor';
import { SearchEditorInput } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorInput';
import { ISearchEditorService, SearchEditorService } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorService';
import { ContributedEditorPriority, DEFAULT_EDITOR_ASSOCIATION, IEditorOverrideService } from 'vs/workbench/services/editor/common/editorOverrideService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IWorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';

// --- Search Editor Pane

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		SearchEditor,
		SearchEditor.ID,
		'Search Editor2'
	),
	[
		new SyncDescriptor(SearchEditorInput)
	]
);

// --- Search Editor Input Serializer

class SearchEditorInputSerializer implements IEditorInputSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof SearchEditorInput;
	}

	serialize(editorInput: SearchEditorInput): string {
		return editorInput.resource.toString();
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): SearchEditorInput {
		return instantiationService.createInstance(SearchEditorInput, URI.parse(serializedEditorInput));
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(SearchEditorInput.TYPE_ID, SearchEditorInputSerializer);

// --- Search Editor Override

class SearchEditorOverride implements IWorkbenchContribution {

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorOverrideService editorOverrideService: IEditorOverrideService
	) {
		editorOverrideService.registerEditor(
			'*',
			{
				id: SearchEditorInput.OVERRIDE_ID,
				priority: ContributedEditorPriority.option,
				label: 'Search Editor2',
				detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
			},
			{
				canHandleDiff: false
			},
			resource => ({ editor: instantiationService.createInstance(SearchEditorInput, resource) })
		);
	}
}

// --- Working Copy Editor Handler

export class SearchWorkingCopyEditorHandler implements IWorkbenchContribution {

	constructor(
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		workingCopyEditorService.registerHandler({
			handles: workingCopy => workingCopy.typeId === 'searchWorkingCopy',
			isOpen: (workingCopy, editor) => editor instanceof SearchEditorInput && isEqual(workingCopy.resource, editor.resource),
			createEditor: workingCopy => instantiationService.createInstance(SearchEditorInput, workingCopy.resource)
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SearchEditorOverride, LifecyclePhase.Starting);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SearchWorkingCopyEditorHandler, LifecyclePhase.Starting);

// --- Search Editor Service
registerSingleton(ISearchEditorService, SearchEditorService);

// --- Open Untitled Search Editor
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'searchEditor.newUntitled',
			title: { value: localize('searchEditor.newUntitled', "New Untitled Search Editor"), original: 'New Untitled Search Editor' },
			f1: true
		});
	}
	async run(accessor: ServicesAccessor) {
		const searchEditorService = accessor.get(ISearchEditorService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		const untitledSearchEditorWorkingCopy = await searchEditorService.manager.resolve();

		const untitledSearchEditorInput = instantiationService.createInstance(SearchEditorInput, untitledSearchEditorWorkingCopy.resource);
		return editorService.openEditor(untitledSearchEditorInput);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'searchEditor.newUntitledWithPath',
			title: { value: localize('searchEditor.newUntitledWithPath', "New Untitled Search Editor With Associated Path"), original: 'New Untitled Search Editor With Associated Path' },
			f1: true
		});
	}
	async run(accessor: ServicesAccessor) {
		const searchEditorService = accessor.get(ISearchEditorService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const fileDialogService = accessor.get(IFileDialogService);

		const target = await fileDialogService.pickFileToSave(await fileDialogService.defaultFilePath());
		if (!target) {
			return;
		}

		const untitledSearchEditorWorkingCopy = await searchEditorService.manager.resolve({ associatedResource: { path: target?.path } });

		const untitledSearchEditorInput = instantiationService.createInstance(SearchEditorInput, untitledSearchEditorWorkingCopy.resource);
		return editorService.openEditor(untitledSearchEditorInput);
	}
});
