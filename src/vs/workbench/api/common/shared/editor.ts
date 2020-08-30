/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorGroupsService, IEditorGroup, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { GroupIdentifier } from 'vs/workbench/common/editor';
import { ACTIVE_GROUP, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';

export type EditorViewColumn = number;

export function viewColumnToEditorGroup(editorGroupService: IEditorGroupsService, position?: EditorViewColumn): GroupIdentifier {
	if (typeof position !== 'number' || position === ACTIVE_GROUP) {
		return ACTIVE_GROUP; // prefer active group when position is undefined or passed in as such
	}

	const groups = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE);

	let candidate = groups[position];
	if (candidate) {
		return candidate.id; // found direct match
	}

	let firstGroup = groups[0];
	if (groups.length === 1 && firstGroup.count === 0) {
		return firstGroup.id; // first editor should always open in first group independent from position provided
	}

	return SIDE_GROUP; // open to the side if group not found or we are instructed to
}

export function editorGroupToViewColumn(editorGroupService: IEditorGroupsService, editorGroup: IEditorGroup | GroupIdentifier): EditorViewColumn {
	const group = (typeof editorGroup === 'number') ? editorGroupService.getGroup(editorGroup) : editorGroup;
	if (!group) {
		throw new Error('Invalid group provided');
	}

	return editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).indexOf(group);
}
