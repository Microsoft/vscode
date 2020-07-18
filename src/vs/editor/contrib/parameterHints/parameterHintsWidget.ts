/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { domEvent, stop } from 'vs/base/browser/event';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import 'vs/css!./parameterHints';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import * as modes from 'vs/editor/common/modes';
import { IModeService } from 'vs/editor/common/services/modeService';
import { MarkdownRenderer } from 'vs/editor/contrib/markdown/markdownRenderer';
import { Context } from 'vs/editor/contrib/parameterHints/provideSignatureHelp';
import * as nls from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { editorHoverBackground, editorHoverBorder, textCodeBlockBackground, textLinkForeground, editorHoverForeground } from 'vs/platform/theme/common/colorRegistry';
import { HIGH_CONTRAST, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { ParameterHintsModel, TriggerContext } from 'vs/editor/contrib/parameterHints/parameterHintsModel';
import { pad } from 'vs/base/common/strings';
import { registerIcon, Codicon } from 'vs/base/common/codicons';
import { assertIsDefined } from 'vs/base/common/types';

const $ = dom.$;

const parameterHintsNextIcon = registerIcon('parameter-hints-next', Codicon.chevronDown);
const parameterHintsPreviousIcon = registerIcon('parameter-hints-previous', Codicon.chevronUp);

export class ParameterHintsWidget extends Disposable implements IContentWidget {

	private static readonly ID = 'editor.widget.parameterHintsWidget';

	private readonly markdownRenderer: MarkdownRenderer;
	private readonly renderDisposeables = this._register(new DisposableStore());
	private readonly model: ParameterHintsModel;
	private readonly keyVisible: IContextKey<boolean>;
	private readonly keyMultipleSignatures: IContextKey<boolean>;

	private domNodes?: {
		readonly element: HTMLElement;
		readonly signature: HTMLElement;
		readonly docs: HTMLElement;
		readonly overloads: HTMLElement;
		readonly scrollbar: DomScrollableElement;
	};

	private visible: boolean = false;
	private announcedLabel: string | null = null;

	// Editor.IContentWidget.allowEditorOverflow
	allowEditorOverflow = true;

	constructor(
		private readonly editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IModeService modeService: IModeService,
	) {
		super();
		this.markdownRenderer = this._register(new MarkdownRenderer(editor, modeService, openerService));
		this.model = this._register(new ParameterHintsModel(editor));
		this.keyVisible = Context.Visible.bindTo(contextKeyService);
		this.keyMultipleSignatures = Context.MultipleSignatures.bindTo(contextKeyService);

		this._register(this.model.onChangedHints(newParameterHints => {
			if (newParameterHints) {
				this.show();
				this.render(newParameterHints);
			} else {
				this.hide();
			}
		}));
	}

	private createParamaterHintDOMNodes() {
		const element = $('.editor-widget.parameter-hints-widget');
		const wrapper = dom.append(element, $('.wrapper'));
		wrapper.tabIndex = -1;

		const controls = dom.append(wrapper, $('.controls'));
		const previous = dom.append(controls, $('.button' + parameterHintsPreviousIcon.cssSelector));
		const overloads = dom.append(controls, $('.overloads'));
		const next = dom.append(controls, $('.button' + parameterHintsNextIcon.cssSelector));

		const onPreviousClick = stop(domEvent(previous, 'click'));
		this._register(onPreviousClick(this.previous, this));

		const onNextClick = stop(domEvent(next, 'click'));
		this._register(onNextClick(this.next, this));

		const body = $('.body');
		const scrollbar = new DomScrollableElement(body, {});
		this._register(scrollbar);
		wrapper.appendChild(scrollbar.getDomNode());

		const signature = dom.append(body, $('.signature'));
		const docs = dom.append(body, $('.docs'));

		element.style.userSelect = 'text';

		this.domNodes = {
			element,
			signature,
			overloads,
			docs,
			scrollbar,
		};

		this.editor.addContentWidget(this);
		this.hide();

		this._register(this.editor.onDidChangeCursorSelection(e => {
			if (this.visible) {
				this.editor.layoutContentWidget(this);
			}
		}));

		const updateFont = () => {
			if (!this.domNodes) {
				return;
			}
			const fontInfo = this.editor.getOption(EditorOption.fontInfo);
			this.domNodes.element.style.fontSize = `${fontInfo.fontSize}px`;
		};

		updateFont();

		this._register(Event.chain<ConfigurationChangedEvent>(this.editor.onDidChangeConfiguration.bind(this.editor))
			.filter(e => e.hasChanged(EditorOption.fontInfo))
			.on(updateFont, null));

		this._register(this.editor.onDidLayoutChange(e => this.updateMaxHeight()));
		this.updateMaxHeight();
	}

	private show(): void {
		if (this.visible) {
			return;
		}

		if (!this.domNodes) {
			this.createParamaterHintDOMNodes();
		}

		this.keyVisible.set(true);
		this.visible = true;
		setTimeout(() => {
			if (this.domNodes) {
				dom.addClass(this.domNodes.element, 'visible');
			}
		}, 100);
		this.editor.layoutContentWidget(this);
	}

	private hide(): void {
		this.renderDisposeables.clear();

		if (!this.visible) {
			return;
		}

		this.keyVisible.reset();
		this.visible = false;
		this.announcedLabel = null;
		if (this.domNodes) {
			dom.removeClass(this.domNodes.element, 'visible');
		}
		this.editor.layoutContentWidget(this);
	}

	getPosition(): IContentWidgetPosition | null {
		if (this.visible) {
			return {
				position: this.editor.getPosition(),
				preference: [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW]
			};
		}
		return null;
	}

	private render(hints: modes.SignatureHelp): void {
		this.renderDisposeables.clear();

		if (!this.domNodes) {
			return;
		}

		const multiple = hints.signatures.length > 1;
		dom.toggleClass(this.domNodes.element, 'multiple', multiple);
		this.keyMultipleSignatures.set(multiple);

		this.domNodes.signature.innerHTML = '';
		this.domNodes.docs.innerHTML = '';

		const signature = hints.signatures[hints.activeSignature];
		if (!signature) {
			return;
		}

		const code = dom.append(this.domNodes.signature, $('.code'));
		const fontInfo = this.editor.getOption(EditorOption.fontInfo);
		code.style.fontSize = `${fontInfo.fontSize}px`;
		code.style.fontFamily = fontInfo.fontFamily;

		const hasParameters = signature.parameters.length > 0;
		const activeParameterIndex = signature.activeParameter ?? hints.activeParameter;

		if (!hasParameters) {
			const label = dom.append(code, $('span'));
			label.textContent = signature.label;
		} else {
			this.renderParameters(code, signature, activeParameterIndex);
		}

		const activeParameter: modes.ParameterInformation | undefined = signature.parameters[activeParameterIndex];
		if (activeParameter?.documentation) {
			const documentation = $('span.documentation');
			if (typeof activeParameter.documentation === 'string') {
				documentation.textContent = activeParameter.documentation;
			} else {
				const renderedContents = this.renderDisposeables.add(this.markdownRenderer.render(activeParameter.documentation));
				dom.addClass(renderedContents.element, 'markdown-docs');
				documentation.appendChild(renderedContents.element);
			}
			dom.append(this.domNodes.docs, $('p', {}, documentation));
		}

		if (signature.documentation === undefined) {
			/** no op */
		} else if (typeof signature.documentation === 'string') {
			dom.append(this.domNodes.docs, $('p', {}, signature.documentation));
		} else {
			const renderedContents = this.renderDisposeables.add(this.markdownRenderer.render(signature.documentation));
			dom.addClass(renderedContents.element, 'markdown-docs');
			dom.append(this.domNodes.docs, renderedContents.element);
		}

		const hasDocs = this.hasDocs(signature, activeParameter);

		dom.toggleClass(this.domNodes.signature, 'has-docs', hasDocs);
		dom.toggleClass(this.domNodes.docs, 'empty', !hasDocs);

		this.domNodes.overloads.textContent =
			pad(hints.activeSignature + 1, hints.signatures.length.toString().length) + '/' + hints.signatures.length;

		if (activeParameter) {
			const labelToAnnounce = this.getParameterLabel(signature, activeParameterIndex);
			// Select method gets called on every user type while parameter hints are visible.
			// We do not want to spam the user with same announcements, so we only announce if the current parameter changed.

			if (this.announcedLabel !== labelToAnnounce) {
				aria.alert(nls.localize('hint', "{0}, hint", labelToAnnounce));
				this.announcedLabel = labelToAnnounce;
			}
		}

		this.editor.layoutContentWidget(this);
		this.domNodes.scrollbar.scanDomNode();
	}

	private hasDocs(signature: modes.SignatureInformation, activeParameter: modes.ParameterInformation | undefined): boolean {
		if (activeParameter && typeof activeParameter.documentation === 'string' && assertIsDefined(activeParameter.documentation).length > 0) {
			return true;
		}
		if (activeParameter && typeof activeParameter.documentation === 'object' && assertIsDefined(activeParameter.documentation).value.length > 0) {
			return true;
		}
		if (signature.documentation && typeof signature.documentation === 'string' && assertIsDefined(signature.documentation).length > 0) {
			return true;
		}
		if (signature.documentation && typeof signature.documentation === 'object' && assertIsDefined(signature.documentation.value).length > 0) {
			return true;
		}
		return false;
	}

	private renderParameters(parent: HTMLElement, signature: modes.SignatureInformation, activeParameterIndex: number): void {
		const [start, end] = this.getParameterLabelOffsets(signature, activeParameterIndex);

		const beforeSpan = document.createElement('span');
		beforeSpan.textContent = signature.label.substring(0, start);

		const paramSpan = document.createElement('span');
		paramSpan.textContent = signature.label.substring(start, end);
		paramSpan.className = 'parameter active';

		const afterSpan = document.createElement('span');
		afterSpan.textContent = signature.label.substring(end);

		dom.append(parent, beforeSpan, paramSpan, afterSpan);
	}

	private getParameterLabel(signature: modes.SignatureInformation, paramIdx: number): string {
		const param = signature.parameters[paramIdx];
		if (Array.isArray(param.label)) {
			return signature.label.substring(param.label[0], param.label[1]);
		} else {
			return param.label;
		}
	}

	private getParameterLabelOffsets(signature: modes.SignatureInformation, paramIdx: number): [number, number] {
		const param = signature.parameters[paramIdx];
		if (!param) {
			return [0, 0];
		} else if (Array.isArray(param.label)) {
			return param.label;
		} else {
			const idx = signature.label.lastIndexOf(param.label);
			return idx >= 0
				? [idx, idx + param.label.length]
				: [0, 0];
		}
	}

	next(): void {
		this.editor.focus();
		this.model.next();
	}

	previous(): void {
		this.editor.focus();
		this.model.previous();
	}

	cancel(): void {
		this.model.cancel();
	}

	getDomNode(): HTMLElement {
		if (!this.domNodes) {
			this.createParamaterHintDOMNodes();
		}
		return this.domNodes!.element;
	}

	getId(): string {
		return ParameterHintsWidget.ID;
	}

	trigger(context: TriggerContext): void {
		this.model.trigger(context, 0);
	}

	private updateMaxHeight(): void {
		if (!this.domNodes) {
			return;
		}
		const height = Math.max(this.editor.getLayoutInfo().height / 4, 250);
		const maxHeight = `${height}px`;
		this.domNodes.element.style.maxHeight = maxHeight;
		const wrapper = this.domNodes.element.getElementsByClassName('wrapper') as HTMLCollectionOf<HTMLElement>;
		if (wrapper.length) {
			wrapper[0].style.maxHeight = maxHeight;
		}
	}
}

registerThemingParticipant((theme, collector) => {
	const border = theme.getColor(editorHoverBorder);
	if (border) {
		const borderWidth = theme.type === HIGH_CONTRAST ? 2 : 1;
		collector.addRule(`.monaco-editor .parameter-hints-widget { border: ${borderWidth}px solid ${border}; }`);
		collector.addRule(`.monaco-editor .parameter-hints-widget.multiple .body { border-left: 1px solid ${border.transparent(0.5)}; }`);
		collector.addRule(`.monaco-editor .parameter-hints-widget .signature.has-docs { border-bottom: 1px solid ${border.transparent(0.5)}; }`);
	}
	const background = theme.getColor(editorHoverBackground);
	if (background) {
		collector.addRule(`.monaco-editor .parameter-hints-widget { background-color: ${background}; }`);
	}

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-editor .parameter-hints-widget a { color: ${link}; }`);
	}

	const foreground = theme.getColor(editorHoverForeground);
	if (foreground) {
		collector.addRule(`.monaco-editor .parameter-hints-widget { color: ${foreground}; }`);
	}

	const codeBackground = theme.getColor(textCodeBlockBackground);
	if (codeBackground) {
		collector.addRule(`.monaco-editor .parameter-hints-widget code { background-color: ${codeBackground}; }`);
	}
});
