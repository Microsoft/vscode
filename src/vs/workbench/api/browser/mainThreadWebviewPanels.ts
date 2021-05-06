/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { MainThreadWebviews, reviveWebviewContentOptions, reviveWebviewExtension } from 'vs/workbench/api/browser/mainThreadWebviews';
import * as extHostProtocol from 'vs/workbench/api/common/extHost.protocol';
import { EditorGroupColumn, editorGroupToViewColumn, IEditorInput, viewColumnToEditorGroup } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewInput } from 'vs/workbench/contrib/webviewPanel/browser/webviewEditorInput';
import { WebviewIcons } from 'vs/workbench/contrib/webviewPanel/browser/webviewIconManager';
import { ICreateWebViewShowOptions, IWebviewWorkbenchService } from 'vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

/**
 * Bi-directional map between webview handles and inputs.
 */
class WebviewInputStore {
	private readonly _handlesToInputs = new Map<string, WebviewInput>();
	private readonly _inputsToHandles = new Map<WebviewInput, string>();

	public add(handle: string, input: WebviewInput): void {
		this._handlesToInputs.set(handle, input);
		this._inputsToHandles.set(input, handle);
	}

	public getHandleForInput(input: WebviewInput): string | undefined {
		return this._inputsToHandles.get(input);
	}

	public getInputForHandle(handle: string): WebviewInput | undefined {
		return this._handlesToInputs.get(handle);
	}

	public delete(handle: string): void {
		const input = this.getInputForHandle(handle);
		this._handlesToInputs.delete(handle);
		if (input) {
			this._inputsToHandles.delete(input);
		}
	}

	public get size(): number {
		return this._handlesToInputs.size;
	}

	[Symbol.iterator](): Iterator<WebviewInput> {
		return this._handlesToInputs.values();
	}
}

class WebviewViewTypeTransformer {
	public constructor(
		public readonly prefix: string,
	) { }

	public fromExternal(viewType: string): string {
		return this.prefix + viewType;
	}

	public toExternal(viewType: string): string | undefined {
		return viewType.startsWith(this.prefix)
			? viewType.substr(this.prefix.length)
			: undefined;
	}
}

export class MainThreadWebviewPanels extends Disposable implements extHostProtocol.MainThreadWebviewPanelsShape {

	private readonly webviewPanelViewType = new WebviewViewTypeTransformer('mainThreadWebview-');

	private readonly _proxy: extHostProtocol.ExtHostWebviewPanelsShape;

	private readonly _webviewInputs = new WebviewInputStore();

	private readonly _editorProviders = new Map<string, IDisposable>();

	private readonly _revivers = new Map<string, IDisposable>();

	constructor(
		context: extHostProtocol.IExtHostContext,
		private readonly _mainThreadWebviews: MainThreadWebviews,
		@IExtensionService extensionService: IExtensionService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@IEditorService private readonly _editorService: IEditorService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
	) {
		super();

		this._proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostWebviewPanels);

		this._register(_editorService.onDidActiveEditorChange(() => {
			this.updateWebviewViewStates(this._editorService.activeEditor);
		}));

		this._register(_editorService.onDidVisibleEditorsChange(() => {
			this.updateWebviewViewStates(this._editorService.activeEditor);
		}));

		this._register(_webviewWorkbenchService.onDidChangeActiveWebviewEditor(input => {
			this.updateWebviewViewStates(input);
		}));

		// This reviver's only job is to activate extensions.
		// This should trigger the real reviver to be registered from the extension host side.
		this._register(_webviewWorkbenchService.registerResolver({
			canResolve: (webview: WebviewInput) => {
				const viewType = this.webviewPanelViewType.toExternal(webview.viewType);
				if (typeof viewType === 'string') {
					extensionService.activateByEvent(`onWebviewPanel:${viewType}`);
				}
				return false;
			},
			resolveWebview: () => { throw new Error('not implemented'); }
		}));
	}

	override dispose() {
		super.dispose();

		dispose(this._editorProviders.values());
		this._editorProviders.clear();

		dispose(this._revivers.values());
		this._revivers.clear();
	}

	public get webviewInputs(): Iterable<WebviewInput> { return this._webviewInputs; }

	public addWebviewInput(handle: extHostProtocol.WebviewHandle, input: WebviewInput, options: { serializeBuffersForPostMessage: boolean }): void {
		this._webviewInputs.add(handle, input);
		this._mainThreadWebviews.addWebview(handle, input.webview, options);

		input.webview.onDidDispose(() => {
			this._proxy.$onDidDisposeWebviewPanel(handle).finally(() => {
				this._webviewInputs.delete(handle);
			});
		});
	}

	public $createWebviewPanel(
		extensionData: extHostProtocol.WebviewExtensionDescription,
		handle: extHostProtocol.WebviewHandle,
		viewType: string,
		initData: {
			title: string;
			webviewOptions: extHostProtocol.IWebviewOptions;
			panelOptions: extHostProtocol.IWebviewPanelOptions;
			serializeBuffersForPostMessage: boolean;
		},
		showOptions: { viewColumn?: EditorGroupColumn, preserveFocus?: boolean; },
	): void {
		const mainThreadShowOptions: ICreateWebViewShowOptions = Object.create(null);
		if (showOptions) {
			mainThreadShowOptions.preserveFocus = !!showOptions.preserveFocus;
			mainThreadShowOptions.group = viewColumnToEditorGroup(this._editorGroupService, showOptions.viewColumn);
		}

		const extension = reviveWebviewExtension(extensionData);

		const webview = this._webviewWorkbenchService.createWebview(handle, this.webviewPanelViewType.fromExternal(viewType), initData.title, mainThreadShowOptions, reviveWebviewOptions(initData.panelOptions), reviveWebviewContentOptions(initData.webviewOptions), extension);
		this.addWebviewInput(handle, webview, { serializeBuffersForPostMessage: initData.serializeBuffersForPostMessage });

		/* __GDPR__
			"webviews:createWebviewPanel" : {
				"extensionId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this._telemetryService.publicLog('webviews:createWebviewPanel', { extensionId: extension.id.value });
	}

	public $disposeWebview(handle: extHostProtocol.WebviewHandle): void {
		const webview = this.getWebviewInput(handle);
		webview.dispose();
	}

	public $setTitle(handle: extHostProtocol.WebviewHandle, value: string): void {
		const webview = this.getWebviewInput(handle);
		webview.setName(value);
	}

	public $setIconPath(handle: extHostProtocol.WebviewHandle, value: { light: UriComponents, dark: UriComponents; } | undefined): void {
		const webview = this.getWebviewInput(handle);
		webview.iconPath = reviveWebviewIcon(value);
	}

	public $reveal(handle: extHostProtocol.WebviewHandle, showOptions: extHostProtocol.WebviewPanelShowOptions): void {
		const webview = this.getWebviewInput(handle);
		if (webview.isDisposed()) {
			return;
		}

		const targetGroup = this._editorGroupService.getGroup(viewColumnToEditorGroup(this._editorGroupService, showOptions.viewColumn)) || this._editorGroupService.getGroup(webview.group || 0);
		if (targetGroup) {
			this._webviewWorkbenchService.revealWebview(webview, targetGroup, !!showOptions.preserveFocus);
		}
	}

	public $registerSerializer(viewType: string, options: { serializeBuffersForPostMessage: boolean }): void {
		if (this._revivers.has(viewType)) {
			throw new Error(`Reviver for ${viewType} already registered`);
		}

		this._revivers.set(viewType, this._webviewWorkbenchService.registerResolver({
			canResolve: (webviewInput) => {
				return webviewInput.viewType === this.webviewPanelViewType.fromExternal(viewType);
			},
			resolveWebview: async (webviewInput): Promise<void> => {
				const viewType = this.webviewPanelViewType.toExternal(webviewInput.viewType);
				if (!viewType) {
					webviewInput.webview.html = this._mainThreadWebviews.getWebviewResolvedFailedContent(webviewInput.viewType);
					return;
				}

				const handle = webviewInput.id;

				this.addWebviewInput(handle, webviewInput, options);

				let state = undefined;
				if (webviewInput.webview.state) {
					try {
						state = JSON.parse(webviewInput.webview.state);
					} catch (e) {
						console.error('Could not load webview state', e, webviewInput.webview.state);
					}
				}

				try {
					await this._proxy.$deserializeWebviewPanel(handle, viewType, {
						title: webviewInput.getTitle(),
						state,
						panelOptions: webviewInput.webview.options,
						webviewOptions: webviewInput.webview.contentOptions,
					}, editorGroupToViewColumn(this._editorGroupService, webviewInput.group || 0));
				} catch (error) {
					onUnexpectedError(error);
					webviewInput.webview.html = this._mainThreadWebviews.getWebviewResolvedFailedContent(viewType);
				}
			}
		}));
	}

	public $unregisterSerializer(viewType: string): void {
		const reviver = this._revivers.get(viewType);
		if (!reviver) {
			throw new Error(`No reviver for ${viewType} registered`);
		}

		reviver.dispose();
		this._revivers.delete(viewType);
	}

	private updateWebviewViewStates(activeEditorInput: IEditorInput | undefined) {
		if (!this._webviewInputs.size) {
			return;
		}

		const viewStates: extHostProtocol.WebviewPanelViewStateData = {};

		const updateViewStatesForInput = (group: IEditorGroup, topLevelInput: IEditorInput, editorInput: IEditorInput) => {
			if (!(editorInput instanceof WebviewInput)) {
				return;
			}

			editorInput.updateGroup(group.id);

			const handle = this._webviewInputs.getHandleForInput(editorInput);
			if (handle) {
				viewStates[handle] = {
					visible: topLevelInput === group.activeEditor,
					active: editorInput === activeEditorInput,
					position: editorGroupToViewColumn(this._editorGroupService, group.id),
				};
			}
		};

		for (const group of this._editorGroupService.groups) {
			for (const input of group.editors) {
				if (input instanceof DiffEditorInput) {
					updateViewStatesForInput(group, input, input.primary);
					updateViewStatesForInput(group, input, input.secondary);
				} else {
					updateViewStatesForInput(group, input, input);
				}
			}
		}

		if (Object.keys(viewStates).length) {
			this._proxy.$onDidChangeWebviewPanelViewStates(viewStates);
		}
	}

	private getWebviewInput(handle: extHostProtocol.WebviewHandle): WebviewInput {
		const webview = this.tryGetWebviewInput(handle);
		if (!webview) {
			throw new Error(`Unknown webview handle:${handle}`);
		}
		return webview;
	}

	private tryGetWebviewInput(handle: extHostProtocol.WebviewHandle): WebviewInput | undefined {
		return this._webviewInputs.getInputForHandle(handle);
	}
}

function reviveWebviewIcon(
	value: { light: UriComponents, dark: UriComponents; } | undefined
): WebviewIcons | undefined {
	return value
		? { light: URI.revive(value.light), dark: URI.revive(value.dark) }
		: undefined;
}

function reviveWebviewOptions(panelOptions: extHostProtocol.IWebviewPanelOptions): WebviewOptions {
	return {
		enableFindWidget: panelOptions.enableFindWidget,
		retainContextWhenHidden: panelOptions.retainContextWhenHidden,
	};
}
