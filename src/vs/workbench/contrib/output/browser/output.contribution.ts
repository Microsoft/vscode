/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as aria from 'vs/base/browser/ui/aria/aria';
import 'vs/css!./media/output';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { OutputService, LogContentProvider } from 'vs/workbench/contrib/output/browser/outputServices';
import { OUTPUT_MODE_ID, OUTPUT_MIME, OUTPUT_VIEW_ID, IOutputService, CONTEXT_IN_OUTPUT, LOG_SCHEME, LOG_MODE_ID, LOG_MIME, CONTEXT_ACTIVE_LOG_OUTPUT, CONTEXT_OUTPUT_SCROLL_LOCK } from 'vs/workbench/contrib/output/common/output';
import { OutputViewPane } from 'vs/workbench/contrib/output/browser/outputView';
import { IEditorRegistry, Extensions as EditorExtensions, EditorDescriptor } from 'vs/workbench/browser/editor';
import { LogViewer, LogViewerInput } from 'vs/workbench/contrib/output/browser/logViewer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry, IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IOutputChannelDescriptor, IFileOutputChannelDescriptor } from 'vs/workbench/services/output/common/output';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { assertIsDefined } from 'vs/base/common/types';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ContextKeyEqualsExpr, ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ToggleViewAction } from 'vs/workbench/browser/actions/layoutActions';
import { Codicon } from 'vs/base/common/codicons';

// Register Service
registerSingleton(IOutputService, OutputService);

// Register Output Mode
ModesRegistry.registerLanguage({
	id: OUTPUT_MODE_ID,
	extensions: [],
	mimetypes: [OUTPUT_MIME]
});

// Register Log Output Mode
ModesRegistry.registerLanguage({
	id: LOG_MODE_ID,
	extensions: [],
	mimetypes: [LOG_MIME]
});

// register output container
const toggleOutputAcitonId = 'workbench.action.output.toggleOutput';
const toggleOutputActionKeybindings = {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_U,
	linux: {
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_H)  // On Ubuntu Ctrl+Shift+U is taken by some global OS command
	}
};
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: OUTPUT_VIEW_ID,
	name: nls.localize('output', "Output"),
	icon: Codicon.output.classNames,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OUTPUT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: OUTPUT_VIEW_ID,
	hideIfEmpty: true,
	focusCommand: { id: toggleOutputAcitonId, keybindings: toggleOutputActionKeybindings }
}, ViewContainerLocation.Panel);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: OUTPUT_VIEW_ID,
	name: nls.localize('output', "Output"),
	containerIcon: Codicon.output.classNames,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(OutputViewPane),
}], VIEW_CONTAINER);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		LogViewer,
		LogViewer.LOG_VIEWER_EDITOR_ID,
		nls.localize('logViewer', "Log Viewer")
	),
	[
		new SyncDescriptor(LogViewerInput)
	]
);

class OutputContribution implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ITextModelService textModelService: ITextModelService
	) {
		textModelService.registerTextModelContentProvider(LOG_SCHEME, instantiationService.createInstance(LogContentProvider));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(OutputContribution, LifecyclePhase.Restored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: `workbench.output.action.switchBetweenOutputs`,
			title: nls.localize('switchToOutput.label', "Switch to Output"),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyEqualsExpr.create('view', OUTPUT_VIEW_ID),
				group: 'navigation',
				order: 1
			},
		});
	}
	async run(accessor: ServicesAccessor, channelId: string): Promise<void> {
		accessor.get(IOutputService).showChannel(channelId);
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: `workbench.output.action.clearOutput`,
			title: { value: nls.localize('clearOutput.label', "Clear Output"), original: 'Clear Output' },
			category: nls.localize('viewCategory', "View"),
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyEqualsExpr.create('view', OUTPUT_VIEW_ID),
				group: 'navigation',
				order: 2
			}, {
				id: MenuId.CommandPalette
			}, {
				id: MenuId.EditorContext,
				when: CONTEXT_IN_OUTPUT
			}],
			icon: { id: 'codicon/clear-all' }
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputService = accessor.get(IOutputService);
		const activeChannel = outputService.getActiveChannel();
		if (activeChannel) {
			activeChannel.clear();
			aria.status(nls.localize('outputCleared', "Output was cleared"));
		}
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: `workbench.output.action.toggleAutoScroll`,
			title: { value: nls.localize('toggleAutoScroll', "Toggle Auto Scrolling"), original: 'Toggle Auto Scrolling' },
			tooltip: { value: nls.localize('outputScrollOff', "Turn Auto Scrolling Off"), original: 'Turn Auto Scrolling Off' },
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', OUTPUT_VIEW_ID)),
				group: 'navigation',
				order: 3,
			},
			icon: { id: 'codicon/unlock' },
			toggled: {
				condition: CONTEXT_OUTPUT_SCROLL_LOCK,
				icon: { id: 'codicon/lock' },
				tooltip: { value: nls.localize('outputScrollOn', "Turn Auto Scrolling On"), original: 'Turn Auto Scrolling On' }
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputView = accessor.get(IViewsService).getActiveViewWithId<OutputViewPane>(OUTPUT_VIEW_ID)!;
		outputView.scrollLock = !outputView.scrollLock;
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: `workbench.action.openActiveLogOutputFile`,
			title: { value: nls.localize('openActiveLogOutputFile', "Open Log Output File"), original: 'Open Log Output File' },
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyEqualsExpr.create('view', OUTPUT_VIEW_ID),
				group: 'navigation',
				order: 4
			}, {
				id: MenuId.CommandPalette,
				when: CONTEXT_ACTIVE_LOG_OUTPUT,
			}],
			icon: { id: 'codicon/go-to-file' },
			precondition: CONTEXT_ACTIVE_LOG_OUTPUT
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputService = accessor.get(IOutputService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const logFileOutputChannelDescriptor = this.getLogFileOutputChannelDescriptor(outputService);
		if (logFileOutputChannelDescriptor) {
			await editorService.openEditor(instantiationService.createInstance(LogViewerInput, logFileOutputChannelDescriptor));
		}
	}
	private getLogFileOutputChannelDescriptor(outputService: IOutputService): IFileOutputChannelDescriptor | null {
		const channel = outputService.getActiveChannel();
		if (channel) {
			const descriptor = outputService.getChannelDescriptors().filter(c => c.id === channel.id)[0];
			if (descriptor && descriptor.file && descriptor.log) {
				return <IFileOutputChannelDescriptor>descriptor;
			}
		}
		return null;
	}
});

// register toggle output action globally
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: toggleOutputAcitonId,
			title: { value: nls.localize('toggleOutput', "Toggle Output"), original: 'Toggle Output' },
			category: { value: nls.localize('viewCategory', "View"), original: 'View' },
			menu: {
				id: MenuId.CommandPalette,
			},
			keybinding: {
				...toggleOutputActionKeybindings,
				...{
					weight: KeybindingWeight.WorkbenchContrib,
					when: undefined
				}
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const contextKeyService = accessor.get(IContextKeyService);
		const layoutService = accessor.get(IWorkbenchLayoutService);
		return new class ToggleOutputAction extends ToggleViewAction {
			constructor() {
				super(toggleOutputAcitonId, 'Toggle Output', OUTPUT_VIEW_ID, viewsService, viewDescriptorService, contextKeyService, layoutService);
			}
		}().run();
	}
});

const devCategory = { value: nls.localize('developer', "Developer"), original: 'Developer' };
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.showLogs',
			title: { value: nls.localize('showLogs', "Show Logs..."), original: 'Show Logs...' },
			category: devCategory,
			menu: {
				id: MenuId.CommandPalette,
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputService = accessor.get(IOutputService);
		const quickInputService = accessor.get(IQuickInputService);
		const entries: { id: string, label: string }[] = outputService.getChannelDescriptors().filter(c => c.file && c.log)
			.map(({ id, label }) => ({ id, label }));

		const entry = await quickInputService.pick(entries, { placeHolder: nls.localize('selectlog', "Select Log") });
		if (entry) {
			return outputService.showChannel(entry.id);
		}
	}
});

interface IOutputChannelQuickPickItem extends IQuickPickItem {
	channel: IOutputChannelDescriptor;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openLogFile',
			title: { value: nls.localize('openLogFile', "Open Log File..."), original: 'Open Log File...' },
			category: devCategory,
			menu: {
				id: MenuId.CommandPalette,
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputService = accessor.get(IOutputService);
		const quickInputService = accessor.get(IQuickInputService);
		const instantiationService = accessor.get(IInstantiationService);
		const editorService = accessor.get(IEditorService);

		const entries: IOutputChannelQuickPickItem[] = outputService.getChannelDescriptors().filter(c => c.file && c.log)
			.map(channel => (<IOutputChannelQuickPickItem>{ id: channel.id, label: channel.label, channel }));

		const entry = await quickInputService.pick(entries, { placeHolder: nls.localize('selectlogFile', "Select Log file") });
		if (entry) {
			assertIsDefined(entry.channel.file);
			await editorService.openEditor(instantiationService.createInstance(LogViewerInput, (entry.channel as IFileOutputChannelDescriptor)));
		}
	}
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '4_panels',
	command: {
		id: toggleOutputAcitonId,
		title: nls.localize({ key: 'miToggleOutput', comment: ['&& denotes a mnemonic'] }, "&&Output")
	},
	order: 1
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'output',
	order: 30,
	title: nls.localize('output', "Output"),
	type: 'object',
	properties: {
		'output.smartScroll.enabled': {
			type: 'boolean',
			description: nls.localize('output.smartScroll.enabled', "Enable/disable the ability of smart scrolling in the output view. Smart scrolling allows you to lock scrolling automatically when you click in the output view and unlocks when you click in the last line."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
			tags: ['output']
		}
	}
});
