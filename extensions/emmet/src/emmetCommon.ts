/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DefaultCompletionItemProvider } from './defaultCompletionProvider';
import { expandEmmetAbbreviation, wrapWithAbbreviation, wrapIndividualLinesWithAbbreviation } from './abbreviationActions';
import { removeTag } from './removeTag';
import { updateTag } from './updateTag';
import { matchTag } from './matchTag';
import { balanceOut, balanceIn } from './balance';
import { splitJoinTag } from './splitJoinTag';
import { mergeLines } from './mergeLines';
import { toggleComment } from './toggleComment';
import { fetchEditPoint } from './editPoint';
import { fetchSelectItem } from './selectItem';
import { evaluateMathExpression } from './evaluateMathExpression';
import { incrementDecrement } from './incrementDecrement';
import { LANGUAGE_MODES, getMappingForIncludedLanguages, updateEmmetExtensionsPath, getPathBaseName } from './util';
import { reflectCssValue } from './reflectCssValue';

export function activateEmmetExtension(context: vscode.ExtensionContext) {
	registerCompletionProviders(context);

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.wrapWithAbbreviation', (args) => {
		wrapWithAbbreviation(args);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.wrapIndividualLinesWithAbbreviation', (args) => {
		wrapIndividualLinesWithAbbreviation(args);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('emmet.expandAbbreviation', (args) => {
		expandEmmetAbbreviation(args);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.removeTag', () => {
		return removeTag();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.updateTag', (inputTag) => {
		if (inputTag && typeof inputTag === 'string') {
			return updateTag(inputTag);
		}
		return vscode.window.showInputBox({ prompt: 'Enter Tag' }).then(tagName => {
			if (tagName) {
				const update = updateTag(tagName);
				return update ? update : false;
			}
			return false;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.matchTag', () => {
		matchTag();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.balanceOut', () => {
		balanceOut();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.balanceIn', () => {
		balanceIn();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.splitJoinTag', () => {
		return splitJoinTag();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.mergeLines', () => {
		mergeLines();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.toggleComment', () => {
		toggleComment();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.nextEditPoint', () => {
		fetchEditPoint('next');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.prevEditPoint', () => {
		fetchEditPoint('prev');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.selectNextItem', () => {
		fetchSelectItem('next');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.selectPrevItem', () => {
		fetchSelectItem('prev');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.evaluateMathExpression', () => {
		evaluateMathExpression();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.incrementNumberByOneTenth', () => {
		return incrementDecrement(0.1);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.incrementNumberByOne', () => {
		return incrementDecrement(1);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.incrementNumberByTen', () => {
		return incrementDecrement(10);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.decrementNumberByOneTenth', () => {
		return incrementDecrement(-0.1);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.decrementNumberByOne', () => {
		return incrementDecrement(-1);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.decrementNumberByTen', () => {
		return incrementDecrement(-10);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('editor.emmet.action.reflectCSSValue', () => {
		return reflectCssValue();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('workbench.action.showEmmetCommands', () => {
		vscode.commands.executeCommand('workbench.action.quickOpen', '>Emmet: ');
	}));

	updateEmmetExtensionsPath();

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('emmet.includeLanguages')) {
			registerCompletionProviders(context);
		}
		if (e.affectsConfiguration('emmet.extensionsPath')) {
			updateEmmetExtensionsPath();
		}
	}));

	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((e) => {
		const basefileName: string = getPathBaseName(e.fileName);
		if (basefileName.startsWith('snippets') && basefileName.endsWith('.json')) {
			updateEmmetExtensionsPath(true);
		}
	}));
}

/**
 * Holds any registered completion providers by their language strings
 */
const languageMappingForCompletionProviders: Map<string, string> = new Map<string, string>();
const completionProvidersMapping: Map<string, vscode.Disposable> = new Map<string, vscode.Disposable>();

function registerCompletionProviders(context: vscode.ExtensionContext) {
	let completionProvider = new DefaultCompletionItemProvider();
	let includedLanguages = getMappingForIncludedLanguages();

	Object.keys(includedLanguages).forEach(language => {
		if (languageMappingForCompletionProviders.has(language) && languageMappingForCompletionProviders.get(language) === includedLanguages[language]) {
			return;
		}

		if (languageMappingForCompletionProviders.has(language)) {
			const mapping = completionProvidersMapping.get(language);
			if (mapping) {
				mapping.dispose();
			}
			languageMappingForCompletionProviders.delete(language);
			completionProvidersMapping.delete(language);
		}

		const provider = vscode.languages.registerCompletionItemProvider({ language, scheme: '*' }, completionProvider, ...LANGUAGE_MODES[includedLanguages[language]]);
		context.subscriptions.push(provider);

		languageMappingForCompletionProviders.set(language, includedLanguages[language]);
		completionProvidersMapping.set(language, provider);
	});

	Object.keys(LANGUAGE_MODES).forEach(language => {
		if (!languageMappingForCompletionProviders.has(language)) {
			const provider = vscode.languages.registerCompletionItemProvider({ language, scheme: '*' }, completionProvider, ...LANGUAGE_MODES[language]);
			context.subscriptions.push(provider);

			languageMappingForCompletionProviders.set(language, language);
			completionProvidersMapping.set(language, provider);
		}
	});
}

export function deactivate() {
}
