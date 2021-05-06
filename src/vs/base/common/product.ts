/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from 'vs/base/common/collections';

export interface IBuiltInExtension {
	readonly name: string;
	readonly version: string;
	readonly repo: string;
	readonly metadata: any;
}

export type ConfigurationSyncStore = {
	url: string,
	insidersUrl: string,
	stableUrl: string,
	canSwitch: boolean,
	authenticationProviders: IStringDictionary<{ scopes: string[] }>
};

export type ExtensionUntrustedWorkspaceSupport = {
	readonly default?: boolean | 'limited',
	readonly override?: boolean | 'limited'
};

export interface IProductConfiguration {
	readonly version: string;
	readonly date?: string;
	readonly quality?: string;
	readonly commit?: string;

	readonly nameShort: string;
	readonly nameLong: string;

	readonly win32AppUserModelId?: string;
	readonly win32MutexName?: string;
	readonly applicationName: string;

	readonly urlProtocol: string;
	readonly dataFolderName: string; // location for extensions (e.g. ~/.vscode-insiders)

	readonly builtInExtensions?: IBuiltInExtension[];

	readonly downloadUrl?: string;
	readonly updateUrl?: string;
	readonly webEndpointUrl?: string;
	readonly target?: string;

	readonly settingsSearchBuildId?: number;
	readonly settingsSearchUrl?: string;

	readonly tasConfig?: {
		endpoint: string;
		telemetryEventName: string;
		featuresTelemetryPropertyName: string;
		assignmentContextTelemetryPropertyName: string;
	};

	readonly experimentsUrl?: string;

	readonly extensionsGallery?: {
		readonly serviceUrl: string;
		readonly itemUrl: string;
		readonly controlUrl: string;
		readonly recommendationsUrl: string;
	};

	readonly extensionTips?: { [id: string]: string; };
	readonly extensionImportantTips?: IStringDictionary<ImportantExtensionTip>;
	readonly configBasedExtensionTips?: { [id: string]: IConfigBasedExtensionTip; };
	readonly exeBasedExtensionTips?: { [id: string]: IExeBasedExtensionTip; };
	readonly remoteExtensionTips?: { [remoteName: string]: IRemoteExtensionTip; };
	readonly extensionKeywords?: { [extension: string]: readonly string[]; };
	readonly keymapExtensionTips?: readonly string[];
	readonly trustedExtensionUrlPublicKeys?: { [id: string]: string[]; };

	readonly crashReporter?: {
		readonly companyName: string;
		readonly productName: string;
	};

	readonly enableTelemetry?: boolean;
	readonly aiConfig?: {
		readonly asimovKey: string;
	};

	readonly sendASmile?: {
		readonly reportIssueUrl: string,
		readonly requestFeatureUrl: string
	};

	readonly documentationUrl?: string;
	readonly releaseNotesUrl?: string;
	readonly keyboardShortcutsUrlMac?: string;
	readonly keyboardShortcutsUrlLinux?: string;
	readonly keyboardShortcutsUrlWin?: string;
	readonly introductoryVideosUrl?: string;
	readonly tipsAndTricksUrl?: string;
	readonly newsletterSignupUrl?: string;
	readonly twitterUrl?: string;
	readonly requestFeatureUrl?: string;
	readonly reportIssueUrl?: string;
	readonly reportMarketplaceIssueUrl?: string;
	readonly licenseUrl?: string;
	readonly privacyStatementUrl?: string;
	readonly telemetryOptOutUrl?: string;

	readonly npsSurveyUrl?: string;
	readonly cesSurveyUrl?: string;
	readonly surveys?: readonly ISurveyData[];

	readonly checksums?: { [path: string]: string; };
	readonly checksumFailMoreInfoUrl?: string;

	readonly appCenter?: IAppCenterConfiguration;

	readonly portable?: string;

	readonly extensionKind?: { readonly [extensionId: string]: ('ui' | 'workspace' | 'web')[]; };
	readonly extensionSyncedKeys?: { readonly [extensionId: string]: string[]; };
	readonly extensionAllowedProposedApi?: readonly string[];
	readonly extensionUntrustedWorkspaceSupport?: { readonly [extensionId: string]: ExtensionUntrustedWorkspaceSupport };
	readonly extensionVirtualWorkspacesSupport?: { readonly [extensionId: string]: { default?: boolean, override?: boolean } };

	readonly msftInternalDomains?: string[];
	readonly linkProtectionTrustedDomains?: readonly string[];

	readonly 'configurationSync.store'?: ConfigurationSyncStore;

	readonly darwinUniversalAssetId?: string;
}

export type ImportantExtensionTip = { name: string; languages?: string[]; pattern?: string; isExtensionPack?: boolean };

export interface IAppCenterConfiguration {
	readonly 'win32-ia32': string;
	readonly 'win32-x64': string;
	readonly 'linux-x64': string;
	readonly 'darwin': string;
}

export interface IConfigBasedExtensionTip {
	configPath: string;
	configName: string;
	recommendations: IStringDictionary<{ name: string, remotes?: string[], important?: boolean, isExtensionPack?: boolean }>;
}

export interface IExeBasedExtensionTip {
	friendlyName: string;
	windowsPath?: string;
	important?: boolean;
	recommendations: IStringDictionary<{ name: string, important?: boolean, isExtensionPack?: boolean }>;
}

export interface IRemoteExtensionTip {
	friendlyName: string;
	extensionId: string;
}

export interface ISurveyData {
	surveyId: string;
	surveyUrl: string;
	languageId: string;
	editCount: number;
	userProbability: number;
}
