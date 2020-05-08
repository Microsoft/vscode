/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.minifyTask = exports.optimizeTask = exports.loaderConfig = void 0;
const es = require("event-stream");
const gulp = require("gulp");
const concat = require("gulp-concat");
const minifyCSS = require("gulp-cssnano");
const filter = require("gulp-filter");
const flatmap = require("gulp-flatmap");
const sourcemaps = require("gulp-sourcemaps");
const uglify = require("gulp-uglify");
const composer = require("gulp-uglify/composer");
const fancyLog = require("fancy-log");
const ansiColors = require("ansi-colors");
const path = require("path");
const pump = require("pump");
const terser = require("terser");
const VinylFile = require("vinyl");
const bundle = require("./bundle");
const i18n_1 = require("./i18n");
const stats_1 = require("./stats");
const util = require("./util");
const REPO_ROOT_PATH = path.join(__dirname, '../..');
function log(prefix, message) {
    fancyLog(ansiColors.cyan('[' + prefix + ']'), message);
}
function loaderConfig(emptyPaths) {
    const result = {
        paths: {
            'vs': 'out-build/vs',
            'vscode': 'empty:'
        },
        nodeModules: emptyPaths || []
    };
    result['vs/css'] = { inlineResources: true };
    return result;
}
exports.loaderConfig = loaderConfig;
const IS_OUR_COPYRIGHT_REGEXP = /Copyright \(C\) Microsoft Corporation/i;
function loader(src, bundledFileHeader, bundleLoader) {
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
    return (gulp
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
        }
        else {
            this.emit('data', data);
        }
    }))
        .pipe(concat('vs/loader.js')));
}
function toConcatStream(src, bundledFileHeader, sources, dest) {
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
        .pipe(stats_1.createStatsStream(dest));
}
function toBundleStream(src, bundledFileHeader, bundles) {
    return es.merge(bundles.map(function (bundle) {
        return toConcatStream(src, bundledFileHeader, bundle.sources, bundle.dest);
    }));
}
const DEFAULT_FILE_HEADER = [
    '/*!--------------------------------------------------------',
    ' * Copyright (C) Microsoft Corporation. All rights reserved.',
    ' *--------------------------------------------------------*/'
].join('\n');
function optimizeTask(opts) {
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
            if (err || !result) {
                return bundlesStream.emit('error', JSON.stringify(err));
            }
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
            const bundleInfoArray = [];
            if (opts.bundleInfo) {
                bundleInfoArray.push(new VinylFile({
                    path: 'bundleInfo.json',
                    base: '.',
                    contents: Buffer.from(JSON.stringify(result.bundleData, null, '\t'))
                }));
            }
            es.readArray(bundleInfoArray).pipe(bundleInfoStream);
        });
        const result = es.merge(loader(src, bundledFileHeader, bundleLoader), bundlesStream, resourcesStream, bundleInfoStream);
        return result
            .pipe(sourcemaps.write('./', {
            sourceRoot: undefined,
            addComment: true,
            includeContent: true
        }))
            .pipe(opts.languages && opts.languages.length ? i18n_1.processNlsFiles({
            fileHeader: bundledFileHeader,
            languages: opts.languages
        }) : es.through())
            .pipe(gulp.dest(out));
    };
}
exports.optimizeTask = optimizeTask;
/**
 * Wrap around uglify and allow the preserveComments function
 * to have a file "context" to include our copyright only once per file.
 */
function uglifyWithCopyrights() {
    const preserveComments = (f) => {
        return (_node, comment) => {
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
            }
            else if ('comment1' === type) {
                return /license|copyright/i.test(text);
            }
            return false;
        };
    };
    const minify = composer(terser);
    const input = es.through();
    const output = input
        .pipe(flatmap((stream, f) => {
        return stream.pipe(minify({
            output: {
                comments: preserveComments(f),
                max_line_len: 1024
            }
        }));
    }));
    return es.duplex(input, output);
}
function minifyTask(src, sourceMapBaseUrl) {
    const sourceMappingURL = sourceMapBaseUrl ? ((f) => `${sourceMapBaseUrl}/${f.relative}.map`) : undefined;
    return cb => {
        const jsFilter = filter('**/*.js', { restore: true });
        const cssFilter = filter('**/*.css', { restore: true });
        pump(gulp.src([src + '/**', '!' + src + '/**/*.map']), jsFilter, sourcemaps.init({ loadMaps: true }), uglifyWithCopyrights(), jsFilter.restore, cssFilter, minifyCSS({ reduceIdents: false }), cssFilter.restore, sourcemaps.mapSources((sourcePath) => {
            if (sourcePath === 'bootstrap-fork.js') {
                return 'bootstrap-fork.orig.js';
            }
            return sourcePath;
        }), sourcemaps.write('./', {
            sourceMappingURL,
            sourceRoot: undefined,
            includeContent: true,
            addComment: true
        }), gulp.dest(src + '-min'), (err) => {
            if (err instanceof uglify.GulpUglifyError) {
                console.error(`Uglify error in '${err.cause && err.cause.filename}'`);
            }
            cb(err);
        });
    };
}
exports.minifyTask = minifyTask;
