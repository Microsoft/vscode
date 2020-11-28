/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');
updateGrammar.update('microsoft/vscode-mssql', 'syntaxes/SQL.plist', './syntaxes/sql.tmLanguage.json', undefined, 'main');


