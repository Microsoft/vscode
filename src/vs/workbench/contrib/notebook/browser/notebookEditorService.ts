/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { createDecorator, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { Event } from 'vs/base/common/event';
import { INotebookDecorationRenderOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export const INotebookEditorService = createDecorator<INotebookEditorService>('INotebookEditorWidgetService');

export interface IBorrowValue<T> {
	readonly value: T | undefined;
}

export interface INotebookEditorService {
	_serviceBrand: undefined;

	retrieveWidget(accessor: ServicesAccessor, group: IEditorGroup, input: NotebookEditorInput): IBorrowValue<NotebookEditorWidget>;

	onDidAddNotebookEditor: Event<INotebookEditor>;
	onDidRemoveNotebookEditor: Event<INotebookEditor>;
	addNotebookEditor(editor: INotebookEditor): void;
	removeNotebookEditor(editor: INotebookEditor): void;
	getNotebookEditor(editorId: string): INotebookEditor | undefined;
	listNotebookEditors(): readonly INotebookEditor[];

	registerEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void;
	removeEditorDecorationType(key: string): void;
	resolveEditorDecorationOptions(key: string): INotebookDecorationRenderOptions | undefined;
}
