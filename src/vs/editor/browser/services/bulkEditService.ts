/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { WorkspaceEdit } from 'vs/editor/common/modes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';
import { IDisposable } from 'vs/base/common/lifecycle';

export const IBulkEditService = createDecorator<IBulkEditService>('IWorkspaceEditService');

export interface IBulkEditOptions {
	editor?: ICodeEditor;
	progress?: IProgress<IProgressStep>;
	showPreview?: boolean;
	label?: string;
	quotableLabel?: string;
}

export interface IBulkEditResult {
	ariaSummary: string;
}

export type IBulkEditPreviewHandler = (edit: WorkspaceEdit, options?: IBulkEditOptions) => Promise<WorkspaceEdit>;

export interface IBulkEditService {
	readonly _serviceBrand: undefined;

	hasPreviewHandler(): boolean;

	setPreviewHandler(handler: IBulkEditPreviewHandler): IDisposable;

	apply(edit: WorkspaceEdit, options?: IBulkEditOptions): Promise<IBulkEditResult>;
}

