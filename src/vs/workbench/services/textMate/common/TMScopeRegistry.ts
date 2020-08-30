/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as resources from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { Disposable } from 'vs/base/common/lifecycle';
import { StandardTokenType, LanguageId } from 'vs/editor/common/modes';

export interface IValidGrammarDefinition {
	location: URI;
	language?: LanguageId;
	scopeName: string;
	embeddedLanguages: IValidEmbeddedLanguagesMap;
	tokenTypes: IValidTokenTypeMap;
	injectTo?: string[];
}

export interface IValidTokenTypeMap {
	[selector: string]: StandardTokenType;
}

export interface IValidEmbeddedLanguagesMap {
	[scopeName: string]: LanguageId;
}

export class TMScopeRegistry extends Disposable {

	private _scopeNameToLanguageRegistration: { [scopeName: string]: IValidGrammarDefinition; };

	constructor() {
		super();
		this._scopeNameToLanguageRegistration = Object.create(null);
	}

	public reset(): void {
		this._scopeNameToLanguageRegistration = Object.create(null);
	}

	public register(def: IValidGrammarDefinition): void {
		if (this._scopeNameToLanguageRegistration[def.scopeName]) {
			const existingRegistration = this._scopeNameToLanguageRegistration[def.scopeName];
			if (!resources.isEqual(existingRegistration.location, def.location)) {
				console.warn(
					`Overwriting grammar scope name to file mapping for scope ${def.scopeName}.\n` +
					`Old grammar file: ${existingRegistration.location.toString()}.\n` +
					`New grammar file: ${def.location.toString()}`
				);
			}
		}
		this._scopeNameToLanguageRegistration[def.scopeName] = def;
	}

	public getGrammarDefinition(scopeName: string): IValidGrammarDefinition | null {
		return this._scopeNameToLanguageRegistration[scopeName] || null;
	}
}
