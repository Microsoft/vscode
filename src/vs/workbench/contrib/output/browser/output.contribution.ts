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
import { MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { OutputService, LogContentProvider } from 'vs/workbench/contrib/output/browser/outputServices';
import { OUTPUT_MODE_ID, OUTPUT_MIME, OUTPUT_VIEW_ID, IOutputService, CONTEXT_IN_OUTPUT, LOG_SCHEME, LOG_MODE_ID, LOG_MIME, CONTEXT_ACTIVE_LOG_OUTPUT, CONTEXT_OUTPUT_SCROLL_LOCK } from 'vs/workbench/contrib/output/common/output';
import { OutputViewPane } from 'vs/workbench/contrib/output/browser/outputView';
import { IEditorRegistry, EditorDescriptor } from 'vs/workbench/browser/editor';
import { LogViewer, LogViewerInput } from 'vs/workbench/contrib/output/browser/logViewer';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry, IViewsService } from 'vs/workbench/common/views';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IOutputChannelDescriptor, IFileOutputChannelDescriptor } from 'vs/workbench/services/output/common/output';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { assertIsDefined } from 'vs/base/common/types';
import { ContextKeyEqualsExpr, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { EditorExtensions } from 'vs/workbench/common/editor';

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
const outputViewIcon = registerIcon('output-view-icon', Codicon.output, nls.localize('outputViewIcon', 'View icon of the output view.'));
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: OUTPUT_VIEW_ID,
	title: nls.localize('output', "Output"),
	icon: outputViewIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OUTPUT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: OUTPUT_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.Panel, { donotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: OUTPUT_VIEW_ID,
	name: nls.localize('output', "Output"),
	containerIcon: outputViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(OutputViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.output.toggleOutput',
		mnemonicTitle: nls.localize({ key: 'miToggleOutput', comment: ['&& denotes a mnemonic'] }, "&&Output"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_U,
			linux: {
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_H)  // On Ubuntu Ctrl+Shift+U is taken by some global OS command
			}
		},
		order: 1,
	}
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
		if (typeof channelId === 'string') {
			// Sometimes the action is executed with no channelId parameter, then we should just ignore it #103496
			accessor.get(IOutputService).showChannel(channelId, true);
		}
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: `workbench.output.action.clearOutput`,
			title: { value: nls.localize('clearOutput.label', "Clear Output"), original: 'Clear Output' },
			category: CATEGORIES.View,
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
			icon: Codicon.clearAll
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
			tooltip: nls.localize('outputScrollOff', "Turn Auto Scrolling Off"),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', OUTPUT_VIEW_ID)),
				group: 'navigation',
				order: 3,
			},
			icon: Codicon.unlock,
			toggled: {
				condition: CONTEXT_OUTPUT_SCROLL_LOCK,
				icon: Codicon.lock,
				tooltip: nls.localize('outputScrollOn', "Turn Auto Scrolling On")
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
			icon: Codicon.goToFile,
			precondition: CONTEXT_ACTIVE_LOG_OUTPUT
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const outputService = accessor.get(IOutputService);
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const logFileOutputChannelDescriptor = this.getLogFileOutputChannelDescriptor(outputService);
		if (logFileOutputChannelDescriptor) {
			await editorService.openEditor(instantiationService.createInstance(LogViewerInput, logFileOutputChannelDescriptor), { pinned: true });
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

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.showLogs',
			title: { value: nls.localize('showLogs', "Show Logs..."), original: 'Show Logs...' },
			category: CATEGORIES.Developer,
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
			category: CATEGORIES.Developer,
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
			await editorService.openEditor(instantiationService.createInstance(LogViewerInput, (entry.channel as IFileOutputChannelDescriptor)), { pinned: true });
		}
	}
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
			scope: ConfigurationScope.WINDOW,
			tags: ['output']
		}
	}
});
