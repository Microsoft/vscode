/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extension';
import { append, $ } from 'vs/base/browser/dom';
import { IDisposable, dispose, combinedDisposable } from 'vs/base/common/lifecycle';
import { IAction } from 'vs/base/common/actions';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IPagedRenderer } from 'vs/base/browser/ui/list/listPaging';
import { Event } from 'vs/base/common/event';
import { domEvent } from 'vs/base/browser/event';
import { IExtension, ExtensionContainers, ExtensionState, IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { UpdateAction, ManageExtensionAction, ReloadAction, MaliciousStatusLabelAction, StatusLabelAction, RemoteInstallAction, SystemDisabledWarningAction, ExtensionToolTipAction, LocalInstallAction, ActionWithDropDownAction, InstallDropdownAction, InstallingLabelAction, ExtensionActionWithDropdownActionViewItem, ExtensionDropDownAction, WebInstallAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { Label, RatingsWidget, InstallCountWidget, RecommendationWidget, RemoteBadgeWidget, TooltipWidget, ExtensionPackCountWidget as ExtensionPackBadgeWidget, SyncIgnoredWidget } from 'vs/workbench/contrib/extensions/browser/extensionsWidgets';
import { IExtensionService, toExtension } from 'vs/workbench/services/extensions/common/extensions';
import { IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { foreground, listActiveSelectionForeground, listActiveSelectionBackground, listInactiveSelectionForeground, listInactiveSelectionBackground, listFocusForeground, listFocusBackground, listHoverForeground, listHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { WORKBENCH_BACKGROUND } from 'vs/workbench/common/theme';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { localize } from 'vs/nls';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';

export const EXTENSION_LIST_ELEMENT_HEIGHT = 62;

export interface IExtensionsViewState {
	onFocus: Event<IExtension>;
	onBlur: Event<IExtension>;
}

export interface ITemplateData {
	root: HTMLElement;
	element: HTMLElement;
	icon: HTMLImageElement;
	name: HTMLElement;
	installCount: HTMLElement;
	ratings: HTMLElement;
	author: HTMLElement;
	description: HTMLElement;
	workspaceTrustDescription: HTMLElement;
	extension: IExtension | null;
	disposables: IDisposable[];
	extensionDisposables: IDisposable[];
	actionbar: ActionBar;
}

export class Delegate implements IListVirtualDelegate<IExtension> {
	getHeight() { return EXTENSION_LIST_ELEMENT_HEIGHT; }
	getTemplateId() { return 'extension'; }
}

const actionOptions = { icon: true, label: true, tabOnlyOnFocus: true };

export class Renderer implements IPagedRenderer<IExtension, ITemplateData> {

	constructor(
		private extensionViewState: IExtensionsViewState,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionManifestPropertiesService private readonly extensionManifestPropertiesService: IExtensionManifestPropertiesService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
	) { }

	get templateId() { return 'extension'; }

	renderTemplate(root: HTMLElement): ITemplateData {
		const recommendationWidget = this.instantiationService.createInstance(RecommendationWidget, append(root, $('.extension-bookmark-container')));
		const element = append(root, $('.extension-list-item'));
		const iconContainer = append(element, $('.icon-container'));
		const icon = append(iconContainer, $<HTMLImageElement>('img.icon'));
		const iconRemoteBadgeWidget = this.instantiationService.createInstance(RemoteBadgeWidget, iconContainer, false);
		const extensionPackBadgeWidget = this.instantiationService.createInstance(ExtensionPackBadgeWidget, iconContainer);
		const details = append(element, $('.details'));
		const headerContainer = append(details, $('.header-container'));
		const header = append(headerContainer, $('.header'));
		const name = append(header, $('span.name'));
		const version = append(header, $('span.version'));
		const installCount = append(header, $('span.install-count'));
		const ratings = append(header, $('span.ratings'));
		const syncIgnore = append(header, $('span.sync-ignored'));
		const headerRemoteBadgeWidget = this.instantiationService.createInstance(RemoteBadgeWidget, header, false);
		const description = append(details, $('.description.ellipsis'));
		const workspaceTrustDescription = append(details, $('.workspace-trust-description.ellipsis'));
		const footer = append(details, $('.footer'));
		const author = append(footer, $('.author.ellipsis'));
		const actionbar = new ActionBar(footer, {
			animated: false,
			actionViewItemProvider: (action: IAction) => {
				if (action instanceof ActionWithDropDownAction) {
					return new ExtensionActionWithDropdownActionViewItem(action, { icon: true, label: true, menuActionsOrProvider: { getActions: () => action.menuActions }, menuActionClassNames: (action.class || '').split(' ') }, this.contextMenuService);
				}
				if (action instanceof ExtensionDropDownAction) {
					return action.createActionViewItem();
				}
				return undefined;
			},
			focusOnlyEnabledItems: true
		});
		actionbar.setFocusable(false);
		actionbar.onDidRun(({ error }) => error && this.notificationService.error(error));

		const systemDisabledWarningAction = this.instantiationService.createInstance(SystemDisabledWarningAction);
		const reloadAction = this.instantiationService.createInstance(ReloadAction);
		const actions = [
			this.instantiationService.createInstance(StatusLabelAction),
			this.instantiationService.createInstance(UpdateAction),
			reloadAction,
			this.instantiationService.createInstance(InstallDropdownAction),
			this.instantiationService.createInstance(InstallingLabelAction),
			this.instantiationService.createInstance(RemoteInstallAction, false),
			this.instantiationService.createInstance(LocalInstallAction),
			this.instantiationService.createInstance(WebInstallAction),
			this.instantiationService.createInstance(MaliciousStatusLabelAction, false),
			systemDisabledWarningAction,
			this.instantiationService.createInstance(ManageExtensionAction)
		];
		const extensionTooltipAction = this.instantiationService.createInstance(ExtensionToolTipAction, systemDisabledWarningAction, reloadAction);
		const tooltipWidget = this.instantiationService.createInstance(TooltipWidget, root, extensionTooltipAction, recommendationWidget);
		const widgets = [
			recommendationWidget,
			iconRemoteBadgeWidget,
			extensionPackBadgeWidget,
			headerRemoteBadgeWidget,
			tooltipWidget,
			this.instantiationService.createInstance(Label, version, (e: IExtension) => e.version),
			this.instantiationService.createInstance(SyncIgnoredWidget, syncIgnore),
			this.instantiationService.createInstance(InstallCountWidget, installCount, true),
			this.instantiationService.createInstance(RatingsWidget, ratings, true)
		];
		const extensionContainers: ExtensionContainers = this.instantiationService.createInstance(ExtensionContainers, [...actions, ...widgets, extensionTooltipAction]);

		actionbar.push(actions, actionOptions);
		const disposable = combinedDisposable(...actions, ...widgets, actionbar, extensionContainers, extensionTooltipAction);

		return {
			root, element, icon, name, installCount, ratings, author, description, workspaceTrustDescription, disposables: [disposable], actionbar,
			extensionDisposables: [],
			set extension(extension: IExtension) {
				extensionContainers.extension = extension;
			}
		};
	}

	renderPlaceholder(index: number, data: ITemplateData): void {
		data.element.classList.add('loading');

		data.root.removeAttribute('aria-label');
		data.root.removeAttribute('data-extension-id');
		data.extensionDisposables = dispose(data.extensionDisposables);
		data.icon.src = '';
		data.name.textContent = '';
		data.author.textContent = '';
		data.description.textContent = '';
		data.installCount.style.display = 'none';
		data.ratings.style.display = 'none';
		data.extension = null;
	}

	renderElement(extension: IExtension, index: number, data: ITemplateData): void {
		data.element.classList.remove('loading');
		data.root.setAttribute('data-extension-id', extension.identifier.id);

		if (extension.state !== ExtensionState.Uninstalled && !extension.server) {
			// Get the extension if it is installed and has no server information
			extension = this.extensionsWorkbenchService.local.filter(e => e.server === extension.server && areSameExtensions(e.identifier, extension.identifier))[0] || extension;
		}

		data.extensionDisposables = dispose(data.extensionDisposables);

		let isDisabled: boolean = false;
		const updateEnablement = async () => {
			const runningExtensions = await this.extensionService.getExtensions();
			isDisabled = false;
			if (extension.local && !isLanguagePackExtension(extension.local.manifest)) {
				const runningExtension = runningExtensions.filter(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, extension.identifier))[0];
				isDisabled = !(runningExtension && extension.server === this.extensionManagementServerService.getExtensionManagementServer(toExtension(runningExtension)));
			}
			data.root.classList.toggle('disabled', isDisabled);
		};
		updateEnablement();
		this.extensionService.onDidChangeExtensions(() => updateEnablement(), this, data.extensionDisposables);

		const onError = Event.once(domEvent(data.icon, 'error'));
		onError(() => data.icon.src = extension.iconUrlFallback, null, data.extensionDisposables);
		data.icon.src = extension.iconUrl;

		if (!data.icon.complete) {
			data.icon.style.visibility = 'hidden';
			data.icon.onload = () => data.icon.style.visibility = 'inherit';
		} else {
			data.icon.style.visibility = 'inherit';
		}

		data.name.textContent = extension.displayName;
		data.author.textContent = extension.publisherDisplayName;
		data.description.textContent = extension.description;

		if (extension.local?.manifest.capabilities?.untrustedWorkspaces?.supported) {
			const untrustedWorkspaceCapability = extension.local.manifest.capabilities.untrustedWorkspaces;
			const untrustedWorkspaceSupported = this.extensionManifestPropertiesService.getExtensionUntrustedWorkspaceSupportType(extension.local.manifest);
			if (untrustedWorkspaceSupported !== true && untrustedWorkspaceCapability.supported !== true) {
				data.workspaceTrustDescription.textContent = untrustedWorkspaceCapability.description;
			} else if (untrustedWorkspaceSupported === false) {
				data.workspaceTrustDescription.textContent = localize('onStartDefaultText', "A trusted workspace is required to enable this extension.");
			} else if (untrustedWorkspaceSupported === 'limited') {
				data.workspaceTrustDescription.textContent = localize('onDemandDefaultText', "Some features require a trusted workspace.");
			}
		}

		data.installCount.style.display = '';
		data.ratings.style.display = '';
		data.extension = extension;

		if (extension.gallery && extension.gallery.properties && extension.gallery.properties.localizedLanguages && extension.gallery.properties.localizedLanguages.length) {
			data.description.textContent = extension.gallery.properties.localizedLanguages.map(name => name[0].toLocaleUpperCase() + name.slice(1)).join(', ');
		}

		this.extensionViewState.onFocus(e => {
			if (areSameExtensions(extension.identifier, e.identifier)) {
				data.actionbar.setFocusable(true);
			}
		}, this, data.extensionDisposables);

		this.extensionViewState.onBlur(e => {
			if (areSameExtensions(extension.identifier, e.identifier)) {
				data.actionbar.setFocusable(false);
			}
		}, this, data.extensionDisposables);
	}

	disposeElement(extension: IExtension, index: number, data: ITemplateData): void {
		data.extensionDisposables = dispose(data.extensionDisposables);
	}

	disposeTemplate(data: ITemplateData): void {
		data.extensionDisposables = dispose(data.extensionDisposables);
		data.disposables = dispose(data.disposables);
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		const authorForeground = foregroundColor.transparent(.9).makeOpaque(WORKBENCH_BACKGROUND(theme));
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row:not(.disabled) .author { color: ${authorForeground}; }`);
		const disabledExtensionForeground = foregroundColor.transparent(.5).makeOpaque(WORKBENCH_BACKGROUND(theme));
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row.disabled { color: ${disabledExtensionForeground}; }`);
	}

	const listActiveSelectionForegroundColor = theme.getColor(listActiveSelectionForeground);
	if (listActiveSelectionForegroundColor) {
		const backgroundColor = theme.getColor(listActiveSelectionBackground) || WORKBENCH_BACKGROUND(theme);
		const authorForeground = listActiveSelectionForegroundColor.transparent(.9).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row:not(.disabled).focused.selected .author { color: ${authorForeground}; }`);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row:not(.disabled).selected .author { color: ${authorForeground}; }`);
		const disabledExtensionForeground = listActiveSelectionForegroundColor.transparent(.5).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row.disabled.focused.selected { color: ${disabledExtensionForeground}; }`);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row.disabled.selected { color: ${disabledExtensionForeground}; }`);
	}

	const listInactiveSelectionForegroundColor = theme.getColor(listInactiveSelectionForeground);
	if (listInactiveSelectionForegroundColor) {
		const backgroundColor = theme.getColor(listInactiveSelectionBackground) || WORKBENCH_BACKGROUND(theme);
		const authorForeground = listInactiveSelectionForegroundColor.transparent(.9).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row:not(.disabled).selected .author { color: ${authorForeground}; }`);
		const disabledExtensionForeground = listInactiveSelectionForegroundColor.transparent(.5).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row.disabled.selected { color: ${disabledExtensionForeground}; }`);
	}

	const listFocusForegroundColor = theme.getColor(listFocusForeground);
	if (listFocusForegroundColor) {
		const backgroundColor = theme.getColor(listFocusBackground) || WORKBENCH_BACKGROUND(theme);
		const authorForeground = listFocusForegroundColor.transparent(.9).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row:not(.disabled).focused .author { color: ${authorForeground}; }`);
		const disabledExtensionForeground = listFocusForegroundColor.transparent(.5).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list:focus .monaco-list-row.disabled.focused { color: ${disabledExtensionForeground}; }`);
	}

	const listHoverForegroundColor = theme.getColor(listHoverForeground);
	if (listHoverForegroundColor) {
		const backgroundColor = theme.getColor(listHoverBackground) || WORKBENCH_BACKGROUND(theme);
		const authorForeground = listHoverForegroundColor.transparent(.9).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row:hover:not(.disabled):not(.selected):.not(.focused) .author { color: ${authorForeground}; }`);
		const disabledExtensionForeground = listHoverForegroundColor.transparent(.5).makeOpaque(backgroundColor);
		collector.addRule(`.extensions-list .monaco-list .monaco-list-row.disabled:hover:not(.selected):.not(.focused) { color: ${disabledExtensionForeground}; }`);
	}
});

