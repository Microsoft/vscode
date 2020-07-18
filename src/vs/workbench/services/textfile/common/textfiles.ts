/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IEncodingSupport, IModeSupport, ISaveOptions, IRevertOptions, SaveReason } from 'vs/workbench/common/editor';
import { IBaseStatWithMetadata, IFileStatWithMetadata, IReadFileOptions, IWriteFileOptions, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITextEditorModel } from 'vs/editor/common/services/resolverService';
import { ITextBufferFactory, ITextModel, ITextSnapshot } from 'vs/editor/common/model';
import { VSBuffer, VSBufferReadable } from 'vs/base/common/buffer';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IUntitledTextEditorModelManager } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';

export const ITextFileService = createDecorator<ITextFileService>('textFileService');

export interface ITextFileService extends IDisposable {

	readonly _serviceBrand: undefined;

	/**
	 * Access to the manager of text file editor models providing further
	 * methods to work with them.
	 */
	readonly files: ITextFileEditorModelManager;

	/**
	 * Access to the manager of untitled text editor models providing further
	 * methods to work with them.
	 */
	readonly untitled: IUntitledTextEditorModelManager;

	/**
	 * Helper to determine encoding for resources.
	 */
	readonly encoding: IResourceEncodings;

	/**
	 * A resource is dirty if it has unsaved changes or is an untitled file not yet saved.
	 *
	 * @param resource the resource to check for being dirty
	 */
	isDirty(resource: URI): boolean;

	/**
	 * Saves the resource.
	 *
	 * @param resource the resource to save
	 * @param options optional save options
	 * @return Path of the saved resource or undefined if canceled.
	 */
	save(resource: URI, options?: ITextFileSaveOptions): Promise<URI | undefined>;

	/**
	 * Saves the provided resource asking the user for a file name or using the provided one.
	 *
	 * @param resource the resource to save as.
	 * @param targetResource the optional target to save to.
	 * @param options optional save options
	 * @return Path of the saved resource or undefined if canceled.
	 */
	saveAs(resource: URI, targetResource?: URI, options?: ITextFileSaveOptions): Promise<URI | undefined>;

	/**
	 * Reverts the provided resource.
	 *
	 * @param resource the resource of the file to revert.
	 * @param force to force revert even when the file is not dirty
	 */
	revert(resource: URI, options?: IRevertOptions): Promise<void>;

	/**
	 * Read the contents of a file identified by the resource.
	 */
	read(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileContent>;

	/**
	 * Read the contents of a file identified by the resource as stream.
	 */
	readStream(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileStreamContent>;

	/**
	 * Update a file with given contents.
	 */
	write(resource: URI, value: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<IFileStatWithMetadata>;

	/**
	 * Create a file. If the file exists it will be overwritten with the contents if
	 * the options enable to overwrite.
	 */
	create(resource: URI, contents?: string | ITextSnapshot, options?: { overwrite?: boolean }): Promise<IFileStatWithMetadata>;
}

export interface IReadTextFileOptions extends IReadFileOptions {

	/**
	 * The optional acceptTextOnly parameter allows to fail this request early if the file
	 * contents are not textual.
	 */
	acceptTextOnly?: boolean;

	/**
	 * The optional encoding parameter allows to specify the desired encoding when resolving
	 * the contents of the file.
	 */
	encoding?: string;

	/**
	 * The optional guessEncoding parameter allows to guess encoding from content of the file.
	 */
	autoGuessEncoding?: boolean;
}

export interface IWriteTextFileOptions extends IWriteFileOptions {

	/**
	 * The encoding to use when updating a file.
	 */
	encoding?: string;

	/**
	 * If set to true, will enforce the selected encoding and not perform any detection using BOMs.
	 */
	overwriteEncoding?: boolean;

	/**
	 * Whether to overwrite a file even if it is readonly.
	 */
	overwriteReadonly?: boolean;

	/**
	 * Whether to write to the file as elevated (admin) user. When setting this option a prompt will
	 * ask the user to authenticate as super user.
	 */
	writeElevated?: boolean;
}

export const enum TextFileOperationResult {
	FILE_IS_BINARY
}

export class TextFileOperationError extends FileOperationError {

	static isTextFileOperationError(obj: unknown): obj is TextFileOperationError {
		return obj instanceof Error && !isUndefinedOrNull((obj as TextFileOperationError).textFileOperationResult);
	}

	constructor(
		message: string,
		public textFileOperationResult: TextFileOperationResult,
		public options?: IReadTextFileOptions & IWriteTextFileOptions
	) {
		super(message, FileOperationResult.FILE_OTHER_ERROR);
	}
}

export interface IResourceEncodings {
	getPreferredWriteEncoding(resource: URI, preferredEncoding?: string): Promise<IResourceEncoding>;
}

export interface IResourceEncoding {
	encoding: string;
	hasBOM: boolean;
}

/**
 * The save error handler can be installed on the text file editor model to install code that executes when save errors occur.
 */
export interface ISaveErrorHandler {

	/**
	 * Called whenever a save fails.
	 */
	onSaveError(error: Error, model: ITextFileEditorModel): void;
}

/**
 * States the text file editor model can be in.
 */
export const enum TextFileEditorModelState {

	/**
	 * A model is saved.
	 */
	SAVED,

	/**
	 * A model is dirty.
	 */
	DIRTY,

	/**
	 * A model is currently being saved but this operation has not completed yet.
	 */
	PENDING_SAVE,

	/**
	 * A model is in conflict mode when changes cannot be saved because the
	 * underlying file has changed. Models in conflict mode are always dirty.
	 */
	CONFLICT,

	/**
	 * A model is in orphan state when the underlying file has been deleted.
	 */
	ORPHAN,

	/**
	 * Any error that happens during a save that is not causing the CONFLICT state.
	 * Models in error mode are always dirty.
	 */
	ERROR
}

export const enum TextFileLoadReason {
	EDITOR = 1,
	REFERENCE = 2,
	OTHER = 3
}

interface IBaseTextFileContent extends IBaseStatWithMetadata {

	/**
	 * The encoding of the content if known.
	 */
	encoding: string;
}

export interface ITextFileContent extends IBaseTextFileContent {

	/**
	 * The content of a text file.
	 */
	value: string;
}

export interface ITextFileStreamContent extends IBaseTextFileContent {

	/**
	 * The line grouped content of a text file.
	 */
	value: ITextBufferFactory;
}

export interface ITextFileEditorModelLoadOrCreateOptions {

	/**
	 * Context why the model is being loaded or created.
	 */
	reason?: TextFileLoadReason;

	/**
	 * The language mode to use for the model text content.
	 */
	mode?: string;

	/**
	 * The encoding to use when resolving the model text content.
	 */
	encoding?: string;

	/**
	 * If the model was already loaded before, allows to trigger
	 * a reload of it to fetch the latest contents:
	 * - async: resolve() will return immediately and trigger
	 * a reload that will run in the background.
	 * - sync: resolve() will only return resolved when the
	 * model has finished reloading.
	 */
	reload?: {
		async: boolean
	};

	/**
	 * Allow to load a model even if we think it is a binary file.
	 */
	allowBinary?: boolean;
}

export interface ITextFileSaveEvent {
	model: ITextFileEditorModel;
	reason: SaveReason;
}

export interface ITextFileLoadEvent {
	model: ITextFileEditorModel;
	reason: TextFileLoadReason;
}

export interface ITextFileSaveParticipant {

	/**
	 * Participate in a save of a model. Allows to change the model
	 * before it is being saved to disk.
	 */
	participate(
		model: ITextFileEditorModel,
		context: { reason: SaveReason },
		progress: IProgress<IProgressStep>,
		token: CancellationToken
	): Promise<void>;
}

export interface ITextFileEditorModelManager {

	readonly onDidCreate: Event<ITextFileEditorModel>;
	readonly onDidLoad: Event<ITextFileLoadEvent>;
	readonly onDidChangeDirty: Event<ITextFileEditorModel>;
	readonly onDidChangeEncoding: Event<ITextFileEditorModel>;
	readonly onDidSaveError: Event<ITextFileEditorModel>;
	readonly onDidSave: Event<ITextFileSaveEvent>;
	readonly onDidRevert: Event<ITextFileEditorModel>;

	/**
	 * Access to all text file editor models in memory.
	 */
	readonly models: ITextFileEditorModel[];

	/**
	 * Allows to configure the error handler that is called on save errors.
	 */
	saveErrorHandler: ISaveErrorHandler;

	/**
	 * Returns the text file editor model for the provided resource
	 * or undefined if none.
	 */
	get(resource: URI): ITextFileEditorModel | undefined;

	/**
	 * Allows to load a text file model from disk.
	 */
	resolve(resource: URI, options?: ITextFileEditorModelLoadOrCreateOptions): Promise<ITextFileEditorModel>;

	/**
	 * Adds a participant for saving text file models.
	 */
	addSaveParticipant(participant: ITextFileSaveParticipant): IDisposable;

	/**
	 * Runs the registered save participants on the provided model.
	 */
	runSaveParticipants(model: ITextFileEditorModel, context: { reason: SaveReason; }, token: CancellationToken): Promise<void>

	/**
	 * Waits for the model to be ready to be disposed. There may be conditions
	 * under which the model cannot be disposed, e.g. when it is dirty. Once the
	 * promise is settled, it is safe to dispose the model.
	 */
	canDispose(model: ITextFileEditorModel): true | Promise<true>;
}

export interface ITextFileSaveOptions extends ISaveOptions {

	/**
	 * Makes the file writable if it is readonly.
	 */
	overwriteReadonly?: boolean;

	/**
	 * Overwrite the encoding of the file on disk as configured.
	 */
	overwriteEncoding?: boolean;

	/**
	 * Save the file with elevated privileges.
	 *
	 * Note: This may not be supported in all environments.
	 */
	writeElevated?: boolean;

	/**
	 * Allows to write to a file even if it has been modified on disk.
	 */
	ignoreModifiedSince?: boolean;

	/**
	 * If set, will bubble up the error to the caller instead of handling it.
	 */
	ignoreErrorHandler?: boolean;
}

export interface ITextFileLoadOptions {

	/**
	 * Go to disk bypassing any cache of the model if any.
	 */
	forceReadFromDisk?: boolean;

	/**
	 * Allow to load a model even if we think it is a binary file.
	 */
	allowBinary?: boolean;

	/**
	 * Context why the model is being loaded.
	 */
	reason?: TextFileLoadReason;
}

export interface ITextFileEditorModel extends ITextEditorModel, IEncodingSupport, IModeSupport, IWorkingCopy {

	readonly onDidChangeContent: Event<void>;
	readonly onDidSaveError: Event<void>;
	readonly onDidChangeOrphaned: Event<void>;
	readonly onDidChangeEncoding: Event<void>;

	hasState(state: TextFileEditorModelState): boolean;

	updatePreferredEncoding(encoding: string | undefined): void;

	save(options?: ITextFileSaveOptions): Promise<boolean>;
	revert(options?: IRevertOptions): Promise<void>;

	load(options?: ITextFileLoadOptions): Promise<ITextFileEditorModel>;

	isDirty(): this is IResolvedTextFileEditorModel;

	getMode(): string | undefined;

	isResolved(): this is IResolvedTextFileEditorModel;
	isDisposed(): boolean;
}

export interface IResolvedTextFileEditorModel extends ITextFileEditorModel {

	readonly textEditorModel: ITextModel;

	createSnapshot(): ITextSnapshot;
}

export function snapshotToString(snapshot: ITextSnapshot): string {
	const chunks: string[] = [];

	let chunk: string | null;
	while (typeof (chunk = snapshot.read()) === 'string') {
		chunks.push(chunk);
	}

	return chunks.join('');
}

export function stringToSnapshot(value: string): ITextSnapshot {
	let done = false;

	return {
		read(): string | null {
			if (!done) {
				done = true;

				return value;
			}

			return null;
		}
	};
}

export class TextSnapshotReadable implements VSBufferReadable {
	private preambleHandled = false;

	constructor(private snapshot: ITextSnapshot, private preamble?: string) { }

	read(): VSBuffer | null {
		let value = this.snapshot.read();

		// Handle preamble if provided
		if (!this.preambleHandled) {
			this.preambleHandled = true;

			if (typeof this.preamble === 'string') {
				if (typeof value === 'string') {
					value = this.preamble + value;
				} else {
					value = this.preamble;
				}
			}
		}

		if (typeof value === 'string') {
			return VSBuffer.fromString(value);
		}

		return null;
	}
}

export function toBufferOrReadable(value: string): VSBuffer;
export function toBufferOrReadable(value: ITextSnapshot): VSBufferReadable;
export function toBufferOrReadable(value: string | ITextSnapshot): VSBuffer | VSBufferReadable;
export function toBufferOrReadable(value: string | ITextSnapshot | undefined): VSBuffer | VSBufferReadable | undefined;
export function toBufferOrReadable(value: string | ITextSnapshot | undefined): VSBuffer | VSBufferReadable | undefined {
	if (typeof value === 'undefined') {
		return undefined;
	}

	if (typeof value === 'string') {
		return VSBuffer.fromString(value);
	}

	return new TextSnapshotReadable(value);
}

export const SUPPORTED_ENCODINGS: { [encoding: string]: { labelLong: string; labelShort: string; order: number; encodeOnly?: boolean; alias?: string } } = {
	utf8: {
		labelLong: 'UTF-8',
		labelShort: 'UTF-8',
		order: 1,
		alias: 'utf8bom'
	},
	utf8bom: {
		labelLong: 'UTF-8 with BOM',
		labelShort: 'UTF-8 with BOM',
		encodeOnly: true,
		order: 2,
		alias: 'utf8'
	},
	utf16le: {
		labelLong: 'UTF-16 LE',
		labelShort: 'UTF-16 LE',
		order: 3
	},
	utf16be: {
		labelLong: 'UTF-16 BE',
		labelShort: 'UTF-16 BE',
		order: 4
	},
	windows1252: {
		labelLong: 'Western (Windows 1252)',
		labelShort: 'Windows 1252',
		order: 5
	},
	iso88591: {
		labelLong: 'Western (ISO 8859-1)',
		labelShort: 'ISO 8859-1',
		order: 6
	},
	iso88593: {
		labelLong: 'Western (ISO 8859-3)',
		labelShort: 'ISO 8859-3',
		order: 7
	},
	iso885915: {
		labelLong: 'Western (ISO 8859-15)',
		labelShort: 'ISO 8859-15',
		order: 8
	},
	macroman: {
		labelLong: 'Western (Mac Roman)',
		labelShort: 'Mac Roman',
		order: 9
	},
	cp437: {
		labelLong: 'DOS (CP 437)',
		labelShort: 'CP437',
		order: 10
	},
	windows1256: {
		labelLong: 'Arabic (Windows 1256)',
		labelShort: 'Windows 1256',
		order: 11
	},
	iso88596: {
		labelLong: 'Arabic (ISO 8859-6)',
		labelShort: 'ISO 8859-6',
		order: 12
	},
	windows1257: {
		labelLong: 'Baltic (Windows 1257)',
		labelShort: 'Windows 1257',
		order: 13
	},
	iso88594: {
		labelLong: 'Baltic (ISO 8859-4)',
		labelShort: 'ISO 8859-4',
		order: 14
	},
	iso885914: {
		labelLong: 'Celtic (ISO 8859-14)',
		labelShort: 'ISO 8859-14',
		order: 15
	},
	windows1250: {
		labelLong: 'Central European (Windows 1250)',
		labelShort: 'Windows 1250',
		order: 16
	},
	iso88592: {
		labelLong: 'Central European (ISO 8859-2)',
		labelShort: 'ISO 8859-2',
		order: 17
	},
	cp852: {
		labelLong: 'Central European (CP 852)',
		labelShort: 'CP 852',
		order: 18
	},
	windows1251: {
		labelLong: 'Cyrillic (Windows 1251)',
		labelShort: 'Windows 1251',
		order: 19
	},
	cp866: {
		labelLong: 'Cyrillic (CP 866)',
		labelShort: 'CP 866',
		order: 20
	},
	iso88595: {
		labelLong: 'Cyrillic (ISO 8859-5)',
		labelShort: 'ISO 8859-5',
		order: 21
	},
	koi8r: {
		labelLong: 'Cyrillic (KOI8-R)',
		labelShort: 'KOI8-R',
		order: 22
	},
	koi8u: {
		labelLong: 'Cyrillic (KOI8-U)',
		labelShort: 'KOI8-U',
		order: 23
	},
	iso885913: {
		labelLong: 'Estonian (ISO 8859-13)',
		labelShort: 'ISO 8859-13',
		order: 24
	},
	windows1253: {
		labelLong: 'Greek (Windows 1253)',
		labelShort: 'Windows 1253',
		order: 25
	},
	iso88597: {
		labelLong: 'Greek (ISO 8859-7)',
		labelShort: 'ISO 8859-7',
		order: 26
	},
	windows1255: {
		labelLong: 'Hebrew (Windows 1255)',
		labelShort: 'Windows 1255',
		order: 27
	},
	iso88598: {
		labelLong: 'Hebrew (ISO 8859-8)',
		labelShort: 'ISO 8859-8',
		order: 28
	},
	iso885910: {
		labelLong: 'Nordic (ISO 8859-10)',
		labelShort: 'ISO 8859-10',
		order: 29
	},
	iso885916: {
		labelLong: 'Romanian (ISO 8859-16)',
		labelShort: 'ISO 8859-16',
		order: 30
	},
	windows1254: {
		labelLong: 'Turkish (Windows 1254)',
		labelShort: 'Windows 1254',
		order: 31
	},
	iso88599: {
		labelLong: 'Turkish (ISO 8859-9)',
		labelShort: 'ISO 8859-9',
		order: 32
	},
	windows1258: {
		labelLong: 'Vietnamese (Windows 1258)',
		labelShort: 'Windows 1258',
		order: 33
	},
	gbk: {
		labelLong: 'Simplified Chinese (GBK)',
		labelShort: 'GBK',
		order: 34
	},
	gb18030: {
		labelLong: 'Simplified Chinese (GB18030)',
		labelShort: 'GB18030',
		order: 35
	},
	cp950: {
		labelLong: 'Traditional Chinese (Big5)',
		labelShort: 'Big5',
		order: 36
	},
	big5hkscs: {
		labelLong: 'Traditional Chinese (Big5-HKSCS)',
		labelShort: 'Big5-HKSCS',
		order: 37
	},
	shiftjis: {
		labelLong: 'Japanese (Shift JIS)',
		labelShort: 'Shift JIS',
		order: 38
	},
	eucjp: {
		labelLong: 'Japanese (EUC-JP)',
		labelShort: 'EUC-JP',
		order: 39
	},
	euckr: {
		labelLong: 'Korean (EUC-KR)',
		labelShort: 'EUC-KR',
		order: 40
	},
	windows874: {
		labelLong: 'Thai (Windows 874)',
		labelShort: 'Windows 874',
		order: 41
	},
	iso885911: {
		labelLong: 'Latin/Thai (ISO 8859-11)',
		labelShort: 'ISO 8859-11',
		order: 42
	},
	koi8ru: {
		labelLong: 'Cyrillic (KOI8-RU)',
		labelShort: 'KOI8-RU',
		order: 43
	},
	koi8t: {
		labelLong: 'Tajik (KOI8-T)',
		labelShort: 'KOI8-T',
		order: 44
	},
	gb2312: {
		labelLong: 'Simplified Chinese (GB 2312)',
		labelShort: 'GB 2312',
		order: 45
	},
	cp865: {
		labelLong: 'Nordic DOS (CP 865)',
		labelShort: 'CP 865',
		order: 46
	},
	cp850: {
		labelLong: 'Western European DOS (CP 850)',
		labelShort: 'CP 850',
		order: 47
	}
};
