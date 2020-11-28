/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GroupIdentifier, IWorkbenchEditorConfiguration, EditorOptions, TextEditorOptions, IEditorInput, IEditorIdentifier, IEditorCloseEvent, IEditorPane, IEditorPartOptions, IEditorPartOptionsChangeEvent, EditorInput } from 'vs/workbench/common/editor';
import { EditorGroup } from 'vs/workbench/common/editor/editorGroup';
import { IEditorGroup, GroupDirection, IAddGroupOptions, IMergeGroupOptions, GroupsOrder, GroupsArrangement, OpenEditorContext } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Dimension } from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import { IConfigurationChangeEvent, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ISerializableView } from 'vs/base/browser/ui/grid/grid';
import { getIEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorService, IResourceEditorInputType } from 'vs/workbench/services/editor/common/editorService';

export interface IEditorPartCreationOptions {
	restorePreviousState: boolean;
}

export const DEFAULT_EDITOR_MIN_DIMENSIONS = new Dimension(220, 70);
export const DEFAULT_EDITOR_MAX_DIMENSIONS = new Dimension(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);

export const DEFAULT_EDITOR_PART_OPTIONS: IEditorPartOptions = {
	showTabs: true,
	highlightModifiedTabs: false,
	tabCloseButton: 'right',
	tabSizing: 'fit',
	pinnedTabSizing: 'normal',
	titleScrollbarSizing: 'default',
	focusRecentEditorAfterClose: true,
	showIcons: true,
	hasIcons: true, // 'vs-seti' is our default icon theme
	enablePreview: true,
	openPositioning: 'right',
	openSideBySideDirection: 'right',
	closeEmptyGroups: true,
	labelFormat: 'default',
	splitSizing: 'distribute',
	splitOnDragAndDrop: true
};

export function impactsEditorPartOptions(event: IConfigurationChangeEvent): boolean {
	return event.affectsConfiguration('workbench.editor') || event.affectsConfiguration('workbench.iconTheme');
}

export function getEditorPartOptions(configurationService: IConfigurationService, themeService: IThemeService): IEditorPartOptions {
	const options = {
		...DEFAULT_EDITOR_PART_OPTIONS,
		hasIcons: themeService.getFileIconTheme().hasFileIcons
	};

	const config = configurationService.getValue<IWorkbenchEditorConfiguration>();
	if (config?.workbench?.editor) {
		Object.assign(options, config.workbench.editor);
	}

	return options;
}

export interface IEditorOpeningEvent extends IEditorIdentifier {

	/**
	 * The options used when opening the editor.
	 */
	readonly options?: IEditorOptions;

	/**
	 * Context indicates how the editor open event is initialized.
	 */
	readonly context?: OpenEditorContext;

	/**
	 * Allows to prevent the opening of an editor by providing a callback
	 * that will be executed instead. By returning another editor promise
	 * it is possible to override the opening with another editor. It is ok
	 * to return a promise that resolves to `undefined` to prevent the opening
	 * alltogether.
	 */
	prevent(callback: () => Promise<IEditorPane | undefined> | undefined): void;
}

export interface IEditorGroupsAccessor {

	readonly groups: IEditorGroupView[];
	readonly activeGroup: IEditorGroupView;

	readonly partOptions: IEditorPartOptions;
	readonly onDidEditorPartOptionsChange: Event<IEditorPartOptionsChangeEvent>;

	readonly onDidVisibilityChange: Event<boolean>;

	getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined;
	getGroups(order: GroupsOrder): IEditorGroupView[];

	activateGroup(identifier: IEditorGroupView | GroupIdentifier): IEditorGroupView;
	restoreGroup(identifier: IEditorGroupView | GroupIdentifier): IEditorGroupView;

	addGroup(location: IEditorGroupView | GroupIdentifier, direction: GroupDirection, options?: IAddGroupOptions): IEditorGroupView;
	mergeGroup(group: IEditorGroupView | GroupIdentifier, target: IEditorGroupView | GroupIdentifier, options?: IMergeGroupOptions): IEditorGroupView;

	moveGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView;
	copyGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView;

	removeGroup(group: IEditorGroupView | GroupIdentifier): void;

	arrangeGroups(arrangement: GroupsArrangement, target?: IEditorGroupView | GroupIdentifier): void;
}

export interface IEditorGroupTitleDimensions {

	/**
	 * The overall height of the editor group title control.
	 */
	height: number;

	/**
	 * The height offset to e.g. use when drawing drop overlays.
	 * This number may be smaller than `height` if the title control
	 * decides to have an `offset` that is within the title area
	 * (e.g. when breadcrumbs are enabled).
	 */
	offset: number;
}

export interface IEditorGroupView extends IDisposable, ISerializableView, IEditorGroup {

	readonly onDidFocus: Event<void>;
	readonly onWillDispose: Event<void>;
	readonly onWillOpenEditor: Event<IEditorOpeningEvent>;
	readonly onDidOpenEditorFail: Event<IEditorInput>;
	readonly onWillCloseEditor: Event<IEditorCloseEvent>;
	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	readonly group: EditorGroup;
	readonly whenRestored: Promise<void>;

	readonly titleDimensions: IEditorGroupTitleDimensions;

	readonly isEmpty: boolean;
	readonly isMinimized: boolean;

	readonly disposed: boolean;

	setActive(isActive: boolean): void;

	notifyIndexChanged(newIndex: number): void;

	relayout(): void;
}

export function getActiveTextEditorOptions(group: IEditorGroup, expectedActiveEditor?: IEditorInput, presetOptions?: EditorOptions): EditorOptions {
	const activeGroupCodeEditor = group.activeEditorPane ? getIEditor(group.activeEditorPane.getControl()) : undefined;
	if (activeGroupCodeEditor) {
		if (!expectedActiveEditor || expectedActiveEditor.matches(group.activeEditor)) {
			return TextEditorOptions.fromEditor(activeGroupCodeEditor, presetOptions);
		}
	}

	return presetOptions || new EditorOptions();
}

/**
 * A sub-interface of IEditorService to hide some workbench-core specific
 * events from clients.
 */
export interface EditorServiceImpl extends IEditorService {

	/**
	 * Emitted when an editor failed to open.
	 */
	readonly onDidOpenEditorFail: Event<IEditorIdentifier>;

	/**
	 * Emitted when the list of most recently active editors change.
	 */
	readonly onDidMostRecentlyActiveEditorsChange: Event<void>;

	/**
	 * Override to return a typed `EditorInput`.
	 */
	createEditorInput(input: IResourceEditorInputType): EditorInput;
}
