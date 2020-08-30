/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMode, LanguageIdentifier } from 'vs/editor/common/modes';

export class FrankensteinMode implements IMode {

	private readonly _languageIdentifier: LanguageIdentifier;

	constructor(languageIdentifier: LanguageIdentifier) {
		this._languageIdentifier = languageIdentifier;
	}

	public getId(): string {
		return this._languageIdentifier.language;
	}

	public getLanguageIdentifier(): LanguageIdentifier {
		return this._languageIdentifier;
	}
}
