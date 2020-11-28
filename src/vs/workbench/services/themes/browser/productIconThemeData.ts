/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import * as Paths from 'vs/base/common/path';
import * as resources from 'vs/base/common/resources';
import * as Json from 'vs/base/common/json';
import { ExtensionData, IThemeExtensionPoint, IWorkbenchProductIconTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IFileService } from 'vs/platform/files/common/files';
import { getParseErrorMessage } from 'vs/base/common/jsonErrorMessages';
import { asCSSUrl } from 'vs/base/browser/dom';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { DEFAULT_PRODUCT_ICON_THEME_SETTING_VALUE } from 'vs/workbench/services/themes/common/themeConfiguration';
import { fontIdRegex, fontWeightRegex, fontStyleRegex } from 'vs/workbench/services/themes/common/productIconThemeSchema';
import { isString } from 'vs/base/common/types';
import { ILogService } from 'vs/platform/log/common/log';
import { getIconRegistry } from 'vs/platform/theme/common/iconRegistry';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export const DEFAULT_PRODUCT_ICON_THEME_ID = ''; // TODO

export class ProductIconThemeData implements IWorkbenchProductIconTheme {

	static readonly STORAGE_KEY = 'productIconThemeData';

	id: string;
	label: string;
	settingsId: string;
	description?: string;
	isLoaded: boolean;
	location?: URI;
	extensionData?: ExtensionData;
	watch?: boolean;

	styleSheetContent?: string;

	private constructor(id: string, label: string, settingsId: string) {
		this.id = id;
		this.label = label;
		this.settingsId = settingsId;
		this.isLoaded = false;
	}

	public ensureLoaded(fileService: IFileService, logService: ILogService): Promise<string | undefined> {
		return !this.isLoaded ? this.load(fileService, logService) : Promise.resolve(this.styleSheetContent);
	}

	public reload(fileService: IFileService, logService: ILogService): Promise<string | undefined> {
		return this.load(fileService, logService);
	}

	private load(fileService: IFileService, logService: ILogService): Promise<string | undefined> {
		const location = this.location;
		if (!location) {
			return Promise.resolve(this.styleSheetContent);
		}
		return _loadProductIconThemeDocument(fileService, location).then(iconThemeDocument => {
			const result = _processIconThemeDocument(this.id, location, iconThemeDocument);
			this.styleSheetContent = result.content;
			this.isLoaded = true;
			if (result.warnings.length) {
				logService.error(nls.localize('error.parseicondefs', "Problems processing product icons definitions in {0}:\n{1}", location.toString(), result.warnings.join('\n')));
			}
			return this.styleSheetContent;
		});
	}

	static fromExtensionTheme(iconTheme: IThemeExtensionPoint, iconThemeLocation: URI, extensionData: ExtensionData): ProductIconThemeData {
		const id = extensionData.extensionId + '-' + iconTheme.id;
		const label = iconTheme.label || Paths.basename(iconTheme.path);
		const settingsId = iconTheme.id;

		const themeData = new ProductIconThemeData(id, label, settingsId);

		themeData.description = iconTheme.description;
		themeData.location = iconThemeLocation;
		themeData.extensionData = extensionData;
		themeData.watch = iconTheme._watch;
		themeData.isLoaded = false;
		return themeData;
	}

	static createUnloadedTheme(id: string): ProductIconThemeData {
		const themeData = new ProductIconThemeData(id, '', '__' + id);
		themeData.isLoaded = false;
		themeData.extensionData = undefined;
		themeData.watch = false;
		return themeData;
	}

	private static _defaultProductIconTheme: ProductIconThemeData | null = null;

	static get defaultTheme(): ProductIconThemeData {
		let themeData = ProductIconThemeData._defaultProductIconTheme;
		if (!themeData) {
			themeData = ProductIconThemeData._defaultProductIconTheme = new ProductIconThemeData(DEFAULT_PRODUCT_ICON_THEME_ID, nls.localize('defaultTheme', 'Default'), DEFAULT_PRODUCT_ICON_THEME_SETTING_VALUE);
			themeData.isLoaded = true;
			themeData.extensionData = undefined;
			themeData.watch = false;
		}
		return themeData;
	}

	static fromStorageData(storageService: IStorageService): ProductIconThemeData | undefined {
		const input = storageService.get(ProductIconThemeData.STORAGE_KEY, StorageScope.GLOBAL);
		if (!input) {
			return undefined;
		}
		try {
			let data = JSON.parse(input);
			const theme = new ProductIconThemeData('', '', '');
			for (let key in data) {
				switch (key) {
					case 'id':
					case 'label':
					case 'description':
					case 'settingsId':
					case 'styleSheetContent':
					case 'watch':
						(theme as any)[key] = data[key];
						break;
					case 'location':
						// ignore, no longer restore
						break;
					case 'extensionData':
						theme.extensionData = ExtensionData.fromJSONObject(data.extensionData);
						break;
				}
			}
			return theme;
		} catch (e) {
			return undefined;
		}
	}

	toStorage(storageService: IStorageService) {
		const data = JSON.stringify({
			id: this.id,
			label: this.label,
			description: this.description,
			settingsId: this.settingsId,
			styleSheetContent: this.styleSheetContent,
			watch: this.watch,
			extensionData: ExtensionData.toJSONObject(this.extensionData),
		});
		storageService.store(ProductIconThemeData.STORAGE_KEY, data, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}
}

interface IconDefinition {
	fontCharacter: string;
	fontId: string;
}

interface FontDefinition {
	id: string;
	weight: string;
	style: string;
	size: string;
	src: { path: string; format: string; }[];
}

interface ProductIconThemeDocument {
	iconDefinitions: { [key: string]: IconDefinition };
	fonts: FontDefinition[];
}

function _loadProductIconThemeDocument(fileService: IFileService, location: URI): Promise<ProductIconThemeDocument> {
	return fileService.readFile(location).then((content) => {
		let errors: Json.ParseError[] = [];
		let contentValue = Json.parse(content.value.toString(), errors);
		if (errors.length > 0) {
			return Promise.reject(new Error(nls.localize('error.cannotparseicontheme', "Problems parsing product icons file: {0}", errors.map(e => getParseErrorMessage(e.error)).join(', '))));
		} else if (Json.getNodeType(contentValue) !== 'object') {
			return Promise.reject(new Error(nls.localize('error.invalidformat', "Invalid format for product icons theme file: Object expected.")));
		} else if (!contentValue.iconDefinitions || !Array.isArray(contentValue.fonts) || !contentValue.fonts.length) {
			return Promise.reject(new Error(nls.localize('error.missingProperties', "Invalid format for product icons theme file: Must contain iconDefinitions and fonts.")));
		}
		return Promise.resolve(contentValue);
	});
}

function _processIconThemeDocument(id: string, iconThemeDocumentLocation: URI, iconThemeDocument: ProductIconThemeDocument): { content: string; warnings: string[] } {

	const warnings: string[] = [];
	const result = { content: '', warnings };

	if (!iconThemeDocument.iconDefinitions || !Array.isArray(iconThemeDocument.fonts) || !iconThemeDocument.fonts.length) {
		return result;
	}

	const iconThemeDocumentLocationDirname = resources.dirname(iconThemeDocumentLocation);
	function resolvePath(path: string) {
		return resources.joinPath(iconThemeDocumentLocationDirname, path);
	}

	const cssRules: string[] = [];

	const fonts = iconThemeDocument.fonts;
	const fontIdMapping: { [id: string]: string } = {};
	for (const font of fonts) {
		const src = font.src.map(l => `${asCSSUrl(resolvePath(l.path))} format('${l.format}')`).join(', ');
		if (isString(font.id) && font.id.match(fontIdRegex)) {
			const fontId = `pi-` + font.id;
			fontIdMapping[font.id] = fontId;

			let fontWeight = '';
			if (isString(font.weight) && font.weight.match(fontWeightRegex)) {
				fontWeight = `font-weight: ${font.weight};`;
			} else {
				warnings.push(nls.localize('error.fontWeight', 'Invalid font weight in font \'{0}\'. Ignoring setting.', font.id));
			}

			let fontStyle = '';
			if (isString(font.style) && font.style.match(fontStyleRegex)) {
				fontStyle = `font-style: ${font.style};`;
			} else {
				warnings.push(nls.localize('error.fontStyle', 'Invalid font style in font \'{0}\'. Ignoring setting.', font.id));
			}

			cssRules.push(`@font-face { src: ${src}; font-family: '${fontId}';${fontWeight}${fontStyle} }`);
		} else {
			warnings.push(nls.localize('error.fontId', 'Missing or invalid font id \'{0}\'. Skipping font definition.', font.id));
		}
	}

	const primaryFontId = fonts.length > 0 ? fontIdMapping[fonts[0].id] : '';

	const iconDefinitions = iconThemeDocument.iconDefinitions;
	const iconRegistry = getIconRegistry();


	for (let iconContribution of iconRegistry.getIcons()) {
		const iconId = iconContribution.id;

		let definition = iconDefinitions[iconId];

		// look if an inherited icon has a definition
		while (!definition && ThemeIcon.isThemeIcon(iconContribution.defaults)) {
			const ic = iconRegistry.getIcon(iconContribution.defaults.id);
			if (ic) {
				definition = iconDefinitions[ic.id];
				iconContribution = ic;
			} else {
				break;
			}
		}

		if (definition) {
			if (isString(definition.fontCharacter)) {
				const fontId = definition.fontId !== undefined ? fontIdMapping[definition.fontId] : primaryFontId;
				if (fontId) {
					cssRules.push(`.codicon-${iconId}:before { content: '${definition.fontCharacter}' !important; font-family: ${fontId} !important; }`);
				} else {
					warnings.push(nls.localize('error.icon.fontId', 'Skipping icon definition \'{0}\'. Unknown font.', iconId));
				}
			} else {
				warnings.push(nls.localize('error.icon.fontCharacter', 'Skipping icon definition \'{0}\'. Unknown fontCharacter.', iconId));
			}
		}
	}
	result.content = cssRules.join('\n');
	return result;
}

