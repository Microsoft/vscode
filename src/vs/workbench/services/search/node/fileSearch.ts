/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import fs = require('fs');
import paths = require('path');
import cp = require('child_process');
import iconv = require('iconv-lite');

import filters = require('vs/base/common/filters');
import arrays = require('vs/base/common/arrays');
import strings = require('vs/base/common/strings');
import glob = require('vs/base/common/glob');
import {IProgress} from 'vs/platform/search/common/search';
import {LineDecoder} from 'vs/base/node/decoder';

import extfs = require('vs/base/node/extfs');
import flow = require('vs/base/node/flow');
import {ISerializedFileMatch, IRawSearch, ISearchEngine} from 'vs/workbench/services/search/node/rawSearchService';

const normalizedPathCache: {[path: string]: string;} = Object.create(null);

export class FileWalker {

	private static ENOTDIR = 'ENOTDIR';

	private config: IRawSearch;
	private filePattern: string;
	private excludePattern: glob.IExpression;
	private includePattern: glob.IExpression;
	private maxResults: number;
	private isLimitHit: boolean;
	private resultCount: number;
	private isCanceled: boolean;
	private searchInPath: boolean;
	private matchFuzzy: boolean;
	private disableFastFileLookup: boolean;

	private runningNative: cp.ChildProcess;
	private verboseLogging: boolean;

	private walkedPaths: { [path: string]: boolean; };

	constructor(config: IRawSearch) {
		this.config = config;
		this.filePattern = config.filePattern;
		this.matchFuzzy = config.matchFuzzy;
		this.disableFastFileLookup = config.disableFastFileLookup;
		this.excludePattern = config.excludePattern;
		this.includePattern = config.includePattern;
		this.maxResults = config.maxResults || null;
		this.walkedPaths = Object.create(null);
		this.verboseLogging = !!process.env.VERBOSE_LOGGING;

		// Normalize file patterns to forward slashs
		if (this.filePattern && this.filePattern.indexOf(paths.sep) >= 0) {
			this.filePattern = strings.replaceAll(this.filePattern, '\\', '/');
			this.searchInPath = true;
		}
	}

	private resetState(): void {
		this.walkedPaths = Object.create(null);
		this.resultCount = 0;
		this.isLimitHit = false;
		this.terminateNative();
	}

	public cancel(): void {
		this.isCanceled = true;
		this.terminateNative();
	}

	private terminateNative(): void {
		if (this.runningNative) {
			this.runningNative.kill();
			this.runningNative = null;
		}
	}

	public walk(rootPaths: string[], onResult: (result: ISerializedFileMatch) => void, done: (error: Error, isLimitHit: boolean) => void): void {

		// Reset state
		this.resetState();

		// Support that the file pattern is a full path to a file that exists
		this.checkFilePatternAbsoluteMatch(rootPaths, (exists) => {

			// Report result from file pattern if matching
			if (exists) {
				onResult({ path: this.filePattern });
			}

			// For each source
			flow.parallel(rootPaths, (absolutePath, perEntryCallback) => {

				// Try to Read as folder
				extfs.readdir(absolutePath, (error: Error, files: string[]) => {
					if (this.isCanceled || this.isLimitHit) {
						return perEntryCallback(null, null);
					}

					// Handle Directory
					if (!error) {

						// Support relative paths to files from a root resource
						return this.checkFilePatternRelativeMatch(absolutePath, (match) => {

							// Report result from file pattern if matching
							if (match) {
								onResult({ path: match });
							}

							// Recurse into children
							return this.recurse(absolutePath, files, onResult, perEntryCallback);
						});
					}

					// Not a folder - deal with file result then
					if ((<any>error).code === FileWalker.ENOTDIR && !this.isCanceled && !this.isLimitHit) {

						// Check exclude pattern
						if (glob.match(this.excludePattern, absolutePath)) {
							return perEntryCallback(null, null);
						}

						// Check for match on file pattern and include pattern
						if (this.isFilePatternMatch(paths.basename(absolutePath), absolutePath) && (!this.includePattern || glob.match(this.includePattern, absolutePath))) {
							this.resultCount++;

							if (this.maxResults && this.resultCount > this.maxResults) {
								this.isLimitHit = true;
							}

							if (!this.isLimitHit) {
								onResult({
									path: absolutePath
								});
							}
						}
					}

					// Unwind
					return perEntryCallback(null, null);
				});
			}, (err, result) => {
				done(err ? err[0] : null, this.isLimitHit);
			});
		});
	}

	private checkFilePatternAbsoluteMatch(rootPaths: string[], clb: (exists: boolean) => void): void {
		if (!this.filePattern || !paths.isAbsolute(this.filePattern)) {
			return clb(false);
		}

		if (rootPaths && rootPaths.some(r => r === this.filePattern)) {
			return clb(false); // root paths matches are handled already (prevents duplicates)
		}

		return fs.stat(this.filePattern, (error, stat) => {
			return clb(!error && !stat.isDirectory()); // only existing files
		});
	}

	private checkFilePatternRelativeMatch(basePath: string, clb: (matchPath: string) => void): void {
		if (!this.filePattern || paths.isAbsolute(this.filePattern) || !this.searchInPath) {
			return clb(null);
		}

		const absolutePath = paths.join(basePath, this.filePattern);

		return fs.stat(absolutePath, (error, stat) => {
			return clb(!error && !stat.isDirectory() ? absolutePath : null); // only existing files
		});
	}

	private recurse(absolutePath: string, files: string[], onResult: (result: ISerializedFileMatch) => void, done: (error: Error, isLimitHit: boolean) => void): void {
		// CLASSIC_FILE_WALK: Classic node.js APIs use
		// Windows: Use "dir" command
		// Mac/Linux: Use "find" command

		if (this.disableFastFileLookup) {
			return this.recurseWithNodeJS(absolutePath, '', files, onResult, done);
		}

		return this.recurseWithNativeCommand(absolutePath, onResult, done);
	}

	private recurseWithNodeJS(absolutePath: string, relativeParentPath: string, files: string[], onResult: (result: ISerializedFileMatch) => void, done: (error: Error, result: any) => void): void {

		// Execute tasks on each file in parallel to optimize throughput
		flow.parallel(files, (file: string, clb: (error: Error) => void): void => {

			// Check canceled
			if (this.isCanceled || this.isLimitHit) {
				return clb(null);
			}

			// If the user searches for the exact file name, we adjust the glob matching
			// to ignore filtering by siblings because the user seems to know what she
			// is searching for and we want to include the result in that case anyway
			let siblings = files;
			if (this.config.filePattern === file) {
				siblings = [];
			}

			// Check exclude pattern
			let relativeFilePath = strings.trim([relativeParentPath, file].join('/'), '/');
			if (glob.match(this.excludePattern, relativeFilePath, siblings)) {
				return clb(null);
			}

			// Try to read dir
			let currentPath = paths.join(absolutePath, file);
			extfs.readdir(currentPath, (error: Error, children: string[]): void => {

				// Handle directory
				if (!error) {

					// to really prevent loops with links we need to resolve the real path of them
					return this.realPathLink(currentPath, (error, realpath) => {
						if (error) {
							return clb(null); // ignore errors
						}

						if (this.walkedPaths[realpath]) {
							return clb(null); // escape when there are cycles (can happen with symlinks)
						} else {
							this.walkedPaths[realpath] = true; // remember as walked
						}

						// Continue walking
						this.recurseWithNodeJS(currentPath, relativeFilePath, children, onResult, clb);
					});
				}

				// Handle file if we are not canceled and have not hit the limit yet
				if ((<any>error).code === FileWalker.ENOTDIR && !this.isCanceled && !this.isLimitHit) {

					// Check for match on file pattern and include pattern
					if (this.isFilePatternMatch(file, relativeFilePath) && (!this.includePattern || glob.match(this.includePattern, relativeFilePath, children))) {
						this.resultCount++;

						if (this.maxResults && this.resultCount > this.maxResults) {
							this.isLimitHit = true;
						}

						if (!this.isLimitHit) {
							onResult({
								path: currentPath
							});
						}
					}
				}

				// Unwind
				return clb(null);
			});
		}, (error: Error[]): void => {
			if (error) {
				error = arrays.coalesce(error); // find any error by removing null values first
			}

			return done(error && error.length > 0 ? error[0] : null, null);
		});
	}

	private isFilePatternMatch(name: string, path: string): boolean {

		// Check for search pattern
		if (this.filePattern) {
			const res = filters.matchesFuzzy(this.filePattern, this.matchFuzzy || this.searchInPath ? path : name, this.matchFuzzy);

			return !!res && res.length > 0;
		}

		// No patterns means we match all
		return true;
	}

	private realPathLink(path: string, clb: (error: Error, realpath?: string) => void): void {
		return fs.lstat(path, (error, lstat) => {
			if (error) {
				return clb(error);
			}

			if (lstat.isSymbolicLink()) {
				return fs.realpath(path, (error, realpath) => {
					if (error) {
						return clb(error);
					}

					return clb(null, realpath);
				});
			}

			return clb(null, path);
		});
	}

	private recurseWithNativeCommand(absolutePath: string, onResult: (result: ISerializedFileMatch) => void, done: (error: Error, result: any) => void): void {
		let cmd: cp.ChildProcess;

		let needsDecoding = false; 			// Windows
		let usesBackslash = false; 			// Windows
		let needsNFCNormalization = false; 	// Mac

		// Use native command to find files (follow symlinks)
		if (process.platform === 'darwin') {
			cmd = cp.spawn('find', ['-L', absolutePath, '-type', 'f']);
			needsNFCNormalization = true;
		} else if (process.platform === 'linux') {
			cmd = cp.spawn('find', [absolutePath, '-type', 'f', '-follow']);
		} else {
			cmd = cp.spawn('cmd', ['/U', '/c', 'dir', absolutePath, '/s', '/b', '/a-d']);
			needsDecoding = true; // /U enables unicode (UTF16le = ucs2) output
			usesBackslash = true;
		}

		// Store globally so that we can kill the command if we get canceled
		this.runningNative = cmd;

		let stdoutLineDecoder = new LineDecoder();
		let mapFoldersToFilepaths: { [path: string]: string[] } = Object.create(null);
		let mapFoldersToFilenames: { [path: string]: string[] } = Object.create(null);

		let perPathHandler = function(p: string): void {
			if (!p) {
				return;
			}

			if (needsNFCNormalization) {
				p = strings.normalizeNFC(p, normalizedPathCache);
			}

			// Map parents to children (full path)
			let parent = paths.dirname(p);
			let siblings = mapFoldersToFilepaths[parent];
			if (!siblings) {
				siblings = [p];
				mapFoldersToFilepaths[parent] = siblings;
			} else {
				siblings.push(p);
			}

			// Map parents to children (basename)
			let basename = paths.basename(p);
			siblings = mapFoldersToFilenames[parent];
			if (!siblings) {
				siblings = [basename];
				mapFoldersToFilenames[parent] = siblings;
			} else {
				siblings.push(basename);
			}
		};

		let toRelativeWithSlash = function(path: string): string {
			let relativeFilePath = path.substr(absolutePath.length + 1 /* leading slash */);

			return usesBackslash ? strings.replaceAll(relativeFilePath, '\\', '/') : relativeFilePath;
		}

		cmd.stdout.on('data', (data) => {
			if (!this.isCanceled) {
				stdoutLineDecoder.write(needsDecoding ? iconv.decode(data, 'ucs2') : data).forEach(p => perPathHandler(p));
			}
		});

		cmd.stderr.on('data', (data) => {
			if (!this.isCanceled && this.verboseLogging) {
				console.error(needsDecoding ? iconv.decode(data, 'ucs2') : data);
			}
		});

		cmd.on('close', (code) => {
			this.runningNative = null;

			if (!this.isCanceled) {
				if (code && this.verboseLogging) {
					console.error('Native file walker exited abnormaly with code: ' + code);
				}

				// consume last line from decoder
				perPathHandler(stdoutLineDecoder.end());

				// From all folders we walked by...
				[].concat.apply([], Object.keys(mapFoldersToFilepaths)

					// ...only take those that are not excluded by patterns...
					.filter(p => {
						let relativeFilePath = toRelativeWithSlash(p);
						do {
							if (glob.match(this.excludePattern, relativeFilePath)) {
								return false; // exclude
							}
						} while ((relativeFilePath = paths.dirname(relativeFilePath)) !== '.'); // walk parents up until root is reached

						return true; // keep
					})

					// ...and concat all arrays of children into one array...
					.map(p => mapFoldersToFilepaths[p]))

					// ...to iterate over them!
					.forEach(p => {
						if (this.isLimitHit) {
							return;
						}

						let relativeFilePath = toRelativeWithSlash(p);
						let filename = paths.basename(p);
						let siblings = mapFoldersToFilenames[paths.dirname(p)];

						// If the user searches for the exact file name, we adjust the glob matching
						// to ignore filtering by siblings because the user seems to know what she
						// is searching for and we want to include the result in that case anyway
						if (this.config.filePattern === filename) {
							siblings = [];
						}

						// Exclude
						if (glob.match(this.excludePattern, relativeFilePath, siblings)) {
							return;
						}

						// Include
						if (this.isFilePatternMatch(filename, relativeFilePath) && (!this.includePattern || glob.match(this.includePattern, relativeFilePath, siblings))) {
							this.resultCount++;

							if (this.maxResults && this.resultCount > this.maxResults) {
								this.isLimitHit = true;
							}

							if (!this.isLimitHit) {
								onResult({
									path: p
								});
							}
						}
					});
			}

			// We are done!
			done(null, null);
		});
	}
}

export class Engine implements ISearchEngine {
	private rootPaths: string[];
	private walker: FileWalker;

	constructor(config: IRawSearch) {
		this.rootPaths = config.rootPaths;
		this.walker = new FileWalker(config);
	}

	public search(onResult: (result: ISerializedFileMatch) => void, onProgress: (progress: IProgress) => void, done: (error: Error, isLimitHit: boolean) => void): void {
		this.walker.walk(this.rootPaths, onResult, done);
	}

	public cancel(): void {
		this.walker.cancel();
	}
}
