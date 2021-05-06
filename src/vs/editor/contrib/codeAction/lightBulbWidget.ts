/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { GlobalMouseMoveMonitor, IStandardMouseMoveEventData, standardMouseMoveMerger } from 'vs/base/browser/globalMouseMoveMonitor';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import 'vs/css!./lightBulbWidget';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { IPosition } from 'vs/editor/common/core/position';
import { TextModel } from 'vs/editor/common/model/textModel';
import { CodeActionSet } from 'vs/editor/contrib/codeAction/codeAction';
import * as nls from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { editorLightBulbForeground, editorLightBulbAutoFixForeground, editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { Gesture } from 'vs/base/browser/touch';
import type { CodeActionTrigger } from 'vs/editor/contrib/codeAction/types';
import { Codicon } from 'vs/base/common/codicons';

namespace LightBulbState {

	export const enum Type {
		Hidden,
		Showing,
	}

	export const Hidden = { type: Type.Hidden } as const;

	export class Showing {
		readonly type = Type.Showing;

		constructor(
			public readonly actions: CodeActionSet,
			public readonly trigger: CodeActionTrigger,
			public readonly editorPosition: IPosition,
			public readonly widgetPosition: IContentWidgetPosition,
		) { }
	}

	export type State = typeof Hidden | Showing;
}


export class LightBulbWidget extends Disposable implements IContentWidget {

	private static readonly _posPref = [ContentWidgetPositionPreference.EXACT];

	private readonly _domNode: HTMLDivElement;

	private readonly _onClick = this._register(new Emitter<{ x: number; y: number; actions: CodeActionSet; trigger: CodeActionTrigger }>());
	public readonly onClick = this._onClick.event;

	private _state: LightBulbState.State = LightBulbState.Hidden;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _quickFixActionId: string,
		private readonly _preferredFixActionId: string,
		@IKeybindingService private readonly _keybindingService: IKeybindingService
	) {
		super();
		this._domNode = document.createElement('div');
		this._domNode.className = Codicon.lightBulb.classNames;

		this._editor.addContentWidget(this);

		this._register(this._editor.onDidChangeModelContent(_ => {
			// cancel when the line in question has been removed
			const editorModel = this._editor.getModel();
			if (this.state.type !== LightBulbState.Type.Showing || !editorModel || this.state.editorPosition.lineNumber >= editorModel.getLineCount()) {
				this.hide();
			}
		}));

		Gesture.ignoreTarget(this._domNode);
		this._register(dom.addStandardDisposableGenericMouseDownListner(this._domNode, e => {
			if (this.state.type !== LightBulbState.Type.Showing) {
				return;
			}

			// Make sure that focus / cursor location is not lost when clicking widget icon
			this._editor.focus();
			e.preventDefault();
			// a bit of extra work to make sure the menu
			// doesn't cover the line-text
			const { top, height } = dom.getDomNodePagePosition(this._domNode);
			const lineHeight = this._editor.getOption(EditorOption.lineHeight);

			let pad = Math.floor(lineHeight / 3);
			if (this.state.widgetPosition.position !== null && this.state.widgetPosition.position.lineNumber < this.state.editorPosition.lineNumber) {
				pad += lineHeight;
			}

			this._onClick.fire({
				x: e.posx,
				y: top + height + pad,
				actions: this.state.actions,
				trigger: this.state.trigger,
			});
		}));
		this._register(dom.addDisposableListener(this._domNode, 'mouseenter', (e: MouseEvent) => {
			if ((e.buttons & 1) !== 1) {
				return;
			}
			// mouse enters lightbulb while the primary/left button
			// is being pressed -> hide the lightbulb and block future
			// showings until mouse is released
			this.hide();
			const monitor = new GlobalMouseMoveMonitor<IStandardMouseMoveEventData>();
			monitor.startMonitoring(<HTMLElement>e.target, e.buttons, standardMouseMoveMerger, () => { }, () => {
				monitor.dispose();
			});
		}));
		this._register(this._editor.onDidChangeConfiguration(e => {
			// hide when told to do so
			if (e.hasChanged(EditorOption.lightbulb) && !this._editor.getOption(EditorOption.lightbulb).enabled) {
				this.hide();
			}
		}));

		this._updateLightBulbTitleAndIcon();
		this._register(this._keybindingService.onDidUpdateKeybindings(this._updateLightBulbTitleAndIcon, this));
	}

	override dispose(): void {
		super.dispose();
		this._editor.removeContentWidget(this);
	}

	getId(): string {
		return 'LightBulbWidget';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this._state.type === LightBulbState.Type.Showing ? this._state.widgetPosition : null;
	}

	public update(actions: CodeActionSet, trigger: CodeActionTrigger, atPosition: IPosition) {
		if (actions.validActions.length <= 0) {
			return this.hide();
		}

		const options = this._editor.getOptions();
		if (!options.get(EditorOption.lightbulb).enabled) {
			return this.hide();
		}

		const model = this._editor.getModel();
		if (!model) {
			return this.hide();
		}

		const { lineNumber, column } = model.validatePosition(atPosition);

		const tabSize = model.getOptions().tabSize;
		const fontInfo = options.get(EditorOption.fontInfo);
		const lineContent = model.getLineContent(lineNumber);
		const indent = TextModel.computeIndentLevel(lineContent, tabSize);
		const lineHasSpace = fontInfo.spaceWidth * indent > 22;
		const isFolded = (lineNumber: number) => {
			return lineNumber > 2 && this._editor.getTopForLineNumber(lineNumber) === this._editor.getTopForLineNumber(lineNumber - 1);
		};

		let effectiveLineNumber = lineNumber;
		if (!lineHasSpace) {
			if (lineNumber > 1 && !isFolded(lineNumber - 1)) {
				effectiveLineNumber -= 1;
			} else if (!isFolded(lineNumber + 1)) {
				effectiveLineNumber += 1;
			} else if (column * fontInfo.spaceWidth < 22) {
				// cannot show lightbulb above/below and showing
				// it inline would overlay the cursor...
				return this.hide();
			}
		}

		this.state = new LightBulbState.Showing(actions, trigger, atPosition, {
			position: { lineNumber: effectiveLineNumber, column: 1 },
			preference: LightBulbWidget._posPref
		});
		this._editor.layoutContentWidget(this);
	}

	public hide(): void {
		this.state = LightBulbState.Hidden;
		this._editor.layoutContentWidget(this);
	}

	private get state(): LightBulbState.State { return this._state; }

	private set state(value) {
		this._state = value;
		this._updateLightBulbTitleAndIcon();
	}

	private _updateLightBulbTitleAndIcon(): void {
		if (this.state.type === LightBulbState.Type.Showing && this.state.actions.hasAutoFix) {
			// update icon
			this._domNode.classList.remove(...Codicon.lightBulb.classNamesArray);
			this._domNode.classList.add(...Codicon.lightbulbAutofix.classNamesArray);

			const preferredKb = this._keybindingService.lookupKeybinding(this._preferredFixActionId);
			if (preferredKb) {
				this.title = nls.localize('prefferedQuickFixWithKb', "Show Fixes. Preferred Fix Available ({0})", preferredKb.getLabel());
				return;
			}
		}

		// update icon
		this._domNode.classList.remove(...Codicon.lightbulbAutofix.classNamesArray);
		this._domNode.classList.add(...Codicon.lightBulb.classNamesArray);

		const kb = this._keybindingService.lookupKeybinding(this._quickFixActionId);
		if (kb) {
			this.title = nls.localize('quickFixWithKb', "Show Fixes ({0})", kb.getLabel());
		} else {
			this.title = nls.localize('quickFix', "Show Fixes");
		}
	}

	private set title(value: string) {
		this._domNode.title = value;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	const editorBackgroundColor = theme.getColor(editorBackground)?.transparent(0.7);

	// Lightbulb Icon
	const editorLightBulbForegroundColor = theme.getColor(editorLightBulbForeground);
	if (editorLightBulbForegroundColor) {
		collector.addRule(`
		.monaco-editor .contentWidgets ${Codicon.lightBulb.cssSelector} {
			color: ${editorLightBulbForegroundColor};
			background-color: ${editorBackgroundColor};
		}`);
	}

	// Lightbulb Auto Fix Icon
	const editorLightBulbAutoFixForegroundColor = theme.getColor(editorLightBulbAutoFixForeground);
	if (editorLightBulbAutoFixForegroundColor) {
		collector.addRule(`
		.monaco-editor .contentWidgets ${Codicon.lightbulbAutofix.cssSelector} {
			color: ${editorLightBulbAutoFixForegroundColor};
			background-color: ${editorBackgroundColor};
		}`);
	}

});
