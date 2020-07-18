/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IMode, LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IModeService = createDecorator<IModeService>('modeService');

export interface ILanguageExtensionPoint {
	id: string;
	extensions?: string[];
	filenames?: string[];
	filenamePatterns?: string[];
	firstLine?: string;
	aliases?: string[];
	mimetypes?: string[];
	configuration?: URI;
}

export interface ILanguageSelection extends IDisposable {
	readonly languageIdentifier: LanguageIdentifier;
	readonly onDidChange: Event<LanguageIdentifier>;
}

export interface IModeService {
	readonly _serviceBrand: undefined;

	onDidCreateMode: Event<IMode>;
	onLanguagesMaybeChanged: Event<void>;

	// --- reading
	isRegisteredMode(mimetypeOrModeId: string): boolean;
	getRegisteredModes(): string[];
	getRegisteredLanguageNames(): string[];
	getExtensions(alias: string): string[];
	getFilenames(alias: string): string[];
	getMimeForMode(modeId: string): string | null;
	getLanguageName(modeId: string): string | null;
	getModeIdForLanguageName(alias: string): string | null;
	getModeIdByFilepathOrFirstLine(resource: URI, firstLine?: string): string | null;
	getModeId(commaSeparatedMimetypesOrCommaSeparatedIds: string): string | null;
	getLanguageIdentifier(modeId: string | LanguageId): LanguageIdentifier | null;
	getConfigurationFiles(modeId: string): URI[];

	// --- instantiation
	create(commaSeparatedMimetypesOrCommaSeparatedIds: string | undefined): ILanguageSelection;
	createByLanguageName(languageName: string): ILanguageSelection;
	createByFilepathOrFirstLine(rsource: URI | null, firstLine?: string): ILanguageSelection;

	triggerMode(commaSeparatedMimetypesOrCommaSeparatedIds: string): void;
}
