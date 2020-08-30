/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorAction, ServicesAccessor, IActionOptions } from 'vs/editor/browser/editorExtensions';
import { grammarsExtPoint, ITMSyntaxExtensionPoint } from 'vs/workbench/services/textMate/common/TMGrammars';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IExtensionService, ExtensionPointContribution } from 'vs/workbench/services/extensions/common/extensions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

interface ModeScopeMap {
	[key: string]: string;
}

export interface IGrammarContributions {
	getGrammar(mode: string): string;
}

export interface ILanguageIdentifierResolver {
	getLanguageIdentifier(modeId: string | LanguageId): LanguageIdentifier | null;
}

class GrammarContributions implements IGrammarContributions {

	private static _grammars: ModeScopeMap = {};

	constructor(contributions: ExtensionPointContribution<ITMSyntaxExtensionPoint[]>[]) {
		if (!Object.keys(GrammarContributions._grammars).length) {
			this.fillModeScopeMap(contributions);
		}
	}

	private fillModeScopeMap(contributions: ExtensionPointContribution<ITMSyntaxExtensionPoint[]>[]) {
		contributions.forEach((contribution) => {
			contribution.value.forEach((grammar) => {
				if (grammar.language && grammar.scopeName) {
					GrammarContributions._grammars[grammar.language] = grammar.scopeName;
				}
			});
		});
	}

	public getGrammar(mode: string): string {
		return GrammarContributions._grammars[mode];
	}
}

export interface IEmmetActionOptions extends IActionOptions {
	actionName: string;
}

export abstract class EmmetEditorAction extends EditorAction {

	protected emmetActionName: string;

	constructor(opts: IEmmetActionOptions) {
		super(opts);
		this.emmetActionName = opts.actionName;
	}

	private static readonly emmetSupportedModes = ['html', 'css', 'xml', 'xsl', 'haml', 'jade', 'jsx', 'slim', 'scss', 'sass', 'less', 'stylus', 'styl', 'svg'];

	private _lastGrammarContributions: Promise<GrammarContributions> | null = null;
	private _lastExtensionService: IExtensionService | null = null;
	private _withGrammarContributions(extensionService: IExtensionService): Promise<GrammarContributions | null> {
		if (this._lastExtensionService !== extensionService) {
			this._lastExtensionService = extensionService;
			this._lastGrammarContributions = extensionService.readExtensionPointContributions(grammarsExtPoint).then((contributions) => {
				return new GrammarContributions(contributions);
			});
		}
		return this._lastGrammarContributions || Promise.resolve(null);
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const extensionService = accessor.get(IExtensionService);
		const modeService = accessor.get(IModeService);
		const commandService = accessor.get(ICommandService);

		return this._withGrammarContributions(extensionService).then((grammarContributions) => {

			if (this.id === 'editor.emmet.action.expandAbbreviation' && grammarContributions) {
				return commandService.executeCommand<void>('emmet.expandAbbreviation', EmmetEditorAction.getLanguage(modeService, editor, grammarContributions));
			}

			return undefined;
		});

	}

	public static getLanguage(languageIdentifierResolver: ILanguageIdentifierResolver, editor: ICodeEditor, grammars: IGrammarContributions) {
		const model = editor.getModel();
		const selection = editor.getSelection();

		if (!model || !selection) {
			return null;
		}

		const position = selection.getStartPosition();
		model.tokenizeIfCheap(position.lineNumber);
		const languageId = model.getLanguageIdAtPosition(position.lineNumber, position.column);
		const languageIdentifier = languageIdentifierResolver.getLanguageIdentifier(languageId);
		const language = languageIdentifier ? languageIdentifier.language : '';
		const syntax = language.split('.').pop();

		if (!syntax) {
			return null;
		}

		let checkParentMode = (): string => {
			let languageGrammar = grammars.getGrammar(syntax);
			if (!languageGrammar) {
				return syntax;
			}
			let languages = languageGrammar.split('.');
			if (languages.length < 2) {
				return syntax;
			}
			for (let i = 1; i < languages.length; i++) {
				const language = languages[languages.length - i];
				if (this.emmetSupportedModes.indexOf(language) !== -1) {
					return language;
				}
			}
			return syntax;
		};

		return {
			language: syntax,
			parentMode: checkParentMode()
		};
	}


}
