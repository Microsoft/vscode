/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IExtensionIdentifier, EXTENSION_IDENTIFIER_PATTERN } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, allSettings } from 'vs/platform/configuration/common/configurationRegistry';
import { localize } from 'vs/nls';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStringDictionary } from 'vs/base/common/collections';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { URI } from 'vs/base/common/uri';
import { joinPath, isEqualOrParent } from 'vs/base/common/resources';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IProductService, ConfigurationSyncStore } from 'vs/platform/product/common/productService';
import { distinct } from 'vs/base/common/arrays';
import { isArray, isString, isObject } from 'vs/base/common/types';
import { IHeaders } from 'vs/base/parts/request/common/request';

export const CONFIGURATION_SYNC_STORE_KEY = 'configurationSync.store';

export function getDisallowedIgnoredSettings(): string[] {
	const allSettings = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	return Object.keys(allSettings).filter(setting => !!allSettings[setting].disallowSyncIgnore);
}

export function getDefaultIgnoredSettings(): string[] {
	const allSettings = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	const machineSettings = Object.keys(allSettings).filter(setting => allSettings[setting].scope === ConfigurationScope.MACHINE || allSettings[setting].scope === ConfigurationScope.MACHINE_OVERRIDABLE);
	const disallowedSettings = getDisallowedIgnoredSettings();
	return distinct([CONFIGURATION_SYNC_STORE_KEY, ...machineSettings, ...disallowedSettings]);
}

export function registerConfiguration(): IDisposable {
	const ignoredSettingsSchemaId = 'vscode://schemas/ignoredSettings';
	const ignoredExtensionsSchemaId = 'vscode://schemas/ignoredExtensions';
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	configurationRegistry.registerConfiguration({
		id: 'sync',
		order: 30,
		title: localize('sync', "Sync"),
		type: 'object',
		properties: {
			'sync.keybindingsPerPlatform': {
				type: 'boolean',
				description: localize('sync.keybindingsPerPlatform', "Synchronize keybindings per platform."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
				tags: ['sync', 'usesOnlineServices']
			},
			'sync.ignoredExtensions': {
				'type': 'array',
				'description': localize('sync.ignoredExtensions', "List of extensions to be ignored while synchronizing. The identifier of an extension is always ${publisher}.${name}. For example: vscode.csharp."),
				$ref: ignoredExtensionsSchemaId,
				'default': [],
				'scope': ConfigurationScope.APPLICATION,
				uniqueItems: true,
				disallowSyncIgnore: true,
				tags: ['sync', 'usesOnlineServices']
			},
			'sync.ignoredSettings': {
				'type': 'array',
				description: localize('sync.ignoredSettings', "Configure settings to be ignored while synchronizing."),
				'default': [],
				'scope': ConfigurationScope.APPLICATION,
				$ref: ignoredSettingsSchemaId,
				additionalProperties: true,
				uniqueItems: true,
				disallowSyncIgnore: true,
				tags: ['sync', 'usesOnlineServices']
			}
		}
	});
	const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
	const registerIgnoredSettingsSchema = () => {
		const disallowedIgnoredSettings = getDisallowedIgnoredSettings();
		const defaultIgnoredSettings = getDefaultIgnoredSettings().filter(s => s !== CONFIGURATION_SYNC_STORE_KEY);
		const settings = Object.keys(allSettings.properties).filter(setting => defaultIgnoredSettings.indexOf(setting) === -1);
		const ignoredSettings = defaultIgnoredSettings.filter(setting => disallowedIgnoredSettings.indexOf(setting) === -1);
		const ignoredSettingsSchema: IJSONSchema = {
			items: {
				type: 'string',
				enum: [...settings, ...ignoredSettings.map(setting => `-${setting}`)]
			},
		};
		jsonRegistry.registerSchema(ignoredSettingsSchemaId, ignoredSettingsSchema);
	};
	jsonRegistry.registerSchema(ignoredExtensionsSchemaId, {
		type: 'string',
		pattern: EXTENSION_IDENTIFIER_PATTERN,
		errorMessage: localize('app.extension.identifier.errorMessage', "Expected format '${publisher}.${name}'. Example: 'vscode.csharp'.")
	});
	return configurationRegistry.onDidUpdateConfiguration(() => registerIgnoredSettingsSchema());
}

// #region User Data Sync Store

export interface IUserData {
	ref: string;
	content: string | null;
}

export type IAuthenticationProvider = { id: string, scopes: string[] };

export interface IUserDataSyncStore {
	url: URI;
	authenticationProviders: IAuthenticationProvider[];
}

export function isAuthenticationProvider(thing: any): thing is IAuthenticationProvider {
	return thing
		&& isObject(thing)
		&& isString(thing.id)
		&& isArray(thing.scopes);
}

export function getUserDataSyncStore(productService: IProductService, configurationService: IConfigurationService): IUserDataSyncStore | undefined {
	const value = configurationService.getValue<ConfigurationSyncStore>(CONFIGURATION_SYNC_STORE_KEY) || productService[CONFIGURATION_SYNC_STORE_KEY];
	if (value
		&& isString(value.url)
		&& isObject(value.authenticationProviders)
		&& Object.keys(value.authenticationProviders).every(authenticationProviderId => isArray(value.authenticationProviders[authenticationProviderId].scopes))
	) {
		return {
			url: joinPath(URI.parse(value.url), 'v1'),
			authenticationProviders: Object.keys(value.authenticationProviders).reduce<IAuthenticationProvider[]>((result, id) => {
				result.push({ id, scopes: value.authenticationProviders[id].scopes });
				return result;
			}, [])
		};
	}
	return undefined;
}

export const enum SyncResource {
	Settings = 'settings',
	Keybindings = 'keybindings',
	Snippets = 'snippets',
	Extensions = 'extensions',
	GlobalState = 'globalState'
}
export const ALL_SYNC_RESOURCES: SyncResource[] = [SyncResource.Settings, SyncResource.Keybindings, SyncResource.Snippets, SyncResource.Extensions, SyncResource.GlobalState];

export interface IUserDataManifest {
	latest?: Record<ServerResource, string>
	session: string;
}

export interface IResourceRefHandle {
	ref: string;
	created: number;
}

export const IUserDataSyncStoreService = createDecorator<IUserDataSyncStoreService>('IUserDataSyncStoreService');
export type ServerResource = SyncResource | 'machines';
export interface IUserDataSyncStoreService {
	readonly _serviceBrand: undefined;
	readonly userDataSyncStore: IUserDataSyncStore | undefined;

	readonly onTokenFailed: Event<void>;
	readonly onTokenSucceed: Event<void>;
	setAuthToken(token: string, type: string): void;

	// Sync requests
	manifest(headers?: IHeaders): Promise<IUserDataManifest | null>;
	read(resource: ServerResource, oldValue: IUserData | null, headers?: IHeaders): Promise<IUserData>;
	write(resource: ServerResource, content: string, ref: string | null, headers?: IHeaders): Promise<string>;
	clear(): Promise<void>;
	delete(resource: ServerResource): Promise<void>;

	getAllRefs(resource: ServerResource): Promise<IResourceRefHandle[]>;
	resolveContent(resource: ServerResource, ref: string): Promise<string | null>;
}

export const IUserDataSyncBackupStoreService = createDecorator<IUserDataSyncBackupStoreService>('IUserDataSyncBackupStoreService');
export interface IUserDataSyncBackupStoreService {
	readonly _serviceBrand: undefined;
	backup(resource: SyncResource, content: string): Promise<void>;
	getAllRefs(resource: SyncResource): Promise<IResourceRefHandle[]>;
	resolveContent(resource: SyncResource, ref?: string): Promise<string | null>;
}

//#endregion

// #region User Data Sync Headers

export const HEADER_OPERATION_ID = 'x-operation-id';
export const HEADER_EXECUTION_ID = 'X-Execution-Id';

//#endregion

// #region User Data Sync Error

export enum UserDataSyncErrorCode {
	// Client Errors (>= 400 )
	Unauthorized = 'Unauthorized', /* 401 */
	Gone = 'Gone', /* 410 */
	PreconditionFailed = 'PreconditionFailed', /* 412 */
	TooLarge = 'TooLarge', /* 413 */
	UpgradeRequired = 'UpgradeRequired', /* 426 */
	PreconditionRequired = 'PreconditionRequired', /* 428 */
	TooManyRequests = 'RemoteTooManyRequests', /* 429 */

	// Local Errors
	ConnectionRefused = 'ConnectionRefused',
	NoRef = 'NoRef',
	TurnedOff = 'TurnedOff',
	SessionExpired = 'SessionExpired',
	LocalTooManyRequests = 'LocalTooManyRequests',
	LocalPreconditionFailed = 'LocalPreconditionFailed',
	LocalInvalidContent = 'LocalInvalidContent',
	LocalError = 'LocalError',
	IncompatibleLocalContent = 'IncompatibleLocalContent',
	IncompatibleRemoteContent = 'IncompatibleRemoteContent',
	UnresolvedConflicts = 'UnresolvedConflicts',

	Unknown = 'Unknown',
}

export class UserDataSyncError extends Error {

	constructor(
		message: string,
		readonly code: UserDataSyncErrorCode,
		readonly resource?: SyncResource,
		readonly operationId?: string
	) {
		super(message);
		this.name = `${this.code} (UserDataSyncError) syncResource:${this.resource || 'unknown'} operationId:${this.operationId || 'unknown'}`;
	}

}

export class UserDataSyncStoreError extends UserDataSyncError {
	constructor(message: string, code: UserDataSyncErrorCode, readonly operationId: string | undefined) {
		super(message, code, undefined, operationId);
	}
}

export class UserDataAutoSyncError extends UserDataSyncError {
	constructor(message: string, code: UserDataSyncErrorCode) {
		super(message, code);
	}
}

export namespace UserDataSyncError {

	export function toUserDataSyncError(error: Error): UserDataSyncError {
		if (error instanceof UserDataSyncError) {
			return error;
		}
		const match = /^(.+) \(UserDataSyncError\) syncResource:(.+) operationId:(.+)$/.exec(error.name);
		if (match && match[1]) {
			const syncResource = match[2] === 'unknown' ? undefined : match[2] as SyncResource;
			const operationId = match[3] === 'unknown' ? undefined : match[3];
			return new UserDataSyncError(error.message, <UserDataSyncErrorCode>match[1], syncResource, operationId);
		}
		return new UserDataSyncError(error.message, UserDataSyncErrorCode.Unknown);
	}

}

//#endregion

// #region User Data Synchroniser

export interface ISyncExtension {
	identifier: IExtensionIdentifier;
	version?: string;
	disabled?: boolean;
	installed?: boolean;
}

export interface IStorageValue {
	version: number;
	value: string;
}

export interface IGlobalState {
	storage: IStringDictionary<IStorageValue>;
}

export const enum SyncStatus {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	Syncing = 'syncing',
	HasConflicts = 'hasConflicts',
}

export interface ISyncResourceHandle {
	created: number;
	uri: URI;
}

export interface IRemoteUserData {
	ref: string;
	syncData: ISyncData | null;
}

export interface ISyncData {
	version: number;
	machineId?: string;
	content: string;
}

export const enum Change {
	None,
	Added,
	Modified,
	Deleted,
}

export const enum MergeState {
	Preview = 'preview',
	Conflict = 'conflict',
	Accepted = 'accepted',
}

export interface IResourcePreview {
	readonly remoteResource: URI;
	readonly localResource: URI;
	readonly previewResource: URI;
	readonly acceptedResource: URI;
	readonly localChange: Change;
	readonly remoteChange: Change;
	readonly mergeState: MergeState;
}

export interface ISyncResourcePreview {
	readonly isLastSyncFromCurrentMachine: boolean;
	readonly resourcePreviews: IResourcePreview[];
}

export interface IUserDataSynchroniser {

	readonly resource: SyncResource;
	readonly status: SyncStatus;
	readonly onDidChangeStatus: Event<SyncStatus>;

	readonly conflicts: IResourcePreview[];
	readonly onDidChangeConflicts: Event<IResourcePreview[]>;

	readonly onDidChangeLocal: Event<void>;

	pull(): Promise<void>;
	push(): Promise<void>;
	sync(manifest: IUserDataManifest | null, headers: IHeaders): Promise<void>;
	replace(uri: URI): Promise<boolean>;
	stop(): Promise<void>;

	preview(manifest: IUserDataManifest | null, headers: IHeaders): Promise<ISyncResourcePreview | null>;
	accept(resource: URI, content: string): Promise<ISyncResourcePreview | null>;
	merge(resource: URI): Promise<ISyncResourcePreview | null>;
	discard(resource: URI): Promise<ISyncResourcePreview | null>;
	apply(force: boolean, headers: IHeaders): Promise<ISyncResourcePreview | null>;

	hasPreviouslySynced(): Promise<boolean>;
	hasLocalData(): Promise<boolean>;
	resetLocal(): Promise<void>;

	resolveContent(resource: URI): Promise<string | null>;
	getRemoteSyncResourceHandles(): Promise<ISyncResourceHandle[]>;
	getLocalSyncResourceHandles(): Promise<ISyncResourceHandle[]>;
	getAssociatedResources(syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]>;
	getMachineId(syncResourceHandle: ISyncResourceHandle): Promise<string | undefined>;
}

//#endregion

// #region User Data Sync Services

export const IUserDataSyncResourceEnablementService = createDecorator<IUserDataSyncResourceEnablementService>('IUserDataSyncResourceEnablementService');
export interface IUserDataSyncResourceEnablementService {
	_serviceBrand: any;

	readonly onDidChangeResourceEnablement: Event<[SyncResource, boolean]>;
	isResourceEnabled(resource: SyncResource): boolean;
	setResourceEnablement(resource: SyncResource, enabled: boolean): void;
}

export interface ISyncTask {
	readonly manifest: IUserDataManifest | null;
	run(): Promise<void>;
	stop(): Promise<void>;
}

export interface IManualSyncTask extends IDisposable {
	readonly id: string;
	readonly manifest: IUserDataManifest | null;
	readonly onSynchronizeResources: Event<[SyncResource, URI[]][]>;
	preview(): Promise<[SyncResource, ISyncResourcePreview][]>;
	accept(resource: URI, content: string): Promise<[SyncResource, ISyncResourcePreview][]>;
	merge(resource: URI): Promise<[SyncResource, ISyncResourcePreview][]>;
	discard(resource: URI): Promise<[SyncResource, ISyncResourcePreview][]>;
	apply(): Promise<[SyncResource, ISyncResourcePreview][]>;
	pull(): Promise<void>;
	push(): Promise<void>;
	stop(): Promise<void>;
}

export const IUserDataSyncService = createDecorator<IUserDataSyncService>('IUserDataSyncService');
export interface IUserDataSyncService {
	_serviceBrand: any;

	readonly status: SyncStatus;
	readonly onDidChangeStatus: Event<SyncStatus>;

	readonly conflicts: [SyncResource, IResourcePreview[]][];
	readonly onDidChangeConflicts: Event<[SyncResource, IResourcePreview[]][]>;

	readonly onDidChangeLocal: Event<SyncResource>;
	readonly onSyncErrors: Event<[SyncResource, UserDataSyncError][]>;

	readonly lastSyncTime: number | undefined;
	readonly onDidChangeLastSyncTime: Event<number>;

	createSyncTask(): Promise<ISyncTask>;
	createManualSyncTask(): Promise<IManualSyncTask>;

	pull(): Promise<void>;
	replace(uri: URI): Promise<void>;
	reset(): Promise<void>;
	resetRemote(): Promise<void>;
	resetLocal(): Promise<void>;

	hasLocalData(): Promise<boolean>;
	hasPreviouslySynced(): Promise<boolean>;
	resolveContent(resource: URI): Promise<string | null>;
	accept(resource: SyncResource, conflictResource: URI, content: string, apply: boolean): Promise<void>;

	getLocalSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]>;
	getRemoteSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]>;
	getAssociatedResources(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]>;
	getMachineId(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<string | undefined>;
}

export const IUserDataAutoSyncService = createDecorator<IUserDataAutoSyncService>('IUserDataAutoSyncService');
export interface IUserDataAutoSyncService {
	_serviceBrand: any;
	readonly onError: Event<UserDataSyncError>;
	readonly onDidChangeEnablement: Event<boolean>;
	isEnabled(): boolean;
	canToggleEnablement(): boolean;
	turnOn(): Promise<void>;
	turnOff(everywhere: boolean): Promise<void>;
	triggerSync(sources: string[], hasToLimitSync: boolean): Promise<void>;
}

export const IUserDataSyncUtilService = createDecorator<IUserDataSyncUtilService>('IUserDataSyncUtilService');
export interface IUserDataSyncUtilService {
	readonly _serviceBrand: undefined;
	resolveUserBindings(userbindings: string[]): Promise<IStringDictionary<string>>;
	resolveFormattingOptions(resource: URI): Promise<FormattingOptions>;
	resolveDefaultIgnoredSettings(): Promise<string[]>;
}

export const IUserDataSyncLogService = createDecorator<IUserDataSyncLogService>('IUserDataSyncLogService');
export interface IUserDataSyncLogService extends ILogService { }

export interface IConflictSetting {
	key: string;
	localValue: any | undefined;
	remoteValue: any | undefined;
}

//#endregion

export const USER_DATA_SYNC_SCHEME = 'vscode-userdata-sync';
export const PREVIEW_DIR_NAME = 'preview';
export function getSyncResourceFromLocalPreview(localPreview: URI, environmentService: IEnvironmentService): SyncResource | undefined {
	if (localPreview.scheme === USER_DATA_SYNC_SCHEME) {
		return undefined;
	}
	localPreview = localPreview.with({ scheme: environmentService.userDataSyncHome.scheme });
	return ALL_SYNC_RESOURCES.filter(syncResource => isEqualOrParent(localPreview, joinPath(environmentService.userDataSyncHome, syncResource, PREVIEW_DIR_NAME)))[0];
}
