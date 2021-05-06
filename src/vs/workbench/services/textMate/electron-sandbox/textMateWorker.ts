/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkerContext } from 'vs/editor/common/services/editorSimpleWorker';
import { UriComponents, URI } from 'vs/base/common/uri';
import { LanguageId } from 'vs/editor/common/modes';
import { IValidEmbeddedLanguagesMap, IValidTokenTypeMap, IValidGrammarDefinition } from 'vs/workbench/services/textMate/common/TMScopeRegistry';
import { TMGrammarFactory, ICreateGrammarResult } from 'vs/workbench/services/textMate/common/TMGrammarFactory';
import { IModelChangedEvent, MirrorTextModel } from 'vs/editor/common/model/mirrorTextModel';
import { TextMateWorkerHost } from 'vs/workbench/services/textMate/electron-sandbox/textMateService';
import { TokenizationStateStore } from 'vs/editor/common/model/textModelTokens';
import type { IGrammar, StackElement, IRawTheme, IOnigLib } from 'vscode-textmate';
import { MultilineTokensBuilder, countEOL } from 'vs/editor/common/model/tokensStore';
import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { FileAccess } from 'vs/base/common/network';

export interface IValidGrammarDefinitionDTO {
	location: UriComponents;
	language?: LanguageId;
	scopeName: string;
	embeddedLanguages: IValidEmbeddedLanguagesMap;
	tokenTypes: IValidTokenTypeMap;
	injectTo?: string[];
}

export interface ICreateData {
	grammarDefinitions: IValidGrammarDefinitionDTO[];
}

export interface IRawModelData {
	uri: UriComponents;
	versionId: number;
	lines: string[];
	EOL: string;
	languageId: LanguageId;
}

class TextMateWorkerModel extends MirrorTextModel {

	private readonly _tokenizationStateStore: TokenizationStateStore;
	private readonly _worker: TextMateWorker;
	private _languageId: LanguageId;
	private _grammar: IGrammar | null;
	private _isDisposed: boolean;

	constructor(uri: URI, lines: string[], eol: string, versionId: number, worker: TextMateWorker, languageId: LanguageId) {
		super(uri, lines, eol, versionId);
		this._tokenizationStateStore = new TokenizationStateStore();
		this._worker = worker;
		this._languageId = languageId;
		this._isDisposed = false;
		this._grammar = null;
		this._resetTokenization();
	}

	public override dispose(): void {
		this._isDisposed = true;
		super.dispose();
	}

	public onLanguageId(languageId: LanguageId): void {
		this._languageId = languageId;
		this._resetTokenization();
	}

	override onEvents(e: IModelChangedEvent): void {
		super.onEvents(e);
		for (let i = 0; i < e.changes.length; i++) {
			const change = e.changes[i];
			const [eolCount] = countEOL(change.text);
			this._tokenizationStateStore.applyEdits(change.range, eolCount);
		}
		this._ensureTokens();
	}

	private _resetTokenization(): void {
		this._grammar = null;
		this._tokenizationStateStore.flush(null);

		const languageId = this._languageId;
		this._worker.getOrCreateGrammar(languageId).then((r) => {
			if (this._isDisposed || languageId !== this._languageId || !r) {
				return;
			}

			this._grammar = r.grammar;
			this._tokenizationStateStore.flush(r.initialState);
			this._ensureTokens();
		});
	}

	private _ensureTokens(): void {
		if (!this._grammar) {
			return;
		}
		const builder = new MultilineTokensBuilder();
		const lineCount = this._lines.length;

		// Validate all states up to and including endLineIndex
		for (let lineIndex = this._tokenizationStateStore.invalidLineStartIndex; lineIndex < lineCount; lineIndex++) {
			const text = this._lines[lineIndex];
			const lineStartState = this._tokenizationStateStore.getBeginState(lineIndex);

			const r = this._grammar.tokenizeLine2(text, <StackElement>lineStartState!);
			LineTokens.convertToEndOffset(r.tokens, text.length);
			builder.add(lineIndex + 1, r.tokens);
			this._tokenizationStateStore.setEndState(lineCount, lineIndex, r.ruleStack);
			lineIndex = this._tokenizationStateStore.invalidLineStartIndex - 1; // -1 because the outer loop increments it
		}

		this._worker._setTokens(this._uri, this._versionId, builder.serialize());
	}
}

export class TextMateWorker {

	private readonly _host: TextMateWorkerHost;
	private readonly _models: { [uri: string]: TextMateWorkerModel; };
	private readonly _grammarCache: Promise<ICreateGrammarResult>[];
	private readonly _grammarFactory: Promise<TMGrammarFactory | null>;

	constructor(ctx: IWorkerContext<TextMateWorkerHost>, createData: ICreateData) {
		this._host = ctx.host;
		this._models = Object.create(null);
		this._grammarCache = [];
		const grammarDefinitions = createData.grammarDefinitions.map<IValidGrammarDefinition>((def) => {
			return {
				location: URI.revive(def.location),
				language: def.language,
				scopeName: def.scopeName,
				embeddedLanguages: def.embeddedLanguages,
				tokenTypes: def.tokenTypes,
				injectTo: def.injectTo,
			};
		});
		this._grammarFactory = this._loadTMGrammarFactory(grammarDefinitions);
	}

	private async _loadTMGrammarFactory(grammarDefinitions: IValidGrammarDefinition[]): Promise<TMGrammarFactory> {
		require.config({
			paths: {
				'vscode-textmate': '../node_modules/vscode-textmate/release/main',
				'vscode-oniguruma': '../node_modules/vscode-oniguruma/release/main',
			}
		});
		const vscodeTextmate = await import('vscode-textmate');
		const vscodeOniguruma = await import('vscode-oniguruma');
		const response = await fetch(FileAccess.asBrowserUri('vscode-oniguruma/../onig.wasm', require).toString(true));
		// Using the response directly only works if the server sets the MIME type 'application/wasm'.
		// Otherwise, a TypeError is thrown when using the streaming compiler.
		// We therefore use the non-streaming compiler :(.
		const bytes = await response.arrayBuffer();
		await vscodeOniguruma.loadWASM(bytes);

		const onigLib: Promise<IOnigLib> = Promise.resolve({
			createOnigScanner: (sources) => vscodeOniguruma.createOnigScanner(sources),
			createOnigString: (str) => vscodeOniguruma.createOnigString(str)
		});

		return new TMGrammarFactory({
			logTrace: (msg: string) => {/* console.log(msg) */ },
			logError: (msg: string, err: any) => console.error(msg, err),
			readFile: (resource: URI) => this._host.readFile(resource)
		}, grammarDefinitions, vscodeTextmate, onigLib);
	}

	public acceptNewModel(data: IRawModelData): void {
		const uri = URI.revive(data.uri);
		const key = uri.toString();
		this._models[key] = new TextMateWorkerModel(uri, data.lines, data.EOL, data.versionId, this, data.languageId);
	}

	public acceptModelChanged(strURL: string, e: IModelChangedEvent): void {
		this._models[strURL].onEvents(e);
	}

	public acceptModelLanguageChanged(strURL: string, newLanguageId: LanguageId): void {
		this._models[strURL].onLanguageId(newLanguageId);
	}

	public acceptRemovedModel(strURL: string): void {
		if (this._models[strURL]) {
			this._models[strURL].dispose();
			delete this._models[strURL];
		}
	}

	public async getOrCreateGrammar(languageId: LanguageId): Promise<ICreateGrammarResult | null> {
		const grammarFactory = await this._grammarFactory;
		if (!grammarFactory) {
			return Promise.resolve(null);
		}
		if (!this._grammarCache[languageId]) {
			this._grammarCache[languageId] = grammarFactory.createGrammar(languageId);
		}
		return this._grammarCache[languageId];
	}

	public async acceptTheme(theme: IRawTheme, colorMap: string[]): Promise<void> {
		const grammarFactory = await this._grammarFactory;
		if (grammarFactory) {
			grammarFactory.setTheme(theme, colorMap);
		}
	}

	public _setTokens(resource: URI, versionId: number, tokens: Uint8Array): void {
		this._host.setTokens(resource, versionId, tokens);
	}
}

export function create(ctx: IWorkerContext<TextMateWorkerHost>, createData: ICreateData): TextMateWorker {
	return new TextMateWorker(ctx, createData);
}
