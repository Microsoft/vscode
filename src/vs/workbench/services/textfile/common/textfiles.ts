/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ISaveOptions, IRevertOptions, SaveReason } from 'vs/workbench/common/editor';
import { ReadableStream } from 'vs/base/common/stream';
import { IBaseStatWithMetadata, IFileStatWithMetadata, IWriteFileOptions, FileOperationError, FileOperationResult, IReadFileStreamOptions } from 'vs/platform/files/common/files';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITextEditorModel } from 'vs/editor/common/services/resolverService';
import { ITextBufferFactory, ITextModel, ITextSnapshot } from 'vs/editor/common/model';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { areFunctions, isUndefinedOrNull } from 'vs/base/common/types';
import { IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { IUntitledTextEditorModelManager } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';
import { IFileOperationUndoRedoInfo } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';

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
	saveAs(resource: URI, targetResource?: URI, options?: ITextFileSaveAsOptions): Promise<URI | undefined>;

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
	 * Create files. If the file exists it will be overwritten with the contents if
	 * the options enable to overwrite.
	 */
	create(operations: { resource: URI, value?: string | ITextSnapshot, options?: { overwrite?: boolean } }[], undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Returns the readable that uses the appropriate encoding. This method should
	 * be used whenever a `string` or `ITextSnapshot` is being persisted to the
	 * file system.
	 */
	getEncodedReadable(resource: URI, value: ITextSnapshot, options?: IWriteTextFileOptions): Promise<VSBufferReadable>;
	getEncodedReadable(resource: URI, value: string, options?: IWriteTextFileOptions): Promise<VSBuffer>;
	getEncodedReadable(resource: URI, value?: ITextSnapshot, options?: IWriteTextFileOptions): Promise<VSBufferReadable | undefined>;
	getEncodedReadable(resource: URI, value?: string, options?: IWriteTextFileOptions): Promise<VSBuffer | undefined>;
	getEncodedReadable(resource: URI, value?: string | ITextSnapshot, options?: IWriteTextFileOptions): Promise<VSBuffer | VSBufferReadable | undefined>;

	/**
	 * Returns a stream of strings that uses the appropriate encoding. This method should
	 * be used whenever a `VSBufferReadableStream` is being loaded from the file system.
	 */
	getDecodedStream(resource: URI, value: VSBufferReadableStream, options?: IReadTextFileEncodingOptions): Promise<ReadableStream<string>>;
}

export interface IReadTextFileEncodingOptions {

	/**
	 * The optional encoding parameter allows to specify the desired encoding when resolving
	 * the contents of the file.
	 */
	readonly encoding?: string;

	/**
	 * The optional guessEncoding parameter allows to guess encoding from content of the file.
	 */
	readonly autoGuessEncoding?: boolean;
}

export interface IReadTextFileOptions extends IReadTextFileEncodingOptions, IReadFileStreamOptions {

	/**
	 * The optional acceptTextOnly parameter allows to fail this request early if the file
	 * contents are not textual.
	 */
	readonly acceptTextOnly?: boolean;
}

export interface IWriteTextFileOptions extends IWriteFileOptions {

	/**
	 * The encoding to use when updating a file.
	 */
	readonly encoding?: string;

	/**
	 * Whether to write to the file as elevated (admin) user. When setting this option a prompt will
	 * ask the user to authenticate as super user.
	 */
	readonly writeElevated?: boolean;
}

export const enum TextFileOperationResult {
	FILE_IS_BINARY
}

export class TextFileOperationError extends FileOperationError {

	static isTextFileOperationError(obj: unknown): obj is TextFileOperationError {
		return obj instanceof Error && !isUndefinedOrNull((obj as TextFileOperationError).textFileOperationResult);
	}

	override readonly options?: IReadTextFileOptions & IWriteTextFileOptions;

	constructor(
		message: string,
		public textFileOperationResult: TextFileOperationResult,
		options?: IReadTextFileOptions & IWriteTextFileOptions
	) {
		super(message, FileOperationResult.FILE_OTHER_ERROR);

		this.options = options;
	}
}

export interface IResourceEncodings {
	getPreferredWriteEncoding(resource: URI, preferredEncoding?: string): Promise<IResourceEncoding>;
}

export interface IResourceEncoding {
	readonly encoding: string;
	readonly hasBOM: boolean;
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

export const enum TextFileResolveReason {
	EDITOR = 1,
	REFERENCE = 2,
	OTHER = 3
}

interface IBaseTextFileContent extends IBaseStatWithMetadata {

	/**
	 * The encoding of the content if known.
	 */
	readonly encoding: string;
}

export interface ITextFileContent extends IBaseTextFileContent {

	/**
	 * The content of a text file.
	 */
	readonly value: string;
}

export interface ITextFileStreamContent extends IBaseTextFileContent {

	/**
	 * The line grouped content of a text file.
	 */
	readonly value: ITextBufferFactory;
}

export interface ITextFileEditorModelResolveOrCreateOptions {

	/**
	 * Context why the model is being resolved or created.
	 */
	readonly reason?: TextFileResolveReason;

	/**
	 * The language mode to use for the model text content.
	 */
	readonly mode?: string;

	/**
	 * The encoding to use when resolving the model text content.
	 */
	readonly encoding?: string;

	/**
	 * The contents to use for the model if known. If not
	 * provided, the contents will be retrieved from the
	 * underlying resource or backup if present.
	 */
	readonly contents?: ITextBufferFactory;

	/**
	 * If the model was already resolved before, allows to trigger
	 * a reload of it to fetch the latest contents:
	 * - async: resolve() will return immediately and trigger
	 * a reload that will run in the background.
	 * - sync: resolve() will only return resolved when the
	 * model has finished reloading.
	 */
	readonly reload?: {
		readonly async: boolean
	};

	/**
	 * Allow to resolve a model even if we think it is a binary file.
	 */
	readonly allowBinary?: boolean;
}

export interface ITextFileSaveEvent {
	readonly model: ITextFileEditorModel;
	readonly reason: SaveReason;
}

export interface ITextFileResolveEvent {
	readonly model: ITextFileEditorModel;
	readonly reason: TextFileResolveReason;
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
	readonly onDidResolve: Event<ITextFileResolveEvent>;
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
	 * Allows to resolve a text file model from disk.
	 */
	resolve(resource: URI, options?: ITextFileEditorModelResolveOrCreateOptions): Promise<ITextFileEditorModel>;

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
	 * Save the file with an attempt to unlock it.
	 */
	readonly writeUnlock?: boolean;

	/**
	 * Save the file with elevated privileges.
	 *
	 * Note: This may not be supported in all environments.
	 */
	readonly writeElevated?: boolean;

	/**
	 * Allows to write to a file even if it has been modified on disk.
	 */
	readonly ignoreModifiedSince?: boolean;

	/**
	 * If set, will bubble up the error to the caller instead of handling it.
	 */
	readonly ignoreErrorHandler?: boolean;
}

export interface ITextFileSaveAsOptions extends ITextFileSaveOptions {

	/**
	 * Optional URI to use as suggested file path to save as.
	 */
	readonly suggestedTarget?: URI;
}

export interface ITextFileResolveOptions {

	/**
	 * The contents to use for the model if known. If not
	 * provided, the contents will be retrieved from the
	 * underlying resource or backup if present.
	 */
	readonly contents?: ITextBufferFactory;

	/**
	 * Go to file bypassing any cache of the model if any.
	 */
	readonly forceReadFromFile?: boolean;

	/**
	 * Allow to resolve a model even if we think it is a binary file.
	 */
	readonly allowBinary?: boolean;

	/**
	 * Context why the model is being resolved.
	 */
	readonly reason?: TextFileResolveReason;
}

export const enum EncodingMode {

	/**
	 * Instructs the encoding support to encode the object with the provided encoding
	 */
	Encode,

	/**
	 * Instructs the encoding support to decode the object with the provided encoding
	 */
	Decode
}

export interface IEncodingSupport {

	/**
	 * Gets the encoding of the object if known.
	 */
	getEncoding(): string | undefined;

	/**
	 * Sets the encoding for the object for saving.
	 */
	setEncoding(encoding: string, mode: EncodingMode): Promise<void>;
}

export interface IModeSupport {

	/**
	 * Sets the language mode of the object.
	 */
	setMode(mode: string): void;
}

export interface ITextFileEditorModel extends ITextEditorModel, IEncodingSupport, IModeSupport, IWorkingCopy {

	readonly onDidChangeContent: Event<void>;
	readonly onDidSaveError: Event<void>;
	readonly onDidChangeOrphaned: Event<void>;
	readonly onDidChangeEncoding: Event<void>;

	hasState(state: TextFileEditorModelState): boolean;
	joinState(state: TextFileEditorModelState.PENDING_SAVE): Promise<void>;

	updatePreferredEncoding(encoding: string | undefined): void;

	save(options?: ITextFileSaveOptions): Promise<boolean>;
	revert(options?: IRevertOptions): Promise<void>;

	resolve(options?: ITextFileResolveOptions): Promise<void>;

	isDirty(): this is IResolvedTextFileEditorModel;

	getMode(): string | undefined;

	isResolved(): this is IResolvedTextFileEditorModel;
}

export function isTextFileEditorModel(model: ITextEditorModel): model is ITextFileEditorModel {
	const candidate = model as ITextFileEditorModel;

	return areFunctions(candidate.setEncoding, candidate.getEncoding, candidate.save, candidate.revert, candidate.isDirty, candidate.getMode);
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

	return {
		read: () => {
			const chunk = value.read();
			if (typeof chunk === 'string') {
				return VSBuffer.fromString(chunk);
			}

			return null;
		}
	};
}
