/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Event } from 'vs/base/common/event';
import { INotebookTextModel, INotebookMimeTypeSelector, INotebookRendererInfo, NotebookDocumentMetadata, ICellDto2 } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookEditorModelManager } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';

export const INotebookService = createDecorator<INotebookService>('notebookService');

export interface IMainNotebookController {
	createNotebook(viewType: string, uri: URI, forBackup: boolean, forceReload: boolean): Promise<NotebookTextModel | undefined>;
	executeNotebook(viewType: string, uri: URI, token: CancellationToken): Promise<void>;
	onDidReceiveMessage(uri: URI, message: any): void;
	executeNotebookCell(uri: URI, handle: number, token: CancellationToken): Promise<void>;
	removeNotebookDocument(notebook: INotebookTextModel): Promise<void>;
	save(uri: URI, token: CancellationToken): Promise<boolean>;
	saveAs(uri: URI, target: URI, token: CancellationToken): Promise<boolean>;
}

export interface INotebookService {
	_serviceBrand: undefined;
	modelManager: INotebookEditorModelManager;
	canResolve(viewType: string): Promise<boolean>;
	onDidChangeActiveEditor: Event<{ viewType: string, uri: URI }>;
	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController): void;
	unregisterNotebookProvider(viewType: string): void;
	registerNotebookRenderer(handle: number, extensionData: NotebookExtensionDescription, type: string, selectors: INotebookMimeTypeSelector, preloads: URI[]): void;
	unregisterNotebookRenderer(handle: number): void;
	getRendererInfo(handle: number): INotebookRendererInfo | undefined;
	resolveNotebook(viewType: string, uri: URI, forceReload: boolean): Promise<NotebookTextModel | undefined>;
	createNotebookFromBackup(viewType: string, uri: URI, metadata: NotebookDocumentMetadata, languages: string[], cells: ICellDto2[]): Promise<NotebookTextModel | undefined>;
	executeNotebook(viewType: string, uri: URI): Promise<void>;
	executeNotebookCell(viewType: string, uri: URI, handle: number, token: CancellationToken): Promise<void>;

	getContributedNotebookProviders(resource: URI): readonly NotebookProviderInfo[];
	getContributedNotebookProvider(viewType: string): NotebookProviderInfo | undefined;
	getNotebookProviderResourceRoots(): URI[];
	destoryNotebookDocument(viewType: string, notebook: INotebookTextModel): void;
	updateActiveNotebookDocument(viewType: string, resource: URI): void;
	save(viewType: string, resource: URI, token: CancellationToken): Promise<boolean>;
	saveAs(viewType: string, resource: URI, target: URI, token: CancellationToken): Promise<boolean>;
	onDidReceiveMessage(viewType: string, uri: URI, message: any): void;
	setToCopy(items: NotebookCellTextModel[]): void;
	getToCopy(): NotebookCellTextModel[] | undefined;
}
