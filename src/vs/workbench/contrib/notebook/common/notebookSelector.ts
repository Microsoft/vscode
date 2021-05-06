/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRelativePattern } from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import * as ls from 'vs/editor/common/modes/languageSelector';

export interface NotebookFilter {
	readonly viewType?: string;
	readonly scheme?: string;
	readonly pattern?: string | IRelativePattern;
}

export type NotebookSelector = NotebookFilter | string | ReadonlyArray<NotebookFilter | string>;

function _asLanguageSelector(s: NotebookSelector): ls.LanguageFilter | ls.LanguageFilter[] {
	if (Array.isArray(s)) {
		return <ls.LanguageFilter[]>s.map(_asLanguageSelector);
	} else if (typeof s === 'string') {
		return { language: s };
	} else {
		const { viewType, scheme, pattern } = <NotebookFilter>s;
		return { language: viewType, scheme: scheme, pattern: pattern };
	}
}

export function score(selector: NotebookSelector, candidateUri: URI, candidateViewType: string): number {
	return ls.score(_asLanguageSelector(selector), candidateUri, candidateViewType, true);
}
