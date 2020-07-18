/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'vs/base/common/assert';
import { Emitter, Event } from 'vs/base/common/event';
import { dispose } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ExtHostDocumentsAndEditorsShape, IDocumentsAndEditorsDelta, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ExtHostTextEditor } from 'vs/workbench/api/common/extHostTextEditor';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { ILogService } from 'vs/platform/log/common/log';
import { ResourceMap } from 'vs/base/common/map';

export class ExtHostDocumentsAndEditors implements ExtHostDocumentsAndEditorsShape {

	readonly _serviceBrand: undefined;

	private _activeEditorId: string | null = null;

	private readonly _editors = new Map<string, ExtHostTextEditor>();
	private readonly _documents = new ResourceMap<ExtHostDocumentData>();

	private readonly _onDidAddDocuments = new Emitter<ExtHostDocumentData[]>();
	private readonly _onDidRemoveDocuments = new Emitter<ExtHostDocumentData[]>();
	private readonly _onDidChangeVisibleTextEditors = new Emitter<ExtHostTextEditor[]>();
	private readonly _onDidChangeActiveTextEditor = new Emitter<ExtHostTextEditor | undefined>();

	readonly onDidAddDocuments: Event<ExtHostDocumentData[]> = this._onDidAddDocuments.event;
	readonly onDidRemoveDocuments: Event<ExtHostDocumentData[]> = this._onDidRemoveDocuments.event;
	readonly onDidChangeVisibleTextEditors: Event<ExtHostTextEditor[]> = this._onDidChangeVisibleTextEditors.event;
	readonly onDidChangeActiveTextEditor: Event<ExtHostTextEditor | undefined> = this._onDidChangeActiveTextEditor.event;

	constructor(
		@IExtHostRpcService private readonly _extHostRpc: IExtHostRpcService,
		@ILogService private readonly _logService: ILogService
	) { }

	$acceptDocumentsAndEditorsDelta(delta: IDocumentsAndEditorsDelta): void {

		const removedDocuments: ExtHostDocumentData[] = [];
		const addedDocuments: ExtHostDocumentData[] = [];
		const removedEditors: ExtHostTextEditor[] = [];

		if (delta.removedDocuments) {
			for (const uriComponent of delta.removedDocuments) {
				const uri = URI.revive(uriComponent);
				const data = this._documents.get(uri);
				this._documents.delete(uri);
				if (data) {
					removedDocuments.push(data);
				}
			}
		}

		if (delta.addedDocuments) {
			for (const data of delta.addedDocuments) {
				const resource = URI.revive(data.uri);
				assert.ok(!this._documents.has(resource), `document '${resource} already exists!'`);

				const documentData = new ExtHostDocumentData(
					this._extHostRpc.getProxy(MainContext.MainThreadDocuments),
					resource,
					data.lines,
					data.EOL,
					data.modeId,
					data.versionId,
					data.isDirty
				);
				this._documents.set(resource, documentData);
				addedDocuments.push(documentData);
			}
		}

		if (delta.removedEditors) {
			for (const id of delta.removedEditors) {
				const editor = this._editors.get(id);
				this._editors.delete(id);
				if (editor) {
					removedEditors.push(editor);
				}
			}
		}

		if (delta.addedEditors) {
			for (const data of delta.addedEditors) {
				const resource = URI.revive(data.documentUri);
				assert.ok(this._documents.has(resource), `document '${resource}' does not exist`);
				assert.ok(!this._editors.has(data.id), `editor '${data.id}' already exists!`);

				const documentData = this._documents.get(resource)!;
				const editor = new ExtHostTextEditor(
					data.id,
					this._extHostRpc.getProxy(MainContext.MainThreadTextEditors),
					this._logService,
					documentData,
					data.selections.map(typeConverters.Selection.to),
					data.options,
					data.visibleRanges.map(range => typeConverters.Range.to(range)),
					typeof data.editorPosition === 'number' ? typeConverters.ViewColumn.to(data.editorPosition) : undefined
				);
				this._editors.set(data.id, editor);
			}
		}

		if (delta.newActiveEditor !== undefined) {
			assert.ok(delta.newActiveEditor === null || this._editors.has(delta.newActiveEditor), `active editor '${delta.newActiveEditor}' does not exist`);
			this._activeEditorId = delta.newActiveEditor;
		}

		dispose(removedDocuments);
		dispose(removedEditors);

		// now that the internal state is complete, fire events
		if (delta.removedDocuments) {
			this._onDidRemoveDocuments.fire(removedDocuments);
		}
		if (delta.addedDocuments) {
			this._onDidAddDocuments.fire(addedDocuments);
		}

		if (delta.removedEditors || delta.addedEditors) {
			this._onDidChangeVisibleTextEditors.fire(this.allEditors());
		}
		if (delta.newActiveEditor !== undefined) {
			this._onDidChangeActiveTextEditor.fire(this.activeEditor());
		}
	}

	getDocument(uri: URI): ExtHostDocumentData | undefined {
		return this._documents.get(uri);
	}

	allDocuments(): ExtHostDocumentData[] {
		return [...this._documents.values()];
	}

	getEditor(id: string): ExtHostTextEditor | undefined {
		return this._editors.get(id);
	}

	activeEditor(): ExtHostTextEditor | undefined {
		if (!this._activeEditorId) {
			return undefined;
		} else {
			return this._editors.get(this._activeEditorId);
		}
	}

	allEditors(): ExtHostTextEditor[] {
		return [...this._editors.values()];
	}
}

export interface IExtHostDocumentsAndEditors extends ExtHostDocumentsAndEditors { }
export const IExtHostDocumentsAndEditors = createDecorator<IExtHostDocumentsAndEditors>('IExtHostDocumentsAndEditors');
