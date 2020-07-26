/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Event } from 'vs/base/common/event';
import {
	INotebookTextModel, INotebookRendererInfo, INotebookKernelInfo, INotebookKernelInfoDto,
	IEditor, ICellEditOperation, NotebookCellOutputsSplice, IOrderedMimeType, IProcessedOutput, INotebookKernelProvider, INotebookKernelInfo2
} from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { IDisposable } from 'vs/base/common/lifecycle';


export const INotebookService = createDecorator<INotebookService>('notebookService');

export interface IMainNotebookController {
	kernel: INotebookKernelInfoDto | undefined;
	supportBackup: boolean;
	createNotebook(textModel: NotebookTextModel, editorId?: string, backupId?: string): Promise<void>;
	reloadNotebook(mainthreadTextModel: NotebookTextModel): Promise<void>;
	resolveNotebookEditor(viewType: string, uri: URI, editorId: string): Promise<void>;
	executeNotebookByAttachedKernel(viewType: string, uri: URI): Promise<void>;
	cancelNotebookByAttachedKernel(viewType: string, uri: URI): Promise<void>;
	onDidReceiveMessage(editorId: string, rendererType: string | undefined, message: any): void;
	executeNotebookCell(uri: URI, handle: number): Promise<void>;
	cancelNotebookCell(uri: URI, handle: number): Promise<void>;
	removeNotebookDocument(uri: URI): Promise<void>;
	save(uri: URI, token: CancellationToken): Promise<boolean>;
	saveAs(uri: URI, target: URI, token: CancellationToken): Promise<boolean>;
	backup(uri: URI, token: CancellationToken): Promise<string | undefined>;
}

export interface INotebookService {
	readonly _serviceBrand: undefined;
	canResolve(viewType: string): Promise<boolean>;
	onDidChangeActiveEditor: Event<string | null>;
	onDidChangeVisibleEditors: Event<string[]>;
	onNotebookEditorAdd: Event<IEditor>;
	onNotebookEditorsRemove: Event<IEditor[]>;
	onNotebookDocumentRemove: Event<URI[]>;
	onNotebookDocumentAdd: Event<URI[]>;
	onDidChangeKernels: Event<void>;
	onDidChangeNotebookActiveKernel: Event<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }>;
	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController): void;
	unregisterNotebookProvider(viewType: string): void;
	registerNotebookRenderer(id: string, renderer: INotebookRendererInfo): void;
	unregisterNotebookRenderer(id: string): void;
	transformEditsOutputs(textModel: NotebookTextModel, edits: ICellEditOperation[]): Promise<void>;
	transformSpliceOutputs(textModel: NotebookTextModel, splices: NotebookCellOutputsSplice[]): Promise<void>;
	transformSingleOutput(textModel: NotebookTextModel, output: IProcessedOutput, rendererId: string, mimeType: string): Promise<IOrderedMimeType | undefined>;
	registerNotebookKernel(kernel: INotebookKernelInfo): void;
	unregisterNotebookKernel(id: string): void;
	registerNotebookKernelProvider(provider: INotebookKernelProvider): IDisposable;
	getContributedNotebookKernels(viewType: string, resource: URI): readonly INotebookKernelInfo[];
	getContributedNotebookKernels2(viewType: string, resource: URI, token: CancellationToken): Promise<INotebookKernelInfo2[]>;
	getRendererInfo(id: string): INotebookRendererInfo | undefined;
	resolveNotebook(viewType: string, uri: URI, forceReload: boolean, editorId?: string, backupId?: string): Promise<NotebookTextModel | undefined>;
	getNotebookTextModel(uri: URI): NotebookTextModel | undefined;
	executeNotebook(viewType: string, uri: URI): Promise<void>;
	cancelNotebook(viewType: string, uri: URI): Promise<void>;
	executeNotebookCell(viewType: string, uri: URI, handle: number): Promise<void>;
	cancelNotebookCell(viewType: string, uri: URI, handle: number): Promise<void>;
	executeNotebook2(viewType: string, uri: URI, kernelId: string): Promise<void>;
	executeNotebookCell2(viewType: string, uri: URI, handle: number, kernelId: string): Promise<void>;
	getContributedNotebookProviders(resource: URI): readonly NotebookProviderInfo[];
	getContributedNotebookProvider(viewType: string): NotebookProviderInfo | undefined;
	getNotebookProviderResourceRoots(): URI[];
	destoryNotebookDocument(viewType: string, notebook: INotebookTextModel): void;
	updateActiveNotebookEditor(editor: IEditor | null): void;
	updateVisibleNotebookEditor(editors: string[]): void;
	save(viewType: string, resource: URI, token: CancellationToken): Promise<boolean>;
	saveAs(viewType: string, resource: URI, target: URI, token: CancellationToken): Promise<boolean>;
	backup(viewType: string, uri: URI, token: CancellationToken): Promise<string | undefined>;
	onDidReceiveMessage(viewType: string, editorId: string, rendererType: string | undefined, message: unknown): void;
	setToCopy(items: NotebookCellTextModel[], isCopy: boolean): void;
	getToCopy(): { items: NotebookCellTextModel[], isCopy: boolean; } | undefined;

	// editor events
	addNotebookEditor(editor: IEditor): void;
	removeNotebookEditor(editor: IEditor): void;
	getNotebookEditor(editorId: string): IEditor | undefined;
	listNotebookEditors(): readonly IEditor[];
	listVisibleNotebookEditors(): readonly IEditor[];
	listNotebookDocuments(): readonly NotebookTextModel[];

}
