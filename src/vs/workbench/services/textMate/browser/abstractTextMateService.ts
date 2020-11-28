/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { Color } from 'vs/base/common/color';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import * as resources from 'vs/base/common/resources';
import * as types from 'vs/base/common/types';
import { equals as equalArray } from 'vs/base/common/arrays';
import { URI } from 'vs/base/common/uri';
import { TokenizationResult, TokenizationResult2 } from 'vs/editor/common/core/token';
import { IState, ITokenizationSupport, LanguageId, TokenMetadata, TokenizationRegistry, StandardTokenType, LanguageIdentifier } from 'vs/editor/common/modes';
import { nullTokenize2 } from 'vs/editor/common/modes/nullMode';
import { generateTokensCSSForColorMap } from 'vs/editor/common/modes/supports/tokenization';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ExtensionMessageCollector } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ITMSyntaxExtensionPoint, grammarsExtPoint } from 'vs/workbench/services/textMate/common/TMGrammars';
import { ITextMateService } from 'vs/workbench/services/textMate/common/textMateService';
import { ITextMateThemingRule, IWorkbenchThemeService, IWorkbenchColorTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import type { IGrammar, StackElement, IOnigLib, IRawTheme } from 'vscode-textmate';
import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IValidGrammarDefinition, IValidEmbeddedLanguagesMap, IValidTokenTypeMap } from 'vs/workbench/services/textMate/common/TMScopeRegistry';
import { TMGrammarFactory } from 'vs/workbench/services/textMate/common/TMGrammarFactory';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';

export abstract class AbstractTextMateService extends Disposable implements ITextMateService {
	public _serviceBrand: undefined;

	private readonly _onDidEncounterLanguage: Emitter<LanguageId> = this._register(new Emitter<LanguageId>());
	public readonly onDidEncounterLanguage: Event<LanguageId> = this._onDidEncounterLanguage.event;

	private readonly _styleElement: HTMLStyleElement;
	private readonly _createdModes: string[];
	private readonly _encounteredLanguages: boolean[];

	private _debugMode: boolean;
	private _debugModePrintFunc: (str: string) => void;

	private _grammarDefinitions: IValidGrammarDefinition[] | null;
	private _grammarFactory: TMGrammarFactory | null;
	private _tokenizersRegistrations: IDisposable[];
	protected _currentTheme: IRawTheme | null;
	protected _currentTokenColorMap: string[] | null;

	constructor(
		@IModeService private readonly _modeService: IModeService,
		@IWorkbenchThemeService private readonly _themeService: IWorkbenchThemeService,
		@IExtensionResourceLoaderService protected readonly _extensionResourceLoaderService: IExtensionResourceLoaderService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IProgressService private readonly _progressService: IProgressService
	) {
		super();
		this._styleElement = dom.createStyleSheet();
		this._styleElement.className = 'vscode-tokens-styles';
		this._createdModes = [];
		this._encounteredLanguages = [];

		this._debugMode = false;
		this._debugModePrintFunc = () => { };

		this._grammarDefinitions = null;
		this._grammarFactory = null;
		this._tokenizersRegistrations = [];

		this._currentTheme = null;
		this._currentTokenColorMap = null;

		grammarsExtPoint.setHandler((extensions) => {
			this._grammarDefinitions = null;
			if (this._grammarFactory) {
				this._grammarFactory.dispose();
				this._grammarFactory = null;
				this._onDidDisposeGrammarFactory();
			}
			this._tokenizersRegistrations = dispose(this._tokenizersRegistrations);

			this._grammarDefinitions = [];
			for (const extension of extensions) {
				const grammars = extension.value;
				for (const grammar of grammars) {
					if (!this._validateGrammarExtensionPoint(extension.description.extensionLocation, grammar, extension.collector)) {
						continue;
					}
					const grammarLocation = resources.joinPath(extension.description.extensionLocation, grammar.path);

					const embeddedLanguages: IValidEmbeddedLanguagesMap = Object.create(null);
					if (grammar.embeddedLanguages) {
						let scopes = Object.keys(grammar.embeddedLanguages);
						for (let i = 0, len = scopes.length; i < len; i++) {
							let scope = scopes[i];
							let language = grammar.embeddedLanguages[scope];
							if (typeof language !== 'string') {
								// never hurts to be too careful
								continue;
							}
							let languageIdentifier = this._modeService.getLanguageIdentifier(language);
							if (languageIdentifier) {
								embeddedLanguages[scope] = languageIdentifier.id;
							}
						}
					}

					const tokenTypes: IValidTokenTypeMap = Object.create(null);
					if (grammar.tokenTypes) {
						const scopes = Object.keys(grammar.tokenTypes);
						for (const scope of scopes) {
							const tokenType = grammar.tokenTypes[scope];
							switch (tokenType) {
								case 'string':
									tokenTypes[scope] = StandardTokenType.String;
									break;
								case 'other':
									tokenTypes[scope] = StandardTokenType.Other;
									break;
								case 'comment':
									tokenTypes[scope] = StandardTokenType.Comment;
									break;
							}
						}
					}

					let languageIdentifier: LanguageIdentifier | null = null;
					if (grammar.language) {
						languageIdentifier = this._modeService.getLanguageIdentifier(grammar.language);
					}

					this._grammarDefinitions.push({
						location: grammarLocation,
						language: languageIdentifier ? languageIdentifier.id : undefined,
						scopeName: grammar.scopeName,
						embeddedLanguages: embeddedLanguages,
						tokenTypes: tokenTypes,
						injectTo: grammar.injectTo,
					});
				}
			}

			for (const createMode of this._createdModes) {
				this._registerDefinitionIfAvailable(createMode);
			}
		});

		this._register(this._themeService.onDidColorThemeChange(() => {
			if (this._grammarFactory) {
				this._updateTheme(this._grammarFactory, this._themeService.getColorTheme(), false);
			}
		}));

		// Generate some color map until the grammar registry is loaded
		let colorTheme = this._themeService.getColorTheme();
		let defaultForeground: Color = Color.transparent;
		let defaultBackground: Color = Color.transparent;
		for (let i = 0, len = colorTheme.tokenColors.length; i < len; i++) {
			let rule = colorTheme.tokenColors[i];
			if (!rule.scope && rule.settings) {
				if (rule.settings.foreground) {
					defaultForeground = Color.fromHex(rule.settings.foreground);
				}
				if (rule.settings.background) {
					defaultBackground = Color.fromHex(rule.settings.background);
				}
			}
		}
		TokenizationRegistry.setColorMap([null!, defaultForeground, defaultBackground]);

		this._modeService.onDidCreateMode((mode) => {
			let modeId = mode.getId();
			this._createdModes.push(modeId);
			this._registerDefinitionIfAvailable(modeId);
		});
	}

	public startDebugMode(printFn: (str: string) => void, onStop: () => void): void {
		if (this._debugMode) {
			this._notificationService.error(nls.localize('alreadyDebugging', "Already Logging."));
			return;
		}

		this._debugModePrintFunc = printFn;
		this._debugMode = true;

		if (this._debugMode) {
			this._progressService.withProgress(
				{
					location: ProgressLocation.Notification,
					buttons: [nls.localize('stop', "Stop")]
				},
				(progress) => {
					progress.report({
						message: nls.localize('progress1', "Preparing to log TM Grammar parsing. Press Stop when finished.")
					});

					return this._getVSCodeOniguruma().then((vscodeOniguruma) => {
						vscodeOniguruma.setDefaultDebugCall(true);
						progress.report({
							message: nls.localize('progress2', "Now logging TM Grammar parsing. Press Stop when finished.")
						});
						return new Promise<void>((resolve, reject) => { });
					});
				},
				(choice) => {
					this._getVSCodeOniguruma().then((vscodeOniguruma) => {
						this._debugModePrintFunc = () => { };
						this._debugMode = false;
						vscodeOniguruma.setDefaultDebugCall(false);
						onStop();
					});
				}
			);
		}
	}

	private _canCreateGrammarFactory(): boolean {
		// Check if extension point is ready
		return (this._grammarDefinitions ? true : false);
	}

	private async _getOrCreateGrammarFactory(): Promise<TMGrammarFactory> {
		if (this._grammarFactory) {
			return this._grammarFactory;
		}

		const [vscodeTextmate, vscodeOniguruma] = await Promise.all([import('vscode-textmate'), this._getVSCodeOniguruma()]);
		const onigLib: Promise<IOnigLib> = Promise.resolve({
			createOnigScanner: (sources: string[]) => vscodeOniguruma.createOnigScanner(sources),
			createOnigString: (str: string) => vscodeOniguruma.createOnigString(str)
		});

		// Avoid duplicate instantiations
		if (this._grammarFactory) {
			return this._grammarFactory;
		}

		this._grammarFactory = new TMGrammarFactory({
			logTrace: (msg: string) => this._logService.trace(msg),
			logError: (msg: string, err: any) => this._logService.error(msg, err),
			readFile: (resource: URI) => this._extensionResourceLoaderService.readExtensionResource(resource)
		}, this._grammarDefinitions || [], vscodeTextmate, onigLib);
		this._onDidCreateGrammarFactory(this._grammarDefinitions || []);

		this._updateTheme(this._grammarFactory, this._themeService.getColorTheme(), true);

		return this._grammarFactory;
	}

	private _registerDefinitionIfAvailable(modeId: string): void {
		const languageIdentifier = this._modeService.getLanguageIdentifier(modeId);
		if (!languageIdentifier) {
			return;
		}
		if (!this._canCreateGrammarFactory()) {
			return;
		}
		const languageId = languageIdentifier.id;

		// Here we must register the promise ASAP (without yielding!)
		this._tokenizersRegistrations.push(TokenizationRegistry.registerPromise(modeId, (async () => {
			try {
				const grammarFactory = await this._getOrCreateGrammarFactory();
				if (!grammarFactory.has(languageId)) {
					return null;
				}
				const r = await grammarFactory.createGrammar(languageId);
				if (!r.grammar) {
					return null;
				}
				const tokenization = new TMTokenization(r.grammar, r.initialState, r.containsEmbeddedLanguages);
				tokenization.onDidEncounterLanguage((languageId) => {
					if (!this._encounteredLanguages[languageId]) {
						this._encounteredLanguages[languageId] = true;
						this._onDidEncounterLanguage.fire(languageId);
					}
				});
				return new TMTokenizationSupport(r.languageId, tokenization, this._notificationService, this._configurationService, this._storageService);
			} catch (err) {
				onUnexpectedError(err);
				return null;
			}
		})()));
	}

	private static _toColorMap(colorMap: string[]): Color[] {
		let result: Color[] = [null!];
		for (let i = 1, len = colorMap.length; i < len; i++) {
			result[i] = Color.fromHex(colorMap[i]);
		}
		return result;
	}

	private _updateTheme(grammarFactory: TMGrammarFactory, colorTheme: IWorkbenchColorTheme, forceUpdate: boolean): void {
		if (!forceUpdate && this._currentTheme && this._currentTokenColorMap && AbstractTextMateService.equalsTokenRules(this._currentTheme.settings, colorTheme.tokenColors) && equalArray(this._currentTokenColorMap, colorTheme.tokenColorMap)) {
			return;
		}
		this._currentTheme = { name: colorTheme.label, settings: colorTheme.tokenColors };
		this._currentTokenColorMap = colorTheme.tokenColorMap;
		this._doUpdateTheme(grammarFactory, this._currentTheme, this._currentTokenColorMap);
	}

	protected _doUpdateTheme(grammarFactory: TMGrammarFactory, theme: IRawTheme, tokenColorMap: string[]): void {
		grammarFactory.setTheme(theme, tokenColorMap);
		let colorMap = AbstractTextMateService._toColorMap(tokenColorMap);
		let cssRules = generateTokensCSSForColorMap(colorMap);
		this._styleElement.textContent = cssRules;
		TokenizationRegistry.setColorMap(colorMap);
	}

	private static equalsTokenRules(a: ITextMateThemingRule[] | null, b: ITextMateThemingRule[] | null): boolean {
		if (!b || !a || b.length !== a.length) {
			return false;
		}
		for (let i = b.length - 1; i >= 0; i--) {
			let r1 = b[i];
			let r2 = a[i];
			if (r1.scope !== r2.scope) {
				return false;
			}
			let s1 = r1.settings;
			let s2 = r2.settings;
			if (s1 && s2) {
				if (s1.fontStyle !== s2.fontStyle || s1.foreground !== s2.foreground || s1.background !== s2.background) {
					return false;
				}
			} else if (!s1 || !s2) {
				return false;
			}
		}
		return true;
	}

	private _validateGrammarExtensionPoint(extensionLocation: URI, syntax: ITMSyntaxExtensionPoint, collector: ExtensionMessageCollector): boolean {
		if (syntax.language && ((typeof syntax.language !== 'string') || !this._modeService.isRegisteredMode(syntax.language))) {
			collector.error(nls.localize('invalid.language', "Unknown language in `contributes.{0}.language`. Provided value: {1}", grammarsExtPoint.name, String(syntax.language)));
			return false;
		}
		if (!syntax.scopeName || (typeof syntax.scopeName !== 'string')) {
			collector.error(nls.localize('invalid.scopeName', "Expected string in `contributes.{0}.scopeName`. Provided value: {1}", grammarsExtPoint.name, String(syntax.scopeName)));
			return false;
		}
		if (!syntax.path || (typeof syntax.path !== 'string')) {
			collector.error(nls.localize('invalid.path.0', "Expected string in `contributes.{0}.path`. Provided value: {1}", grammarsExtPoint.name, String(syntax.path)));
			return false;
		}
		if (syntax.injectTo && (!Array.isArray(syntax.injectTo) || syntax.injectTo.some(scope => typeof scope !== 'string'))) {
			collector.error(nls.localize('invalid.injectTo', "Invalid value in `contributes.{0}.injectTo`. Must be an array of language scope names. Provided value: {1}", grammarsExtPoint.name, JSON.stringify(syntax.injectTo)));
			return false;
		}
		if (syntax.embeddedLanguages && !types.isObject(syntax.embeddedLanguages)) {
			collector.error(nls.localize('invalid.embeddedLanguages', "Invalid value in `contributes.{0}.embeddedLanguages`. Must be an object map from scope name to language. Provided value: {1}", grammarsExtPoint.name, JSON.stringify(syntax.embeddedLanguages)));
			return false;
		}

		if (syntax.tokenTypes && !types.isObject(syntax.tokenTypes)) {
			collector.error(nls.localize('invalid.tokenTypes', "Invalid value in `contributes.{0}.tokenTypes`. Must be an object map from scope name to token type. Provided value: {1}", grammarsExtPoint.name, JSON.stringify(syntax.tokenTypes)));
			return false;
		}

		const grammarLocation = resources.joinPath(extensionLocation, syntax.path);
		if (!resources.isEqualOrParent(grammarLocation, extensionLocation)) {
			collector.warn(nls.localize('invalid.path.1', "Expected `contributes.{0}.path` ({1}) to be included inside extension's folder ({2}). This might make the extension non-portable.", grammarsExtPoint.name, grammarLocation.path, extensionLocation.path));
		}
		return true;
	}

	public async createGrammar(modeId: string): Promise<IGrammar | null> {
		const languageId = this._modeService.getLanguageIdentifier(modeId);
		if (!languageId) {
			return null;
		}
		const grammarFactory = await this._getOrCreateGrammarFactory();
		if (!grammarFactory.has(languageId.id)) {
			return null;
		}
		const { grammar } = await grammarFactory.createGrammar(languageId.id);
		return grammar;
	}

	protected _onDidCreateGrammarFactory(grammarDefinitions: IValidGrammarDefinition[]): void {
	}

	protected _onDidDisposeGrammarFactory(): void {
	}

	private _vscodeOniguruma: Promise<typeof import('vscode-oniguruma')> | null = null;
	private _getVSCodeOniguruma(): Promise<typeof import('vscode-oniguruma')> {
		if (!this._vscodeOniguruma) {
			this._vscodeOniguruma = this._doGetVSCodeOniguruma();
		}
		return this._vscodeOniguruma;
	}

	private async _doGetVSCodeOniguruma(): Promise<typeof import('vscode-oniguruma')> {
		const [vscodeOniguruma, wasm] = await Promise.all([import('vscode-oniguruma'), this._loadVSCodeOnigurumWASM()]);
		const options = {
			data: wasm,
			print: (str: string) => {
				this._debugModePrintFunc(str);
			}
		};
		await vscodeOniguruma.loadWASM(options);
		return vscodeOniguruma;
	}

	protected abstract _loadVSCodeOnigurumWASM(): Promise<Response | ArrayBuffer>;
}

const donotAskUpdateKey = 'editor.maxTokenizationLineLength.donotask';

class TMTokenizationSupport implements ITokenizationSupport {
	private readonly _languageId: LanguageId;
	private readonly _actual: TMTokenization;
	private _tokenizationWarningAlreadyShown: boolean;
	private _maxTokenizationLineLength: number;

	constructor(
		languageId: LanguageId,
		actual: TMTokenization,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		this._languageId = languageId;
		this._actual = actual;
		this._tokenizationWarningAlreadyShown = !!(this._storageService.getBoolean(donotAskUpdateKey, StorageScope.GLOBAL));
		this._maxTokenizationLineLength = this._configurationService.getValue<number>('editor.maxTokenizationLineLength');
		this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.maxTokenizationLineLength')) {
				this._maxTokenizationLineLength = this._configurationService.getValue<number>('editor.maxTokenizationLineLength');
			}
		});
	}

	getInitialState(): IState {
		return this._actual.getInitialState();
	}

	tokenize(line: string, state: IState, offsetDelta: number): TokenizationResult {
		throw new Error('Not supported!');
	}

	tokenize2(line: string, state: StackElement, offsetDelta: number): TokenizationResult2 {
		if (offsetDelta !== 0) {
			throw new Error('Unexpected: offsetDelta should be 0.');
		}

		// Do not attempt to tokenize if a line is too long
		if (line.length >= this._maxTokenizationLineLength) {
			if (!this._tokenizationWarningAlreadyShown) {
				this._tokenizationWarningAlreadyShown = true;
				this._notificationService.prompt(
					Severity.Warning,
					nls.localize('too many characters', "Tokenization is skipped for long lines for performance reasons. The length of a long line can be configured via `editor.maxTokenizationLineLength`."),
					[{
						label: nls.localize('neverAgain', "Don't Show Again"),
						isSecondary: true,
						run: () => this._storageService.store(donotAskUpdateKey, true, StorageScope.GLOBAL, StorageTarget.USER)
					}]
				);
			}
			console.log(`Line (${line.substr(0, 15)}...): longer than ${this._maxTokenizationLineLength} characters, tokenization skipped.`);
			return nullTokenize2(this._languageId, line, state, offsetDelta);
		}

		return this._actual.tokenize2(line, state);
	}
}

class TMTokenization extends Disposable {

	private readonly _grammar: IGrammar;
	private readonly _containsEmbeddedLanguages: boolean;
	private readonly _seenLanguages: boolean[];
	private readonly _initialState: StackElement;

	private readonly _onDidEncounterLanguage: Emitter<LanguageId> = this._register(new Emitter<LanguageId>());
	public readonly onDidEncounterLanguage: Event<LanguageId> = this._onDidEncounterLanguage.event;

	constructor(grammar: IGrammar, initialState: StackElement, containsEmbeddedLanguages: boolean) {
		super();
		this._grammar = grammar;
		this._initialState = initialState;
		this._containsEmbeddedLanguages = containsEmbeddedLanguages;
		this._seenLanguages = [];
	}

	public getInitialState(): IState {
		return this._initialState;
	}

	public tokenize2(line: string, state: StackElement): TokenizationResult2 {
		let textMateResult = this._grammar.tokenizeLine2(line, state);

		if (this._containsEmbeddedLanguages) {
			let seenLanguages = this._seenLanguages;
			let tokens = textMateResult.tokens;

			// Must check if any of the embedded languages was hit
			for (let i = 0, len = (tokens.length >>> 1); i < len; i++) {
				let metadata = tokens[(i << 1) + 1];
				let languageId = TokenMetadata.getLanguageId(metadata);

				if (!seenLanguages[languageId]) {
					seenLanguages[languageId] = true;
					this._onDidEncounterLanguage.fire(languageId);
				}
			}
		}

		let endState: StackElement;
		// try to save an object if possible
		if (state.equals(textMateResult.ruleStack)) {
			endState = state;
		} else {
			endState = textMateResult.ruleStack;

		}

		return new TokenizationResult2(textMateResult.tokens, endState);
	}
}
