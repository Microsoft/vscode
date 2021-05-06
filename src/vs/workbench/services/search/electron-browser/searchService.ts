/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI as uri } from 'vs/base/common/uri';
import { getNextTickChannel } from 'vs/base/parts/ipc/common/ipc';
import { Client, IIPCOptions } from 'vs/base/parts/ipc/node/ipc.cp';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDebugParams } from 'vs/platform/environment/common/environment';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { parseSearchPort } from 'vs/platform/environment/common/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { FileMatch, IFileMatch, IFileQuery, IProgressMessage, IRawSearchService, ISearchComplete, ISearchConfiguration, ISearchProgressItem, ISearchResultProvider, ISerializedFileMatch, ISerializedSearchComplete, ISerializedSearchProgressItem, isSerializedSearchComplete, isSerializedSearchSuccess, ITextQuery, ISearchService, isFileMatch } from 'vs/workbench/services/search/common/search';
import { SearchChannelClient } from 'vs/workbench/services/search/node/searchIpc';
import { SearchService } from 'vs/workbench/services/search/common/searchService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { FileAccess } from 'vs/base/common/network';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class LocalSearchService extends SearchService {
	constructor(
		@IModelService modelService: IModelService,
		@IEditorService editorService: IEditorService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILogService logService: ILogService,
		@IExtensionService extensionService: IExtensionService,
		@IFileService fileService: IFileService,
		@INativeWorkbenchEnvironmentService readonly environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(modelService, editorService, telemetryService, logService, extensionService, fileService, uriIdentityService);

		this.diskSearch = instantiationService.createInstance(DiskSearch, !environmentService.isBuilt || environmentService.verbose, parseSearchPort(environmentService.args, environmentService.isBuilt));
	}
}

export class DiskSearch implements ISearchResultProvider {
	private raw: IRawSearchService;

	constructor(
		verboseLogging: boolean,
		searchDebug: IDebugParams | undefined,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		const timeout = this.configService.getValue<ISearchConfiguration>().search.maintainFileSearchCache ?
			100 * 60 * 60 * 1000 :
			60 * 60 * 1000;

		const opts: IIPCOptions = {
			serverName: 'Search',
			timeout,
			args: ['--type=searchService'],
			// Pass in fresh execArgv to the forked process such that it doesn't inherit them from `process.execArgv`.
			freshExecArgv: true,
			env: {
				VSCODE_AMD_ENTRYPOINT: 'vs/workbench/services/search/node/searchApp',
				VSCODE_PIPE_LOGGING: 'true',
				VSCODE_VERBOSE_LOGGING: verboseLogging
			},
			useQueue: true
		};

		if (searchDebug) {
			if (searchDebug.break && searchDebug.port) {
				opts.debugBrk = searchDebug.port;
			} else if (!searchDebug.break && searchDebug.port) {
				opts.debug = searchDebug.port;
			}
		}

		const client = new Client(FileAccess.asFileUri('bootstrap-fork', require).fsPath, opts);
		const channel = getNextTickChannel(client.getChannel('search'));
		this.raw = new SearchChannelClient(channel);
	}

	textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete> {
		if (token && token.isCancellationRequested) {
			throw canceled();
		}

		const event: Event<ISerializedSearchProgressItem | ISerializedSearchComplete> = this.raw.textSearch(query);

		return DiskSearch.collectResultsFromEvent(event, onProgress, token);
	}

	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
		if (token && token.isCancellationRequested) {
			throw canceled();
		}

		let event: Event<ISerializedSearchProgressItem | ISerializedSearchComplete>;
		event = this.raw.fileSearch(query);

		const onProgress = (p: ISearchProgressItem) => {
			if (!isFileMatch(p)) {
				// Should only be for logs
				this.logService.debug('SearchService#search', p.message);
			}
		};

		return DiskSearch.collectResultsFromEvent(event, onProgress, token);
	}

	/**
	 * Public for test
	 */
	static collectResultsFromEvent(event: Event<ISerializedSearchProgressItem | ISerializedSearchComplete>, onProgress?: (p: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete> {
		let result: IFileMatch[] = [];

		let listener: IDisposable;
		return new Promise<ISearchComplete>((c, e) => {
			if (token) {
				token.onCancellationRequested(() => {
					if (listener) {
						listener.dispose();
					}

					e(canceled());
				});
			}

			listener = event(ev => {
				if (isSerializedSearchComplete(ev)) {
					if (isSerializedSearchSuccess(ev)) {
						c({
							limitHit: ev.limitHit,
							results: result,
							stats: ev.stats,
							messages: ev.messages,
						});
					} else {
						e(ev.error);
					}

					listener.dispose();
				} else {
					// Matches
					if (Array.isArray(ev)) {
						const fileMatches = ev.map(d => this.createFileMatch(d));
						result = result.concat(fileMatches);
						if (onProgress) {
							fileMatches.forEach(onProgress);
						}
					}

					// Match
					else if ((<ISerializedFileMatch>ev).path) {
						const fileMatch = this.createFileMatch(<ISerializedFileMatch>ev);
						result.push(fileMatch);

						if (onProgress) {
							onProgress(fileMatch);
						}
					}

					// Progress
					else if (onProgress) {
						onProgress(<IProgressMessage>ev);
					}
				}
			});
		});
	}

	private static createFileMatch(data: ISerializedFileMatch): FileMatch {
		const fileMatch = new FileMatch(uri.file(data.path));
		if (data.results) {
			// const matches = data.results.filter(resultIsMatch);
			fileMatch.results.push(...data.results);
		}
		return fileMatch;
	}

	clearCache(cacheKey: string): Promise<void> {
		return this.raw.clearCache(cacheKey);
	}
}

registerSingleton(ISearchService, LocalSearchService, true);
