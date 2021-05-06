/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { TextEdit, WorkspaceEdit, WorkspaceEditMetadata, WorkspaceFileEdit, WorkspaceFileEditOptions, WorkspaceTextEdit } from 'vs/editor/common/modes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { isObject } from 'vs/base/common/types';
import { UndoRedoSource } from 'vs/platform/undoRedo/common/undoRedo';
import { CancellationToken } from 'vs/base/common/cancellation';

export const IBulkEditService = createDecorator<IBulkEditService>('IWorkspaceEditService');

function isWorkspaceFileEdit(thing: any): thing is WorkspaceFileEdit {
	return isObject(thing) && (Boolean((<WorkspaceFileEdit>thing).newUri) || Boolean((<WorkspaceFileEdit>thing).oldUri));
}

function isWorkspaceTextEdit(thing: any): thing is WorkspaceTextEdit {
	return isObject(thing) && URI.isUri((<WorkspaceTextEdit>thing).resource) && isObject((<WorkspaceTextEdit>thing).edit);
}

export class ResourceEdit {

	protected constructor(readonly metadata?: WorkspaceEditMetadata) { }

	static convert(edit: WorkspaceEdit): ResourceEdit[] {


		return edit.edits.map(edit => {
			if (isWorkspaceTextEdit(edit)) {
				return new ResourceTextEdit(edit.resource, edit.edit, edit.modelVersionId, edit.metadata);
			}
			if (isWorkspaceFileEdit(edit)) {
				return new ResourceFileEdit(edit.oldUri, edit.newUri, edit.options, edit.metadata);
			}
			throw new Error('Unsupported edit');
		});
	}
}

export class ResourceTextEdit extends ResourceEdit {
	constructor(
		readonly resource: URI,
		readonly textEdit: TextEdit,
		readonly versionId?: number,
		metadata?: WorkspaceEditMetadata
	) {
		super(metadata);
	}
}

export class ResourceFileEdit extends ResourceEdit {
	constructor(
		readonly oldResource: URI | undefined,
		readonly newResource: URI | undefined,
		readonly options?: WorkspaceFileEditOptions,
		metadata?: WorkspaceEditMetadata
	) {
		super(metadata);
	}
}

export interface IBulkEditOptions {
	editor?: ICodeEditor;
	progress?: IProgress<IProgressStep>;
	token?: CancellationToken;
	showPreview?: boolean;
	label?: string;
	quotableLabel?: string;
	undoRedoSource?: UndoRedoSource;
	undoRedoGroupId?: number;
	confirmBeforeUndo?: boolean;
}

export interface IBulkEditResult {
	ariaSummary: string;
}

export type IBulkEditPreviewHandler = (edits: ResourceEdit[], options?: IBulkEditOptions) => Promise<ResourceEdit[]>;

export interface IBulkEditService {
	readonly _serviceBrand: undefined;

	hasPreviewHandler(): boolean;

	setPreviewHandler(handler: IBulkEditPreviewHandler): IDisposable;

	apply(edit: ResourceEdit[], options?: IBulkEditOptions): Promise<IBulkEditResult>;
}
