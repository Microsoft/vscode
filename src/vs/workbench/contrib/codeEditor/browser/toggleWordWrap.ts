/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IActiveCodeEditor, ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { DefaultSettingsEditorContribution } from 'vs/workbench/contrib/preferences/browser/preferencesEditor';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { Codicon } from 'vs/base/common/codicons';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

const transientWordWrapState = 'transientWordWrapState';
const isWordWrapMinifiedKey = 'isWordWrapMinified';
const isDominatedByLongLinesKey = 'isDominatedByLongLines';
const CAN_TOGGLE_WORD_WRAP = new RawContextKey<boolean>('canToggleWordWrap', false, true);
const EDITOR_WORD_WRAP = new RawContextKey<boolean>('editorWordWrap', false, nls.localize('editorWordWrap', 'Whether the editor is currently using word wrapping.'));

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
		if (!canToggleWordWrap(editor)) {
			return;
		}

		const codeEditorService = accessor.get(ICodeEditorService);
		const model = editor.getModel();

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
			if (!canToggleWordWrap(this._editor)) {
				return;
			}

			const transientState = readTransientState(this._editor.getModel(), this._codeEditorService);

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

function canToggleWordWrap(editor: ICodeEditor | null): editor is IActiveCodeEditor {
	if (!editor) {
		return false;
	}
	if (editor.getContribution(DefaultSettingsEditorContribution.ID)) {
		// in the settings editor...
		return false;
	}
	if (editor.isSimpleWidget) {
		// in a simple widget...
		return false;
	}
	// Ensure correct word wrap settings
	const model = editor.getModel();
	if (!model) {
		return false;
	}
	if (model.uri.scheme === 'output') {
		// in output editor
		return false;
	}
	return true;
}

class EditorWordWrapContextKeyTracker implements IWorkbenchContribution {

	private readonly _canToggleWordWrap: IContextKey<boolean>;
	private readonly _editorWordWrap: IContextKey<boolean>;
	private _activeEditor: ICodeEditor | null;
	private readonly _activeEditorListener: DisposableStore;

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IContextKeyService private readonly _contextService: IContextKeyService,
	) {
		window.addEventListener('focus', () => this._update(), true);
		window.addEventListener('blur', () => this._update(), true);
		this._editorService.onDidActiveEditorChange(() => this._update());
		this._canToggleWordWrap = CAN_TOGGLE_WORD_WRAP.bindTo(this._contextService);
		this._editorWordWrap = EDITOR_WORD_WRAP.bindTo(this._contextService);
		this._activeEditor = null;
		this._activeEditorListener = new DisposableStore();
		this._update();
	}

	private _update(): void {
		const activeEditor = this._codeEditorService.getFocusedCodeEditor() || this._codeEditorService.getActiveCodeEditor();
		if (this._activeEditor === activeEditor) {
			// no change
			return;
		}
		this._activeEditorListener.clear();
		this._activeEditor = activeEditor;

		if (activeEditor) {
			this._activeEditorListener.add(activeEditor.onDidChangeModel(() => this._updateFromCodeEditor()));
			this._activeEditorListener.add(activeEditor.onDidChangeConfiguration((e) => {
				if (e.hasChanged(EditorOption.wrappingInfo)) {
					this._updateFromCodeEditor();
				}
			}));
			this._updateFromCodeEditor();
		}
	}

	private _updateFromCodeEditor(): void {
		if (!canToggleWordWrap(this._activeEditor)) {
			return this._setValues(false, false);
		} else {
			const wrappingInfo = this._activeEditor.getOption(EditorOption.wrappingInfo);
			this._setValues(true, wrappingInfo.wrappingColumn !== -1);
		}
	}

	private _setValues(canToggleWordWrap: boolean, isWordWrap: boolean): void {
		this._canToggleWordWrap.set(canToggleWordWrap);
		this._editorWordWrap.set(isWordWrap);
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(EditorWordWrapContextKeyTracker, LifecyclePhase.Ready);

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
		title: nls.localize({ key: 'miToggleWordWrap', comment: ['&& denotes a mnemonic'] }, "&&Word Wrap"),
		toggled: EDITOR_WORD_WRAP,
		precondition: CAN_TOGGLE_WORD_WRAP
	},
	order: 1
});
