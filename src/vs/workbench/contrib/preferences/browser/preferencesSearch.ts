/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettingsEditorModel, ISetting, ISettingsGroup, IFilterMetadata, ISearchResult, IGroupFilter, ISettingMatcher, IScoredResults, ISettingMatch, IRemoteSetting, IExtensionSetting } from 'vs/workbench/services/preferences/common/preferences';
import { IRange } from 'vs/editor/common/core/range';
import { distinct, top } from 'vs/base/common/arrays';
import * as strings from 'vs/base/common/strings';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { IMatch, or, matchesContiguousSubString, matchesPrefix, matchesCamelCase, matchesWords } from 'vs/base/common/filters';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPreferencesSearchService, ISearchProvider, IWorkbenchSettingsConfiguration } from 'vs/workbench/contrib/preferences/common/preferences';
import { IRequestService, asJson } from 'vs/platform/request/common/request';
import { IExtensionManagementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { nullRange } from 'vs/workbench/services/preferences/common/preferencesModels';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStringDictionary } from 'vs/base/common/collections';
import { IProductService } from 'vs/platform/product/common/productService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export interface IEndpointDetails {
	urlBase?: string;
	key?: string;
}

export class PreferencesSearchService extends Disposable implements IPreferencesSearchService {
	declare readonly _serviceBrand: undefined;

	private _installedExtensions: Promise<ILocalExtension[]>;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService
	) {
		super();

		// This request goes to the shared process but results won't change during a window's lifetime, so cache the results.
		this._installedExtensions = this.extensionManagementService.getInstalled(ExtensionType.User).then(exts => {
			// Filter to enabled extensions that have settings
			return exts
				.filter(ext => this.extensionEnablementService.isEnabled(ext))
				.filter(ext => ext.manifest && ext.manifest.contributes && ext.manifest.contributes.configuration)
				.filter(ext => !!ext.identifier.uuid);
		});
	}

	private get remoteSearchAllowed(): boolean {
		const workbenchSettings = this.configurationService.getValue<IWorkbenchSettingsConfiguration>().workbench.settings;
		if (!workbenchSettings.enableNaturalLanguageSearch) {
			return false;
		}

		return !!this._endpoint.urlBase;
	}

	private get _endpoint(): IEndpointDetails {
		const workbenchSettings = this.configurationService.getValue<IWorkbenchSettingsConfiguration>().workbench.settings;
		if (workbenchSettings.naturalLanguageSearchEndpoint) {
			return {
				urlBase: workbenchSettings.naturalLanguageSearchEndpoint,
				key: workbenchSettings.naturalLanguageSearchKey
			};
		} else {
			return {
				urlBase: this.productService.settingsSearchUrl
			};
		}
	}

	getRemoteSearchProvider(filter: string, newExtensionsOnly = false): ISearchProvider | undefined {
		const opts: IRemoteSearchProviderOptions = {
			filter,
			newExtensionsOnly,
			endpoint: this._endpoint
		};

		return this.remoteSearchAllowed ? this.instantiationService.createInstance(RemoteSearchProvider, opts, this._installedExtensions) : undefined;
	}

	getLocalSearchProvider(filter: string): LocalSearchProvider {
		return this.instantiationService.createInstance(LocalSearchProvider, filter);
	}
}

export class LocalSearchProvider implements ISearchProvider {
	static readonly EXACT_MATCH_SCORE = 10000;
	static readonly START_SCORE = 1000;

	constructor(private _filter: string) {
		// Remove " and : which are likely to be copypasted as part of a setting name.
		// Leave other special characters which the user might want to search for.
		this._filter = this._filter
			.replace(/[":]/g, ' ')
			.replace(/  /g, ' ')
			.trim();
	}

	searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken): Promise<ISearchResult | null> {
		if (!this._filter) {
			return Promise.resolve(null);
		}

		let orderedScore = LocalSearchProvider.START_SCORE; // Sort is not stable
		const settingMatcher = (setting: ISetting) => {
			const matches = new SettingMatches(this._filter, setting, true, true, (filter, setting) => preferencesModel.findValueMatches(filter, setting)).matches;
			const score = this._filter === setting.key ?
				LocalSearchProvider.EXACT_MATCH_SCORE :
				orderedScore--;

			return matches && matches.length ?
				{
					matches,
					score
				} :
				null;
		};

		const filterMatches = preferencesModel.filterSettings(this._filter, this.getGroupFilter(this._filter), settingMatcher);
		if (filterMatches[0] && filterMatches[0].score === LocalSearchProvider.EXACT_MATCH_SCORE) {
			return Promise.resolve({
				filterMatches: filterMatches.slice(0, 1),
				exactMatch: true
			});
		} else {
			return Promise.resolve({
				filterMatches
			});
		}
	}

	private getGroupFilter(filter: string): IGroupFilter {
		const regex = strings.createRegExp(filter, false, { global: true });
		return (group: ISettingsGroup) => {
			return regex.test(group.title);
		};
	}
}

interface IRemoteSearchProviderOptions {
	filter: string;
	endpoint: IEndpointDetails;
	newExtensionsOnly: boolean;
}

interface IBingRequestDetails {
	url: string;
	body?: string;
	hasMoreFilters?: boolean;
	extensions?: ILocalExtension[];
}

class RemoteSearchProvider implements ISearchProvider {
	// Must keep extension filter size under 8kb. 42 filters puts us there.
	private static readonly MAX_REQUEST_FILTERS = 42;
	private static readonly MAX_REQUESTS = 10;
	private static readonly NEW_EXTENSIONS_MIN_SCORE = 1;

	private _remoteSearchP: Promise<IFilterMetadata | null>;

	constructor(private options: IRemoteSearchProviderOptions, private installedExtensions: Promise<ILocalExtension[]>,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService
	) {
		this._remoteSearchP = this.options.filter ?
			Promise.resolve(this.getSettingsForFilter(this.options.filter)) :
			Promise.resolve(null);
	}

	searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken): Promise<ISearchResult | null> {
		return this._remoteSearchP.then<ISearchResult | null>((remoteResult) => {
			if (!remoteResult) {
				return null;
			}

			if (token && token.isCancellationRequested) {
				throw canceled();
			}

			const resultKeys = Object.keys(remoteResult.scoredResults);
			const highScoreKey = top(resultKeys, (a, b) => remoteResult.scoredResults[b].score - remoteResult.scoredResults[a].score, 1)[0];
			const highScore = highScoreKey ? remoteResult.scoredResults[highScoreKey].score : 0;
			const minScore = highScore / 5;
			if (this.options.newExtensionsOnly) {
				return this.installedExtensions.then(installedExtensions => {
					const newExtsMinScore = Math.max(RemoteSearchProvider.NEW_EXTENSIONS_MIN_SCORE, minScore);
					const passingScoreKeys = resultKeys
						.filter(k => {
							const result = remoteResult.scoredResults[k];
							const resultExtId = (result.extensionPublisher + '.' + result.extensionName).toLowerCase();
							return !installedExtensions.some(ext => ext.identifier.id.toLowerCase() === resultExtId);
						})
						.filter(k => remoteResult.scoredResults[k].score >= newExtsMinScore);

					const filterMatches: ISettingMatch[] = passingScoreKeys.map(k => {
						const remoteSetting = remoteResult.scoredResults[k];
						const setting = remoteSettingToISetting(remoteSetting);
						return <ISettingMatch>{
							setting,
							score: remoteSetting.score,
							matches: [] // TODO
						};
					});

					return <ISearchResult>{
						filterMatches,
						metadata: remoteResult
					};
				});
			} else {
				const settingMatcher = this.getRemoteSettingMatcher(remoteResult.scoredResults, minScore, preferencesModel);
				const filterMatches = preferencesModel.filterSettings(this.options.filter, group => null, settingMatcher);
				return <ISearchResult>{
					filterMatches,
					metadata: remoteResult
				};
			}
		});
	}

	private async getSettingsForFilter(filter: string): Promise<IFilterMetadata> {
		const allRequestDetails: IBingRequestDetails[] = [];

		// Only send MAX_REQUESTS requests in total just to keep it sane
		for (let i = 0; i < RemoteSearchProvider.MAX_REQUESTS; i++) {
			const details = await this.prepareRequest(filter, i);
			allRequestDetails.push(details);
			if (!details.hasMoreFilters) {
				break;
			}
		}

		return Promise.all(allRequestDetails.map(details => this.getSettingsFromBing(details))).then(allResponses => {
			// Merge all IFilterMetadata
			const metadata = allResponses[0];
			metadata.requestCount = 1;

			for (const response of allResponses.slice(1)) {
				metadata.requestCount++;
				metadata.scoredResults = { ...metadata.scoredResults, ...response.scoredResults };
			}

			return metadata;
		});
	}

	private getSettingsFromBing(details: IBingRequestDetails): Promise<IFilterMetadata> {
		this.logService.debug(`Searching settings via ${details.url}`);
		if (details.body) {
			this.logService.debug(`Body: ${details.body}`);
		}

		const requestType = details.body ? 'post' : 'get';
		const headers: IStringDictionary<string> = {
			'User-Agent': 'request',
			'Content-Type': 'application/json; charset=utf-8',
		};

		if (this.options.endpoint.key) {
			headers['api-key'] = this.options.endpoint.key;
		}

		const start = Date.now();
		return this.requestService.request({
			type: requestType,
			url: details.url,
			data: details.body,
			headers,
			timeout: 5000
		}, CancellationToken.None).then(context => {
			if (typeof context.res.statusCode === 'number' && context.res.statusCode >= 300) {
				throw new Error(`${JSON.stringify(details)} returned status code: ${context.res.statusCode}`);
			}

			return asJson(context);
		}).then((result: any) => {
			const timestamp = Date.now();
			const duration = timestamp - start;
			const remoteSettings: IRemoteSetting[] = (result.value || [])
				.map((r: any) => {
					const key = JSON.parse(r.setting || r.Setting);
					const packageId = r['packageid'];
					const id = getSettingKey(key, packageId);

					const value = r['value'];
					const defaultValue = value ? JSON.parse(value) : value;

					const packageName = r['packagename'];
					let extensionName: string | undefined;
					let extensionPublisher: string | undefined;
					if (packageName && packageName.indexOf('##') >= 0) {
						[extensionPublisher, extensionName] = packageName.split('##');
					}

					return <IRemoteSetting>{
						key,
						id,
						defaultValue,
						score: r['@search.score'],
						description: JSON.parse(r['details']),
						packageId,
						extensionName,
						extensionPublisher
					};
				});

			const scoredResults = Object.create(null);
			remoteSettings.forEach(s => {
				scoredResults[s.id] = s;
			});

			return <IFilterMetadata>{
				requestUrl: details.url,
				requestBody: details.body,
				duration,
				timestamp,
				scoredResults,
				context: result['@odata.context']
			};
		});
	}

	private getRemoteSettingMatcher(scoredResults: IScoredResults, minScore: number, preferencesModel: ISettingsEditorModel): ISettingMatcher {
		return (setting: ISetting, group: ISettingsGroup) => {
			const remoteSetting = scoredResults[getSettingKey(setting.key, group.id)] || // extension setting
				scoredResults[getSettingKey(setting.key, 'core')] || // core setting
				scoredResults[getSettingKey(setting.key)]; // core setting from original prod endpoint
			if (remoteSetting && remoteSetting.score >= minScore) {
				const settingMatches = new SettingMatches(this.options.filter, setting, false, true, (filter, setting) => preferencesModel.findValueMatches(filter, setting)).matches;
				return { matches: settingMatches, score: remoteSetting.score };
			}

			return null;
		};
	}

	private async prepareRequest(query: string, filterPage = 0): Promise<IBingRequestDetails> {
		const verbatimQuery = query;
		query = escapeSpecialChars(query);
		const boost = 10;
		const boostedQuery = `(${query})^${boost}`;

		// Appending Fuzzy after each word.
		query = query.replace(/\ +/g, '~ ') + '~';

		const encodedQuery = encodeURIComponent(boostedQuery + ' || ' + query);
		let url = `${this.options.endpoint.urlBase}`;

		if (this.options.endpoint.key) {
			url += `${API_VERSION}&${QUERY_TYPE}`;
		}

		const extensions = await this.installedExtensions;
		const filters = this.options.newExtensionsOnly ?
			[`diminish eq 'latest'`] :
			this.getVersionFilters(extensions, this.productService.settingsSearchBuildId);

		const filterStr = filters
			.slice(filterPage * RemoteSearchProvider.MAX_REQUEST_FILTERS, (filterPage + 1) * RemoteSearchProvider.MAX_REQUEST_FILTERS)
			.join(' or ');
		const hasMoreFilters = filters.length > (filterPage + 1) * RemoteSearchProvider.MAX_REQUEST_FILTERS;

		const body = JSON.stringify({
			query: encodedQuery,
			filters: encodeURIComponent(filterStr),
			rawQuery: encodeURIComponent(verbatimQuery)
		});

		return {
			url,
			body,
			hasMoreFilters
		};
	}

	private getVersionFilters(exts: ILocalExtension[], buildNumber?: number): string[] {
		// Only search extensions that contribute settings
		const filters = exts
			.filter(ext => ext.manifest.contributes && ext.manifest.contributes.configuration)
			.map(ext => this.getExtensionFilter(ext));

		if (buildNumber) {
			filters.push(`(packageid eq 'core' and startbuildno le '${buildNumber}' and endbuildno ge '${buildNumber}')`);
		}

		return filters;
	}

	private getExtensionFilter(ext: ILocalExtension): string {
		const uuid = ext.identifier.uuid;
		const versionString = ext.manifest.version
			.split('.')
			.map(versionPart => strings.pad(<any>versionPart, 10))
			.join('');

		return `(packageid eq '${uuid}' and startbuildno le '${versionString}' and endbuildno ge '${versionString}')`;
	}
}

function getSettingKey(name: string, packageId?: string): string {
	return packageId ?
		packageId + '##' + name :
		name;
}

const API_VERSION = 'api-version=2016-09-01-Preview';
const QUERY_TYPE = 'querytype=full';

function escapeSpecialChars(query: string): string {
	return query.replace(/\./g, ' ')
		.replace(/[\\/+\-&|!"~*?:(){}\[\]\^]/g, '\\$&')
		.replace(/  /g, ' ') // collapse spaces
		.trim();
}

function remoteSettingToISetting(remoteSetting: IRemoteSetting): IExtensionSetting {
	return {
		description: remoteSetting.description.split('\n'),
		descriptionIsMarkdown: false,
		descriptionRanges: [],
		key: remoteSetting.key,
		keyRange: nullRange,
		value: remoteSetting.defaultValue,
		range: nullRange,
		valueRange: nullRange,
		overrides: [],
		extensionName: remoteSetting.extensionName,
		extensionPublisher: remoteSetting.extensionPublisher
	};
}

export class SettingMatches {

	private readonly descriptionMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();
	private readonly keyMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();
	private readonly valueMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();

	readonly matches: IRange[];

	constructor(searchString: string, setting: ISetting, private requireFullQueryMatch: boolean, private searchDescription: boolean, private valuesMatcher: (filter: string, setting: ISetting) => IRange[]) {
		this.matches = distinct(this._findMatchesInSetting(searchString, setting), (match) => `${match.startLineNumber}_${match.startColumn}_${match.endLineNumber}_${match.endColumn}_`);
	}

	private _findMatchesInSetting(searchString: string, setting: ISetting): IRange[] {
		const result = this._doFindMatchesInSetting(searchString, setting);
		if (setting.overrides && setting.overrides.length) {
			for (const subSetting of setting.overrides) {
				const subSettingMatches = new SettingMatches(searchString, subSetting, this.requireFullQueryMatch, this.searchDescription, this.valuesMatcher);
				const words = searchString.split(' ');
				const descriptionRanges: IRange[] = this.getRangesForWords(words, this.descriptionMatchingWords, [subSettingMatches.descriptionMatchingWords, subSettingMatches.keyMatchingWords, subSettingMatches.valueMatchingWords]);
				const keyRanges: IRange[] = this.getRangesForWords(words, this.keyMatchingWords, [subSettingMatches.descriptionMatchingWords, subSettingMatches.keyMatchingWords, subSettingMatches.valueMatchingWords]);
				const subSettingKeyRanges: IRange[] = this.getRangesForWords(words, subSettingMatches.keyMatchingWords, [this.descriptionMatchingWords, this.keyMatchingWords, subSettingMatches.valueMatchingWords]);
				const subSettingValueRanges: IRange[] = this.getRangesForWords(words, subSettingMatches.valueMatchingWords, [this.descriptionMatchingWords, this.keyMatchingWords, subSettingMatches.keyMatchingWords]);
				result.push(...descriptionRanges, ...keyRanges, ...subSettingKeyRanges, ...subSettingValueRanges);
				result.push(...subSettingMatches.matches);
			}
		}
		return result;
	}

	private _doFindMatchesInSetting(searchString: string, setting: ISetting): IRange[] {
		const registry: { [qualifiedKey: string]: IJSONSchema } = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();
		const schema: IJSONSchema = registry[setting.key];

		const words = searchString.split(' ');
		const settingKeyAsWords: string = setting.key.split('.').join(' ');

		for (const word of words) {
			if (this.searchDescription) {
				for (let lineIndex = 0; lineIndex < setting.description.length; lineIndex++) {
					const descriptionMatches = matchesWords(word, setting.description[lineIndex], true);
					if (descriptionMatches) {
						this.descriptionMatchingWords.set(word, descriptionMatches.map(match => this.toDescriptionRange(setting, match, lineIndex)));
					}
				}
			}

			const keyMatches = or(matchesWords, matchesCamelCase)(word, settingKeyAsWords);
			if (keyMatches) {
				this.keyMatchingWords.set(word, keyMatches.map(match => this.toKeyRange(setting, match)));
			}

			const valueMatches = typeof setting.value === 'string' ? matchesContiguousSubString(word, setting.value) : null;
			if (valueMatches) {
				this.valueMatchingWords.set(word, valueMatches.map(match => this.toValueRange(setting, match)));
			} else if (schema && schema.enum && schema.enum.some(enumValue => typeof enumValue === 'string' && !!matchesContiguousSubString(word, enumValue))) {
				this.valueMatchingWords.set(word, []);
			}
		}

		const descriptionRanges: IRange[] = [];
		if (this.searchDescription) {
			for (let lineIndex = 0; lineIndex < setting.description.length; lineIndex++) {
				const matches = or(matchesContiguousSubString)(searchString, setting.description[lineIndex] || '') || [];
				descriptionRanges.push(...matches.map(match => this.toDescriptionRange(setting, match, lineIndex)));
			}
			if (descriptionRanges.length === 0) {
				descriptionRanges.push(...this.getRangesForWords(words, this.descriptionMatchingWords, [this.keyMatchingWords, this.valueMatchingWords]));
			}
		}

		const keyMatches = or(matchesPrefix, matchesContiguousSubString)(searchString, setting.key);
		const keyRanges: IRange[] = keyMatches ? keyMatches.map(match => this.toKeyRange(setting, match)) : this.getRangesForWords(words, this.keyMatchingWords, [this.descriptionMatchingWords, this.valueMatchingWords]);

		let valueRanges: IRange[] = [];
		if (setting.value && typeof setting.value === 'string') {
			const valueMatches = or(matchesPrefix, matchesContiguousSubString)(searchString, setting.value);
			valueRanges = valueMatches ? valueMatches.map(match => this.toValueRange(setting, match)) : this.getRangesForWords(words, this.valueMatchingWords, [this.keyMatchingWords, this.descriptionMatchingWords]);
		} else {
			valueRanges = this.valuesMatcher(searchString, setting);
		}

		return [...descriptionRanges, ...keyRanges, ...valueRanges];
	}

	private getRangesForWords(words: string[], from: Map<string, IRange[]>, others: Map<string, IRange[]>[]): IRange[] {
		const result: IRange[] = [];
		for (const word of words) {
			const ranges = from.get(word);
			if (ranges) {
				result.push(...ranges);
			} else if (this.requireFullQueryMatch && others.every(o => !o.has(word))) {
				return [];
			}
		}
		return result;
	}

	private toKeyRange(setting: ISetting, match: IMatch): IRange {
		return {
			startLineNumber: setting.keyRange.startLineNumber,
			startColumn: setting.keyRange.startColumn + match.start,
			endLineNumber: setting.keyRange.startLineNumber,
			endColumn: setting.keyRange.startColumn + match.end
		};
	}

	private toDescriptionRange(setting: ISetting, match: IMatch, lineIndex: number): IRange {
		return {
			startLineNumber: setting.descriptionRanges[lineIndex].startLineNumber,
			startColumn: setting.descriptionRanges[lineIndex].startColumn + match.start,
			endLineNumber: setting.descriptionRanges[lineIndex].endLineNumber,
			endColumn: setting.descriptionRanges[lineIndex].startColumn + match.end
		};
	}

	private toValueRange(setting: ISetting, match: IMatch): IRange {
		return {
			startLineNumber: setting.valueRange.startLineNumber,
			startColumn: setting.valueRange.startColumn + match.start + 1,
			endLineNumber: setting.valueRange.startLineNumber,
			endColumn: setting.valueRange.startColumn + match.end + 1
		};
	}
}

registerSingleton(IPreferencesSearchService, PreferencesSearchService, true);
