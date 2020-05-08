/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import * as gulp from 'gulp';
import * as concat from 'gulp-concat';
import * as minifyCSS from 'gulp-cssnano';
import * as filter from 'gulp-filter';
import * as flatmap from 'gulp-flatmap';
import * as sourcemaps from 'gulp-sourcemaps';
import * as uglify from 'gulp-uglify';
import * as composer from 'gulp-uglify/composer';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
import * as path from 'path';
import * as pump from 'pump';
import * as sm from 'source-map';
import * as terser from 'terser';
import * as VinylFile from 'vinyl';
import * as bundle from './bundle';
import { Language, processNlsFiles } from './i18n';
import { createStatsStream } from './stats';
import * as util from './util';

const REPO_ROOT_PATH = path.join(__dirname, '../..');

function log(prefix: string, message: string): void {
	fancyLog(ansiColors.cyan('[' + prefix + ']'), message);
}

export function loaderConfig(emptyPaths?: string[]) {
	const result: any = {
		paths: {
			'vs': 'out-build/vs',
			'vscode': 'empty:'
		},
		nodeModules: emptyPaths || []
	};

	result['vs/css'] = { inlineResources: true };

	return result;
}

const IS_OUR_COPYRIGHT_REGEXP = /Copyright \(C\) Microsoft Corporation/i;

declare class FileSourceMap extends VinylFile {
	public sourceMap: sm.RawSourceMap;
}

function loader(src: string, bundledFileHeader: string, bundleLoader: boolean): NodeJS.ReadWriteStream {
	let sources = [
		`${src}/vs/loader.js`
	];
	if (bundleLoader) {
		sources = sources.concat([
			`${src}/vs/css.js`,
			`${src}/vs/nls.js`
		]);
	}

	let isFirst = true;
	return (
		gulp
			.src(sources, { base: `${src}` })
			.pipe(es.through(function (data) {
				if (isFirst) {
					isFirst = false;
					this.emit('data', new VinylFile({
						path: 'fake',
						base: '',
						contents: Buffer.from(bundledFileHeader)
					}));
					this.emit('data', data);
				} else {
					this.emit('data', data);
				}
			}))
			.pipe(concat('vs/loader.js'))
	);
}

function toConcatStream(src: string, bundledFileHeader: string, sources: bundle.IFile[], dest: string): NodeJS.ReadWriteStream {
	const useSourcemaps = /\.js$/.test(dest) && !/\.nls\.js$/.test(dest);

	// If a bundle ends up including in any of the sources our copyright, then
	// insert a fake source at the beginning of each bundle with our copyright
	let containsOurCopyright = false;
	for (let i = 0, len = sources.length; i < len; i++) {
		const fileContents = sources[i].contents;
		if (IS_OUR_COPYRIGHT_REGEXP.test(fileContents)) {
			containsOurCopyright = true;
			break;
		}
	}

	if (containsOurCopyright) {
		sources.unshift({
			path: null,
			contents: bundledFileHeader
		});
	}

	const treatedSources = sources.map(function (source) {
		const root = source.path ? REPO_ROOT_PATH.replace(/\\/g, '/') : '';
		const base = source.path ? root + `/${src}` : '';

		return new VinylFile({
			path: source.path ? root + '/' + source.path.replace(/\\/g, '/') : 'fake',
			base: base,
			contents: Buffer.from(source.contents)
		});
	});

	return es.readArray(treatedSources)
		.pipe(useSourcemaps ? util.loadSourcemaps() : es.through())
		.pipe(concat(dest))
		.pipe(createStatsStream(dest));
}

function toBundleStream(src: string, bundledFileHeader: string, bundles: bundle.IConcatFile[]): NodeJS.ReadWriteStream {
	return es.merge(bundles.map(function (bundle) {
		return toConcatStream(src, bundledFileHeader, bundle.sources, bundle.dest);
	}));
}

export interface IOptimizeTaskOpts {
	/**
	 * The folder to read files from.
	 */
	src: string;
	/**
	 * (for AMD files, will get bundled and get Copyright treatment)
	 */
	entryPoints: bundle.IEntryPoint[];
	/**
	 * (svg, etc.)
	 */
	resources: string[];
	loaderConfig: any;
	/**
	 * (true by default - append css and nls to loader)
	 */
	bundleLoader?: boolean;
	/**
	 * (basically the Copyright treatment)
	 */
	header?: string;
	/**
	 * (emit bundleInfo.json file)
	 */
	bundleInfo: boolean;
	/**
	 * (out folder name)
	 */
	out: string;
	/**
	 * (out folder name)
	 */
	languages?: Language[];
}

const DEFAULT_FILE_HEADER = [
	'/*!--------------------------------------------------------',
	' * Copyright (C) Microsoft Corporation. All rights reserved.',
	' *--------------------------------------------------------*/'
].join('\n');

export function optimizeTask(opts: IOptimizeTaskOpts): () => NodeJS.ReadWriteStream {
	const src = opts.src;
	const entryPoints = opts.entryPoints;
	const resources = opts.resources;
	const loaderConfig = opts.loaderConfig;
	const bundledFileHeader = opts.header || DEFAULT_FILE_HEADER;
	const bundleLoader = (typeof opts.bundleLoader === 'undefined' ? true : opts.bundleLoader);
	const out = opts.out;

	return function () {
		const bundlesStream = es.through(); // this stream will contain the bundled files
		const resourcesStream = es.through(); // this stream will contain the resources
		const bundleInfoStream = es.through(); // this stream will contain bundleInfo.json

		bundle.bundle(entryPoints, loaderConfig, function (err, result) {
			if (err || !result) { return bundlesStream.emit('error', JSON.stringify(err)); }

			toBundleStream(src, bundledFileHeader, result.files).pipe(bundlesStream);

			// Remove css inlined resources
			const filteredResources = resources.slice();
			result.cssInlinedResources.forEach(function (resource) {
				if (process.env['VSCODE_BUILD_VERBOSE']) {
					log('optimizer', 'excluding inlined: ' + resource);
				}
				filteredResources.push('!' + resource);
			});
			gulp.src(filteredResources, { base: `${src}`, allowEmpty: true }).pipe(resourcesStream);

			const bundleInfoArray: VinylFile[] = [];
			if (opts.bundleInfo) {
				bundleInfoArray.push(new VinylFile({
					path: 'bundleInfo.json',
					base: '.',
					contents: Buffer.from(JSON.stringify(result.bundleData, null, '\t'))
				}));
			}
			es.readArray(bundleInfoArray).pipe(bundleInfoStream);
		});

		const result = es.merge(
			loader(src, bundledFileHeader, bundleLoader),
			bundlesStream,
			resourcesStream,
			bundleInfoStream
		);

		return result
			.pipe(sourcemaps.write('./', {
				sourceRoot: undefined,
				addComment: true,
				includeContent: true
			}))
			.pipe(opts.languages && opts.languages.length ? processNlsFiles({
				fileHeader: bundledFileHeader,
				languages: opts.languages
			}) : es.through())
			.pipe(gulp.dest(out));
	};
}

declare class FileWithCopyright extends VinylFile {
	public __hasOurCopyright: boolean;
}
/**
 * Wrap around uglify and allow the preserveComments function
 * to have a file "context" to include our copyright only once per file.
 */
function uglifyWithCopyrights(): NodeJS.ReadWriteStream {
	const preserveComments = (f: FileWithCopyright) => {
		return (_node: any, comment: { value: string; type: string; }) => {
			const text = comment.value;
			const type = comment.type;

			if (/@minifier_do_not_preserve/.test(text)) {
				return false;
			}

			const isOurCopyright = IS_OUR_COPYRIGHT_REGEXP.test(text);

			if (isOurCopyright) {
				if (f.__hasOurCopyright) {
					return false;
				}
				f.__hasOurCopyright = true;
				return true;
			}

			if ('comment2' === type) {
				// check for /*!. Note that text doesn't contain leading /*
				return (text.length > 0 && text[0] === '!') || /@preserve|license|@cc_on|copyright/i.test(text);
			} else if ('comment1' === type) {
				return /license|copyright/i.test(text);
			}
			return false;
		};
	};

	const minify = (composer as any)(terser);
	const input = es.through();
	const output = input
		.pipe(flatmap((stream, f) => {
			return stream.pipe(minify({
				output: {
					comments: preserveComments(<FileWithCopyright>f),
					max_line_len: 1024
				}
			}));
		}));

	return es.duplex(input, output);
}

export function minifyTask(src: string, sourceMapBaseUrl?: string): (cb: any) => void {
	const sourceMappingURL = sourceMapBaseUrl ? ((f: any) => `${sourceMapBaseUrl}/${f.relative}.map`) : undefined;

	return cb => {
		const jsFilter = filter('**/*.js', { restore: true });
		const cssFilter = filter('**/*.css', { restore: true });

		pump(
			gulp.src([src + '/**', '!' + src + '/**/*.map']),
			jsFilter,
			sourcemaps.init({ loadMaps: true }),
			uglifyWithCopyrights(),
			jsFilter.restore,
			cssFilter,
			minifyCSS({ reduceIdents: false }),
			cssFilter.restore,
			(<any>sourcemaps).mapSources((sourcePath: string) => {
				if (sourcePath === 'bootstrap-fork.js') {
					return 'bootstrap-fork.orig.js';
				}

				return sourcePath;
			}),
			sourcemaps.write('./', {
				sourceMappingURL,
				sourceRoot: undefined,
				includeContent: true,
				addComment: true
			} as any),
			gulp.dest(src + '-min')
			, (err: any) => {
				if (err instanceof (uglify as any).GulpUglifyError) {
					console.error(`Uglify error in '${err.cause && err.cause.filename}'`);
				}

				cb(err);
			});
	};
}
