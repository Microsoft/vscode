/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./accessibilityHelp';
import * as dom from 'vs/base/browser/dom';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { renderFormattedText } from 'vs/base/browser/formattedTextRenderer';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { Widget } from 'vs/base/browser/ui/widget';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { EditorAction, EditorCommand, registerEditorAction, registerEditorCommand, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Selection } from 'vs/editor/common/core/selection';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ToggleTabFocusModeAction } from 'vs/editor/contrib/toggleTabFocusMode/toggleTabFocusMode';
import { IStandaloneEditorConstructionOptions } from 'vs/editor/standalone/browser/standaloneCodeEditor';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { contrastBorder, editorWidgetBackground, widgetShadow, editorWidgetForeground } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { AccessibilityHelpNLS } from 'vs/editor/common/standaloneStrings';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

const CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE = new RawContextKey<boolean>('accessibilityHelpWidgetVisible', false);

class AccessibilityHelpController extends Disposable
	implements IEditorContribution {
	public static readonly ID = 'editor.contrib.accessibilityHelpController';

	public static get(editor: ICodeEditor): AccessibilityHelpController {
		return editor.getContribution<AccessibilityHelpController>(
			AccessibilityHelpController.ID
		);
	}

	private readonly _editor: ICodeEditor;
	private readonly _widget: AccessibilityHelpWidget;

	constructor(
		editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();

		this._editor = editor;
		this._widget = this._register(
			instantiationService.createInstance(AccessibilityHelpWidget, this._editor)
		);
	}

	public show(): void {
		this._widget.show();
	}

	public hide(): void {
		this._widget.hide();
	}
}


function getSelectionLabel(selections: Selection[] | null, charactersSelected: number): string {
	if (!selections || selections.length === 0) {
		return AccessibilityHelpNLS.noSelection;
	}

	if (selections.length === 1) {
		if (charactersSelected) {
			return strings.format(AccessibilityHelpNLS.singleSelectionRange, selections[0].positionLineNumber, selections[0].positionColumn, charactersSelected);
		}

		return strings.format(AccessibilityHelpNLS.singleSelection, selections[0].positionLineNumber, selections[0].positionColumn);
	}

	if (charactersSelected) {
		return strings.format(AccessibilityHelpNLS.multiSelectionRange, selections.length, charactersSelected);
	}

	if (selections.length > 0) {
		return strings.format(AccessibilityHelpNLS.multiSelection, selections.length);
	}

	return '';
}

class AccessibilityHelpWidget extends Widget implements IOverlayWidget {
	private static readonly ID = 'editor.contrib.accessibilityHelpWidget';
	private static readonly WIDTH = 500;
	private static readonly HEIGHT = 300;

	private readonly _editor: ICodeEditor;
	private readonly _domNode: FastDomNode<HTMLElement>;
	private readonly _contentDomNode: FastDomNode<HTMLElement>;
	private _isVisible: boolean;
	private readonly _isVisibleKey: IContextKey<boolean>;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IOpenerService private readonly _openerService: IOpenerService
	) {
		super();

		this._editor = editor;
		this._isVisibleKey = CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE.bindTo(
			this._contextKeyService
		);

		this._domNode = createFastDomNode(document.createElement('div'));
		this._domNode.setClassName('accessibilityHelpWidget');
		this._domNode.setDisplay('none');
		this._domNode.setAttribute('role', 'dialog');
		this._domNode.setAttribute('aria-hidden', 'true');

		this._contentDomNode = createFastDomNode(document.createElement('div'));
		this._contentDomNode.setAttribute('role', 'document');
		this._domNode.appendChild(this._contentDomNode);

		this._isVisible = false;

		this._register(this._editor.onDidLayoutChange(() => {
			if (this._isVisible) {
				this._layout();
			}
		}));

		// Intentionally not configurable!
		this._register(dom.addStandardDisposableListener(this._contentDomNode.domNode, 'keydown', (e) => {
			if (!this._isVisible) {
				return;
			}

			if (e.equals(KeyMod.CtrlCmd | KeyCode.KEY_E)) {
				alert(AccessibilityHelpNLS.emergencyConfOn);

				this._editor.updateOptions({
					accessibilitySupport: 'on'
				});

				dom.clearNode(this._contentDomNode.domNode);
				this._buildContent();
				this._contentDomNode.domNode.focus();

				e.preventDefault();
				e.stopPropagation();
			}

			if (e.equals(KeyMod.CtrlCmd | KeyCode.KEY_H)) {
				alert(AccessibilityHelpNLS.openingDocs);

				let url = (<IStandaloneEditorConstructionOptions>this._editor.getRawOptions()).accessibilityHelpUrl;
				if (typeof url === 'undefined') {
					url = 'https://go.microsoft.com/fwlink/?linkid=852450';
				}
				this._openerService.open(URI.parse(url));

				e.preventDefault();
				e.stopPropagation();
			}
		}));

		this.onblur(this._contentDomNode.domNode, () => {
			this.hide();
		});

		this._editor.addOverlayWidget(this);
	}

	public override dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}

	public getId(): string {
		return AccessibilityHelpWidget.ID;
	}

	public getDomNode(): HTMLElement {
		return this._domNode.domNode;
	}

	public getPosition(): IOverlayWidgetPosition {
		return {
			preference: null
		};
	}

	public show(): void {
		if (this._isVisible) {
			return;
		}
		this._isVisible = true;
		this._isVisibleKey.set(true);
		this._layout();
		this._domNode.setDisplay('block');
		this._domNode.setAttribute('aria-hidden', 'false');
		this._contentDomNode.domNode.tabIndex = 0;
		this._buildContent();
		this._contentDomNode.domNode.focus();
	}

	private _descriptionForCommand(commandId: string, msg: string, noKbMsg: string): string {
		let kb = this._keybindingService.lookupKeybinding(commandId);
		if (kb) {
			return strings.format(msg, kb.getAriaLabel());
		}
		return strings.format(noKbMsg, commandId);
	}

	private _buildContent() {
		const options = this._editor.getOptions();

		const selections = this._editor.getSelections();
		let charactersSelected = 0;

		if (selections) {
			const model = this._editor.getModel();
			if (model) {
				selections.forEach((selection) => {
					charactersSelected += model.getValueLengthInRange(selection);
				});
			}
		}

		let text = getSelectionLabel(selections, charactersSelected);

		if (options.get(EditorOption.inDiffEditor)) {
			if (options.get(EditorOption.readOnly)) {
				text += AccessibilityHelpNLS.readonlyDiffEditor;
			} else {
				text += AccessibilityHelpNLS.editableDiffEditor;
			}
		} else {
			if (options.get(EditorOption.readOnly)) {
				text += AccessibilityHelpNLS.readonlyEditor;
			} else {
				text += AccessibilityHelpNLS.editableEditor;
			}
		}

		const turnOnMessage = (
			platform.isMacintosh
				? AccessibilityHelpNLS.changeConfigToOnMac
				: AccessibilityHelpNLS.changeConfigToOnWinLinux
		);
		switch (options.get(EditorOption.accessibilitySupport)) {
			case AccessibilitySupport.Unknown:
				text += '\n\n - ' + turnOnMessage;
				break;
			case AccessibilitySupport.Enabled:
				text += '\n\n - ' + AccessibilityHelpNLS.auto_on;
				break;
			case AccessibilitySupport.Disabled:
				text += '\n\n - ' + AccessibilityHelpNLS.auto_off;
				text += ' ' + turnOnMessage;
				break;
		}


		if (options.get(EditorOption.tabFocusMode)) {
			text += '\n\n - ' + this._descriptionForCommand(ToggleTabFocusModeAction.ID, AccessibilityHelpNLS.tabFocusModeOnMsg, AccessibilityHelpNLS.tabFocusModeOnMsgNoKb);
		} else {
			text += '\n\n - ' + this._descriptionForCommand(ToggleTabFocusModeAction.ID, AccessibilityHelpNLS.tabFocusModeOffMsg, AccessibilityHelpNLS.tabFocusModeOffMsgNoKb);
		}

		const openDocMessage = (
			platform.isMacintosh
				? AccessibilityHelpNLS.openDocMac
				: AccessibilityHelpNLS.openDocWinLinux
		);

		text += '\n\n - ' + openDocMessage;

		text += '\n\n' + AccessibilityHelpNLS.outroMsg;

		this._contentDomNode.domNode.appendChild(renderFormattedText(text));
		// Per https://www.w3.org/TR/wai-aria/roles#document, Authors SHOULD provide a title or label for documents
		this._contentDomNode.domNode.setAttribute('aria-label', text);
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._isVisibleKey.reset();
		this._domNode.setDisplay('none');
		this._domNode.setAttribute('aria-hidden', 'true');
		this._contentDomNode.domNode.tabIndex = -1;
		dom.clearNode(this._contentDomNode.domNode);

		this._editor.focus();
	}

	private _layout(): void {
		let editorLayout = this._editor.getLayoutInfo();

		let w = Math.max(5, Math.min(AccessibilityHelpWidget.WIDTH, editorLayout.width - 40));
		let h = Math.max(5, Math.min(AccessibilityHelpWidget.HEIGHT, editorLayout.height - 40));

		this._domNode.setWidth(w);
		this._domNode.setHeight(h);

		let top = Math.round((editorLayout.height - h) / 2);
		this._domNode.setTop(top);

		let left = Math.round((editorLayout.width - w) / 2);
		this._domNode.setLeft(left);
	}
}

class ShowAccessibilityHelpAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.showAccessibilityHelp',
			label: AccessibilityHelpNLS.showAccessibilityHelpAction,
			alias: 'Show Accessibility Help',
			precondition: undefined,
			kbOpts: {
				primary: KeyMod.Alt | KeyCode.F1,
				weight: KeybindingWeight.EditorContrib,
				linux: {
					primary: KeyMod.Alt | KeyMod.Shift | KeyCode.F1,
					secondary: [KeyMod.Alt | KeyCode.F1]
				}
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let controller = AccessibilityHelpController.get(editor);
		if (controller) {
			controller.show();
		}
	}
}

registerEditorContribution(AccessibilityHelpController.ID, AccessibilityHelpController);
registerEditorAction(ShowAccessibilityHelpAction);

const AccessibilityHelpCommand = EditorCommand.bindToContribution<AccessibilityHelpController>(AccessibilityHelpController.get);

registerEditorCommand(
	new AccessibilityHelpCommand({
		id: 'closeAccessibilityHelp',
		precondition: CONTEXT_ACCESSIBILITY_WIDGET_VISIBLE,
		handler: x => x.hide(),
		kbOpts: {
			weight: KeybindingWeight.EditorContrib + 100,
			kbExpr: EditorContextKeys.focus,
			primary: KeyCode.Escape,
			secondary: [KeyMod.Shift | KeyCode.Escape]
		}
	})
);

registerThemingParticipant((theme, collector) => {
	const widgetBackground = theme.getColor(editorWidgetBackground);
	if (widgetBackground) {
		collector.addRule(`.monaco-editor .accessibilityHelpWidget { background-color: ${widgetBackground}; }`);
	}
	const widgetForeground = theme.getColor(editorWidgetForeground);
	if (widgetForeground) {
		collector.addRule(`.monaco-editor .accessibilityHelpWidget { color: ${widgetForeground}; }`);
	}


	const widgetShadowColor = theme.getColor(widgetShadow);
	if (widgetShadowColor) {
		collector.addRule(`.monaco-editor .accessibilityHelpWidget { box-shadow: 0 2px 8px ${widgetShadowColor}; }`);
	}

	const hcBorder = theme.getColor(contrastBorder);
	if (hcBorder) {
		collector.addRule(`.monaco-editor .accessibilityHelpWidget { border: 2px solid ${hcBorder}; }`);
	}
});
