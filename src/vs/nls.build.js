/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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
var _nlsPluginGlobal = this;
var NLSBuildLoaderPlugin;
(function (NLSBuildLoaderPlugin) {
    var global = (_nlsPluginGlobal || {});
    var Resources = global.Plugin && global.Plugin.Resources ? global.Plugin.Resources : undefined;
    var IS_PSEUDO = (global && global.document && global.document.location && global.document.location.hash.indexOf('pseudo=true') >= 0);
    function _format(message, args) {
        var result;
        if (args.length === 0) {
            result = message;
        }
        else {
            result = message.replace(/\{(\d+)\}/g, function (match, rest) {
                var index = rest[0];
                return typeof args[index] !== 'undefined' ? args[index] : match;
            });
        }
        if (IS_PSEUDO) {
            // FF3B and FF3D is the Unicode zenkaku representation for [ and ]
            result = '\uFF3B' + result.replace(/[aouei]/g, '$&$&') + '\uFF3D';
        }
        return result;
    }
    function findLanguageForModule(config, name) {
        var result = config[name];
        if (result)
            return result;
        result = config['*'];
        if (result)
            return result;
        return null;
    }
    function localize(data, message) {
        var args = [];
        for (var _i = 0; _i < (arguments.length - 2); _i++) {
            args[_i] = arguments[_i + 2];
        }
        return _format(message, args);
    }
    function createScopedLocalize(scope) {
        return function (idx, defaultValue) {
            var restArgs = Array.prototype.slice.call(arguments, 2);
            return _format(scope[idx], restArgs);
        };
    }
    var NLSPlugin = /** @class */ (function () {
        function NLSPlugin() {
            this.localize = localize;
        }
        NLSPlugin.prototype.setPseudoTranslation = function (value) {
            IS_PSEUDO = value;
        };
        NLSPlugin.prototype.create = function (key, data) {
            return {
                localize: createScopedLocalize(data[key])
            };
        };
        NLSPlugin.prototype.load = function (name, req, load, config) {
            config = config || {};
            if (!name || name.length === 0) {
                load({
                    localize: localize
                });
            }
            else {
                var suffix = void 0;
                if (Resources && Resources.getString) {
                    suffix = '.nls.keys';
                    req([name + suffix], function (keyMap) {
                        load({
                            localize: function (moduleKey, index) {
                                if (!keyMap[moduleKey])
                                    return 'NLS error: unknown key ' + moduleKey;
                                var mk = keyMap[moduleKey].keys;
                                if (index >= mk.length)
                                    return 'NLS error unknow index ' + index;
                                var subKey = mk[index];
                                var args = [];
                                args[0] = moduleKey + '_' + subKey;
                                for (var _i = 0; _i < (arguments.length - 2); _i++) {
                                    args[_i + 1] = arguments[_i + 2];
                                }
                                return Resources.getString.apply(Resources, args);
                            }
                        });
                    });
                }
                else {
                    if (config.isBuild) {
                        req([name + '.nls', name + '.nls.keys'], function (messages, keys) {
                            NLSPlugin.BUILD_MAP[name] = messages;
                            NLSPlugin.BUILD_MAP_KEYS[name] = keys;
                            load(messages);
                        });
                    }
                    else {
                        var pluginConfig = config['vs/nls'] || {};
                        var language = pluginConfig.availableLanguages ? findLanguageForModule(pluginConfig.availableLanguages, name) : null;
                        suffix = '.nls';
                        if (language !== null && language !== NLSPlugin.DEFAULT_TAG) {
                            suffix = suffix + '.' + language;
                        }
                        req([name + suffix], function (messages) {
                            if (Array.isArray(messages)) {
                                messages.localize = createScopedLocalize(messages);
                            }
                            else {
                                messages.localize = createScopedLocalize(messages[name]);
                            }
                            load(messages);
                        });
                    }
                }
            }
        };
        NLSPlugin.prototype._getEntryPointsMap = function () {
            global.nlsPluginEntryPoints = global.nlsPluginEntryPoints || {};
            return global.nlsPluginEntryPoints;
        };
        NLSPlugin.prototype.write = function (pluginName, moduleName, write) {
            // getEntryPoint is a Monaco extension to r.js
            var entryPoint = write.getEntryPoint();
            // r.js destroys the context of this plugin between calling 'write' and 'writeFile'
            // so the only option at this point is to leak the data to a global
            var entryPointsMap = this._getEntryPointsMap();
            entryPointsMap[entryPoint] = entryPointsMap[entryPoint] || [];
            entryPointsMap[entryPoint].push(moduleName);
            if (moduleName !== entryPoint) {
                write.asModule(pluginName + '!' + moduleName, 'define([\'vs/nls\', \'vs/nls!' + entryPoint + '\'], function(nls, data) { return nls.create("' + moduleName + '", data); });');
            }
        };
        NLSPlugin.prototype.writeFile = function (pluginName, moduleName, req, write, config) {
            var entryPointsMap = this._getEntryPointsMap();
            if (entryPointsMap.hasOwnProperty(moduleName)) {
                var fileName = req.toUrl(moduleName + '.nls.js');
                var contents = [
                    '/*---------------------------------------------------------',
                    ' * Copyright (c) Microsoft Corporation. All rights reserved.',
                    ' *--------------------------------------------------------*/'
                ], entries = entryPointsMap[moduleName];
                var data = {};
                for (var i = 0; i < entries.length; i++) {
                    data[entries[i]] = NLSPlugin.BUILD_MAP[entries[i]];
                }
                contents.push('define("' + moduleName + '.nls", ' + JSON.stringify(data, null, '\t') + ');');
                write(fileName, contents.join('\r\n'));
            }
        };
        NLSPlugin.prototype.finishBuild = function (write) {
            write('nls.metadata.json', JSON.stringify({
                keys: NLSPlugin.BUILD_MAP_KEYS,
                messages: NLSPlugin.BUILD_MAP,
                bundles: this._getEntryPointsMap()
            }, null, '\t'));
        };
        ;
        NLSPlugin.DEFAULT_TAG = 'i-default';
        NLSPlugin.BUILD_MAP = {};
        NLSPlugin.BUILD_MAP_KEYS = {};
        return NLSPlugin;
    }());
    NLSBuildLoaderPlugin.NLSPlugin = NLSPlugin;
    (function () {
        define('vs/nls', new NLSPlugin());
    })();
})(NLSBuildLoaderPlugin || (NLSBuildLoaderPlugin = {}));
