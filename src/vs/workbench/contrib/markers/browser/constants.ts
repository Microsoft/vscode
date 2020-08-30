/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export default {
	MARKERS_CONTAINER_ID: 'workbench.panel.markers',
	MARKERS_VIEW_ID: 'workbench.panel.markers.view',
	MARKERS_VIEW_STORAGE_ID: 'workbench.panel.markers',
	MARKER_COPY_ACTION_ID: 'problems.action.copy',
	MARKER_COPY_MESSAGE_ACTION_ID: 'problems.action.copyMessage',
	RELATED_INFORMATION_COPY_MESSAGE_ACTION_ID: 'problems.action.copyRelatedInformationMessage',
	FOCUS_PROBLEMS_FROM_FILTER: 'problems.action.focusProblemsFromFilter',
	MARKERS_VIEW_FOCUS_FILTER: 'problems.action.focusFilter',
	MARKERS_VIEW_CLEAR_FILTER_TEXT: 'problems.action.clearFilterText',
	MARKERS_VIEW_SHOW_MULTILINE_MESSAGE: 'problems.action.showMultilineMessage',
	MARKERS_VIEW_SHOW_SINGLELINE_MESSAGE: 'problems.action.showSinglelineMessage',
	MARKER_OPEN_ACTION_ID: 'problems.action.open',
	MARKER_OPEN_SIDE_ACTION_ID: 'problems.action.openToSide',
	MARKER_SHOW_PANEL_ID: 'workbench.action.showErrorsWarnings',
	MARKER_SHOW_QUICK_FIX: 'problems.action.showQuickFixes',
	TOGGLE_MARKERS_VIEW_ACTION_ID: 'workbench.actions.view.toggleProblems',

	MarkersViewSmallLayoutContextKey: new RawContextKey<boolean>(`problemsView.smallLayout`, false),
	MarkerFocusContextKey: new RawContextKey<boolean>('problemFocus', false),
	MarkerViewFilterFocusContextKey: new RawContextKey<boolean>('problemsFilterFocus', false),
	RelatedInformationFocusContextKey: new RawContextKey<boolean>('relatedInformationFocus', false)
};
