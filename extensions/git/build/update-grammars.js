/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');

updateGrammar.update('textmate/git.tmbundle', 'Syntaxes/Git%20Commit%20Message.tmLanguage', './syntaxes/git-commit.tmLanguage.json');
updateGrammar.update('textmate/git.tmbundle', 'Syntaxes/Git%20Rebase%20Message.tmLanguage', './syntaxes/git-rebase.tmLanguage.json');
updateGrammar.update('textmate/diff.tmbundle', 'Syntaxes/Diff.plist', './syntaxes/diff.tmLanguage.json');





