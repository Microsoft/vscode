/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ExtensionKind } from 'vs/platform/extensions/common/extensions';
import { IStringDictionary } from 'vs/base/common/collections';

export const IProductService = createDecorator<IProductService>('productService');

export interface IProductService extends Readonly<IProductConfiguration> {

	_serviceBrand: undefined;

}

export interface IBuiltInExtension {
	readonly name: string;
	readonly version: string;
	readonly repo: string;
	readonly metadata: any;
}

export type ConfigurationSyncStore = { url: string, authenticationProviders: IStringDictionary<{ scopes: string[] }> };

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
	readonly dataFolderName: string;

	readonly builtInExtensions?: IBuiltInExtension[];

	readonly downloadUrl?: string;
	readonly updateUrl?: string;
	readonly target?: string;

	readonly settingsSearchBuildId?: number;
	readonly settingsSearchUrl?: string;

	readonly experimentsUrl?: string;

	readonly extensionsGallery?: {
		readonly serviceUrl: string;
		readonly itemUrl: string;
		readonly controlUrl: string;
		readonly recommendationsUrl: string;
	};

	readonly extensionTips?: { [id: string]: string; };
	readonly extensionImportantTips?: { [id: string]: { name: string; pattern: string; isExtensionPack?: boolean }; };
	readonly configBasedExtensionTips?: { [id: string]: IConfigBasedExtensionTip; };
	readonly exeBasedExtensionTips?: { [id: string]: IExeBasedExtensionTip; };
	readonly remoteExtensionTips?: { [remoteName: string]: IRemoteExtensionTip; };
	readonly extensionKeywords?: { [extension: string]: readonly string[]; };
	readonly keymapExtensionTips?: readonly string[];

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
	readonly licenseUrl?: string;
	readonly privacyStatementUrl?: string;
	readonly telemetryOptOutUrl?: string;

	readonly npsSurveyUrl?: string;
	readonly surveys?: readonly ISurveyData[];

	readonly checksums?: { [path: string]: string; };
	readonly checksumFailMoreInfoUrl?: string;

	readonly appCenter?: {
		readonly 'win32-ia32': string;
		readonly 'win32-x64': string;
		readonly 'linux-x64': string;
		readonly 'darwin': string;
	};

	readonly portable?: string;

	readonly extensionKind?: { readonly [extensionId: string]: ExtensionKind[]; };
	readonly extensionAllowedProposedApi?: readonly string[];

	readonly msftInternalDomains?: string[];
	readonly linkProtectionTrustedDomains?: readonly string[];

	readonly 'configurationSync.store'?: ConfigurationSyncStore;
}

export interface IConfigBasedExtensionTip {
	configPath: string;
	configName: string;
	recommendations: IStringDictionary<{ name: string, remotes?: string[], important?: boolean, isExtensionPack?: boolean }>;
}

export interface IExeBasedExtensionTip {
	friendlyName: string;
	windowsPath?: string;
	recommendations: readonly string[];
	important?: boolean;
	exeFriendlyName?: string;
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
