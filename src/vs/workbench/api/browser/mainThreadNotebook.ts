/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { IRelativePattern } from 'vs/base/common/glob';
import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { NotebookSelector } from 'vs/workbench/contrib/notebook/common/notebookSelector';
import { INotebookCellStatusBarItemProvider, INotebookExclusiveDocumentFilter, NotebookDataDto, TransientCellMetadata, TransientDocumentMetadata, TransientOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookContentProvider, INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ExtHostContext, ExtHostNotebookShape, IExtHostContext, MainContext, MainThreadNotebookShape, NotebookExtensionDescription } from '../common/extHost.protocol';

@extHostNamedCustomer(MainContext.MainThreadNotebook)
export class MainThreadNotebooks implements MainThreadNotebookShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostNotebookShape;
	private readonly _notebookProviders = new Map<string, { controller: INotebookContentProvider, disposable: IDisposable }>();
	private readonly _notebookSerializer = new Map<number, IDisposable>();
	private readonly _notebookCellStatusBarRegistrations = new Map<number, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookCellStatusBarService private readonly _cellStatusBarService: INotebookCellStatusBarService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);
	}

	dispose(): void {
		this._disposables.dispose();
		// remove all notebook providers
		for (const item of this._notebookProviders.values()) {
			item.disposable.dispose();
		}
		dispose(this._notebookSerializer.values());
	}

	async $registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string, options: {
		transientOutputs: boolean;
		transientCellMetadata: TransientCellMetadata;
		transientDocumentMetadata: TransientDocumentMetadata;
		viewOptions?: { displayName: string; filenamePattern: (string | IRelativePattern | INotebookExclusiveDocumentFilter)[]; exclusive: boolean; };
	}): Promise<void> {
		let contentOptions = { transientOutputs: options.transientOutputs, transientCellMetadata: options.transientCellMetadata, transientDocumentMetadata: options.transientDocumentMetadata };

		const controller: INotebookContentProvider = {
			get options() {
				return contentOptions;
			},
			set options(newOptions) {
				contentOptions.transientCellMetadata = newOptions.transientCellMetadata;
				contentOptions.transientDocumentMetadata = newOptions.transientDocumentMetadata;
				contentOptions.transientOutputs = newOptions.transientOutputs;
			},
			viewOptions: options.viewOptions,
			open: async (uri: URI, backupId: string | undefined, untitledDocumentData: VSBuffer | undefined, token: CancellationToken) => {
				const data = await this._proxy.$openNotebook(viewType, uri, backupId, untitledDocumentData, token);
				return {
					data,
					transientOptions: contentOptions
				};
			},
			save: async (uri: URI, token: CancellationToken) => {
				return this._proxy.$saveNotebook(viewType, uri, token);
			},
			saveAs: async (uri: URI, target: URI, token: CancellationToken) => {
				return this._proxy.$saveNotebookAs(viewType, uri, target, token);
			},
			backup: async (uri: URI, token: CancellationToken) => {
				return this._proxy.$backupNotebook(viewType, uri, token);
			}
		};

		const disposable = this._notebookService.registerNotebookController(viewType, extension, controller);
		this._notebookProviders.set(viewType, { controller, disposable });
	}

	async $updateNotebookProviderOptions(viewType: string, options?: { transientOutputs: boolean; transientCellMetadata: TransientCellMetadata; transientDocumentMetadata: TransientDocumentMetadata; }): Promise<void> {
		const provider = this._notebookProviders.get(viewType);

		if (provider && options) {
			provider.controller.options = options;
			this._notebookService.listNotebookDocuments().forEach(document => {
				if (document.viewType === viewType) {
					document.transientOptions = provider.controller.options;
				}
			});
		}
	}

	async $unregisterNotebookProvider(viewType: string): Promise<void> {
		const entry = this._notebookProviders.get(viewType);
		if (entry) {
			entry.disposable.dispose();
			this._notebookProviders.delete(viewType);
		}
	}

	$registerNotebookSerializer(handle: number, extension: NotebookExtensionDescription, viewType: string, options: TransientOptions): void {
		const registration = this._notebookService.registerNotebookSerializer(viewType, extension, {
			options,
			dataToNotebook: (data: VSBuffer): Promise<NotebookDataDto> => {
				return this._proxy.$dataToNotebook(handle, data, CancellationToken.None);
			},
			notebookToData: (data: NotebookDataDto): Promise<VSBuffer> => {
				return this._proxy.$notebookToData(handle, data, CancellationToken.None);
			}
		});
		this._notebookSerializer.set(handle, registration);
	}

	$unregisterNotebookSerializer(handle: number): void {
		this._notebookSerializer.get(handle)?.dispose();
		this._notebookSerializer.delete(handle);
	}

	$emitCellStatusBarEvent(eventHandle: number): void {
		const emitter = this._notebookCellStatusBarRegistrations.get(eventHandle);
		if (emitter instanceof Emitter) {
			emitter.fire(undefined);
		}
	}

	async $registerNotebookCellStatusBarItemProvider(handle: number, eventHandle: number | undefined, selector: NotebookSelector): Promise<void> {
		const that = this;
		const provider: INotebookCellStatusBarItemProvider = {
			async provideCellStatusBarItems(uri: URI, index: number, token: CancellationToken) {
				const result = await that._proxy.$provideNotebookCellStatusBarItems(handle, uri, index, token);
				return {
					items: result?.items ?? [],
					dispose() {
						if (result) {
							that._proxy.$releaseNotebookCellStatusBarItems(result.cacheId);
						}
					}
				};
			},
			selector: selector
		};

		if (typeof eventHandle === 'number') {
			const emitter = new Emitter<void>();
			this._notebookCellStatusBarRegistrations.set(eventHandle, emitter);
			provider.onDidChangeStatusBarItems = emitter.event;
		}

		const disposable = this._cellStatusBarService.registerCellStatusBarItemProvider(provider);
		this._notebookCellStatusBarRegistrations.set(handle, disposable);
	}

	async $unregisterNotebookCellStatusBarItemProvider(handle: number, eventHandle: number | undefined): Promise<void> {
		const unregisterThing = (handle: number) => {
			const entry = this._notebookCellStatusBarRegistrations.get(handle);
			if (entry) {
				this._notebookCellStatusBarRegistrations.get(handle)?.dispose();
				this._notebookCellStatusBarRegistrations.delete(handle);
			}
		};
		unregisterThing(handle);
		if (typeof eventHandle === 'number') {
			unregisterThing(eventHandle);
		}
	}
}
