/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextKeyService, IContextKey, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContext, IsMacContext, IsLinuxContext, IsWindowsContext, IsWebContext, IsMacNativeContext, IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ActiveEditorContext, EditorsVisibleContext, TextCompareEditorVisibleContext, TextCompareEditorActiveContext, ActiveEditorGroupEmptyContext, MultipleEditorGroupsContext, TEXT_DIFF_EDITOR_ID, SplitEditorsVertically, InEditorZenModeContext, IsCenteredLayoutContext, ActiveEditorGroupIndexContext, ActiveEditorGroupLastContext, ActiveEditorReadonlyContext, EditorAreaVisibleContext, ActiveEditorAvailableEditorIdsContext } from 'vs/workbench/common/editor';
import { trackFocus, addDisposableListener, EventType, WebFileSystemAccess } from 'vs/base/browser/dom';
import { preferredSideBySideGroupDirection, GroupDirection, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { WorkbenchState, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { SideBarVisibleContext } from 'vs/workbench/common/viewlet';
import { IWorkbenchLayoutService, Parts, positionToString } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { PanelMaximizedContext, PanelPositionContext, PanelVisibleContext } from 'vs/workbench/common/panel';
import { getRemoteName, getVirtualWorkspaceScheme } from 'vs/platform/remote/common/remoteHosts';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { isNative } from 'vs/base/common/platform';

export const WorkbenchStateContext = new RawContextKey<string>('workbenchState', undefined, { type: 'string', description: localize('workbenchState', "The kind of workspace opened in the window, either 'empty' (no workspace), 'folder' (single folder) or 'workspace' (multi-root workspace)") });
export const WorkspaceFolderCountContext = new RawContextKey<number>('workspaceFolderCount', 0, localize('workspaceFolderCount', "The number of root folders in the workspace"));
export const EmptyWorkspaceSupportContext = new RawContextKey<boolean>('emptyWorkspaceSupport', true, true);

export const DirtyWorkingCopiesContext = new RawContextKey<boolean>('dirtyWorkingCopies', false, localize('dirtyWorkingCopies', "Whether there are any dirty working copies"));

export const RemoteNameContext = new RawContextKey<string>('remoteName', '', localize('remoteName', "The name of the remote the window is connected to or an empty string if not connected to any remote"));
export const VirtualWorkspaceContext = new RawContextKey<string>('virtualWorkspace', '', localize('virtualWorkspace', "The scheme of the current workspace if is from a virtual file system or an empty string."));

export const IsFullscreenContext = new RawContextKey<boolean>('isFullscreen', false, localize('isFullscreen', "Whether the window is in fullscreen mode"));

// Support for FileSystemAccess web APIs (https://wicg.github.io/file-system-access)
export const HasWebFileSystemAccess = new RawContextKey<boolean>('hasWebFileSystemAccess', false, true);

export class WorkbenchContextKeysHandler extends Disposable {
	private inputFocusedContext: IContextKey<boolean>;

	private dirtyWorkingCopiesContext: IContextKey<boolean>;

	private activeEditorContext: IContextKey<string | null>;
	private activeEditorIsReadonly: IContextKey<boolean>;
	private activeEditorAvailableEditorIds: IContextKey<string>;

	private activeEditorGroupEmpty: IContextKey<boolean>;
	private activeEditorGroupIndex: IContextKey<number>;
	private activeEditorGroupLast: IContextKey<boolean>;
	private multipleEditorGroupsContext: IContextKey<boolean>;

	private editorsVisibleContext: IContextKey<boolean>;
	private textCompareEditorVisibleContext: IContextKey<boolean>;
	private textCompareEditorActiveContext: IContextKey<boolean>;
	private splitEditorsVerticallyContext: IContextKey<boolean>;

	private workbenchStateContext: IContextKey<string>;
	private workspaceFolderCountContext: IContextKey<number>;
	private emptyWorkspaceSupportContext: IContextKey<boolean>;

	private inZenModeContext: IContextKey<boolean>;
	private isFullscreenContext: IContextKey<boolean>;
	private isCenteredLayoutContext: IContextKey<boolean>;
	private sideBarVisibleContext: IContextKey<boolean>;
	private editorAreaVisibleContext: IContextKey<boolean>;
	private panelPositionContext: IContextKey<string>;
	private panelVisibleContext: IContextKey<boolean>;
	private panelMaximizedContext: IContextKey<boolean>;

	private vitualWorkspaceContext: IContextKey<string>;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IViewletService private readonly viewletService: IViewletService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super();

		// Platform
		IsMacContext.bindTo(this.contextKeyService);
		IsLinuxContext.bindTo(this.contextKeyService);
		IsWindowsContext.bindTo(this.contextKeyService);

		IsWebContext.bindTo(this.contextKeyService);
		IsMacNativeContext.bindTo(this.contextKeyService);

		RemoteNameContext.bindTo(this.contextKeyService).set(getRemoteName(this.environmentService.remoteAuthority) || '');

		this.vitualWorkspaceContext = VirtualWorkspaceContext.bindTo(this.contextKeyService);
		this.updateVirtualWorkspaceContextKey();

		// Capabilities
		HasWebFileSystemAccess.bindTo(this.contextKeyService).set(WebFileSystemAccess.supported(window));

		// Development
		IsDevelopmentContext.bindTo(this.contextKeyService).set(!this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment);

		// Editors
		this.activeEditorContext = ActiveEditorContext.bindTo(this.contextKeyService);
		this.activeEditorIsReadonly = ActiveEditorReadonlyContext.bindTo(this.contextKeyService);
		this.activeEditorAvailableEditorIds = ActiveEditorAvailableEditorIdsContext.bindTo(this.contextKeyService);
		this.editorsVisibleContext = EditorsVisibleContext.bindTo(this.contextKeyService);
		this.textCompareEditorVisibleContext = TextCompareEditorVisibleContext.bindTo(this.contextKeyService);
		this.textCompareEditorActiveContext = TextCompareEditorActiveContext.bindTo(this.contextKeyService);
		this.activeEditorGroupEmpty = ActiveEditorGroupEmptyContext.bindTo(this.contextKeyService);
		this.activeEditorGroupIndex = ActiveEditorGroupIndexContext.bindTo(this.contextKeyService);
		this.activeEditorGroupLast = ActiveEditorGroupLastContext.bindTo(this.contextKeyService);
		this.multipleEditorGroupsContext = MultipleEditorGroupsContext.bindTo(this.contextKeyService);

		// Working Copies
		this.dirtyWorkingCopiesContext = DirtyWorkingCopiesContext.bindTo(this.contextKeyService);
		this.dirtyWorkingCopiesContext.set(this.workingCopyService.hasDirty);

		// Inputs
		this.inputFocusedContext = InputFocusedContext.bindTo(this.contextKeyService);

		// Workbench State
		this.workbenchStateContext = WorkbenchStateContext.bindTo(this.contextKeyService);
		this.updateWorkbenchStateContextKey();

		// Workspace Folder Count
		this.workspaceFolderCountContext = WorkspaceFolderCountContext.bindTo(this.contextKeyService);
		this.updateWorkspaceFolderCountContextKey();

		// Empty workspace support: empty workspaces require a default "local" file
		// system to operate with. We always have one when running natively or when
		// we have a remote connection.
		this.emptyWorkspaceSupportContext = EmptyWorkspaceSupportContext.bindTo(this.contextKeyService);
		this.emptyWorkspaceSupportContext.set(isNative || typeof this.environmentService.remoteAuthority === 'string');

		// Editor Layout
		this.splitEditorsVerticallyContext = SplitEditorsVertically.bindTo(this.contextKeyService);
		this.updateSplitEditorsVerticallyContext();

		// Fullscreen
		this.isFullscreenContext = IsFullscreenContext.bindTo(this.contextKeyService);

		// Zen Mode
		this.inZenModeContext = InEditorZenModeContext.bindTo(this.contextKeyService);

		// Centered Layout
		this.isCenteredLayoutContext = IsCenteredLayoutContext.bindTo(this.contextKeyService);

		// Editor Area
		this.editorAreaVisibleContext = EditorAreaVisibleContext.bindTo(this.contextKeyService);

		// Sidebar
		this.sideBarVisibleContext = SideBarVisibleContext.bindTo(this.contextKeyService);

		// Panel
		this.panelPositionContext = PanelPositionContext.bindTo(this.contextKeyService);
		this.panelPositionContext.set(positionToString(this.layoutService.getPanelPosition()));
		this.panelVisibleContext = PanelVisibleContext.bindTo(this.contextKeyService);
		this.panelVisibleContext.set(this.layoutService.isVisible(Parts.PANEL_PART));
		this.panelMaximizedContext = PanelMaximizedContext.bindTo(this.contextKeyService);
		this.panelMaximizedContext.set(this.layoutService.isPanelMaximized());

		this.registerListeners();
	}

	private registerListeners(): void {
		this.editorGroupService.whenReady.then(() => this.updateEditorContextKeys());

		this._register(this.editorService.onDidActiveEditorChange(() => this.updateEditorContextKeys()));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.updateEditorContextKeys()));

		this._register(this.editorGroupService.onDidAddGroup(() => this.updateEditorContextKeys()));
		this._register(this.editorGroupService.onDidRemoveGroup(() => this.updateEditorContextKeys()));
		this._register(this.editorGroupService.onDidChangeGroupIndex(() => this.updateEditorContextKeys()));

		this._register(addDisposableListener(window, EventType.FOCUS_IN, () => this.updateInputContextKeys(), true));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateWorkbenchStateContextKey()));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => {
			this.updateWorkspaceFolderCountContextKey();
			this.updateVirtualWorkspaceContextKey();
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.editor.openSideBySideDirection')) {
				this.updateSplitEditorsVerticallyContext();
			}
		}));

		this._register(this.layoutService.onDidChangeZenMode(enabled => this.inZenModeContext.set(enabled)));
		this._register(this.layoutService.onDidChangeFullscreen(fullscreen => this.isFullscreenContext.set(fullscreen)));
		this._register(this.layoutService.onDidChangeCenteredLayout(centered => this.isCenteredLayoutContext.set(centered)));
		this._register(this.layoutService.onDidChangePanelPosition(position => this.panelPositionContext.set(position)));

		this._register(this.viewletService.onDidViewletClose(() => this.updateSideBarContextKeys()));
		this._register(this.viewletService.onDidViewletOpen(() => this.updateSideBarContextKeys()));

		this._register(this.layoutService.onDidChangePartVisibility(() => {
			this.editorAreaVisibleContext.set(this.layoutService.isVisible(Parts.EDITOR_PART));
			this.panelVisibleContext.set(this.layoutService.isVisible(Parts.PANEL_PART));
			this.panelMaximizedContext.set(this.layoutService.isPanelMaximized());
		}));

		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.dirtyWorkingCopiesContext.set(workingCopy.isDirty() || this.workingCopyService.hasDirty)));
	}

	private updateEditorContextKeys(): void {
		const activeGroup = this.editorGroupService.activeGroup;
		const activeEditorPane = this.editorService.activeEditorPane;
		const visibleEditorPanes = this.editorService.visibleEditorPanes;

		this.textCompareEditorActiveContext.set(activeEditorPane?.getId() === TEXT_DIFF_EDITOR_ID);
		this.textCompareEditorVisibleContext.set(visibleEditorPanes.some(editorPane => editorPane.getId() === TEXT_DIFF_EDITOR_ID));

		if (visibleEditorPanes.length > 0) {
			this.editorsVisibleContext.set(true);
		} else {
			this.editorsVisibleContext.reset();
		}

		if (!this.editorService.activeEditor) {
			this.activeEditorGroupEmpty.set(true);
		} else {
			this.activeEditorGroupEmpty.reset();
		}

		const groupCount = this.editorGroupService.count;
		if (groupCount > 1) {
			this.multipleEditorGroupsContext.set(true);
		} else {
			this.multipleEditorGroupsContext.reset();
		}

		this.activeEditorGroupIndex.set(activeGroup.index + 1); // not zero-indexed
		this.activeEditorGroupLast.set(activeGroup.index === groupCount - 1);

		if (activeEditorPane) {
			this.activeEditorContext.set(activeEditorPane.getId());
			this.activeEditorIsReadonly.set(activeEditorPane.input.isReadonly());

			const activeEditorResource = activeEditorPane.input.resource;
			const editors = activeEditorResource ? this.editorService.getEditorOverrides(activeEditorResource, undefined, activeGroup) : [];
			this.activeEditorAvailableEditorIds.set(editors.map(([_, entry]) => entry.id).join(','));
		} else {
			this.activeEditorContext.reset();
			this.activeEditorIsReadonly.reset();
			this.activeEditorAvailableEditorIds.reset();
		}
	}

	private updateInputContextKeys(): void {

		function activeElementIsInput(): boolean {
			return !!document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
		}

		const isInputFocused = activeElementIsInput();
		this.inputFocusedContext.set(isInputFocused);

		if (isInputFocused) {
			const tracker = trackFocus(document.activeElement as HTMLElement);
			Event.once(tracker.onDidBlur)(() => {
				this.inputFocusedContext.set(activeElementIsInput());

				tracker.dispose();
			});
		}
	}

	private updateWorkbenchStateContextKey(): void {
		this.workbenchStateContext.set(this.getWorkbenchStateString());
	}

	private updateWorkspaceFolderCountContextKey(): void {
		this.workspaceFolderCountContext.set(this.contextService.getWorkspace().folders.length);
	}

	private updateSplitEditorsVerticallyContext(): void {
		const direction = preferredSideBySideGroupDirection(this.configurationService);
		this.splitEditorsVerticallyContext.set(direction === GroupDirection.DOWN);
	}

	private getWorkbenchStateString(): string {
		switch (this.contextService.getWorkbenchState()) {
			case WorkbenchState.EMPTY: return 'empty';
			case WorkbenchState.FOLDER: return 'folder';
			case WorkbenchState.WORKSPACE: return 'workspace';
		}
	}

	private updateSideBarContextKeys(): void {
		this.sideBarVisibleContext.set(this.layoutService.isVisible(Parts.SIDEBAR_PART));
	}

	private updateVirtualWorkspaceContextKey(): void {
		this.vitualWorkspaceContext.set(getVirtualWorkspaceScheme(this.contextService.getWorkspace()) || '');
	}
}
