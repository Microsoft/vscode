/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('vscode API - types', () => {

	test('static properties, es5 compat class', function () {
		assert.ok(vscode.ThemeIcon.File instanceof vscode.ThemeIcon);
		assert.ok(vscode.ThemeIcon.Folder instanceof vscode.ThemeIcon);
		assert.ok(vscode.CodeActionKind.Empty instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.QuickFix instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.Refactor instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.RefactorExtract instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.RefactorInline instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.RefactorRewrite instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.Source instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.SourceOrganizeImports instanceof vscode.CodeActionKind);
		assert.ok(vscode.CodeActionKind.SourceFixAll instanceof vscode.CodeActionKind);
		// assert.ok(vscode.QuickInputButtons.Back instanceof vscode.QuickInputButtons); never was an instance

	});
});
