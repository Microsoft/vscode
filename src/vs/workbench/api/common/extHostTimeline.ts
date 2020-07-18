/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { UriComponents, URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ExtHostTimelineShape, MainThreadTimelineShape, IMainContext, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { Timeline, TimelineItem, TimelineOptions, TimelineProvider, InternalTimelineOptions } from 'vs/workbench/contrib/timeline/common/timeline';
import { IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';
import { CommandsConverter, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ThemeIcon } from 'vs/workbench/api/common/extHostTypes';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

export interface IExtHostTimeline extends ExtHostTimelineShape {
	readonly _serviceBrand: undefined;
	$getTimeline(id: string, uri: UriComponents, options: vscode.TimelineOptions, token: vscode.CancellationToken, internalOptions?: InternalTimelineOptions): Promise<Timeline | undefined>;
}

export const IExtHostTimeline = createDecorator<IExtHostTimeline>('IExtHostTimeline');

export class ExtHostTimeline implements IExtHostTimeline {
	declare readonly _serviceBrand: undefined;

	private _proxy: MainThreadTimelineShape;

	private _providers = new Map<string, TimelineProvider>();

	private _itemsBySourceAndUriMap = new Map<string, Map<string | undefined, Map<string, vscode.TimelineItem>>>();

	constructor(
		mainContext: IMainContext,
		commands: ExtHostCommands,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadTimeline);

		commands.registerArgumentProcessor({
			processArgument: arg => {
				if (arg && arg.$mid === 11) {
					const uri = arg.uri === undefined ? undefined : URI.revive(arg.uri);
					return this._itemsBySourceAndUriMap.get(arg.source)?.get(getUriKey(uri))?.get(arg.handle);
				}

				return arg;
			}
		});
	}

	async $getTimeline(id: string, uri: UriComponents, options: vscode.TimelineOptions, token: vscode.CancellationToken, internalOptions?: InternalTimelineOptions): Promise<Timeline | undefined> {
		const provider = this._providers.get(id);
		return provider?.provideTimeline(URI.revive(uri), options, token, internalOptions);
	}

	registerTimelineProvider(scheme: string | string[], provider: vscode.TimelineProvider, _extensionId: ExtensionIdentifier, commandConverter: CommandsConverter): IDisposable {
		const timelineDisposables = new DisposableStore();

		const convertTimelineItem = this.convertTimelineItem(provider.id, commandConverter, timelineDisposables).bind(this);

		let disposable: IDisposable | undefined;
		if (provider.onDidChange) {
			disposable = provider.onDidChange(e => this._proxy.$emitTimelineChangeEvent({ uri: undefined, reset: true, ...e, id: provider.id }), this);
		}

		const itemsBySourceAndUriMap = this._itemsBySourceAndUriMap;
		return this.registerTimelineProviderCore({
			...provider,
			scheme: scheme,
			onDidChange: undefined,
			async provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: InternalTimelineOptions) {
				if (internalOptions?.resetCache) {
					timelineDisposables.clear();

					// For now, only allow the caching of a single Uri
					// itemsBySourceAndUriMap.get(provider.id)?.get(getUriKey(uri))?.clear();
					itemsBySourceAndUriMap.get(provider.id)?.clear();
				}

				const result = await provider.provideTimeline(uri, options, token);
				if (result === undefined || result === null) {
					return undefined;
				}

				// TODO: Should we bother converting all the data if we aren't caching? Meaning it is being requested by an extension?

				const convertItem = convertTimelineItem(uri, internalOptions);
				return {
					...result,
					source: provider.id,
					items: result.items.map(convertItem)
				};
			},
			dispose() {
				for (const sourceMap of itemsBySourceAndUriMap.values()) {
					sourceMap.get(provider.id)?.clear();
				}

				disposable?.dispose();
				timelineDisposables.dispose();
			}
		});
	}

	private convertTimelineItem(source: string, commandConverter: CommandsConverter, disposables: DisposableStore) {
		return (uri: URI, options?: InternalTimelineOptions) => {
			let items: Map<string, vscode.TimelineItem> | undefined;
			if (options?.cacheResults) {
				let itemsByUri = this._itemsBySourceAndUriMap.get(source);
				if (itemsByUri === undefined) {
					itemsByUri = new Map();
					this._itemsBySourceAndUriMap.set(source, itemsByUri);
				}

				const uriKey = getUriKey(uri);
				items = itemsByUri.get(uriKey);
				if (items === undefined) {
					items = new Map();
					itemsByUri.set(uriKey, items);
				}
			}

			return (item: vscode.TimelineItem): TimelineItem => {
				const { iconPath, ...props } = item;

				const handle = `${source}|${item.id ?? item.timestamp}`;
				items?.set(handle, item);

				let icon;
				let iconDark;
				let themeIcon;
				if (item.iconPath) {
					if (iconPath instanceof ThemeIcon) {
						themeIcon = { id: iconPath.id };
					}
					else if (URI.isUri(iconPath)) {
						icon = iconPath;
						iconDark = iconPath;
					}
					else {
						({ light: icon, dark: iconDark } = iconPath as { light: URI; dark: URI });
					}
				}

				return {
					...props,
					id: props.id ?? undefined,
					handle: handle,
					source: source,
					command: item.command ? commandConverter.toInternal(item.command, disposables) : undefined,
					icon: icon,
					iconDark: iconDark,
					themeIcon: themeIcon,
					accessibilityInformation: item.accessibilityInformation
				};
			};
		};
	}

	private registerTimelineProviderCore(provider: TimelineProvider): IDisposable {
		// console.log(`ExtHostTimeline#registerTimelineProvider: id=${provider.id}`);

		const existing = this._providers.get(provider.id);
		if (existing) {
			throw new Error(`Timeline Provider ${provider.id} already exists.`);
		}

		this._proxy.$registerTimelineProvider({
			id: provider.id,
			label: provider.label,
			scheme: provider.scheme
		});
		this._providers.set(provider.id, provider);

		return toDisposable(() => {
			for (const sourceMap of this._itemsBySourceAndUriMap.values()) {
				sourceMap.get(provider.id)?.clear();
			}

			this._providers.delete(provider.id);
			this._proxy.$unregisterTimelineProvider(provider.id);
			provider.dispose();
		});
	}
}

function getUriKey(uri: URI | undefined): string | undefined {
	return uri?.toString();
}
