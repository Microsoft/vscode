/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import * as platform from 'vs/base/common/platform';
import { CopyOptions } from 'vs/editor/browser/controller/textAreaInput';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, IActionOptions, ICommandKeybindingsOptions, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { MenuId } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

const CLIPBOARD_CONTEXT_MENU_GROUP = '9_cutcopypaste';

const supportsCut = (platform.isNative || document.queryCommandSupported('cut'));
const supportsCopy = (platform.isNative || document.queryCommandSupported('copy'));
// IE and Edge have trouble with setting html content in clipboard
const supportsCopyWithSyntaxHighlighting = (supportsCopy && !browser.isEdge);
// Chrome incorrectly returns true for document.queryCommandSupported('paste')
// when the paste feature is available but the calling script has insufficient
// privileges to actually perform the action
const supportsPaste = (platform.isNative || (!browser.isChrome && document.queryCommandSupported('paste')));

type ExecCommand = 'cut' | 'copy' | 'paste';

abstract class ExecCommandAction extends EditorAction {

	private readonly browserCommand: ExecCommand;

	constructor(browserCommand: ExecCommand, opts: IActionOptions) {
		super(opts);
		this.browserCommand = browserCommand;
	}

	public runCommand(accessor: ServicesAccessor, args: any): void {
		let focusedEditor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
		// Only if editor text focus (i.e. not if editor has widget focus).
		if (focusedEditor && focusedEditor.hasTextFocus()) {
			focusedEditor.trigger('keyboard', this.id, args);
			return;
		}

		document.execCommand(this.browserCommand);
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		editor.focus();
		document.execCommand(this.browserCommand);
	}
}

class ExecCommandCutAction extends ExecCommandAction {

	constructor() {
		let kbOpts: ICommandKeybindingsOptions | undefined = {
			kbExpr: EditorContextKeys.textInputFocus,
			primary: KeyMod.CtrlCmd | KeyCode.KEY_X,
			win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_X, secondary: [KeyMod.Shift | KeyCode.Delete] },
			weight: KeybindingWeight.EditorContrib
		};
		// Do not bind cut keybindings in the browser,
		// since browsers do that for us and it avoids security prompts
		if (!platform.isNative) {
			kbOpts = undefined;
		}
		super('cut', {
			id: 'editor.action.clipboardCutAction',
			label: nls.localize('actions.clipboard.cutLabel', "Cut"),
			alias: 'Cut',
			precondition: EditorContextKeys.writable,
			kbOpts: kbOpts,
			contextMenuOpts: {
				group: CLIPBOARD_CONTEXT_MENU_GROUP,
				order: 1
			},
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '2_ccp',
				title: nls.localize({ key: 'miCut', comment: ['&& denotes a mnemonic'] }, "Cu&&t"),
				order: 1
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (!editor.hasModel()) {
			return;
		}

		const emptySelectionClipboard = editor.getOption(EditorOption.emptySelectionClipboard);

		if (!emptySelectionClipboard && editor.getSelection().isEmpty()) {
			return;
		}

		super.run(accessor, editor);
	}
}

class ExecCommandCopyAction extends ExecCommandAction {

	constructor() {
		let kbOpts: ICommandKeybindingsOptions | undefined = {
			kbExpr: EditorContextKeys.textInputFocus,
			primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
			win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_C, secondary: [KeyMod.CtrlCmd | KeyCode.Insert] },
			weight: KeybindingWeight.EditorContrib
		};
		// Do not bind copy keybindings in the browser,
		// since browsers do that for us and it avoids security prompts
		if (!platform.isNative) {
			kbOpts = undefined;
		}

		super('copy', {
			id: 'editor.action.clipboardCopyAction',
			label: nls.localize('actions.clipboard.copyLabel', "Copy"),
			alias: 'Copy',
			precondition: undefined,
			kbOpts: kbOpts,
			contextMenuOpts: {
				group: CLIPBOARD_CONTEXT_MENU_GROUP,
				order: 2
			},
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '2_ccp',
				title: nls.localize({ key: 'miCopy', comment: ['&& denotes a mnemonic'] }, "&&Copy"),
				order: 2
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (!editor.hasModel()) {
			return;
		}

		const emptySelectionClipboard = editor.getOption(EditorOption.emptySelectionClipboard);

		if (!emptySelectionClipboard && editor.getSelection().isEmpty()) {
			return;
		}

		super.run(accessor, editor);
	}
}

class ExecCommandPasteAction extends ExecCommandAction {

	constructor() {
		let kbOpts: ICommandKeybindingsOptions | undefined = {
			kbExpr: EditorContextKeys.textInputFocus,
			primary: KeyMod.CtrlCmd | KeyCode.KEY_V,
			win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.Shift | KeyCode.Insert] },
			linux: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.Shift | KeyCode.Insert] },
			weight: KeybindingWeight.EditorContrib
		};
		// Do not bind paste keybindings in the browser,
		// since browsers do that for us and it avoids security prompts
		if (!platform.isNative) {
			kbOpts = undefined;
		}

		super('paste', {
			id: 'editor.action.clipboardPasteAction',
			label: nls.localize('actions.clipboard.pasteLabel', "Paste"),
			alias: 'Paste',
			precondition: EditorContextKeys.writable,
			kbOpts: kbOpts,
			contextMenuOpts: {
				group: CLIPBOARD_CONTEXT_MENU_GROUP,
				order: 3
			},
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '2_ccp',
				title: nls.localize({ key: 'miPaste', comment: ['&& denotes a mnemonic'] }, "&&Paste"),
				order: 3
			}
		});
	}
}

class ExecCommandCopyWithSyntaxHighlightingAction extends ExecCommandAction {

	constructor() {
		super('copy', {
			id: 'editor.action.clipboardCopyWithSyntaxHighlightingAction',
			label: nls.localize('actions.clipboard.copyWithSyntaxHighlightingLabel', "Copy With Syntax Highlighting"),
			alias: 'Copy With Syntax Highlighting',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (!editor.hasModel()) {
			return;
		}

		const emptySelectionClipboard = editor.getOption(EditorOption.emptySelectionClipboard);

		if (!emptySelectionClipboard && editor.getSelection().isEmpty()) {
			return;
		}

		CopyOptions.forceCopyWithSyntaxHighlighting = true;
		super.run(accessor, editor);
		CopyOptions.forceCopyWithSyntaxHighlighting = false;
	}
}

if (supportsCut) {
	registerEditorAction(ExecCommandCutAction);
}
if (supportsCopy) {
	registerEditorAction(ExecCommandCopyAction);
}
if (supportsPaste) {
	registerEditorAction(ExecCommandPasteAction);
}
if (supportsCopyWithSyntaxHighlighting) {
	registerEditorAction(ExecCommandCopyWithSyntaxHighlightingAction);
}
