/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const gulp = require('gulp');
const path = require('path');
const util = require('./lib/util');
const task = require('./lib/task');
const common = require('./lib/optimize');
const es = require('event-stream');
const File = require('vinyl');
const i18n = require('./lib/i18n');
const standalone = require('./lib/standalone');
const cp = require('child_process');
const compilation = require('./lib/compilation');
const monacoapi = require('./monaco/api');
const fs = require('fs');
const webpack = require('webpack');
const webpackGulp = require('webpack-stream');

let root = path.dirname(__dirname);
let sha1 = util.getVersion(root);
let semver = require('./monaco/package.json').version;
let headerVersion = semver + '(' + sha1 + ')';

// Build

let editorEntryPoints = [
	{
		name: 'vs/editor/editor.main',
		include: [],
		exclude: ['vs/css', 'vs/nls'],
		prepend: ['out-editor-build/vs/css.js', 'out-editor-build/vs/nls.js'],
	},
	{
		name: 'vs/base/common/worker/simpleWorker',
		include: ['vs/editor/common/services/editorSimpleWorker'],
		prepend: ['vs/loader.js'],
		append: ['vs/base/worker/workerMain'],
		dest: 'vs/base/worker/workerMain.js'
	}
];

let editorResources = [
	'out-editor-build/vs/base/browser/ui/codicons/**/*.ttf'
];

let BUNDLED_FILE_HEADER = [
	'/*!-----------------------------------------------------------',
	' * Copyright (c) Microsoft Corporation. All rights reserved.',
	' * Version: ' + headerVersion,
	' * Released under the MIT license',
	' * https://github.com/Microsoft/vscode/blob/master/LICENSE.txt',
	' *-----------------------------------------------------------*/',
	''
].join('\n');

const languages = i18n.defaultLanguages.concat([]);  // i18n.defaultLanguages.concat(process.env.VSCODE_QUALITY !== 'stable' ? i18n.extraLanguages : []);

const extractEditorSrcTask = task.define('extract-editor-src', () => {
	const apiusages = monacoapi.execute().usageContent;
	const extrausages = fs.readFileSync(path.join(root, 'build', 'monaco', 'monaco.usage.recipe')).toString();
	standalone.extractEditor({
		sourcesRoot: path.join(root, 'src'),
		entryPoints: [
			'vs/editor/editor.main',
			'vs/editor/editor.worker',
			'vs/base/worker/workerMain',
		],
		inlineEntryPoints: [
			apiusages,
			extrausages
		],
		shakeLevel: 2, // 0-Files, 1-InnerFile, 2-ClassMembers
		importIgnorePattern: /(^vs\/css!)/,
		destRoot: path.join(root, 'out-editor-src'),
		redirects: []
	});
});

const compileEditorAMDTask = task.define('compile-editor-amd', compilation.compileTask('out-editor-src', 'out-editor-build', true));

const optimizeEditorAMDTask = task.define('optimize-editor-amd', common.optimizeTask({
	src: 'out-editor-build',
	entryPoints: editorEntryPoints,
	resources: editorResources,
	loaderConfig: {
		paths: {
			'vs': 'out-editor-build/vs',
			'vs/css': 'out-editor-build/vs/css.build',
			'vs/nls': 'out-editor-build/vs/nls.build',
			'vscode': 'empty:'
		}
	},
	bundleLoader: false,
	header: BUNDLED_FILE_HEADER,
	bundleInfo: true,
	out: 'out-editor',
	languages: languages
}));

const minifyEditorAMDTask = task.define('minify-editor-amd', common.minifyTask('out-editor'));

const createESMSourcesAndResourcesTask = task.define('extract-editor-esm', () => {
	standalone.createESMSourcesAndResources2({
		srcFolder: './out-editor-src',
		outFolder: './out-editor-esm',
		outResourcesFolder: './out-monaco-editor-core/esm',
		ignores: [
			'inlineEntryPoint:0.ts',
			'inlineEntryPoint:1.ts',
			'vs/loader.js',
			'vs/nls.ts',
			'vs/nls.build.js',
			'vs/nls.d.ts',
			'vs/css.js',
			'vs/css.build.js',
			'vs/css.d.ts',
			'vs/base/worker/workerMain.ts',
		],
		renames: {
			'vs/nls.mock.ts': 'vs/nls.ts'
		}
	});
});

const compileEditorESMTask = task.define('compile-editor-esm', () => {
	const KEEP_PREV_ANALYSIS = false;
	const FAIL_ON_PURPOSE = false;
	console.log(`Launching the TS compiler at ${path.join(__dirname, '../out-editor-esm')}...`);
	let result;
	if (process.platform === 'win32') {
		result = cp.spawnSync(`..\\node_modules\\.bin\\tsc.cmd`, {
			cwd: path.join(__dirname, '../out-editor-esm')
		});
	} else {
		result = cp.spawnSync(`node`, [`../node_modules/.bin/tsc`], {
			cwd: path.join(__dirname, '../out-editor-esm')
		});
	}

	console.log(result.stdout.toString());
	console.log(result.stderr.toString());

	if (FAIL_ON_PURPOSE || result.status !== 0) {
		console.log(`The TS Compilation failed, preparing analysis folder...`);
		const destPath = path.join(__dirname, '../../vscode-monaco-editor-esm-analysis');
		const keepPrevAnalysis = (KEEP_PREV_ANALYSIS && fs.existsSync(destPath));
		const cleanDestPath = (keepPrevAnalysis ? Promise.resolve() : util.rimraf(destPath)());
		return cleanDestPath.then(() => {
			// build a list of files to copy
			const files = util.rreddir(path.join(__dirname, '../out-editor-esm'));

			if (!keepPrevAnalysis) {
				fs.mkdirSync(destPath);

				// initialize a new repository
				cp.spawnSync(`git`, [`init`], {
					cwd: destPath
				});

				// copy files from src
				for (const file of files) {
					const srcFilePath = path.join(__dirname, '../src', file);
					const dstFilePath = path.join(destPath, file);
					if (fs.existsSync(srcFilePath)) {
						util.ensureDir(path.dirname(dstFilePath));
						const contents = fs.readFileSync(srcFilePath).toString().replace(/\r\n|\r|\n/g, '\n');
						fs.writeFileSync(dstFilePath, contents);
					}
				}

				// create an initial commit to diff against
				cp.spawnSync(`git`, [`add`, `.`], {
					cwd: destPath
				});

				// create the commit
				cp.spawnSync(`git`, [`commit`, `-m`, `"original sources"`, `--no-gpg-sign`], {
					cwd: destPath
				});
			}

			// copy files from tree shaken src
			for (const file of files) {
				const srcFilePath = path.join(__dirname, '../out-editor-src', file);
				const dstFilePath = path.join(destPath, file);
				if (fs.existsSync(srcFilePath)) {
					util.ensureDir(path.dirname(dstFilePath));
					const contents = fs.readFileSync(srcFilePath).toString().replace(/\r\n|\r|\n/g, '\n');
					fs.writeFileSync(dstFilePath, contents);
				}
			}

			console.log(`Open in VS Code the folder at '${destPath}' and you can alayze the compilation error`);
			throw new Error('Standalone Editor compilation failed. If this is the build machine, simply launch `yarn run gulp editor-distro` on your machine to further analyze the compilation problem.');
		});
	}
});

function toExternalDTS(contents) {
	let lines = contents.split(/\r\n|\r|\n/);
	let killNextCloseCurlyBrace = false;
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		if (killNextCloseCurlyBrace) {
			if ('}' === line) {
				lines[i] = '';
				killNextCloseCurlyBrace = false;
				continue;
			}

			if (line.indexOf('    ') === 0) {
				lines[i] = line.substr(4);
			} else if (line.charAt(0) === '\t') {
				lines[i] = line.substr(1);
			}

			continue;
		}

		if ('declare namespace monaco {' === line) {
			lines[i] = '';
			killNextCloseCurlyBrace = true;
			continue;
		}

		if (line.indexOf('declare namespace monaco.') === 0) {
			lines[i] = line.replace('declare namespace monaco.', 'export namespace ');
		}

		if (line.indexOf('declare let MonacoEnvironment') === 0) {
			lines[i] = `declare global {\n    let MonacoEnvironment: Environment | undefined;\n}`;
			// lines[i] = line.replace('declare namespace monaco.', 'export namespace ');
		}
	}
	return lines.join('\n').replace(/\n\n\n+/g, '\n\n');
}

function filterStream(testFunc) {
	return es.through(function (data) {
		if (!testFunc(data.relative)) {
			return;
		}
		this.emit('data', data);
	});
}

const finalEditorResourcesTask = task.define('final-editor-resources', () => {
	return es.merge(
		// other assets
		es.merge(
			gulp.src('build/monaco/LICENSE'),
			gulp.src('build/monaco/ThirdPartyNotices.txt'),
			gulp.src('src/vs/monaco.d.ts')
		).pipe(gulp.dest('out-monaco-editor-core')),

		// place the .d.ts in the esm folder
		gulp.src('src/vs/monaco.d.ts')
			.pipe(es.through(function (data) {
				this.emit('data', new File({
					path: data.path.replace(/monaco\.d\.ts/, 'editor.api.d.ts'),
					base: data.base,
					contents: Buffer.from(toExternalDTS(data.contents.toString()))
				}));
			}))
			.pipe(gulp.dest('out-monaco-editor-core/esm/vs/editor')),

		// package.json
		gulp.src('build/monaco/package.json')
			.pipe(es.through(function (data) {
				let json = JSON.parse(data.contents.toString());
				json.private = false;
				data.contents = Buffer.from(JSON.stringify(json, null, '  '));
				this.emit('data', data);
			}))
			.pipe(gulp.dest('out-monaco-editor-core')),

		// version.txt
		gulp.src('build/monaco/version.txt')
			.pipe(es.through(function (data) {
				data.contents = Buffer.from(`monaco-editor-core: https://github.com/Microsoft/vscode/tree/${sha1}`);
				this.emit('data', data);
			}))
			.pipe(gulp.dest('out-monaco-editor-core')),

		// README.md
		gulp.src('build/monaco/README-npm.md')
			.pipe(es.through(function (data) {
				this.emit('data', new File({
					path: data.path.replace(/README-npm\.md/, 'README.md'),
					base: data.base,
					contents: data.contents
				}));
			}))
			.pipe(gulp.dest('out-monaco-editor-core')),

		// dev folder
		es.merge(
			gulp.src('out-editor/**/*')
		).pipe(gulp.dest('out-monaco-editor-core/dev')),

		// min folder
		es.merge(
			gulp.src('out-editor-min/**/*')
		).pipe(filterStream(function (path) {
			// no map files
			return !/(\.js\.map$)|(nls\.metadata\.json$)|(bundleInfo\.json$)/.test(path);
		})).pipe(es.through(function (data) {
			// tweak the sourceMappingURL
			if (!/\.js$/.test(data.path)) {
				this.emit('data', data);
				return;
			}

			let relativePathToMap = path.relative(path.join(data.relative), path.join('min-maps', data.relative + '.map'));

			let strContents = data.contents.toString();
			let newStr = '//# sourceMappingURL=' + relativePathToMap.replace(/\\/g, '/');
			strContents = strContents.replace(/\/\/# sourceMappingURL=[^ ]+$/, newStr);

			data.contents = Buffer.from(strContents);
			this.emit('data', data);
		})).pipe(gulp.dest('out-monaco-editor-core/min')),

		// min-maps folder
		es.merge(
			gulp.src('out-editor-min/**/*')
		).pipe(filterStream(function (path) {
			// no map files
			return /\.js\.map$/.test(path);
		})).pipe(gulp.dest('out-monaco-editor-core/min-maps'))
	);
});

gulp.task('extract-editor-src',
	task.series(
		util.rimraf('out-editor-src'),
		extractEditorSrcTask
	)
);

gulp.task('editor-distro',
	task.series(
		task.parallel(
			util.rimraf('out-editor-src'),
			util.rimraf('out-editor-build'),
			util.rimraf('out-editor-esm'),
			util.rimraf('out-monaco-editor-core'),
			util.rimraf('out-editor'),
			util.rimraf('out-editor-min')
		),
		extractEditorSrcTask,
		task.parallel(
			task.series(
				compileEditorAMDTask,
				optimizeEditorAMDTask,
				minifyEditorAMDTask
			),
			task.series(
				createESMSourcesAndResourcesTask,
				compileEditorESMTask
			)
		),
		finalEditorResourcesTask
	)
);

const bundleEditorESMTask = task.define('editor-esm-bundle-webpack', () => {
	const result = es.through();

	const webpackConfigPath = path.join(root, 'build/monaco/monaco.webpack.config.js');

	const webpackConfig = {
		...require(webpackConfigPath),
		...{ mode: 'production' }
	};

	const webpackDone = (err, stats) => {
		if (err) {
			result.emit('error', err);
			return;
		}
		const { compilation } = stats;
		if (compilation.errors.length > 0) {
			result.emit('error', compilation.errors.join('\n'));
		}
		if (compilation.warnings.length > 0) {
			result.emit('data', compilation.warnings.join('\n'));
		}
	};

	return webpackGulp(webpackConfig, webpack, webpackDone)
		.pipe(gulp.dest('out-editor-esm-bundle'));
});

gulp.task('editor-esm-bundle',
	task.series(
		task.parallel(
			util.rimraf('out-editor-src'),
			util.rimraf('out-editor-esm'),
			util.rimraf('out-monaco-editor-core'),
			util.rimraf('out-editor-esm-bundle'),
		),
		extractEditorSrcTask,
		createESMSourcesAndResourcesTask,
		compileEditorESMTask,
		bundleEditorESMTask,
	)
);

gulp.task('monacodts', task.define('monacodts', () => {
	const result = monacoapi.execute();
	fs.writeFileSync(result.filePath, result.content);
	fs.writeFileSync(path.join(root, 'src/vs/editor/common/standalone/standaloneEnums.ts'), result.enums);
	return Promise.resolve(true);
}));

//#region monaco type checking

function createTscCompileTask(watch) {
	return () => {
		const createReporter = require('./lib/reporter').createReporter;

		return new Promise((resolve, reject) => {
			const args = ['./node_modules/.bin/tsc', '-p', './src/tsconfig.monaco.json', '--noEmit'];
			if (watch) {
				args.push('-w');
			}
			const child = cp.spawn(`node`, args, {
				cwd: path.join(__dirname, '..'),
				// stdio: [null, 'pipe', 'inherit']
			});
			let errors = [];
			let reporter = createReporter();
			let report;
			// eslint-disable-next-line no-control-regex
			let magic = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g; // https://stackoverflow.com/questions/25245716/remove-all-ansi-colors-styles-from-strings

			child.stdout.on('data', data => {
				let str = String(data);
				str = str.replace(magic, '').trim();
				if (str.indexOf('Starting compilation') >= 0 || str.indexOf('File change detected') >= 0) {
					errors.length = 0;
					report = reporter.end(false);

				} else if (str.indexOf('Compilation complete') >= 0) {
					report.end();

				} else if (str) {
					let match = /(.*\(\d+,\d+\): )(.*: )(.*)/.exec(str);
					if (match) {
						// trying to massage the message so that it matches the gulp-tsb error messages
						// e.g. src/vs/base/common/strings.ts(663,5): error TS2322: Type '1234' is not assignable to type 'string'.
						let fullpath = path.join(root, match[1]);
						let message = match[3];
						reporter(fullpath + message);
					} else {
						reporter(str);
					}
				}
			});
			child.on('exit', resolve);
			child.on('error', reject);
		});
	};
}

const monacoTypecheckWatchTask = task.define('monaco-typecheck-watch', createTscCompileTask(true));
exports.monacoTypecheckWatchTask = monacoTypecheckWatchTask;

const monacoTypecheckTask = task.define('monaco-typecheck', createTscCompileTask(false));
exports.monacoTypecheckTask = monacoTypecheckTask;

//#endregion
