/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as path from 'vs/base/common/path';
import { createWriteStream, WriteStream } from 'fs';
import { Readable } from 'stream';
import { Sequencer, createCancelablePromise } from 'vs/base/common/async';
import { mkdirp, rimraf } from 'vs/base/node/pfs';
import { open as _openZip, Entry, ZipFile } from 'yauzl';
import * as yazl from 'yazl';
import { CancellationToken } from 'vs/base/common/cancellation';

export interface IExtractOptions {
	overwrite?: boolean;

	/**
	 * Source path within the ZIP archive. Only the files contained in this
	 * path will be extracted.
	 */
	sourcePath?: string;
}

interface IOptions {
	sourcePathRegex: RegExp;
}

export type ExtractErrorType = 'CorruptZip' | 'Incomplete';

export class ExtractError extends Error {

	readonly type?: ExtractErrorType;
	readonly cause: Error;

	constructor(type: ExtractErrorType | undefined, cause: Error) {
		let message = cause.message;

		switch (type) {
			case 'CorruptZip': message = `Corrupt ZIP: ${message}`; break;
		}

		super(message);
		this.type = type;
		this.cause = cause;
	}
}

function modeFromEntry(entry: Entry) {
	const attr = entry.externalFileAttributes >> 16 || 33188;

	return [448 /* S_IRWXU */, 56 /* S_IRWXG */, 7 /* S_IRWXO */]
		.map(mask => attr & mask)
		.reduce((a, b) => a + b, attr & 61440 /* S_IFMT */);
}

function toExtractError(err: Error): ExtractError {
	if (err instanceof ExtractError) {
		return err;
	}

	let type: ExtractErrorType | undefined = undefined;

	if (/end of central directory record signature not found/.test(err.message)) {
		type = 'CorruptZip';
	}

	return new ExtractError(type, err);
}

function extractEntry(stream: Readable, fileName: string, mode: number, targetPath: string, options: IOptions, token: CancellationToken): Promise<void> {
	const dirName = path.dirname(fileName);
	const targetDirName = path.join(targetPath, dirName);
	if (targetDirName.indexOf(targetPath) !== 0) {
		return Promise.reject(new Error(nls.localize('invalid file', "Error extracting {0}. Invalid file.", fileName)));
	}
	const targetFileName = path.join(targetPath, fileName);

	let istream: WriteStream;

	token.onCancellationRequested(() => {
		if (istream) {
			istream.destroy();
		}
	});

	return Promise.resolve(mkdirp(targetDirName)).then(() => new Promise<void>((c, e) => {
		if (token.isCancellationRequested) {
			return;
		}

		try {
			istream = createWriteStream(targetFileName, { mode });
			istream.once('close', () => c());
			istream.once('error', e);
			stream.once('error', e);
			stream.pipe(istream);
		} catch (error) {
			e(error);
		}
	}));
}

function extractZip(zipfile: ZipFile, targetPath: string, options: IOptions, token: CancellationToken): Promise<void> {
	let last = createCancelablePromise<void>(() => Promise.resolve());
	let extractedEntriesCount = 0;

	token.onCancellationRequested(() => {
		last.cancel();
		zipfile.close();
	});

	return new Promise((c, e) => {
		const throttler = new Sequencer();

		const readNextEntry = (token: CancellationToken) => {
			if (token.isCancellationRequested) {
				return;
			}

			extractedEntriesCount++;
			zipfile.readEntry();
		};

		zipfile.once('error', e);
		zipfile.once('close', () => last.then(() => {
			if (token.isCancellationRequested || zipfile.entryCount === extractedEntriesCount) {
				c();
			} else {
				e(new ExtractError('Incomplete', new Error(nls.localize('incompleteExtract', "Incomplete. Found {0} of {1} entries", extractedEntriesCount, zipfile.entryCount))));
			}
		}, e));
		zipfile.readEntry();
		zipfile.on('entry', (entry: Entry) => {

			if (token.isCancellationRequested) {
				return;
			}

			if (!options.sourcePathRegex.test(entry.fileName)) {
				readNextEntry(token);
				return;
			}

			const fileName = entry.fileName.replace(options.sourcePathRegex, '');

			// directory file names end with '/'
			if (/\/$/.test(fileName)) {
				const targetFileName = path.join(targetPath, fileName);
				last = createCancelablePromise(token => mkdirp(targetFileName).then(() => readNextEntry(token)).then(undefined, e));
				return;
			}

			const stream = openZipStream(zipfile, entry);
			const mode = modeFromEntry(entry);

			last = createCancelablePromise(token => throttler.queue(() => stream.then(stream => extractEntry(stream, fileName, mode, targetPath, options, token).then(() => readNextEntry(token)))).then(null, e));
		});
	});
}

function openZip(zipFile: string, lazy: boolean = false): Promise<ZipFile> {
	return new Promise((resolve, reject) => {
		_openZip(zipFile, lazy ? { lazyEntries: true } : undefined!, (error?: Error, zipfile?: ZipFile) => {
			if (error) {
				reject(toExtractError(error));
			} else {
				resolve(zipfile);
			}
		});
	});
}

function openZipStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
	return new Promise((resolve, reject) => {
		zipFile.openReadStream(entry, (error?: Error, stream?: Readable) => {
			if (error) {
				reject(toExtractError(error));
			} else {
				resolve(stream);
			}
		});
	});
}

export interface IFile {
	path: string;
	contents?: Buffer | string;
	localPath?: string;
}

export function zip(zipPath: string, files: IFile[]): Promise<string> {
	return new Promise<string>((c, e) => {
		const zip = new yazl.ZipFile();
		files.forEach(f => {
			if (f.contents) {
				zip.addBuffer(typeof f.contents === 'string' ? Buffer.from(f.contents, 'utf8') : f.contents, f.path);
			} else if (f.localPath) {
				zip.addFile(f.localPath, f.path);
			}
		});
		zip.end();

		const zipStream = createWriteStream(zipPath);
		zip.outputStream.pipe(zipStream);

		zip.outputStream.once('error', e);
		zipStream.once('error', e);
		zipStream.once('finish', () => c(zipPath));
	});
}

export function extract(zipPath: string, targetPath: string, options: IExtractOptions = {}, token: CancellationToken): Promise<void> {
	const sourcePathRegex = new RegExp(options.sourcePath ? `^${options.sourcePath}` : '');

	let promise = openZip(zipPath, true);

	if (options.overwrite) {
		promise = promise.then(zipfile => rimraf(targetPath).then(() => zipfile));
	}

	return promise.then(zipfile => extractZip(zipfile, targetPath, { sourcePathRegex }, token));
}

function read(zipPath: string, filePath: string): Promise<Readable> {
	return openZip(zipPath).then(zipfile => {
		return new Promise<Readable>((c, e) => {
			zipfile.on('entry', (entry: Entry) => {
				if (entry.fileName === filePath) {
					openZipStream(zipfile, entry).then(stream => c(stream), err => e(err));
				}
			});

			zipfile.once('close', () => e(new Error(nls.localize('notFound', "{0} not found inside zip.", filePath))));
		});
	});
}

export function buffer(zipPath: string, filePath: string): Promise<Buffer> {
	return read(zipPath, filePath).then(stream => {
		return new Promise<Buffer>((c, e) => {
			const buffers: Buffer[] = [];
			stream.once('error', e);
			stream.on('data', (b: Buffer) => buffers.push(b));
			stream.on('end', () => c(Buffer.concat(buffers)));
		});
	});
}
