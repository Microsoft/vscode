/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageIdentifier } from 'vs/editor/common/modes';
import { CommentRule } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';

export class CommentMode extends MockMode {
	private static readonly _id = new LanguageIdentifier('commentMode', 3);

	constructor(commentsConfig: CommentRule) {
		super(CommentMode._id);
		this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
			comments: commentsConfig
		}));
	}
}
