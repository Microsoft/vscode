/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
// import { basename } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { ITimelineService, TimelineChangeEvent, TimelineOptions, TimelineProvidersChangeEvent, TimelineProvider, InternalTimelineOptions, TimelinePaneId } from './timeline';
import { IViewsService } from 'vs/workbench/common/views';

export class TimelineService implements ITimelineService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProviders = new Emitter<TimelineProvidersChangeEvent>();
	readonly onDidChangeProviders: Event<TimelineProvidersChangeEvent> = this._onDidChangeProviders.event;

	private readonly _onDidChangeTimeline = new Emitter<TimelineChangeEvent>();
	readonly onDidChangeTimeline: Event<TimelineChangeEvent> = this._onDidChangeTimeline.event;
	private readonly _onDidChangeUri = new Emitter<URI>();
	readonly onDidChangeUri: Event<URI> = this._onDidChangeUri.event;

	private readonly providers = new Map<string, TimelineProvider>();
	private readonly providerSubscriptions = new Map<string, IDisposable>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IViewsService protected viewsService: IViewsService,
	) {
		// let source = 'fast-source';
		// this.registerTimelineProvider({
		// 	scheme: '*',
		// 	id: source,
		// 	label: 'Fast Source',
		// 	provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: { cacheResults?: boolean | undefined; }) {
		// 		if (options.cursor === undefined) {
		// 			return Promise.resolve<Timeline>({
		// 				source: source,
		// 				items: [
		// 					{
		// 						handle: `${source}|1`,
		// 						id: '1',
		// 						label: 'Fast Timeline1',
		// 						description: '',
		// 						timestamp: Date.now(),
		// 						source: source
		// 					},
		// 					{
		// 						handle: `${source}|2`,
		// 						id: '2',
		// 						label: 'Fast Timeline2',
		// 						description: '',
		// 						timestamp: Date.now() - 3000000000,
		// 						source: source
		// 					}
		// 				],
		// 				paging: {
		// 					cursor: 'next'
		// 				}
		// 			});
		// 		}
		// 		return Promise.resolve<Timeline>({
		// 			source: source,
		// 			items: [
		// 				{
		// 					handle: `${source}|3`,
		// 					id: '3',
		// 					label: 'Fast Timeline3',
		// 					description: '',
		// 					timestamp: Date.now() - 4000000000,
		// 					source: source
		// 				},
		// 				{
		// 					handle: `${source}|4`,
		// 					id: '4',
		// 					label: 'Fast Timeline4',
		// 					description: '',
		// 					timestamp: Date.now() - 300000000000,
		// 					source: source
		// 				}
		// 			],
		// 			paging: {
		// 				cursor: undefined
		// 			}
		// 		});
		// 	},
		// 	dispose() { }
		// });

		// let source = 'slow-source';
		// this.registerTimelineProvider({
		// 	scheme: '*',
		// 	id: source,
		// 	label: 'Slow Source',
		// 	provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: { cacheResults?: boolean | undefined; }) {
		// 		return new Promise<Timeline>(resolve => setTimeout(() => {
		// 			resolve({
		// 				source: source,
		// 				items: [
		// 					{
		// 						handle: `${source}|1`,
		// 						id: '1',
		// 						label: 'Slow Timeline1',
		// 						description: basename(uri.fsPath),
		// 						timestamp: Date.now(),
		// 						source: source
		// 					},
		// 					{
		// 						handle: `${source}|2`,
		// 						id: '2',
		// 						label: 'Slow Timeline2',
		// 						description: basename(uri.fsPath),
		// 						timestamp: new Date(0).getTime(),
		// 						source: source
		// 					}
		// 				]
		// 			});
		// 		}, 5000));
		// 	},
		// 	dispose() { }
		// });

		// source = 'very-slow-source';
		// this.registerTimelineProvider({
		// 	scheme: '*',
		// 	id: source,
		// 	label: 'Very Slow Source',
		// 	provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: { cacheResults?: boolean | undefined; }) {
		// 		return new Promise<Timeline>(resolve => setTimeout(() => {
		// 			resolve({
		// 				source: source,
		// 				items: [
		// 					{
		// 						handle: `${source}|1`,
		// 						id: '1',
		// 						label: 'VERY Slow Timeline1',
		// 						description: basename(uri.fsPath),
		// 						timestamp: Date.now(),
		// 						source: source
		// 					},
		// 					{
		// 						handle: `${source}|2`,
		// 						id: '2',
		// 						label: 'VERY Slow Timeline2',
		// 						description: basename(uri.fsPath),
		// 						timestamp: new Date(0).getTime(),
		// 						source: source
		// 					}
		// 				]
		// 			});
		// 		}, 10000));
		// 	},
		// 	dispose() { }
		// });
	}

	getSources() {
		return [...this.providers.values()].map(p => ({ id: p.id, label: p.label }));
	}

	getTimeline(id: string, uri: URI, options: TimelineOptions, tokenSource: CancellationTokenSource, internalOptions?: InternalTimelineOptions) {
		this.logService.trace(`TimelineService#getTimeline(${id}): uri=${uri.toString(true)}`);

		const provider = this.providers.get(id);
		if (provider === undefined) {
			return undefined;
		}

		if (typeof provider.scheme === 'string') {
			if (provider.scheme !== '*' && provider.scheme !== uri.scheme) {
				return undefined;
			}
		} else if (!provider.scheme.includes(uri.scheme)) {
			return undefined;
		}

		return {
			result: provider.provideTimeline(uri, options, tokenSource.token, internalOptions)
				.then(result => {
					if (result === undefined) {
						return undefined;
					}

					result.items = result.items.map(item => ({ ...item, source: provider.id }));
					result.items.sort((a, b) => (b.timestamp - a.timestamp) || b.source.localeCompare(a.source, undefined, { numeric: true, sensitivity: 'base' }));

					return result;
				}),
			options: options,
			source: provider.id,
			tokenSource: tokenSource,
			uri: uri
		};
	}

	registerTimelineProvider(provider: TimelineProvider): IDisposable {
		this.logService.trace(`TimelineService#registerTimelineProvider: id=${provider.id}`);

		const id = provider.id;

		const existing = this.providers.get(id);
		if (existing) {
			// For now to deal with https://github.com/microsoft/vscode/issues/89553 allow any overwritting here (still will be blocked in the Extension Host)
			// TODO@eamodio: Ultimately will need to figure out a way to unregister providers when the Extension Host restarts/crashes
			// throw new Error(`Timeline Provider ${id} already exists.`);
			try {
				existing?.dispose();
			}
			catch { }
		}

		this.providers.set(id, provider);
		if (provider.onDidChange) {
			this.providerSubscriptions.set(id, provider.onDidChange(e => this._onDidChangeTimeline.fire(e)));
		}
		this._onDidChangeProviders.fire({ added: [id] });

		return {
			dispose: () => {
				this.providers.delete(id);
				this._onDidChangeProviders.fire({ removed: [id] });
			}
		};
	}

	unregisterTimelineProvider(id: string): void {
		this.logService.trace(`TimelineService#unregisterTimelineProvider: id=${id}`);

		if (!this.providers.has(id)) {
			return;
		}

		this.providers.delete(id);
		this.providerSubscriptions.delete(id);
		this._onDidChangeProviders.fire({ removed: [id] });
	}

	setUri(uri: URI) {
		this.viewsService.openView(TimelinePaneId, true);
		this._onDidChangeUri.fire(uri);
	}
}
