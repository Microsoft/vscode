/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/binaryeditor';
import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { EditorInput, EditorOptions } from 'vs/workbench/common/editor';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { BinaryEditorModel } from 'vs/workbench/common/editor/binaryEditorModel';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { URI } from 'vs/base/common/uri';
import { Dimension, size, clearNode, append, addDisposableListener, EventType, $ } from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { dispose, IDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { assertIsDefined, assertAllDefined } from 'vs/base/common/types';
import { BinarySize } from 'vs/platform/files/common/files';

export interface IOpenCallbacks {
	openInternal: (input: EditorInput, options: EditorOptions | undefined) => Promise<void>;
	openExternal: (uri: URI) => void;
}

/*
 * This class is only intended to be subclassed and not instantiated.
 */
export abstract class BaseBinaryResourceEditor extends BaseEditor {

	private readonly _onMetadataChanged = this._register(new Emitter<void>());
	readonly onMetadataChanged = this._onMetadataChanged.event;

	private readonly _onDidOpenInPlace = this._register(new Emitter<void>());
	readonly onDidOpenInPlace = this._onDidOpenInPlace.event;

	private callbacks: IOpenCallbacks;
	private metadata: string | undefined;
	private binaryContainer: HTMLElement | undefined;
	private scrollbar: DomScrollableElement | undefined;
	private resourceViewerContext: ResourceViewerContext | undefined;

	constructor(
		id: string,
		callbacks: IOpenCallbacks,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IStorageService storageService: IStorageService,
	) {
		super(id, telemetryService, themeService, storageService);

		this.callbacks = callbacks;
	}

	getTitle(): string {
		return this.input ? this.input.getName() : nls.localize('binaryEditor', "Binary Viewer");
	}

	protected createEditor(parent: HTMLElement): void {

		// Container for Binary
		this.binaryContainer = document.createElement('div');
		this.binaryContainer.className = 'binary-container';
		this.binaryContainer.style.outline = 'none';
		this.binaryContainer.tabIndex = 0; // enable focus support from the editor part (do not remove)

		// Custom Scrollbars
		this.scrollbar = this._register(new DomScrollableElement(this.binaryContainer, { horizontal: ScrollbarVisibility.Auto, vertical: ScrollbarVisibility.Auto }));
		parent.appendChild(this.scrollbar.getDomNode());
	}

	async setInput(input: EditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, token);
		const model = await input.resolve();

		// Check for cancellation
		if (token.isCancellationRequested) {
			return;
		}

		// Assert Model instance
		if (!(model instanceof BinaryEditorModel)) {
			throw new Error('Unable to open file as binary');
		}

		// Render Input
		if (this.resourceViewerContext) {
			this.resourceViewerContext.dispose();
		}

		const [binaryContainer, scrollbar] = assertAllDefined(this.binaryContainer, this.scrollbar);
		this.resourceViewerContext = ResourceViewer.show({ name: model.getName(), resource: model.resource, size: model.getSize(), etag: model.getETag(), mime: model.getMime() }, binaryContainer, scrollbar, {
			openInternalClb: () => this.handleOpenInternalCallback(input, options),
			openExternalClb: this.environmentService.configuration.remoteAuthority ? undefined : resource => this.callbacks.openExternal(resource),
			metadataClb: meta => this.handleMetadataChanged(meta)
		});
	}

	private async handleOpenInternalCallback(input: EditorInput, options: EditorOptions | undefined): Promise<void> {
		await this.callbacks.openInternal(input, options);

		// Signal to listeners that the binary editor has been opened in-place
		this._onDidOpenInPlace.fire();
	}

	private handleMetadataChanged(meta: string | undefined): void {
		this.metadata = meta;

		this._onMetadataChanged.fire();
	}

	getMetadata(): string | undefined {
		return this.metadata;
	}

	clearInput(): void {

		// Clear Meta
		this.handleMetadataChanged(undefined);

		// Clear the rest
		if (this.binaryContainer) {
			clearNode(this.binaryContainer);
		}
		dispose(this.resourceViewerContext);
		this.resourceViewerContext = undefined;

		super.clearInput();
	}

	layout(dimension: Dimension): void {

		// Pass on to Binary Container
		const [binaryContainer, scrollbar] = assertAllDefined(this.binaryContainer, this.scrollbar);
		size(binaryContainer, dimension.width, dimension.height);
		scrollbar.scanDomNode();
		if (this.resourceViewerContext && this.resourceViewerContext.layout) {
			this.resourceViewerContext.layout(dimension);
		}
	}

	focus(): void {
		const binaryContainer = assertIsDefined(this.binaryContainer);

		binaryContainer.focus();
	}

	dispose(): void {
		if (this.binaryContainer) {
			this.binaryContainer.remove();
		}

		dispose(this.resourceViewerContext);
		this.resourceViewerContext = undefined;

		super.dispose();
	}
}

export interface IResourceDescriptor {
	readonly resource: URI;
	readonly name: string;
	readonly size?: number;
	readonly etag?: string;
	readonly mime: string;
}

interface ResourceViewerContext extends IDisposable {
	layout?(dimension: Dimension): void;
}

interface ResourceViewerDelegate {
	openInternalClb(uri: URI): void;
	openExternalClb?(uri: URI): void;
	metadataClb(meta: string): void;
}

class ResourceViewer {

	private static readonly MAX_OPEN_INTERNAL_SIZE = BinarySize.MB * 200; // max size until we offer an action to open internally

	static show(
		descriptor: IResourceDescriptor,
		container: HTMLElement,
		scrollbar: DomScrollableElement,
		delegate: ResourceViewerDelegate,
	): ResourceViewerContext {

		// Ensure CSS class
		container.className = 'monaco-binary-resource-editor';

		// Large Files
		if (typeof descriptor.size === 'number' && descriptor.size > ResourceViewer.MAX_OPEN_INTERNAL_SIZE) {
			return FileTooLargeFileView.create(container, descriptor.size, scrollbar, delegate);
		}

		// Seemingly Binary Files
		return FileSeemsBinaryFileView.create(container, descriptor, scrollbar, delegate);
	}
}

class FileTooLargeFileView {
	static create(
		container: HTMLElement,
		descriptorSize: number,
		scrollbar: DomScrollableElement,
		delegate: ResourceViewerDelegate
	) {
		const size = BinarySize.formatSize(descriptorSize);
		delegate.metadataClb(size);

		clearNode(container);

		const label = document.createElement('span');
		label.textContent = nls.localize('nativeFileTooLargeError', "The file is not displayed in the editor because it is too large ({0}).", size);
		container.appendChild(label);

		scrollbar.scanDomNode();

		return Disposable.None;
	}
}

class FileSeemsBinaryFileView {
	static create(
		container: HTMLElement,
		descriptor: IResourceDescriptor,
		scrollbar: DomScrollableElement,
		delegate: ResourceViewerDelegate
	) {
		delegate.metadataClb(typeof descriptor.size === 'number' ? BinarySize.formatSize(descriptor.size) : '');

		clearNode(container);

		const disposables = new DisposableStore();

		const label = document.createElement('p');
		label.textContent = nls.localize('nativeBinaryError', "The file is not displayed in the editor because it is either binary or uses an unsupported text encoding.");
		container.appendChild(label);

		const link = append(label, $('a.embedded-link'));
		link.setAttribute('role', 'button');
		link.textContent = nls.localize('openAsText', "Do you want to open it anyway?");

		disposables.add(addDisposableListener(link, EventType.CLICK, () => delegate.openInternalClb(descriptor.resource)));

		scrollbar.scanDomNode();

		return disposables;
	}
}
