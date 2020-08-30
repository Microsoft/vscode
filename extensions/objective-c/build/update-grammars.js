/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');

updateGrammar.update('jeff-hykin/cpp-textmate-grammar', '/syntaxes/objc.tmLanguage.json', './syntaxes/objective-c.tmLanguage.json', undefined, 'master', 'source/languages/cpp');
updateGrammar.update('jeff-hykin/cpp-textmate-grammar', '/syntaxes/objcpp.tmLanguage.json', './syntaxes/objective-c++.tmLanguage.json', undefined, 'master', 'source/languages/cpp');

