/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import * as strings from 'vs/base/common/strings';
import { ITextModel } from 'vs/editor/common/model';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { RunOnceScheduler, ThrottledDelayer } from 'vs/base/common/async';
import { IFileService } from 'vs/platform/files/common/files';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { Disposable, toDisposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { isNumber } from 'vs/base/common/types';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { binarySearch } from 'vs/base/common/arrays';
import { VSBuffer } from 'vs/base/common/buffer';

export interface IOutputChannelModel extends IDisposable {
	readonly onDidAppendedContent: Event<void>;
	readonly onDispose: Event<void>;
	append(output: string): void;
	update(): void;
	loadModel(): Promise<ITextModel>;
	clear(till?: number): void;
}

export const IOutputChannelModelService = createDecorator<IOutputChannelModelService>('outputChannelModelService');

export interface IOutputChannelModelService {
	readonly _serviceBrand: undefined;

	createOutputChannelModel(id: string, modelUri: URI, mimeType: string, file?: URI): IOutputChannelModel;

}

export abstract class AbstractOutputChannelModelService {

	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService
	) { }

	createOutputChannelModel(id: string, modelUri: URI, mimeType: string, file?: URI): IOutputChannelModel {
		return file ? this.instantiationService.createInstance(FileOutputChannelModel, modelUri, mimeType, file) : this.instantiationService.createInstance(BufferredOutputChannel, modelUri, mimeType);
	}

}

export abstract class AbstractFileOutputChannelModel extends Disposable implements IOutputChannelModel {

	protected readonly _onDidAppendedContent = this._register(new Emitter<void>());
	readonly onDidAppendedContent: Event<void> = this._onDidAppendedContent.event;

	protected readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose: Event<void> = this._onDispose.event;

	protected modelUpdater: RunOnceScheduler;
	protected model: ITextModel | null = null;

	protected startOffset: number = 0;
	protected endOffset: number = 0;

	constructor(
		private readonly modelUri: URI,
		private readonly mimeType: string,
		protected readonly file: URI,
		protected fileService: IFileService,
		protected modelService: IModelService,
		protected modeService: IModeService,
	) {
		super();
		this.modelUpdater = new RunOnceScheduler(() => this.updateModel(), 300);
		this._register(toDisposable(() => this.modelUpdater.cancel()));
	}

	clear(till?: number): void {
		if (this.modelUpdater.isScheduled()) {
			this.modelUpdater.cancel();
			this.onUpdateModelCancelled();
		}
		if (this.model) {
			this.model.setValue('');
		}
		this.endOffset = isNumber(till) ? till : this.endOffset;
		this.startOffset = this.endOffset;
	}

	update(): void { }

	protected createModel(content: string): ITextModel {
		if (this.model) {
			this.model.setValue(content);
		} else {
			this.model = this.modelService.createModel(content, this.modeService.create(this.mimeType), this.modelUri);
			this.onModelCreated(this.model);
			const disposable = this.model.onWillDispose(() => {
				this.onModelWillDispose(this.model);
				this.model = null;
				dispose(disposable);
			});
		}
		return this.model;
	}

	appendToModel(content: string): void {
		if (this.model && content) {
			const lastLine = this.model.getLineCount();
			const lastLineMaxColumn = this.model.getLineMaxColumn(lastLine);
			this.model.applyEdits([EditOperation.insert(new Position(lastLine, lastLineMaxColumn), content)]);
			this._onDidAppendedContent.fire();
		}
	}

	abstract loadModel(): Promise<ITextModel>;
	abstract append(message: string): void;

	protected onModelCreated(model: ITextModel) { }
	protected onModelWillDispose(model: ITextModel | null) { }
	protected onUpdateModelCancelled() { }
	protected updateModel() { }

	dispose(): void {
		this._onDispose.fire();
		super.dispose();
	}
}

// TODO@ben see if new watchers can cope with spdlog and avoid polling then
class OutputFileListener extends Disposable {

	private readonly _onDidContentChange = new Emitter<number | undefined>();
	readonly onDidContentChange: Event<number | undefined> = this._onDidContentChange.event;

	private watching: boolean = false;
	private syncDelayer: ThrottledDelayer<void>;
	private etag: string | undefined;

	constructor(
		private readonly file: URI,
		private readonly fileService: IFileService
	) {
		super();
		this.syncDelayer = new ThrottledDelayer<void>(500);
	}

	watch(eTag: string | undefined): void {
		if (!this.watching) {
			this.etag = eTag;
			this.poll();
			this.watching = true;
		}
	}

	private poll(): void {
		const loop = () => this.doWatch().then(() => this.poll());
		this.syncDelayer.trigger(loop);
	}

	private doWatch(): Promise<void> {
		return this.fileService.resolve(this.file, { resolveMetadata: true })
			.then(stat => {
				if (stat.etag !== this.etag) {
					this.etag = stat.etag;
					this._onDidContentChange.fire(stat.size);
				}
			});
	}

	unwatch(): void {
		if (this.watching) {
			this.syncDelayer.cancel();
			this.watching = false;
		}
	}

	dispose(): void {
		this.unwatch();
		super.dispose();
	}
}

/**
 * An output channel driven by a file and does not support appending messages.
 */
class FileOutputChannelModel extends AbstractFileOutputChannelModel implements IOutputChannelModel {

	private readonly fileHandler: OutputFileListener;

	private updateInProgress: boolean = false;
	private etag: string | undefined = '';
	private loadModelPromise: Promise<ITextModel> | null = null;

	constructor(
		modelUri: URI,
		mimeType: string,
		file: URI,
		@IFileService fileService: IFileService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService
	) {
		super(modelUri, mimeType, file, fileService, modelService, modeService);

		this.fileHandler = this._register(new OutputFileListener(this.file, this.fileService));
		this._register(this.fileHandler.onDidContentChange(size => this.update(size)));
		this._register(toDisposable(() => this.fileHandler.unwatch()));
	}

	loadModel(): Promise<ITextModel> {
		this.loadModelPromise = new Promise<ITextModel>(async (c, e) => {
			try {
				let content = '';
				if (await this.fileService.exists(this.file)) {
					const fileContent = await this.fileService.readFile(this.file, { position: this.startOffset });
					this.endOffset = this.startOffset + fileContent.value.byteLength;
					this.etag = fileContent.etag;
					content = fileContent.value.toString();
				} else {
					this.startOffset = 0;
					this.endOffset = 0;
				}
				c(this.createModel(content));
			} catch (error) {
				e(error);
			}
		});
		return this.loadModelPromise;
	}

	clear(till?: number): void {
		const loadModelPromise: Promise<any> = this.loadModelPromise ? this.loadModelPromise : Promise.resolve();
		loadModelPromise.then(() => {
			super.clear(till);
			this.update();
		});
	}

	append(message: string): void {
		throw new Error('Not supported');
	}

	protected updateModel(): void {
		if (this.model) {
			this.fileService.readFile(this.file, { position: this.endOffset })
				.then(content => {
					this.etag = content.etag;
					if (content.value) {
						this.endOffset = this.endOffset + content.value.byteLength;
						this.appendToModel(content.value.toString());
					}
					this.updateInProgress = false;
				}, () => this.updateInProgress = false);
		} else {
			this.updateInProgress = false;
		}
	}

	protected onModelCreated(model: ITextModel): void {
		this.fileHandler.watch(this.etag);
	}

	protected onModelWillDispose(model: ITextModel | null): void {
		this.fileHandler.unwatch();
	}

	protected onUpdateModelCancelled(): void {
		this.updateInProgress = false;
	}

	protected getByteLength(str: string): number {
		return VSBuffer.fromString(str).byteLength;
	}

	update(size?: number): void {
		if (this.model) {
			if (!this.updateInProgress) {
				this.updateInProgress = true;
				if (isNumber(size) && this.endOffset > size) { // Reset - Content is removed
					this.startOffset = this.endOffset = 0;
					this.model.setValue('');
				}
				this.modelUpdater.schedule();
			}
		}
	}
}

export class BufferredOutputChannel extends Disposable implements IOutputChannelModel {

	readonly file: URI | null = null;
	scrollLock: boolean = false;

	protected _onDidAppendedContent = new Emitter<void>();
	readonly onDidAppendedContent: Event<void> = this._onDidAppendedContent.event;

	private readonly _onDispose = new Emitter<void>();
	readonly onDispose: Event<void> = this._onDispose.event;

	private modelUpdater: RunOnceScheduler;
	private model: ITextModel | null = null;
	private readonly bufferredContent: BufferedContent;
	private lastReadId: number | undefined = undefined;

	constructor(
		private readonly modelUri: URI, private readonly mimeType: string,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService
	) {
		super();

		this.modelUpdater = new RunOnceScheduler(() => this.updateModel(), 300);
		this._register(toDisposable(() => this.modelUpdater.cancel()));

		this.bufferredContent = new BufferedContent();
		this._register(toDisposable(() => this.bufferredContent.clear()));
	}

	append(output: string) {
		this.bufferredContent.append(output);
		if (!this.modelUpdater.isScheduled()) {
			this.modelUpdater.schedule();
		}
	}

	update(): void { }

	clear(): void {
		if (this.modelUpdater.isScheduled()) {
			this.modelUpdater.cancel();
		}
		if (this.model) {
			this.model.setValue('');
		}
		this.bufferredContent.clear();
		this.lastReadId = undefined;
	}

	loadModel(): Promise<ITextModel> {
		const { value, id } = this.bufferredContent.getDelta(this.lastReadId);
		if (this.model) {
			this.model.setValue(value);
		} else {
			this.model = this.createModel(value);
		}
		this.lastReadId = id;
		return Promise.resolve(this.model);
	}

	private createModel(content: string): ITextModel {
		const model = this.modelService.createModel(content, this.modeService.create(this.mimeType), this.modelUri);
		const disposable = model.onWillDispose(() => {
			this.model = null;
			dispose(disposable);
		});
		return model;
	}

	private updateModel(): void {
		if (this.model) {
			const { value, id } = this.bufferredContent.getDelta(this.lastReadId);
			this.lastReadId = id;
			const lastLine = this.model.getLineCount();
			const lastLineMaxColumn = this.model.getLineMaxColumn(lastLine);
			this.model.applyEdits([EditOperation.insert(new Position(lastLine, lastLineMaxColumn), value)]);
			this._onDidAppendedContent.fire();
		}
	}

	dispose(): void {
		this._onDispose.fire();
		super.dispose();
	}
}

class BufferedContent {

	private static readonly MAX_OUTPUT_LENGTH = 10000 /* Max. number of output lines to show in output */ * 100 /* Guestimated chars per line */;

	private data: string[] = [];
	private dataIds: number[] = [];
	private idPool = 0;
	private length = 0;

	public append(content: string): void {
		this.data.push(content);
		this.dataIds.push(++this.idPool);
		this.length += content.length;
		this.trim();
	}

	public clear(): void {
		this.data.length = 0;
		this.dataIds.length = 0;
		this.length = 0;
	}

	private trim(): void {
		if (this.length < BufferedContent.MAX_OUTPUT_LENGTH * 1.2) {
			return;
		}

		while (this.length > BufferedContent.MAX_OUTPUT_LENGTH) {
			this.dataIds.shift();
			const removed = this.data.shift();
			if (removed) {
				this.length -= removed.length;
			}
		}
	}

	public getDelta(previousId?: number): { value: string, id: number } {
		let idx = -1;
		if (previousId !== undefined) {
			idx = binarySearch(this.dataIds, previousId, (a, b) => a - b);
		}

		const id = this.idPool;
		if (idx >= 0) {
			const value = strings.removeAnsiEscapeCodes(this.data.slice(idx + 1).join(''));
			return { value, id };
		} else {
			const value = strings.removeAnsiEscapeCodes(this.data.join(''));
			return { value, id };
		}
	}
}
