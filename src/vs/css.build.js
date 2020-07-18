/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 * Please make sure to make edits in the .ts file at https://github.com/Microsoft/vscode-loader/
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *--------------------------------------------------------------------------------------------*/
'use strict';
var _cssPluginGlobal = this;
var CSSBuildLoaderPlugin;
(function (CSSBuildLoaderPlugin) {
    var global = (_cssPluginGlobal || {});
    /**
     * Known issue:
     * - In IE there is no way to know if the CSS file loaded successfully or not.
     */
    var BrowserCSSLoader = /** @class */ (function () {
        function BrowserCSSLoader() {
            this._pendingLoads = 0;
        }
        BrowserCSSLoader.prototype.attachListeners = function (name, linkNode, callback, errorback) {
            var unbind = function () {
                linkNode.removeEventListener('load', loadEventListener);
                linkNode.removeEventListener('error', errorEventListener);
            };
            var loadEventListener = function (e) {
                unbind();
                callback();
            };
            var errorEventListener = function (e) {
                unbind();
                errorback(e);
            };
            linkNode.addEventListener('load', loadEventListener);
            linkNode.addEventListener('error', errorEventListener);
        };
        BrowserCSSLoader.prototype._onLoad = function (name, callback) {
            this._pendingLoads--;
            callback();
        };
        BrowserCSSLoader.prototype._onLoadError = function (name, errorback, err) {
            this._pendingLoads--;
            errorback(err);
        };
        BrowserCSSLoader.prototype._insertLinkNode = function (linkNode) {
            this._pendingLoads++;
            var head = document.head || document.getElementsByTagName('head')[0];
            var other = head.getElementsByTagName('link') || head.getElementsByTagName('script');
            if (other.length > 0) {
                head.insertBefore(linkNode, other[other.length - 1]);
            }
            else {
                head.appendChild(linkNode);
            }
        };
        BrowserCSSLoader.prototype.createLinkTag = function (name, cssUrl, externalCallback, externalErrorback) {
            var _this = this;
            var linkNode = document.createElement('link');
            linkNode.setAttribute('rel', 'stylesheet');
            linkNode.setAttribute('type', 'text/css');
            linkNode.setAttribute('data-name', name);
            var callback = function () { return _this._onLoad(name, externalCallback); };
            var errorback = function (err) { return _this._onLoadError(name, externalErrorback, err); };
            this.attachListeners(name, linkNode, callback, errorback);
            linkNode.setAttribute('href', cssUrl);
            return linkNode;
        };
        BrowserCSSLoader.prototype._linkTagExists = function (name, cssUrl) {
            var i, len, nameAttr, hrefAttr, links = document.getElementsByTagName('link');
            for (i = 0, len = links.length; i < len; i++) {
                nameAttr = links[i].getAttribute('data-name');
                hrefAttr = links[i].getAttribute('href');
                if (nameAttr === name || hrefAttr === cssUrl) {
                    return true;
                }
            }
            return false;
        };
        BrowserCSSLoader.prototype.load = function (name, cssUrl, externalCallback, externalErrorback) {
            if (this._linkTagExists(name, cssUrl)) {
                externalCallback();
                return;
            }
            var linkNode = this.createLinkTag(name, cssUrl, externalCallback, externalErrorback);
            this._insertLinkNode(linkNode);
        };
        return BrowserCSSLoader;
    }());
    var NodeCSSLoader = /** @class */ (function () {
        function NodeCSSLoader() {
            this.fs = require.nodeRequire('fs');
        }
        NodeCSSLoader.prototype.load = function (name, cssUrl, externalCallback, externalErrorback) {
            var contents = this.fs.readFileSync(cssUrl, 'utf8');
            // Remove BOM
            if (contents.charCodeAt(0) === NodeCSSLoader.BOM_CHAR_CODE) {
                contents = contents.substring(1);
            }
            externalCallback(contents);
        };
        NodeCSSLoader.BOM_CHAR_CODE = 65279;
        return NodeCSSLoader;
    }());
    // ------------------------------ Finally, the plugin
    var CSSPlugin = /** @class */ (function () {
        function CSSPlugin(cssLoader) {
            this.cssLoader = cssLoader;
        }
        CSSPlugin.prototype.load = function (name, req, load, config) {
            config = config || {};
            var myConfig = config['vs/css'] || {};
            global.inlineResources = myConfig.inlineResources;
            global.inlineResourcesLimit = myConfig.inlineResourcesLimit || 5000;
            var cssUrl = req.toUrl(name + '.css');
            this.cssLoader.load(name, cssUrl, function (contents) {
                // Contents has the CSS file contents if we are in a build
                if (config.isBuild) {
                    CSSPlugin.BUILD_MAP[name] = contents;
                    CSSPlugin.BUILD_PATH_MAP[name] = cssUrl;
                }
                load({});
            }, function (err) {
                if (typeof load.error === 'function') {
                    load.error('Could not find ' + cssUrl + ' or it was empty');
                }
            });
        };
        CSSPlugin.prototype.write = function (pluginName, moduleName, write) {
            // getEntryPoint is a Monaco extension to r.js
            var entryPoint = write.getEntryPoint();
            // r.js destroys the context of this plugin between calling 'write' and 'writeFile'
            // so the only option at this point is to leak the data to a global
            global.cssPluginEntryPoints = global.cssPluginEntryPoints || {};
            global.cssPluginEntryPoints[entryPoint] = global.cssPluginEntryPoints[entryPoint] || [];
            global.cssPluginEntryPoints[entryPoint].push({
                moduleName: moduleName,
                contents: CSSPlugin.BUILD_MAP[moduleName],
                fsPath: CSSPlugin.BUILD_PATH_MAP[moduleName],
            });
            write.asModule(pluginName + '!' + moduleName, 'define([\'vs/css!' + entryPoint + '\'], {});');
        };
        CSSPlugin.prototype.writeFile = function (pluginName, moduleName, req, write, config) {
            if (global.cssPluginEntryPoints && global.cssPluginEntryPoints.hasOwnProperty(moduleName)) {
                var fileName = req.toUrl(moduleName + '.css');
                var contents = [
                    '/*---------------------------------------------------------',
                    ' * Copyright (c) Microsoft Corporation. All rights reserved.',
                    ' *--------------------------------------------------------*/'
                ], entries = global.cssPluginEntryPoints[moduleName];
                for (var i = 0; i < entries.length; i++) {
                    if (global.inlineResources) {
                        contents.push(Utilities.rewriteOrInlineUrls(entries[i].fsPath, entries[i].moduleName, moduleName, entries[i].contents, global.inlineResources === 'base64', global.inlineResourcesLimit));
                    }
                    else {
                        contents.push(Utilities.rewriteUrls(entries[i].moduleName, moduleName, entries[i].contents));
                    }
                }
                write(fileName, contents.join('\r\n'));
            }
        };
        CSSPlugin.prototype.getInlinedResources = function () {
            return global.cssInlinedResources || [];
        };
        CSSPlugin.BUILD_MAP = {};
        CSSPlugin.BUILD_PATH_MAP = {};
        return CSSPlugin;
    }());
    CSSBuildLoaderPlugin.CSSPlugin = CSSPlugin;
    var Utilities = /** @class */ (function () {
        function Utilities() {
        }
        Utilities.startsWith = function (haystack, needle) {
            return haystack.length >= needle.length && haystack.substr(0, needle.length) === needle;
        };
        /**
         * Find the path of a file.
         */
        Utilities.pathOf = function (filename) {
            var lastSlash = filename.lastIndexOf('/');
            if (lastSlash !== -1) {
                return filename.substr(0, lastSlash + 1);
            }
            else {
                return '';
            }
        };
        /**
         * A conceptual a + b for paths.
         * Takes into account if `a` contains a protocol.
         * Also normalizes the result: e.g.: a/b/ + ../c => a/c
         */
        Utilities.joinPaths = function (a, b) {
            function findSlashIndexAfterPrefix(haystack, prefix) {
                if (Utilities.startsWith(haystack, prefix)) {
                    return Math.max(prefix.length, haystack.indexOf('/', prefix.length));
                }
                return 0;
            }
            var aPathStartIndex = 0;
            aPathStartIndex = aPathStartIndex || findSlashIndexAfterPrefix(a, '//');
            aPathStartIndex = aPathStartIndex || findSlashIndexAfterPrefix(a, 'http://');
            aPathStartIndex = aPathStartIndex || findSlashIndexAfterPrefix(a, 'https://');
            function pushPiece(pieces, piece) {
                if (piece === './') {
                    // Ignore
                    return;
                }
                if (piece === '../') {
                    var prevPiece = (pieces.length > 0 ? pieces[pieces.length - 1] : null);
                    if (prevPiece && prevPiece === '/') {
                        // Ignore
                        return;
                    }
                    if (prevPiece && prevPiece !== '../') {
                        // Pop
                        pieces.pop();
                        return;
                    }
                }
                // Push
                pieces.push(piece);
            }
            function push(pieces, path) {
                while (path.length > 0) {
                    var slashIndex = path.indexOf('/');
                    var piece = (slashIndex >= 0 ? path.substring(0, slashIndex + 1) : path);
                    path = (slashIndex >= 0 ? path.substring(slashIndex + 1) : '');
                    pushPiece(pieces, piece);
                }
            }
            var pieces = [];
            push(pieces, a.substr(aPathStartIndex));
            if (b.length > 0 && b.charAt(0) === '/') {
                pieces = [];
            }
            push(pieces, b);
            return a.substring(0, aPathStartIndex) + pieces.join('');
        };
        Utilities.commonPrefix = function (str1, str2) {
            var len = Math.min(str1.length, str2.length);
            for (var i = 0; i < len; i++) {
                if (str1.charCodeAt(i) !== str2.charCodeAt(i)) {
                    break;
                }
            }
            return str1.substring(0, i);
        };
        Utilities.commonFolderPrefix = function (fromPath, toPath) {
            var prefix = Utilities.commonPrefix(fromPath, toPath);
            var slashIndex = prefix.lastIndexOf('/');
            if (slashIndex === -1) {
                return '';
            }
            return prefix.substring(0, slashIndex + 1);
        };
        Utilities.relativePath = function (fromPath, toPath) {
            if (Utilities.startsWith(toPath, '/') || Utilities.startsWith(toPath, 'http://') || Utilities.startsWith(toPath, 'https://')) {
                return toPath;
            }
            // Ignore common folder prefix
            var prefix = Utilities.commonFolderPrefix(fromPath, toPath);
            fromPath = fromPath.substr(prefix.length);
            toPath = toPath.substr(prefix.length);
            var upCount = fromPath.split('/').length;
            var result = '';
            for (var i = 1; i < upCount; i++) {
                result += '../';
            }
            return result + toPath;
        };
        Utilities._replaceURL = function (contents, replacer) {
            // Use ")" as the terminator as quotes are oftentimes not used at all
            return contents.replace(/url\(\s*([^\)]+)\s*\)?/g, function (_) {
                var matches = [];
                for (var _i = 1; _i < arguments.length; _i++) {
                    matches[_i - 1] = arguments[_i];
                }
                var url = matches[0];
                // Eliminate starting quotes (the initial whitespace is not captured)
                if (url.charAt(0) === '"' || url.charAt(0) === '\'') {
                    url = url.substring(1);
                }
                // The ending whitespace is captured
                while (url.length > 0 && (url.charAt(url.length - 1) === ' ' || url.charAt(url.length - 1) === '\t')) {
                    url = url.substring(0, url.length - 1);
                }
                // Eliminate ending quotes
                if (url.charAt(url.length - 1) === '"' || url.charAt(url.length - 1) === '\'') {
                    url = url.substring(0, url.length - 1);
                }
                if (!Utilities.startsWith(url, 'data:') && !Utilities.startsWith(url, 'http://') && !Utilities.startsWith(url, 'https://')) {
                    url = replacer(url);
                }
                return 'url(' + url + ')';
            });
        };
        Utilities.rewriteUrls = function (originalFile, newFile, contents) {
            return this._replaceURL(contents, function (url) {
                var absoluteUrl = Utilities.joinPaths(Utilities.pathOf(originalFile), url);
                return Utilities.relativePath(newFile, absoluteUrl);
            });
        };
        Utilities.rewriteOrInlineUrls = function (originalFileFSPath, originalFile, newFile, contents, forceBase64, inlineByteLimit) {
            var fs = require.nodeRequire('fs');
            var path = require.nodeRequire('path');
            return this._replaceURL(contents, function (url) {
                if (/\.(svg|png)$/.test(url)) {
                    var fsPath = path.join(path.dirname(originalFileFSPath), url);
                    var fileContents = fs.readFileSync(fsPath);
                    if (fileContents.length < inlineByteLimit) {
                        global.cssInlinedResources = global.cssInlinedResources || [];
                        var normalizedFSPath = fsPath.replace(/\\/g, '/');
                        if (global.cssInlinedResources.indexOf(normalizedFSPath) >= 0) {
                            // console.warn('CSS INLINING IMAGE AT ' + fsPath + ' MORE THAN ONCE. CONSIDER CONSOLIDATING CSS RULES');
                        }
                        global.cssInlinedResources.push(normalizedFSPath);
                        var MIME = /\.svg$/.test(url) ? 'image/svg+xml' : 'image/png';
                        var DATA = ';base64,' + fileContents.toString('base64');
                        if (!forceBase64 && /\.svg$/.test(url)) {
                            // .svg => url encode as explained at https://codepen.io/tigt/post/optimizing-svgs-in-data-uris
                            var newText = fileContents.toString()
                                .replace(/"/g, '\'')
                                .replace(/</g, '%3C')
                                .replace(/>/g, '%3E')
                                .replace(/&/g, '%26')
                                .replace(/#/g, '%23')
                                .replace(/\s+/g, ' ');
                            var encodedData = ',' + newText;
                            if (encodedData.length < DATA.length) {
                                DATA = encodedData;
                            }
                        }
                        return '"data:' + MIME + DATA + '"';
                    }
                }
                var absoluteUrl = Utilities.joinPaths(Utilities.pathOf(originalFile), url);
                return Utilities.relativePath(newFile, absoluteUrl);
            });
        };
        return Utilities;
    }());
    CSSBuildLoaderPlugin.Utilities = Utilities;
    (function () {
        var cssLoader = null;
        var isElectron = (typeof process !== 'undefined' && typeof process.versions !== 'undefined' && typeof process.versions['electron'] !== 'undefined');
        if (typeof process !== 'undefined' && process.versions && !!process.versions.node && !isElectron) {
            cssLoader = new NodeCSSLoader();
        }
        else {
            cssLoader = new BrowserCSSLoader();
        }
        define('vs/css', new CSSPlugin(cssLoader));
    })();
})(CSSBuildLoaderPlugin || (CSSBuildLoaderPlugin = {}));
