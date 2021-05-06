/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Event } from 'vs/base/common/event';
import { INotebookRendererInfo, NotebookDataDto, TransientOptions, INotebookExclusiveDocumentFilter, IOrderedMimeType, IOutputDto, INotebookMarkupRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IRelativePattern } from 'vs/base/common/glob';
import { VSBuffer } from 'vs/base/common/buffer';


export const INotebookService = createDecorator<INotebookService>('notebookService');

export interface INotebookContentProvider {
	viewOptions?: { displayName: string; filenamePattern: (string | IRelativePattern | INotebookExclusiveDocumentFilter)[]; exclusive: boolean; };
	options: TransientOptions;

	open(uri: URI, backupId: string | undefined, untitledDocumentData: VSBuffer | undefined, token: CancellationToken): Promise<{ data: NotebookDataDto, transientOptions: TransientOptions; }>;
	save(uri: URI, token: CancellationToken): Promise<boolean>;
	saveAs(uri: URI, target: URI, token: CancellationToken): Promise<boolean>;
	backup(uri: URI, token: CancellationToken): Promise<string>;
}

export interface INotebookSerializer {
	options: TransientOptions;
	dataToNotebook(data: VSBuffer): Promise<NotebookDataDto>
	notebookToData(data: NotebookDataDto): Promise<VSBuffer>;
}

export interface INotebookRawData {
	data: NotebookDataDto;
	transientOptions: TransientOptions;
}

export class ComplexNotebookProviderInfo {
	constructor(
		readonly viewType: string,
		readonly controller: INotebookContentProvider,
		readonly extensionData: NotebookExtensionDescription
	) { }
}

export class SimpleNotebookProviderInfo {
	constructor(
		readonly viewType: string,
		readonly serializer: INotebookSerializer,
		readonly extensionData: NotebookExtensionDescription
	) { }
}

export interface INotebookService {
	readonly _serviceBrand: undefined;
	canResolve(viewType: string): Promise<boolean>;

	readonly onWillRemoveViewType: Event<string>;
	readonly onDidCreateNotebookDocument: Event<NotebookTextModel>;
	readonly onDidAddNotebookDocument: Event<NotebookTextModel>;
	readonly onDidRemoveNotebookDocument: Event<NotebookTextModel>;

	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: INotebookContentProvider): IDisposable;
	registerNotebookSerializer(viewType: string, extensionData: NotebookExtensionDescription, serializer: INotebookSerializer): IDisposable;
	withNotebookDataProvider(resource: URI, viewType?: string): Promise<ComplexNotebookProviderInfo | SimpleNotebookProviderInfo>;

	getMimeTypeInfo(textModel: NotebookTextModel, kernelProvides: readonly string[] | undefined, output: IOutputDto): readonly IOrderedMimeType[];

	getRendererInfo(id: string): INotebookRendererInfo | undefined;
	getMarkupRendererInfo(): INotebookMarkupRendererInfo[];

	/** Updates the preferred renderer for the given mimetype in the workspace. */
	updateMimePreferredRenderer(mimeType: string, rendererId: string): void;

	createNotebookTextModel(viewType: string, uri: URI, data: NotebookDataDto, transientOptions: TransientOptions): NotebookTextModel;
	getNotebookTextModel(uri: URI): NotebookTextModel | undefined;
	getNotebookTextModels(): Iterable<NotebookTextModel>;
	listNotebookDocuments(): readonly NotebookTextModel[];

	getContributedNotebookProviders(resource?: URI): readonly NotebookProviderInfo[];
	getContributedNotebookProvider(viewType: string): NotebookProviderInfo | undefined;
	getNotebookProviderResourceRoots(): URI[];

	setToCopy(items: NotebookCellTextModel[], isCopy: boolean): void;
	getToCopy(): { items: NotebookCellTextModel[], isCopy: boolean; } | undefined;
}
