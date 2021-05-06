/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { KeyCode, KeyMod, KeyChord, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Range } from 'vs/editor/common/core/range';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { registerEditorContribution, ServicesAccessor, registerEditorCommand, EditorCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { SmartSnippetInserter } from 'vs/workbench/contrib/preferences/common/smartSnippetInserter';
import { DefineKeybindingOverlayWidget } from 'vs/workbench/contrib/preferences/browser/keybindingWidgets';
import { FloatingClickWidget } from 'vs/workbench/browser/codeeditor';
import { parseTree, Node } from 'vs/base/common/json';
import { ScanCodeBinding } from 'vs/base/common/scanCode';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { WindowsNativeResolvedKeybinding } from 'vs/workbench/services/keybinding/common/windowsKeyboardMapper';
import { themeColorFromId, ThemeColor } from 'vs/platform/theme/common/themeService';
import { overviewRulerInfo, overviewRulerError } from 'vs/editor/common/view/editorColorRegistry';
import { IModelDeltaDecoration, ITextModel, TrackedRangeStickiness, OverviewRulerLane } from 'vs/editor/common/model';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeybindingParser } from 'vs/base/common/keybindingParser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { equals } from 'vs/base/common/arrays';
import { assertIsDefined } from 'vs/base/common/types';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { isEqual } from 'vs/base/common/resources';

const NLS_LAUNCH_MESSAGE = nls.localize('defineKeybinding.start', "Define Keybinding");
const NLS_KB_LAYOUT_ERROR_MESSAGE = nls.localize('defineKeybinding.kbLayoutErrorMessage', "You won't be able to produce this key combination under your current keyboard layout.");

export class DefineKeybindingController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.defineKeybinding';

	static get(editor: ICodeEditor): DefineKeybindingController {
		return editor.getContribution<DefineKeybindingController>(DefineKeybindingController.ID);
	}

	private _keybindingWidgetRenderer?: KeybindingWidgetRenderer;
	private _keybindingDecorationRenderer?: KeybindingEditorDecorationsRenderer;

	constructor(
		private _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService
	) {
		super();

		this._register(this._editor.onDidChangeModel(e => this._update()));
		this._update();
	}

	get keybindingWidgetRenderer(): KeybindingWidgetRenderer | undefined {
		return this._keybindingWidgetRenderer;
	}

	override dispose(): void {
		this._disposeKeybindingWidgetRenderer();
		this._disposeKeybindingDecorationRenderer();
		super.dispose();
	}

	private _update(): void {
		if (!isInterestingEditorModel(this._editor, this._environmentService)) {
			this._disposeKeybindingWidgetRenderer();
			this._disposeKeybindingDecorationRenderer();
			return;
		}

		// Decorations are shown for the default keybindings.json **and** for the user keybindings.json
		this._createKeybindingDecorationRenderer();

		// The button to define keybindings is shown only for the user keybindings.json
		if (!this._editor.getOption(EditorOption.readOnly)) {
			this._createKeybindingWidgetRenderer();
		} else {
			this._disposeKeybindingWidgetRenderer();
		}
	}

	private _createKeybindingWidgetRenderer(): void {
		if (!this._keybindingWidgetRenderer) {
			this._keybindingWidgetRenderer = this._instantiationService.createInstance(KeybindingWidgetRenderer, this._editor);
		}
	}

	private _disposeKeybindingWidgetRenderer(): void {
		if (this._keybindingWidgetRenderer) {
			this._keybindingWidgetRenderer.dispose();
			this._keybindingWidgetRenderer = undefined;
		}
	}

	private _createKeybindingDecorationRenderer(): void {
		if (!this._keybindingDecorationRenderer) {
			this._keybindingDecorationRenderer = this._instantiationService.createInstance(KeybindingEditorDecorationsRenderer, this._editor);
		}
	}

	private _disposeKeybindingDecorationRenderer(): void {
		if (this._keybindingDecorationRenderer) {
			this._keybindingDecorationRenderer.dispose();
			this._keybindingDecorationRenderer = undefined;
		}
	}
}

export class KeybindingWidgetRenderer extends Disposable {

	private _launchWidget: FloatingClickWidget;
	private _defineWidget: DefineKeybindingOverlayWidget;

	constructor(
		private _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
		this._launchWidget = this._register(this._instantiationService.createInstance(FloatingClickWidget, this._editor, NLS_LAUNCH_MESSAGE, DefineKeybindingCommand.ID));
		this._register(this._launchWidget.onClick(() => this.showDefineKeybindingWidget()));
		this._defineWidget = this._register(this._instantiationService.createInstance(DefineKeybindingOverlayWidget, this._editor));

		this._launchWidget.render();
	}

	showDefineKeybindingWidget(): void {
		this._defineWidget.start().then(keybinding => this._onAccepted(keybinding));
	}

	private _onAccepted(keybinding: string | null): void {
		this._editor.focus();
		if (keybinding && this._editor.hasModel()) {
			const regexp = new RegExp(/\\/g);
			const backslash = regexp.test(keybinding);
			if (backslash) {
				keybinding = keybinding.slice(0, -1) + '\\\\';
			}
			let snippetText = [
				'{',
				'\t"key": ' + JSON.stringify(keybinding) + ',',
				'\t"command": "${1:commandId}",',
				'\t"when": "${2:editorTextFocus}"',
				'}$0'
			].join('\n');

			const smartInsertInfo = SmartSnippetInserter.insertSnippet(this._editor.getModel(), this._editor.getPosition());
			snippetText = smartInsertInfo.prepend + snippetText + smartInsertInfo.append;
			this._editor.setPosition(smartInsertInfo.position);

			SnippetController2.get(this._editor).insert(snippetText, { overwriteBefore: 0, overwriteAfter: 0 });
		}
	}
}

export class KeybindingEditorDecorationsRenderer extends Disposable {

	private _updateDecorations: RunOnceScheduler;
	private _dec: string[] = [];

	constructor(
		private _editor: ICodeEditor,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();

		this._updateDecorations = this._register(new RunOnceScheduler(() => this._updateDecorationsNow(), 500));

		const model = assertIsDefined(this._editor.getModel());
		this._register(model.onDidChangeContent(() => this._updateDecorations.schedule()));
		this._register(this._keybindingService.onDidUpdateKeybindings((e) => this._updateDecorations.schedule()));
		this._register({
			dispose: () => {
				this._dec = this._editor.deltaDecorations(this._dec, []);
				this._updateDecorations.cancel();
			}
		});
		this._updateDecorations.schedule();
	}

	private _updateDecorationsNow(): void {
		const model = assertIsDefined(this._editor.getModel());

		const newDecorations: IModelDeltaDecoration[] = [];

		const root = parseTree(model.getValue());
		if (root && Array.isArray(root.children)) {
			for (let i = 0, len = root.children.length; i < len; i++) {
				const entry = root.children[i];
				const dec = this._getDecorationForEntry(model, entry);
				if (dec !== null) {
					newDecorations.push(dec);
				}
			}
		}

		this._dec = this._editor.deltaDecorations(this._dec, newDecorations);
	}

	private _getDecorationForEntry(model: ITextModel, entry: Node): IModelDeltaDecoration | null {
		if (!Array.isArray(entry.children)) {
			return null;
		}
		for (let i = 0, len = entry.children.length; i < len; i++) {
			const prop = entry.children[i];
			if (prop.type !== 'property') {
				continue;
			}
			if (!Array.isArray(prop.children) || prop.children.length !== 2) {
				continue;
			}
			const key = prop.children[0];
			if (key.value !== 'key') {
				continue;
			}
			const value = prop.children[1];
			if (value.type !== 'string') {
				continue;
			}

			const resolvedKeybindings = this._keybindingService.resolveUserBinding(value.value);
			if (resolvedKeybindings.length === 0) {
				return this._createDecoration(true, null, null, model, value);
			}
			const resolvedKeybinding = resolvedKeybindings[0];
			let usLabel: string | null = null;
			if (resolvedKeybinding instanceof WindowsNativeResolvedKeybinding) {
				usLabel = resolvedKeybinding.getUSLabel();
			}
			if (!resolvedKeybinding.isWYSIWYG()) {
				const uiLabel = resolvedKeybinding.getLabel();
				if (typeof uiLabel === 'string' && value.value.toLowerCase() === uiLabel.toLowerCase()) {
					// coincidentally, this is actually WYSIWYG
					return null;
				}
				return this._createDecoration(false, resolvedKeybinding.getLabel(), usLabel, model, value);
			}
			if (/abnt_|oem_/.test(value.value)) {
				return this._createDecoration(false, resolvedKeybinding.getLabel(), usLabel, model, value);
			}
			const expectedUserSettingsLabel = resolvedKeybinding.getUserSettingsLabel();
			if (typeof expectedUserSettingsLabel === 'string' && !KeybindingEditorDecorationsRenderer._userSettingsFuzzyEquals(value.value, expectedUserSettingsLabel)) {
				return this._createDecoration(false, resolvedKeybinding.getLabel(), usLabel, model, value);
			}
			return null;
		}
		return null;
	}

	static _userSettingsFuzzyEquals(a: string, b: string): boolean {
		a = a.trim().toLowerCase();
		b = b.trim().toLowerCase();

		if (a === b) {
			return true;
		}

		const aParts = KeybindingParser.parseUserBinding(a);
		const bParts = KeybindingParser.parseUserBinding(b);
		return equals(aParts, bParts, (a, b) => this._userBindingEquals(a, b));
	}

	private static _userBindingEquals(a: SimpleKeybinding | ScanCodeBinding, b: SimpleKeybinding | ScanCodeBinding): boolean {
		if (a === null && b === null) {
			return true;
		}
		if (!a || !b) {
			return false;
		}

		if (a instanceof SimpleKeybinding && b instanceof SimpleKeybinding) {
			return a.equals(b);
		}

		if (a instanceof ScanCodeBinding && b instanceof ScanCodeBinding) {
			return a.equals(b);
		}

		return false;
	}

	private _createDecoration(isError: boolean, uiLabel: string | null, usLabel: string | null, model: ITextModel, keyNode: Node): IModelDeltaDecoration {
		let msg: MarkdownString;
		let className: string;
		let overviewRulerColor: ThemeColor;

		if (isError) {
			// this is the error case
			msg = new MarkdownString().appendText(NLS_KB_LAYOUT_ERROR_MESSAGE);
			className = 'keybindingError';
			overviewRulerColor = themeColorFromId(overviewRulerError);
		} else {
			// this is the info case
			if (usLabel && uiLabel !== usLabel) {
				msg = new MarkdownString(
					nls.localize({
						key: 'defineKeybinding.kbLayoutLocalAndUSMessage',
						comment: [
							'Please translate maintaining the stars (*) around the placeholders such that they will be rendered in bold.',
							'The placeholders will contain a keyboard combination e.g. Ctrl+Shift+/'
						]
					}, "**{0}** for your current keyboard layout (**{1}** for US standard).", uiLabel, usLabel)
				);
			} else {
				msg = new MarkdownString(
					nls.localize({
						key: 'defineKeybinding.kbLayoutLocalMessage',
						comment: [
							'Please translate maintaining the stars (*) around the placeholder such that it will be rendered in bold.',
							'The placeholder will contain a keyboard combination e.g. Ctrl+Shift+/'
						]
					}, "**{0}** for your current keyboard layout.", uiLabel)
				);
			}
			className = 'keybindingInfo';
			overviewRulerColor = themeColorFromId(overviewRulerInfo);
		}

		const startPosition = model.getPositionAt(keyNode.offset);
		const endPosition = model.getPositionAt(keyNode.offset + keyNode.length);
		const range = new Range(
			startPosition.lineNumber, startPosition.column,
			endPosition.lineNumber, endPosition.column
		);

		// icon + highlight + message decoration
		return {
			range: range,
			options: {
				stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				className: className,
				hoverMessage: msg,
				overviewRuler: {
					color: overviewRulerColor,
					position: OverviewRulerLane.Right
				}
			}
		};
	}

}

class DefineKeybindingCommand extends EditorCommand {

	static readonly ID = 'editor.action.defineKeybinding';

	constructor() {
		super({
			id: DefineKeybindingCommand.ID,
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.languageId.isEqualTo('jsonc')),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_K),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (!isInterestingEditorModel(editor, accessor.get(IEnvironmentService)) || editor.getOption(EditorOption.readOnly)) {
			return;
		}
		const controller = DefineKeybindingController.get(editor);
		if (controller && controller.keybindingWidgetRenderer) {
			controller.keybindingWidgetRenderer.showDefineKeybindingWidget();
		}
	}
}

function isInterestingEditorModel(editor: ICodeEditor, environmentService: IEnvironmentService): boolean {
	const model = editor.getModel();
	if (!model) {
		return false;
	}
	return isEqual(model.uri, environmentService.keybindingsResource);
}

registerEditorContribution(DefineKeybindingController.ID, DefineKeybindingController);
registerEditorCommand(new DefineKeybindingCommand());
