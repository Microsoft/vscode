/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IMode, LanguageIdentifier } from 'vs/editor/common/modes';
import { ILanguageSelection } from 'vs/editor/common/services/modeService';

export class MockMode extends Disposable implements IMode {
	private readonly _languageIdentifier: LanguageIdentifier;

	constructor(languageIdentifier: LanguageIdentifier) {
		super();
		this._languageIdentifier = languageIdentifier;
	}

	public getId(): string {
		return this._languageIdentifier.language;
	}

	public getLanguageIdentifier(): LanguageIdentifier {
		return this._languageIdentifier;
	}
}

export class StaticLanguageSelector implements ILanguageSelection {
	readonly onDidChange: Event<LanguageIdentifier> = Event.None;
	constructor(public readonly languageIdentifier: LanguageIdentifier) { }
}
