/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { DefaultSettingsEditorContribution } from 'vs/workbench/contrib/preferences/browser/preferencesEditor';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { Codicon } from 'vs/base/common/codicons';

const transientWordWrapState = 'transientWordWrapState';
const isWordWrapMinifiedKey = 'isWordWrapMinified';
const isDominatedByLongLinesKey = 'isDominatedByLongLines';

/**
 * State written/read by the toggle word wrap action and associated with a particular model.
 */
interface IWordWrapTransientState {
	readonly wordWrapOverride: 'on' | 'off';
}

/**
 * Store (in memory) the word wrap state for a particular model.
 */
export function writeTransientState(model: ITextModel, state: IWordWrapTransientState | null, codeEditorService: ICodeEditorService): void {
	codeEditorService.setTransientModelProperty(model, transientWordWrapState, state);
}

/**
 * Read (in memory) the word wrap state for a particular model.
 */
function readTransientState(model: ITextModel, codeEditorService: ICodeEditorService): IWordWrapTransientState | null {
	return codeEditorService.getTransientModelProperty(model, transientWordWrapState);
}

const TOGGLE_WORD_WRAP_ID = 'editor.action.toggleWordWrap';
class ToggleWordWrapAction extends EditorAction {

	constructor() {
		super({
			id: TOGGLE_WORD_WRAP_ID,
			label: nls.localize('toggle.wordwrap', "View: Toggle Word Wrap"),
			alias: 'View: Toggle Word Wrap',
			precondition: undefined,
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.Alt | KeyCode.KEY_Z,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (editor.getContribution(DefaultSettingsEditorContribution.ID)) {
			// in the settings editor...
			return;
		}
		if (!editor.hasModel()) {
			return;
		}

		const codeEditorService = accessor.get(ICodeEditorService);
		const model = editor.getModel();

		if (!canToggleWordWrap(model.uri)) {
			return;
		}

		// Read the current state
		const transientState = readTransientState(model, codeEditorService);

		// Compute the new state
		let newState: IWordWrapTransientState | null;
		if (transientState) {
			newState = null;
		} else {
			const actualWrappingInfo = editor.getOption(EditorOption.wrappingInfo);
			const wordWrapOverride = (actualWrappingInfo.wrappingColumn === -1 ? 'on' : 'off');
			newState = { wordWrapOverride };
		}

		// Write the new state
		// (this will cause an event and the controller will apply the state)
		writeTransientState(model, newState, codeEditorService);
	}
}

class ToggleWordWrapController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.toggleWordWrapController';

	constructor(
		private readonly _editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService
	) {
		super();

		const options = this._editor.getOptions();
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const isWordWrapMinified = this._contextKeyService.createKey(isWordWrapMinifiedKey, wrappingInfo.isWordWrapMinified);
		const isDominatedByLongLines = this._contextKeyService.createKey(isDominatedByLongLinesKey, wrappingInfo.isDominatedByLongLines);
		let currentlyApplyingEditorConfig = false;

		this._register(_editor.onDidChangeConfiguration((e) => {
			if (!e.hasChanged(EditorOption.wrappingInfo)) {
				return;
			}
			const options = this._editor.getOptions();
			const wrappingInfo = options.get(EditorOption.wrappingInfo);
			isWordWrapMinified.set(wrappingInfo.isWordWrapMinified);
			isDominatedByLongLines.set(wrappingInfo.isDominatedByLongLines);
			if (!currentlyApplyingEditorConfig) {
				// I am not the cause of the word wrap getting changed
				ensureWordWrapSettings();
			}
		}));

		this._register(_editor.onDidChangeModel((e) => {
			ensureWordWrapSettings();
		}));

		this._register(_codeEditorService.onDidChangeTransientModelProperty(() => {
			ensureWordWrapSettings();
		}));

		const ensureWordWrapSettings = () => {
			if (this._editor.getContribution(DefaultSettingsEditorContribution.ID)) {
				// in the settings editor...
				return;
			}
			if (this._editor.isSimpleWidget) {
				// in a simple widget...
				return;
			}
			// Ensure correct word wrap settings
			const newModel = this._editor.getModel();
			if (!newModel) {
				return;
			}

			if (!canToggleWordWrap(newModel.uri)) {
				return;
			}

			const transientState = readTransientState(newModel, this._codeEditorService);

			// Apply the state
			try {
				currentlyApplyingEditorConfig = true;
				this._applyWordWrapState(transientState);
			} finally {
				currentlyApplyingEditorConfig = false;
			}
		};
	}

	private _applyWordWrapState(state: IWordWrapTransientState | null): void {
		const wordWrapOverride2 = state ? state.wordWrapOverride : 'inherit';
		this._editor.updateOptions({
			wordWrapOverride2: wordWrapOverride2
		});
	}
}

function canToggleWordWrap(uri: URI): boolean {
	if (!uri) {
		return false;
	}
	return (uri.scheme !== 'output');
}


registerEditorContribution(ToggleWordWrapController.ID, ToggleWordWrapController);

registerEditorAction(ToggleWordWrapAction);

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: TOGGLE_WORD_WRAP_ID,
		title: nls.localize('unwrapMinified', "Disable wrapping for this file"),
		icon: Codicon.wordWrap
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		ContextKeyExpr.has(isDominatedByLongLinesKey),
		ContextKeyExpr.has(isWordWrapMinifiedKey)
	)
});
MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: TOGGLE_WORD_WRAP_ID,
		title: nls.localize('wrapMinified', "Enable wrapping for this file"),
		icon: Codicon.wordWrap
	},
	group: 'navigation',
	order: 1,
	when: ContextKeyExpr.and(
		EditorContextKeys.inDiffEditor.negate(),
		ContextKeyExpr.has(isDominatedByLongLinesKey),
		ContextKeyExpr.not(isWordWrapMinifiedKey)
	)
});


// View menu
MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '5_editor',
	command: {
		id: TOGGLE_WORD_WRAP_ID,
		title: nls.localize({ key: 'miToggleWordWrap', comment: ['&& denotes a mnemonic'] }, "Toggle &&Word Wrap")
	},
	order: 1
});
