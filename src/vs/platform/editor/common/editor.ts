/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';

export interface IEditorModel {

	/**
	 * Emitted when the model is about to be disposed.
	 */
	readonly onWillDispose: Event<void>;

	/**
	 * Resolves the model.
	 */
	resolve(): Promise<void>;

	/**
	 * Find out if the editor model was resolved or not.
	 */
	isResolved(): boolean;

	/**
	 * Find out if this model has been disposed.
	 */
	isDisposed(): boolean;

	/**
	 * Dispose associated resources
	 */
	dispose(): void;
}

export interface IBaseResourceEditorInput {

	/**
	 * Optional options to use when opening the text input.
	 */
	options?: ITextEditorOptions;

	/**
	 * Label to show for the diff editor
	 */
	readonly label?: string;

	/**
	 * Description to show for the diff editor
	 */
	readonly description?: string;

	/**
	 * Hint to indicate that this input should be treated as a file
	 * that opens in an editor capable of showing file content.
	 *
	 * Without this hint, the editor service will make a guess by
	 * looking at the scheme of the resource(s).
	 */
	readonly forceFile?: boolean;

	/**
	 * Hint to indicate that this input should be treated as a
	 * untitled file.
	 *
	 * Without this hint, the editor service will make a guess by
	 * looking at the scheme of the resource(s).
	 */
	readonly forceUntitled?: boolean;
}

/**
 * This identifier allows to uniquely identify an editor with a
 * resource and type identifier.
 */
export interface IResourceEditorInputIdentifier {

	/**
	 * The resource URI of the editor.
	 */
	readonly resource: URI;

	/**
	 * The type of the editor.
	 */
	readonly typeId: string;
}

export interface IResourceEditorInput extends IBaseResourceEditorInput {

	/**
	 * The resource URI of the resource to open.
	 */
	readonly resource: URI;

	/**
	 * The encoding of the text input if known.
	 */
	readonly encoding?: string;

	/**
	 * The identifier of the language mode of the text input
	 * if known to use when displaying the contents.
	 */
	readonly mode?: string;
}

export enum EditorActivation {

	/**
	 * Activate the editor after it opened. This will automatically restore
	 * the editor if it is minimized.
	 */
	ACTIVATE,

	/**
	 * Only restore the editor if it is minimized but do not activate it.
	 *
	 * Note: will only work in combination with the `preserveFocus: true` option.
	 * Otherwise, if focus moves into the editor, it will activate and restore
	 * automatically.
	 */
	RESTORE,

	/**
	 * Preserve the current active editor.
	 *
	 * Note: will only work in combination with the `preserveFocus: true` option.
	 * Otherwise, if focus moves into the editor, it will activate and restore
	 * automatically.
	 */
	PRESERVE
}

export enum EditorOverride {

	/**
	 * Displays a picker and allows the user to decide which editor to use
	 */
	PICK = 1,

	/**
	 * Disables overrides
	 */
	DISABLED
}

export enum EditorOpenContext {

	/**
	 * Default: the editor is opening via a programmatic call
	 * to the editor service API.
	 */
	API,

	/**
	 * Indicates that a user action triggered the opening, e.g.
	 * via mouse or keyboard use.
	 */
	USER
}

export interface IEditorOptions {

	/**
	 * Tells the editor to not receive keyboard focus when the editor is being opened.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	readonly preserveFocus?: boolean;

	/**
	 * This option is only relevant if an editor is opened into a group that is not active
	 * already and allows to control if the inactive group should become active, restored
	 * or preserved.
	 *
	 * By default, the editor group will become active unless `preserveFocus` or `inactive`
	 * is specified.
	 */
	readonly activation?: EditorActivation;

	/**
	 * Tells the editor to reload the editor input in the editor even if it is identical to the one
	 * already showing. By default, the editor will not reload the input if it is identical to the
	 * one showing.
	 */
	readonly forceReload?: boolean;

	/**
	 * Will reveal the editor if it is already opened and visible in any of the opened editor groups.
	 *
	 * Note that this option is just a hint that might be ignored if the user wants to open an editor explicitly
	 * to the side of another one or into a specific editor group.
	 */
	readonly revealIfVisible?: boolean;

	/**
	 * Will reveal the editor if it is already opened (even when not visible) in any of the opened editor groups.
	 *
	 * Note that this option is just a hint that might be ignored if the user wants to open an editor explicitly
	 * to the side of another one or into a specific editor group.
	 */
	readonly revealIfOpened?: boolean;

	/**
	 * An editor that is pinned remains in the editor stack even when another editor is being opened.
	 * An editor that is not pinned will always get replaced by another editor that is not pinned.
	 */
	readonly pinned?: boolean;

	/**
	 * An editor that is sticky moves to the beginning of the editors list within the group and will remain
	 * there unless explicitly closed. Operations such as "Close All" will not close sticky editors.
	 */
	readonly sticky?: boolean;

	/**
	 * The index in the document stack where to insert the editor into when opening.
	 */
	readonly index?: number;

	/**
	 * An active editor that is opened will show its contents directly. Set to true to open an editor
	 * in the background without loading its contents.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	readonly inactive?: boolean;

	/**
	 * Will not show an error in case opening the editor fails and thus allows to show a custom error
	 * message as needed. By default, an error will be presented as notification if opening was not possible.
	 */
	readonly ignoreError?: boolean;

	/**
	 * Allows to override the editor that should be used to display the input:
	 * - `undefined`: let the editor decide for itself
	 * - `string`: specific override by id
	 * - `EditorOverride`: specific override handling
	 */
	readonly override?: string | EditorOverride;

	/**
	 * A optional hint to signal in which context the editor opens.
	 *
	 * If configured to be `EditorOpenContext.USER`, this hint can be
	 * used in various places to control the experience. For example,
	 * if the editor to open fails with an error, a notification could
	 * inform about this in a modal dialog. If the editor opened through
	 * some background task, the notification would show in the background,
	 * not as a modal dialog.
	 */
	readonly context?: EditorOpenContext;
}

export interface ITextEditorSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber?: number;
	readonly endColumn?: number;
}

export const enum TextEditorSelectionRevealType {
	/**
	 * Option to scroll vertically or horizontally as necessary and reveal a range centered vertically.
	 */
	Center = 0,
	/**
	 * Option to scroll vertically or horizontally as necessary and reveal a range centered vertically only if it lies outside the viewport.
	 */
	CenterIfOutsideViewport = 1,
	/**
	 * Option to scroll vertically or horizontally as necessary and reveal a range close to the top of the viewport, but not quite at the top.
	 */
	NearTop = 2,
	/**
	 * Option to scroll vertically or horizontally as necessary and reveal a range close to the top of the viewport, but not quite at the top.
	 * Only if it lies outside the viewport
	 */
	NearTopIfOutsideViewport = 3,
}

export interface ITextEditorOptions extends IEditorOptions {

	/**
	 * Text editor selection.
	 */
	readonly selection?: ITextEditorSelection;

	/**
	 * Text editor view state.
	 */
	readonly viewState?: object;

	/**
	 * Option to control the text editor selection reveal type.
	 * Defaults to TextEditorSelectionRevealType.Center
	 */
	readonly selectionRevealType?: TextEditorSelectionRevealType;
}
