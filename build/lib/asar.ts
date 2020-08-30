/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as path from 'path';
import * as es from 'event-stream';
const pickle = require('chromium-pickle-js');
const Filesystem = require('asar/lib/filesystem');
import * as VinylFile from 'vinyl';
import * as minimatch from 'minimatch';

export function createAsar(folderPath: string, unpackGlobs: string[], destFilename: string): NodeJS.ReadWriteStream {

	const shouldUnpackFile = (file: VinylFile): boolean => {
		for (let i = 0; i < unpackGlobs.length; i++) {
			if (minimatch(file.relative, unpackGlobs[i])) {
				return true;
			}
		}
		return false;
	};

	const filesystem = new Filesystem(folderPath);
	const out: Buffer[] = [];

	// Keep track of pending inserts
	let pendingInserts = 0;
	let onFileInserted = () => { pendingInserts--; };

	// Do not insert twice the same directory
	const seenDir: { [key: string]: boolean; } = {};
	const insertDirectoryRecursive = (dir: string) => {
		if (seenDir[dir]) {
			return;
		}

		let lastSlash = dir.lastIndexOf('/');
		if (lastSlash === -1) {
			lastSlash = dir.lastIndexOf('\\');
		}
		if (lastSlash !== -1) {
			insertDirectoryRecursive(dir.substring(0, lastSlash));
		}
		seenDir[dir] = true;
		filesystem.insertDirectory(dir);
	};

	const insertDirectoryForFile = (file: string) => {
		let lastSlash = file.lastIndexOf('/');
		if (lastSlash === -1) {
			lastSlash = file.lastIndexOf('\\');
		}
		if (lastSlash !== -1) {
			insertDirectoryRecursive(file.substring(0, lastSlash));
		}
	};

	const insertFile = (relativePath: string, stat: { size: number; mode: number; }, shouldUnpack: boolean) => {
		insertDirectoryForFile(relativePath);
		pendingInserts++;
		filesystem.insertFile(relativePath, shouldUnpack, { stat: stat }, {}, onFileInserted);
	};

	return es.through(function (file) {
		if (file.stat.isDirectory()) {
			return;
		}
		if (!file.stat.isFile()) {
			throw new Error(`unknown item in stream!`);
		}
		const shouldUnpack = shouldUnpackFile(file);
		insertFile(file.relative, { size: file.contents.length, mode: file.stat.mode }, shouldUnpack);

		if (shouldUnpack) {
			// The file goes outside of xx.asar, in a folder xx.asar.unpacked
			const relative = path.relative(folderPath, file.path);
			this.queue(new VinylFile({
				cwd: folderPath,
				base: folderPath,
				path: path.join(destFilename + '.unpacked', relative),
				stat: file.stat,
				contents: file.contents
			}));
		} else {
			// The file goes inside of xx.asar
			out.push(file.contents);
		}
	}, function () {

		let finish = () => {
			{
				const headerPickle = pickle.createEmpty();
				headerPickle.writeString(JSON.stringify(filesystem.header));
				const headerBuf = headerPickle.toBuffer();

				const sizePickle = pickle.createEmpty();
				sizePickle.writeUInt32(headerBuf.length);
				const sizeBuf = sizePickle.toBuffer();

				out.unshift(headerBuf);
				out.unshift(sizeBuf);
			}

			const contents = Buffer.concat(out);
			out.length = 0;

			this.queue(new VinylFile({
				cwd: folderPath,
				base: folderPath,
				path: destFilename,
				contents: contents
			}));
			this.queue(null);
		};

		// Call finish() only when all file inserts have finished...
		if (pendingInserts === 0) {
			finish();
		} else {
			onFileInserted = () => {
				pendingInserts--;
				if (pendingInserts === 0) {
					finish();
				}
			};
		}
	});
}
