/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getErrorMessage, isPromiseCanceledError, canceled } from 'vs/base/common/errors';
import { StatisticType, IGalleryExtension, IExtensionGalleryService, IGalleryExtensionAsset, IQueryOptions, SortBy, SortOrder, IExtensionIdentifier, IReportedExtension, InstallOperation, ITranslation, IGalleryExtensionVersion, IGalleryExtensionAssets, isIExtensionIdentifier, DefaultIconPath } from 'vs/platform/extensionManagement/common/extensionManagement';
import { getGalleryExtensionId, getGalleryExtensionTelemetryData, adoptToGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { getOrDefault } from 'vs/base/common/objects';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IPager } from 'vs/base/common/paging';
import { IRequestService, asJson, asText } from 'vs/platform/request/common/request';
import { IRequestOptions, IRequestContext, IHeaders } from 'vs/base/parts/request/common/request';
import { isEngineValid } from 'vs/platform/extensions/common/extensionValidator';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { optional } from 'vs/platform/instantiation/common/instantiation';
import { joinPath } from 'vs/base/common/resources';

interface IRawGalleryExtensionFile {
	assetType: string;
	source: string;
}

interface IRawGalleryExtensionProperty {
	key: string;
	value: string;
}

interface IRawGalleryExtensionVersion {
	version: string;
	lastUpdated: string;
	assetUri: string;
	fallbackAssetUri: string;
	files: IRawGalleryExtensionFile[];
	properties?: IRawGalleryExtensionProperty[];
}

interface IRawGalleryExtensionStatistics {
	statisticName: string;
	value: number;
}

interface IRawGalleryExtension {
	extensionId: string;
	extensionName: string;
	displayName: string;
	shortDescription: string;
	publisher: { displayName: string, publisherId: string, publisherName: string; };
	versions: IRawGalleryExtensionVersion[];
	statistics: IRawGalleryExtensionStatistics[];
	flags: string;
}

interface IRawGalleryQueryResult {
	results: {
		extensions: IRawGalleryExtension[];
		resultMetadata: {
			metadataType: string;
			metadataItems: {
				name: string;
				count: number;
			}[];
		}[]
	}[];
}

enum Flags {
	None = 0x0,
	IncludeVersions = 0x1,
	IncludeFiles = 0x2,
	IncludeCategoryAndTags = 0x4,
	IncludeSharedAccounts = 0x8,
	IncludeVersionProperties = 0x10,
	ExcludeNonValidated = 0x20,
	IncludeInstallationTargets = 0x40,
	IncludeAssetUri = 0x80,
	IncludeStatistics = 0x100,
	IncludeLatestVersionOnly = 0x200,
	Unpublished = 0x1000
}

function flagsToString(...flags: Flags[]): string {
	return String(flags.reduce((r, f) => r | f, 0));
}

enum FilterType {
	Tag = 1,
	ExtensionId = 4,
	Category = 5,
	ExtensionName = 7,
	Target = 8,
	Featured = 9,
	SearchText = 10,
	ExcludeWithFlags = 12
}

const AssetType = {
	Icon: 'Microsoft.VisualStudio.Services.Icons.Default',
	Details: 'Microsoft.VisualStudio.Services.Content.Details',
	Changelog: 'Microsoft.VisualStudio.Services.Content.Changelog',
	Manifest: 'Microsoft.VisualStudio.Code.Manifest',
	VSIX: 'Microsoft.VisualStudio.Services.VSIXPackage',
	License: 'Microsoft.VisualStudio.Services.Content.License',
	Repository: 'Microsoft.VisualStudio.Services.Links.Source'
};

const PropertyType = {
	Dependency: 'Microsoft.VisualStudio.Code.ExtensionDependencies',
	ExtensionPack: 'Microsoft.VisualStudio.Code.ExtensionPack',
	Engine: 'Microsoft.VisualStudio.Code.Engine',
	LocalizedLanguages: 'Microsoft.VisualStudio.Code.LocalizedLanguages',
	WebExtension: 'Microsoft.VisualStudio.Code.WebExtension'
};

interface ICriterium {
	filterType: FilterType;
	value?: string;
}

const DefaultPageSize = 10;

interface IQueryState {
	pageNumber: number;
	pageSize: number;
	sortBy: SortBy;
	sortOrder: SortOrder;
	flags: Flags;
	criteria: ICriterium[];
	assetTypes: string[];
}

const DefaultQueryState: IQueryState = {
	pageNumber: 1,
	pageSize: DefaultPageSize,
	sortBy: SortBy.NoneOrRelevance,
	sortOrder: SortOrder.Default,
	flags: Flags.None,
	criteria: [],
	assetTypes: []
};

class Query {

	constructor(private state = DefaultQueryState) { }

	get pageNumber(): number { return this.state.pageNumber; }
	get pageSize(): number { return this.state.pageSize; }
	get sortBy(): number { return this.state.sortBy; }
	get sortOrder(): number { return this.state.sortOrder; }
	get flags(): number { return this.state.flags; }

	withPage(pageNumber: number, pageSize: number = this.state.pageSize): Query {
		return new Query({ ...this.state, pageNumber, pageSize });
	}

	withFilter(filterType: FilterType, ...values: string[]): Query {
		const criteria = [
			...this.state.criteria,
			...values.length ? values.map(value => ({ filterType, value })) : [{ filterType }]
		];

		return new Query({ ...this.state, criteria });
	}

	withSortBy(sortBy: SortBy): Query {
		return new Query({ ...this.state, sortBy });
	}

	withSortOrder(sortOrder: SortOrder): Query {
		return new Query({ ...this.state, sortOrder });
	}

	withFlags(...flags: Flags[]): Query {
		return new Query({ ...this.state, flags: flags.reduce<number>((r, f) => r | f, 0) });
	}

	withAssetTypes(...assetTypes: string[]): Query {
		return new Query({ ...this.state, assetTypes });
	}

	get raw(): any {
		const { criteria, pageNumber, pageSize, sortBy, sortOrder, flags, assetTypes } = this.state;
		const filters = [{ criteria, pageNumber, pageSize, sortBy, sortOrder }];
		return { filters, assetTypes, flags };
	}

	get searchText(): string {
		const criterium = this.state.criteria.filter(criterium => criterium.filterType === FilterType.SearchText)[0];
		return criterium && criterium.value ? criterium.value : '';
	}
}

function getStatistic(statistics: IRawGalleryExtensionStatistics[], name: string): number {
	const result = (statistics || []).filter(s => s.statisticName === name)[0];
	return result ? result.value : 0;
}

function getCoreTranslationAssets(version: IRawGalleryExtensionVersion): [string, IGalleryExtensionAsset][] {
	const coreTranslationAssetPrefix = 'Microsoft.VisualStudio.Code.Translation.';
	const result = version.files.filter(f => f.assetType.indexOf(coreTranslationAssetPrefix) === 0);
	return result.reduce<[string, IGalleryExtensionAsset][]>((result, file) => {
		const asset = getVersionAsset(version, file.assetType);
		if (asset) {
			result.push([file.assetType.substring(coreTranslationAssetPrefix.length), asset]);
		}
		return result;
	}, []);
}

function getRepositoryAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset | null {
	if (version.properties) {
		const results = version.properties.filter(p => p.key === AssetType.Repository);
		const gitRegExp = new RegExp('((git|ssh|http(s)?)|(git@[\w.]+))(:(//)?)([\w.@\:/\-~]+)(.git)(/)?');

		const uri = results.filter(r => gitRegExp.test(r.value))[0];
		return uri ? { uri: uri.value, fallbackUri: uri.value } : null;
	}
	return getVersionAsset(version, AssetType.Repository);
}

function getDownloadAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset {
	return {
		uri: `${version.fallbackAssetUri}/${AssetType.VSIX}?redirect=true`,
		fallbackUri: `${version.fallbackAssetUri}/${AssetType.VSIX}`
	};
}

function getIconAsset(version: IRawGalleryExtensionVersion): IGalleryExtensionAsset {
	const asset = getVersionAsset(version, AssetType.Icon);
	if (asset) {
		return asset;
	}
	const uri = DefaultIconPath;
	return { uri, fallbackUri: uri };
}

function getVersionAsset(version: IRawGalleryExtensionVersion, type: string): IGalleryExtensionAsset | null {
	const result = version.files.filter(f => f.assetType === type)[0];
	return result ? { uri: `${version.assetUri}/${type}`, fallbackUri: `${version.fallbackAssetUri}/${type}` } : null;
}

function getExtensions(version: IRawGalleryExtensionVersion, property: string): string[] {
	const values = version.properties ? version.properties.filter(p => p.key === property) : [];
	const value = values.length > 0 && values[0].value;
	return value ? value.split(',').map(v => adoptToGalleryExtensionId(v)) : [];
}

function getEngine(version: IRawGalleryExtensionVersion): string {
	const values = version.properties ? version.properties.filter(p => p.key === PropertyType.Engine) : [];
	return (values.length > 0 && values[0].value) || '';
}

function getLocalizedLanguages(version: IRawGalleryExtensionVersion): string[] {
	const values = version.properties ? version.properties.filter(p => p.key === PropertyType.LocalizedLanguages) : [];
	const value = (values.length > 0 && values[0].value) || '';
	return value ? value.split(',') : [];
}

function getIsPreview(flags: string): boolean {
	return flags.indexOf('preview') !== -1;
}

function getIsWebExtension(version: IRawGalleryExtensionVersion): boolean {
	const webExtensionProperty = version.properties ? version.properties.find(p => p.key === PropertyType.WebExtension) : undefined;
	return !!webExtensionProperty && webExtensionProperty.value === 'true';
}

function getWebResource(version: IRawGalleryExtensionVersion): URI | undefined {
	return version.files.some(f => f.assetType.startsWith('Microsoft.VisualStudio.Code.WebResources'))
		? joinPath(URI.parse(version.assetUri), 'Microsoft.VisualStudio.Code.WebResources', 'extension')
		: undefined;
}

function toExtension(galleryExtension: IRawGalleryExtension, version: IRawGalleryExtensionVersion, index: number, query: Query, querySource?: string): IGalleryExtension {
	const assets = <IGalleryExtensionAssets>{
		manifest: getVersionAsset(version, AssetType.Manifest),
		readme: getVersionAsset(version, AssetType.Details),
		changelog: getVersionAsset(version, AssetType.Changelog),
		license: getVersionAsset(version, AssetType.License),
		repository: getRepositoryAsset(version),
		download: getDownloadAsset(version),
		icon: getIconAsset(version),
		coreTranslations: getCoreTranslationAssets(version)
	};

	return {
		identifier: {
			id: getGalleryExtensionId(galleryExtension.publisher.publisherName, galleryExtension.extensionName),
			uuid: galleryExtension.extensionId
		},
		name: galleryExtension.extensionName,
		version: version.version,
		date: version.lastUpdated,
		displayName: galleryExtension.displayName,
		publisherId: galleryExtension.publisher.publisherId,
		publisher: galleryExtension.publisher.publisherName,
		publisherDisplayName: galleryExtension.publisher.displayName,
		description: galleryExtension.shortDescription || '',
		installCount: getStatistic(galleryExtension.statistics, 'install'),
		rating: getStatistic(galleryExtension.statistics, 'averagerating'),
		ratingCount: getStatistic(galleryExtension.statistics, 'ratingcount'),
		assetUri: URI.parse(version.assetUri),
		webResource: getWebResource(version),
		assetTypes: version.files.map(({ assetType }) => assetType),
		assets,
		properties: {
			dependencies: getExtensions(version, PropertyType.Dependency),
			extensionPack: getExtensions(version, PropertyType.ExtensionPack),
			engine: getEngine(version),
			localizedLanguages: getLocalizedLanguages(version),
			webExtension: getIsWebExtension(version)
		},
		/* __GDPR__FRAGMENT__
			"GalleryExtensionTelemetryData2" : {
				"index" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"searchText": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
				"querySource": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		telemetryData: {
			index: ((query.pageNumber - 1) * query.pageSize) + index,
			searchText: query.searchText,
			querySource
		},
		preview: getIsPreview(galleryExtension.flags)
	};
}

interface IRawExtensionsReport {
	malicious: string[];
	slow: string[];
}

export class ExtensionGalleryService implements IExtensionGalleryService {

	declare readonly _serviceBrand: undefined;

	private extensionsGalleryUrl: string | undefined;
	private extensionsControlUrl: string | undefined;

	private readonly commonHeadersPromise: Promise<{ [key: string]: string; }>;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService,
		@optional(IStorageService) storageService: IStorageService,
	) {
		const config = productService.extensionsGallery;
		this.extensionsGalleryUrl = config && config.serviceUrl;
		this.extensionsControlUrl = config && config.controlUrl;
		this.commonHeadersPromise = resolveMarketplaceHeaders(productService.version, this.environmentService, this.fileService, storageService);
	}

	private api(path = ''): string {
		return `${this.extensionsGalleryUrl}${path}`;
	}

	isEnabled(): boolean {
		return !!this.extensionsGalleryUrl;
	}

	async getExtensions(names: string[], token: CancellationToken): Promise<IGalleryExtension[]> {
		const result: IGalleryExtension[] = [];
		let { total, firstPage: pageResult, getPage } = await this.query({ names, pageSize: names.length }, token);
		result.push(...pageResult);
		for (let pageIndex = 1; result.length < total; pageIndex++) {
			pageResult = await getPage(pageIndex, token);
			if (pageResult.length) {
				result.push(...pageResult);
			} else {
				break;
			}
		}
		return result;
	}

	async getCompatibleExtension(arg1: IExtensionIdentifier | IGalleryExtension, version?: string): Promise<IGalleryExtension | null> {
		const extension = await this.getCompatibleExtensionByEngine(arg1, version);

		if (extension?.properties.webExtension) {
			return extension.webResource ? extension : null;
		} else {
			return extension;
		}
	}

	private async getCompatibleExtensionByEngine(arg1: IExtensionIdentifier | IGalleryExtension, version?: string): Promise<IGalleryExtension | null> {
		const extension: IGalleryExtension | null = isIExtensionIdentifier(arg1) ? null : arg1;
		if (extension && extension.properties.engine && isEngineValid(extension.properties.engine, this.productService.version)) {
			return extension;
		}
		const { id, uuid } = extension ? extension.identifier : <IExtensionIdentifier>arg1;
		let query = new Query()
			.withFlags(Flags.IncludeAssetUri, Flags.IncludeStatistics, Flags.IncludeFiles, Flags.IncludeVersionProperties)
			.withPage(1, 1)
			.withFilter(FilterType.Target, 'Microsoft.VisualStudio.Code');

		if (uuid) {
			query = query.withFilter(FilterType.ExtensionId, uuid);
		} else {
			query = query.withFilter(FilterType.ExtensionName, id);
		}

		const { galleryExtensions } = await this.queryGallery(query, CancellationToken.None);
		const [rawExtension] = galleryExtensions;
		if (!rawExtension || !rawExtension.versions.length) {
			return null;
		}

		if (version) {
			const versionAsset = rawExtension.versions.filter(v => v.version === version)[0];
			if (versionAsset) {
				const extension = toExtension(rawExtension, versionAsset, 0, query);
				if (extension.properties.engine && isEngineValid(extension.properties.engine, this.productService.version)) {
					return extension;
				}
			}
			return null;
		}

		const rawVersion = await this.getLastValidExtensionVersion(rawExtension, rawExtension.versions);
		if (rawVersion) {
			return toExtension(rawExtension, rawVersion, 0, query);
		}
		return null;
	}

	query(token: CancellationToken): Promise<IPager<IGalleryExtension>>;
	query(options: IQueryOptions, token: CancellationToken): Promise<IPager<IGalleryExtension>>;
	async query(arg1: any, arg2?: any): Promise<IPager<IGalleryExtension>> {
		const options: IQueryOptions = CancellationToken.isCancellationToken(arg1) ? {} : arg1;
		const token: CancellationToken = CancellationToken.isCancellationToken(arg1) ? arg1 : arg2;

		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		const type = options.names ? 'ids' : (options.text ? 'text' : 'all');
		let text = options.text || '';
		const pageSize = getOrDefault(options, o => o.pageSize, 50);

		type GalleryServiceQueryClassification = {
			type: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			text: { classification: 'CustomerContent', purpose: 'FeatureInsight' };
		};
		type GalleryServiceQueryEvent = {
			type: string;
			text: string;
		};
		this.telemetryService.publicLog2<GalleryServiceQueryEvent, GalleryServiceQueryClassification>('galleryService:query', { type, text });

		let query = new Query()
			.withFlags(Flags.IncludeLatestVersionOnly, Flags.IncludeAssetUri, Flags.IncludeStatistics, Flags.IncludeFiles, Flags.IncludeVersionProperties)
			.withPage(1, pageSize)
			.withFilter(FilterType.Target, 'Microsoft.VisualStudio.Code');

		if (text) {
			// Use category filter instead of "category:themes"
			text = text.replace(/\bcategory:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedCategory, category) => {
				query = query.withFilter(FilterType.Category, category || quotedCategory);
				return '';
			});

			// Use tag filter instead of "tag:debuggers"
			text = text.replace(/\btag:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedTag, tag) => {
				query = query.withFilter(FilterType.Tag, tag || quotedTag);
				return '';
			});

			// Use featured filter
			text = text.replace(/\bfeatured(\s+|\b|$)/g, () => {
				query = query.withFilter(FilterType.Featured);
				return '';
			});

			text = text.trim();

			if (text) {
				text = text.length < 200 ? text : text.substring(0, 200);
				query = query.withFilter(FilterType.SearchText, text);
			}

			query = query.withSortBy(SortBy.NoneOrRelevance);
		} else if (options.ids) {
			query = query.withFilter(FilterType.ExtensionId, ...options.ids);
		} else if (options.names) {
			query = query.withFilter(FilterType.ExtensionName, ...options.names);
		} else {
			query = query.withSortBy(SortBy.InstallCount);
		}

		if (typeof options.sortBy === 'number') {
			query = query.withSortBy(options.sortBy);
		}

		if (typeof options.sortOrder === 'number') {
			query = query.withSortOrder(options.sortOrder);
		}

		const { galleryExtensions, total } = await this.queryGallery(query, token);
		const extensions = galleryExtensions.map((e, index) => toExtension(e, e.versions[0], index, query, options.source));
		const getPage = async (pageIndex: number, ct: CancellationToken) => {
			if (ct.isCancellationRequested) {
				throw canceled();
			}
			const nextPageQuery = query.withPage(pageIndex + 1);
			const { galleryExtensions } = await this.queryGallery(nextPageQuery, ct);
			return galleryExtensions.map((e, index) => toExtension(e, e.versions[0], index, nextPageQuery, options.source));
		};

		return { firstPage: extensions, total, pageSize: query.pageSize, getPage } as IPager<IGalleryExtension>;
	}

	private async queryGallery(query: Query, token: CancellationToken): Promise<{ galleryExtensions: IRawGalleryExtension[], total: number; }> {
		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		// Always exclude non validated and unpublished extensions
		query = query
			.withFlags(query.flags, Flags.ExcludeNonValidated)
			.withFilter(FilterType.ExcludeWithFlags, flagsToString(Flags.Unpublished));

		const commonHeaders = await this.commonHeadersPromise;
		const data = JSON.stringify(query.raw);
		const headers = {
			...commonHeaders,
			'Content-Type': 'application/json',
			'Accept': 'application/json;api-version=3.0-preview.1',
			'Accept-Encoding': 'gzip',
			'Content-Length': String(data.length)
		};

		const context = await this.requestService.request({
			type: 'POST',
			url: this.api('/extensionquery'),
			data,
			headers
		}, token);

		if (context.res.statusCode && context.res.statusCode >= 400 && context.res.statusCode < 500) {
			return { galleryExtensions: [], total: 0 };
		}

		const result = await asJson<IRawGalleryQueryResult>(context);
		if (result) {
			const r = result.results[0];
			const galleryExtensions = r.extensions;
			const resultCount = r.resultMetadata && r.resultMetadata.filter(m => m.metadataType === 'ResultCount')[0];
			const total = resultCount && resultCount.metadataItems.filter(i => i.name === 'TotalCount')[0].count || 0;

			return { galleryExtensions, total };
		}
		return { galleryExtensions: [], total: 0 };
	}

	async reportStatistic(publisher: string, name: string, version: string, type: StatisticType): Promise<void> {
		if (!this.isEnabled()) {
			return undefined;
		}

		const commonHeaders = await this.commonHeadersPromise;
		const headers = { ...commonHeaders, Accept: '*/*;api-version=4.0-preview.1' };
		try {
			await this.requestService.request({
				type: 'POST',
				url: this.api(`/publishers/${publisher}/extensions/${name}/${version}/stats?statType=${type}`),
				headers
			}, CancellationToken.None);
		} catch (error) { /* Ignore */ }
	}

	async download(extension: IGalleryExtension, location: URI, operation: InstallOperation): Promise<void> {
		this.logService.trace('ExtensionGalleryService#download', extension.identifier.id);
		const data = getGalleryExtensionTelemetryData(extension);
		const startTime = new Date().getTime();
		/* __GDPR__
			"galleryService:downloadVSIX" : {
				"duration": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"${include}": [
					"${GalleryExtensionTelemetryData}"
				]
			}
		*/
		const log = (duration: number) => this.telemetryService.publicLog('galleryService:downloadVSIX', { ...data, duration });

		const operationParam = operation === InstallOperation.Install ? 'install' : operation === InstallOperation.Update ? 'update' : '';
		const downloadAsset = operationParam ? {
			uri: `${extension.assets.download.uri}&${operationParam}=true`,
			fallbackUri: `${extension.assets.download.fallbackUri}?${operationParam}=true`
		} : extension.assets.download;

		const context = await this.getAsset(downloadAsset);
		await this.fileService.writeFile(location, context.stream);
		log(new Date().getTime() - startTime);
	}

	async getReadme(extension: IGalleryExtension, token: CancellationToken): Promise<string> {
		if (extension.assets.readme) {
			const context = await this.getAsset(extension.assets.readme, {}, token);
			const content = await asText(context);
			return content || '';
		}
		return '';
	}

	async getManifest(extension: IGalleryExtension, token: CancellationToken): Promise<IExtensionManifest | null> {
		if (extension.assets.manifest) {
			const context = await this.getAsset(extension.assets.manifest, {}, token);
			const text = await asText(context);
			return text ? JSON.parse(text) : null;
		}
		return null;
	}

	async getCoreTranslation(extension: IGalleryExtension, languageId: string): Promise<ITranslation | null> {
		const asset = extension.assets.coreTranslations.filter(t => t[0] === languageId.toUpperCase())[0];
		if (asset) {
			const context = await this.getAsset(asset[1]);
			const text = await asText(context);
			return text ? JSON.parse(text) : null;
		}
		return null;
	}

	async getChangelog(extension: IGalleryExtension, token: CancellationToken): Promise<string> {
		if (extension.assets.changelog) {
			const context = await this.getAsset(extension.assets.changelog, {}, token);
			const content = await asText(context);
			return content || '';
		}
		return '';
	}

	async getAllVersions(extension: IGalleryExtension, compatible: boolean): Promise<IGalleryExtensionVersion[]> {
		let query = new Query()
			.withFlags(Flags.IncludeVersions, Flags.IncludeFiles, Flags.IncludeVersionProperties)
			.withPage(1, 1)
			.withFilter(FilterType.Target, 'Microsoft.VisualStudio.Code');

		if (extension.identifier.uuid) {
			query = query.withFilter(FilterType.ExtensionId, extension.identifier.uuid);
		} else {
			query = query.withFilter(FilterType.ExtensionName, extension.identifier.id);
		}

		const result: IGalleryExtensionVersion[] = [];
		const { galleryExtensions } = await this.queryGallery(query, CancellationToken.None);
		if (galleryExtensions.length) {
			if (compatible) {
				await Promise.all(galleryExtensions[0].versions.map(async v => {
					let engine: string | undefined;
					try {
						engine = await this.getEngine(v);
					} catch (error) { /* Ignore error and skip version */ }
					if (engine && isEngineValid(engine, this.productService.version)) {
						result.push({ version: v!.version, date: v!.lastUpdated });
					}
				}));
			} else {
				result.push(...galleryExtensions[0].versions.map(v => ({ version: v.version, date: v.lastUpdated })));
			}
		}
		return result;
	}

	private async getAsset(asset: IGalleryExtensionAsset, options: IRequestOptions = {}, token: CancellationToken = CancellationToken.None): Promise<IRequestContext> {
		const commonHeaders = await this.commonHeadersPromise;
		const baseOptions = { type: 'GET' };
		const headers = { ...commonHeaders, ...(options.headers || {}) };
		options = { ...options, ...baseOptions, headers };

		const url = asset.uri;
		const fallbackUrl = asset.fallbackUri;
		const firstOptions = { ...options, url };

		try {
			const context = await this.requestService.request(firstOptions, token);
			if (context.res.statusCode === 200) {
				return context;
			}
			const message = await asText(context);
			throw new Error(`Expected 200, got back ${context.res.statusCode} instead.\n\n${message}`);
		} catch (err) {
			if (isPromiseCanceledError(err)) {
				throw err;
			}

			const message = getErrorMessage(err);
			type GalleryServiceCDNFallbackClassification = {
				url: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				message: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};
			type GalleryServiceCDNFallbackEvent = {
				url: string;
				message: string;
			};
			this.telemetryService.publicLog2<GalleryServiceCDNFallbackEvent, GalleryServiceCDNFallbackClassification>('galleryService:cdnFallback', { url, message });

			const fallbackOptions = { ...options, url: fallbackUrl };
			return this.requestService.request(fallbackOptions, token);
		}
	}

	private async getLastValidExtensionVersion(extension: IRawGalleryExtension, versions: IRawGalleryExtensionVersion[]): Promise<IRawGalleryExtensionVersion | null> {
		const version = this.getLastValidExtensionVersionFromProperties(extension, versions);
		if (version) {
			return version;
		}
		return this.getLastValidExtensionVersionRecursively(extension, versions);
	}

	private getLastValidExtensionVersionFromProperties(extension: IRawGalleryExtension, versions: IRawGalleryExtensionVersion[]): IRawGalleryExtensionVersion | null {
		for (const version of versions) {
			const engine = getEngine(version);
			if (!engine) {
				return null;
			}
			if (isEngineValid(engine, this.productService.version)) {
				return version;
			}
		}
		return null;
	}

	private async getEngine(version: IRawGalleryExtensionVersion): Promise<string> {
		const engine = getEngine(version);
		if (engine) {
			return engine;
		}

		const manifestAsset = getVersionAsset(version, AssetType.Manifest);
		if (!manifestAsset) {
			throw new Error('Manifest was not found');
		}

		const headers = { 'Accept-Encoding': 'gzip' };
		const context = await this.getAsset(manifestAsset, { headers });
		const manifest = await asJson<IExtensionManifest>(context);
		if (manifest) {
			return manifest.engines.vscode;
		}

		throw new Error('Error while reading manifest');
	}

	private async getLastValidExtensionVersionRecursively(extension: IRawGalleryExtension, versions: IRawGalleryExtensionVersion[]): Promise<IRawGalleryExtensionVersion | null> {
		if (!versions.length) {
			return null;
		}

		const version = versions[0];
		const engine = await this.getEngine(version);
		if (!isEngineValid(engine, this.productService.version)) {
			return this.getLastValidExtensionVersionRecursively(extension, versions.slice(1));
		}

		version.properties = version.properties || [];
		version.properties.push({ key: PropertyType.Engine, value: engine });
		return version;
	}

	async getExtensionsReport(): Promise<IReportedExtension[]> {
		if (!this.isEnabled()) {
			throw new Error('No extension gallery service configured.');
		}

		if (!this.extensionsControlUrl) {
			return [];
		}

		const context = await this.requestService.request({ type: 'GET', url: this.extensionsControlUrl }, CancellationToken.None);
		if (context.res.statusCode !== 200) {
			throw new Error('Could not get extensions report.');
		}

		const result = await asJson<IRawExtensionsReport>(context);
		const map = new Map<string, IReportedExtension>();

		if (result) {
			for (const id of result.malicious) {
				const ext = map.get(id) || { id: { id }, malicious: true, slow: false };
				ext.malicious = true;
				map.set(id, ext);
			}
		}

		return [...map.values()];
	}
}

export async function resolveMarketplaceHeaders(version: string, environmentService: IEnvironmentService, fileService: IFileService, storageService: {
	get: (key: string, scope: StorageScope) => string | undefined,
	store: (key: string, value: string, scope: StorageScope, target: StorageTarget) => void
} | undefined): Promise<{ [key: string]: string; }> {
	const headers: IHeaders = {
		'X-Market-Client-Id': `VSCode ${version}`,
		'User-Agent': `VSCode ${version}`
	};
	const uuid = await getServiceMachineId(environmentService, fileService, storageService);
	headers['X-Market-User-Id'] = uuid;
	return headers;
}
