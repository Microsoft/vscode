/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toCanonicalName } from 'vs/workbench/services/textfile/common/encoding';
import * as pfs from 'vs/base/node/pfs';
import { ITextQuery } from 'vs/workbench/services/search/common/search';
import { TextSearchProvider } from 'vs/workbench/services/search/common/searchExtTypes';
import { TextSearchManager } from 'vs/workbench/services/search/common/textSearchManager';

export class NativeTextSearchManager extends TextSearchManager {

	constructor(query: ITextQuery, provider: TextSearchProvider, _pfs: typeof pfs = pfs) {
		super(query, provider, {
			readdir: resource => _pfs.readdir(resource.fsPath),
			toCanonicalName: name => toCanonicalName(name)
		});
	}
}
