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
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
var NLSLoaderPlugin;
(function (NLSLoaderPlugin) {
    var Environment = /** @class */ (function () {
        function Environment() {
            this._detected = false;
            this._isPseudo = false;
        }
        Object.defineProperty(Environment.prototype, "isPseudo", {
            get: function () {
                this._detect();
                return this._isPseudo;
            },
            enumerable: true,
            configurable: true
        });
        Environment.prototype._detect = function () {
            if (this._detected) {
                return;
            }
            this._detected = true;
            this._isPseudo = (typeof document !== 'undefined' && document.location && document.location.hash.indexOf('pseudo=true') >= 0);
        };
        return Environment;
    }());
    function _format(message, args, env) {
        var result;
        if (args.length === 0) {
            result = message;
        }
        else {
            result = message.replace(/\{(\d+)\}/g, function (match, rest) {
                var index = rest[0];
                var arg = args[index];
                var result = match;
                if (typeof arg === 'string') {
                    result = arg;
                }
                else if (typeof arg === 'number' || typeof arg === 'boolean' || arg === void 0 || arg === null) {
                    result = String(arg);
                }
                return result;
            });
        }
        if (env.isPseudo) {
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
    function localize(env, data, message) {
        var args = [];
        for (var _i = 3; _i < arguments.length; _i++) {
            args[_i - 3] = arguments[_i];
        }
        return _format(message, args, env);
    }
    function createScopedLocalize(scope, env) {
        return function (idx, defaultValue) {
            var restArgs = Array.prototype.slice.call(arguments, 2);
            return _format(scope[idx], restArgs, env);
        };
    }
    var NLSPlugin = /** @class */ (function () {
        function NLSPlugin(env) {
            var _this = this;
            this._env = env;
            this.localize = function (data, message) {
                var args = [];
                for (var _i = 2; _i < arguments.length; _i++) {
                    args[_i - 2] = arguments[_i];
                }
                return localize.apply(void 0, __spreadArrays([_this._env, data, message], args));
            };
        }
        NLSPlugin.prototype.setPseudoTranslation = function (value) {
            this._env._isPseudo = value;
        };
        NLSPlugin.prototype.create = function (key, data) {
            return {
                localize: createScopedLocalize(data[key], this._env)
            };
        };
        NLSPlugin.prototype.load = function (name, req, load, config) {
            var _this = this;
            config = config || {};
            if (!name || name.length === 0) {
                load({
                    localize: this.localize
                });
            }
            else {
                var pluginConfig = config['vs/nls'] || {};
                var language = pluginConfig.availableLanguages ? findLanguageForModule(pluginConfig.availableLanguages, name) : null;
                var suffix = '.nls';
                if (language !== null && language !== NLSPlugin.DEFAULT_TAG) {
                    suffix = suffix + '.' + language;
                }
                var messagesLoaded_1 = function (messages) {
                    if (Array.isArray(messages)) {
                        messages.localize = createScopedLocalize(messages, _this._env);
                    }
                    else {
                        messages.localize = createScopedLocalize(messages[name], _this._env);
                    }
                    load(messages);
                };
                if (typeof pluginConfig.loadBundle === 'function') {
                    pluginConfig.loadBundle(name, language, function (err, messages) {
                        // We have an error. Load the English default strings to not fail
                        if (err) {
                            req([name + '.nls'], messagesLoaded_1);
                        }
                        else {
                            messagesLoaded_1(messages);
                        }
                    });
                }
                else {
                    req([name + suffix], messagesLoaded_1);
                }
            }
        };
        NLSPlugin.DEFAULT_TAG = 'i-default';
        return NLSPlugin;
    }());
    NLSLoaderPlugin.NLSPlugin = NLSPlugin;
    define('vs/nls', new NLSPlugin(new Environment()));
})(NLSLoaderPlugin || (NLSLoaderPlugin = {}));
