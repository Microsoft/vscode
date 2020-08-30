/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Event } from 'vs/base/common/event';
import {
	INotebookTextModel, INotebookRendererInfo, INotebookKernelInfo,
	IEditor, ICellEditOperation, NotebookCellOutputsSplice, INotebookKernelProvider, INotebookKernelInfo2, TransientMetadata
} from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';


export const INotebookService = createDecorator<INotebookService>('notebookService');

export interface IMainNotebookController {
	supportBackup: boolean;
	options: { transientOutputs: boolean; transientMetadata: TransientMetadata; };
	createNotebook(textModel: NotebookTextModel, editorId?: string, backupId?: string): Promise<void>;
	reloadNotebook(mainthreadTextModel: NotebookTextModel): Promise<void>;
	resolveNotebookEditor(viewType: string, uri: URI, editorId: string): Promise<void>;
	onDidReceiveMessage(editorId: string, rendererType: string | undefined, message: any): void;
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
	onNotebookDocumentSaved: Event<URI>;
	onDidChangeKernels: Event<void>;
	onDidChangeNotebookActiveKernel: Event<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }>;
	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController): void;
	unregisterNotebookProvider(viewType: string): void;
	transformEditsOutputs(textModel: NotebookTextModel, edits: ICellEditOperation[]): void;
	transformSpliceOutputs(textModel: NotebookTextModel, splices: NotebookCellOutputsSplice[]): void;
	registerNotebookKernel(kernel: INotebookKernelInfo): void;
	unregisterNotebookKernel(id: string): void;
	registerNotebookKernelProvider(provider: INotebookKernelProvider): IDisposable;
	getContributedNotebookKernels(viewType: string, resource: URI): readonly INotebookKernelInfo[];
	getContributedNotebookKernels2(viewType: string, resource: URI, token: CancellationToken): Promise<INotebookKernelInfo2[]>;
	getContributedNotebookOutputRenderers(id: string): NotebookOutputRendererInfo | undefined;
	getRendererInfo(id: string): INotebookRendererInfo | undefined;

	resolveNotebook(viewType: string, uri: URI, forceReload: boolean, editorId?: string, backupId?: string): Promise<NotebookTextModel | undefined>;
	getNotebookTextModel(uri: URI): NotebookTextModel | undefined;
	getNotebookTextModels(): Iterable<NotebookTextModel>;
	executeNotebook(viewType: string, uri: URI, kernelId: string): Promise<void>;
	executeNotebookCell(viewType: string, uri: URI, handle: number, kernelId: string): Promise<void>;
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
