/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mergeSort } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { illegalArgument, onUnexpectedExternalError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { registerLanguageCommand } from 'vs/editor/browser/editorExtensions';
import { ITextModel } from 'vs/editor/common/model';
import { CodeLensProvider, CodeLensProviderRegistry, CodeLens, CodeLensList } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { DisposableStore } from 'vs/base/common/lifecycle';

export interface CodeLensItem {
	symbol: CodeLens;
	provider: CodeLensProvider;
}

export class CodeLensModel {

	lenses: CodeLensItem[] = [];

	private readonly _disposables = new DisposableStore();

	dispose(): void {
		this._disposables.dispose();
	}

	add(list: CodeLensList, provider: CodeLensProvider): void {
		this._disposables.add(list);
		for (const symbol of list.lenses) {
			this.lenses.push({ symbol, provider });
		}
	}
}

export function getCodeLensData(model: ITextModel, token: CancellationToken): Promise<CodeLensModel> {

	const provider = CodeLensProviderRegistry.ordered(model);
	const providerRanks = new Map<CodeLensProvider, number>();
	const result = new CodeLensModel();

	const promises = provider.map((provider, i) => {

		providerRanks.set(provider, i);

		return Promise.resolve(provider.provideCodeLenses(model, token))
			.then(list => list && result.add(list, provider))
			.catch(onUnexpectedExternalError);
	});

	return Promise.all(promises).then(() => {

		result.lenses = mergeSort(result.lenses, (a, b) => {
			// sort by lineNumber, provider-rank, and column
			if (a.symbol.range.startLineNumber < b.symbol.range.startLineNumber) {
				return -1;
			} else if (a.symbol.range.startLineNumber > b.symbol.range.startLineNumber) {
				return 1;
			} else if (providerRanks.get(a.provider)! < providerRanks.get(b.provider)!) {
				return -1;
			} else if (providerRanks.get(a.provider)! > providerRanks.get(b.provider)!) {
				return 1;
			} else if (a.symbol.range.startColumn < b.symbol.range.startColumn) {
				return -1;
			} else if (a.symbol.range.startColumn > b.symbol.range.startColumn) {
				return 1;
			} else {
				return 0;
			}
		});

		return result;
	});
}

registerLanguageCommand('_executeCodeLensProvider', function (accessor, args) {

	let { resource, itemResolveCount } = args;
	if (!(resource instanceof URI)) {
		throw illegalArgument();
	}

	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument();
	}

	const result: CodeLens[] = [];
	const disposables = new DisposableStore();
	return getCodeLensData(model, CancellationToken.None).then(value => {

		disposables.add(value);
		let resolve: Promise<any>[] = [];

		for (const item of value.lenses) {
			if (typeof itemResolveCount === 'undefined' || Boolean(item.symbol.command)) {
				result.push(item.symbol);
			} else if (itemResolveCount-- > 0 && item.provider.resolveCodeLens) {
				resolve.push(Promise.resolve(item.provider.resolveCodeLens(model, item.symbol, CancellationToken.None)).then(symbol => result.push(symbol || item.symbol)));
			}
		}

		return Promise.all(resolve);

	}).then(() => {
		return result;
	}).finally(() => {
		// make sure to return results, then (on next tick)
		// dispose the results
		setTimeout(() => disposables.dispose(), 100);
	});
});
