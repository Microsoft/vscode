/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toErrorMessage } from 'vs/base/common/errorMessage';
import { IReference, dispose, Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService, shouldSynchronizeModel } from 'vs/editor/common/services/modelService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IFileService, FileOperation } from 'vs/platform/files/common/files';
import { MainThreadDocumentsAndEditors } from 'vs/workbench/api/browser/mainThreadDocumentsAndEditors';
import { ExtHostContext, ExtHostDocumentsShape, IExtHostContext, MainThreadDocumentsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { toLocalResource, extUri, IExtUri } from 'vs/base/common/resources';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { Emitter } from 'vs/base/common/event';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { ResourceMap } from 'vs/base/common/map';

export class BoundModelReferenceCollection {

	private _data = new Array<{ uri: URI, length: number, dispose(): void }>();
	private _length = 0;

	constructor(
		private readonly _extUri: IExtUri,
		private readonly _maxAge: number = 1000 * 60 * 3,
		private readonly _maxLength: number = 1024 * 1024 * 80,
	) {
		//
	}

	dispose(): void {
		this._data = dispose(this._data);
	}

	remove(uri: URI): void {
		for (const entry of [...this._data] /* copy array because dispose will modify it */) {
			if (this._extUri.isEqualOrParent(entry.uri, uri)) {
				entry.dispose();
			}
		}
	}

	add(uri: URI, ref: IReference<any>, length: number = 0): void {
		// const length = ref.object.textEditorModel.getValueLength();
		let handle: any;
		let entry: { uri: URI, length: number, dispose(): void };
		const dispose = () => {
			const idx = this._data.indexOf(entry);
			if (idx >= 0) {
				this._length -= length;
				ref.dispose();
				clearTimeout(handle);
				this._data.splice(idx, 1);
			}
		};
		handle = setTimeout(dispose, this._maxAge);
		entry = { uri, length, dispose };

		this._data.push(entry);
		this._length += length;
		this._cleanup();
	}

	private _cleanup(): void {
		while (this._length > this._maxLength) {
			this._data[0].dispose();
		}
	}
}

class ModelTracker extends Disposable {

	private _knownVersionId: number;

	constructor(
		private readonly _model: ITextModel,
		private readonly _onIsCaughtUpWithContentChanges: Emitter<URI>,
		private readonly _proxy: ExtHostDocumentsShape,
		private readonly _textFileService: ITextFileService,
	) {
		super();
		this._knownVersionId = this._model.getVersionId();
		this._register(this._model.onDidChangeContent((e) => {
			this._knownVersionId = e.versionId;
			this._proxy.$acceptModelChanged(this._model.uri, e, this._textFileService.isDirty(this._model.uri));
			if (this.isCaughtUpWithContentChanges()) {
				this._onIsCaughtUpWithContentChanges.fire(this._model.uri);
			}
		}));
	}

	public isCaughtUpWithContentChanges(): boolean {
		return (this._model.getVersionId() === this._knownVersionId);
	}
}

export class MainThreadDocuments extends Disposable implements MainThreadDocumentsShape {

	private _onIsCaughtUpWithContentChanges = this._register(new Emitter<URI>());
	public readonly onIsCaughtUpWithContentChanges = this._onIsCaughtUpWithContentChanges.event;

	private readonly _proxy: ExtHostDocumentsShape;
	private readonly _modelTrackers = new ResourceMap<ModelTracker>();
	private readonly _modelIsSynced = new ResourceMap<void>();
	private readonly _modelReferenceCollection: BoundModelReferenceCollection;

	constructor(
		documentsAndEditors: MainThreadDocumentsAndEditors,
		extHostContext: IExtHostContext,
		@IModelService private readonly _modelService: IModelService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IFileService private readonly _fileService: IFileService,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IPathService private readonly _pathService: IPathService
	) {
		super();

		this._modelReferenceCollection = this._register(new BoundModelReferenceCollection(_uriIdentityService.extUri));

		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDocuments);

		this._register(documentsAndEditors.onDocumentAdd(models => models.forEach(this._onModelAdded, this)));
		this._register(documentsAndEditors.onDocumentRemove(urls => urls.forEach(this._onModelRemoved, this)));
		this._register(_modelService.onModelModeChanged(this._onModelModeChanged, this));

		this._register(_textFileService.files.onDidSave(e => {
			if (this._shouldHandleFileEvent(e.model.resource)) {
				this._proxy.$acceptModelSaved(e.model.resource);
			}
		}));
		this._register(_textFileService.files.onDidChangeDirty(m => {
			if (this._shouldHandleFileEvent(m.resource)) {
				this._proxy.$acceptDirtyStateChanged(m.resource, m.isDirty());
			}
		}));

		this._register(workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			const isMove = e.operation === FileOperation.MOVE;
			if (isMove || e.operation === FileOperation.DELETE) {
				for (const pair of e.files) {
					const removed = isMove ? pair.source : pair.target;
					if (removed) {
						this._modelReferenceCollection.remove(removed);
					}
				}
			}
		}));
	}

	public override dispose(): void {
		dispose(this._modelTrackers.values());
		this._modelTrackers.clear();
		super.dispose();
	}

	public isCaughtUpWithContentChanges(resource: URI): boolean {
		const tracker = this._modelTrackers.get(resource);
		if (tracker) {
			return tracker.isCaughtUpWithContentChanges();
		}
		return true;
	}

	private _shouldHandleFileEvent(resource: URI): boolean {
		const model = this._modelService.getModel(resource);
		return !!model && shouldSynchronizeModel(model);
	}

	private _onModelAdded(model: ITextModel): void {
		// Same filter as in mainThreadEditorsTracker
		if (!shouldSynchronizeModel(model)) {
			// don't synchronize too large models
			return;
		}
		this._modelIsSynced.set(model.uri, undefined);
		this._modelTrackers.set(model.uri, new ModelTracker(model, this._onIsCaughtUpWithContentChanges, this._proxy, this._textFileService));
	}

	private _onModelModeChanged(event: { model: ITextModel; oldModeId: string; }): void {
		let { model } = event;
		if (!this._modelIsSynced.has(model.uri)) {
			return;
		}
		this._proxy.$acceptModelModeChanged(model.uri, model.getLanguageIdentifier().language);
	}

	private _onModelRemoved(modelUrl: URI): void {
		if (!this._modelIsSynced.has(modelUrl)) {
			return;
		}
		this._modelIsSynced.delete(modelUrl);
		this._modelTrackers.get(modelUrl)!.dispose();
		this._modelTrackers.delete(modelUrl);
	}

	// --- from extension host process

	$trySaveDocument(uri: UriComponents): Promise<boolean> {
		return this._textFileService.save(URI.revive(uri)).then(target => !!target);
	}

	$tryOpenDocument(uriData: UriComponents): Promise<URI> {
		const inputUri = URI.revive(uriData);
		if (!inputUri.scheme || !(inputUri.fsPath || inputUri.authority)) {
			return Promise.reject(new Error(`Invalid uri. Scheme and authority or path must be set.`));
		}

		const canonicalUri = this._uriIdentityService.asCanonicalUri(inputUri);

		let promise: Promise<URI>;
		switch (canonicalUri.scheme) {
			case Schemas.untitled:
				promise = this._handleUntitledScheme(canonicalUri);
				break;
			case Schemas.file:
			default:
				promise = this._handleAsResourceInput(canonicalUri);
				break;
		}

		return promise.then(documentUri => {
			if (!documentUri) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}`));
			} else if (!extUri.isEqual(documentUri, canonicalUri)) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: Actual document opened as ${documentUri.toString()}`));
			} else if (!this._modelIsSynced.has(canonicalUri)) {
				return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: Files above 50MB cannot be synchronized with extensions.`));
			} else {
				return canonicalUri;
			}
		}, err => {
			return Promise.reject(new Error(`cannot open ${canonicalUri.toString()}. Detail: ${toErrorMessage(err)}`));
		});
	}

	$tryCreateDocument(options?: { language?: string, content?: string }): Promise<URI> {
		return this._doCreateUntitled(undefined, options ? options.language : undefined, options ? options.content : undefined);
	}

	private _handleAsResourceInput(uri: URI): Promise<URI> {
		return this._textModelResolverService.createModelReference(uri).then(ref => {
			this._modelReferenceCollection.add(uri, ref, ref.object.textEditorModel.getValueLength());
			return ref.object.textEditorModel.uri;
		});
	}

	private _handleUntitledScheme(uri: URI): Promise<URI> {
		const asLocalUri = toLocalResource(uri, this._environmentService.remoteAuthority, this._pathService.defaultUriScheme);
		return this._fileService.resolve(asLocalUri).then(stats => {
			// don't create a new file ontop of an existing file
			return Promise.reject(new Error('file already exists'));
		}, err => {
			return this._doCreateUntitled(Boolean(uri.path) ? uri : undefined);
		});
	}

	private _doCreateUntitled(associatedResource?: URI, mode?: string, initialValue?: string): Promise<URI> {
		return this._textFileService.untitled.resolve({
			associatedResource,
			mode,
			initialValue
		}).then(model => {
			const resource = model.resource;

			if (!this._modelIsSynced.has(resource)) {
				throw new Error(`expected URI ${resource.toString()} to have come to LIFE`);
			}

			this._proxy.$acceptDirtyStateChanged(resource, true); // mark as dirty

			return resource;
		});
	}
}
