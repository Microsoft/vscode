/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationPropertySchema, IConfigurationNode } from 'vs/platform/configuration/common/configurationRegistry';

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { textmateColorsSchemaId, textmateColorGroupSchemaId } from 'vs/workbench/services/themes/common/colorThemeSchema';
import { workbenchColorsSchemaId } from 'vs/platform/theme/common/colorRegistry';
import { tokenStylingSchemaId } from 'vs/platform/theme/common/tokenClassificationRegistry';
import { ThemeSettings, IWorkbenchColorTheme, IWorkbenchFileIconTheme, IColorCustomizations, ITokenColorCustomizations, IWorkbenchProductIconTheme, ISemanticTokenColorCustomizations, IExperimentalSemanticTokenColorCustomizations } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { ThemeType, HIGH_CONTRAST, LIGHT } from 'vs/platform/theme/common/themeService';

const DEFAULT_THEME_DARK_SETTING_VALUE = 'Default Dark+';
const DEFAULT_THEME_LIGHT_SETTING_VALUE = 'Default Light+';
const DEFAULT_THEME_HC_SETTING_VALUE = 'Default High Contrast';

const DEFAULT_FILE_ICON_THEME_SETTING_VALUE = 'vs-seti';

export const DEFAULT_PRODUCT_ICON_THEME_SETTING_VALUE = 'Default';

// Configuration: Themes
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

const colorThemeSettingEnum: string[] = [];
const colorThemeSettingEnumDescriptions: string[] = [];

const colorThemeSettingSchema: IConfigurationPropertySchema = {
	type: 'string',
	description: nls.localize('colorTheme', "Specifies the color theme used in the workbench."),
	default: DEFAULT_THEME_DARK_SETTING_VALUE,
	enum: colorThemeSettingEnum,
	enumDescriptions: colorThemeSettingEnumDescriptions,
	errorMessage: nls.localize('colorThemeError', "Theme is unknown or not installed."),
};
const preferredDarkThemeSettingSchema: IConfigurationPropertySchema = {
	type: 'string',
	description: nls.localize('preferredDarkColorTheme', 'Specifies the preferred color theme for dark OS appearance when \'{0}\' is enabled.', ThemeSettings.DETECT_COLOR_SCHEME),
	default: DEFAULT_THEME_DARK_SETTING_VALUE,
	enum: colorThemeSettingEnum,
	enumDescriptions: colorThemeSettingEnumDescriptions,
	errorMessage: nls.localize('colorThemeError', "Theme is unknown or not installed."),
};
const preferredLightThemeSettingSchema: IConfigurationPropertySchema = {
	type: 'string',
	description: nls.localize('preferredLightColorTheme', 'Specifies the preferred color theme for light OS appearance when \'{0}\' is enabled.', ThemeSettings.DETECT_COLOR_SCHEME),
	default: DEFAULT_THEME_LIGHT_SETTING_VALUE,
	enum: colorThemeSettingEnum,
	enumDescriptions: colorThemeSettingEnumDescriptions,
	errorMessage: nls.localize('colorThemeError', "Theme is unknown or not installed."),
};
const preferredHCThemeSettingSchema: IConfigurationPropertySchema = {
	type: 'string',
	description: nls.localize('preferredHCColorTheme', 'Specifies the preferred color theme used in high contrast mode when \'{0}\' is enabled.', ThemeSettings.DETECT_HC),
	default: DEFAULT_THEME_HC_SETTING_VALUE,
	enum: colorThemeSettingEnum,
	enumDescriptions: colorThemeSettingEnumDescriptions,
	errorMessage: nls.localize('colorThemeError', "Theme is unknown or not installed."),
};
const detectColorSchemeSettingSchema: IConfigurationPropertySchema = {
	type: 'boolean',
	description: nls.localize('detectColorScheme', 'If set, automatically switch to the preferred color theme based on the OS appearance.'),
	default: false
};

const colorCustomizationsSchema: IConfigurationPropertySchema = {
	type: 'object',
	description: nls.localize('workbenchColors', "Overrides colors from the currently selected color theme."),
	allOf: [{ $ref: workbenchColorsSchemaId }],
	default: {},
	defaultSnippets: [{
		body: {
		}
	}]
};
const fileIconThemeSettingSchema: IConfigurationPropertySchema = {
	type: ['string', 'null'],
	default: DEFAULT_FILE_ICON_THEME_SETTING_VALUE,
	description: nls.localize('iconTheme', "Specifies the file icon theme used in the workbench or 'null' to not show any file icons."),
	enum: [null],
	enumDescriptions: [nls.localize('noIconThemeDesc', 'No file icons')],
	errorMessage: nls.localize('iconThemeError', "File icon theme is unknown or not installed.")
};
const productIconThemeSettingSchema: IConfigurationPropertySchema = {
	type: ['string', 'null'],
	default: DEFAULT_PRODUCT_ICON_THEME_SETTING_VALUE,
	description: nls.localize('productIconTheme', "Specifies the product icon theme used."),
	enum: [DEFAULT_PRODUCT_ICON_THEME_SETTING_VALUE],
	enumDescriptions: [nls.localize('defaultProductIconThemeDesc', 'Default')],
	errorMessage: nls.localize('productIconThemeError', "Product icon theme is unknown or not installed.")
};

const themeSettingsConfiguration: IConfigurationNode = {
	id: 'workbench',
	order: 7.1,
	type: 'object',
	properties: {
		[ThemeSettings.COLOR_THEME]: colorThemeSettingSchema,
		[ThemeSettings.PREFERRED_DARK_THEME]: preferredDarkThemeSettingSchema,
		[ThemeSettings.PREFERRED_LIGHT_THEME]: preferredLightThemeSettingSchema,
		[ThemeSettings.PREFERRED_HC_THEME]: preferredHCThemeSettingSchema,
		[ThemeSettings.DETECT_COLOR_SCHEME]: detectColorSchemeSettingSchema,
		[ThemeSettings.FILE_ICON_THEME]: fileIconThemeSettingSchema,
		[ThemeSettings.COLOR_CUSTOMIZATIONS]: colorCustomizationsSchema,
		[ThemeSettings.PRODUCT_ICON_THEME]: productIconThemeSettingSchema
	}
};

function tokenGroupSettings(description: string): IJSONSchema {
	return {
		description,
		$ref: textmateColorGroupSchemaId
	};
}

const tokenColorSchema: IJSONSchema = {
	properties: {
		comments: tokenGroupSettings(nls.localize('editorColors.comments', "Sets the colors and styles for comments")),
		strings: tokenGroupSettings(nls.localize('editorColors.strings', "Sets the colors and styles for strings literals.")),
		keywords: tokenGroupSettings(nls.localize('editorColors.keywords', "Sets the colors and styles for keywords.")),
		numbers: tokenGroupSettings(nls.localize('editorColors.numbers', "Sets the colors and styles for number literals.")),
		types: tokenGroupSettings(nls.localize('editorColors.types', "Sets the colors and styles for type declarations and references.")),
		functions: tokenGroupSettings(nls.localize('editorColors.functions', "Sets the colors and styles for functions declarations and references.")),
		variables: tokenGroupSettings(nls.localize('editorColors.variables', "Sets the colors and styles for variables declarations and references.")),
		textMateRules: {
			description: nls.localize('editorColors.textMateRules', 'Sets colors and styles using textmate theming rules (advanced).'),
			$ref: textmateColorsSchemaId
		},
		semanticHighlighting: {
			description: nls.localize('editorColors.semanticHighlighting', 'Whether semantic highlighting should be enabled for this theme.'),
			deprecationMessage: nls.localize('editorColors.semanticHighlighting.deprecationMessage', 'Use `enabled` in `editor.semanticTokenColorCustomizations` setting instead.'),
			type: 'boolean'
		}
	}
};

const tokenColorCustomizationSchema: IConfigurationPropertySchema = {
	description: nls.localize('editorColors', "Overrides editor syntax colors and font style from the currently selected color theme."),
	default: {},
	allOf: [tokenColorSchema]
};

const semanticTokenColorSchema: IJSONSchema = {
	type: 'object',
	properties: {
		enabled: {
			type: 'boolean',
			description: nls.localize('editorColors.semanticHighlighting.enabled', 'Whether semantic highlighting is enabled or disabled for this theme'),
			suggestSortText: '0_enabled'
		},
		rules: {
			$ref: tokenStylingSchemaId,
			description: nls.localize('editorColors.semanticHighlighting.rules', 'Semantic token styling rules for this theme.'),
			suggestSortText: '0_rules'
		}
	},
	additionalProperties: false
};

const semanticTokenColorCustomizationSchema: IConfigurationPropertySchema = {
	description: nls.localize('semanticTokenColors', "Overrides editor semantic token color and styles from the currently selected color theme."),
	default: {},
	allOf: [{ ...semanticTokenColorSchema, patternProperties: { '^\\[': {} } }]
};

const experimentalTokenStylingCustomizationSchema: IConfigurationPropertySchema = {
	deprecationMessage: nls.localize('editorColors.experimentalTokenStyling.deprecationMessage', 'Use `editor.semanticTokenColorCustomizations` instead.'),
	default: {},
	allOf: [{ $ref: tokenStylingSchemaId }],
};
const tokenColorCustomizationConfiguration: IConfigurationNode = {
	id: 'editor',
	order: 7.2,
	type: 'object',
	properties: {
		[ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS]: tokenColorCustomizationSchema,
		[ThemeSettings.SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS]: semanticTokenColorCustomizationSchema,
		[ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS_EXPERIMENTAL]: experimentalTokenStylingCustomizationSchema
	}
};

configurationRegistry.registerConfiguration(tokenColorCustomizationConfiguration);

export function updateColorThemeConfigurationSchemas(themes: IWorkbenchColorTheme[]) {
	// updates enum for the 'workbench.colorTheme` setting
	colorThemeSettingEnum.splice(0, colorThemeSettingEnum.length, ...themes.map(t => t.settingsId));
	colorThemeSettingEnumDescriptions.splice(0, colorThemeSettingEnumDescriptions.length, ...themes.map(t => t.description || ''));

	const themeSpecificWorkbenchColors: IJSONSchema = { properties: {} };
	const themeSpecificTokenColors: IJSONSchema = { properties: {} };
	const themeSpecificSemanticTokenColors: IJSONSchema = { properties: {} };
	const experimentalThemeSpecificSemanticTokenColors: IJSONSchema = { properties: {} };

	const workbenchColors = { $ref: workbenchColorsSchemaId, additionalProperties: false };
	const tokenColors = { properties: tokenColorSchema.properties, additionalProperties: false };
	for (let t of themes) {
		// add theme specific color customization ("[Abyss]":{ ... })
		const themeId = `[${t.settingsId}]`;
		themeSpecificWorkbenchColors.properties![themeId] = workbenchColors;
		themeSpecificTokenColors.properties![themeId] = tokenColors;
		themeSpecificSemanticTokenColors.properties![themeId] = semanticTokenColorSchema;
		experimentalThemeSpecificSemanticTokenColors.properties![themeId] = { $ref: tokenStylingSchemaId, additionalProperties: false };
	}

	colorCustomizationsSchema.allOf![1] = themeSpecificWorkbenchColors;
	tokenColorCustomizationSchema.allOf![1] = themeSpecificTokenColors;
	semanticTokenColorCustomizationSchema.allOf![1] = themeSpecificSemanticTokenColors;
	experimentalTokenStylingCustomizationSchema.allOf![1] = experimentalThemeSpecificSemanticTokenColors;

	configurationRegistry.notifyConfigurationSchemaUpdated(themeSettingsConfiguration, tokenColorCustomizationConfiguration);
}

export function updateFileIconThemeConfigurationSchemas(themes: IWorkbenchFileIconTheme[]) {
	fileIconThemeSettingSchema.enum!.splice(1, Number.MAX_VALUE, ...themes.map(t => t.settingsId));
	fileIconThemeSettingSchema.enumDescriptions!.splice(1, Number.MAX_VALUE, ...themes.map(t => t.description || ''));

	configurationRegistry.notifyConfigurationSchemaUpdated(themeSettingsConfiguration);
}

export function updateProductIconThemeConfigurationSchemas(themes: IWorkbenchProductIconTheme[]) {
	productIconThemeSettingSchema.enum!.splice(1, Number.MAX_VALUE, ...themes.map(t => t.settingsId));
	productIconThemeSettingSchema.enumDescriptions!.splice(1, Number.MAX_VALUE, ...themes.map(t => t.description || ''));

	configurationRegistry.notifyConfigurationSchemaUpdated(themeSettingsConfiguration);
}


export class ThemeConfiguration {
	constructor(private configurationService: IConfigurationService, themeType: ThemeType) {
		switch (themeType) {
			case LIGHT:
				colorThemeSettingSchema.default = DEFAULT_THEME_LIGHT_SETTING_VALUE;
				break;
			case HIGH_CONTRAST:
				colorThemeSettingSchema.default = DEFAULT_THEME_HC_SETTING_VALUE;
				break;
			default:
				colorThemeSettingSchema.default = DEFAULT_THEME_DARK_SETTING_VALUE;
				break;
		}
		configurationRegistry.registerConfiguration(themeSettingsConfiguration);
	}

	public get colorTheme(): string {
		return this.configurationService.getValue<string>(ThemeSettings.COLOR_THEME);
	}

	public get fileIconTheme(): string | null {
		return this.configurationService.getValue<string | null>(ThemeSettings.FILE_ICON_THEME);
	}

	public get productIconTheme(): string {
		return this.configurationService.getValue<string>(ThemeSettings.PRODUCT_ICON_THEME);
	}

	public get colorCustomizations(): IColorCustomizations {
		return this.configurationService.getValue<IColorCustomizations>(ThemeSettings.COLOR_CUSTOMIZATIONS) || {};
	}

	public get tokenColorCustomizations(): ITokenColorCustomizations {
		return this.configurationService.getValue<ITokenColorCustomizations>(ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS) || {};
	}

	public get semanticTokenColorCustomizations(): ISemanticTokenColorCustomizations | undefined {
		return this.configurationService.getValue<ISemanticTokenColorCustomizations>(ThemeSettings.SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS);
	}

	public get experimentalSemanticTokenColorCustomizations(): IExperimentalSemanticTokenColorCustomizations | undefined {
		return this.configurationService.getValue<IExperimentalSemanticTokenColorCustomizations>(ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS_EXPERIMENTAL);
	}

	public async setColorTheme(theme: IWorkbenchColorTheme, settingsTarget: ConfigurationTarget | undefined | 'auto'): Promise<IWorkbenchColorTheme> {
		await this.writeConfiguration(ThemeSettings.COLOR_THEME, theme.settingsId, settingsTarget);
		return theme;
	}

	public async setFileIconTheme(theme: IWorkbenchFileIconTheme, settingsTarget: ConfigurationTarget | undefined | 'auto'): Promise<IWorkbenchFileIconTheme> {
		await this.writeConfiguration(ThemeSettings.FILE_ICON_THEME, theme.settingsId, settingsTarget);
		return theme;
	}

	public async setProductIconTheme(theme: IWorkbenchProductIconTheme, settingsTarget: ConfigurationTarget | undefined | 'auto'): Promise<IWorkbenchProductIconTheme> {
		await this.writeConfiguration(ThemeSettings.PRODUCT_ICON_THEME, theme.settingsId, settingsTarget);
		return theme;
	}

	private async writeConfiguration(key: string, value: any, settingsTarget: ConfigurationTarget | 'auto' | undefined): Promise<void> {
		if (settingsTarget === undefined) {
			return;
		}

		let settings = this.configurationService.inspect(key);
		if (settingsTarget === 'auto') {
			if (!types.isUndefined(settings.workspaceFolderValue)) {
				settingsTarget = ConfigurationTarget.WORKSPACE_FOLDER;
			} else if (!types.isUndefined(settings.workspaceValue)) {
				settingsTarget = ConfigurationTarget.WORKSPACE;
			} else if (!types.isUndefined(settings.userRemote)) {
				settingsTarget = ConfigurationTarget.USER_REMOTE;
			} else {
				settingsTarget = ConfigurationTarget.USER;
			}
		}

		if (settingsTarget === ConfigurationTarget.USER) {
			if (value === settings.userValue) {
				return Promise.resolve(undefined); // nothing to do
			} else if (value === settings.defaultValue) {
				if (types.isUndefined(settings.userValue)) {
					return Promise.resolve(undefined); // nothing to do
				}
				value = undefined; // remove configuration from user settings
			}
		} else if (settingsTarget === ConfigurationTarget.WORKSPACE || settingsTarget === ConfigurationTarget.WORKSPACE_FOLDER || settingsTarget === ConfigurationTarget.USER_REMOTE) {
			if (value === settings.value) {
				return Promise.resolve(undefined); // nothing to do
			}
		}
		return this.configurationService.updateValue(key, value, settingsTarget);
	}
}
