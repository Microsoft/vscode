/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostNotebookKernelsShape, IMainContext, INotebookKernelDto2, MainContext, MainThreadNotebookKernelsShape } from 'vs/workbench/api/common/extHost.protocol';
import * as vscode from 'vscode';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as extHostTypeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { asWebviewUri } from 'vs/workbench/api/common/shared/webview';
import { ResourceMap } from 'vs/base/common/map';

interface IKernelData {
	extensionId: ExtensionIdentifier,
	controller: vscode.NotebookController;
	onDidChangeSelection: Emitter<{ selected: boolean; notebook: vscode.NotebookDocument; }>;
	onDidReceiveMessage: Emitter<{ editor: vscode.NotebookEditor, message: any }>;
	associatedNotebooks: ResourceMap<boolean>;
}

export class ExtHostNotebookKernels implements ExtHostNotebookKernelsShape {

	private readonly _proxy: MainThreadNotebookKernelsShape;

	private readonly _kernelData = new Map<number, IKernelData>();
	private _handlePool: number = 0;

	constructor(
		mainContext: IMainContext,
		private readonly _initData: IExtHostInitDataService,
		private readonly _extHostNotebook: ExtHostNotebookController
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadNotebookKernels);
	}

	createNotebookController(extension: IExtensionDescription, id: string, viewType: string, label: string, handler?: vscode.NotebookExecuteHandler, preloads?: vscode.NotebookKernelPreload[]): vscode.NotebookController {

		for (let data of this._kernelData.values()) {
			if (data.controller.id === id && ExtensionIdentifier.equals(extension.identifier, data.extensionId)) {
				throw new Error(`notebook controller with id '${id}' ALREADY exist`);
			}
		}

		const handle = this._handlePool++;
		const that = this;

		const _defaultExecutHandler = () => console.warn(`NO execute handler from notebook controller '${data.id}' of extension: '${extension.identifier}'`);

		let isDisposed = false;
		const commandDisposables = new DisposableStore();

		const onDidChangeSelection = new Emitter<{ selected: boolean, notebook: vscode.NotebookDocument }>();
		const onDidReceiveMessage = new Emitter<{ editor: vscode.NotebookEditor, message: any }>();

		const data: INotebookKernelDto2 = {
			id: `${extension.identifier.value}/${id}`,
			viewType,
			extensionId: extension.identifier,
			extensionLocation: extension.extensionLocation,
			label: label || extension.identifier.value,
			preloads: preloads ? preloads.map(extHostTypeConverters.NotebookKernelPreload.from) : []
		};

		//
		let _executeHandler: vscode.NotebookExecuteHandler = handler ?? _defaultExecutHandler;
		let _interruptHandler: vscode.NotebookInterruptHandler | undefined;

		// todo@jrieken the selector needs to be massaged
		this._proxy.$addKernel(handle, data).catch(err => {
			// this can happen when a kernel with that ID is already registered
			console.log(err);
			isDisposed = true;
		});

		// update: all setters write directly into the dto object
		// and trigger an update. the actual update will only happen
		// once per event loop execution
		let tokenPool = 0;
		const _update = () => {
			if (isDisposed) {
				return;
			}
			const myToken = ++tokenPool;
			Promise.resolve().then(() => {
				if (myToken === tokenPool) {
					this._proxy.$updateKernel(handle, data);
				}
			});
		};

		// notebook documents that are associated to this controller
		const associatedNotebooks = new ResourceMap<boolean>();

		const controller: vscode.NotebookController = {
			get id() { return id; },
			get viewType() { return data.viewType; },
			onDidChangeNotebookAssociation: onDidChangeSelection.event,
			get label() {
				return data.label;
			},
			set label(value) {
				data.label = value ?? extension.displayName ?? extension.name;
				_update();
			},
			get detail() {
				return data.detail ?? '';
			},
			set detail(value) {
				data.detail = value;
				_update();
			},
			get description() {
				return data.description ?? '';
			},
			set description(value) {
				data.description = value;
				_update();
			},
			get supportedLanguages() {
				return data.supportedLanguages;
			},
			set supportedLanguages(value) {
				data.supportedLanguages = value;
				_update();
			},
			get hasExecutionOrder() {
				return data.hasExecutionOrder ?? false;
			},
			set hasExecutionOrder(value) {
				data.hasExecutionOrder = value;
				_update();
			},
			get preloads() {
				return data.preloads ? data.preloads.map(extHostTypeConverters.NotebookKernelPreload.to) : [];
			},
			get executeHandler() {
				return _executeHandler;
			},
			set executeHandler(value) {
				_executeHandler = value ?? _defaultExecutHandler;
			},
			get interruptHandler() {
				return _interruptHandler;
			},
			set interruptHandler(value) {
				_interruptHandler = value;
				data.supportsInterrupt = Boolean(value);
				_update();
			},
			createNotebookCellExecutionTask(cell) {
				if (isDisposed) {
					throw new Error('notebook controller is DISPOSED');
				}
				if (!associatedNotebooks.has(cell.notebook.uri)) {
					throw new Error(`notebook controller is NOT associated to notebook: ${cell.notebook.uri.toString()}`);
				}
				//todo@jrieken
				return that._extHostNotebook.createNotebookCellExecution(cell.notebook.uri, cell.index, data.id)!;
			},
			dispose: () => {
				if (!isDisposed) {
					isDisposed = true;
					this._kernelData.delete(handle);
					commandDisposables.dispose();
					onDidChangeSelection.dispose();
					onDidReceiveMessage.dispose();
					this._proxy.$removeKernel(handle);
				}
			},
			// --- ipc
			onDidReceiveMessage: onDidReceiveMessage.event,
			postMessage(message, editor) {
				return that._proxy.$postMessage(handle, editor && that._extHostNotebook.getIdByEditor(editor), message);
			},
			asWebviewUri(uri: URI) {
				return asWebviewUri(that._initData.environment, String(handle), uri);
			},
			// --- priority
			updateNotebookAffinity(notebook, priority) {
				that._proxy.$updateNotebookPriority(handle, notebook.uri, priority);
			}
		};

		this._kernelData.set(handle, {
			extensionId: extension.identifier,
			controller,
			onDidReceiveMessage,
			onDidChangeSelection,
			associatedNotebooks
		});
		return controller;
	}

	$acceptSelection(handle: number, uri: UriComponents, value: boolean): void {
		const obj = this._kernelData.get(handle);
		if (obj) {
			// update data structure
			const notebook = this._extHostNotebook.lookupNotebookDocument(URI.revive(uri))!;
			if (value) {
				obj.associatedNotebooks.set(notebook.uri, true);
			} else {
				obj.associatedNotebooks.delete(notebook.uri);
			}
			// send event
			obj.onDidChangeSelection.fire({
				selected: value,
				notebook: notebook.apiNotebook
			});
		}
	}

	async $executeCells(handle: number, uri: UriComponents, handles: number[]): Promise<void> {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}
		const document = this._extHostNotebook.lookupNotebookDocument(URI.revive(uri));
		if (!document) {
			throw new Error('MISSING notebook');
		}

		const cells: vscode.NotebookCell[] = [];
		for (let cellHandle of handles) {
			const cell = document.getCell(cellHandle);
			if (cell) {
				cells.push(cell.apiCell);
			}
		}

		try {
			await obj.controller.executeHandler.call(obj.controller, cells, document.apiNotebook, obj.controller);
		} catch (err) {
			//
			console.error(err);
		}
	}

	async $cancelCells(handle: number, uri: UriComponents, handles: number[]): Promise<void> {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}
		const document = this._extHostNotebook.lookupNotebookDocument(URI.revive(uri));
		if (!document) {
			throw new Error('MISSING notebook');
		}
		if (obj.controller.interruptHandler) {
			await obj.controller.interruptHandler.call(obj.controller, document.apiNotebook);
		}

		// we do both? interrupt and cancellation or should we be selective?
		for (let cellHandle of handles) {
			const cell = document.getCell(cellHandle);
			if (cell) {
				this._extHostNotebook.cancelOneNotebookCellExecution(cell);
			}
		}
	}

	$acceptKernelMessageFromRenderer(handle: number, editorId: string, message: any): void {
		const obj = this._kernelData.get(handle);
		if (!obj) {
			// extension can dispose kernels in the meantime
			return;
		}

		const editor = this._extHostNotebook.getEditorById(editorId);
		if (!editor) {
			throw new Error(`send message for UNKNOWN editor: ${editorId}`);
		}

		obj.onDidReceiveMessage.fire(Object.freeze({ editor: editor.apiEditor, message }));
	}
}
