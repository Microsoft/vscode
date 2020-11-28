/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IEditorInput, IEditorPane, GroupIdentifier, IEditorInputWithOptions, CloseDirection, IEditorPartOptions, IEditorPartOptionsChangeEvent, EditorsOrder, IVisibleEditorPane, IEditorCloseEvent } from 'vs/workbench/common/editor';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDimension } from 'vs/editor/common/editorCommon';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

export const IEditorGroupsService = createDecorator<IEditorGroupsService>('editorGroupsService');

export const enum GroupDirection {
	UP,
	DOWN,
	LEFT,
	RIGHT
}

export const enum GroupOrientation {
	HORIZONTAL,
	VERTICAL
}

export const enum GroupLocation {
	FIRST,
	LAST,
	NEXT,
	PREVIOUS
}

export interface IFindGroupScope {
	direction?: GroupDirection;
	location?: GroupLocation;
}

export const enum GroupsArrangement {

	/**
	 * Make the current active group consume the maximum
	 * amount of space possible.
	 */
	MINIMIZE_OTHERS,

	/**
	 * Size all groups evenly.
	 */
	EVEN,

	/**
	 * Will behave like MINIMIZE_OTHERS if the active
	 * group is not already maximized and EVEN otherwise
	 */
	TOGGLE
}

export interface GroupLayoutArgument {
	size?: number;
	groups?: GroupLayoutArgument[];
}

export interface EditorGroupLayout {
	orientation: GroupOrientation;
	groups: GroupLayoutArgument[];
}

export interface IMoveEditorOptions {
	index?: number;
	inactive?: boolean;
	preserveFocus?: boolean;
}

export interface ICopyEditorOptions extends IMoveEditorOptions { }

export interface IAddGroupOptions {
	activate?: boolean;
}

export const enum MergeGroupMode {
	COPY_EDITORS,
	MOVE_EDITORS
}

export interface IMergeGroupOptions {
	mode?: MergeGroupMode;
	index?: number;
}

export interface ICloseEditorOptions {
	preserveFocus?: boolean;
}

export type ICloseEditorsFilter = {
	except?: IEditorInput,
	direction?: CloseDirection,
	savedOnly?: boolean,
	excludeSticky?: boolean
};

export interface ICloseAllEditorsOptions {
	excludeSticky?: boolean;
}

export interface IEditorReplacement {
	editor: IEditorInput;
	replacement: IEditorInput;
	options?: IEditorOptions | ITextEditorOptions;
}

export const enum GroupsOrder {

	/**
	 * Groups sorted by creation order (oldest one first)
	 */
	CREATION_TIME,

	/**
	 * Groups sorted by most recent activity (most recent active first)
	 */
	MOST_RECENTLY_ACTIVE,

	/**
	 * Groups sorted by grid widget order
	 */
	GRID_APPEARANCE
}

export interface IEditorGroupsService {

	readonly _serviceBrand: undefined;

	/**
	 * An event for when the active editor group changes. The active editor
	 * group is the default location for new editors to open.
	 */
	readonly onDidActiveGroupChange: Event<IEditorGroup>;

	/**
	 * An event for when a new group was added.
	 */
	readonly onDidAddGroup: Event<IEditorGroup>;

	/**
	 * An event for when a group was removed.
	 */
	readonly onDidRemoveGroup: Event<IEditorGroup>;

	/**
	 * An event for when a group was moved.
	 */
	readonly onDidMoveGroup: Event<IEditorGroup>;

	/**
	 * An event for when a group gets activated.
	 */
	readonly onDidActivateGroup: Event<IEditorGroup>;

	/**
	 * An event for when the group container is layed out.
	 */
	readonly onDidLayout: Event<IDimension>;

	/**
	 * An event for when the index of a group changes.
	 */
	readonly onDidGroupIndexChange: Event<IEditorGroup>;

	/**
	 * The size of the editor groups area.
	 */
	readonly contentDimension: IDimension;

	/**
	 * An active group is the default location for new editors to open.
	 */
	readonly activeGroup: IEditorGroup;

	/**
	 * All groups that are currently visible in the editor area in the
	 * order of their creation (oldest first).
	 */
	readonly groups: ReadonlyArray<IEditorGroup>;

	/**
	 * The number of editor groups that are currently opened.
	 */
	readonly count: number;

	/**
	 * The current layout orientation of the root group.
	 */
	readonly orientation: GroupOrientation;

	/**
	 * A promise that resolves when groups have been restored.
	 */
	readonly whenRestored: Promise<void>;

	/**
	 * Find out if the editor group service has editors to restore from a previous session.
	 */
	readonly willRestoreEditors: boolean;

	/**
	 * Get all groups that are currently visible in the editor area.
	 *
	 * @param order the order of the editors to use
	 */
	getGroups(order: GroupsOrder): ReadonlyArray<IEditorGroup>;

	/**
	 * Allows to convert a group identifier to a group.
	 */
	getGroup(identifier: GroupIdentifier): IEditorGroup | undefined;

	/**
	 * Set a group as active. An active group is the default location for new editors to open.
	 */
	activateGroup(group: IEditorGroup | GroupIdentifier): IEditorGroup;

	/**
	 * Returns the size of a group.
	 */
	getSize(group: IEditorGroup | GroupIdentifier): { width: number, height: number };

	/**
	 * Sets the size of a group.
	 */
	setSize(group: IEditorGroup | GroupIdentifier, size: { width: number, height: number }): void;

	/**
	 * Arrange all groups according to the provided arrangement.
	 */
	arrangeGroups(arrangement: GroupsArrangement): void;

	/**
	 * Applies the provided layout by either moving existing groups or creating new groups.
	 */
	applyLayout(layout: EditorGroupLayout): void;

	/**
	 * Enable or disable centered editor layout.
	 */
	centerLayout(active: boolean): void;

	/**
	 * Find out if the editor layout is currently centered.
	 */
	isLayoutCentered(): boolean;

	/**
	 * Sets the orientation of the root group to be either vertical or horizontal.
	 */
	setGroupOrientation(orientation: GroupOrientation): void;

	/**
	 * Find a groupd in a specific scope:
	 * * `GroupLocation.FIRST`: the first group
	 * * `GroupLocation.LAST`: the last group
	 * * `GroupLocation.NEXT`: the next group from either the active one or `source`
	 * * `GroupLocation.PREVIOUS`: the previous group from either the active one or `source`
	 * * `GroupDirection.UP`: the next group above the active one or `source`
	 * * `GroupDirection.DOWN`: the next group below the active one or `source`
	 * * `GroupDirection.LEFT`: the next group to the left of the active one or `source`
	 * * `GroupDirection.RIGHT`: the next group to the right of the active one or `source`
	 *
	 * @param scope the scope of the group to search in
	 * @param source optional source to search from
	 * @param wrap optionally wrap around if reaching the edge of groups
	 */
	findGroup(scope: IFindGroupScope, source?: IEditorGroup | GroupIdentifier, wrap?: boolean): IEditorGroup;

	/**
	 * Add a new group to the editor area. A new group is added by splitting a provided one in
	 * one of the four directions.
	 *
	 * @param location the group from which to split to add a new group
	 * @param direction the direction of where to split to
	 * @param options configure the newly group with options
	 */
	addGroup(location: IEditorGroup | GroupIdentifier, direction: GroupDirection, options?: IAddGroupOptions): IEditorGroup;

	/**
	 * Remove a group from the editor area.
	 */
	removeGroup(group: IEditorGroup | GroupIdentifier): void;

	/**
	 * Move a group to a new group in the editor area.
	 *
	 * @param group the group to move
	 * @param location the group from which to split to add the moved group
	 * @param direction the direction of where to split to
	 */
	moveGroup(group: IEditorGroup | GroupIdentifier, location: IEditorGroup | GroupIdentifier, direction: GroupDirection): IEditorGroup;

	/**
	 * Merge the editors of a group into a target group. By default, all editors will
	 * move and the source group will close. This behaviour can be configured via the
	 * `IMergeGroupOptions` options.
	 *
	 * @param group the group to merge
	 * @param target the target group to merge into
	 * @param options controls how the merge should be performed. by default all editors
	 * will be moved over to the target and the source group will close. Configure to
	 * `MOVE_EDITORS_KEEP_GROUP` to prevent the source group from closing. Set to
	 * `COPY_EDITORS` to copy the editors into the target instead of moding them.
	 */
	mergeGroup(group: IEditorGroup | GroupIdentifier, target: IEditorGroup | GroupIdentifier, options?: IMergeGroupOptions): IEditorGroup;

	/**
	 * Copy a group to a new group in the editor area.
	 *
	 * @param group the group to copy
	 * @param location the group from which to split to add the copied group
	 * @param direction the direction of where to split to
	 */
	copyGroup(group: IEditorGroup | GroupIdentifier, location: IEditorGroup | GroupIdentifier, direction: GroupDirection): IEditorGroup;

	/**
	 * Access the options of the editor part.
	 */
	readonly partOptions: IEditorPartOptions;

	/**
	 * An event that notifies when editor part options change.
	 */
	readonly onDidEditorPartOptionsChange: Event<IEditorPartOptionsChangeEvent>;

	/**
	 * Enforce editor part options temporarily.
	 */
	enforcePartOptions(options: IEditorPartOptions): IDisposable;
}

export const enum GroupChangeKind {

	/* Group Changes */
	GROUP_ACTIVE,
	GROUP_INDEX,

	/* Editor Changes */
	EDITOR_OPEN,
	EDITOR_CLOSE,
	EDITOR_MOVE,
	EDITOR_ACTIVE,
	EDITOR_LABEL,
	EDITOR_PIN,
	EDITOR_STICKY,
	EDITOR_DIRTY
}

export interface IGroupChangeEvent {
	kind: GroupChangeKind;
	editor?: IEditorInput;
	editorIndex?: number;
}

export const enum OpenEditorContext {
	NEW_EDITOR = 1,
	MOVE_EDITOR = 2,
	COPY_EDITOR = 3
}

export interface IEditorGroup {

	/**
	 * An aggregated event for when the group changes in any way.
	 */
	readonly onDidGroupChange: Event<IGroupChangeEvent>;

	/**
	 * An event that is fired when the group gets disposed.
	 */
	readonly onWillDispose: Event<void>;

	/**
	 * An event that is fired when an editor is about to close.
	 */
	readonly onWillCloseEditor: Event<IEditorCloseEvent>;

	/**
	 * A unique identifier of this group that remains identical even if the
	 * group is moved to different locations.
	 */
	readonly id: GroupIdentifier;

	/**
	 * A number that indicates the position of this group in the visual
	 * order of groups from left to right and top to bottom. The lowest
	 * index will likely be top-left while the largest index in most
	 * cases should be bottom-right, but that depends on the grid.
	 */
	readonly index: number;

	/**
	 * A human readable label for the group. This label can change depending
	 * on the layout of all editor groups. Clients should listen on the
	 * `onDidGroupChange` event to react to that.
	 */
	readonly label: string;

	/**
	 * A human readable label for the group to be used by screen readers.
	 */
	readonly ariaLabel: string;

	/**
	 * The active editor pane is the currently visible editor pane of the group.
	 */
	readonly activeEditorPane: IVisibleEditorPane | undefined;

	/**
	 * The active editor is the currently visible editor of the group
	 * within the current active editor pane.
	 */
	readonly activeEditor: IEditorInput | null;

	/**
	 * The editor in the group that is in preview mode if any. There can
	 * only ever be one editor in preview mode.
	 */
	readonly previewEditor: IEditorInput | null;

	/**
	 * The number of opened editors in this group.
	 */
	readonly count: number;

	/**
	 * The number of sticky editors in this group.
	 */
	readonly stickyCount: number;

	/**
	 * All opened editors in the group in sequential order of their appearance.
	 */
	readonly editors: ReadonlyArray<IEditorInput>;

	/**
	 * The scoped context key service for this group.
	 */
	readonly scopedContextKeyService: IContextKeyService;

	/**
	 * Get all editors that are currently opened in the group.
	 *
	 * @param order the order of the editors to use
	 * @param options options to select only specific editors as instructed
	 */
	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): ReadonlyArray<IEditorInput>;

	/**
	 * Returns the editor at a specific index of the group.
	 */
	getEditorByIndex(index: number): IEditorInput | undefined;

	/**
	 * Returns the index of the editor in the group or -1 if not opened.
	 */
	getIndexOfEditor(editor: IEditorInput): number;

	/**
	 * Open an editor in this group.
	 *
	 * @returns a promise that resolves around an IEditor instance unless
	 * the call failed, or the editor was not opened as active editor.
	 */
	openEditor(editor: IEditorInput, options?: IEditorOptions | ITextEditorOptions, context?: OpenEditorContext): Promise<IEditorPane | null>;

	/**
	 * Opens editors in this group.
	 *
	 * @returns a promise that resolves around an IEditor instance unless
	 * the call failed, or the editor was not opened as active editor. Since
	 * a group can only ever have one active editor, even if many editors are
	 * opened, the result will only be one editor.
	 */
	openEditors(editors: IEditorInputWithOptions[]): Promise<IEditorPane | null>;

	/**
	 * Find out if the provided editor is opened in the group.
	 *
	 * Note: An editor can be opened but not actively visible.
	 */
	isOpened(editor: IEditorInput): boolean;

	/**
	 * Find out if the provided editor is pinned in the group.
	 */
	isPinned(editor: IEditorInput): boolean;

	/**
	 * Find out if the provided editor or index of editor is sticky in the group.
	 */
	isSticky(editorOrIndex: IEditorInput | number): boolean;

	/**
	 * Find out if the provided editor is active in the group.
	 */
	isActive(editor: IEditorInput): boolean;

	/**
	 * Move an editor from this group either within this group or to another group.
	 */
	moveEditor(editor: IEditorInput, target: IEditorGroup, options?: IMoveEditorOptions): void;

	/**
	 * Copy an editor from this group to another group.
	 *
	 * Note: It is currently not supported to show the same editor more than once in the same group.
	 */
	copyEditor(editor: IEditorInput, target: IEditorGroup, options?: ICopyEditorOptions): void;

	/**
	 * Close an editor from the group. This may trigger a confirmation dialog if
	 * the editor is dirty and thus returns a promise as value.
	 *
	 * @param editor the editor to close, or the currently active editor
	 * if unspecified.
	 *
	 * @returns a promise when the editor is closed.
	 */
	closeEditor(editor?: IEditorInput, options?: ICloseEditorOptions): Promise<void>;

	/**
	 * Closes specific editors in this group. This may trigger a confirmation dialog if
	 * there are dirty editors and thus returns a promise as value.
	 *
	 * @returns a promise when all editors are closed.
	 */
	closeEditors(editors: IEditorInput[] | ICloseEditorsFilter, options?: ICloseEditorOptions): Promise<void>;

	/**
	 * Closes all editors from the group. This may trigger a confirmation dialog if
	 * there are dirty editors and thus returns a promise as value.
	 *
	 * @returns a promise when all editors are closed.
	 */
	closeAllEditors(options?: ICloseAllEditorsOptions): Promise<void>;

	/**
	 * Replaces editors in this group with the provided replacement.
	 *
	 * @param editors the editors to replace
	 *
	 * @returns a promise that is resolved when the replaced active
	 * editor (if any) has finished loading.
	 */
	replaceEditors(editors: IEditorReplacement[]): Promise<void>;

	/**
	 * Set an editor to be pinned. A pinned editor is not replaced
	 * when another editor opens at the same location.
	 *
	 * @param editor the editor to pin, or the currently active editor
	 * if unspecified.
	 */
	pinEditor(editor?: IEditorInput): void;

	/**
	 * Set an editor to be sticky. A sticky editor is showing in the beginning
	 * of the tab stripe and will not be impacted by close operations.
	 *
	 * @param editor the editor to make sticky, or the currently active editor
	 * if unspecified.
	 */
	stickEditor(editor?: IEditorInput): void;

	/**
	 * Set an editor to be non-sticky and thus moves back to a location after
	 * sticky editors and can be closed normally.
	 *
	 * @param editor the editor to make unsticky, or the currently active editor
	 * if unspecified.
	 */
	unstickEditor(editor?: IEditorInput): void;

	/**
	 * Move keyboard focus into the group.
	 */
	focus(): void;
}


//#region Editor Group Helpers

export function preferredSideBySideGroupDirection(configurationService: IConfigurationService): GroupDirection.DOWN | GroupDirection.RIGHT {
	const openSideBySideDirection = configurationService.getValue<'right' | 'down'>('workbench.editor.openSideBySideDirection');

	if (openSideBySideDirection === 'down') {
		return GroupDirection.DOWN;
	}

	return GroupDirection.RIGHT;
}

//#endregion
