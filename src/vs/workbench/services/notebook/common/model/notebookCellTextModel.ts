/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ICell, IOutput, NotebookCellOutputsSplice, CellKind, NotebookCellMetadata } from 'vs/workbench/services/notebook/common/notebookCommon';
import { PieceTreeTextBufferFactory, PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { URI } from 'vs/base/common/uri';

export class NotebookCellTextModel implements ICell {
	private _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	onDidChangeOutputs: Event<NotebookCellOutputsSplice[]> = this._onDidChangeOutputs.event;

	private _onDidChangeContent = new Emitter<void>();
	onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	private _onDidChangeMetadata = new Emitter<void>();
	onDidChangeMetadata: Event<void> = this._onDidChangeMetadata.event;

	private _onDidChangeLanguage = new Emitter<string>();
	onDidChangeLanguage: Event<string> = this._onDidChangeLanguage.event;

	private _outputs: IOutput[];

	get outputs(): IOutput[] {
		return this._outputs;
	}

	get source() {
		return this._source;
	}

	set source(newValue: string[]) {
		this._source = newValue;
		this._buffer = null;
	}

	private _metadata: NotebookCellMetadata | undefined;

	get metadata() {
		return this._metadata;
	}

	set metadata(newMetadata: NotebookCellMetadata | undefined) {
		this._metadata = newMetadata;
		this._onDidChangeMetadata.fire();
	}

	get language() {
		return this._language;
	}

	set language(newLanguage: string) {
		this._language = newLanguage;
		this._onDidChangeLanguage.fire(newLanguage);
	}

	private _buffer: PieceTreeTextBufferFactory | null = null;

	constructor(
		readonly uri: URI,
		public handle: number,
		private _source: string[],
		private _language: string,
		public cellKind: CellKind,
		outputs: IOutput[],
		metadata: NotebookCellMetadata | undefined
	) {
		this._outputs = outputs;
		this._metadata = metadata;
	}

	contentChange() {
		this._onDidChangeContent.fire();

	}

	spliceNotebookCellOutputs(splices: NotebookCellOutputsSplice[]): void {
		splices.reverse().forEach(splice => {
			this.outputs.splice(splice[0], splice[1], ...splice[2]);
		});

		this._onDidChangeOutputs.fire(splices);
	}

	resolveTextBufferFactory(): PieceTreeTextBufferFactory {
		if (this._buffer) {
			return this._buffer;
		}

		let builder = new PieceTreeTextBufferBuilder();
		builder.acceptChunk(this.source.join('\n'));
		this._buffer = builder.finish(true);
		return this._buffer;
	}
}
