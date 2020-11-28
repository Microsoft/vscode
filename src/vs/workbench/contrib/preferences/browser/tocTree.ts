/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { DefaultStyleController, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ITreeElement, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { Iterable } from 'vs/base/common/iterator';
import { localize } from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IListService, IWorkbenchObjectTreeOptions, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { editorBackground, focusBorder, foreground, transparent } from 'vs/platform/theme/common/colorRegistry';
import { attachStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { SettingsTreeFilter } from 'vs/workbench/contrib/preferences/browser/settingsTree';
import { ISettingsEditorViewState, SearchResultModel, SettingsTreeElement, SettingsTreeGroupElement, SettingsTreeSettingElement } from 'vs/workbench/contrib/preferences/browser/settingsTreeModels';
import { settingsHeaderForeground } from 'vs/workbench/contrib/preferences/browser/settingsWidgets';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

const $ = DOM.$;

export class TOCTreeModel {

	private _currentSearchModel: SearchResultModel | null = null;
	private _settingsTreeRoot!: SettingsTreeGroupElement;

	constructor(
		private _viewState: ISettingsEditorViewState,
		@IWorkbenchEnvironmentService private environmentService: IWorkbenchEnvironmentService
	) {
	}

	get settingsTreeRoot(): SettingsTreeGroupElement {
		return this._settingsTreeRoot;
	}

	set settingsTreeRoot(value: SettingsTreeGroupElement) {
		this._settingsTreeRoot = value;
		this.update();
	}

	get currentSearchModel(): SearchResultModel | null {
		return this._currentSearchModel;
	}

	set currentSearchModel(model: SearchResultModel | null) {
		this._currentSearchModel = model;
		this.update();
	}

	get children(): SettingsTreeElement[] {
		return this._settingsTreeRoot.children;
	}

	update(): void {
		if (this._settingsTreeRoot) {
			this.updateGroupCount(this._settingsTreeRoot);
		}
	}

	private updateGroupCount(group: SettingsTreeGroupElement): void {
		group.children.forEach(child => {
			if (child instanceof SettingsTreeGroupElement) {
				this.updateGroupCount(child);
			}
		});

		const childCount = group.children
			.filter(child => child instanceof SettingsTreeGroupElement)
			.reduce((acc, cur) => acc + (<SettingsTreeGroupElement>cur).count!, 0);

		group.count = childCount + this.getGroupCount(group);
	}

	private getGroupCount(group: SettingsTreeGroupElement): number {
		return group.children.filter(child => {
			if (!(child instanceof SettingsTreeSettingElement)) {
				return false;
			}

			if (this._currentSearchModel && !this._currentSearchModel.root.containsSetting(child.setting.key)) {
				return false;
			}

			// Check everything that the SettingsFilter checks except whether it's filtered by a category
			const isRemote = !!this.environmentService.remoteAuthority;
			return child.matchesScope(this._viewState.settingsTarget, isRemote) &&
				child.matchesAllTags(this._viewState.tagFilters) &&
				child.matchesAnyFeature(this._viewState.featureFilters) &&
				child.matchesAnyExtension(this._viewState.extensionFilters) &&
				child.matchesAnyId(this._viewState.idFilters);
		}).length;
	}
}

const TOC_ENTRY_TEMPLATE_ID = 'settings.toc.entry';

interface ITOCEntryTemplate {
	labelElement: HTMLElement;
	countElement: HTMLElement;
}

export class TOCRenderer implements ITreeRenderer<SettingsTreeGroupElement, never, ITOCEntryTemplate> {

	templateId = TOC_ENTRY_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ITOCEntryTemplate {
		return {
			labelElement: DOM.append(container, $('.settings-toc-entry')),
			countElement: DOM.append(container, $('.settings-toc-count'))
		};
	}

	renderElement(node: ITreeNode<SettingsTreeGroupElement>, index: number, template: ITOCEntryTemplate): void {
		const element = node.element;
		const count = element.count;
		const label = element.label;

		template.labelElement.textContent = label;
		template.labelElement.title = label;

		if (count) {
			template.countElement.textContent = ` (${count})`;
		} else {
			template.countElement.textContent = '';
		}
	}

	disposeTemplate(templateData: ITOCEntryTemplate): void {
	}
}

class TOCTreeDelegate implements IListVirtualDelegate<SettingsTreeElement> {
	getTemplateId(element: SettingsTreeElement): string {
		return TOC_ENTRY_TEMPLATE_ID;
	}

	getHeight(element: SettingsTreeElement): number {
		return 22;
	}
}

export function createTOCIterator(model: TOCTreeModel | SettingsTreeGroupElement, tree: TOCTree): Iterable<ITreeElement<SettingsTreeGroupElement>> {
	const groupChildren = <SettingsTreeGroupElement[]>model.children.filter(c => c instanceof SettingsTreeGroupElement);

	return Iterable.map(groupChildren, g => {
		const hasGroupChildren = g.children.some(c => c instanceof SettingsTreeGroupElement);

		return {
			element: g,
			collapsed: undefined,
			collapsible: hasGroupChildren,
			children: g instanceof SettingsTreeGroupElement ?
				createTOCIterator(g, tree) :
				undefined
		};
	});
}

class SettingsAccessibilityProvider implements IListAccessibilityProvider<SettingsTreeGroupElement> {
	getWidgetAriaLabel(): string {
		return localize({
			key: 'settingsTOC',
			comment: ['A label for the table of contents for the full settings list']
		},
			"Settings Table of Contents");
	}

	getAriaLabel(element: SettingsTreeElement): string {
		if (!element) {
			return '';
		}

		if (element instanceof SettingsTreeGroupElement) {
			return localize('groupRowAriaLabel', "{0}, group", element.label);
		}

		return '';
	}

	getAriaLevel(element: SettingsTreeGroupElement): number {
		let i = 1;
		while (element instanceof SettingsTreeGroupElement && element.parent) {
			i++;
			element = element.parent;
		}

		return i;
	}
}

export class TOCTree extends WorkbenchObjectTree<SettingsTreeGroupElement> {
	constructor(
		container: HTMLElement,
		viewState: ISettingsEditorViewState,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// test open mode

		const filter = instantiationService.createInstance(SettingsTreeFilter, viewState);
		const options: IWorkbenchObjectTreeOptions<SettingsTreeGroupElement, void> = {
			filter,
			multipleSelectionSupport: false,
			identityProvider: {
				getId(e) {
					return e.id;
				}
			},
			styleController: id => new DefaultStyleController(DOM.createStyleSheet(container), id),
			accessibilityProvider: instantiationService.createInstance(SettingsAccessibilityProvider),
			collapseByDefault: true,
			horizontalScrolling: false,
			hideTwistiesOfChildlessElements: true
		};

		super(
			'SettingsTOC',
			container,
			new TOCTreeDelegate(),
			[new TOCRenderer()],
			options,
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
			accessibilityService,
		);

		this.disposables.add(attachStyler(themeService, {
			listBackground: editorBackground,
			listFocusOutline: focusBorder,
			listActiveSelectionBackground: editorBackground,
			listActiveSelectionForeground: settingsHeaderForeground,
			listFocusAndSelectionBackground: editorBackground,
			listFocusAndSelectionForeground: settingsHeaderForeground,
			listFocusBackground: editorBackground,
			listFocusForeground: transparent(foreground, 0.9),
			listHoverForeground: transparent(foreground, 0.9),
			listHoverBackground: editorBackground,
			listInactiveSelectionBackground: editorBackground,
			listInactiveSelectionForeground: settingsHeaderForeground,
			listInactiveFocusBackground: editorBackground,
			listInactiveFocusOutline: editorBackground
		}, colors => {
			this.style(colors);
		}));
	}
}
