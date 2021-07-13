/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { ContentWidgetPositionPreference, IActiveCodeEditor, ICodeEditor, IContentWidget, IContentWidgetPosition, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { TokenizationRegistry } from 'vs/editor/common/modes';
import { ColorPickerWidget } from 'vs/editor/contrib/colorPicker/colorPickerWidget';
import { HoverOperation, HoverStartMode, IHoverComputer } from 'vs/editor/contrib/hover/hoverOperation';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { coalesce, flatten } from 'vs/base/common/arrays';
import { IModelDecoration } from 'vs/editor/common/model';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Constants } from 'vs/base/common/uint';
import { textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Widget } from 'vs/base/browser/ui/widget';
import { KeyCode } from 'vs/base/common/keyCodes';
import { HoverWidget, HoverAction } from 'vs/base/browser/ui/hover/hoverWidget';
import { MarkerHoverParticipant } from 'vs/editor/contrib/hover/markerHoverParticipant';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkdownHoverParticipant } from 'vs/editor/contrib/hover/markdownHoverParticipant';
import { InlineCompletionsHoverParticipant } from 'vs/editor/contrib/inlineCompletions/inlineCompletionsHoverParticipant';
import { ColorHoverParticipant } from 'vs/editor/contrib/hover/colorHoverParticipant';
import { IEmptyContentData } from 'vs/editor/browser/controller/mouseTarget';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IEditorHoverStatusBar, IHoverPart, HoverAnchor, IEditorHoverParticipant, HoverAnchorType, IEditorHover, HoverRangeAnchor, IEditorHoverAction } from 'vs/editor/contrib/hover/hoverTypes';

const $ = dom.$;

class EditorHoverStatusBar extends Disposable implements IEditorHoverStatusBar {

	public readonly hoverElement: HTMLElement;
	private readonly actionsElement: HTMLElement;
	private _hasContent: boolean = false;

	public get hasContent() {
		return this._hasContent;
	}

	constructor(
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();
		this.hoverElement = $('div.hover-row.status-bar');
		this.actionsElement = dom.append(this.hoverElement, $('div.actions'));
	}

	public addAction(actionOptions: { label: string, iconClass?: string, run: (target: HTMLElement) => void, commandId: string }): IEditorHoverAction {
		const keybinding = this._keybindingService.lookupKeybinding(actionOptions.commandId);
		const keybindingLabel = keybinding ? keybinding.getLabel() : null;
		this._hasContent = true;
		return this._register(HoverAction.render(this.actionsElement, actionOptions, keybindingLabel));
	}

	public append(element: HTMLElement): HTMLElement {
		const result = dom.append(this.actionsElement, element);
		this._hasContent = true;
		return result;
	}
}

class ModesContentComputer implements IHoverComputer<IHoverPart[]> {

	private readonly _editor: ICodeEditor;
	private _result: IHoverPart[];
	private _anchor: HoverAnchor | null;

	constructor(
		editor: ICodeEditor,
		private readonly _participants: readonly IEditorHoverParticipant[]
	) {
		this._editor = editor;
		this._result = [];
		this._anchor = null;
	}

	public setAnchor(anchor: HoverAnchor): void {
		this._anchor = anchor;
		this._result = [];
	}

	public clearResult(): void {
		this._result = [];
	}

	private static _getLineDecorations(editor: IActiveCodeEditor, anchor: HoverAnchor): IModelDecoration[] {
		if (anchor.type !== HoverAnchorType.Range) {
			return [];
		}

		const model = editor.getModel();
		const lineNumber = anchor.range.startLineNumber;
		const maxColumn = model.getLineMaxColumn(lineNumber);
		return editor.getLineDecorations(lineNumber).filter((d) => {
			if (d.options.isWholeLine) {
				return true;
			}

			const startColumn = (d.range.startLineNumber === lineNumber) ? d.range.startColumn : 1;
			const endColumn = (d.range.endLineNumber === lineNumber) ? d.range.endColumn : maxColumn;
			if (startColumn > anchor.range.startColumn || anchor.range.endColumn > endColumn) {
				return false;
			}
			return true;
		});
	}

	public async computeAsync(token: CancellationToken): Promise<IHoverPart[]> {
		const anchor = this._anchor;

		if (!this._editor.hasModel() || !anchor) {
			return Promise.resolve([]);
		}

		const lineDecorations = ModesContentComputer._getLineDecorations(this._editor, anchor);

		const allResults = await Promise.all(this._participants.map(p => this._computeAsync(p, lineDecorations, anchor, token)));
		return flatten(allResults);
	}

	private async _computeAsync(participant: IEditorHoverParticipant, lineDecorations: IModelDecoration[], anchor: HoverAnchor, token: CancellationToken): Promise<IHoverPart[]> {
		if (!participant.computeAsync) {
			return [];
		}
		return participant.computeAsync(anchor, lineDecorations, token);
	}

	public computeSync(): IHoverPart[] {
		if (!this._editor.hasModel() || !this._anchor) {
			return [];
		}

		const lineDecorations = ModesContentComputer._getLineDecorations(this._editor, this._anchor);

		let result: IHoverPart[] = [];
		for (const participant of this._participants) {
			result = result.concat(participant.computeSync(this._anchor, lineDecorations));
		}

		return coalesce(result);
	}

	public onResult(result: IHoverPart[], isFromSynchronousComputation: boolean): void {
		// Always put synchronous messages before asynchronous ones
		if (isFromSynchronousComputation) {
			this._result = result.concat(this._result);
		} else {
			this._result = this._result.concat(result);
		}
	}

	public getResult(): IHoverPart[] {
		return this._result.slice(0);
	}

	public getResultWithLoadingMessage(): IHoverPart[] {
		if (this._anchor) {
			for (const participant of this._participants) {
				if (participant.createLoadingMessage) {
					const loadingMessage = participant.createLoadingMessage(this._anchor);
					if (loadingMessage) {
						return this._result.slice(0).concat([loadingMessage]);
					}
				}
			}
		}
		return this._result.slice(0);
	}
}

export class ModesContentHoverWidget extends Widget implements IContentWidget, IEditorHover {

	static readonly ID = 'editor.contrib.modesContentHoverWidget';

	private readonly _participants: IEditorHoverParticipant[];

	private readonly _hover: HoverWidget;
	private readonly _id: string;
	private readonly _editor: ICodeEditor;
	private _isVisible: boolean;
	private _showAtPosition: Position | null;
	private _showAtRange: Range | null;
	private _stoleFocus: boolean;

	// IContentWidget.allowEditorOverflow
	public readonly allowEditorOverflow = true;

	private _messages: IHoverPart[];
	private _lastAnchor: HoverAnchor | null;
	private readonly _computer: ModesContentComputer;
	private readonly _hoverOperation: HoverOperation<IHoverPart[]>;
	private _highlightDecorations: string[];
	private _isChangingDecorations: boolean;
	private _shouldFocus: boolean;
	private _colorPicker: ColorPickerWidget | null;
	private _renderDisposable: IDisposable | null;
	private _preferBelow: boolean;

	constructor(
		editor: ICodeEditor,
		private readonly _hoverVisibleKey: IContextKey<boolean>,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();

		this._participants = [
			instantiationService.createInstance(ColorHoverParticipant, editor, this),
			instantiationService.createInstance(MarkdownHoverParticipant, editor, this),
			instantiationService.createInstance(InlineCompletionsHoverParticipant, editor, this),
			instantiationService.createInstance(MarkerHoverParticipant, editor, this),
		];

		this._hover = this._register(new HoverWidget());
		this._id = ModesContentHoverWidget.ID;
		this._editor = editor;
		this._isVisible = false;
		this._stoleFocus = false;
		this._renderDisposable = null;

		this.onkeydown(this._hover.containerDomNode, (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			}
		});

		this._register(this._editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._updateFont();
			}
		}));

		this._editor.onDidLayoutChange(() => this.layout());

		this.layout();
		this._editor.addContentWidget(this);
		this._showAtPosition = null;
		this._showAtRange = null;
		this._stoleFocus = false;

		this._messages = [];
		this._lastAnchor = null;
		this._computer = new ModesContentComputer(this._editor, this._participants);
		this._highlightDecorations = [];
		this._isChangingDecorations = false;
		this._shouldFocus = false;
		this._colorPicker = null;
		this._preferBelow = this._editor.getOption(EditorOption.hover).below;

		this._hoverOperation = new HoverOperation(
			this._computer,
			result => this._withResult(result, true),
			null,
			result => this._withResult(result, false),
			this._editor.getOption(EditorOption.hover).delay
		);

		this._register(dom.addStandardDisposableListener(this.getDomNode(), dom.EventType.FOCUS, () => {
			if (this._colorPicker) {
				this.getDomNode().classList.add('colorpicker-hover');
			}
		}));
		this._register(dom.addStandardDisposableListener(this.getDomNode(), dom.EventType.BLUR, () => {
			this.getDomNode().classList.remove('colorpicker-hover');
		}));
		this._register(editor.onDidChangeConfiguration(() => {
			this._hoverOperation.setHoverTime(this._editor.getOption(EditorOption.hover).delay);
			this._preferBelow = this._editor.getOption(EditorOption.hover).below;
		}));
		this._register(TokenizationRegistry.onDidChange(() => {
			if (this._isVisible && this._lastAnchor && this._messages.length > 0) {
				this._hover.contentsDomNode.textContent = '';
				this._renderMessages(this._lastAnchor, this._messages);
			}
		}));
	}

	public override dispose(): void {
		this._hoverOperation.cancel();
		this._editor.removeContentWidget(this);
		super.dispose();
	}

	public getId(): string {
		return this._id;
	}

	public getDomNode(): HTMLElement {
		return this._hover.containerDomNode;
	}

	private _shouldShowAt(mouseEvent: IEditorMouseEvent): boolean {
		const targetType = mouseEvent.target.type;
		if (targetType === MouseTargetType.CONTENT_TEXT) {
			return true;
		}

		if (targetType === MouseTargetType.CONTENT_EMPTY) {
			const epsilon = this._editor.getOption(EditorOption.fontInfo).typicalHalfwidthCharacterWidth / 2;
			const data = <IEmptyContentData>mouseEvent.target.detail;
			if (data && !data.isAfterLines && typeof data.horizontalDistanceToText === 'number' && data.horizontalDistanceToText < epsilon) {
				// Let hover kick in even when the mouse is technically in the empty area after a line, given the distance is small enough
				return true;
			}
		}

		return false;
	}

	public maybeShowAt(mouseEvent: IEditorMouseEvent): boolean {
		const anchorCandidates: HoverAnchor[] = [];

		for (const participant of this._participants) {
			if (typeof participant.suggestHoverAnchor === 'function') {
				const anchor = participant.suggestHoverAnchor(mouseEvent);
				if (anchor) {
					anchorCandidates.push(anchor);
				}
			}
		}

		if (this._shouldShowAt(mouseEvent) && mouseEvent.target.range) {
			// TODO@rebornix. This should be removed if we move Color Picker out of Hover component.
			// Check if mouse is hovering on color decorator
			const hoverOnColorDecorator = [...mouseEvent.target.element?.classList.values() || []].find(className => className.startsWith('ced-colorBox'))
				&& mouseEvent.target.range.endColumn - mouseEvent.target.range.startColumn === 1;
			const showAtRange = (
				hoverOnColorDecorator // shift the mouse focus by one as color decorator is a `before` decoration of next character.
					? new Range(mouseEvent.target.range.startLineNumber, mouseEvent.target.range.startColumn + 1, mouseEvent.target.range.endLineNumber, mouseEvent.target.range.endColumn + 1)
					: mouseEvent.target.range
			);
			anchorCandidates.push(new HoverRangeAnchor(0, showAtRange));
		}

		if (anchorCandidates.length === 0) {
			return false;
		}

		anchorCandidates.sort((a, b) => b.priority - a.priority);
		this._startShowingAt(anchorCandidates[0], HoverStartMode.Delayed, false);

		return true;
	}

	private _showAt(position: Position, range: Range | null, focus: boolean): void {
		// Position has changed
		this._showAtPosition = position;
		this._showAtRange = range;
		this._hoverVisibleKey.set(true);
		this._isVisible = true;
		this._hover.containerDomNode.classList.toggle('hidden', !this._isVisible);

		this._editor.layoutContentWidget(this);
		// Simply force a synchronous render on the editor
		// such that the widget does not really render with left = '0px'
		this._editor.render();
		this._stoleFocus = focus;
		if (focus) {
			this._hover.containerDomNode.focus();
		}
	}

	public getPosition(): IContentWidgetPosition | null {
		if (this._isVisible) {
			return {
				position: this._showAtPosition,
				range: this._showAtRange,
				preference: this._preferBelow ? [
					ContentWidgetPositionPreference.BELOW,
					ContentWidgetPositionPreference.ABOVE,
				] : [
					ContentWidgetPositionPreference.ABOVE,
					ContentWidgetPositionPreference.BELOW,
				],
			};
		}
		return null;
	}

	private _updateFont(): void {
		const codeClasses: HTMLElement[] = Array.prototype.slice.call(this._hover.contentsDomNode.getElementsByClassName('code'));
		codeClasses.forEach(node => this._editor.applyFontInfo(node));
	}

	private _updateContents(node: Node): void {
		this._hover.contentsDomNode.textContent = '';
		this._hover.contentsDomNode.appendChild(node);
		this._updateFont();

		this._editor.layoutContentWidget(this);
		this._hover.onContentsChanged();
	}

	private layout(): void {
		const height = Math.max(this._editor.getLayoutInfo().height / 4, 250);
		const { fontSize, lineHeight } = this._editor.getOption(EditorOption.fontInfo);

		this._hover.contentsDomNode.style.fontSize = `${fontSize}px`;
		this._hover.contentsDomNode.style.lineHeight = `${lineHeight}px`;
		this._hover.contentsDomNode.style.maxHeight = `${height}px`;
		this._hover.contentsDomNode.style.maxWidth = `${Math.max(this._editor.getLayoutInfo().width * 0.66, 500)}px`;
	}

	public onModelDecorationsChanged(): void {
		if (this._isChangingDecorations) {
			return;
		}
		if (this._isVisible) {
			// The decorations have changed and the hover is visible,
			// we need to recompute the displayed text
			this._hoverOperation.cancel();
			this._computer.clearResult();

			if (!this._colorPicker) { // TODO@Michel ensure that displayed text for other decorations is computed even if color picker is in place
				this._hoverOperation.start(HoverStartMode.Delayed);
			}
		}
	}

	public startShowingAtRange(range: Range, mode: HoverStartMode, focus: boolean): void {
		this._startShowingAt(new HoverRangeAnchor(0, range), mode, focus);
	}

	private _startShowingAt(anchor: HoverAnchor, mode: HoverStartMode, focus: boolean): void {
		if (this._lastAnchor && this._lastAnchor.equals(anchor)) {
			// We have to show the widget at the exact same range as before, so no work is needed
			return;
		}

		this._hoverOperation.cancel();

		if (this._isVisible) {
			// The range might have changed, but the hover is visible
			// Instead of hiding it completely, filter out messages that are still in the new range and
			// kick off a new computation
			if (!this._showAtPosition || !this._lastAnchor || !anchor.canAdoptVisibleHover(this._lastAnchor, this._showAtPosition)) {
				this.hide();
			} else {
				const filteredMessages = this._messages.filter((m) => m.isValidForHoverAnchor(anchor));
				if (filteredMessages.length === 0) {
					this.hide();
				} else if (filteredMessages.length === this._messages.length) {
					// no change
					return;
				} else {
					this._renderMessages(anchor, filteredMessages);
				}
			}
		}

		this._lastAnchor = anchor;
		this._computer.setAnchor(anchor);
		this._shouldFocus = focus;
		this._hoverOperation.start(mode);
	}

	public hide(): void {
		this._lastAnchor = null;
		this._hoverOperation.cancel();

		if (this._isVisible) {
			setTimeout(() => {
				// Give commands a chance to see the key
				if (!this._isVisible) {
					this._hoverVisibleKey.set(false);
				}
			}, 0);
			this._isVisible = false;
			this._hover.containerDomNode.classList.toggle('hidden', !this._isVisible);

			this._editor.layoutContentWidget(this);
			if (this._stoleFocus) {
				this._editor.focus();
			}
		}

		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, []);
		this._isChangingDecorations = false;
		if (this._renderDisposable) {
			this._renderDisposable.dispose();
			this._renderDisposable = null;
		}
		this._colorPicker = null;
	}

	public isColorPickerVisible(): boolean {
		return !!this._colorPicker;
	}

	public setColorPicker(widget: ColorPickerWidget): void {
		this._colorPicker = widget;
	}

	public onContentsChanged(): void {
		this._hover.onContentsChanged();
	}

	private _withResult(result: IHoverPart[], complete: boolean): void {
		this._messages = result;

		if (this._lastAnchor && this._messages.length > 0) {
			this._renderMessages(this._lastAnchor, this._messages);
		} else if (complete) {
			this.hide();
		}
	}

	private _renderMessages(anchor: HoverAnchor, messages: IHoverPart[]): void {
		if (this._renderDisposable) {
			this._renderDisposable.dispose();
			this._renderDisposable = null;
		}
		this._colorPicker = null as ColorPickerWidget | null; // TODO: TypeScript thinks this is always null

		// update column from which to show
		let renderColumn = Constants.MAX_SAFE_SMALL_INTEGER;
		let highlightRange: Range = messages[0].range;
		let forceShowAtRange: Range | null = null;
		let fragment = document.createDocumentFragment();

		const disposables = new DisposableStore();
		const hoverParts = new Map<IEditorHoverParticipant, IHoverPart[]>();
		for (const msg of messages) {
			renderColumn = Math.min(renderColumn, msg.range.startColumn);
			highlightRange = Range.plusRange(highlightRange, msg.range);

			if (msg.forceShowAtRange) {
				forceShowAtRange = msg.range;
			}

			if (!hoverParts.has(msg.owner)) {
				hoverParts.set(msg.owner, []);
			}
			const dest = hoverParts.get(msg.owner)!;
			dest.push(msg);
		}

		const statusBar = disposables.add(new EditorHoverStatusBar(this._keybindingService));

		for (const [participant, participantHoverParts] of hoverParts) {
			disposables.add(participant.renderHoverParts(participantHoverParts, fragment, statusBar));
		}

		if (statusBar.hasContent) {
			fragment.appendChild(statusBar.hoverElement);
		}

		this._renderDisposable = disposables;

		// show

		if (fragment.hasChildNodes()) {
			if (forceShowAtRange) {
				this._showAt(forceShowAtRange.getStartPosition(), forceShowAtRange, this._shouldFocus);
			} else {
				this._showAt(new Position(anchor.range.startLineNumber, renderColumn), highlightRange, this._shouldFocus);
			}
			this._updateContents(fragment);
		}
		if (this._colorPicker) {
			this._colorPicker.layout();
		}

		this._isChangingDecorations = true;
		this._highlightDecorations = this._editor.deltaDecorations(this._highlightDecorations, highlightRange ? [{
			range: highlightRange,
			options: ModesContentHoverWidget._DECORATION_OPTIONS
		}] : []);
		this._isChangingDecorations = false;
	}

	private static readonly _DECORATION_OPTIONS = ModelDecorationOptions.register({
		description: 'content-hover-highlight',
		className: 'hoverHighlight'
	});
}

registerThemingParticipant((theme, collector) => {
	const linkFg = theme.getColor(textLinkForeground);
	if (linkFg) {
		collector.addRule(`.monaco-hover .hover-contents a.code-link span:hover { color: ${linkFg}; }`);
	}
});
