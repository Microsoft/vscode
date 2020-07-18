/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/userDataSyncViews';
import { ITreeViewDataProvider, ITreeItem, TreeItemCollapsibleState, TreeViewItemHandleArg, IViewDescriptorService } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { TreeViewPane } from 'vs/workbench/browser/parts/views/treeView';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IUserDataSyncService, Change, MergeState, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { registerAction2, Action2, MenuId } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr, ContextKeyEqualsExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { URI } from 'vs/base/common/uri';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, dispose } from 'vs/base/common/lifecycle';
import { Codicon } from 'vs/base/common/codicons';
import { IUserDataSyncWorkbenchService, getSyncAreaLabel, IUserDataSyncPreview, IUserDataSyncResource, MANUAL_SYNC_VIEW_ID } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { isEqual, basename } from 'vs/base/common/resources';
import { IDecorationsProvider, IDecorationData, IDecorationsService } from 'vs/workbench/services/decorations/browser/decorations';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { listWarningForeground, listDeemphasizedForeground } from 'vs/platform/theme/common/colorRegistry';
import * as DOM from 'vs/base/browser/dom';
import { Button } from 'vs/base/browser/ui/button/button';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { attachButtonStyler } from 'vs/platform/theme/common/styler';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { FloatingClickWidget } from 'vs/workbench/browser/parts/editor/editorWidgets';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { INotificationService } from 'vs/platform/notification/common/notification';

export class UserDataManualSyncViewPane extends TreeViewPane {

	private userDataSyncPreview: IUserDataSyncPreview;

	private buttonsContainer!: HTMLElement;
	private syncButton!: Button;
	private cancelButton!: Button;

	constructor(
		options: IViewletViewOptions,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncWorkbenchService userDataSyncWorkbenchService: IUserDataSyncWorkbenchService,
		@IDecorationsService decorationsService: IDecorationsService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.userDataSyncPreview = userDataSyncWorkbenchService.userDataSyncPreview;

		this._register(this.userDataSyncPreview.onDidChangeResources(() => this.updateSyncButtonEnablement()));
		this._register(this.userDataSyncPreview.onDidChangeResources(() => this.treeView.refresh()));
		this._register(this.userDataSyncPreview.onDidChangeResources(() => this.closeConflictEditors()));
		this._register(decorationsService.registerDecorationsProvider(this._register(new UserDataSyncResourcesDecorationProvider(this.userDataSyncPreview))));

		this.registerActions();
	}

	protected renderTreeView(container: HTMLElement): void {
		super.renderTreeView(DOM.append(container, DOM.$('')));

		this.buttonsContainer = DOM.append(container, DOM.$('.manual-sync-buttons-container'));

		this.syncButton = this._register(new Button(this.buttonsContainer));
		this.syncButton.label = localize('turn on sync', "Turn on Preferences Sync");
		this.updateSyncButtonEnablement();
		this._register(attachButtonStyler(this.syncButton, this.themeService));
		this._register(this.syncButton.onDidClick(() => this.apply()));

		this.cancelButton = this._register(new Button(this.buttonsContainer, { secondary: true }));
		this.cancelButton.label = localize('cancel', "Cancel");
		this._register(attachButtonStyler(this.cancelButton, this.themeService));
		this._register(this.cancelButton.onDidClick(() => this.cancel()));

		this.treeView.dataProvider = new ManualSyncViewDataProvider(this.userDataSyncPreview);
	}

	protected layoutTreeView(height: number, width: number): void {
		const buttonContainerHeight = 117;
		this.buttonsContainer.style.height = `${buttonContainerHeight}px`;
		this.buttonsContainer.style.width = `${width}px`;
		const numberOfChanges = this.userDataSyncPreview.resources.filter(r => r.syncResource !== SyncResource.GlobalState && (r.localChange !== Change.None || r.remoteChange !== Change.None)).length;
		super.layoutTreeView(Math.min(height - buttonContainerHeight, 22 * numberOfChanges), width);
	}

	private updateSyncButtonEnablement(): void {
		this.syncButton.enabled = this.userDataSyncPreview.resources.every(c => c.syncResource === SyncResource.GlobalState || c.mergeState === MergeState.Accepted);
	}

	private registerActions(): void {
		const that = this;

		/* accept remote change */
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.acceptRemote`,
					title: localize('workbench.actions.sync.acceptRemote', "Accept Remote"),
					icon: Codicon.cloudDownload,
					menu: {
						id: MenuId.ViewItemContext,
						when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', MANUAL_SYNC_VIEW_ID), ContextKeyExpr.equals('viewItem', 'sync-resource-preview')),
						group: 'inline',
						order: 1,
					},
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				return that.acceptRemote(ManualSyncViewDataProvider.toUserDataSyncResourceGroup(handle.$treeItemHandle));
			}
		}));

		/* accept local change */
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.acceptLocal`,
					title: localize('workbench.actions.sync.acceptLocal', "Accept Local"),
					icon: Codicon.cloudUpload,
					menu: {
						id: MenuId.ViewItemContext,
						when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', MANUAL_SYNC_VIEW_ID), ContextKeyExpr.equals('viewItem', 'sync-resource-preview')),
						group: 'inline',
						order: 2,
					},
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				return that.acceptLocal(ManualSyncViewDataProvider.toUserDataSyncResourceGroup(handle.$treeItemHandle));
			}
		}));

		/* merge */
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.merge`,
					title: localize('workbench.actions.sync.merge', "Merge"),
					icon: Codicon.gitMerge,
					menu: {
						id: MenuId.ViewItemContext,
						when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', MANUAL_SYNC_VIEW_ID), ContextKeyExpr.equals('viewItem', 'sync-resource-preview')),
						group: 'inline',
						order: 3,
					},
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				return that.mergeResource(ManualSyncViewDataProvider.toUserDataSyncResourceGroup(handle.$treeItemHandle));
			}
		}));

		/* discard */
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.undo`,
					title: localize('workbench.actions.sync.discard', "Discard"),
					icon: Codicon.discard,
					menu: {
						id: MenuId.ViewItemContext,
						when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', MANUAL_SYNC_VIEW_ID), ContextKeyExpr.or(ContextKeyExpr.equals('viewItem', 'sync-resource-accepted'), ContextKeyExpr.equals('viewItem', 'sync-resource-conflict'))),
						group: 'inline',
						order: 3,
					},
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				return that.discardResource(ManualSyncViewDataProvider.toUserDataSyncResourceGroup(handle.$treeItemHandle));
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.showChanges`,
					title: localize({ key: 'workbench.actions.sync.showChanges', comment: ['This is an action title to show the changes between local and remote version of resources'] }, "Open Changes"),
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				const previewResource: IUserDataSyncResource = ManualSyncViewDataProvider.toUserDataSyncResourceGroup(handle.$treeItemHandle);
				return that.open(previewResource);
			}
		}));
	}

	private async acceptLocal(userDataSyncResource: IUserDataSyncResource): Promise<void> {
		await this.withProgress(async () => {
			const content = await this.userDataSyncService.resolveContent(userDataSyncResource.local);
			await this.userDataSyncPreview.accept(userDataSyncResource.syncResource, userDataSyncResource.local, content || '');
		});
		await this.reopen(userDataSyncResource);
	}

	private async acceptRemote(userDataSyncResource: IUserDataSyncResource): Promise<void> {
		await this.withProgress(async () => {
			const content = await this.userDataSyncService.resolveContent(userDataSyncResource.remote);
			await this.userDataSyncPreview.accept(userDataSyncResource.syncResource, userDataSyncResource.remote, content || '');
		});
		await this.reopen(userDataSyncResource);
	}

	private async mergeResource(previewResource: IUserDataSyncResource): Promise<void> {
		await this.withProgress(() => this.userDataSyncPreview.merge(previewResource.merged));
		previewResource = this.userDataSyncPreview.resources.find(({ local }) => isEqual(local, previewResource.local))!;
		if (previewResource.mergeState === MergeState.Conflict) {
			this.notificationService.warn(localize('conflicts detected', "Unable to merge due to conflicts. Please resolve them to continue."));
		}
		await this.reopen(previewResource);
	}

	private async discardResource(previewResource: IUserDataSyncResource): Promise<void> {
		this.close(previewResource);
		return this.withProgress(() => this.userDataSyncPreview.discard(previewResource.merged));
	}

	private async apply(): Promise<void> {
		this.syncButton.label = localize('turning on', "Turning on...");
		this.syncButton.enabled = false;
		this.cancelButton.enabled = false;
		return this.withProgress(async () => {
			for (const resource of this.userDataSyncPreview.resources) {
				if (resource.syncResource === SyncResource.GlobalState) {
					await this.userDataSyncPreview.merge(resource.merged);
				} else {
					this.close(resource);
				}
			}
			await this.userDataSyncPreview.apply();
		});
	}

	private async cancel(): Promise<void> {
		for (const resource of this.userDataSyncPreview.resources) {
			this.close(resource);
		}
		await this.userDataSyncPreview.cancel();
	}

	private async open(previewResource: IUserDataSyncResource): Promise<void> {
		if (previewResource.mergeState === MergeState.Accepted) {
			if (previewResource.localChange !== Change.Deleted && previewResource.remoteChange !== Change.Deleted) {
				// Do not open deleted preview
				await this.editorService.openEditor({ resource: previewResource.accepted, label: localize('preview', "{0} (Preview)", basename(previewResource.accepted)) });
			}
		} else {
			const leftResource = previewResource.remote;
			const rightResource = previewResource.mergeState === MergeState.Conflict ? previewResource.merged : previewResource.local;
			const leftResourceName = localize({ key: 'leftResourceName', comment: ['remote as in file in cloud'] }, "{0} (Remote)", basename(leftResource));
			const rightResourceName = previewResource.mergeState === MergeState.Conflict ? localize('merges', "{0} (Merges)", basename(rightResource))
				: localize({ key: 'rightResourceName', comment: ['local as in file in disk'] }, "{0} (Local)", basename(rightResource));
			await this.editorService.openEditor({
				leftResource,
				rightResource,
				label: localize('sideBySideLabels', "{0} ↔ {1}", leftResourceName, rightResourceName),
				options: {
					preserveFocus: true,
					revealIfVisible: true,
				},
			});
		}
	}

	private async reopen(previewResource: IUserDataSyncResource): Promise<void> {
		this.close(previewResource);
		const resource = this.userDataSyncPreview.resources.find(({ local }) => isEqual(local, previewResource.local));
		if (resource) {
			await this.open(resource);
		}
	}

	private close(previewResource: IUserDataSyncResource) {
		for (const input of this.editorService.editors) {
			if (input instanceof DiffEditorInput) {
				// Close all diff editors
				if (isEqual(previewResource.remote, input.secondary.resource)) {
					input.dispose();
				}
			}
			// Close all preview editors
			else if (isEqual(previewResource.accepted, input.resource)) {
				input.dispose();
			}
		}
	}

	private closeConflictEditors() {
		for (const previewResource of this.userDataSyncPreview.resources) {
			if (previewResource.mergeState !== MergeState.Conflict) {
				for (const input of this.editorService.editors) {
					if (input instanceof DiffEditorInput) {
						if (isEqual(previewResource.remote, input.secondary.resource) && isEqual(previewResource.merged, input.primary.resource)) {
							input.dispose();
						}
					}
				}
			}
		}
	}

	private withProgress(task: () => Promise<void>): Promise<void> {
		return this.progressService.withProgress({ location: MANUAL_SYNC_VIEW_ID, delay: 500 }, task);
	}

}

class ManualSyncViewDataProvider implements ITreeViewDataProvider {

	constructor(
		private readonly userDataSyncPreview: IUserDataSyncPreview
	) {
	}

	async getChildren(): Promise<ITreeItem[]> {
		const roots: ITreeItem[] = [];
		for (const resource of this.userDataSyncPreview.resources) {
			if (resource.syncResource !== SyncResource.GlobalState && (resource.localChange !== Change.None || resource.remoteChange !== Change.None)) {
				const handle = JSON.stringify(resource);
				roots.push({
					handle,
					resourceUri: resource.remote,
					label: { label: basename(resource.remote), strikethrough: resource.mergeState === MergeState.Accepted && (resource.localChange === Change.Deleted || resource.remoteChange === Change.Deleted) },
					description: getSyncAreaLabel(resource.syncResource),
					collapsibleState: TreeItemCollapsibleState.None,
					command: { id: `workbench.actions.sync.showChanges`, title: '', arguments: [<TreeViewItemHandleArg>{ $treeViewId: '', $treeItemHandle: handle }] },
					contextValue: `sync-resource-${resource.mergeState}`
				});
			}
		}
		return roots;
	}

	static toUserDataSyncResourceGroup(handle: string): IUserDataSyncResource {
		const parsed: IUserDataSyncResource = JSON.parse(handle);
		return {
			syncResource: parsed.syncResource,
			local: URI.revive(parsed.local),
			remote: URI.revive(parsed.remote),
			merged: URI.revive(parsed.merged),
			accepted: URI.revive(parsed.accepted),
			localChange: parsed.localChange,
			remoteChange: parsed.remoteChange,
			mergeState: parsed.mergeState,
		};
	}

}

class UserDataSyncResourcesDecorationProvider extends Disposable implements IDecorationsProvider {

	readonly label: string = localize('label', "UserDataSyncResources");

	private readonly _onDidChange = this._register(new Emitter<URI[]>());
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly userDataSyncPreview: IUserDataSyncPreview) {
		super();
		this._register(userDataSyncPreview.onDidChangeResources(c => this._onDidChange.fire(c.map(({ remote }) => remote))));
	}

	provideDecorations(resource: URI): IDecorationData | undefined {
		const userDataSyncResource = this.userDataSyncPreview.resources.find(c => isEqual(c.remote, resource));
		if (userDataSyncResource) {
			switch (userDataSyncResource.mergeState) {
				case MergeState.Conflict:
					return { letter: '⚠', color: listWarningForeground, tooltip: localize('conflict', "Conflicts Detected") };
				case MergeState.Accepted:
					return { letter: '✓', color: listDeemphasizedForeground, tooltip: localize('accepted', "Accepted") };
			}
		}
		return undefined;
	}
}

type AcceptChangesClassification = {
	source: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	action: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

class AcceptChangesContribution extends Disposable implements IEditorContribution {

	static get(editor: ICodeEditor): AcceptChangesContribution {
		return editor.getContribution<AcceptChangesContribution>(AcceptChangesContribution.ID);
	}

	public static readonly ID = 'editor.contrib.acceptChangesButton';

	private acceptChangesButton: FloatingClickWidget | undefined;

	constructor(
		private editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IUserDataSyncWorkbenchService private readonly userDataSyncWorkbenchService: IUserDataSyncWorkbenchService,
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editor.onDidChangeModel(() => this.update()));
		this._register(this.userDataSyncService.onDidChangeConflicts(() => this.update()));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('diffEditor.renderSideBySide'))(() => this.update()));
	}

	private update(): void {
		if (!this.shouldShowButton(this.editor)) {
			this.disposeAcceptChangesWidgetRenderer();
			return;
		}

		this.createAcceptChangesWidgetRenderer();
	}

	private shouldShowButton(editor: ICodeEditor): boolean {
		const model = editor.getModel();
		if (!model) {
			return false; // we need a model
		}

		const userDataSyncResource = this.getUserDataSyncResource(model.uri);
		if (!userDataSyncResource) {
			return false;
		}

		return true;
	}

	private createAcceptChangesWidgetRenderer(): void {
		if (!this.acceptChangesButton) {
			const resource = this.editor.getModel()!.uri;
			const userDataSyncResource = this.getUserDataSyncResource(resource)!;

			const isRemoteResource = isEqual(userDataSyncResource.remote, resource);
			const isLocalResource = isEqual(userDataSyncResource.local, resource);
			const label = isRemoteResource ? localize('accept remote', "Accept Remote")
				: isLocalResource ? localize('accept local', "Accept Local")
					: localize('accept merges', "Accept Merges");

			this.acceptChangesButton = this.instantiationService.createInstance(FloatingClickWidget, this.editor, label, null);
			this._register(this.acceptChangesButton.onClick(async () => {
				const model = this.editor.getModel();
				if (model) {
					this.telemetryService.publicLog2<{ source: string, action: string }, AcceptChangesClassification>('sync/acceptChanges', { source: userDataSyncResource.syncResource, action: isRemoteResource ? 'acceptRemote' : isLocalResource ? 'acceptLocal' : 'acceptMerges' });
					await this.userDataSyncWorkbenchService.userDataSyncPreview.accept(userDataSyncResource.syncResource, model.uri, model.getValue());
				}
			}));

			this.acceptChangesButton.render();
		}
	}

	private getUserDataSyncResource(resource: URI): IUserDataSyncResource | undefined {
		return this.userDataSyncWorkbenchService.userDataSyncPreview.resources.find(r => isEqual(resource, r.local) || isEqual(resource, r.remote) || isEqual(resource, r.merged));
	}

	private disposeAcceptChangesWidgetRenderer(): void {
		dispose(this.acceptChangesButton);
		this.acceptChangesButton = undefined;
	}

	dispose(): void {
		this.disposeAcceptChangesWidgetRenderer();
		super.dispose();
	}
}

registerEditorContribution(AcceptChangesContribution.ID, AcceptChangesContribution);
