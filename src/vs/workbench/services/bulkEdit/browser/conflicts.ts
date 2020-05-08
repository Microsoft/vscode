/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { WorkspaceEdit, WorkspaceTextEdit } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ResourceMap } from 'vs/base/common/map';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ITextModel } from 'vs/editor/common/model';

export class ConflictDetector {

	private readonly _conflicts = new ResourceMap<boolean>();
	private readonly _disposables = new DisposableStore();

	private readonly _onDidConflict = new Emitter<this>();
	readonly onDidConflict: Event<this> = this._onDidConflict.event;

	constructor(
		workspaceEdit: WorkspaceEdit,
		@IFileService fileService: IFileService,
		@IModelService modelService: IModelService,
	) {

		const _workspaceEditResources = new ResourceMap<boolean>();

		for (let edit of workspaceEdit.edits) {
			if (WorkspaceTextEdit.is(edit)) {

				_workspaceEditResources.set(edit.resource, true);

				if (typeof edit.modelVersionId === 'number') {
					const model = modelService.getModel(edit.resource);
					if (model && model.getVersionId() !== edit.modelVersionId) {
						this._conflicts.set(edit.resource, true);
						this._onDidConflict.fire(this);
					}
				}

			} else if (edit.newUri) {
				_workspaceEditResources.set(edit.newUri, true);

			} else if (edit.oldUri) {
				_workspaceEditResources.set(edit.oldUri, true);
			}
		}

		// listen to file changes
		this._disposables.add(fileService.onDidFilesChange(e => {
			for (let change of e.changes) {

				if (modelService.getModel(change.resource)) {
					// ignore changes for which a model exists
					// because we have a better check for models
					continue;
				}

				// conflict
				if (_workspaceEditResources.has(change.resource)) {
					this._conflicts.set(change.resource, true);
					this._onDidConflict.fire(this);
				}
			}
		}));

		// listen to model changes...?
		const onDidChangeModel = (model: ITextModel) => {

			// conflict
			if (_workspaceEditResources.has(model.uri)) {
				this._conflicts.set(model.uri, true);
				this._onDidConflict.fire(this);
			}
		};
		for (let model of modelService.getModels()) {
			this._disposables.add(model.onDidChangeContent(() => onDidChangeModel(model)));
		}
	}

	dispose(): void {
		this._disposables.dispose();
		this._onDidConflict.dispose();
	}

	list(): URI[] {
		return [...this._conflicts.keys()];
	}

	hasConflicts(): boolean {
		return this._conflicts.size > 0;
	}
}
