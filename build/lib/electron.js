/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const fs = require("fs");
const path = require("path");
const vfs = require("vinyl-fs");
const filter = require("gulp-filter");
const _ = require("underscore");
const util = require("./util");
const root = path.dirname(path.dirname(__dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const commit = util.getVersion(root);
const darwinCreditsTemplate = product.darwinCredits && _.template(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));
function darwinBundleDocumentType(extensions, icon) {
    return {
        name: product.nameLong + ' document',
        role: 'Editor',
        ostypes: ['TEXT', 'utxt', 'TUTX', '****'],
        extensions: extensions,
        iconFile: icon
    };
}
exports.config = {
    version: util.getElectronVersion(),
    productAppName: product.nameLong,
    companyName: 'Microsoft Corporation',
    copyright: 'Copyright (C) 2021 Microsoft. All rights reserved',
    darwinIcon: 'resources/darwin/code.icns',
    darwinBundleIdentifier: product.darwinBundleIdentifier,
    darwinApplicationCategoryType: 'public.app-category.developer-tools',
    darwinHelpBookFolder: 'VS Code HelpBook',
    darwinHelpBookName: 'VS Code HelpBook',
    darwinBundleDocumentTypes: [
        darwinBundleDocumentType(['bat', 'cmd'], 'resources/darwin/bat.icns'),
        darwinBundleDocumentType(['bowerrc'], 'resources/darwin/bower.icns'),
        darwinBundleDocumentType(['c', 'h'], 'resources/darwin/c.icns'),
        darwinBundleDocumentType(['config', 'editorconfig', 'gitattributes', 'gitconfig', 'gitignore', 'ini'], 'resources/darwin/config.icns'),
        darwinBundleDocumentType(['cc', 'cpp', 'cxx', 'c++', 'hh', 'hpp', 'hxx', 'h++'], 'resources/darwin/cpp.icns'),
        darwinBundleDocumentType(['cs', 'csx'], 'resources/darwin/csharp.icns'),
        darwinBundleDocumentType(['css'], 'resources/darwin/css.icns'),
        darwinBundleDocumentType(['go'], 'resources/darwin/go.icns'),
        darwinBundleDocumentType(['asp', 'aspx', 'cshtml', 'htm', 'html', 'jshtm', 'jsp', 'phtml', 'shtml'], 'resources/darwin/html.icns'),
        darwinBundleDocumentType(['jade'], 'resources/darwin/jade.icns'),
        darwinBundleDocumentType(['jav', 'java'], 'resources/darwin/java.icns'),
        darwinBundleDocumentType(['js', 'jscsrc', 'jshintrc', 'mjs', 'cjs'], 'resources/darwin/javascript.icns'),
        darwinBundleDocumentType(['json'], 'resources/darwin/json.icns'),
        darwinBundleDocumentType(['less'], 'resources/darwin/less.icns'),
        darwinBundleDocumentType(['markdown', 'md', 'mdoc', 'mdown', 'mdtext', 'mdtxt', 'mdwn', 'mkd', 'mkdn'], 'resources/darwin/markdown.icns'),
        darwinBundleDocumentType(['php'], 'resources/darwin/php.icns'),
        darwinBundleDocumentType(['ps1', 'psd1', 'psm1'], 'resources/darwin/powershell.icns'),
        darwinBundleDocumentType(['py'], 'resources/darwin/python.icns'),
        darwinBundleDocumentType(['gemspec', 'rb'], 'resources/darwin/ruby.icns'),
        darwinBundleDocumentType(['scss'], 'resources/darwin/sass.icns'),
        darwinBundleDocumentType(['bash', 'bash_login', 'bash_logout', 'bash_profile', 'bashrc', 'profile', 'rhistory', 'rprofile', 'sh', 'zlogin', 'zlogout', 'zprofile', 'zsh', 'zshenv', 'zshrc'], 'resources/darwin/shell.icns'),
        darwinBundleDocumentType(['sql'], 'resources/darwin/sql.icns'),
        darwinBundleDocumentType(['ts'], 'resources/darwin/typescript.icns'),
        darwinBundleDocumentType(['tsx', 'jsx'], 'resources/darwin/react.icns'),
        darwinBundleDocumentType(['vue'], 'resources/darwin/vue.icns'),
        darwinBundleDocumentType(['ascx', 'csproj', 'dtd', 'wxi', 'wxl', 'wxs', 'xml', 'xaml'], 'resources/darwin/xml.icns'),
        darwinBundleDocumentType(['eyaml', 'eyml', 'yaml', 'yml'], 'resources/darwin/yaml.icns'),
        darwinBundleDocumentType(['clj', 'cljs', 'cljx', 'clojure', 'code-workspace', 'coffee', 'containerfile', 'ctp', 'dockerfile', 'dot', 'edn', 'fs', 'fsi', 'fsscript', 'fsx', 'handlebars', 'hbs', 'lua', 'm', 'makefile', 'ml', 'mli', 'pl', 'pl6', 'pm', 'pm6', 'pod', 'pp', 'properties', 'psgi', 'pug', 'r', 'rs', 'rt', 'svg', 'svgz', 't', 'txt', 'vb', 'xcodeproj', 'xcworkspace'], 'resources/darwin/default.icns')
    ],
    darwinBundleURLTypes: [{
            role: 'Viewer',
            name: product.nameLong,
            urlSchemes: [product.urlProtocol]
        }],
    darwinForceDarkModeSupport: true,
    darwinCredits: darwinCreditsTemplate ? Buffer.from(darwinCreditsTemplate({ commit: commit, date: new Date().toISOString() })) : undefined,
    linuxExecutableName: product.applicationName,
    winIcon: 'resources/win32/code.ico',
    token: process.env['VSCODE_MIXIN_PASSWORD'] || process.env['GITHUB_TOKEN'] || undefined,
    repo: product.electronRepository || undefined
};
function getElectron(arch) {
    return () => {
        const electron = require('gulp-atom-electron');
        const json = require('gulp-json-editor');
        const electronOpts = _.extend({}, exports.config, {
            platform: process.platform,
            arch: arch === 'armhf' ? 'arm' : arch,
            ffmpegChromium: true,
            keepDefaultApp: true
        });
        return vfs.src('package.json')
            .pipe(json({ name: product.nameShort }))
            .pipe(electron(electronOpts))
            .pipe(filter(['**', '!**/app/package.json']))
            .pipe(vfs.dest('.build/electron'));
    };
}
async function main(arch = process.arch) {
    const version = util.getElectronVersion();
    const electronPath = path.join(root, '.build', 'electron');
    const versionFile = path.join(electronPath, 'version');
    const isUpToDate = fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8') === `${version}`;
    if (!isUpToDate) {
        await util.rimraf(electronPath)();
        await util.streamToPromise(getElectron(arch)());
    }
}
if (require.main === module) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
