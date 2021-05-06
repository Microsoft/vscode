/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchThemeService, IWorkbenchColorTheme, IWorkbenchFileIconTheme, ExtensionData, VS_LIGHT_THEME, VS_DARK_THEME, VS_HC_THEME, ThemeSettings, IWorkbenchProductIconTheme, ThemeSettingTarget } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Registry } from 'vs/platform/registry/common/platform';
import * as errors from 'vs/base/common/errors';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { ColorThemeData } from 'vs/workbench/services/themes/common/colorThemeData';
import { IColorTheme, Extensions as ThemingExtensions, IThemingRegistry } from 'vs/platform/theme/common/themeService';
import { Event, Emitter } from 'vs/base/common/event';
import { registerFileIconThemeSchemas } from 'vs/workbench/services/themes/common/fileIconThemeSchema';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { FileIconThemeData } from 'vs/workbench/services/themes/browser/fileIconThemeData';
import { createStyleSheet } from 'vs/base/browser/dom';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IFileService, FileChangeType } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import * as resources from 'vs/base/common/resources';
import { registerColorThemeSchemas } from 'vs/workbench/services/themes/common/colorThemeSchema';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
import { ThemeRegistry, registerColorThemeExtensionPoint, registerFileIconThemeExtensionPoint, registerProductIconThemeExtensionPoint } from 'vs/workbench/services/themes/common/themeExtensionPoints';
import { updateColorThemeConfigurationSchemas, updateFileIconThemeConfigurationSchemas, ThemeConfiguration, updateProductIconThemeConfigurationSchemas } from 'vs/workbench/services/themes/common/themeConfiguration';
import { ProductIconThemeData, DEFAULT_PRODUCT_ICON_THEME_ID } from 'vs/workbench/services/themes/browser/productIconThemeData';
import { registerProductIconThemeSchemas } from 'vs/workbench/services/themes/common/productIconThemeSchema';
import { ILogService } from 'vs/platform/log/common/log';
import { isWeb } from 'vs/base/common/platform';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { IHostColorSchemeService } from 'vs/workbench/services/themes/common/hostColorSchemeService';
import { RunOnceScheduler, Sequencer } from 'vs/base/common/async';
import { IUserDataInitializationService } from 'vs/workbench/services/userData/browser/userDataInit';
import { getIconsStyleSheet } from 'vs/platform/theme/browser/iconsStyleSheet';

// implementation

const DEFAULT_COLOR_THEME_ID = 'vs-dark vscode-theme-defaults-themes-dark_plus-json';
const DEFAULT_LIGHT_COLOR_THEME_ID = 'vs vscode-theme-defaults-themes-light_plus-json';

const PERSISTED_OS_COLOR_SCHEME = 'osColorScheme';

const defaultThemeExtensionId = 'vscode-theme-defaults';
const oldDefaultThemeExtensionId = 'vscode-theme-colorful-defaults';

const DEFAULT_FILE_ICON_THEME_ID = 'vscode.vscode-theme-seti-vs-seti';
const fileIconsEnabledClass = 'file-icons-enabled';

const colorThemeRulesClassName = 'contributedColorTheme';
const fileIconThemeRulesClassName = 'contributedFileIconTheme';
const productIconThemeRulesClassName = 'contributedProductIconTheme';

const themingRegistry = Registry.as<IThemingRegistry>(ThemingExtensions.ThemingContribution);

function validateThemeId(theme: string): string {
	// migrations
	switch (theme) {
		case VS_LIGHT_THEME: return `vs ${defaultThemeExtensionId}-themes-light_vs-json`;
		case VS_DARK_THEME: return `vs-dark ${defaultThemeExtensionId}-themes-dark_vs-json`;
		case VS_HC_THEME: return `hc-black ${defaultThemeExtensionId}-themes-hc_black-json`;
		case `vs ${oldDefaultThemeExtensionId}-themes-light_plus-tmTheme`: return `vs ${defaultThemeExtensionId}-themes-light_plus-json`;
		case `vs-dark ${oldDefaultThemeExtensionId}-themes-dark_plus-tmTheme`: return `vs-dark ${defaultThemeExtensionId}-themes-dark_plus-json`;
	}
	return theme;
}

const colorThemesExtPoint = registerColorThemeExtensionPoint();
const fileIconThemesExtPoint = registerFileIconThemeExtensionPoint();
const productIconThemesExtPoint = registerProductIconThemeExtensionPoint();

export class WorkbenchThemeService implements IWorkbenchThemeService {
	declare readonly _serviceBrand: undefined;

	private readonly container: HTMLElement;
	private settings: ThemeConfiguration;

	private readonly colorThemeRegistry: ThemeRegistry<ColorThemeData>;
	private currentColorTheme: ColorThemeData;
	private readonly onColorThemeChange: Emitter<IWorkbenchColorTheme>;
	private readonly colorThemeWatcher: ThemeFileWatcher;
	private colorThemingParticipantChangeListener: IDisposable | undefined;
	private readonly colorThemeSequencer: Sequencer;

	private readonly fileIconThemeRegistry: ThemeRegistry<FileIconThemeData>;
	private currentFileIconTheme: FileIconThemeData;
	private readonly onFileIconThemeChange: Emitter<IWorkbenchFileIconTheme>;
	private readonly fileIconThemeWatcher: ThemeFileWatcher;
	private readonly fileIconThemeSequencer: Sequencer;

	private readonly productIconThemeRegistry: ThemeRegistry<ProductIconThemeData>;
	private currentProductIconTheme: ProductIconThemeData;
	private readonly onProductIconThemeChange: Emitter<IWorkbenchProductIconTheme>;
	private readonly productIconThemeWatcher: ThemeFileWatcher;
	private readonly productIconThemeSequencer: Sequencer;

	private themeSettingIdBeforeSchemeSwitch: string | undefined;

	constructor(
		@IExtensionService extensionService: IExtensionService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkbenchEnvironmentService readonly environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IExtensionResourceLoaderService private readonly extensionResourceLoaderService: IExtensionResourceLoaderService,
		@IWorkbenchLayoutService readonly layoutService: IWorkbenchLayoutService,
		@ILogService private readonly logService: ILogService,
		@IHostColorSchemeService private readonly hostColorService: IHostColorSchemeService,
		@IUserDataInitializationService readonly userDataInitializationService: IUserDataInitializationService
	) {
		this.container = layoutService.container;
		this.settings = new ThemeConfiguration(configurationService);

		this.colorThemeRegistry = new ThemeRegistry(colorThemesExtPoint, ColorThemeData.fromExtensionTheme);
		this.colorThemeWatcher = new ThemeFileWatcher(fileService, environmentService, this.reloadCurrentColorTheme.bind(this));
		this.onColorThemeChange = new Emitter<IWorkbenchColorTheme>({ leakWarningThreshold: 400 });
		this.currentColorTheme = ColorThemeData.createUnloadedTheme('');
		this.colorThemeSequencer = new Sequencer();

		this.fileIconThemeWatcher = new ThemeFileWatcher(fileService, environmentService, this.reloadCurrentFileIconTheme.bind(this));
		this.fileIconThemeRegistry = new ThemeRegistry(fileIconThemesExtPoint, FileIconThemeData.fromExtensionTheme, true, FileIconThemeData.noIconTheme);
		this.onFileIconThemeChange = new Emitter<IWorkbenchFileIconTheme>();
		this.currentFileIconTheme = FileIconThemeData.createUnloadedTheme('');
		this.fileIconThemeSequencer = new Sequencer();

		this.productIconThemeWatcher = new ThemeFileWatcher(fileService, environmentService, this.reloadCurrentProductIconTheme.bind(this));
		this.productIconThemeRegistry = new ThemeRegistry(productIconThemesExtPoint, ProductIconThemeData.fromExtensionTheme, true, ProductIconThemeData.defaultTheme);
		this.onProductIconThemeChange = new Emitter<IWorkbenchProductIconTheme>();
		this.currentProductIconTheme = ProductIconThemeData.createUnloadedTheme('');
		this.productIconThemeSequencer = new Sequencer();

		// In order to avoid paint flashing for tokens, because
		// themes are loaded asynchronously, we need to initialize
		// a color theme document with good defaults until the theme is loaded
		let themeData: ColorThemeData | undefined = ColorThemeData.fromStorageData(this.storageService);
		if (themeData && this.settings.colorTheme !== themeData.settingsId && this.settings.isDefaultColorTheme()) {
			// the web has different defaults than the desktop, therefore do not restore when the setting is the default theme and the storage doesn't match that.
			themeData = undefined;
		}

		// the preferred color scheme (high contrast, light, dark) has changed since the last start
		const preferredColorScheme = this.getPreferredColorScheme();

		if (preferredColorScheme && themeData?.type !== preferredColorScheme && this.storageService.get(PERSISTED_OS_COLOR_SCHEME, StorageScope.GLOBAL) !== preferredColorScheme) {
			themeData = ColorThemeData.createUnloadedThemeForThemeType(preferredColorScheme);
		}
		if (!themeData) {
			const initialColorTheme = environmentService.options?.initialColorTheme;
			if (initialColorTheme) {
				themeData = ColorThemeData.createUnloadedThemeForThemeType(initialColorTheme.themeType, initialColorTheme.colors);
			}
		}
		if (!themeData) {
			themeData = ColorThemeData.createUnloadedThemeForThemeType(isWeb ? ColorScheme.LIGHT : ColorScheme.DARK);
		}
		themeData.setCustomizations(this.settings);
		this.applyTheme(themeData, undefined, true);

		const fileIconData = FileIconThemeData.fromStorageData(this.storageService);
		if (fileIconData) {
			this.applyAndSetFileIconTheme(fileIconData, true);
		}

		const productIconData = ProductIconThemeData.fromStorageData(this.storageService);
		if (productIconData) {
			this.applyAndSetProductIconTheme(productIconData, true);
		}

		Promise.all([extensionService.whenInstalledExtensionsRegistered(), userDataInitializationService.whenInitializationFinished()]).then(_ => {
			this.installConfigurationListener();
			this.installPreferredSchemeListener();
			this.installRegistryListeners();
			this.initialize().catch(errors.onUnexpectedError);
		});

		const codiconStyleSheet = createStyleSheet();
		codiconStyleSheet.id = 'codiconStyles';

		const iconsStyleSheet = getIconsStyleSheet();
		function updateAll() {
			codiconStyleSheet.textContent = iconsStyleSheet.getCSS();
		}

		const delayer = new RunOnceScheduler(updateAll, 0);
		iconsStyleSheet.onDidChange(() => delayer.schedule());
		delayer.schedule();
	}

	private initialize(): Promise<[IWorkbenchColorTheme | null, IWorkbenchFileIconTheme | null, IWorkbenchProductIconTheme | null]> {
		const extDevLocs = this.environmentService.extensionDevelopmentLocationURI;
		const extDevLoc = extDevLocs && extDevLocs.length === 1 ? extDevLocs[0] : undefined; // in dev mode, switch to a theme provided by the extension under dev.

		const initializeColorTheme = async () => {
			const devThemes = this.colorThemeRegistry.findThemeByExtensionLocation(extDevLoc);
			if (devThemes.length) {
				return this.setColorTheme(devThemes[0].id, ConfigurationTarget.MEMORY);
			}
			const fallbackTheme = this.currentColorTheme.type === ColorScheme.LIGHT ? DEFAULT_LIGHT_COLOR_THEME_ID : DEFAULT_COLOR_THEME_ID;
			const theme = this.colorThemeRegistry.findThemeBySettingsId(this.settings.colorTheme, fallbackTheme);

			const preferredColorScheme = this.getPreferredColorScheme();
			const prevScheme = this.storageService.get(PERSISTED_OS_COLOR_SCHEME, StorageScope.GLOBAL);
			if (preferredColorScheme !== prevScheme) {
				this.storageService.store(PERSISTED_OS_COLOR_SCHEME, preferredColorScheme, StorageScope.GLOBAL, StorageTarget.USER);
				if (preferredColorScheme && theme?.type !== preferredColorScheme) {
					return this.applyPreferredColorTheme(preferredColorScheme);
				}
			}
			return this.setColorTheme(theme && theme.id, undefined);
		};

		const initializeFileIconTheme = async () => {
			const devThemes = this.fileIconThemeRegistry.findThemeByExtensionLocation(extDevLoc);
			if (devThemes.length) {
				return this.setFileIconTheme(devThemes[0].id, ConfigurationTarget.MEMORY);
			}
			const theme = this.fileIconThemeRegistry.findThemeBySettingsId(this.settings.fileIconTheme);
			return this.setFileIconTheme(theme ? theme.id : DEFAULT_FILE_ICON_THEME_ID, undefined);
		};

		const initializeProductIconTheme = async () => {
			const devThemes = this.productIconThemeRegistry.findThemeByExtensionLocation(extDevLoc);
			if (devThemes.length) {
				return this.setProductIconTheme(devThemes[0].id, ConfigurationTarget.MEMORY);
			}
			const theme = this.productIconThemeRegistry.findThemeBySettingsId(this.settings.productIconTheme);
			return this.setProductIconTheme(theme ? theme.id : DEFAULT_PRODUCT_ICON_THEME_ID, undefined);
		};


		return Promise.all([initializeColorTheme(), initializeFileIconTheme(), initializeProductIconTheme()]);
	}

	private installConfigurationListener() {
		this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ThemeSettings.COLOR_THEME)) {
				this.restoreColorTheme();
			}
			if (e.affectsConfiguration(ThemeSettings.DETECT_COLOR_SCHEME) || e.affectsConfiguration(ThemeSettings.DETECT_HC)) {
				this.handlePreferredSchemeUpdated();
			}
			if (e.affectsConfiguration(ThemeSettings.PREFERRED_DARK_THEME) && this.getPreferredColorScheme() === ColorScheme.DARK) {
				this.applyPreferredColorTheme(ColorScheme.DARK);
			}
			if (e.affectsConfiguration(ThemeSettings.PREFERRED_LIGHT_THEME) && this.getPreferredColorScheme() === ColorScheme.LIGHT) {
				this.applyPreferredColorTheme(ColorScheme.LIGHT);
			}
			if (e.affectsConfiguration(ThemeSettings.PREFERRED_HC_THEME) && this.getPreferredColorScheme() === ColorScheme.HIGH_CONTRAST) {
				this.applyPreferredColorTheme(ColorScheme.HIGH_CONTRAST);
			}
			if (e.affectsConfiguration(ThemeSettings.FILE_ICON_THEME)) {
				this.restoreFileIconTheme();
			}
			if (e.affectsConfiguration(ThemeSettings.PRODUCT_ICON_THEME)) {
				this.restoreProductIconTheme();
			}
			if (this.currentColorTheme) {
				let hasColorChanges = false;
				if (e.affectsConfiguration(ThemeSettings.COLOR_CUSTOMIZATIONS)) {
					this.currentColorTheme.setCustomColors(this.settings.colorCustomizations);
					hasColorChanges = true;
				}
				if (e.affectsConfiguration(ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS)) {
					this.currentColorTheme.setCustomTokenColors(this.settings.tokenColorCustomizations);
					hasColorChanges = true;
				}
				if (e.affectsConfiguration(ThemeSettings.SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS) || e.affectsConfiguration(ThemeSettings.TOKEN_COLOR_CUSTOMIZATIONS_EXPERIMENTAL)) {
					this.currentColorTheme.setCustomSemanticTokenColors(this.settings.semanticTokenColorCustomizations, this.settings.experimentalSemanticTokenColorCustomizations);
					hasColorChanges = true;
				}
				if (hasColorChanges) {
					this.updateDynamicCSSRules(this.currentColorTheme);
					this.onColorThemeChange.fire(this.currentColorTheme);
				}
			}
		});
	}

	private installRegistryListeners(): Promise<any> {

		let prevColorId: string | undefined = undefined;

		// update settings schema setting for theme specific settings
		this.colorThemeRegistry.onDidChange(async event => {
			updateColorThemeConfigurationSchemas(event.themes);
			if (await this.restoreColorTheme()) { // checks if theme from settings exists and is set
				// restore theme
				if (this.currentColorTheme.id === DEFAULT_COLOR_THEME_ID && !types.isUndefined(prevColorId) && await this.colorThemeRegistry.findThemeById(prevColorId)) {
					// restore theme
					this.setColorTheme(prevColorId, 'auto');
					prevColorId = undefined;
				} else if (event.added.some(t => t.settingsId === this.currentColorTheme.settingsId)) {
					this.reloadCurrentColorTheme();
				}
			} else if (event.removed.some(t => t.settingsId === this.currentColorTheme.settingsId)) {
				// current theme is no longer available
				prevColorId = this.currentColorTheme.id;
				this.setColorTheme(DEFAULT_COLOR_THEME_ID, 'auto');
			}
		});

		let prevFileIconId: string | undefined = undefined;
		this.fileIconThemeRegistry.onDidChange(async event => {
			updateFileIconThemeConfigurationSchemas(event.themes);
			if (await this.restoreFileIconTheme()) { // checks if theme from settings exists and is set
				// restore theme
				if (this.currentFileIconTheme.id === DEFAULT_FILE_ICON_THEME_ID && !types.isUndefined(prevFileIconId) && this.fileIconThemeRegistry.findThemeById(prevFileIconId)) {
					this.setFileIconTheme(prevFileIconId, 'auto');
					prevFileIconId = undefined;
				} else if (event.added.some(t => t.settingsId === this.currentFileIconTheme.settingsId)) {
					this.reloadCurrentFileIconTheme();
				}
			} else if (event.removed.some(t => t.settingsId === this.currentFileIconTheme.settingsId)) {
				// current theme is no longer available
				prevFileIconId = this.currentFileIconTheme.id;
				this.setFileIconTheme(DEFAULT_FILE_ICON_THEME_ID, 'auto');
			}

		});

		let prevProductIconId: string | undefined = undefined;
		this.productIconThemeRegistry.onDidChange(async event => {
			updateProductIconThemeConfigurationSchemas(event.themes);
			if (await this.restoreProductIconTheme()) { // checks if theme from settings exists and is set
				// restore theme
				if (this.currentProductIconTheme.id === DEFAULT_PRODUCT_ICON_THEME_ID && !types.isUndefined(prevProductIconId) && this.productIconThemeRegistry.findThemeById(prevProductIconId)) {
					this.setProductIconTheme(prevProductIconId, 'auto');
					prevProductIconId = undefined;
				} else if (event.added.some(t => t.settingsId === this.currentProductIconTheme.settingsId)) {
					this.reloadCurrentProductIconTheme();
				}
			} else if (event.removed.some(t => t.settingsId === this.currentProductIconTheme.settingsId)) {
				// current theme is no longer available
				prevProductIconId = this.currentProductIconTheme.id;
				this.setProductIconTheme(DEFAULT_PRODUCT_ICON_THEME_ID, 'auto');
			}
		});

		return Promise.all([this.getColorThemes(), this.getFileIconThemes(), this.getProductIconThemes()]).then(([ct, fit, pit]) => {
			updateColorThemeConfigurationSchemas(ct);
			updateFileIconThemeConfigurationSchemas(fit);
			updateProductIconThemeConfigurationSchemas(pit);
		});
	}


	// preferred scheme handling

	private installPreferredSchemeListener() {
		this.hostColorService.onDidChangeColorScheme(() => this.handlePreferredSchemeUpdated());
	}

	private async handlePreferredSchemeUpdated() {
		const scheme = this.getPreferredColorScheme();
		const prevScheme = this.storageService.get(PERSISTED_OS_COLOR_SCHEME, StorageScope.GLOBAL);
		if (scheme !== prevScheme) {
			this.storageService.store(PERSISTED_OS_COLOR_SCHEME, scheme, StorageScope.GLOBAL, StorageTarget.MACHINE);
			if (scheme) {
				if (!prevScheme) {
					// remember the theme before scheme switching
					this.themeSettingIdBeforeSchemeSwitch = this.settings.colorTheme;
				}
				return this.applyPreferredColorTheme(scheme);
			} else if (prevScheme && this.themeSettingIdBeforeSchemeSwitch) {
				// reapply the theme before scheme switching
				const theme = this.colorThemeRegistry.findThemeBySettingsId(this.themeSettingIdBeforeSchemeSwitch, undefined);
				if (theme) {
					this.setColorTheme(theme.id, 'auto');
				}
			}
		}
		return undefined;
	}

	private getPreferredColorScheme(): ColorScheme | undefined {
		if (this.configurationService.getValue<boolean>(ThemeSettings.DETECT_HC) && this.hostColorService.highContrast) {
			return ColorScheme.HIGH_CONTRAST;
		}
		if (this.configurationService.getValue<boolean>(ThemeSettings.DETECT_COLOR_SCHEME)) {
			return this.hostColorService.dark ? ColorScheme.DARK : ColorScheme.LIGHT;
		}
		return undefined;
	}

	private async applyPreferredColorTheme(type: ColorScheme): Promise<IWorkbenchColorTheme | null> {
		const settingId = type === ColorScheme.DARK ? ThemeSettings.PREFERRED_DARK_THEME : type === ColorScheme.LIGHT ? ThemeSettings.PREFERRED_LIGHT_THEME : ThemeSettings.PREFERRED_HC_THEME;
		const themeSettingId = this.configurationService.getValue<string>(settingId);
		if (themeSettingId) {
			const theme = this.colorThemeRegistry.findThemeBySettingsId(themeSettingId, undefined);
			if (theme) {
				const configurationTarget = this.settings.findAutoConfigurationTarget(settingId);
				return this.setColorTheme(theme.id, configurationTarget);
			}
		}
		return null;
	}

	public getColorTheme(): IWorkbenchColorTheme {
		return this.currentColorTheme;
	}

	public async getColorThemes(): Promise<IWorkbenchColorTheme[]> {
		return this.colorThemeRegistry.getThemes();
	}

	public get onDidColorThemeChange(): Event<IWorkbenchColorTheme> {
		return this.onColorThemeChange.event;
	}

	public setColorTheme(themeId: string | undefined, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchColorTheme | null> {
		return this.colorThemeSequencer.queue(() => {
			if (!themeId) {
				return Promise.resolve(null);
			}
			if (themeId === this.currentColorTheme.id && this.currentColorTheme.isLoaded) {
				return this.settings.setColorTheme(this.currentColorTheme, settingsTarget);
			}

			themeId = validateThemeId(themeId); // migrate theme ids

			const themeData = this.colorThemeRegistry.findThemeById(themeId, DEFAULT_COLOR_THEME_ID);
			if (!themeData) {
				return Promise.resolve(null);
			}
			return themeData.ensureLoaded(this.extensionResourceLoaderService).then(_ => {
				themeData.setCustomizations(this.settings);
				return this.applyTheme(themeData, settingsTarget);
			}, error => {
				return Promise.reject(new Error(nls.localize('error.cannotloadtheme', "Unable to load {0}: {1}", themeData.location?.toString(), error.message)));
			});
		});
	}

	private reloadCurrentColorTheme() {
		return this.colorThemeSequencer.queue(async () => {
			try {
				await this.currentColorTheme.reload(this.extensionResourceLoaderService);
				this.currentColorTheme.setCustomizations(this.settings);
				await this.applyTheme(this.currentColorTheme, undefined, false);
			} catch (error) {
				this.logService.info('Unable to reload {0}: {1}', this.currentColorTheme.location?.toString());
			}
		});
	}

	public async restoreColorTheme(): Promise<boolean> {
		const settingId = this.settings.colorTheme;
		const theme = this.colorThemeRegistry.findThemeBySettingsId(settingId);
		if (theme) {
			if (settingId !== this.currentColorTheme.settingsId) {
				await this.setColorTheme(theme.id, undefined);
			}
			return true;
		}
		return false;
	}

	private updateDynamicCSSRules(themeData: IColorTheme) {
		const cssRules = new Set<string>();
		const ruleCollector = {
			addRule: (rule: string) => {
				if (!cssRules.has(rule)) {
					cssRules.add(rule);
				}
			}
		};
		ruleCollector.addRule(`.monaco-workbench { forced-color-adjust: none; }`);
		themingRegistry.getThemingParticipants().forEach(p => p(themeData, ruleCollector, this.environmentService));
		_applyRules([...cssRules].join('\n'), colorThemeRulesClassName);
	}

	private applyTheme(newTheme: ColorThemeData, settingsTarget: ThemeSettingTarget, silent = false): Promise<IWorkbenchColorTheme | null> {
		this.updateDynamicCSSRules(newTheme);

		if (this.currentColorTheme.id) {
			this.container.classList.remove(...this.currentColorTheme.classNames);
		} else {
			this.container.classList.remove(VS_DARK_THEME, VS_LIGHT_THEME, VS_HC_THEME);
		}
		this.container.classList.add(...newTheme.classNames);

		this.currentColorTheme.clearCaches();
		this.currentColorTheme = newTheme;
		if (!this.colorThemingParticipantChangeListener) {
			this.colorThemingParticipantChangeListener = themingRegistry.onThemingParticipantAdded(_ => this.updateDynamicCSSRules(this.currentColorTheme));
		}

		this.colorThemeWatcher.update(newTheme);

		this.sendTelemetry(newTheme.id, newTheme.extensionData, 'color');

		if (silent) {
			return Promise.resolve(null);
		}

		this.onColorThemeChange.fire(this.currentColorTheme);

		// remember theme data for a quick restore
		if (newTheme.isLoaded) {
			newTheme.toStorage(this.storageService);
		}

		return this.settings.setColorTheme(this.currentColorTheme, settingsTarget);
	}


	private themeExtensionsActivated = new Map<string, boolean>();
	private sendTelemetry(themeId: string, themeData: ExtensionData | undefined, themeType: string) {
		if (themeData) {
			const key = themeType + themeData.extensionId;
			if (!this.themeExtensionsActivated.get(key)) {
				type ActivatePluginClassification = {
					id: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
					name: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
					isBuiltin: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
					publisherDisplayName: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					themeId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
				};
				type ActivatePluginEvent = {
					id: string;
					name: string;
					isBuiltin: boolean;
					publisherDisplayName: string;
					themeId: string;
				};
				this.telemetryService.publicLog2<ActivatePluginEvent, ActivatePluginClassification>('activatePlugin', {
					id: themeData.extensionId,
					name: themeData.extensionName,
					isBuiltin: themeData.extensionIsBuiltin,
					publisherDisplayName: themeData.extensionPublisher,
					themeId: themeId
				});
				this.themeExtensionsActivated.set(key, true);
			}
		}
	}

	public async getFileIconThemes(): Promise<IWorkbenchFileIconTheme[]> {
		return this.fileIconThemeRegistry.getThemes();
	}

	public getFileIconTheme() {
		return this.currentFileIconTheme;
	}

	public get onDidFileIconThemeChange(): Event<IWorkbenchFileIconTheme> {
		return this.onFileIconThemeChange.event;
	}


	public async setFileIconTheme(iconTheme: string | undefined, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchFileIconTheme> {
		return this.fileIconThemeSequencer.queue(async () => {
			iconTheme = iconTheme || '';
			if (iconTheme === this.currentFileIconTheme.id && this.currentFileIconTheme.isLoaded) {
				await this.settings.setFileIconTheme(this.currentFileIconTheme, settingsTarget);
				return this.currentFileIconTheme;
			}

			const newThemeData = this.fileIconThemeRegistry.findThemeById(iconTheme) || FileIconThemeData.noIconTheme;
			await newThemeData.ensureLoaded(this.fileService);

			this.applyAndSetFileIconTheme(newThemeData);

			// remember theme data for a quick restore
			if (newThemeData.isLoaded && (!newThemeData.location || !getRemoteAuthority(newThemeData.location))) {
				newThemeData.toStorage(this.storageService);
			}
			await this.settings.setFileIconTheme(this.currentFileIconTheme, settingsTarget);

			return newThemeData;
		});
	}

	private async reloadCurrentFileIconTheme() {
		return this.fileIconThemeSequencer.queue(async () => {
			await this.currentFileIconTheme.reload(this.fileService);
			this.applyAndSetFileIconTheme(this.currentFileIconTheme);
		});
	}

	public async restoreFileIconTheme(): Promise<boolean> {
		const settingId = this.settings.fileIconTheme;
		const theme = this.fileIconThemeRegistry.findThemeBySettingsId(settingId);
		if (theme) {
			if (settingId !== this.currentFileIconTheme.settingsId) {
				await this.setFileIconTheme(theme.id, undefined);
			}
			return true;
		}
		return false;
	}

	private applyAndSetFileIconTheme(iconThemeData: FileIconThemeData, silent = false): void {
		this.currentFileIconTheme = iconThemeData;

		_applyRules(iconThemeData.styleSheetContent!, fileIconThemeRulesClassName);

		if (iconThemeData.id) {
			this.container.classList.add(fileIconsEnabledClass);
		} else {
			this.container.classList.remove(fileIconsEnabledClass);
		}

		this.fileIconThemeWatcher.update(iconThemeData);

		if (iconThemeData.id) {
			this.sendTelemetry(iconThemeData.id, iconThemeData.extensionData, 'fileIcon');
		}

		if (!silent) {
			this.onFileIconThemeChange.fire(this.currentFileIconTheme);
		}
	}

	public async getProductIconThemes(): Promise<IWorkbenchProductIconTheme[]> {
		return this.productIconThemeRegistry.getThemes();
	}

	public getProductIconTheme() {
		return this.currentProductIconTheme;
	}

	public get onDidProductIconThemeChange(): Event<IWorkbenchProductIconTheme> {
		return this.onProductIconThemeChange.event;
	}

	public async setProductIconTheme(iconTheme: string | undefined, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchProductIconTheme> {
		return this.productIconThemeSequencer.queue(async () => {
			iconTheme = iconTheme || '';
			if (iconTheme === this.currentProductIconTheme.id && this.currentProductIconTheme.isLoaded) {
				await this.settings.setProductIconTheme(this.currentProductIconTheme, settingsTarget);
				return this.currentProductIconTheme;
			}

			const newThemeData = this.productIconThemeRegistry.findThemeById(iconTheme) || ProductIconThemeData.defaultTheme;
			await newThemeData.ensureLoaded(this.fileService, this.logService);

			this.applyAndSetProductIconTheme(newThemeData);

			// remember theme data for a quick restore
			if (newThemeData.isLoaded && (!newThemeData.location || !getRemoteAuthority(newThemeData.location))) {
				newThemeData.toStorage(this.storageService);
			}
			await this.settings.setProductIconTheme(this.currentProductIconTheme, settingsTarget);

			return newThemeData;
		});
	}

	private async reloadCurrentProductIconTheme() {
		return this.productIconThemeSequencer.queue(async () => {
			await this.currentProductIconTheme.reload(this.fileService, this.logService);
			this.applyAndSetProductIconTheme(this.currentProductIconTheme);
		});
	}

	public async restoreProductIconTheme(): Promise<boolean> {
		const settingId = this.settings.productIconTheme;
		const theme = this.productIconThemeRegistry.findThemeBySettingsId(settingId);
		if (theme) {
			if (settingId !== this.currentProductIconTheme.settingsId) {
				await this.setProductIconTheme(theme.id, undefined);
			}
			return true;
		}
		return false;
	}

	private applyAndSetProductIconTheme(iconThemeData: ProductIconThemeData, silent = false): void {

		this.currentProductIconTheme = iconThemeData;

		_applyRules(iconThemeData.styleSheetContent!, productIconThemeRulesClassName);

		this.productIconThemeWatcher.update(iconThemeData);

		if (iconThemeData.id) {
			this.sendTelemetry(iconThemeData.id, iconThemeData.extensionData, 'productIcon');
		}
		if (!silent) {
			this.onProductIconThemeChange.fire(this.currentProductIconTheme);
		}
	}
}

class ThemeFileWatcher {

	private watchedLocation: URI | undefined;
	private watcherDisposable: IDisposable | undefined;
	private fileChangeListener: IDisposable | undefined;

	constructor(private fileService: IFileService, private environmentService: IWorkbenchEnvironmentService, private onUpdate: () => void) {
	}

	update(theme: { location?: URI, watch?: boolean; }) {
		if (!resources.isEqual(theme.location, this.watchedLocation)) {
			this.dispose();
			if (theme.location && (theme.watch || this.environmentService.isExtensionDevelopment)) {
				this.watchedLocation = theme.location;
				this.watcherDisposable = this.fileService.watch(theme.location);
				this.fileService.onDidFilesChange(e => {
					if (this.watchedLocation && e.contains(this.watchedLocation, FileChangeType.UPDATED)) {
						this.onUpdate();
					}
				});
			}
		}
	}

	dispose() {
		this.watcherDisposable = dispose(this.watcherDisposable);
		this.fileChangeListener = dispose(this.fileChangeListener);
		this.watchedLocation = undefined;
	}
}

function _applyRules(styleSheetContent: string, rulesClassName: string) {
	const themeStyles = document.head.getElementsByClassName(rulesClassName);
	if (themeStyles.length === 0) {
		const elStyle = document.createElement('style');
		elStyle.type = 'text/css';
		elStyle.className = rulesClassName;
		elStyle.textContent = styleSheetContent;
		document.head.appendChild(elStyle);
	} else {
		(<HTMLStyleElement>themeStyles[0]).textContent = styleSheetContent;
	}
}

registerColorThemeSchemas();
registerFileIconThemeSchemas();
registerProductIconThemeSchemas();

registerSingleton(IWorkbenchThemeService, WorkbenchThemeService);
