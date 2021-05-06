/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ICell, NotebookCellOutputsSplice, CellKind, NotebookCellMetadata, TransientOptions, IOutputDto, ICellOutput, CellMetadataChangedEvent } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import * as model from 'vs/editor/common/model';
import { Range } from 'vs/editor/common/core/range';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { hash } from 'vs/base/common/hash';
import { PieceTreeTextBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { IModeService } from 'vs/editor/common/services/modeService';
import { TextModel } from 'vs/editor/common/model/textModel';

export class NotebookCellTextModel extends Disposable implements ICell {
	private _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	onDidChangeOutputs: Event<NotebookCellOutputsSplice[]> = this._onDidChangeOutputs.event;

	private _onDidChangeContent = new Emitter<'content' | 'language'>();
	onDidChangeContent: Event<'content' | 'language'> = this._onDidChangeContent.event;

	private _onDidChangeMetadata = new Emitter<CellMetadataChangedEvent>();
	onDidChangeMetadata: Event<CellMetadataChangedEvent> = this._onDidChangeMetadata.event;

	private _onDidChangeLanguage = new Emitter<string>();
	onDidChangeLanguage: Event<string> = this._onDidChangeLanguage.event;

	private _outputs: NotebookCellOutputTextModel[];

	get outputs(): ICellOutput[] {
		return this._outputs;
	}

	private _metadata: NotebookCellMetadata;

	get metadata() {
		return this._metadata;
	}

	set metadata(newMetadata: NotebookCellMetadata) {
		const runStateChanged = this._metadata.runState !== newMetadata.runState;
		newMetadata = {
			...newMetadata,
			...{ runStartTimeAdjustment: computeRunStartTimeAdjustment(this._metadata, newMetadata) }
		};
		this._metadata = newMetadata;
		this._hash = null;
		this._onDidChangeMetadata.fire({ runStateChanged });
	}

	get language() {
		return this._language;
	}

	set language(newLanguage: string) {
		if (this._textModel && this._textModel.getLanguageIdentifier().language !== newLanguage) {
			const newMode = this._modeService.create(newLanguage);
			this._textModel.setMode(newMode.languageIdentifier);
		}

		if (this._language === newLanguage) {
			return;
		}

		this._language = newLanguage;
		this._hash = null;
		this._onDidChangeLanguage.fire(newLanguage);
		this._onDidChangeContent.fire('language');
	}

	private _textBuffer!: model.IReadonlyTextBuffer;

	get textBuffer() {
		if (this._textBuffer) {
			return this._textBuffer;
		}

		const builder = new PieceTreeTextBufferBuilder();
		builder.acceptChunk(this._source);
		const bufferFactory = builder.finish(true);
		const { textBuffer, disposable } = bufferFactory.create(model.DefaultEndOfLine.LF);
		this._textBuffer = textBuffer;
		this._register(disposable);

		this._register(this._textBuffer.onDidChangeContent(() => {
			this._hash = null;
			if (!this._textModel) {
				this._onDidChangeContent.fire('content');
			}
		}));

		return this._textBuffer;
	}

	private _hash: number | null = null;

	private _versionId: number = 1;
	private _alternativeId: number = 1;
	get alternativeId(): number {
		return this._alternativeId;
	}

	private _textModelDisposables = new DisposableStore();
	private _textModel: TextModel | undefined = undefined;
	get textModel(): TextModel | undefined {
		return this._textModel;
	}

	set textModel(m: TextModel | undefined) {
		if (this._textModel === m) {
			return;
		}

		this._textModelDisposables.clear();
		this._textModel = m;
		if (this._textModel) {
			// Init language from text model
			this.language = this._textModel.getLanguageIdentifier().language;

			// Listen to language changes on the model
			this._textModelDisposables.add(this._textModel.onDidChangeLanguage(e => {
				this.language = e.newLanguage;
			}));
			this._textModelDisposables.add(this._textModel.onWillDispose(() => this.textModel = undefined));
			this._textModelDisposables.add(this._textModel.onDidChangeContent(() => {
				if (this._textModel) {
					this._versionId = this._textModel.getVersionId();
					this._alternativeId = this._textModel.getAlternativeVersionId();
				}
				this._onDidChangeContent.fire('content');
			}));

			this._textModel._overwriteVersionId(this._versionId);
			this._textModel._overwriteAlternativeVersionId(this._versionId);
		}
	}

	constructor(
		readonly uri: URI,
		public handle: number,
		private _source: string,
		private _language: string,
		public cellKind: CellKind,
		outputs: IOutputDto[],
		metadata: NotebookCellMetadata | undefined,
		public readonly transientOptions: TransientOptions,
		private readonly _modeService: IModeService
	) {
		super();
		this._outputs = outputs.map(op => new NotebookCellOutputTextModel(op));
		this._metadata = metadata || {};
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

	getHashValue(): number {
		if (this._hash !== null) {
			return this._hash;
		}

		this._hash = hash([hash(this.language), hash(this.getValue()), this._getPersisentMetadata(), this.transientOptions.transientOutputs ? [] : this._outputs.map(op => ({
			outputs: op.outputs,
			metadata: op.metadata
		}))]);
		return this._hash;
	}

	private _getPersisentMetadata() {
		let filteredMetadata: { [key: string]: any } = {};
		const transientCellMetadata = this.transientOptions.transientCellMetadata;

		const keys = new Set([...Object.keys(this.metadata)]);
		for (let key of keys) {
			if (!(transientCellMetadata[key as keyof NotebookCellMetadata])
			) {
				filteredMetadata[key] = this.metadata[key as keyof NotebookCellMetadata];
			}
		}

		return filteredMetadata;
	}

	getTextLength(): number {
		return this.textBuffer.getLength();
	}

	getFullModelRange() {
		const lineCount = this.textBuffer.getLineCount();
		return new Range(1, 1, lineCount, this.textBuffer.getLineLength(lineCount) + 1);
	}

	spliceNotebookCellOutputs(splices: NotebookCellOutputsSplice[]): void {
		if (splices.length > 0) {
			splices.reverse().forEach(splice => {
				this.outputs.splice(splice[0], splice[1], ...splice[2]);
			});
			this._onDidChangeOutputs.fire(splices);
		}
	}
	override dispose() {
		// Manually release reference to previous text buffer to avoid large leaks
		// in case someone leaks a CellTextModel reference
		const emptyDisposedTextBuffer = new PieceTreeTextBuffer([], '', '\n', false, false, true, true);
		emptyDisposedTextBuffer.dispose();
		this._textBuffer = emptyDisposedTextBuffer;
		super.dispose();
	}
}

export function cloneMetadata(cell: NotebookCellTextModel) {
	return {
		...cell.metadata
	};
}

export function cloneNotebookCellTextModel(cell: NotebookCellTextModel) {
	return {
		source: cell.getValue(),
		language: cell.language,
		cellKind: cell.cellKind,
		outputs: cell.outputs.map(output => ({
			outputs: output.outputs,
			/* paste should generate new outputId */ outputId: UUID.generateUuid()
		})),
		metadata: cloneMetadata(cell)
	};
}

function computeRunStartTimeAdjustment(oldMetadata: NotebookCellMetadata, newMetadata: NotebookCellMetadata): number | undefined {
	if (oldMetadata.runStartTime !== newMetadata.runStartTime && typeof newMetadata.runStartTime === 'number') {
		const offset = Date.now() - newMetadata.runStartTime;
		return offset < 0 ? Math.abs(offset) : 0;
	} else {
		return newMetadata.runStartTimeAdjustment;
	}
}
