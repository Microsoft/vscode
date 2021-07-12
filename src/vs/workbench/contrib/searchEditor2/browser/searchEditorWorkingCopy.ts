/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { bufferToStream, streamToBuffer, VSBuffer, VSBufferReadableStream } from 'vs/base/common/buffer';
import { Range } from 'vs/editor/common/core/range';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IFileWorkingCopyModel } from 'vs/workbench/services/workingCopy/common/fileWorkingCopy';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorModel } from 'vs/workbench/common/editor/editorModel';
import { IUntitledFileWorkingCopyModel, IUntitledFileWorkingCopyModelContentChangedEvent, IUntitledFileWorkingCopyModelFactory } from 'vs/workbench/services/workingCopy/common/untitledFileWorkingCopy';
import { IStoredFileWorkingCopyModel, IStoredFileWorkingCopyModelContentChangedEvent, IStoredFileWorkingCopyModelFactory } from 'vs/workbench/services/workingCopy/common/storedFileWorkingCopy';
import { SearchConfiguration } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { defaultSearchConfig, parseSerializedSearchEditor, serializeSearchConfiguration } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';

export class SearchEditorStoredFileWorkingCopyModelFactory implements IStoredFileWorkingCopyModelFactory<SearchEditorStoredFileWorkingCopyModel> {

	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) { }

	async createModel(resource: URI, contents: VSBufferReadableStream, token: CancellationToken): Promise<SearchEditorStoredFileWorkingCopyModel> {
		const value = (await streamToBuffer(contents)).toString();

		return this.instantiationService.createInstance(SearchEditorStoredFileWorkingCopyModel, resource, value);
	}
}

export class SearchEditorUntitledFileWorkingCopyModelFactory implements IUntitledFileWorkingCopyModelFactory<SearchEditorUntitledFileWorkingCopyModel> {

	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) { }

	async createModel(resource: URI, contents: VSBufferReadableStream, token: CancellationToken): Promise<SearchEditorUntitledFileWorkingCopyModel> {
		const value = (await streamToBuffer(contents)).toString();

		return this.instantiationService.createInstance(SearchEditorUntitledFileWorkingCopyModel, resource, value);
	}
}

export abstract class SearchEditorFileWorkingCopyModel extends EditorModel implements IFileWorkingCopyModel {
	abstract readonly onDidChangeContent: Event<unknown>;

	private editorValue: string;
	private config: SearchConfiguration;

	private _versionId = 0;

	get versionId() { return this._versionId; }

	constructor(
		readonly resource: URI,
		contents: string
	) {
		super();
		const parsed = parseSerializedSearchEditor(contents);

		this.editorValue = parsed.text;
		this.config = parsed.config;
	}

	getEditorValue(): string {
		return this.editorValue;
	}

	getConfig(): SearchConfiguration {
		return this.config;
	}

	setResults(results: { matchRanges: Range[]; text: string; config: Partial<SearchConfiguration>; }) {
		this.editorValue = results.text;
		this.config = { ...defaultSearchConfig(), ...results.config };

		this._versionId++;

		this.fireDidChangeContentEvent(false);
	}


	protected serialize(): string {
		return serializeSearchConfiguration(this.config) + '\n' + this.editorValue;
	}

	async snapshot(token: CancellationToken): Promise<VSBufferReadableStream> {
		return bufferToStream(VSBuffer.fromString(this.serialize()));
	}

	updateConfig(config: SearchConfiguration) {
		if (JSON.stringify(this.config) === JSON.stringify(config)) {
			return;
		}

		this.config = config;

		this._versionId++;

		this.fireDidChangeContentEvent(true);
	}

	async update(contents: VSBufferReadableStream, token: CancellationToken): Promise<void> {
		const buffer = await streamToBuffer(contents);

		if (token.isCancellationRequested) {
			return;
		}

		this.doUpdate(buffer.toString());
	}

	protected doUpdate(contents: string): void {
		const parsed = parseSerializedSearchEditor(contents);

		if (this.editorValue === parsed.text && JSON.stringify(this.config) === JSON.stringify(parsed.config)) {
			return; // already up to date
		}

		this.editorValue = parsed.text;
		this.config = parsed.config;

		this._versionId++;

		this.fireDidChangeContentEvent(false);
	}

	protected abstract fireDidChangeContentEvent(onlyConfigChange: boolean): void;
}

export class SearchEditorStoredFileWorkingCopyModel extends SearchEditorFileWorkingCopyModel implements IStoredFileWorkingCopyModel {

	private readonly _onDidChangeContent = this._register(new Emitter<IStoredFileWorkingCopyModelContentChangedEvent>());
	onDidChangeContent = this._onDidChangeContent.event;

	protected fireDidChangeContentEvent(): void {
		this._onDidChangeContent.fire({ isRedoing: false, isUndoing: false });
	}

	pushStackElement(): void { }
}

export class SearchEditorUntitledFileWorkingCopyModel extends SearchEditorFileWorkingCopyModel implements IUntitledFileWorkingCopyModel {

	private readonly _onDidChangeContent = this._register(new Emitter<IUntitledFileWorkingCopyModelContentChangedEvent>());
	onDidChangeContent = this._onDidChangeContent.event;

	protected fireDidChangeContentEvent(onlyConfigChange: boolean): void {
		this._onDidChangeContent.fire({ isEmpty: onlyConfigChange });
	}
}
