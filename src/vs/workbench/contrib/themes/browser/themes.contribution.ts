/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchActionRegistry, Extensions, CATEGORIES } from 'vs/workbench/common/actions';
import { IWorkbenchThemeService, IWorkbenchTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { VIEWLET_ID, IExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/common/extensions';
import { IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IColorRegistry, Extensions as ColorRegistryExtensions } from 'vs/platform/theme/common/colorRegistry';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Color } from 'vs/base/common/color';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { colorThemeSchemaId } from 'vs/workbench/services/themes/common/colorThemeSchema';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IQuickInputService, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { DEFAULT_PRODUCT_ICON_THEME_ID } from 'vs/workbench/services/themes/browser/productIconThemeData';

export class SelectColorThemeAction extends Action {

	static readonly ID = 'workbench.action.selectTheme';
	static readonly LABEL = localize('selectTheme.label', "Color Theme");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label);
	}

	override run(): Promise<void> {
		return this.themeService.getColorThemes().then(themes => {
			const currentTheme = this.themeService.getColorTheme();

			const picks: QuickPickInput<ThemeItem>[] = [
				...toEntries(themes.filter(t => t.type === ColorScheme.LIGHT), localize('themes.category.light', "light themes")),
				...toEntries(themes.filter(t => t.type === ColorScheme.DARK), localize('themes.category.dark', "dark themes")),
				...toEntries(themes.filter(t => t.type === ColorScheme.HIGH_CONTRAST), localize('themes.category.hc', "high contrast themes")),
				...configurationEntries(this.extensionGalleryService, localize('installColorThemes', "Install Additional Color Themes..."))
			];

			let selectThemeTimeout: number | undefined;

			const selectTheme = (theme: ThemeItem, applyTheme: boolean) => {
				if (selectThemeTimeout) {
					clearTimeout(selectThemeTimeout);
				}
				selectThemeTimeout = window.setTimeout(() => {
					selectThemeTimeout = undefined;
					const themeId = theme && theme.id !== undefined ? theme.id : currentTheme.id;

					this.themeService.setColorTheme(themeId, applyTheme ? 'auto' : undefined).then(undefined,
						err => {
							onUnexpectedError(err);
							this.themeService.setColorTheme(currentTheme.id, undefined);
						}
					);
				}, applyTheme ? 0 : 200);
			};

			return new Promise((s, _) => {
				let isCompleted = false;

				const autoFocusIndex = picks.findIndex(p => isItem(p) && p.id === currentTheme.id);
				const quickpick = this.quickInputService.createQuickPick<ThemeItem>();
				quickpick.items = picks;
				quickpick.placeholder = localize('themes.selectTheme', "Select Color Theme (Up/Down Keys to Preview)");
				quickpick.activeItems = [picks[autoFocusIndex] as ThemeItem];
				quickpick.canSelectMany = false;
				quickpick.onDidAccept(_ => {
					const theme = quickpick.activeItems[0];
					if (!theme || typeof theme.id === 'undefined') { // 'pick in marketplace' entry
						openExtensionViewlet(this.viewletService, `category:themes ${quickpick.value}`);
					} else {
						selectTheme(theme, true);
					}
					isCompleted = true;
					quickpick.hide();
					s();
				});
				quickpick.onDidChangeActive(themes => selectTheme(themes[0], false));
				quickpick.onDidHide(() => {
					if (!isCompleted) {
						selectTheme(currentTheme, true);
						s();
					}
				});
				quickpick.show();
			});
		});
	}
}

abstract class AbstractIconThemeAction extends Action {
	constructor(
		id: string,
		label: string,
		private readonly quickInputService: IQuickInputService,
		private readonly extensionGalleryService: IExtensionGalleryService,
		private readonly viewletService: IViewletService

	) {
		super(id, label);
	}

	protected abstract get builtInEntry(): QuickPickInput<ThemeItem>;
	protected abstract get installMessage(): string | undefined;
	protected abstract get placeholderMessage(): string;
	protected abstract get marketplaceTag(): string;

	protected abstract setTheme(id: string, settingsTarget: ConfigurationTarget | undefined | 'auto'): Promise<any>;

	protected pick(themes: IWorkbenchTheme[], currentTheme: IWorkbenchTheme) {
		let picks: QuickPickInput<ThemeItem>[] = [this.builtInEntry];
		picks = picks.concat(
			toEntries(themes),
			configurationEntries(this.extensionGalleryService, this.installMessage)
		);

		let selectThemeTimeout: number | undefined;

		const selectTheme = (theme: ThemeItem, applyTheme: boolean) => {
			if (selectThemeTimeout) {
				clearTimeout(selectThemeTimeout);
			}
			selectThemeTimeout = window.setTimeout(() => {
				selectThemeTimeout = undefined;
				const themeId = theme && theme.id !== undefined ? theme.id : currentTheme.id;
				this.setTheme(themeId, applyTheme ? 'auto' : undefined).then(undefined,
					err => {
						onUnexpectedError(err);
						this.setTheme(currentTheme.id, undefined);
					}
				);
			}, applyTheme ? 0 : 200);
		};

		return new Promise<void>((s, _) => {
			let isCompleted = false;

			const autoFocusIndex = picks.findIndex(p => isItem(p) && p.id === currentTheme.id);
			const quickpick = this.quickInputService.createQuickPick<ThemeItem>();
			quickpick.items = picks;
			quickpick.placeholder = this.placeholderMessage;
			quickpick.activeItems = [picks[autoFocusIndex] as ThemeItem];
			quickpick.canSelectMany = false;
			quickpick.onDidAccept(_ => {
				const theme = quickpick.activeItems[0];
				if (!theme || typeof theme.id === 'undefined') { // 'pick in marketplace' entry
					openExtensionViewlet(this.viewletService, `${this.marketplaceTag} ${quickpick.value}`);
				} else {
					selectTheme(theme, true);
				}
				isCompleted = true;
				quickpick.hide();
				s();
			});
			quickpick.onDidChangeActive(themes => selectTheme(themes[0], false));
			quickpick.onDidHide(() => {
				if (!isCompleted) {
					selectTheme(currentTheme, true);
					s();
				}
			});
			quickpick.show();
		});
	}
}

class SelectFileIconThemeAction extends AbstractIconThemeAction {

	static readonly ID = 'workbench.action.selectIconTheme';
	static readonly LABEL = localize('selectIconTheme.label', "File Icon Theme");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IViewletService viewletService: IViewletService

	) {
		super(id, label, quickInputService, extensionGalleryService, viewletService);
	}

	protected builtInEntry: QuickPickInput<ThemeItem> = { id: '', label: localize('noIconThemeLabel', 'None'), description: localize('noIconThemeDesc', 'Disable File Icons') };
	protected installMessage = localize('installIconThemes', "Install Additional File Icon Themes...");
	protected placeholderMessage = localize('themes.selectIconTheme', "Select File Icon Theme");
	protected marketplaceTag = 'tag:icon-theme';
	protected setTheme(id: string, settingsTarget: ConfigurationTarget | undefined | 'auto') {
		return this.themeService.setFileIconTheme(id, settingsTarget);
	}

	override async run(): Promise<void> {
		this.pick(await this.themeService.getFileIconThemes(), this.themeService.getFileIconTheme());
	}
}


class SelectProductIconThemeAction extends AbstractIconThemeAction {

	static readonly ID = 'workbench.action.selectProductIconTheme';
	static readonly LABEL = localize('selectProductIconTheme.label', "Product Icon Theme");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IViewletService viewletService: IViewletService

	) {
		super(id, label, quickInputService, extensionGalleryService, viewletService);
	}

	protected builtInEntry: QuickPickInput<ThemeItem> = { id: DEFAULT_PRODUCT_ICON_THEME_ID, label: localize('defaultProductIconThemeLabel', 'Default') };
	protected installMessage = localize('installProductIconThemes', "Install Additional Product Icon Themes...");
	protected placeholderMessage = localize('themes.selectProductIconTheme', "Select Product Icon Theme");
	protected marketplaceTag = 'tag:product-icon-theme';
	protected setTheme(id: string, settingsTarget: ConfigurationTarget | undefined | 'auto') {
		return this.themeService.setProductIconTheme(id, settingsTarget);
	}

	override async run(): Promise<void> {
		this.pick(await this.themeService.getProductIconThemes(), this.themeService.getProductIconTheme());
	}
}

function configurationEntries(extensionGalleryService: IExtensionGalleryService, label: string | undefined): QuickPickInput<ThemeItem>[] {
	if (extensionGalleryService.isEnabled() && label !== undefined) {
		return [
			{
				type: 'separator'
			},
			{
				id: undefined,
				label: label,
				alwaysShow: true
			}
		];
	}
	return [];
}

function openExtensionViewlet(viewletService: IViewletService, query: string) {
	return viewletService.openViewlet(VIEWLET_ID, true).then(viewlet => {
		if (viewlet) {
			(viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer).search(query);
			viewlet.focus();
		}
	});
}
interface ThemeItem {
	id: string | undefined;
	label: string;
	description?: string;
	alwaysShow?: boolean;
}

function isItem(i: QuickPickInput<ThemeItem>): i is ThemeItem {
	return (<any>i)['type'] !== 'separator';
}

function toEntries(themes: Array<IWorkbenchTheme>, label?: string): QuickPickInput<ThemeItem>[] {
	const toEntry = (theme: IWorkbenchTheme): ThemeItem => ({ id: theme.id, label: theme.label, description: theme.description });
	const sorter = (t1: ThemeItem, t2: ThemeItem) => t1.label.localeCompare(t2.label);
	let entries: QuickPickInput<ThemeItem>[] = themes.map(toEntry).sort(sorter);
	if (entries.length > 0 && label) {
		entries.unshift({ type: 'separator', label });
	}
	return entries;
}

class GenerateColorThemeAction extends Action {

	static readonly ID = 'workbench.action.generateColorTheme';
	static readonly LABEL = localize('generateColorTheme.label', "Generate Color Theme From Current Settings");

	constructor(
		id: string,
		label: string,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		let theme = this.themeService.getColorTheme();
		let colors = Registry.as<IColorRegistry>(ColorRegistryExtensions.ColorContribution).getColors();
		let colorIds = colors.map(c => c.id).sort();
		let resultingColors: { [key: string]: string | null } = {};
		let inherited: string[] = [];
		for (let colorId of colorIds) {
			const color = theme.getColor(colorId, false);
			if (color) {
				resultingColors[colorId] = Color.Format.CSS.formatHexA(color, true);
			} else {
				inherited.push(colorId);
			}
		}
		const nullDefaults = [];
		for (let id of inherited) {
			const color = theme.getColor(id);
			if (color) {
				resultingColors['__' + id] = Color.Format.CSS.formatHexA(color, true);
			} else {
				nullDefaults.push(id);
			}
		}
		for (let id of nullDefaults) {
			resultingColors['__' + id] = null;
		}
		let contents = JSON.stringify({
			'$schema': colorThemeSchemaId,
			type: theme.type,
			colors: resultingColors,
			tokenColors: theme.tokenColors.filter(t => !!t.scope)
		}, null, '\t');
		contents = contents.replace(/\"__/g, '//"');

		return this.editorService.openEditor({ contents, mode: 'jsonc', options: { pinned: true } });
	}
}

const category = localize('preferences', "Preferences");

const colorThemeDescriptor = SyncActionDescriptor.from(SelectColorThemeAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_T) });
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(colorThemeDescriptor, 'Preferences: Color Theme', category);

const fileIconThemeDescriptor = SyncActionDescriptor.from(SelectFileIconThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(fileIconThemeDescriptor, 'Preferences: File Icon Theme', category);

const productIconThemeDescriptor = SyncActionDescriptor.from(SelectProductIconThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(productIconThemeDescriptor, 'Preferences: Product Icon Theme', category);


const generateColorThemeDescriptor = SyncActionDescriptor.from(GenerateColorThemeAction);
Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions).registerWorkbenchAction(generateColorThemeDescriptor, 'Developer: Generate Color Theme From Current Settings', CATEGORIES.Developer.value);

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectColorThemeAction.ID,
		title: localize({ key: 'miSelectColorTheme', comment: ['&& denotes a mnemonic'] }, "&&Color Theme")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectFileIconThemeAction.ID,
		title: localize({ key: 'miSelectIconTheme', comment: ['&& denotes a mnemonic'] }, "File &&Icon Theme")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '4_themes',
	command: {
		id: SelectProductIconThemeAction.ID,
		title: localize({ key: 'miSelectProductIconTheme', comment: ['&& denotes a mnemonic'] }, "&&Product Icon Theme")
	},
	order: 3
});


MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectColorThemeAction.ID,
		title: localize('selectTheme.label', "Color Theme")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectFileIconThemeAction.ID,
		title: localize('themes.selectIconTheme.label', "File Icon Theme")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '4_themes',
	command: {
		id: SelectProductIconThemeAction.ID,
		title: localize('themes.selectProductIconTheme.label', "Product Icon Theme")
	},
	order: 3
});
