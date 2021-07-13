/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILanguageDetectionService {
	readonly _serviceBrand: undefined;

	detectLanguage(contet: string): Promise<string | undefined>;
}
