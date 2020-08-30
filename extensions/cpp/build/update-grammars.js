/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');

updateGrammar.update('jeff-hykin/cpp-textmate-grammar', '/syntaxes/c.tmLanguage.json', './syntaxes/c.tmLanguage.json', undefined, 'master', 'source/languages/cpp/');
updateGrammar.update('jeff-hykin/cpp-textmate-grammar', '/syntaxes/cpp.tmLanguage.json', './syntaxes/cpp.tmLanguage.json', undefined, 'master', 'source/languages/cpp/');
updateGrammar.update('jeff-hykin/cpp-textmate-grammar', '/syntaxes/cpp.embedded.macro.tmLanguage.json', './syntaxes/cpp.embedded.macro.tmLanguage.json', undefined, 'master', 'source/languages/cpp/');

// `source.c.platform` which is still included by other grammars
updateGrammar.update('textmate/c.tmbundle', 'Syntaxes/Platform.tmLanguage', './syntaxes/platform.tmLanguage.json');

