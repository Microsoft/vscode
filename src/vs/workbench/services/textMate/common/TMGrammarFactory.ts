/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { LanguageId } from 'vs/editor/common/modes';
import { IGrammar, Registry, StackElement, IRawTheme, IOnigLib } from 'vscode-textmate';
import { Disposable } from 'vs/base/common/lifecycle';
import { TMScopeRegistry, IValidGrammarDefinition, IValidEmbeddedLanguagesMap } from 'vs/workbench/services/textMate/common/TMScopeRegistry';

interface ITMGrammarFactoryHost {
	logTrace(msg: string): void;
	logError(msg: string, err: any): void;
	readFile(resource: URI): Promise<string>;
}

export interface ICreateGrammarResult {
	languageId: LanguageId;
	grammar: IGrammar | null;
	initialState: StackElement;
	containsEmbeddedLanguages: boolean;
}

export class TMGrammarFactory extends Disposable {

	private readonly _host: ITMGrammarFactoryHost;
	private readonly _initialState: StackElement;
	private readonly _scopeRegistry: TMScopeRegistry;
	private readonly _injections: { [scopeName: string]: string[]; };
	private readonly _injectedEmbeddedLanguages: { [scopeName: string]: IValidEmbeddedLanguagesMap[]; };
	private readonly _languageToScope2: string[];
	private readonly _grammarRegistry: Registry;

	constructor(host: ITMGrammarFactoryHost, grammarDefinitions: IValidGrammarDefinition[], vscodeTextmate: typeof import('vscode-textmate'), onigLib: Promise<IOnigLib>) {
		super();
		this._host = host;
		this._initialState = vscodeTextmate.INITIAL;
		this._scopeRegistry = this._register(new TMScopeRegistry());
		this._injections = {};
		this._injectedEmbeddedLanguages = {};
		this._languageToScope2 = [];
		this._grammarRegistry = this._register(new vscodeTextmate.Registry({
			onigLib: onigLib,
			loadGrammar: async (scopeName: string) => {
				const grammarDefinition = this._scopeRegistry.getGrammarDefinition(scopeName);
				if (!grammarDefinition) {
					this._host.logTrace(`No grammar found for scope ${scopeName}`);
					return null;
				}
				const location = grammarDefinition.location;
				try {
					const content = await this._host.readFile(location);
					return vscodeTextmate.parseRawGrammar(content, location.path);
				} catch (e) {
					this._host.logError(`Unable to load and parse grammar for scope ${scopeName} from ${location}`, e);
					return null;
				}
			},
			getInjections: (scopeName: string) => {
				const scopeParts = scopeName.split('.');
				let injections: string[] = [];
				for (let i = 1; i <= scopeParts.length; i++) {
					const subScopeName = scopeParts.slice(0, i).join('.');
					injections = [...injections, ...(this._injections[subScopeName] || [])];
				}
				return injections;
			}
		}));

		for (const validGrammar of grammarDefinitions) {
			this._scopeRegistry.register(validGrammar);

			if (validGrammar.injectTo) {
				for (let injectScope of validGrammar.injectTo) {
					let injections = this._injections[injectScope];
					if (!injections) {
						this._injections[injectScope] = injections = [];
					}
					injections.push(validGrammar.scopeName);
				}

				if (validGrammar.embeddedLanguages) {
					for (let injectScope of validGrammar.injectTo) {
						let injectedEmbeddedLanguages = this._injectedEmbeddedLanguages[injectScope];
						if (!injectedEmbeddedLanguages) {
							this._injectedEmbeddedLanguages[injectScope] = injectedEmbeddedLanguages = [];
						}
						injectedEmbeddedLanguages.push(validGrammar.embeddedLanguages);
					}
				}
			}

			if (validGrammar.language) {
				this._languageToScope2[validGrammar.language] = validGrammar.scopeName;
			}
		}
	}

	public has(languageId: LanguageId): boolean {
		return this._languageToScope2[languageId] ? true : false;
	}

	public setTheme(theme: IRawTheme, colorMap: string[]): void {
		this._grammarRegistry.setTheme(theme, colorMap);
	}

	public getColorMap(): string[] {
		return this._grammarRegistry.getColorMap();
	}

	public async createGrammar(languageId: LanguageId): Promise<ICreateGrammarResult> {
		const scopeName = this._languageToScope2[languageId];
		if (typeof scopeName !== 'string') {
			// No TM grammar defined
			return Promise.reject(new Error(nls.localize('no-tm-grammar', "No TM Grammar registered for this language.")));
		}

		const grammarDefinition = this._scopeRegistry.getGrammarDefinition(scopeName);
		if (!grammarDefinition) {
			// No TM grammar defined
			return Promise.reject(new Error(nls.localize('no-tm-grammar', "No TM Grammar registered for this language.")));
		}

		let embeddedLanguages = grammarDefinition.embeddedLanguages;
		if (this._injectedEmbeddedLanguages[scopeName]) {
			const injectedEmbeddedLanguages = this._injectedEmbeddedLanguages[scopeName];
			for (const injected of injectedEmbeddedLanguages) {
				for (const scope of Object.keys(injected)) {
					embeddedLanguages[scope] = injected[scope];
				}
			}
		}

		const containsEmbeddedLanguages = (Object.keys(embeddedLanguages).length > 0);

		const grammar = await this._grammarRegistry.loadGrammarWithConfiguration(scopeName, languageId, { embeddedLanguages, tokenTypes: <any>grammarDefinition.tokenTypes });

		return {
			languageId: languageId,
			grammar: grammar,
			initialState: this._initialState,
			containsEmbeddedLanguages: containsEmbeddedLanguages
		};
	}
}
