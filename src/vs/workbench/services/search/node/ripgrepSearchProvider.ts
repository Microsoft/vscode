/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { OutputChannel } from 'vs/workbench/services/search/node/ripgrepSearchUtils';
import { RipgrepTextSearchEngine } from 'vs/workbench/services/search/node/ripgrepTextSearchEngine';
import { TextSearchProvider, TextSearchComplete, TextSearchResult, TextSearchQuery, TextSearchOptions } from 'vs/workbench/services/search/common/searchExtTypes';
import { Progress } from 'vs/platform/progress/common/progress';

export class RipgrepSearchProvider implements TextSearchProvider {
	private inProgress: Set<CancellationTokenSource> = new Set();

	constructor(private outputChannel: OutputChannel) {
		process.once('exit', () => this.dispose());
	}

	provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): Promise<TextSearchComplete> {
		const engine = new RipgrepTextSearchEngine(this.outputChannel);
		return this.withToken(token, token => engine.provideTextSearchResults(query, options, progress, token));
	}

	private async withToken<T>(token: CancellationToken, fn: (token: CancellationToken) => Promise<T>): Promise<T> {
		const merged = mergedTokenSource(token);
		this.inProgress.add(merged);
		const result = await fn(merged.token);
		this.inProgress.delete(merged);

		return result;
	}

	private dispose() {
		this.inProgress.forEach(engine => engine.cancel());
	}
}

function mergedTokenSource(token: CancellationToken): CancellationTokenSource {
	const tokenSource = new CancellationTokenSource();
	token.onCancellationRequested(() => tokenSource.cancel());

	return tokenSource;
}
