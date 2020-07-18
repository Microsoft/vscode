/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// #######################################################################
// ###                                                                 ###
// ###      electron.d.ts types we need in a common layer for reuse    ###
// ###                      (copied from Electron 7.x)                 ###
// ###                                                                 ###
// #######################################################################


export interface MessageBoxOptions {
	/**
	 * Can be `"none"`, `"info"`, `"error"`, `"question"` or `"warning"`. On Windows,
	 * `"question"` displays the same icon as `"info"`, unless you set an icon using
	 * the `"icon"` option. On macOS, both `"warning"` and `"error"` display the same
	 * warning icon.
	 */
	type?: string;
	/**
	 * Array of texts for buttons. On Windows, an empty array will result in one button
	 * labeled "OK".
	 */
	buttons?: string[];
	/**
	 * Index of the button in the buttons array which will be selected by default when
	 * the message box opens.
	 */
	defaultId?: number;
	/**
	 * Title of the message box, some platforms will not show it.
	 */
	title?: string;
	/**
	 * Content of the message box.
	 */
	message: string;
	/**
	 * Extra information of the message.
	 */
	detail?: string;
	/**
	 * If provided, the message box will include a checkbox with the given label.
	 */
	checkboxLabel?: string;
	/**
	 * Initial checked state of the checkbox. `false` by default.
	 */
	checkboxChecked?: boolean;
	// icon?: NativeImage;
	/**
	 * The index of the button to be used to cancel the dialog, via the `Esc` key. By
	 * default this is assigned to the first button with "cancel" or "no" as the label.
	 * If no such labeled buttons exist and this option is not set, `0` will be used as
	 * the return value.
	 */
	cancelId?: number;
	/**
	 * On Windows Electron will try to figure out which one of the `buttons` are common
	 * buttons (like "Cancel" or "Yes"), and show the others as command links in the
	 * dialog. This can make the dialog appear in the style of modern Windows apps. If
	 * you don't like this behavior, you can set `noLink` to `true`.
	 */
	noLink?: boolean;
	/**
	 * Normalize the keyboard access keys across platforms. Default is `false`.
	 * Enabling this assumes `&` is used in the button labels for the placement of the
	 * keyboard shortcut access key and labels will be converted so they work correctly
	 * on each platform, `&` characters are removed on macOS, converted to `_` on
	 * Linux, and left untouched on Windows. For example, a button label of `Vie&w`
	 * will be converted to `Vie_w` on Linux and `View` on macOS and can be selected
	 * via `Alt-W` on Windows and Linux.
	 */
	normalizeAccessKeys?: boolean;
}

export interface MessageBoxReturnValue {
	/**
	 * The index of the clicked button.
	 */
	response: number;
	/**
	 * The checked state of the checkbox if `checkboxLabel` was set. Otherwise `false`.
	 */
	checkboxChecked: boolean;
}

export interface OpenDevToolsOptions {
	/**
	 * Opens the devtools with specified dock state, can be `right`, `bottom`,
	 * `undocked`, `detach`. Defaults to last used dock state. In `undocked` mode it's
	 * possible to dock back. In `detach` mode it's not.
	 */
	mode: ('right' | 'bottom' | 'undocked' | 'detach');
	/**
	 * Whether to bring the opened devtools window to the foreground. The default is
	 * `true`.
	 */
	activate?: boolean;
}

export interface SaveDialogOptions {
	title?: string;
	/**
	 * Absolute directory path, absolute file path, or file name to use by default.
	 */
	defaultPath?: string;
	/**
	 * Custom label for the confirmation button, when left empty the default label will
	 * be used.
	 */
	buttonLabel?: string;
	filters?: FileFilter[];
	/**
	 * Message to display above text fields.
	 *
	 * @platform darwin
	 */
	message?: string;
	/**
	 * Custom label for the text displayed in front of the filename text field.
	 *
	 * @platform darwin
	 */
	nameFieldLabel?: string;
	/**
	 * Show the tags input box, defaults to `true`.
	 *
	 * @platform darwin
	 */
	showsTagField?: boolean;
	/**
	 * Create a security scoped bookmark when packaged for the Mac App Store. If this
	 * option is enabled and the file doesn't already exist a blank file will be
	 * created at the chosen path.
	 *
	 * @platform darwin,mas
	 */
	securityScopedBookmarks?: boolean;
}

export interface OpenDialogOptions {
	title?: string;
	defaultPath?: string;
	/**
	 * Custom label for the confirmation button, when left empty the default label will
	 * be used.
	 */
	buttonLabel?: string;
	filters?: FileFilter[];
	/**
	 * Contains which features the dialog should use. The following values are
	 * supported:
	 */
	properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles' | 'createDirectory' | 'promptToCreate' | 'noResolveAliases' | 'treatPackageAsDirectory'>;
	/**
	 * Message to display above input boxes.
	 *
	 * @platform darwin
	 */
	message?: string;
	/**
	 * Create security scoped bookmarks when packaged for the Mac App Store.
	 *
	 * @platform darwin,mas
	 */
	securityScopedBookmarks?: boolean;
}

export interface OpenDialogReturnValue {
	/**
	 * whether or not the dialog was canceled.
	 */
	canceled: boolean;
	/**
	 * An array of file paths chosen by the user. If the dialog is cancelled this will
	 * be an empty array.
	 */
	filePaths: string[];
	/**
	 * An array matching the `filePaths` array of base64 encoded strings which contains
	 * security scoped bookmark data. `securityScopedBookmarks` must be enabled for
	 * this to be populated. (For return values, see table here.)
	 *
	 * @platform darwin,mas
	 */
	bookmarks?: string[];
}

export interface SaveDialogReturnValue {
	/**
	 * whether or not the dialog was canceled.
	 */
	canceled: boolean;
	/**
	 * If the dialog is canceled, this will be `undefined`.
	 */
	filePath?: string;
	/**
	 * Base64 encoded string which contains the security scoped bookmark data for the
	 * saved file. `securityScopedBookmarks` must be enabled for this to be present.
	 * (For return values, see table here.)
	 *
	 * @platform darwin,mas
	 */
	bookmark?: string;
}

export interface CrashReporterStartOptions {
	companyName: string;
	/**
	 * URL that crash reports will be sent to as POST.
	 */
	submitURL: string;
	/**
	 * Defaults to `app.name`.
	 */
	productName?: string;
	/**
	 * Whether crash reports should be sent to the server. Default is `true`.
	 */
	uploadToServer?: boolean;
	/**
	 * Default is `false`.
	 */
	ignoreSystemCrashHandler?: boolean;
	/**
	 * An object you can define that will be sent along with the report. Only string
	 * properties are sent correctly. Nested objects are not supported. When using
	 * Windows, the property names and values must be fewer than 64 characters.
	 */
	extra?: Record<string, string>;
	/**
	 * Directory to store the crash reports temporarily (only used when the crash
	 * reporter is started via `process.crashReporter.start`).
	 */
	crashesDirectory?: string;
}

export interface FileFilter {

	// Docs: http://electronjs.org/docs/api/structures/file-filter

	extensions: string[];
	name: string;
}

export interface InputEvent {

	// Docs: http://electronjs.org/docs/api/structures/input-event

	/**
	 * An array of modifiers of the event, can be `shift`, `control`, `alt`, `meta`,
	 * `isKeypad`, `isAutoRepeat`, `leftButtonDown`, `middleButtonDown`,
	 * `rightButtonDown`, `capsLock`, `numLock`, `left`, `right`.
	 */
	modifiers: Array<'shift' | 'control' | 'alt' | 'meta' | 'isKeypad' | 'isAutoRepeat' | 'leftButtonDown' | 'middleButtonDown' | 'rightButtonDown' | 'capsLock' | 'numLock' | 'left' | 'right'>;
}

export interface MouseInputEvent extends InputEvent {

	// Docs: http://electronjs.org/docs/api/structures/mouse-input-event

	/**
	 * The button pressed, can be `left`, `middle`, `right`.
	 */
	button?: ('left' | 'middle' | 'right');
	clickCount?: number;
	globalX?: number;
	globalY?: number;
	movementX?: number;
	movementY?: number;
	/**
	 * The type of the event, can be `mouseDown`, `mouseUp`, `mouseEnter`,
	 * `mouseLeave`, `contextMenu`, `mouseWheel` or `mouseMove`.
	 */
	type: ('mouseDown' | 'mouseUp' | 'mouseEnter' | 'mouseLeave' | 'contextMenu' | 'mouseWheel' | 'mouseMove');
	x: number;
	y: number;
}
