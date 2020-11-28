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
	INotebookTextModel, INotebookRendererInfo,
	IEditor, INotebookKernelProvider, INotebookKernelInfo2, TransientMetadata, NotebookDataDto, TransientOptions, INotebookDecorationRenderOptions, INotebookExclusiveDocumentFilter, IOrderedMimeType, ITransformedDisplayOutputDto
} from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { IRelativePattern } from 'vs/base/common/glob';


export const INotebookService = createDecorator<INotebookService>('notebookService');

export interface IMainNotebookController {
	supportBackup: boolean;
	viewOptions?: { displayName: string; filenamePattern: (string | IRelativePattern | INotebookExclusiveDocumentFilter)[]; exclusive: boolean; };
	options: { transientOutputs: boolean; transientMetadata: TransientMetadata; };
	resolveNotebookDocument(viewType: string, uri: URI, backupId?: string): Promise<{ data: NotebookDataDto, transientOptions: TransientOptions }>;
	reloadNotebook(mainthreadTextModel: NotebookTextModel): Promise<void>;
	resolveNotebookEditor(viewType: string, uri: URI, editorId: string): Promise<void>;
	onDidReceiveMessage(editorId: string, rendererType: string | undefined, message: any): void;
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
	onDidRemoveNotebookDocument: Event<URI>;
	onDidAddNotebookDocument: Event<NotebookTextModel>;
	onNotebookDocumentSaved: Event<URI>;
	onDidChangeKernels: Event<URI | undefined>;
	onDidChangeNotebookActiveKernel: Event<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }>;
	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController): IDisposable;

	getMimeTypeInfo(textModel: NotebookTextModel, output: ITransformedDisplayOutputDto): readonly IOrderedMimeType[];

	registerNotebookKernelProvider(provider: INotebookKernelProvider): IDisposable;
	getContributedNotebookKernels(viewType: string, resource: URI, token: CancellationToken): Promise<INotebookKernelInfo2[]>;
	getContributedNotebookOutputRenderers(id: string): NotebookOutputRendererInfo | undefined;
	getRendererInfo(id: string): INotebookRendererInfo | undefined;

	resolveNotebook(viewType: string, uri: URI, forceReload: boolean, backupId?: string): Promise<NotebookTextModel>;
	getNotebookTextModel(uri: URI): NotebookTextModel | undefined;
	getNotebookTextModels(): Iterable<NotebookTextModel>;
	getContributedNotebookProviders(resource?: URI): readonly NotebookProviderInfo[];
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
	resolveNotebookEditor(viewType: string, uri: URI, editorId: string): Promise<void>;
	addNotebookEditor(editor: IEditor): void;
	removeNotebookEditor(editor: IEditor): void;
	getNotebookEditor(editorId: string): IEditor | undefined;
	listNotebookEditors(): readonly IEditor[];
	listVisibleNotebookEditors(): readonly IEditor[];
	listNotebookDocuments(): readonly NotebookTextModel[];
	registerEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void;
	removeEditorDecorationType(key: string): void;
	resolveEditorDecorationOptions(key: string): INotebookDecorationRenderOptions | undefined;
}
