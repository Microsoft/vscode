/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import * as pfs from 'vs/base/node/pfs';
import { IFileMatch, IProgressMessage, ITextQuery, ITextSearchStats, ITextSearchMatch, ISerializedFileMatch, ISerializedSearchSuccess } from 'vs/workbench/services/search/common/search';
import { RipgrepTextSearchEngine } from 'vs/workbench/services/search/node/ripgrepTextSearchEngine';
import { NativeTextSearchManager } from 'vs/workbench/services/search/node/textSearchManager';

export class TextSearchEngineAdapter {

	constructor(private query: ITextQuery) { }

	search(token: CancellationToken, onResult: (matches: ISerializedFileMatch[]) => void, onMessage: (message: IProgressMessage) => void): Promise<ISerializedSearchSuccess> {
		if ((!this.query.folderQueries || !this.query.folderQueries.length) && (!this.query.extraFileResources || !this.query.extraFileResources.length)) {
			return Promise.resolve(<ISerializedSearchSuccess>{
				type: 'success',
				limitHit: false,
				stats: <ITextSearchStats>{
					type: 'searchProcess'
				}
			});
		}

		const pretendOutputChannel = {
			appendLine(msg: string) {
				onMessage({ message: msg });
			}
		};
		const textSearchManager = new NativeTextSearchManager(this.query, new RipgrepTextSearchEngine(pretendOutputChannel), pfs);
		return new Promise((resolve, reject) => {
			return textSearchManager
				.search(
					matches => {
						onResult(matches.map(fileMatchToSerialized));
					},
					token)
				.then(
					c => resolve({ limitHit: c.limitHit, type: 'success' } as ISerializedSearchSuccess),
					reject);
		});
	}
}

function fileMatchToSerialized(match: IFileMatch): ISerializedFileMatch {
	return {
		path: match.resource && match.resource.fsPath,
		results: match.results,
		numMatches: (match.results || []).reduce((sum, r) => {
			if (!!(<ITextSearchMatch>r).ranges) {
				const m = <ITextSearchMatch>r;
				return sum + (Array.isArray(m.ranges) ? m.ranges.length : 1);
			} else {
				return sum + 1;
			}
		}, 0)
	};
}
