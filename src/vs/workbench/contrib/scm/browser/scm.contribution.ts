/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { DirtyDiffWorkbenchController } from './dirtydiffDecorator';
import { VIEWLET_ID, ISCMRepository, ISCMService, VIEW_PANE_ID } from 'vs/workbench/contrib/scm/common/scm';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { SCMStatusController } from './activity';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { SCMService } from 'vs/workbench/contrib/scm/common/scmService';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry, IViewsService } from 'vs/workbench/common/views';
import { SCMViewPaneContainer } from 'vs/workbench/contrib/scm/browser/scmViewPaneContainer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { Codicon } from 'vs/base/common/codicons';
import { SCMViewPane } from 'vs/workbench/contrib/scm/browser/scmViewPane';

ModesRegistry.registerLanguage({
	id: 'scminput',
	extensions: [],
	mimetypes: ['text/x-scm-input']
});

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(DirtyDiffWorkbenchController, LifecyclePhase.Restored);

const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEWLET_ID,
	name: localize('source control', "Source Control"),
	ctorDescriptor: new SyncDescriptor(SCMViewPaneContainer),
	storageId: 'workbench.scm.views.state',
	icon: Codicon.sourceControl.classNames,
	alwaysUseContainerInfo: true,
	order: 2,
	hideIfEmpty: true
}, ViewContainerLocation.Sidebar);

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

viewsRegistry.registerViewWelcomeContent(VIEW_PANE_ID, {
	content: localize('no open repo', "No source control providers registered."),
	when: 'default'
});

viewsRegistry.registerViews([{
	id: VIEW_PANE_ID,
	name: localize('source control', "Source Control"),
	ctorDescriptor: new SyncDescriptor(SCMViewPane),
	canToggleVisibility: true,
	workspace: true,
	canMoveView: true,
	containerIcon: Codicon.sourceControl.classNames
}], viewContainer);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(SCMStatusController, LifecyclePhase.Restored);

// Register Action to Open View
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: VIEWLET_ID,
	description: { description: localize('toggleSCMViewlet', "Show SCM"), args: [] },
	weight: KeybindingWeight.WorkbenchContrib,
	primary: 0,
	win: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_G },
	linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_G },
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KEY_G },
	handler: accessor => {
		const viewsService = accessor.get(IViewsService);

		if (viewsService.isViewVisible(VIEW_PANE_ID)) {
			viewsService.closeView(VIEW_PANE_ID);
		} else {
			viewsService.openView(VIEW_PANE_ID);
		}
	}
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'scm',
	order: 5,
	title: localize('scmConfigurationTitle', "SCM"),
	type: 'object',
	scope: ConfigurationScope.RESOURCE,
	properties: {
		'scm.diffDecorations': {
			type: 'string',
			enum: ['all', 'gutter', 'overview', 'minimap', 'none'],
			enumDescriptions: [
				localize('scm.diffDecorations.all', "Show the diff decorations in all available locations."),
				localize('scm.diffDecorations.gutter', "Show the diff decorations only in the editor gutter."),
				localize('scm.diffDecorations.overviewRuler', "Show the diff decorations only in the overview ruler."),
				localize('scm.diffDecorations.minimap', "Show the diff decorations only in the minimap."),
				localize('scm.diffDecorations.none', "Do not show the diff decorations.")
			],
			default: 'all',
			description: localize('diffDecorations', "Controls diff decorations in the editor.")
		},
		'scm.diffDecorationsGutterWidth': {
			type: 'number',
			enum: [1, 2, 3, 4, 5],
			default: 3,
			description: localize('diffGutterWidth', "Controls the width(px) of diff decorations in gutter (added & modified).")
		},
		'scm.diffDecorationsGutterVisibility': {
			type: 'string',
			enum: ['always', 'hover'],
			enumDescriptions: [
				localize('scm.diffDecorationsGutterVisibility.always', "Show the diff decorator in the gutter at all times."),
				localize('scm.diffDecorationsGutterVisibility.hover', "Show the diff decorator in the gutter only on hover.")
			],
			description: localize('scm.diffDecorationsGutterVisibility', "Controls the visibility of the Source Control diff decorator in the gutter."),
			default: 'always'
		},
		'scm.alwaysShowActions': {
			type: 'boolean',
			description: localize('alwaysShowActions', "Controls whether inline actions are always visible in the Source Control view."),
			default: false
		},
		'scm.countBadge': {
			type: 'string',
			enum: ['all', 'focused', 'off'],
			enumDescriptions: [
				localize('scm.countBadge.all', "Show the sum of all Source Control Provider count badges."),
				localize('scm.countBadge.focused', "Show the count badge of the focused Source Control Provider."),
				localize('scm.countBadge.off', "Disable the Source Control count badge.")
			],
			description: localize('scm.countBadge', "Controls the count badge on the Source Control icon on the Activity Bar."),
			default: 'all'
		},
		'scm.providerCountBadge': {
			type: 'string',
			enum: ['hidden', 'auto', 'visible'],
			enumDescriptions: [
				localize('scm.providerCountBadge.hidden', "Hide Source Control Provider count badges."),
				localize('scm.providerCountBadge.auto', "Only show count badge for Source Control Provider when non-zero."),
				localize('scm.providerCountBadge.visible', "Show Source Control Provider count badges.")
			],
			description: localize('scm.providerCountBadge', "Controls the count badges on Source Control Provider headers. These headers only appear when there is more than one provider."),
			default: 'hidden'
		},
		'scm.defaultViewMode': {
			type: 'string',
			enum: ['tree', 'list'],
			enumDescriptions: [
				localize('scm.defaultViewMode.tree', "Show the repository changes as a tree."),
				localize('scm.defaultViewMode.list', "Show the repository changes as a list.")
			],
			description: localize('scm.defaultViewMode', "Controls the default Source Control repository view mode."),
			default: 'list'
		},
		'scm.autoReveal': {
			type: 'boolean',
			description: localize('autoReveal', "Controls whether the SCM view should automatically reveal and select files when opening them."),
			default: true
		},
		'scm.inputFontFamily': {
			type: 'string',
			markdownDescription: localize('inputFontFamily', "Controls the font for the input message. Use `default` for the workbench user interface font family, `editor` for the `#editor.fontFamily#`'s value, or a custom font family."),
			default: 'default'
		}
	}
});

// View menu

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '3_views',
	command: {
		id: VIEWLET_ID,
		title: localize({ key: 'miViewSCM', comment: ['&& denotes a mnemonic'] }, "S&&CM")
	},
	order: 3
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'scm.acceptInput',
	description: { description: localize('scm accept', "SCM: Accept Input"), args: [] },
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.has('scmRepository'),
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	handler: accessor => {
		const contextKeyService = accessor.get(IContextKeyService);
		const context = contextKeyService.getContext(document.activeElement);
		const repository = context.getValue<ISCMRepository>('scmRepository');

		if (!repository || !repository.provider.acceptInputCommand) {
			return Promise.resolve(null);
		}

		const id = repository.provider.acceptInputCommand.id;
		const args = repository.provider.acceptInputCommand.arguments;

		const commandService = accessor.get(ICommandService);
		return commandService.executeCommand(id, ...(args || []));
	}
});

registerSingleton(ISCMService, SCMService);
