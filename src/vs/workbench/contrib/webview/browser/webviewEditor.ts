/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IEditorDropService } from 'vs/workbench/services/editor/browser/editorDropService';
import { EditorInput, EditorOptions } from 'vs/workbench/common/editor';
import { WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewInput } from 'vs/workbench/contrib/webview/browser/webviewEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class WebviewEditor extends BaseEditor {

	public static readonly ID = 'WebviewEditor';

	private _element?: HTMLElement;
	private _dimension?: DOM.Dimension;
	private _visible = false;

	private readonly _webviewVisibleDisposables = this._register(new DisposableStore());
	private readonly _onFocusWindowHandler = this._register(new MutableDisposable());

	private readonly _onDidFocusWebview = this._register(new Emitter<void>());
	public get onDidFocus(): Event<any> { return this._onDidFocusWebview.event; }

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IEditorService private readonly _editorService: IEditorService,
		@IWorkbenchLayoutService private readonly _workbenchLayoutService: IWorkbenchLayoutService,
		@IEditorDropService private readonly _editorDropService: IEditorDropService,
		@IHostService private readonly _hostService: IHostService,
	) {
		super(WebviewEditor.ID, telemetryService, themeService, storageService);
	}

	private get webview(): WebviewOverlay | undefined {
		return this.input instanceof WebviewInput ? this.input.webview : undefined;
	}

	protected createEditor(parent: HTMLElement): void {
		const element = document.createElement('div');
		this._element = element;
		parent.appendChild(element);
	}

	public dispose(): void {
		if (this._element) {
			this._element.remove();
			this._element = undefined;
		}

		super.dispose();
	}

	public layout(dimension: DOM.Dimension): void {
		this._dimension = dimension;
		if (this.webview && this._visible) {
			this.synchronizeWebviewContainerDimensions(this.webview, dimension);
		}
	}

	public focus(): void {
		super.focus();
		if (!this._onFocusWindowHandler.value && !isWeb) {
			// Make sure we restore focus when switching back to a VS Code window
			this._onFocusWindowHandler.value = this._hostService.onDidChangeFocus(focused => {
				if (focused && this._editorService.activeEditorPane === this && this._workbenchLayoutService.hasFocus(Parts.EDITOR_PART)) {
					this.focus();
				}
			});
		}
		this.webview?.focus();
	}

	protected setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		this._visible = visible;
		if (this.input instanceof WebviewInput && this.webview) {
			if (visible) {
				this.claimWebview(this.input);
			} else {
				this.webview.release(this);
			}
		}
		super.setEditorVisible(visible, group);
	}

	public clearInput() {
		if (this.webview) {
			this.webview.release(this);
			this._webviewVisibleDisposables.clear();
		}

		super.clearInput();
	}

	public async setInput(input: EditorInput, options: EditorOptions, token: CancellationToken): Promise<void> {
		if (input.matches(this.input)) {
			return;
		}

		const alreadyOwnsWebview = input instanceof WebviewInput && input.webview === this.webview;
		if (this.webview && !alreadyOwnsWebview) {
			this.webview.release(this);
		}

		await super.setInput(input, options, token);
		await input.resolve();

		if (token.isCancellationRequested) {
			return;
		}

		if (input instanceof WebviewInput) {
			if (this.group) {
				input.updateGroup(this.group.id);
			}

			if (!alreadyOwnsWebview) {
				this.claimWebview(input);
			}
			if (this._dimension) {
				this.layout(this._dimension);
			}
		}
	}

	private claimWebview(input: WebviewInput): void {
		input.webview.claim(this);

		if (this._element) {
			this._element.setAttribute('aria-flowto', input.webview.container.id);
		}

		this._webviewVisibleDisposables.clear();

		// Webviews are not part of the normal editor dom, so we have to register our own drag and drop handler on them.
		this._webviewVisibleDisposables.add(this._editorDropService.createEditorDropTarget(input.webview.container, {
			containsGroup: (group) => this.group?.id === group.group.id
		}));

		this._webviewVisibleDisposables.add(DOM.addDisposableListener(window, DOM.EventType.DRAG_START, () => {
			this.webview?.windowDidDragStart();
		}));

		const onDragEnd = () => {
			this.webview?.windowDidDragEnd();
		};
		this._webviewVisibleDisposables.add(DOM.addDisposableListener(window, DOM.EventType.DRAG_END, onDragEnd));
		this._webviewVisibleDisposables.add(DOM.addDisposableListener(window, DOM.EventType.MOUSE_MOVE, currentEvent => {
			if (currentEvent.buttons === 0) {
				onDragEnd();
			}
		}));

		this.synchronizeWebviewContainerDimensions(input.webview);
		this._webviewVisibleDisposables.add(this.trackFocus(input.webview));
	}

	private synchronizeWebviewContainerDimensions(webview: WebviewOverlay, dimension?: DOM.Dimension) {
		if (this._element) {
			webview.layoutWebviewOverElement(this._element.parentElement!, dimension);
		}
	}

	private trackFocus(webview: WebviewOverlay): IDisposable {
		const store = new DisposableStore();

		// Track focus in webview content
		const webviewContentFocusTracker = DOM.trackFocus(webview.container);
		store.add(webviewContentFocusTracker);
		store.add(webviewContentFocusTracker.onDidFocus(() => this._onDidFocusWebview.fire()));

		// Track focus in webview element
		store.add(webview.onDidFocus(() => this._onDidFocusWebview.fire()));

		return store;
	}
}
