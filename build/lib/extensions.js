"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.translatePackageJSON = exports.scanBuiltinExtensions = exports.packageMarketplaceWebExtensionsStream = exports.packageMarketplaceExtensionsStream = exports.packageLocalWebExtensionsStream = exports.packageLocalExtensionsStream = exports.fromMarketplace = void 0;
const es = require("event-stream");
const fs = require("fs");
const glob = require("glob");
const gulp = require("gulp");
const path = require("path");
const File = require("vinyl");
const vsce = require("vsce");
const stats_1 = require("./stats");
const util2 = require("./util");
const remote = require("gulp-remote-retry-src");
const vzip = require('gulp-vinyl-zip');
const filter = require("gulp-filter");
const rename = require("gulp-rename");
const fancyLog = require("fancy-log");
const ansiColors = require("ansi-colors");
const buffer = require('gulp-buffer');
const json = require("gulp-json-editor");
const jsoncParser = require("jsonc-parser");
const webpack = require('webpack');
const webpackGulp = require('webpack-stream');
const util = require('./util');
const root = path.dirname(path.dirname(__dirname));
const commit = util.getVersion(root);
const sourceMappingURLBase = `https://ticino.blob.core.windows.net/sourcemaps/${commit}`;
function minifyExtensionResources(input) {
    const jsonFilter = filter(['**/*.json', '**/*.code-snippets'], { restore: true });
    return input
        .pipe(jsonFilter)
        .pipe(buffer())
        .pipe(es.mapSync((f) => {
        const errors = [];
        const value = jsoncParser.parse(f.contents.toString('utf8'), errors);
        if (errors.length === 0) {
            // file parsed OK => just stringify to drop whitespace and comments
            f.contents = Buffer.from(JSON.stringify(value));
        }
        return f;
    }))
        .pipe(jsonFilter.restore);
}
function updateExtensionPackageJSON(input, update) {
    const packageJsonFilter = filter('extensions/*/package.json', { restore: true });
    return input
        .pipe(packageJsonFilter)
        .pipe(buffer())
        .pipe(es.mapSync((f) => {
        const data = JSON.parse(f.contents.toString('utf8'));
        f.contents = Buffer.from(JSON.stringify(update(data)));
        return f;
    }))
        .pipe(packageJsonFilter.restore);
}
function fromLocal(extensionPath, forWeb) {
    const webpackConfigFileName = forWeb ? 'extension-browser.webpack.config.js' : 'extension.webpack.config.js';
    const isWebPacked = fs.existsSync(path.join(extensionPath, webpackConfigFileName));
    let input = isWebPacked
        ? fromLocalWebpack(extensionPath, webpackConfigFileName)
        : fromLocalNormal(extensionPath);
    if (isWebPacked) {
        input = updateExtensionPackageJSON(input, (data) => {
            delete data.scripts;
            delete data.dependencies;
            delete data.devDependencies;
            if (data.main) {
                data.main = data.main.replace('/out/', /dist/);
            }
            return data;
        });
    }
    return input;
}
function fromLocalWebpack(extensionPath, webpackConfigFileName) {
    const result = es.through();
    const packagedDependencies = [];
    const packageJsonConfig = require(path.join(extensionPath, 'package.json'));
    if (packageJsonConfig.dependencies) {
        const webpackRootConfig = require(path.join(extensionPath, webpackConfigFileName));
        for (const key in webpackRootConfig.externals) {
            if (key in packageJsonConfig.dependencies) {
                packagedDependencies.push(key);
            }
        }
    }
    vsce.listFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Yarn, packagedDependencies }).then(fileNames => {
        const files = fileNames
            .map(fileName => path.join(extensionPath, fileName))
            .map(filePath => new File({
            path: filePath,
            stat: fs.statSync(filePath),
            base: extensionPath,
            contents: fs.createReadStream(filePath)
        }));
        // check for a webpack configuration files, then invoke webpack
        // and merge its output with the files stream.
        const webpackConfigLocations = glob.sync(path.join(extensionPath, '**', webpackConfigFileName), { ignore: ['**/node_modules'] });
        const webpackStreams = webpackConfigLocations.map(webpackConfigPath => {
            const webpackDone = (err, stats) => {
                fancyLog(`Bundled extension: ${ansiColors.yellow(path.join(path.basename(extensionPath), path.relative(extensionPath, webpackConfigPath)))}...`);
                if (err) {
                    result.emit('error', err);
                }
                const { compilation } = stats;
                if (compilation.errors.length > 0) {
                    result.emit('error', compilation.errors.join('\n'));
                }
                if (compilation.warnings.length > 0) {
                    result.emit('error', compilation.warnings.join('\n'));
                }
            };
            const webpackConfig = Object.assign(Object.assign({}, require(webpackConfigPath)), { mode: 'production' });
            const relativeOutputPath = path.relative(extensionPath, webpackConfig.output.path);
            return webpackGulp(webpackConfig, webpack, webpackDone)
                .pipe(es.through(function (data) {
                data.stat = data.stat || {};
                data.base = extensionPath;
                this.emit('data', data);
            }))
                .pipe(es.through(function (data) {
                // source map handling:
                // * rewrite sourceMappingURL
                // * save to disk so that upload-task picks this up
                const contents = data.contents.toString('utf8');
                data.contents = Buffer.from(contents.replace(/\n\/\/# sourceMappingURL=(.*)$/gm, function (_m, g1) {
                    return `\n//# sourceMappingURL=${sourceMappingURLBase}/extensions/${path.basename(extensionPath)}/${relativeOutputPath}/${g1}`;
                }), 'utf8');
                this.emit('data', data);
            }));
        });
        es.merge(...webpackStreams, es.readArray(files))
            // .pipe(es.through(function (data) {
            // 	// debug
            // 	console.log('out', data.path, data.contents.length);
            // 	this.emit('data', data);
            // }))
            .pipe(result);
    }).catch(err => {
        console.error(extensionPath);
        console.error(packagedDependencies);
        result.emit('error', err);
    });
    return result.pipe(stats_1.createStatsStream(path.basename(extensionPath)));
}
function fromLocalNormal(extensionPath) {
    const result = es.through();
    vsce.listFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Yarn })
        .then(fileNames => {
        const files = fileNames
            .map(fileName => path.join(extensionPath, fileName))
            .map(filePath => new File({
            path: filePath,
            stat: fs.statSync(filePath),
            base: extensionPath,
            contents: fs.createReadStream(filePath)
        }));
        es.readArray(files).pipe(result);
    })
        .catch(err => result.emit('error', err));
    return result.pipe(stats_1.createStatsStream(path.basename(extensionPath)));
}
const baseHeaders = {
    'X-Market-Client-Id': 'VSCode Build',
    'User-Agent': 'VSCode Build',
    'X-Market-User-Id': '291C1CD0-051A-4123-9B4B-30D60EF52EE2',
};
function fromMarketplace(extensionName, version, metadata) {
    const [publisher, name] = extensionName.split('.');
    const url = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage`;
    fancyLog('Downloading extension:', ansiColors.yellow(`${extensionName}@${version}`), '...');
    const options = {
        base: url,
        requestOptions: {
            gzip: true,
            headers: baseHeaders
        }
    };
    const packageJsonFilter = filter('package.json', { restore: true });
    return remote('', options)
        .pipe(vzip.src())
        .pipe(filter('extension/**'))
        .pipe(rename(p => p.dirname = p.dirname.replace(/^extension\/?/, '')))
        .pipe(packageJsonFilter)
        .pipe(buffer())
        .pipe(json({ __metadata: metadata }))
        .pipe(packageJsonFilter.restore);
}
exports.fromMarketplace = fromMarketplace;
const excludedExtensions = [
    'vscode-api-tests',
    'vscode-web-playground',
    'vscode-colorize-tests',
    'vscode-test-resolver',
    'ms-vscode.node-debug',
    'ms-vscode.node-debug2',
    'vscode-notebook-tests'
];
const builtInExtensions = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8')).builtInExtensions;
function packageLocalExtensionsStream() {
    const localExtensionDescriptions = glob.sync('extensions/*/package.json')
        .map(manifestPath => {
        const extensionPath = path.dirname(path.join(root, manifestPath));
        const extensionName = path.basename(extensionPath);
        return { name: extensionName, path: extensionPath };
    })
        .filter(({ name }) => excludedExtensions.indexOf(name) === -1)
        .filter(({ name }) => builtInExtensions.every(b => b.name !== name));
    const localExtensions = localExtensionDescriptions.map(extension => {
        return fromLocal(extension.path, false)
            .pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
    });
    const nodeModules = gulp.src('extensions/node_modules/**', { base: '.' });
    return minifyExtensionResources(es.merge(nodeModules, ...localExtensions)
        .pipe(util2.setExecutableBit(['**/*.sh'])));
}
exports.packageLocalExtensionsStream = packageLocalExtensionsStream;
function packageLocalWebExtensionsStream() {
    const localExtensionDescriptions = glob.sync('extensions/*/package.json')
        .filter(manifestPath => {
        const packageJsonConfig = require(path.join(root, manifestPath));
        return !packageJsonConfig.main || packageJsonConfig.browser;
    })
        .map(manifestPath => {
        const extensionPath = path.dirname(path.join(root, manifestPath));
        const extensionName = path.basename(extensionPath);
        return { name: extensionName, path: extensionPath };
    });
    return minifyExtensionResources(es.merge(...localExtensionDescriptions.map(extension => {
        return fromLocal(extension.path, true)
            .pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
    })));
}
exports.packageLocalWebExtensionsStream = packageLocalWebExtensionsStream;
function packageMarketplaceExtensionsStream() {
    const extensions = builtInExtensions.map(extension => {
        return fromMarketplace(extension.name, extension.version, extension.metadata)
            .pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
    });
    return minifyExtensionResources(es.merge(extensions)
        .pipe(util2.setExecutableBit(['**/*.sh'])));
}
exports.packageMarketplaceExtensionsStream = packageMarketplaceExtensionsStream;
function packageMarketplaceWebExtensionsStream(builtInExtensions) {
    const extensions = builtInExtensions
        .map(extension => {
        const input = fromMarketplace(extension.name, extension.version, extension.metadata)
            .pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
        return updateExtensionPackageJSON(input, (data) => {
            if (data.main) {
                data.browser = data.main;
            }
            data.extensionKind = ['web'];
            return data;
        });
    });
    return minifyExtensionResources(es.merge(extensions));
}
exports.packageMarketplaceWebExtensionsStream = packageMarketplaceWebExtensionsStream;
function scanBuiltinExtensions(extensionsRoot, forWeb) {
    const scannedExtensions = [];
    const extensionsFolders = fs.readdirSync(extensionsRoot);
    for (const extensionFolder of extensionsFolders) {
        const packageJSONPath = path.join(extensionsRoot, extensionFolder, 'package.json');
        if (!fs.existsSync(packageJSONPath)) {
            continue;
        }
        let packageJSON = JSON.parse(fs.readFileSync(packageJSONPath).toString('utf8'));
        const extensionKind = packageJSON['extensionKind'] || [];
        if (forWeb && extensionKind.indexOf('web') === -1) {
            continue;
        }
        const children = fs.readdirSync(path.join(extensionsRoot, extensionFolder));
        const packageNLS = children.filter(child => child === 'package.nls.json')[0];
        const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
        const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];
        if (packageNLS) {
            // temporary
            packageJSON = translatePackageJSON(packageJSON, path.join(extensionsRoot, extensionFolder, packageNLS));
        }
        scannedExtensions.push({
            extensionPath: extensionFolder,
            packageJSON,
            packageNLSPath: packageNLS ? path.join(extensionFolder, packageNLS) : undefined,
            readmePath: readme ? path.join(extensionFolder, readme) : undefined,
            changelogPath: changelog ? path.join(extensionFolder, changelog) : undefined,
        });
    }
    return scannedExtensions;
}
exports.scanBuiltinExtensions = scanBuiltinExtensions;
function translatePackageJSON(packageJSON, packageNLSPath) {
    const CharCode_PC = '%'.charCodeAt(0);
    const packageNls = JSON.parse(fs.readFileSync(packageNLSPath).toString());
    const translate = (obj) => {
        for (let key in obj) {
            const val = obj[key];
            if (Array.isArray(val)) {
                val.forEach(translate);
            }
            else if (val && typeof val === 'object') {
                translate(val);
            }
            else if (typeof val === 'string' && val.charCodeAt(0) === CharCode_PC && val.charCodeAt(val.length - 1) === CharCode_PC) {
                const translated = packageNls[val.substr(1, val.length - 2)];
                if (translated) {
                    obj[key] = translated;
                }
            }
        }
    };
    translate(packageJSON);
    return packageJSON;
}
exports.translatePackageJSON = translatePackageJSON;
