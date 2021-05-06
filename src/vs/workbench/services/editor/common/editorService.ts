/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IResourceEditorInput, IEditorOptions, ITextEditorOptions, IResourceEditorInputIdentifier } from 'vs/platform/editor/common/editor';
import { IEditorInput, IEditorPane, GroupIdentifier, IEditorInputWithOptions, IUntitledTextResourceEditorInput, IResourceDiffEditorInput, ITextEditorPane, ITextDiffEditorPane, IEditorIdentifier, ISaveOptions, IRevertOptions, EditorsOrder, IVisibleEditorPane, IEditorCloseEvent } from 'vs/workbench/common/editor';
import { Event } from 'vs/base/common/event';
import { IEditor, IDiffEditor } from 'vs/editor/common/editorCommon';
import { IEditorGroup, IEditorReplacement } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';

export const IEditorService = createDecorator<IEditorService>('editorService');

export type IResourceEditorInputType = IResourceEditorInput | IUntitledTextResourceEditorInput | IResourceDiffEditorInput;

export interface IResourceEditorReplacement {
	readonly editor: IResourceEditorInputType;
	readonly replacement: IResourceEditorInputType;
}

export const ACTIVE_GROUP = -1;
export type ACTIVE_GROUP_TYPE = typeof ACTIVE_GROUP;

export const SIDE_GROUP = -2;
export type SIDE_GROUP_TYPE = typeof SIDE_GROUP;

export interface IOpenEditorOverrideEntry {
	readonly id: string;
	readonly label: string;
	readonly active: boolean;
	readonly detail?: string;
}

export interface IOpenEditorOverrideHandler {
	open(editor: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup): IOpenEditorOverride | undefined;
	getEditorOverrides?(resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined): IOpenEditorOverrideEntry[];
}

export interface IOpenEditorOverride {

	/**
	 * If defined, will prevent the opening of an editor and replace the resulting
	 * promise with the provided promise for the openEditor() call.
	 */
	override?: Promise<IEditorPane | undefined>;
}

export interface ISaveEditorsOptions extends ISaveOptions {

	/**
	 * If true, will ask for a location of the editor to save to.
	 */
	readonly saveAs?: boolean;
}

export interface IBaseSaveRevertAllEditorOptions {

	/**
	 * Whether to include untitled editors as well.
	 */
	readonly includeUntitled?: boolean;

	/**
	 * Whether to exclude sticky editors.
	 */
	readonly excludeSticky?: boolean;
}

export interface ISaveAllEditorsOptions extends ISaveEditorsOptions, IBaseSaveRevertAllEditorOptions { }

export interface IRevertAllEditorsOptions extends IRevertOptions, IBaseSaveRevertAllEditorOptions { }

export interface IEditorService {

	readonly _serviceBrand: undefined;

	/**
	 * Emitted when the currently active editor changes.
	 *
	 * @see `IEditorService.activeEditorPane`
	 */
	readonly onDidActiveEditorChange: Event<void>;

	/**
	 * Emitted when any of the current visible editors changes.
	 *
	 * @see `IEditorService.visibleEditorPanes`
	 */
	readonly onDidVisibleEditorsChange: Event<void>;

	/**
	 * Emitted when an editor is closed.
	 */
	readonly onDidCloseEditor: Event<IEditorCloseEvent>;

	/**
	 * The currently active editor pane or `undefined` if none. The editor pane is
	 * the workbench container for editors of any kind.
	 *
	 * @see `IEditorService.activeEditor` for access to the active editor input
	 */
	readonly activeEditorPane: IVisibleEditorPane | undefined;

	/**
	 * The currently active editor or `undefined` if none. An editor is active when it is
	 * located in the currently active editor group. It will be `undefined` if the active
	 * editor group has no editors open.
	 */
	readonly activeEditor: IEditorInput | undefined;

	/**
	 * The currently active text editor control or `undefined` if there is currently no active
	 * editor or the active editor widget is neither a text nor a diff editor.
	 *
	 * @see `IEditorService.activeEditor`
	 */
	readonly activeTextEditorControl: IEditor | IDiffEditor | undefined;

	/**
	 * The currently active text editor mode or `undefined` if there is currently no active
	 * editor or the active editor control is neither a text nor a diff editor. If the active
	 * editor is a diff editor, the modified side's mode will be taken.
	 */
	readonly activeTextEditorMode: string | undefined;

	/**
	 * All editor panes that are currently visible across all editor groups.
	 *
	 * @see `IEditorService.visibleEditors` for access to the visible editor inputs
	 */
	readonly visibleEditorPanes: readonly IVisibleEditorPane[];

	/**
	 * All editors that are currently visible. An editor is visible when it is opened in an
	 * editor group and active in that group. Multiple editor groups can be opened at the same time.
	 */
	readonly visibleEditors: readonly IEditorInput[];

	/**
	 * All text editor widgets that are currently visible across all editor groups. A text editor
	 * widget is either a text or a diff editor.
	 */
	readonly visibleTextEditorControls: readonly (IEditor | IDiffEditor)[];

	/**
	 * All editors that are opened across all editor groups in sequential order
	 * of appearance.
	 *
	 * This includes active as well as inactive editors in each editor group.
	 */
	readonly editors: readonly IEditorInput[];

	/**
	 * The total number of editors that are opened either inactive or active.
	 */
	readonly count: number;

	/**
	 * All editors that are opened across all editor groups with their group
	 * identifier.
	 *
	 * @param order the order of the editors to use
	 * @param options whether to exclude sticky editors or not
	 */
	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): readonly IEditorIdentifier[];

	/**
	 * Open an editor in an editor group.
	 *
	 * @param editor the editor to open
	 * @param options the options to use for the editor
	 * @param group the target group. If unspecified, the editor will open in the currently
	 * active group. Use `SIDE_GROUP_TYPE` to open the editor in a new editor group to the side
	 * of the currently active group.
	 *
	 * @returns the editor that opened or `undefined` if the operation failed or the editor was not
	 * opened to be active.
	 */
	openEditor(editor: IEditorInput, options?: IEditorOptions | ITextEditorOptions, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): Promise<IEditorPane | undefined>;
	openEditor(editor: IResourceEditorInput | IUntitledTextResourceEditorInput, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): Promise<ITextEditorPane | undefined>;
	openEditor(editor: IResourceDiffEditorInput, group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): Promise<ITextDiffEditorPane | undefined>;

	/**
	 * Open editors in an editor group.
	 *
	 * @param editors the editors to open with associated options
	 * @param group the target group. If unspecified, the editor will open in the currently
	 * active group. Use `SIDE_GROUP_TYPE` to open the editor in a new editor group to the side
	 * of the currently active group.
	 *
	 * @returns the editors that opened. The array can be empty or have less elements for editors
	 * that failed to open or were instructed to open as inactive.
	 */
	openEditors(editors: IEditorInputWithOptions[], group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): Promise<readonly IEditorPane[]>;
	openEditors(editors: IResourceEditorInputType[], group?: IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE): Promise<readonly IEditorPane[]>;

	/**
	 * Replaces editors in an editor group with the provided replacement.
	 *
	 * @param editors the editors to replace
	 * @param group the editor group
	 *
	 * @returns a promise that is resolved when the replaced active
	 * editor (if any) has finished loading.
	 */
	replaceEditors(editors: IResourceEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	replaceEditors(editors: IEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;

	/**
	 * Find out if the provided editor is opened in any editor group.
	 *
	 * Note: An editor can be opened but not actively visible.
	 *
	 * Note: This method will return `true` if a side by side editor
	 * is opened where the `primary` editor matches too.
	 */
	isOpened(editor: IResourceEditorInputIdentifier): boolean;

	/**
	 * This method will return an entry for each editor that reports
	 * a `resource` that matches the provided one in the group or
	 * across all groups.
	 *
	 * It is possible that multiple editors are returned in case the
	 * same resource is opened in different editors. To find the specific
	 * editor, use the `IResourceEditorInputIdentifier` as input.
	 */
	findEditors(resource: URI): readonly IEditorIdentifier[];
	findEditors(resource: IResourceEditorInputIdentifier): readonly IEditorIdentifier[];
	findEditors(resource: URI, group: IEditorGroup | GroupIdentifier): readonly IEditorInput[];
	findEditors(resource: IResourceEditorInputIdentifier, group: IEditorGroup | GroupIdentifier): IEditorInput | undefined;

	/**
	 * Get all available editor overrides for the editor input.
	 */
	getEditorOverrides(resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined): [IOpenEditorOverrideHandler, IOpenEditorOverrideEntry][];

	/**
	 * Allows to override the opening of editors by installing a handler that will
	 * be called each time an editor is about to open allowing to override the
	 * operation to open a different editor.
	 */
	overrideOpenEditor(handler: IOpenEditorOverrideHandler): IDisposable;

	/**
	 * Converts a lightweight input to a workbench editor input.
	 */
	createEditorInput(input: IResourceEditorInputType): IEditorInput;

	/**
	 * Save the provided list of editors.
	 *
	 * @returns `true` if all editors saved and `false` otherwise.
	 */
	save(editors: IEditorIdentifier | IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<boolean>;

	/**
	 * Save all editors.
	 *
	 * @returns `true` if all editors saved and `false` otherwise.
	 */
	saveAll(options?: ISaveAllEditorsOptions): Promise<boolean>;

	/**
	 * Reverts the provided list of editors.
	 *
	 * @returns `true` if all editors reverted and `false` otherwise.
	 */
	revert(editors: IEditorIdentifier | IEditorIdentifier[], options?: IRevertOptions): Promise<boolean>;

	/**
	 * Reverts all editors.
	 *
	 * @returns `true` if all editors reverted and `false` otherwise.
	 */
	revertAll(options?: IRevertAllEditorsOptions): Promise<boolean>;
}
