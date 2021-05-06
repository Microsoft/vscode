/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IEditorInput, IEditorIdentifier, IEditorCommandsContext, CloseDirection, SaveReason, EditorsOrder, SideBySideEditorInput } from 'vs/workbench/common/editor';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { CLOSE_EDITOR_COMMAND_ID, MOVE_ACTIVE_EDITOR_COMMAND_ID, ActiveEditorMoveArguments, SPLIT_EDITOR_LEFT, SPLIT_EDITOR_RIGHT, SPLIT_EDITOR_UP, SPLIT_EDITOR_DOWN, splitEditor, LAYOUT_EDITOR_GROUPS_COMMAND_ID, UNPIN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { IEditorGroupsService, IEditorGroup, GroupsArrangement, GroupLocation, GroupDirection, preferredSideBySideGroupDirection, IFindGroupScope, GroupOrientation, EditorGroupLayout, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IFileDialogService, ConfirmResult } from 'vs/platform/dialogs/common/dialogs';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ItemActivation, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { AllEditorsByMostRecentlyUsedQuickAccess, ActiveGroupEditorsByMostRecentlyUsedQuickAccess, AllEditorsByAppearanceQuickAccess } from 'vs/workbench/browser/parts/editor/editorQuickAccess';
import { Codicon } from 'vs/base/common/codicons';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { EditorOverride } from 'vs/platform/editor/common/editor';
import { Schemas } from 'vs/base/common/network';

export class ExecuteCommandAction extends Action {

	constructor(
		id: string,
		label: string,
		private commandId: string,
		private commandService: ICommandService,
		private commandArgs?: unknown
	) {
		super(id, label);
	}

	override run(): Promise<void> {
		return this.commandService.executeCommand(this.commandId, this.commandArgs);
	}
}

export class BaseSplitEditorAction extends Action {
	private readonly toDispose = this._register(new DisposableStore());
	private direction: GroupDirection;

	constructor(
		id: string,
		label: string,
		protected editorGroupService: IEditorGroupsService,
		protected configurationService: IConfigurationService
	) {
		super(id, label);

		this.direction = this.getDirection();

		this.registerListeners();
	}

	protected getDirection(): GroupDirection {
		return preferredSideBySideGroupDirection(this.configurationService);
	}

	private registerListeners(): void {
		this.toDispose.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.editor.openSideBySideDirection')) {
				this.direction = preferredSideBySideGroupDirection(this.configurationService);
			}
		}));
	}

	override async run(context?: IEditorIdentifier): Promise<void> {
		splitEditor(this.editorGroupService, this.direction, context);
	}
}

export class SplitEditorAction extends BaseSplitEditorAction {

	static readonly ID = 'workbench.action.splitEditor';
	static readonly LABEL = localize('splitEditor', "Split Editor");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, editorGroupService, configurationService);
	}
}

export class SplitEditorOrthogonalAction extends BaseSplitEditorAction {

	static readonly ID = 'workbench.action.splitEditorOrthogonal';
	static readonly LABEL = localize('splitEditorOrthogonal', "Split Editor Orthogonal");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, editorGroupService, configurationService);
	}

	protected override getDirection(): GroupDirection {
		const direction = preferredSideBySideGroupDirection(this.configurationService);

		return direction === GroupDirection.RIGHT ? GroupDirection.DOWN : GroupDirection.RIGHT;
	}
}

export class SplitEditorLeftAction extends ExecuteCommandAction {

	static readonly ID = SPLIT_EDITOR_LEFT;
	static readonly LABEL = localize('splitEditorGroupLeft', "Split Editor Left");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, SPLIT_EDITOR_LEFT, commandService);
	}
}

export class SplitEditorRightAction extends ExecuteCommandAction {

	static readonly ID = SPLIT_EDITOR_RIGHT;
	static readonly LABEL = localize('splitEditorGroupRight', "Split Editor Right");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, SPLIT_EDITOR_RIGHT, commandService);
	}
}

export class SplitEditorUpAction extends ExecuteCommandAction {

	static readonly ID = SPLIT_EDITOR_UP;
	static readonly LABEL = localize('splitEditorGroupUp', "Split Editor Up");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, SPLIT_EDITOR_UP, commandService);
	}
}

export class SplitEditorDownAction extends ExecuteCommandAction {

	static readonly ID = SPLIT_EDITOR_DOWN;
	static readonly LABEL = localize('splitEditorGroupDown', "Split Editor Down");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, SPLIT_EDITOR_DOWN, commandService);
	}
}

export class JoinTwoGroupsAction extends Action {

	static readonly ID = 'workbench.action.joinTwoGroups';
	static readonly LABEL = localize('joinTwoGroups', "Join Editor Group with Next Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(context?: IEditorIdentifier): Promise<void> {
		let sourceGroup: IEditorGroup | undefined;
		if (context && typeof context.groupId === 'number') {
			sourceGroup = this.editorGroupService.getGroup(context.groupId);
		} else {
			sourceGroup = this.editorGroupService.activeGroup;
		}

		if (sourceGroup) {
			const targetGroupDirections = [GroupDirection.RIGHT, GroupDirection.DOWN, GroupDirection.LEFT, GroupDirection.UP];
			for (const targetGroupDirection of targetGroupDirections) {
				const targetGroup = this.editorGroupService.findGroup({ direction: targetGroupDirection }, sourceGroup);
				if (targetGroup && sourceGroup !== targetGroup) {
					this.editorGroupService.mergeGroup(sourceGroup, targetGroup);

					break;
				}
			}
		}
	}
}

export class JoinAllGroupsAction extends Action {

	static readonly ID = 'workbench.action.joinAllGroups';
	static readonly LABEL = localize('joinAllGroups', "Join All Editor Groups");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.mergeAllGroups();
	}
}

export class NavigateBetweenGroupsAction extends Action {

	static readonly ID = 'workbench.action.navigateEditorGroups';
	static readonly LABEL = localize('navigateEditorGroups', "Navigate Between Editor Groups");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const nextGroup = this.editorGroupService.findGroup({ location: GroupLocation.NEXT }, this.editorGroupService.activeGroup, true);
		nextGroup.focus();
	}
}

export class FocusActiveGroupAction extends Action {

	static readonly ID = 'workbench.action.focusActiveEditorGroup';
	static readonly LABEL = localize('focusActiveEditorGroup', "Focus Active Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.activeGroup.focus();
	}
}

export abstract class BaseFocusGroupAction extends Action {

	constructor(
		id: string,
		label: string,
		private scope: IFindGroupScope,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const group = this.editorGroupService.findGroup(this.scope, this.editorGroupService.activeGroup, true);
		if (group) {
			group.focus();
		}
	}
}

export class FocusFirstGroupAction extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusFirstEditorGroup';
	static readonly LABEL = localize('focusFirstEditorGroup', "Focus First Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { location: GroupLocation.FIRST }, editorGroupService);
	}
}

export class FocusLastGroupAction extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusLastEditorGroup';
	static readonly LABEL = localize('focusLastEditorGroup', "Focus Last Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { location: GroupLocation.LAST }, editorGroupService);
	}
}

export class FocusNextGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusNextGroup';
	static readonly LABEL = localize('focusNextGroup', "Focus Next Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { location: GroupLocation.NEXT }, editorGroupService);
	}
}

export class FocusPreviousGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusPreviousGroup';
	static readonly LABEL = localize('focusPreviousGroup', "Focus Previous Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { location: GroupLocation.PREVIOUS }, editorGroupService);
	}
}

export class FocusLeftGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusLeftGroup';
	static readonly LABEL = localize('focusLeftGroup', "Focus Left Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { direction: GroupDirection.LEFT }, editorGroupService);
	}
}

export class FocusRightGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusRightGroup';
	static readonly LABEL = localize('focusRightGroup', "Focus Right Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { direction: GroupDirection.RIGHT }, editorGroupService);
	}
}

export class FocusAboveGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusAboveGroup';
	static readonly LABEL = localize('focusAboveGroup', "Focus Above Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { direction: GroupDirection.UP }, editorGroupService);
	}
}

export class FocusBelowGroup extends BaseFocusGroupAction {

	static readonly ID = 'workbench.action.focusBelowGroup';
	static readonly LABEL = localize('focusBelowGroup', "Focus Below Editor Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, { direction: GroupDirection.DOWN }, editorGroupService);
	}
}

export class CloseEditorAction extends Action {

	static readonly ID = 'workbench.action.closeActiveEditor';
	static readonly LABEL = localize('closeEditor', "Close Editor");

	constructor(
		id: string,
		label: string,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, label, Codicon.close.classNames);
	}

	override run(context?: IEditorCommandsContext): Promise<void> {
		return this.commandService.executeCommand(CLOSE_EDITOR_COMMAND_ID, undefined, context);
	}
}

export class UnpinEditorAction extends Action {

	static readonly ID = 'workbench.action.unpinActiveEditor';
	static readonly LABEL = localize('unpinEditor', "Unpin Editor");

	constructor(
		id: string,
		label: string,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, label, Codicon.pinned.classNames);
	}

	override run(context?: IEditorCommandsContext): Promise<void> {
		return this.commandService.executeCommand(UNPIN_EDITOR_COMMAND_ID, undefined, context);
	}
}

export class CloseOneEditorAction extends Action {

	static readonly ID = 'workbench.action.closeActiveEditor';
	static readonly LABEL = localize('closeOneEditor', "Close");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label, Codicon.close.classNames);
	}

	override async run(context?: IEditorCommandsContext): Promise<void> {
		let group: IEditorGroup | undefined;
		let editorIndex: number | undefined;
		if (context) {
			group = this.editorGroupService.getGroup(context.groupId);

			if (group) {
				editorIndex = context.editorIndex; // only allow editor at index if group is valid
			}
		}

		if (!group) {
			group = this.editorGroupService.activeGroup;
		}

		// Close specific editor in group
		if (typeof editorIndex === 'number') {
			const editorAtIndex = group.getEditorByIndex(editorIndex);
			if (editorAtIndex) {
				return group.closeEditor(editorAtIndex);
			}
		}

		// Otherwise close active editor in group
		if (group.activeEditor) {
			return group.closeEditor(group.activeEditor);
		}
	}
}

export class RevertAndCloseEditorAction extends Action {

	static readonly ID = 'workbench.action.revertAndCloseActiveEditor';
	static readonly LABEL = localize('revertAndCloseActiveEditor', "Revert and Close Editor");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const activeEditorPane = this.editorService.activeEditorPane;
		if (activeEditorPane) {
			const editor = activeEditorPane.input;
			const group = activeEditorPane.group;

			// first try a normal revert where the contents of the editor are restored
			try {
				await this.editorService.revert({ editor, groupId: group.id });
			} catch (error) {
				// if that fails, since we are about to close the editor, we accept that
				// the editor cannot be reverted and instead do a soft revert that just
				// enables us to close the editor. With this, a user can always close a
				// dirty editor even when reverting fails.
				await this.editorService.revert({ editor, groupId: group.id }, { soft: true });
			}

			return group.closeEditor(editor);
		}
	}
}

export class CloseLeftEditorsInGroupAction extends Action {

	static readonly ID = 'workbench.action.closeEditorsToTheLeft';
	static readonly LABEL = localize('closeEditorsToTheLeft', "Close Editors to the Left in Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(context?: IEditorIdentifier): Promise<void> {
		const { group, editor } = this.getTarget(context);
		if (group && editor) {
			return group.closeEditors({ direction: CloseDirection.LEFT, except: editor, excludeSticky: true });
		}
	}

	private getTarget(context?: IEditorIdentifier): { editor: IEditorInput | null, group: IEditorGroup | undefined } {
		if (context) {
			return { editor: context.editor, group: this.editorGroupService.getGroup(context.groupId) };
		}

		// Fallback to active group
		return { group: this.editorGroupService.activeGroup, editor: this.editorGroupService.activeGroup.activeEditor };
	}
}

abstract class BaseCloseAllAction extends Action {

	constructor(
		id: string,
		label: string,
		clazz: string | undefined,
		private workingCopyService: IWorkingCopyService,
		private fileDialogService: IFileDialogService,
		protected editorGroupService: IEditorGroupsService,
		private editorService: IEditorService,
		private filesConfigurationService: IFilesConfigurationService
	) {
		super(id, label, clazz);
	}

	protected get groupsToClose(): IEditorGroup[] {
		const groupsToClose: IEditorGroup[] = [];

		// Close editors in reverse order of their grid appearance so that the editor
		// group that is the first (top-left) remains. This helps to keep view state
		// for editors around that have been opened in this visually first group.
		const groups = this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE);
		for (let i = groups.length - 1; i >= 0; i--) {
			groupsToClose.push(groups[i]);
		}

		return groupsToClose;
	}

	override async run(): Promise<void> {

		// Just close all if there are no dirty editors
		if (!this.workingCopyService.hasDirty) {
			return this.doCloseAll();
		}

		// Otherwise ask for combined confirmation and make sure
		// to bring each dirty editor to the front so that the user
		// can review if the files should be changed or not.
		await Promise.all(this.groupsToClose.map(groupToClose => {
			for (const editor of groupToClose.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: this.excludeSticky })) {
				if (editor.isDirty() && !editor.isSaving() /* ignore editors that are being saved */) {
					return groupToClose.openEditor(editor);
				}
			}

			return undefined;
		}));

		const dirtyEditorsToConfirm = new Set<string>();
		const dirtyEditorsToAutoSave = new Set<IEditorInput>();

		for (const editor of this.editorService.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: this.excludeSticky }).map(({ editor }) => editor)) {
			if (!editor.isDirty() || editor.isSaving()) {
				continue; // only interested in dirty editors (unless in the process of saving)
			}

			// Auto-save on focus change: assume to Save unless the editor is untitled
			// because bringing up a dialog would save in this case anyway.
			if (this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.ON_FOCUS_CHANGE && !editor.isUntitled()) {
				dirtyEditorsToAutoSave.add(editor);
			}

			// No auto-save on focus change: ask user
			else {
				let name: string;
				if (editor instanceof SideBySideEditorInput) {
					name = editor.primary.getName(); // prefer shorter names by using primary's name in this case
				} else {
					name = editor.getName();
				}

				dirtyEditorsToConfirm.add(name);
			}
		}

		let confirmation: ConfirmResult;
		let saveReason = SaveReason.EXPLICIT;
		if (dirtyEditorsToConfirm.size > 0) {
			confirmation = await this.fileDialogService.showSaveConfirm(Array.from(dirtyEditorsToConfirm.values()));
		} else if (dirtyEditorsToAutoSave.size > 0) {
			confirmation = ConfirmResult.SAVE;
			saveReason = SaveReason.FOCUS_CHANGE;
		} else {
			confirmation = ConfirmResult.DONT_SAVE;
		}

		// Handle result from asking user
		let result: boolean | undefined = undefined;
		switch (confirmation) {
			case ConfirmResult.CANCEL:
				return;
			case ConfirmResult.DONT_SAVE:
				result = await this.editorService.revertAll({ soft: true, includeUntitled: true, excludeSticky: this.excludeSticky });
				break;
			case ConfirmResult.SAVE:
				result = await this.editorService.saveAll({ reason: saveReason, includeUntitled: true, excludeSticky: this.excludeSticky });
				break;
		}


		// Only continue to close editors if we either have no more dirty
		// editors or the result from the save/revert was successful
		if (!this.workingCopyService.hasDirty || result) {
			return this.doCloseAll();
		}
	}

	protected abstract get excludeSticky(): boolean;

	protected abstract doCloseAll(): Promise<void>;
}

export class CloseAllEditorsAction extends BaseCloseAllAction {

	static readonly ID = 'workbench.action.closeAllEditors';
	static readonly LABEL = localize('closeAllEditors', "Close All Editors");

	constructor(
		id: string,
		label: string,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(id, label, Codicon.closeAll.classNames, workingCopyService, fileDialogService, editorGroupService, editorService, filesConfigurationService);
	}

	protected get excludeSticky(): boolean {
		return true;
	}

	protected async doCloseAll(): Promise<void> {
		await Promise.all(this.groupsToClose.map(group => group.closeAllEditors({ excludeSticky: true })));
	}
}

export class CloseAllEditorGroupsAction extends BaseCloseAllAction {

	static readonly ID = 'workbench.action.closeAllGroups';
	static readonly LABEL = localize('closeAllGroups', "Close All Editor Groups");

	constructor(
		id: string,
		label: string,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(id, label, undefined, workingCopyService, fileDialogService, editorGroupService, editorService, filesConfigurationService);
	}

	protected get excludeSticky(): boolean {
		return false;
	}

	protected async doCloseAll(): Promise<void> {
		await Promise.all(this.groupsToClose.map(group => group.closeAllEditors()));

		for (const groupToClose of this.groupsToClose) {
			this.editorGroupService.removeGroup(groupToClose);
		}
	}
}

export class CloseEditorsInOtherGroupsAction extends Action {

	static readonly ID = 'workbench.action.closeEditorsInOtherGroups';
	static readonly LABEL = localize('closeEditorsInOtherGroups', "Close Editors in Other Groups");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
	) {
		super(id, label);
	}

	override async run(context?: IEditorIdentifier): Promise<void> {
		const groupToSkip = context ? this.editorGroupService.getGroup(context.groupId) : this.editorGroupService.activeGroup;
		await Promise.all(this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).map(async group => {
			if (groupToSkip && group.id === groupToSkip.id) {
				return;
			}

			return group.closeAllEditors({ excludeSticky: true });
		}));
	}
}

export class CloseEditorInAllGroupsAction extends Action {

	static readonly ID = 'workbench.action.closeEditorInAllGroups';
	static readonly LABEL = localize('closeEditorInAllGroups', "Close Editor in All Groups");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const activeEditor = this.editorService.activeEditor;
		if (activeEditor) {
			await Promise.all(this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).map(group => group.closeEditor(activeEditor)));
		}
	}
}

class BaseMoveCopyGroupAction extends Action {

	constructor(
		id: string,
		label: string,
		private direction: GroupDirection,
		private isMove: boolean,
		private editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(context?: IEditorIdentifier): Promise<void> {
		let sourceGroup: IEditorGroup | undefined;
		if (context && typeof context.groupId === 'number') {
			sourceGroup = this.editorGroupService.getGroup(context.groupId);
		} else {
			sourceGroup = this.editorGroupService.activeGroup;
		}

		if (sourceGroup) {
			let resultGroup: IEditorGroup | undefined = undefined;
			if (this.isMove) {
				const targetGroup = this.findTargetGroup(sourceGroup);
				if (targetGroup) {
					resultGroup = this.editorGroupService.moveGroup(sourceGroup, targetGroup, this.direction);
				}
			} else {
				resultGroup = this.editorGroupService.copyGroup(sourceGroup, sourceGroup, this.direction);
			}

			if (resultGroup) {
				this.editorGroupService.activateGroup(resultGroup);
			}
		}
	}

	private findTargetGroup(sourceGroup: IEditorGroup): IEditorGroup | undefined {
		const targetNeighbours: GroupDirection[] = [this.direction];

		// Allow the target group to be in alternative locations to support more
		// scenarios of moving the group to the taret location.
		// Helps for https://github.com/microsoft/vscode/issues/50741
		switch (this.direction) {
			case GroupDirection.LEFT:
			case GroupDirection.RIGHT:
				targetNeighbours.push(GroupDirection.UP, GroupDirection.DOWN);
				break;
			case GroupDirection.UP:
			case GroupDirection.DOWN:
				targetNeighbours.push(GroupDirection.LEFT, GroupDirection.RIGHT);
				break;
		}

		for (const targetNeighbour of targetNeighbours) {
			const targetNeighbourGroup = this.editorGroupService.findGroup({ direction: targetNeighbour }, sourceGroup);
			if (targetNeighbourGroup) {
				return targetNeighbourGroup;
			}
		}

		return undefined;
	}
}

class BaseMoveGroupAction extends BaseMoveCopyGroupAction {

	constructor(
		id: string,
		label: string,
		direction: GroupDirection,
		editorGroupService: IEditorGroupsService
	) {
		super(id, label, direction, true, editorGroupService);
	}
}

export class MoveGroupLeftAction extends BaseMoveGroupAction {

	static readonly ID = 'workbench.action.moveActiveEditorGroupLeft';
	static readonly LABEL = localize('moveActiveGroupLeft', "Move Editor Group Left");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.LEFT, editorGroupService);
	}
}

export class MoveGroupRightAction extends BaseMoveGroupAction {

	static readonly ID = 'workbench.action.moveActiveEditorGroupRight';
	static readonly LABEL = localize('moveActiveGroupRight', "Move Editor Group Right");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.RIGHT, editorGroupService);
	}
}

export class MoveGroupUpAction extends BaseMoveGroupAction {

	static readonly ID = 'workbench.action.moveActiveEditorGroupUp';
	static readonly LABEL = localize('moveActiveGroupUp', "Move Editor Group Up");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.UP, editorGroupService);
	}
}

export class MoveGroupDownAction extends BaseMoveGroupAction {

	static readonly ID = 'workbench.action.moveActiveEditorGroupDown';
	static readonly LABEL = localize('moveActiveGroupDown', "Move Editor Group Down");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.DOWN, editorGroupService);
	}
}

class BaseDuplicateGroupAction extends BaseMoveCopyGroupAction {

	constructor(
		id: string,
		label: string,
		direction: GroupDirection,
		editorGroupService: IEditorGroupsService
	) {
		super(id, label, direction, false, editorGroupService);
	}
}

export class DuplicateGroupLeftAction extends BaseDuplicateGroupAction {

	static readonly ID = 'workbench.action.duplicateActiveEditorGroupLeft';
	static readonly LABEL = localize('duplicateActiveGroupLeft', "Duplicate Editor Group Left");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.LEFT, editorGroupService);
	}
}

export class DuplicateGroupRightAction extends BaseDuplicateGroupAction {

	static readonly ID = 'workbench.action.duplicateActiveEditorGroupRight';
	static readonly LABEL = localize('duplicateActiveGroupRight', "Duplicate Editor Group Right");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.RIGHT, editorGroupService);
	}
}

export class DuplicateGroupUpAction extends BaseDuplicateGroupAction {

	static readonly ID = 'workbench.action.duplicateActiveEditorGroupUp';
	static readonly LABEL = localize('duplicateActiveGroupUp', "Duplicate Editor Group Up");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.UP, editorGroupService);
	}
}

export class DuplicateGroupDownAction extends BaseDuplicateGroupAction {

	static readonly ID = 'workbench.action.duplicateActiveEditorGroupDown';
	static readonly LABEL = localize('duplicateActiveGroupDown', "Duplicate Editor Group Down");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.DOWN, editorGroupService);
	}
}

export class MinimizeOtherGroupsAction extends Action {

	static readonly ID = 'workbench.action.minimizeOtherEditors';
	static readonly LABEL = localize('minimizeOtherEditorGroups', "Maximize Editor Group");

	constructor(id: string, label: string, @IEditorGroupsService private readonly editorGroupService: IEditorGroupsService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.arrangeGroups(GroupsArrangement.MINIMIZE_OTHERS);
	}
}

export class ResetGroupSizesAction extends Action {

	static readonly ID = 'workbench.action.evenEditorWidths';
	static readonly LABEL = localize('evenEditorGroups', "Reset Editor Group Sizes");

	constructor(id: string, label: string, @IEditorGroupsService private readonly editorGroupService: IEditorGroupsService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.arrangeGroups(GroupsArrangement.EVEN);
	}
}

export class ToggleGroupSizesAction extends Action {

	static readonly ID = 'workbench.action.toggleEditorWidths';
	static readonly LABEL = localize('toggleEditorWidths', "Toggle Editor Group Sizes");

	constructor(id: string, label: string, @IEditorGroupsService private readonly editorGroupService: IEditorGroupsService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.arrangeGroups(GroupsArrangement.TOGGLE);
	}
}

export class MaximizeGroupAction extends Action {

	static readonly ID = 'workbench.action.maximizeEditor';
	static readonly LABEL = localize('maximizeEditor', "Maximize Editor Group and Hide Side Bar");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		if (this.editorService.activeEditor) {
			this.editorGroupService.arrangeGroups(GroupsArrangement.MINIMIZE_OTHERS);
			this.layoutService.setSideBarHidden(true);
		}
	}
}

export abstract class BaseNavigateEditorAction extends Action {

	constructor(
		id: string,
		label: string,
		protected editorGroupService: IEditorGroupsService,
		protected editorService: IEditorService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const result = this.navigate();
		if (!result) {
			return;
		}

		const { groupId, editor } = result;
		if (!editor) {
			return;
		}

		const group = this.editorGroupService.getGroup(groupId);
		if (group) {
			await group.openEditor(editor);
		}
	}

	protected abstract navigate(): IEditorIdentifier | undefined;
}

export class OpenNextEditor extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.nextEditor';
	static readonly LABEL = localize('openNextEditor', "Open Next Editor");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier | undefined {

		// Navigate in active group if possible
		const activeGroup = this.editorGroupService.activeGroup;
		const activeGroupEditors = activeGroup.getEditors(EditorsOrder.SEQUENTIAL);
		const activeEditorIndex = activeGroup.activeEditor ? activeGroupEditors.indexOf(activeGroup.activeEditor) : -1;
		if (activeEditorIndex + 1 < activeGroupEditors.length) {
			return { editor: activeGroupEditors[activeEditorIndex + 1], groupId: activeGroup.id };
		}

		// Otherwise try in next group
		const nextGroup = this.editorGroupService.findGroup({ location: GroupLocation.NEXT }, this.editorGroupService.activeGroup, true);
		if (nextGroup) {
			const previousGroupEditors = nextGroup.getEditors(EditorsOrder.SEQUENTIAL);
			return { editor: previousGroupEditors[0], groupId: nextGroup.id };
		}

		return undefined;
	}
}

export class OpenPreviousEditor extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.previousEditor';
	static readonly LABEL = localize('openPreviousEditor', "Open Previous Editor");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier | undefined {

		// Navigate in active group if possible
		const activeGroup = this.editorGroupService.activeGroup;
		const activeGroupEditors = activeGroup.getEditors(EditorsOrder.SEQUENTIAL);
		const activeEditorIndex = activeGroup.activeEditor ? activeGroupEditors.indexOf(activeGroup.activeEditor) : -1;
		if (activeEditorIndex > 0) {
			return { editor: activeGroupEditors[activeEditorIndex - 1], groupId: activeGroup.id };
		}

		// Otherwise try in previous group
		const previousGroup = this.editorGroupService.findGroup({ location: GroupLocation.PREVIOUS }, this.editorGroupService.activeGroup, true);
		if (previousGroup) {
			const previousGroupEditors = previousGroup.getEditors(EditorsOrder.SEQUENTIAL);
			return { editor: previousGroupEditors[previousGroupEditors.length - 1], groupId: previousGroup.id };
		}

		return undefined;
	}
}

export class OpenNextEditorInGroup extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.nextEditorInGroup';
	static readonly LABEL = localize('nextEditorInGroup', "Open Next Editor in Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier {
		const group = this.editorGroupService.activeGroup;
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);
		const index = group.activeEditor ? editors.indexOf(group.activeEditor) : -1;

		return { editor: index + 1 < editors.length ? editors[index + 1] : editors[0], groupId: group.id };
	}
}

export class OpenPreviousEditorInGroup extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.previousEditorInGroup';
	static readonly LABEL = localize('openPreviousEditorInGroup', "Open Previous Editor in Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier {
		const group = this.editorGroupService.activeGroup;
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);
		const index = group.activeEditor ? editors.indexOf(group.activeEditor) : -1;

		return { editor: index > 0 ? editors[index - 1] : editors[editors.length - 1], groupId: group.id };
	}
}

export class OpenFirstEditorInGroup extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.firstEditorInGroup';
	static readonly LABEL = localize('firstEditorInGroup', "Open First Editor in Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier {
		const group = this.editorGroupService.activeGroup;
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);

		return { editor: editors[0], groupId: group.id };
	}
}

export class OpenLastEditorInGroup extends BaseNavigateEditorAction {

	static readonly ID = 'workbench.action.lastEditorInGroup';
	static readonly LABEL = localize('lastEditorInGroup', "Open Last Editor in Group");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, label, editorGroupService, editorService);
	}

	protected navigate(): IEditorIdentifier {
		const group = this.editorGroupService.activeGroup;
		const editors = group.getEditors(EditorsOrder.SEQUENTIAL);

		return { editor: editors[editors.length - 1], groupId: group.id };
	}
}

export class NavigateForwardAction extends Action {

	static readonly ID = 'workbench.action.navigateForward';
	static readonly LABEL = localize('navigateNext', "Go Forward");

	constructor(id: string, label: string, @IHistoryService private readonly historyService: IHistoryService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.forward();
	}
}

export class NavigateBackwardsAction extends Action {

	static readonly ID = 'workbench.action.navigateBack';
	static readonly LABEL = localize('navigatePrevious', "Go Back");

	constructor(id: string, label: string, @IHistoryService private readonly historyService: IHistoryService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.back();
	}
}

export class NavigateToLastEditLocationAction extends Action {

	static readonly ID = 'workbench.action.navigateToLastEditLocation';
	static readonly LABEL = localize('navigateToLastEditLocation', "Go to Last Edit Location");

	constructor(id: string, label: string, @IHistoryService private readonly historyService: IHistoryService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.openLastEditLocation();
	}
}

export class NavigateLastAction extends Action {

	static readonly ID = 'workbench.action.navigateLast';
	static readonly LABEL = localize('navigateLast', "Go Last");

	constructor(id: string, label: string, @IHistoryService private readonly historyService: IHistoryService) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.last();
	}
}

export class ReopenClosedEditorAction extends Action {

	static readonly ID = 'workbench.action.reopenClosedEditor';
	static readonly LABEL = localize('reopenClosedEditor', "Reopen Closed Editor");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.reopenLastClosedEditor();
	}
}

export class ClearRecentFilesAction extends Action {

	static readonly ID = 'workbench.action.clearRecentFiles';
	static readonly LABEL = localize('clearRecentFiles', "Clear Recently Opened");

	constructor(
		id: string,
		label: string,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {

		// Clear global recently opened
		this.workspacesService.clearRecentlyOpened();

		// Clear workspace specific recently opened
		this.historyService.clearRecentlyOpened();
	}
}

export class ShowEditorsInActiveGroupByMostRecentlyUsedAction extends Action {

	static readonly ID = 'workbench.action.showEditorsInActiveGroup';
	static readonly LABEL = localize('showEditorsInActiveGroup', "Show Editors in Active Group By Most Recently Used");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.quickInputService.quickAccess.show(ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX);
	}
}

export class ShowAllEditorsByAppearanceAction extends Action {

	static readonly ID = 'workbench.action.showAllEditors';
	static readonly LABEL = localize('showAllEditors', "Show All Editors By Appearance");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.quickInputService.quickAccess.show(AllEditorsByAppearanceQuickAccess.PREFIX);
	}
}

export class ShowAllEditorsByMostRecentlyUsedAction extends Action {

	static readonly ID = 'workbench.action.showAllEditorsByMostRecentlyUsed';
	static readonly LABEL = localize('showAllEditorsByMostRecentlyUsed', "Show All Editors By Most Recently Used");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.quickInputService.quickAccess.show(AllEditorsByMostRecentlyUsedQuickAccess.PREFIX);
	}
}

export class BaseQuickAccessEditorAction extends Action {

	constructor(
		id: string,
		label: string,
		private prefix: string,
		private itemActivation: ItemActivation | undefined,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const keybindings = this.keybindingService.lookupKeybindings(this.id);

		this.quickInputService.quickAccess.show(this.prefix, {
			quickNavigateConfiguration: { keybindings },
			itemActivation: this.itemActivation
		});
	}
}

export class QuickAccessPreviousRecentlyUsedEditorAction extends BaseQuickAccessEditorAction {

	static readonly ID = 'workbench.action.quickOpenPreviousRecentlyUsedEditor';
	static readonly LABEL = localize('quickOpenPreviousRecentlyUsedEditor', "Quick Open Previous Recently Used Editor");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		super(id, label, AllEditorsByMostRecentlyUsedQuickAccess.PREFIX, undefined, quickInputService, keybindingService);
	}
}

export class QuickAccessLeastRecentlyUsedEditorAction extends BaseQuickAccessEditorAction {

	static readonly ID = 'workbench.action.quickOpenLeastRecentlyUsedEditor';
	static readonly LABEL = localize('quickOpenLeastRecentlyUsedEditor', "Quick Open Least Recently Used Editor");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		super(id, label, AllEditorsByMostRecentlyUsedQuickAccess.PREFIX, undefined, quickInputService, keybindingService);
	}
}

export class QuickAccessPreviousRecentlyUsedEditorInGroupAction extends BaseQuickAccessEditorAction {

	static readonly ID = 'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup';
	static readonly LABEL = localize('quickOpenPreviousRecentlyUsedEditorInGroup', "Quick Open Previous Recently Used Editor in Group");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		super(id, label, ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX, undefined, quickInputService, keybindingService);
	}
}

export class QuickAccessLeastRecentlyUsedEditorInGroupAction extends BaseQuickAccessEditorAction {

	static readonly ID = 'workbench.action.quickOpenLeastRecentlyUsedEditorInGroup';
	static readonly LABEL = localize('quickOpenLeastRecentlyUsedEditorInGroup', "Quick Open Least Recently Used Editor in Group");

	constructor(
		id: string,
		label: string,
		@IQuickInputService quickInputService: IQuickInputService,
		@IKeybindingService keybindingService: IKeybindingService
	) {
		super(id, label, ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX, ItemActivation.LAST, quickInputService, keybindingService);
	}
}

export class QuickAccessPreviousEditorFromHistoryAction extends Action {

	static readonly ID = 'workbench.action.openPreviousEditorFromHistory';
	static readonly LABEL = localize('navigateEditorHistoryByInput', "Quick Open Previous Editor from History");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const keybindings = this.keybindingService.lookupKeybindings(this.id);

		// Enforce to activate the first item in quick access if
		// the currently active editor group has n editor opened
		let itemActivation: ItemActivation | undefined = undefined;
		if (this.editorGroupService.activeGroup.count === 0) {
			itemActivation = ItemActivation.FIRST;
		}

		this.quickInputService.quickAccess.show('', { quickNavigateConfiguration: { keybindings }, itemActivation });
	}
}

export class OpenNextRecentlyUsedEditorAction extends Action {

	static readonly ID = 'workbench.action.openNextRecentlyUsedEditor';
	static readonly LABEL = localize('openNextRecentlyUsedEditor', "Open Next Recently Used Editor");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.openNextRecentlyUsedEditor();
	}
}

export class OpenPreviousRecentlyUsedEditorAction extends Action {

	static readonly ID = 'workbench.action.openPreviousRecentlyUsedEditor';
	static readonly LABEL = localize('openPreviousRecentlyUsedEditor', "Open Previous Recently Used Editor");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.openPreviouslyUsedEditor();
	}
}

export class OpenNextRecentlyUsedEditorInGroupAction extends Action {

	static readonly ID = 'workbench.action.openNextRecentlyUsedEditorInGroup';
	static readonly LABEL = localize('openNextRecentlyUsedEditorInGroup', "Open Next Recently Used Editor In Group");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.openNextRecentlyUsedEditor(this.editorGroupsService.activeGroup.id);
	}
}

export class OpenPreviousRecentlyUsedEditorInGroupAction extends Action {

	static readonly ID = 'workbench.action.openPreviousRecentlyUsedEditorInGroup';
	static readonly LABEL = localize('openPreviousRecentlyUsedEditorInGroup', "Open Previous Recently Used Editor In Group");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.historyService.openPreviouslyUsedEditor(this.editorGroupsService.activeGroup.id);
	}
}

export class ClearEditorHistoryAction extends Action {

	static readonly ID = 'workbench.action.clearEditorHistory';
	static readonly LABEL = localize('clearEditorHistory', "Clear Editor History");

	constructor(
		id: string,
		label: string,
		@IHistoryService private readonly historyService: IHistoryService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {

		// Editor history
		this.historyService.clear();
	}
}

export class MoveEditorLeftInGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorLeftInGroup';
	static readonly LABEL = localize('moveEditorLeft', "Move Editor Left");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'left' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorRightInGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorRightInGroup';
	static readonly LABEL = localize('moveEditorRight', "Move Editor Right");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'right' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToPreviousGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToPreviousGroup';
	static readonly LABEL = localize('moveEditorToPreviousGroup', "Move Editor into Previous Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'previous', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToNextGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToNextGroup';
	static readonly LABEL = localize('moveEditorToNextGroup', "Move Editor into Next Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'next', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToAboveGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToAboveGroup';
	static readonly LABEL = localize('moveEditorToAboveGroup', "Move Editor into Above Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'up', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToBelowGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToBelowGroup';
	static readonly LABEL = localize('moveEditorToBelowGroup', "Move Editor into Below Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'down', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToLeftGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToLeftGroup';
	static readonly LABEL = localize('moveEditorToLeftGroup', "Move Editor into Left Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'left', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToRightGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToRightGroup';
	static readonly LABEL = localize('moveEditorToRightGroup', "Move Editor into Right Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'right', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToFirstGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToFirstGroup';
	static readonly LABEL = localize('moveEditorToFirstGroup', "Move Editor into First Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'first', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class MoveEditorToLastGroupAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.moveEditorToLastGroup';
	static readonly LABEL = localize('moveEditorToLastGroup', "Move Editor into Last Group");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, MOVE_ACTIVE_EDITOR_COMMAND_ID, commandService, { to: 'last', by: 'group' } as ActiveEditorMoveArguments);
	}
}

export class EditorLayoutSingleAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutSingle';
	static readonly LABEL = localize('editorLayoutSingle', "Single Column Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}] } as EditorGroupLayout);
	}
}

export class EditorLayoutTwoColumnsAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutTwoColumns';
	static readonly LABEL = localize('editorLayoutTwoColumns', "Two Columns Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, {}], orientation: GroupOrientation.HORIZONTAL } as EditorGroupLayout);
	}
}

export class EditorLayoutThreeColumnsAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutThreeColumns';
	static readonly LABEL = localize('editorLayoutThreeColumns', "Three Columns Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, {}, {}], orientation: GroupOrientation.HORIZONTAL } as EditorGroupLayout);
	}
}

export class EditorLayoutTwoRowsAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutTwoRows';
	static readonly LABEL = localize('editorLayoutTwoRows', "Two Rows Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, {}], orientation: GroupOrientation.VERTICAL } as EditorGroupLayout);
	}
}

export class EditorLayoutThreeRowsAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutThreeRows';
	static readonly LABEL = localize('editorLayoutThreeRows', "Three Rows Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, {}, {}], orientation: GroupOrientation.VERTICAL } as EditorGroupLayout);
	}
}

export class EditorLayoutTwoByTwoGridAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutTwoByTwoGrid';
	static readonly LABEL = localize('editorLayoutTwoByTwoGrid', "Grid Editor Layout (2x2)");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }] } as EditorGroupLayout);
	}
}

export class EditorLayoutTwoColumnsBottomAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutTwoColumnsBottom';
	static readonly LABEL = localize('editorLayoutTwoColumnsBottom', "Two Columns Bottom Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, { groups: [{}, {}] }], orientation: GroupOrientation.VERTICAL } as EditorGroupLayout);
	}
}

export class EditorLayoutTwoRowsRightAction extends ExecuteCommandAction {

	static readonly ID = 'workbench.action.editorLayoutTwoRowsRight';
	static readonly LABEL = localize('editorLayoutTwoRowsRight', "Two Rows Right Editor Layout");

	constructor(
		id: string,
		label: string,
		@ICommandService commandService: ICommandService
	) {
		super(id, label, LAYOUT_EDITOR_GROUPS_COMMAND_ID, commandService, { groups: [{}, { groups: [{}, {}] }], orientation: GroupOrientation.HORIZONTAL } as EditorGroupLayout);
	}
}

export class BaseCreateEditorGroupAction extends Action {

	constructor(
		id: string,
		label: string,
		private direction: GroupDirection,
		private editorGroupService: IEditorGroupsService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		this.editorGroupService.addGroup(this.editorGroupService.activeGroup, this.direction, { activate: true });
	}
}

export class NewEditorGroupLeftAction extends BaseCreateEditorGroupAction {

	static readonly ID = 'workbench.action.newGroupLeft';
	static readonly LABEL = localize('newEditorLeft', "New Editor Group to the Left");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.LEFT, editorGroupService);
	}
}

export class NewEditorGroupRightAction extends BaseCreateEditorGroupAction {

	static readonly ID = 'workbench.action.newGroupRight';
	static readonly LABEL = localize('newEditorRight', "New Editor Group to the Right");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.RIGHT, editorGroupService);
	}
}

export class NewEditorGroupAboveAction extends BaseCreateEditorGroupAction {

	static readonly ID = 'workbench.action.newGroupAbove';
	static readonly LABEL = localize('newEditorAbove', "New Editor Group Above");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.UP, editorGroupService);
	}
}

export class NewEditorGroupBelowAction extends BaseCreateEditorGroupAction {

	static readonly ID = 'workbench.action.newGroupBelow';
	static readonly LABEL = localize('newEditorBelow', "New Editor Group Below");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(id, label, GroupDirection.DOWN, editorGroupService);
	}
}

export class ReopenResourcesAction extends Action {

	static readonly ID = 'workbench.action.reopenWithEditor';
	static readonly LABEL = localize('workbench.action.reopenWithEditor', "Reopen Editor With...");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const activeInput = this.editorService.activeEditor;
		if (!activeInput) {
			return;
		}

		const activeEditorPane = this.editorService.activeEditorPane;
		if (!activeEditorPane) {
			return;
		}

		const options = activeEditorPane.options;
		const group = activeEditorPane.group;
		await this.editorService.replaceEditors([
			{
				editor: activeInput,
				replacement: activeInput,
				forceReplaceDirty: activeInput.resource?.scheme === Schemas.untitled,
				options: { ...options, override: EditorOverride.PICK }
			}
		], group);
	}
}

export class ToggleEditorTypeAction extends Action {

	static readonly ID = 'workbench.action.toggleEditorType';
	static readonly LABEL = localize('workbench.action.toggleEditorType', "Toggle Editor Type");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override async run(): Promise<void> {
		const activeEditorPane = this.editorService.activeEditorPane;
		if (!activeEditorPane) {
			return;
		}

		const activeEditorResource = activeEditorPane.input.resource;
		if (!activeEditorResource) {
			return;
		}

		const options = activeEditorPane.options;
		const group = activeEditorPane.group;

		const overrides = this.editorService.getEditorOverrides(activeEditorResource, options, group);
		const firstNonActiveOverride = overrides.find(([_, entry]) => !entry.active);
		if (!firstNonActiveOverride) {
			return;
		}

		await firstNonActiveOverride[0].open(activeEditorPane.input, { ...options, override: firstNonActiveOverride[1].id }, group)?.override;
	}
}
