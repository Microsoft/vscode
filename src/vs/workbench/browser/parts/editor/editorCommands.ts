/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { isObject, isString, isUndefined, isNumber, withNullAsUndefined } from 'vs/base/common/types';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { TextCompareEditorVisibleContext, EditorInput, IEditorIdentifier, IEditorCommandsContext, ActiveEditorGroupEmptyContext, MultipleEditorGroupsContext, CloseDirection, IEditorInput, IVisibleEditorPane, ActiveEditorStickyContext, EditorsOrder, viewColumnToEditorGroup, EditorGroupColumn } from 'vs/workbench/common/editor';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { TextDiffEditor } from 'vs/workbench/browser/parts/editor/textDiffEditor';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IListService, IOpenEvent } from 'vs/platform/list/browser/listService';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { distinct, coalesce } from 'vs/base/common/arrays';
import { IEditorGroupsService, IEditorGroup, GroupDirection, GroupLocation, GroupsOrder, preferredSideBySideGroupDirection, EditorGroupLayout } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CommandsRegistry, ICommandHandler } from 'vs/platform/commands/common/commands';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ActiveGroupEditorsByMostRecentlyUsedQuickAccess } from 'vs/workbench/browser/parts/editor/editorQuickAccess';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';

export const CLOSE_SAVED_EDITORS_COMMAND_ID = 'workbench.action.closeUnmodifiedEditors';
export const CLOSE_EDITORS_IN_GROUP_COMMAND_ID = 'workbench.action.closeEditorsInGroup';
export const CLOSE_EDITORS_AND_GROUP_COMMAND_ID = 'workbench.action.closeEditorsAndGroup';
export const CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID = 'workbench.action.closeEditorsToTheRight';
export const CLOSE_EDITOR_COMMAND_ID = 'workbench.action.closeActiveEditor';
export const CLOSE_PINNED_EDITOR_COMMAND_ID = 'workbench.action.closeActivePinnedEditor';
export const CLOSE_EDITOR_GROUP_COMMAND_ID = 'workbench.action.closeGroup';
export const CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID = 'workbench.action.closeOtherEditors';

export const MOVE_ACTIVE_EDITOR_COMMAND_ID = 'moveActiveEditor';
export const LAYOUT_EDITOR_GROUPS_COMMAND_ID = 'layoutEditorGroups';
export const KEEP_EDITOR_COMMAND_ID = 'workbench.action.keepEditor';
export const TOGGLE_KEEP_EDITORS_COMMAND_ID = 'workbench.action.toggleKeepEditors';
export const SHOW_EDITORS_IN_GROUP = 'workbench.action.showEditorsInGroup';

export const PIN_EDITOR_COMMAND_ID = 'workbench.action.pinEditor';
export const UNPIN_EDITOR_COMMAND_ID = 'workbench.action.unpinEditor';

export const TOGGLE_DIFF_SIDE_BY_SIDE = 'toggle.diff.renderSideBySide';
export const GOTO_NEXT_CHANGE = 'workbench.action.compareEditor.nextChange';
export const GOTO_PREVIOUS_CHANGE = 'workbench.action.compareEditor.previousChange';
export const DIFF_FOCUS_PRIMARY_SIDE = 'workbench.action.compareEditor.focusPrimarySide';
export const DIFF_FOCUS_SECONDARY_SIDE = 'workbench.action.compareEditor.focusSecondarySide';
export const DIFF_FOCUS_OTHER_SIDE = 'workbench.action.compareEditor.focusOtherSide';
export const TOGGLE_DIFF_IGNORE_TRIM_WHITESPACE = 'toggle.diff.ignoreTrimWhitespace';

export const SPLIT_EDITOR_UP = 'workbench.action.splitEditorUp';
export const SPLIT_EDITOR_DOWN = 'workbench.action.splitEditorDown';
export const SPLIT_EDITOR_LEFT = 'workbench.action.splitEditorLeft';
export const SPLIT_EDITOR_RIGHT = 'workbench.action.splitEditorRight';

export const FOCUS_LEFT_GROUP_WITHOUT_WRAP_COMMAND_ID = 'workbench.action.focusLeftGroupWithoutWrap';
export const FOCUS_RIGHT_GROUP_WITHOUT_WRAP_COMMAND_ID = 'workbench.action.focusRightGroupWithoutWrap';
export const FOCUS_ABOVE_GROUP_WITHOUT_WRAP_COMMAND_ID = 'workbench.action.focusAboveGroupWithoutWrap';
export const FOCUS_BELOW_GROUP_WITHOUT_WRAP_COMMAND_ID = 'workbench.action.focusBelowGroupWithoutWrap';

export const OPEN_EDITOR_AT_INDEX_COMMAND_ID = 'workbench.action.openEditorAtIndex';

export const API_OPEN_EDITOR_COMMAND_ID = '_workbench.open';
export const API_OPEN_DIFF_EDITOR_COMMAND_ID = '_workbench.diff';
export const API_OPEN_WITH_EDITOR_COMMAND_ID = '_workbench.openWith';

export interface ActiveEditorMoveArguments {
	to: 'first' | 'last' | 'left' | 'right' | 'up' | 'down' | 'center' | 'position' | 'previous' | 'next';
	by: 'tab' | 'group';
	value: number;
}

const isActiveEditorMoveArg = function (arg: ActiveEditorMoveArguments): boolean {
	if (!isObject(arg)) {
		return false;
	}

	if (!isString(arg.to)) {
		return false;
	}

	if (!isUndefined(arg.by) && !isString(arg.by)) {
		return false;
	}

	if (!isUndefined(arg.value) && !isNumber(arg.value)) {
		return false;
	}

	return true;
};

function registerActiveEditorMoveCommand(): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: MOVE_ACTIVE_EDITOR_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: EditorContextKeys.editorTextFocus,
		primary: 0,
		handler: (accessor, args) => moveActiveEditor(args, accessor),
		description: {
			description: localize('editorCommand.activeEditorMove.description', "Move the active editor by tabs or groups"),
			args: [
				{
					name: localize('editorCommand.activeEditorMove.arg.name', "Active editor move argument"),
					description: localize('editorCommand.activeEditorMove.arg.description', "Argument Properties:\n\t* 'to': String value providing where to move.\n\t* 'by': String value providing the unit for move (by tab or by group).\n\t* 'value': Number value providing how many positions or an absolute position to move."),
					constraint: isActiveEditorMoveArg,
					schema: {
						'type': 'object',
						'required': ['to'],
						'properties': {
							'to': {
								'type': 'string',
								'enum': ['left', 'right']
							},
							'by': {
								'type': 'string',
								'enum': ['tab', 'group']
							},
							'value': {
								'type': 'number'
							}
						},
					}
				}
			]
		}
	});
}

function moveActiveEditor(args: ActiveEditorMoveArguments = Object.create(null), accessor: ServicesAccessor): void {
	args.to = args.to || 'right';
	args.by = args.by || 'tab';
	args.value = typeof args.value === 'number' ? args.value : 1;

	const activeEditorPane = accessor.get(IEditorService).activeEditorPane;
	if (activeEditorPane) {
		switch (args.by) {
			case 'tab':
				return moveActiveTab(args, activeEditorPane, accessor);
			case 'group':
				return moveActiveEditorToGroup(args, activeEditorPane, accessor);
		}
	}
}

function moveActiveTab(args: ActiveEditorMoveArguments, control: IVisibleEditorPane, accessor: ServicesAccessor): void {
	const group = control.group;
	let index = group.getIndexOfEditor(control.input);
	switch (args.to) {
		case 'first':
			index = 0;
			break;
		case 'last':
			index = group.count - 1;
			break;
		case 'left':
			index = index - args.value;
			break;
		case 'right':
			index = index + args.value;
			break;
		case 'center':
			index = Math.round(group.count / 2) - 1;
			break;
		case 'position':
			index = args.value - 1;
			break;
	}

	index = index < 0 ? 0 : index >= group.count ? group.count - 1 : index;
	group.moveEditor(control.input, group, { index });
}

function moveActiveEditorToGroup(args: ActiveEditorMoveArguments, control: IVisibleEditorPane, accessor: ServicesAccessor): void {
	const editorGroupService = accessor.get(IEditorGroupsService);
	const configurationService = accessor.get(IConfigurationService);

	const sourceGroup = control.group;
	let targetGroup: IEditorGroup | undefined;

	switch (args.to) {
		case 'left':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.LEFT }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.LEFT);
			}
			break;
		case 'right':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.RIGHT }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.RIGHT);
			}
			break;
		case 'up':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.UP }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.UP);
			}
			break;
		case 'down':
			targetGroup = editorGroupService.findGroup({ direction: GroupDirection.DOWN }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, GroupDirection.DOWN);
			}
			break;
		case 'first':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.FIRST }, sourceGroup);
			break;
		case 'last':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.LAST }, sourceGroup);
			break;
		case 'previous':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.PREVIOUS }, sourceGroup);
			break;
		case 'next':
			targetGroup = editorGroupService.findGroup({ location: GroupLocation.NEXT }, sourceGroup);
			if (!targetGroup) {
				targetGroup = editorGroupService.addGroup(sourceGroup, preferredSideBySideGroupDirection(configurationService));
			}
			break;
		case 'center':
			targetGroup = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)[(editorGroupService.count / 2) - 1];
			break;
		case 'position':
			targetGroup = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)[args.value - 1];
			break;
	}

	if (targetGroup) {
		sourceGroup.moveEditor(control.input, targetGroup);
		targetGroup.focus();
	}
}

function registerEditorGroupsLayoutCommand(): void {

	function applyEditorLayout(accessor: ServicesAccessor, layout: EditorGroupLayout): void {
		if (!layout || typeof layout !== 'object') {
			return;
		}

		const editorGroupService = accessor.get(IEditorGroupsService);
		editorGroupService.applyLayout(layout);
	}

	CommandsRegistry.registerCommand(LAYOUT_EDITOR_GROUPS_COMMAND_ID, (accessor: ServicesAccessor, args: EditorGroupLayout) => {
		applyEditorLayout(accessor, args);
	});

	// API Command
	CommandsRegistry.registerCommand({
		id: 'vscode.setEditorLayout',
		handler: (accessor: ServicesAccessor, args: EditorGroupLayout) => applyEditorLayout(accessor, args),
		description: {
			description: 'Set Editor Layout',
			args: [{
				name: 'args',
				schema: {
					'type': 'object',
					'required': ['groups'],
					'properties': {
						'orientation': {
							'type': 'number',
							'default': 0,
							'enum': [0, 1]
						},
						'groups': {
							'$ref': '#/definitions/editorGroupsSchema',
							'default': [{}, {}]
						}
					}
				}
			}]
		}
	});
}

function registerDiffEditorCommands(): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: GOTO_NEXT_CHANGE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: TextCompareEditorVisibleContext,
		primary: KeyMod.Alt | KeyCode.F5,
		handler: accessor => navigateInDiffEditor(accessor, true)
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: GOTO_PREVIOUS_CHANGE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: TextCompareEditorVisibleContext,
		primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F5,
		handler: accessor => navigateInDiffEditor(accessor, false)
	});

	function getActiveTextDiffEditor(accessor: ServicesAccessor): TextDiffEditor | undefined {
		const editorService = accessor.get(IEditorService);

		for (const editor of [editorService.activeEditorPane, ...editorService.visibleEditorPanes]) {
			if (editor instanceof TextDiffEditor) {
				return editor;
			}
		}

		return undefined;
	}

	function navigateInDiffEditor(accessor: ServicesAccessor, next: boolean): void {
		const activeTextDiffEditor = getActiveTextDiffEditor(accessor);

		if (activeTextDiffEditor) {
			const navigator = activeTextDiffEditor.getDiffNavigator();
			if (navigator) {
				next ? navigator.next() : navigator.previous();
			}
		}
	}

	enum FocusTextDiffEditorMode {
		Original,
		Modified,
		Toggle
	}

	function focusInDiffEditor(accessor: ServicesAccessor, mode: FocusTextDiffEditorMode): void {
		const activeTextDiffEditor = getActiveTextDiffEditor(accessor);

		if (activeTextDiffEditor) {
			switch (mode) {
				case FocusTextDiffEditorMode.Original:
					activeTextDiffEditor.getControl()?.getOriginalEditor().focus();
					break;
				case FocusTextDiffEditorMode.Modified:
					activeTextDiffEditor.getControl()?.getModifiedEditor().focus();
					break;
				case FocusTextDiffEditorMode.Toggle:
					if (activeTextDiffEditor.getControl()?.getModifiedEditor().hasWidgetFocus()) {
						return focusInDiffEditor(accessor, FocusTextDiffEditorMode.Original);
					} else {
						return focusInDiffEditor(accessor, FocusTextDiffEditorMode.Modified);
					}
			}
		}
	}

	function toggleDiffSideBySide(accessor: ServicesAccessor): void {
		const configurationService = accessor.get(IConfigurationService);

		const newValue = !configurationService.getValue<boolean>('diffEditor.renderSideBySide');
		configurationService.updateValue('diffEditor.renderSideBySide', newValue);
	}

	function toggleDiffIgnoreTrimWhitespace(accessor: ServicesAccessor): void {
		const configurationService = accessor.get(IConfigurationService);

		const newValue = !configurationService.getValue<boolean>('diffEditor.ignoreTrimWhitespace');
		configurationService.updateValue('diffEditor.ignoreTrimWhitespace', newValue);
	}

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TOGGLE_DIFF_SIDE_BY_SIDE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: accessor => toggleDiffSideBySide(accessor)
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: DIFF_FOCUS_PRIMARY_SIDE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: accessor => focusInDiffEditor(accessor, FocusTextDiffEditorMode.Modified)
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: DIFF_FOCUS_SECONDARY_SIDE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: accessor => focusInDiffEditor(accessor, FocusTextDiffEditorMode.Original)
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: DIFF_FOCUS_OTHER_SIDE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: accessor => focusInDiffEditor(accessor, FocusTextDiffEditorMode.Toggle)
	});

	MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
		command: {
			id: TOGGLE_DIFF_SIDE_BY_SIDE,
			title: {
				value: localize('toggleInlineView', "Toggle Inline View"),
				original: 'Compare: Toggle Inline View'
			},
			category: localize('compare', "Compare")
		},
		when: ContextKeyExpr.has('textCompareEditorActive')
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TOGGLE_DIFF_IGNORE_TRIM_WHITESPACE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: accessor => toggleDiffIgnoreTrimWhitespace(accessor)
	});
}

function registerOpenEditorAPICommands(): void {

	function mixinContext(context: IOpenEvent<unknown> | undefined, options: ITextEditorOptions | undefined, column: EditorGroupColumn | undefined): [ITextEditorOptions | undefined, EditorGroupColumn | undefined] {
		if (!context) {
			return [options, column];
		}

		return [
			{ ...context.editorOptions, ...(options ?? Object.create(null)) },
			context.sideBySide ? SIDE_GROUP : column
		];
	}

	CommandsRegistry.registerCommand(API_OPEN_EDITOR_COMMAND_ID, async function (accessor: ServicesAccessor, resourceArg: UriComponents, columnAndOptions?: [EditorGroupColumn?, ITextEditorOptions?], label?: string, context?: IOpenEvent<unknown>) {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const openerService = accessor.get(IOpenerService);

		const resource = URI.revive(resourceArg);
		const [columnArg, optionsArg] = columnAndOptions ?? [];

		// use editor options or editor view column as a hint to use the editor service for opening
		if (optionsArg || typeof columnArg === 'number') {
			const [options, column] = mixinContext(context, optionsArg, columnArg);

			await editorService.openEditor({ resource, options, label }, viewColumnToEditorGroup(editorGroupService, column));
		}

		// do not allow to execute commands from here
		else if (resource.scheme === 'command') {
			return;
		}

		// finally, delegate to opener service
		else {
			await openerService.open(resource, { openToSide: context?.sideBySide, editorOptions: context?.editorOptions });
		}
	});

	CommandsRegistry.registerCommand(API_OPEN_DIFF_EDITOR_COMMAND_ID, async function (accessor: ServicesAccessor, leftResource: UriComponents, rightResource: UriComponents, label?: string, columnAndOptions?: [EditorGroupColumn?, ITextEditorOptions?], context?: IOpenEvent<unknown>) {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);

		const [columnArg, optionsArg] = columnAndOptions ?? [];
		const [options, column] = mixinContext(context, optionsArg, columnArg);

		await editorService.openEditor({
			leftResource: URI.revive(leftResource),
			rightResource: URI.revive(rightResource),
			label,
			options
		}, viewColumnToEditorGroup(editorGroupService, column));
	});

	CommandsRegistry.registerCommand(API_OPEN_WITH_EDITOR_COMMAND_ID, (accessor: ServicesAccessor, resource: UriComponents, id: string, columnAndOptions?: [EditorGroupColumn?, ITextEditorOptions?]) => {
		const editorService = accessor.get(IEditorService);
		const editorGroupsService = accessor.get(IEditorGroupsService);
		const configurationService = accessor.get(IConfigurationService);

		const [columnArg, optionsArg] = columnAndOptions ?? [];
		let group: IEditorGroup | undefined = undefined;

		if (columnArg === SIDE_GROUP) {
			const direction = preferredSideBySideGroupDirection(configurationService);

			let neighbourGroup = editorGroupsService.findGroup({ direction });
			if (!neighbourGroup) {
				neighbourGroup = editorGroupsService.addGroup(editorGroupsService.activeGroup, direction);
			}
			group = neighbourGroup;
		} else {
			group = editorGroupsService.getGroup(viewColumnToEditorGroup(editorGroupsService, columnArg)) ?? editorGroupsService.activeGroup;
		}

		return editorService.openEditor({ resource: URI.revive(resource), options: { ...optionsArg, override: id } }, group);
	});
}

function registerOpenEditorAtIndexCommands(): void {
	const openEditorAtIndex: ICommandHandler = (accessor: ServicesAccessor, editorIndex: number): void => {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (activeEditorPane) {
			const editor = activeEditorPane.group.getEditorByIndex(editorIndex);
			if (editor) {
				editorService.openEditor(editor);
			}
		}
	};

	// This command takes in the editor index number to open as an argument
	CommandsRegistry.registerCommand({
		id: OPEN_EDITOR_AT_INDEX_COMMAND_ID,
		handler: openEditorAtIndex
	});

	// Keybindings to focus a specific index in the tab folder if tabs are enabled
	for (let i = 0; i < 9; i++) {
		const editorIndex = i;
		const visibleIndex = i + 1;

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: OPEN_EDITOR_AT_INDEX_COMMAND_ID + visibleIndex,
			weight: KeybindingWeight.WorkbenchContrib,
			when: undefined,
			primary: KeyMod.Alt | toKeyCode(visibleIndex),
			mac: { primary: KeyMod.WinCtrl | toKeyCode(visibleIndex) },
			handler: accessor => openEditorAtIndex(accessor, editorIndex)
		});
	}

	function toKeyCode(index: number): KeyCode {
		switch (index) {
			case 0: return KeyCode.KEY_0;
			case 1: return KeyCode.KEY_1;
			case 2: return KeyCode.KEY_2;
			case 3: return KeyCode.KEY_3;
			case 4: return KeyCode.KEY_4;
			case 5: return KeyCode.KEY_5;
			case 6: return KeyCode.KEY_6;
			case 7: return KeyCode.KEY_7;
			case 8: return KeyCode.KEY_8;
			case 9: return KeyCode.KEY_9;
		}

		throw new Error('invalid index');
	}
}

function registerFocusEditorGroupAtIndexCommands(): void {

	// Keybindings to focus a specific group (2-8) in the editor area
	for (let groupIndex = 1; groupIndex < 8; groupIndex++) {
		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: toCommandId(groupIndex),
			weight: KeybindingWeight.WorkbenchContrib,
			when: undefined,
			primary: KeyMod.CtrlCmd | toKeyCode(groupIndex),
			handler: accessor => {
				const editorGroupService = accessor.get(IEditorGroupsService);
				const configurationService = accessor.get(IConfigurationService);

				// To keep backwards compatibility (pre-grid), allow to focus a group
				// that does not exist as long as it is the next group after the last
				// opened group. Otherwise we return.
				if (groupIndex > editorGroupService.count) {
					return;
				}

				// Group exists: just focus
				const groups = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE);
				if (groups[groupIndex]) {
					return groups[groupIndex].focus();
				}

				// Group does not exist: create new by splitting the active one of the last group
				const direction = preferredSideBySideGroupDirection(configurationService);
				const lastGroup = editorGroupService.findGroup({ location: GroupLocation.LAST });
				const newGroup = editorGroupService.addGroup(lastGroup, direction);

				// Focus
				newGroup.focus();
			}
		});
	}

	function toCommandId(index: number): string {
		switch (index) {
			case 1: return 'workbench.action.focusSecondEditorGroup';
			case 2: return 'workbench.action.focusThirdEditorGroup';
			case 3: return 'workbench.action.focusFourthEditorGroup';
			case 4: return 'workbench.action.focusFifthEditorGroup';
			case 5: return 'workbench.action.focusSixthEditorGroup';
			case 6: return 'workbench.action.focusSeventhEditorGroup';
			case 7: return 'workbench.action.focusEighthEditorGroup';
		}

		throw new Error('Invalid index');
	}

	function toKeyCode(index: number): KeyCode {
		switch (index) {
			case 1: return KeyCode.KEY_2;
			case 2: return KeyCode.KEY_3;
			case 3: return KeyCode.KEY_4;
			case 4: return KeyCode.KEY_5;
			case 5: return KeyCode.KEY_6;
			case 6: return KeyCode.KEY_7;
			case 7: return KeyCode.KEY_8;
		}

		throw new Error('Invalid index');
	}
}

export function splitEditor(editorGroupService: IEditorGroupsService, direction: GroupDirection, context?: IEditorCommandsContext): void {
	let sourceGroup: IEditorGroup | undefined;
	if (context && typeof context.groupId === 'number') {
		sourceGroup = editorGroupService.getGroup(context.groupId);
	} else {
		sourceGroup = editorGroupService.activeGroup;
	}

	if (!sourceGroup) {
		return;
	}

	// Add group
	const newGroup = editorGroupService.addGroup(sourceGroup, direction);

	// Split editor (if it can be split)
	let editorToCopy: IEditorInput | undefined;
	if (context && typeof context.editorIndex === 'number') {
		editorToCopy = sourceGroup.getEditorByIndex(context.editorIndex);
	} else {
		editorToCopy = withNullAsUndefined(sourceGroup.activeEditor);
	}

	// Copy the editor to the new group, else create an empty group
	if (editorToCopy && (editorToCopy as EditorInput).canSplit()) {
		sourceGroup.copyEditor(editorToCopy, newGroup);
	}

	// Focus
	newGroup.focus();

}

function registerSplitEditorCommands() {
	[
		{ id: SPLIT_EDITOR_UP, direction: GroupDirection.UP },
		{ id: SPLIT_EDITOR_DOWN, direction: GroupDirection.DOWN },
		{ id: SPLIT_EDITOR_LEFT, direction: GroupDirection.LEFT },
		{ id: SPLIT_EDITOR_RIGHT, direction: GroupDirection.RIGHT }
	].forEach(({ id, direction }) => {
		CommandsRegistry.registerCommand(id, function (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) {
			splitEditor(accessor.get(IEditorGroupsService), direction, getCommandsContext(resourceOrContext, context));
		});
	});
}

function registerCloseEditorCommands() {

	// A special handler for "Close Editor" depending on context
	// - keybindining: do not close sticky editors, rather open the next non-sticky editor
	// - menu: always close editor, even sticky ones
	function closeEditorHandler(accessor: ServicesAccessor, forceCloseStickyEditors: boolean, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext): Promise<unknown> {
		const editorGroupsService = accessor.get(IEditorGroupsService);
		const editorService = accessor.get(IEditorService);

		let keepStickyEditors = true;
		if (forceCloseStickyEditors) {
			keepStickyEditors = false; // explicitly close sticky editors
		} else if (resourceOrContext || context) {
			keepStickyEditors = false; // we have a context, as such this command was used e.g. from the tab context menu
		}

		// Without context: skip over sticky editor and select next if active editor is sticky
		if (keepStickyEditors && !resourceOrContext && !context) {
			const activeGroup = editorGroupsService.activeGroup;
			const activeEditor = activeGroup.activeEditor;

			if (activeEditor && activeGroup.isSticky(activeEditor)) {

				// Open next recently active in same group
				const nextNonStickyEditorInGroup = activeGroup.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true })[0];
				if (nextNonStickyEditorInGroup) {
					return activeGroup.openEditor(nextNonStickyEditorInGroup);
				}

				// Open next recently active across all groups
				const nextNonStickyEditorInAllGroups = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true })[0];
				if (nextNonStickyEditorInAllGroups) {
					return Promise.resolve(editorGroupsService.getGroup(nextNonStickyEditorInAllGroups.groupId)?.openEditor(nextNonStickyEditorInAllGroups.editor));
				}
			}
		}

		// With context: proceed to close editors as instructed
		const { editors, groups } = getEditorsContext(accessor, resourceOrContext, context);

		return Promise.all(groups.map(async group => {
			if (group) {
				const editorsToClose = coalesce(editors
					.filter(editor => editor.groupId === group.id)
					.map(editor => typeof editor.editorIndex === 'number' ? group.getEditorByIndex(editor.editorIndex) : group.activeEditor))
					.filter(editor => !keepStickyEditors || !group.isSticky(editor));

				return group.closeEditors(editorsToClose);
			}
		}));
	}

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITOR_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: KeyMod.CtrlCmd | KeyCode.KEY_W,
		win: { primary: KeyMod.CtrlCmd | KeyCode.F4, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_W] },
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			return closeEditorHandler(accessor, false, resourceOrContext, context);
		}
	});

	CommandsRegistry.registerCommand(CLOSE_PINNED_EDITOR_COMMAND_ID, (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
		return closeEditorHandler(accessor, true /* force close pinned editors */, resourceOrContext, context);
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITORS_IN_GROUP_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_W),
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			return Promise.all(getEditorsContext(accessor, resourceOrContext, context).groups.map(async group => {
				if (group) {
					return group.closeAllEditors({ excludeSticky: true });
				}
			}));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITOR_GROUP_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(ActiveEditorGroupEmptyContext, MultipleEditorGroupsContext),
		primary: KeyMod.CtrlCmd | KeyCode.KEY_W,
		win: { primary: KeyMod.CtrlCmd | KeyCode.F4, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_W] },
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const commandsContext = getCommandsContext(resourceOrContext, context);

			let group: IEditorGroup | undefined;
			if (commandsContext && typeof commandsContext.groupId === 'number') {
				group = editorGroupService.getGroup(commandsContext.groupId);
			} else {
				group = editorGroupService.activeGroup;
			}

			if (group) {
				editorGroupService.removeGroup(group);
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_SAVED_EDITORS_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_U),
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			return Promise.all(getEditorsContext(accessor, resourceOrContext, context).groups.map(async group => {
				if (group) {
					return group.closeEditors({ savedOnly: true, excludeSticky: true });
				}
			}));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_T },
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const { editors, groups } = getEditorsContext(accessor, resourceOrContext, context);
			return Promise.all(groups.map(async group => {
				if (group) {
					const editorsToKeep = editors
						.filter(editor => editor.groupId === group.id)
						.map(editor => typeof editor.editorIndex === 'number' ? group.getEditorByIndex(editor.editorIndex) : group.activeEditor);

					const editorsToClose = group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).filter(editor => !editorsToKeep.includes(editor));

					for (const editorToKeep of editorsToKeep) {
						if (editorToKeep) {
							group.pinEditor(editorToKeep);
						}
					}

					return group.closeEditors(editorsToClose);
				}
			}));
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: async (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, getCommandsContext(resourceOrContext, context));
			if (group && editor) {
				if (group.activeEditor) {
					group.pinEditor(group.activeEditor);
				}

				return group.closeEditors({ direction: CloseDirection.RIGHT, except: editor, excludeSticky: true });
			}
		}
	});

	CommandsRegistry.registerCommand(CLOSE_EDITORS_AND_GROUP_COMMAND_ID, async (accessor: ServicesAccessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
		const editorGroupService = accessor.get(IEditorGroupsService);

		const { group } = resolveCommandsContext(editorGroupService, getCommandsContext(resourceOrContext, context));
		if (group) {
			await group.closeAllEditors();

			if (group.count === 0 && editorGroupService.getGroup(group.id) /* could be gone by now */) {
				editorGroupService.removeGroup(group); // only remove group if it is now empty
			}
		}
	});
}

function registerFocusEditorGroupWihoutWrapCommands(): void {

	const commands = [
		{
			id: FOCUS_LEFT_GROUP_WITHOUT_WRAP_COMMAND_ID,
			direction: GroupDirection.LEFT
		},
		{
			id: FOCUS_RIGHT_GROUP_WITHOUT_WRAP_COMMAND_ID,
			direction: GroupDirection.RIGHT
		},
		{
			id: FOCUS_ABOVE_GROUP_WITHOUT_WRAP_COMMAND_ID,
			direction: GroupDirection.UP,
		},
		{
			id: FOCUS_BELOW_GROUP_WITHOUT_WRAP_COMMAND_ID,
			direction: GroupDirection.DOWN
		}
	];

	for (const command of commands) {
		CommandsRegistry.registerCommand(command.id, async (accessor: ServicesAccessor) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const group = editorGroupService.findGroup({ direction: command.direction }, editorGroupService.activeGroup, false);
			if (group) {
				group.focus();
			}
		});
	}
}

function registerOtherEditorCommands(): void {

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: KEEP_EDITOR_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.Enter),
		handler: async (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, getCommandsContext(resourceOrContext, context));
			if (group && editor) {
				return group.pinEditor(editor);
			}
		}
	});

	CommandsRegistry.registerCommand({
		id: TOGGLE_KEEP_EDITORS_COMMAND_ID,
		handler: accessor => {
			const configurationService = accessor.get(IConfigurationService);

			const currentSetting = configurationService.getValue<boolean>('workbench.editor.enablePreview');
			const newSetting = currentSetting === true ? false : true;
			configurationService.updateValue('workbench.editor.enablePreview', newSetting);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: PIN_EDITOR_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ActiveEditorStickyContext.toNegated(),
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.Shift | KeyCode.Enter),
		handler: async (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, getCommandsContext(resourceOrContext, context));
			if (group && editor) {
				return group.stickEditor(editor);
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: UNPIN_EDITOR_COMMAND_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ActiveEditorStickyContext,
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.Shift | KeyCode.Enter),
		handler: async (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);

			const { group, editor } = resolveCommandsContext(editorGroupService, getCommandsContext(resourceOrContext, context));
			if (group && editor) {
				return group.unstickEditor(editor);
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: SHOW_EDITORS_IN_GROUP,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: (accessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext) => {
			const editorGroupService = accessor.get(IEditorGroupsService);
			const quickInputService = accessor.get(IQuickInputService);

			const commandsContext = getCommandsContext(resourceOrContext, context);
			if (commandsContext && typeof commandsContext.groupId === 'number') {
				const group = editorGroupService.getGroup(commandsContext.groupId);
				if (group) {
					editorGroupService.activateGroup(group); // we need the group to be active
				}
			}

			return quickInputService.quickAccess.show(ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX);
		}
	});
}

function getEditorsContext(accessor: ServicesAccessor, resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext): { editors: IEditorCommandsContext[], groups: Array<IEditorGroup | undefined> } {
	const editorGroupService = accessor.get(IEditorGroupsService);
	const listService = accessor.get(IListService);

	const editorContext = getMultiSelectedEditorContexts(getCommandsContext(resourceOrContext, context), listService, editorGroupService);

	const activeGroup = editorGroupService.activeGroup;
	if (editorContext.length === 0 && activeGroup.activeEditor) {
		// add the active editor as fallback
		editorContext.push({
			groupId: activeGroup.id,
			editorIndex: activeGroup.getIndexOfEditor(activeGroup.activeEditor)
		});
	}

	return {
		editors: editorContext,
		groups: distinct(editorContext.map(context => context.groupId)).map(groupId => editorGroupService.getGroup(groupId))
	};
}

function getCommandsContext(resourceOrContext?: URI | IEditorCommandsContext, context?: IEditorCommandsContext): IEditorCommandsContext | undefined {
	if (URI.isUri(resourceOrContext)) {
		return context;
	}

	if (resourceOrContext && typeof resourceOrContext.groupId === 'number') {
		return resourceOrContext;
	}

	if (context && typeof context.groupId === 'number') {
		return context;
	}

	return undefined;
}

function resolveCommandsContext(editorGroupService: IEditorGroupsService, context?: IEditorCommandsContext): { group: IEditorGroup, editor?: IEditorInput } {

	// Resolve from context
	let group = context && typeof context.groupId === 'number' ? editorGroupService.getGroup(context.groupId) : undefined;
	let editor = group && context && typeof context.editorIndex === 'number' ? withNullAsUndefined(group.getEditorByIndex(context.editorIndex)) : undefined;

	// Fallback to active group as needed
	if (!group) {
		group = editorGroupService.activeGroup;
	}

	// Fallback to active editor as needed
	if (!editor) {
		editor = withNullAsUndefined(group.activeEditor);
	}

	return { group, editor };
}

export function getMultiSelectedEditorContexts(editorContext: IEditorCommandsContext | undefined, listService: IListService, editorGroupService: IEditorGroupsService): IEditorCommandsContext[] {

	// First check for a focused list to return the selected items from
	const list = listService.lastFocusedList;
	if (list instanceof List && list.getHTMLElement() === document.activeElement) {
		const elementToContext = (element: IEditorIdentifier | IEditorGroup) => {
			if (isEditorGroup(element)) {
				return { groupId: element.id, editorIndex: undefined };
			}

			const group = editorGroupService.getGroup(element.groupId);

			return { groupId: element.groupId, editorIndex: group ? group.getIndexOfEditor(element.editor) : -1 };
		};

		const onlyEditorGroupAndEditor = (e: IEditorIdentifier | IEditorGroup) => isEditorGroup(e) || isEditorIdentifier(e);

		const focusedElements: Array<IEditorIdentifier | IEditorGroup> = list.getFocusedElements().filter(onlyEditorGroupAndEditor);
		const focus = editorContext ? editorContext : focusedElements.length ? focusedElements.map(elementToContext)[0] : undefined; // need to take into account when editor context is { group: group }

		if (focus) {
			const selection: Array<IEditorIdentifier | IEditorGroup> = list.getSelectedElements().filter(onlyEditorGroupAndEditor);

			// Only respect selection if it contains focused element
			if (selection?.some(s => {
				if (isEditorGroup(s)) {
					return s.id === focus.groupId;
				}

				const group = editorGroupService.getGroup(s.groupId);
				return s.groupId === focus.groupId && (group ? group.getIndexOfEditor(s.editor) : -1) === focus.editorIndex;
			})) {
				return selection.map(elementToContext);
			}

			return [focus];
		}
	}

	// Otherwise go with passed in context
	return !!editorContext ? [editorContext] : [];
}

function isEditorGroup(thing: unknown): thing is IEditorGroup {
	const group = thing as IEditorGroup;

	return group && typeof group.id === 'number' && Array.isArray(group.editors);
}

function isEditorIdentifier(thing: unknown): thing is IEditorIdentifier {
	const identifier = thing as IEditorIdentifier;

	return identifier && typeof identifier.groupId === 'number';
}

export function setup(): void {
	registerActiveEditorMoveCommand();
	registerEditorGroupsLayoutCommand();
	registerDiffEditorCommands();
	registerOpenEditorAPICommands();
	registerOpenEditorAtIndexCommands();
	registerCloseEditorCommands();
	registerOtherEditorCommands();
	registerFocusEditorGroupAtIndexCommands();
	registerSplitEditorCommands();
	registerFocusEditorGroupWihoutWrapCommands();
}
