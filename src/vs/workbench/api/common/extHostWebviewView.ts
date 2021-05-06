/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostWebview, ExtHostWebviews, toExtensionData } from 'vs/workbench/api/common/extHostWebview';
import type * as vscode from 'vscode';
import * as extHostProtocol from './extHost.protocol';
import * as extHostTypes from './extHostTypes';

class ExtHostWebviewView extends Disposable implements vscode.WebviewView {

	readonly #handle: extHostProtocol.WebviewHandle;
	readonly #proxy: extHostProtocol.MainThreadWebviewViewsShape;

	readonly #viewType: string;
	readonly #webview: ExtHostWebview;

	#isDisposed = false;
	#isVisible: boolean;
	#title: string | undefined;
	#description: string | undefined;

	constructor(
		handle: extHostProtocol.WebviewHandle,
		proxy: extHostProtocol.MainThreadWebviewViewsShape,
		viewType: string,
		title: string | undefined,
		webview: ExtHostWebview,
		isVisible: boolean,
	) {
		super();

		this.#viewType = viewType;
		this.#title = title;
		this.#handle = handle;
		this.#proxy = proxy;
		this.#webview = webview;
		this.#isVisible = isVisible;
	}

	public override dispose() {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;
		this.#onDidDispose.fire();

		this.#webview.dispose();

		super.dispose();
	}

	readonly #onDidChangeVisibility = this._register(new Emitter<void>());
	public readonly onDidChangeVisibility = this.#onDidChangeVisibility.event;

	readonly #onDidDispose = this._register(new Emitter<void>());
	public readonly onDidDispose = this.#onDidDispose.event;

	public get title(): string | undefined {
		this.assertNotDisposed();
		return this.#title;
	}

	public set title(value: string | undefined) {
		this.assertNotDisposed();
		if (this.#title !== value) {
			this.#title = value;
			this.#proxy.$setWebviewViewTitle(this.#handle, value);
		}
	}

	public get description(): string | undefined {
		this.assertNotDisposed();
		return this.#description;
	}

	public set description(value: string | undefined) {
		this.assertNotDisposed();
		if (this.#description !== value) {
			this.#description = value;
			this.#proxy.$setWebviewViewDescription(this.#handle, value);
		}
	}

	public get visible(): boolean { return this.#isVisible; }

	public get webview(): vscode.Webview { return this.#webview; }

	public get viewType(): string { return this.#viewType; }

	/* internal */ _setVisible(visible: boolean) {
		if (visible === this.#isVisible || this.#isDisposed) {
			return;
		}

		this.#isVisible = visible;
		this.#onDidChangeVisibility.fire();
	}

	public show(preserveFocus?: boolean): void {
		this.assertNotDisposed();
		this.#proxy.$show(this.#handle, !!preserveFocus);
	}

	private assertNotDisposed() {
		if (this.#isDisposed) {
			throw new Error('Webview is disposed');
		}
	}
}

export class ExtHostWebviewViews implements extHostProtocol.ExtHostWebviewViewsShape {

	private readonly _proxy: extHostProtocol.MainThreadWebviewViewsShape;

	private readonly _viewProviders = new Map<string, {
		readonly provider: vscode.WebviewViewProvider;
		readonly extension: IExtensionDescription;
	}>();

	private readonly _webviewViews = new Map<extHostProtocol.WebviewHandle, ExtHostWebviewView>();

	constructor(
		mainContext: extHostProtocol.IMainContext,
		private readonly _extHostWebview: ExtHostWebviews,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainContext.MainThreadWebviewViews);
	}

	public registerWebviewViewProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.WebviewViewProvider,
		webviewOptions?: {
			retainContextWhenHidden?: boolean
		},
	): vscode.Disposable {
		if (this._viewProviders.has(viewType)) {
			throw new Error(`View provider for '${viewType}' already registered`);
		}

		this._viewProviders.set(viewType, { provider, extension });
		this._proxy.$registerWebviewViewProvider(toExtensionData(extension), viewType, {
			retainContextWhenHidden: webviewOptions?.retainContextWhenHidden,
			serializeBuffersForPostMessage: false,
		});

		return new extHostTypes.Disposable(() => {
			this._viewProviders.delete(viewType);
			this._proxy.$unregisterWebviewViewProvider(viewType);
		});
	}

	async $resolveWebviewView(
		webviewHandle: string,
		viewType: string,
		title: string | undefined,
		state: any,
		cancellation: CancellationToken,
	): Promise<void> {
		const entry = this._viewProviders.get(viewType);
		if (!entry) {
			throw new Error(`No view provider found for '${viewType}'`);
		}

		const { provider, extension } = entry;

		const webview = this._extHostWebview.createNewWebview(webviewHandle, { /* todo */ }, extension);
		const revivedView = new ExtHostWebviewView(webviewHandle, this._proxy, viewType, title, webview, true);

		this._webviewViews.set(webviewHandle, revivedView);

		await provider.resolveWebviewView(revivedView, { state }, cancellation);
	}

	async $onDidChangeWebviewViewVisibility(
		webviewHandle: string,
		visible: boolean
	) {
		const webviewView = this.getWebviewView(webviewHandle);
		webviewView._setVisible(visible);
	}

	async $disposeWebviewView(webviewHandle: string) {
		const webviewView = this.getWebviewView(webviewHandle);
		this._webviewViews.delete(webviewHandle);
		webviewView.dispose();

		this._extHostWebview.deleteWebview(webviewHandle);
	}

	private getWebviewView(handle: string): ExtHostWebviewView {
		const entry = this._webviewViews.get(handle);
		if (!entry) {
			throw new Error('No webview found');
		}
		return entry;
	}
}
