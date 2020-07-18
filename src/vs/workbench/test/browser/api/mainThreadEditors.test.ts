/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MainThreadDocumentsAndEditors } from 'vs/workbench/api/browser/mainThreadDocumentsAndEditors';
import { SingleProxyRPCProtocol, TestRPCProtocol } from './testRPCProtocol';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { TestCodeEditorService } from 'vs/editor/test/browser/editorTestServices';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ExtHostDocumentsAndEditorsShape, ExtHostContext, ExtHostDocumentsShape, IWorkspaceTextEditDto } from 'vs/workbench/api/common/extHost.protocol';
import { mock } from 'vs/base/test/common/mock';
import { Event } from 'vs/base/common/event';
import { MainThreadTextEditors } from 'vs/workbench/api/browser/mainThreadEditors';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { Position } from 'vs/editor/common/core/position';
import { IModelService } from 'vs/editor/common/services/modelService';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { TestFileService, TestEditorService, TestEditorGroupsService, TestEnvironmentService } from 'vs/workbench/test/browser/workbenchTestServices';
import { BulkEditService } from 'vs/workbench/services/bulkEdit/browser/bulkEditService';
import { NullLogService, ILogService } from 'vs/platform/log/common/log';
import { ITextModelService, IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { IReference, ImmortalReference } from 'vs/base/common/lifecycle';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IFileService } from 'vs/platform/files/common/files';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILabelService } from 'vs/platform/label/common/label';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TestTextResourcePropertiesService, TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { extUri } from 'vs/base/common/resources';

suite('MainThreadEditors', () => {

	const resource = URI.parse('foo:bar');

	let modelService: IModelService;
	let editors: MainThreadTextEditors;

	const movedResources = new Map<URI, URI>();
	const copiedResources = new Map<URI, URI>();
	const createdResources = new Set<URI>();
	const deletedResources = new Set<URI>();

	setup(() => {

		movedResources.clear();
		copiedResources.clear();
		createdResources.clear();
		deletedResources.clear();


		const configService = new TestConfigurationService();
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		modelService = new ModelServiceImpl(configService, new TestTextResourcePropertiesService(configService), new TestThemeService(), new NullLogService(), undoRedoService);


		const services = new ServiceCollection();
		services.set(IBulkEditService, new SyncDescriptor(BulkEditService));
		services.set(ILabelService, new SyncDescriptor(LabelService));
		services.set(ILogService, new NullLogService());
		services.set(IWorkspaceContextService, new TestContextService());
		services.set(IWorkbenchEnvironmentService, TestEnvironmentService);
		services.set(IConfigurationService, configService);
		services.set(IDialogService, dialogService);
		services.set(INotificationService, notificationService);
		services.set(IUndoRedoService, undoRedoService);
		services.set(IModelService, modelService);
		services.set(ICodeEditorService, new TestCodeEditorService());
		services.set(IFileService, new TestFileService());
		services.set(IEditorService, new TestEditorService());
		services.set(IEditorGroupsService, new TestEditorGroupsService());
		services.set(ITextFileService, new class extends mock<ITextFileService>() {
			isDirty() { return false; }
			files = <any>{
				onDidSave: Event.None,
				onDidRevert: Event.None,
				onDidChangeDirty: Event.None
			};
		});
		services.set(IWorkingCopyFileService, new class extends mock<IWorkingCopyFileService>() {
			onDidRunWorkingCopyFileOperation = Event.None;
			create(resource: URI) {
				createdResources.add(resource);
				return Promise.resolve(Object.create(null));
			}
			move(files: { source: URI, target: URI }[]) {
				const { source, target } = files[0];
				movedResources.set(source, target);
				return Promise.resolve(Object.create(null));
			}
			copy(files: { source: URI, target: URI }[]) {
				const { source, target } = files[0];
				copiedResources.set(source, target);
				return Promise.resolve(Object.create(null));
			}
			delete(resources: URI[]) {
				for (const resource of resources) {
					deletedResources.add(resource);
				}
				return Promise.resolve(undefined);
			}
		});
		services.set(ITextModelService, new class extends mock<ITextModelService>() {
			createModelReference(resource: URI): Promise<IReference<IResolvedTextEditorModel>> {
				const textEditorModel = new class extends mock<IResolvedTextEditorModel>() {
					textEditorModel = modelService.getModel(resource)!;
				};
				textEditorModel.isReadonly = () => false;
				return Promise.resolve(new ImmortalReference(textEditorModel));
			}
		});
		services.set(IEditorWorkerService, new class extends mock<IEditorWorkerService>() {

		});
		services.set(IPanelService, new class extends mock<IPanelService>() implements IPanelService {
			declare readonly _serviceBrand: undefined;
			onDidPanelOpen = Event.None;
			onDidPanelClose = Event.None;
			getActivePanel() {
				return undefined;
			}
		});
		services.set(IUriIdentityService, new class extends mock<IUriIdentityService>() {
			get extUri() { return extUri; }
		});

		const instaService = new InstantiationService(services);

		const rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(ExtHostContext.ExtHostDocuments, new class extends mock<ExtHostDocumentsShape>() {
			$acceptModelChanged(): void {
			}
		});
		rpcProtocol.set(ExtHostContext.ExtHostDocumentsAndEditors, new class extends mock<ExtHostDocumentsAndEditorsShape>() {
			$acceptDocumentsAndEditorsDelta(): void {
			}
		});

		const documentAndEditor = instaService.createInstance(MainThreadDocumentsAndEditors, rpcProtocol);

		editors = instaService.createInstance(MainThreadTextEditors, documentAndEditor, SingleProxyRPCProtocol(null));
	});

	test(`applyWorkspaceEdit returns false if model is changed by user`, () => {

		let model = modelService.createModel('something', null, resource);

		let workspaceResourceEdit: IWorkspaceTextEditDto = {
			resource: resource,
			modelVersionId: model.getVersionId(),
			edit: {
				text: 'asdfg',
				range: new Range(1, 1, 1, 1)
			}
		};

		// Act as if the user edited the model
		model.applyEdits([EditOperation.insert(new Position(0, 0), 'something')]);

		return editors.$tryApplyWorkspaceEdit({ edits: [workspaceResourceEdit] }).then((result) => {
			assert.equal(result, false);
		});
	});

	test(`issue #54773: applyWorkspaceEdit checks model version in race situation`, () => {

		let model = modelService.createModel('something', null, resource);

		let workspaceResourceEdit1: IWorkspaceTextEditDto = {
			resource: resource,
			modelVersionId: model.getVersionId(),
			edit: {
				text: 'asdfg',
				range: new Range(1, 1, 1, 1)
			}
		};
		let workspaceResourceEdit2: IWorkspaceTextEditDto = {
			resource: resource,
			modelVersionId: model.getVersionId(),
			edit: {
				text: 'asdfg',
				range: new Range(1, 1, 1, 1)
			}
		};

		let p1 = editors.$tryApplyWorkspaceEdit({ edits: [workspaceResourceEdit1] }).then((result) => {
			// first edit request succeeds
			assert.equal(result, true);
		});
		let p2 = editors.$tryApplyWorkspaceEdit({ edits: [workspaceResourceEdit2] }).then((result) => {
			// second edit request fails
			assert.equal(result, false);
		});
		return Promise.all([p1, p2]);
	});

	test(`applyWorkspaceEdit with only resource edit`, () => {
		return editors.$tryApplyWorkspaceEdit({
			edits: [
				{ oldUri: resource, newUri: resource, options: undefined },
				{ oldUri: undefined, newUri: resource, options: undefined },
				{ oldUri: resource, newUri: undefined, options: undefined }
			]
		}).then((result) => {
			assert.equal(result, true);
			assert.equal(movedResources.get(resource), resource);
			assert.equal(createdResources.has(resource), true);
			assert.equal(deletedResources.has(resource), true);
		});
	});
});
