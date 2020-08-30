/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { IRange, Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { ILink, LinkProvider, LinkProviderRegistry, ILinksList } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { isDisposable, Disposable } from 'vs/base/common/lifecycle';
import { coalesce } from 'vs/base/common/arrays';

export class Link implements ILink {

	private _link: ILink;
	private readonly _provider: LinkProvider;

	constructor(link: ILink, provider: LinkProvider) {
		this._link = link;
		this._provider = provider;
	}

	toJSON(): ILink {
		return {
			range: this.range,
			url: this.url,
			tooltip: this.tooltip
		};
	}

	get range(): IRange {
		return this._link.range;
	}

	get url(): URI | string | undefined {
		return this._link.url;
	}

	get tooltip(): string | undefined {
		return this._link.tooltip;
	}

	async resolve(token: CancellationToken): Promise<URI | string> {
		if (this._link.url) {
			return this._link.url;
		}

		if (typeof this._provider.resolveLink === 'function') {
			return Promise.resolve(this._provider.resolveLink(this._link, token)).then(value => {
				this._link = value || this._link;
				if (this._link.url) {
					// recurse
					return this.resolve(token);
				}

				return Promise.reject(new Error('missing'));
			});
		}

		return Promise.reject(new Error('missing'));
	}
}

export class LinksList extends Disposable {

	readonly links: Link[];

	constructor(tuples: [ILinksList, LinkProvider][]) {
		super();
		let links: Link[] = [];
		for (const [list, provider] of tuples) {
			// merge all links
			const newLinks = list.links.map(link => new Link(link, provider));
			links = LinksList._union(links, newLinks);
			// register disposables
			if (isDisposable(list)) {
				this._register(list);
			}
		}
		this.links = links;
	}

	private static _union(oldLinks: Link[], newLinks: Link[]): Link[] {
		// reunite oldLinks with newLinks and remove duplicates
		let result: Link[] = [];
		let oldIndex: number;
		let oldLen: number;
		let newIndex: number;
		let newLen: number;

		for (oldIndex = 0, newIndex = 0, oldLen = oldLinks.length, newLen = newLinks.length; oldIndex < oldLen && newIndex < newLen;) {
			const oldLink = oldLinks[oldIndex];
			const newLink = newLinks[newIndex];

			if (Range.areIntersectingOrTouching(oldLink.range, newLink.range)) {
				// Remove the oldLink
				oldIndex++;
				continue;
			}

			const comparisonResult = Range.compareRangesUsingStarts(oldLink.range, newLink.range);

			if (comparisonResult < 0) {
				// oldLink is before
				result.push(oldLink);
				oldIndex++;
			} else {
				// newLink is before
				result.push(newLink);
				newIndex++;
			}
		}

		for (; oldIndex < oldLen; oldIndex++) {
			result.push(oldLinks[oldIndex]);
		}
		for (; newIndex < newLen; newIndex++) {
			result.push(newLinks[newIndex]);
		}

		return result;
	}

}

export function getLinks(model: ITextModel, token: CancellationToken): Promise<LinksList> {

	const lists: [ILinksList, LinkProvider][] = [];

	// ask all providers for links in parallel
	const promises = LinkProviderRegistry.ordered(model).reverse().map((provider, i) => {
		return Promise.resolve(provider.provideLinks(model, token)).then(result => {
			if (result) {
				lists[i] = [result, provider];
			}
		}, onUnexpectedExternalError);
	});

	return Promise.all(promises).then(() => {
		const result = new LinksList(coalesce(lists));
		if (!token.isCancellationRequested) {
			return result;
		}
		result.dispose();
		return new LinksList([]);
	});
}


CommandsRegistry.registerCommand('_executeLinkProvider', async (accessor, ...args): Promise<ILink[]> => {
	const [uri] = args;
	if (!(uri instanceof URI)) {
		return [];
	}
	const model = accessor.get(IModelService).getModel(uri);
	if (!model) {
		return [];
	}
	const list = await getLinks(model, CancellationToken.None);
	if (!list) {
		return [];
	}
	const result = list.links.slice(0);
	list.dispose();
	return result;
});
