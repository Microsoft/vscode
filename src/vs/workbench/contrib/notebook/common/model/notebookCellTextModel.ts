/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ICell, IOutput, NotebookCellOutputsSplice, CellKind, NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { URI } from 'vs/base/common/uri';
import * as model from 'vs/editor/common/model';
import { Range } from 'vs/editor/common/core/range';
import { Disposable } from 'vs/base/common/lifecycle';

export class NotebookCellTextModel extends Disposable implements ICell {
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

	private _textBuffer!: model.IReadonlyTextBuffer;

	get textBuffer() {
		if (this._textBuffer) {
			return this._textBuffer;
		}

		let builder = new PieceTreeTextBufferBuilder();
		builder.acceptChunk(Array.isArray(this._source) ? this._source.join('\n') : this._source);
		const bufferFactory = builder.finish(true);
		this._textBuffer = bufferFactory.create(model.DefaultEndOfLine.LF);

		this._register(this._textBuffer.onDidChangeContent(() => {
			this._onDidChangeContent.fire();
		}));

		return this._textBuffer;
	}

	constructor(
		readonly uri: URI,
		public handle: number,
		private _source: string | string[],
		private _language: string,
		public cellKind: CellKind,
		outputs: IOutput[],
		metadata: NotebookCellMetadata | undefined
	) {
		super();
		this._outputs = outputs;
		this._metadata = metadata;
	}

	getValue(): string {
		const fullRange = this.getFullModelRange();
		const eol = this.textBuffer.getEOL();
		if (eol === '\n') {
			return this.textBuffer.getValueInRange(fullRange, model.EndOfLinePreference.LF);
		} else {
			return this.textBuffer.getValueInRange(fullRange, model.EndOfLinePreference.CRLF);
		}
	}

	getFullModelRange() {
		const lineCount = this.textBuffer.getLineCount();
		return new Range(1, 1, lineCount, this.textBuffer.getLineLength(lineCount) + 1);
	}

	spliceNotebookCellOutputs(splices: NotebookCellOutputsSplice[]): void {
		splices.reverse().forEach(splice => {
			this.outputs.splice(splice[0], splice[1], ...splice[2]);
		});

		this._onDidChangeOutputs.fire(splices);
	}
}
