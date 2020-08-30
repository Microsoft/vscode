/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface NLSConfiguration {
	locale: string;
	availableLanguages: {
		[key: string]: string;
	};
	pseudo?: boolean;
	_languagePackSupport?: boolean;
}

export interface InternalNLSConfiguration extends NLSConfiguration {
	_languagePackId: string;
	_translationsConfigFile: string;
	_cacheRoot: string;
	_resolvedLanguagePackCoreLocation: string;
	_corruptedFile: string;
	_languagePackSupport?: boolean;
}

export function getNLSConfiguration(commit: string, userDataPath: string, metaDataFile: string, locale: string): Promise<NLSConfiguration>;
