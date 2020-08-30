/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import * as vscode from 'vscode';
import * as languageModeIds from './languageModeIds';

export const enum DiagnosticLanguage {
	JavaScript,
	TypeScript
}

export const allDiagnosticLanguages = [DiagnosticLanguage.JavaScript, DiagnosticLanguage.TypeScript];

export interface LanguageDescription {
	readonly id: string;
	readonly diagnosticOwner: string;
	readonly diagnosticSource: string;
	readonly diagnosticLanguage: DiagnosticLanguage;
	readonly modeIds: string[];
	readonly configFilePattern?: RegExp;
	readonly isExternal?: boolean;
}

export const standardLanguageDescriptions: LanguageDescription[] = [
	{
		id: 'typescript',
		diagnosticOwner: 'typescript',
		diagnosticSource: 'ts',
		diagnosticLanguage: DiagnosticLanguage.TypeScript,
		modeIds: [languageModeIds.typescript, languageModeIds.typescriptreact],
		configFilePattern: /^tsconfig(\..*)?\.json$/gi
	}, {
		id: 'javascript',
		diagnosticOwner: 'typescript',
		diagnosticSource: 'ts',
		diagnosticLanguage: DiagnosticLanguage.JavaScript,
		modeIds: [languageModeIds.javascript, languageModeIds.javascriptreact],
		configFilePattern: /^jsconfig(\..*)?\.json$/gi
	}
];

export function isTsConfigFileName(fileName: string): boolean {
	return /^tsconfig\.(.+\.)?json$/i.test(basename(fileName));
}

export function isJsConfigOrTsConfigFileName(fileName: string): boolean {
	return /^[jt]sconfig\.(.+\.)?json$/i.test(basename(fileName));
}

export function doesResourceLookLikeATypeScriptFile(resource: vscode.Uri): boolean {
	return /\.tsx?$/i.test(resource.fsPath);
}

export function doesResourceLookLikeAJavaScriptFile(resource: vscode.Uri): boolean {
	return /\.jsx?$/i.test(resource.fsPath);
}
