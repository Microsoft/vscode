/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/suggest';
import 'vs/css!./media/suggestStatusBar';
import 'vs/base/browser/ui/codicons/codiconStyles'; // The codicon symbol styles are defined here and must be loaded
import 'vs/editor/contrib/documentSymbols/outlineTree'; // The codicon symbol colors are defined here and must be loaded
import * as nls from 'vs/nls';
import { createMatches } from 'vs/base/common/filters';
import * as strings from 'vs/base/common/strings';
import { Event, Emitter } from 'vs/base/common/event';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable, dispose, toDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { append, $, hide, show, getDomNodePagePosition, addDisposableListener, addStandardDisposableListener, addClasses } from 'vs/base/browser/dom';
import { IListVirtualDelegate, IListEvent, IListRenderer, IListMouseEvent, IListGestureEvent } from 'vs/base/browser/ui/list/list';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { Context as SuggestContext, CompletionItem, suggestWidgetStatusbarMenu } from './suggest';
import { CompletionModel } from './completionModel';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { attachListStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, IColorTheme, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { registerColor, editorWidgetBackground, listFocusBackground, activeContrastBorder, listHighlightForeground, editorForeground, editorWidgetBorder, focusBorder, textLinkForeground, textCodeBlockBackground } from 'vs/platform/theme/common/colorRegistry';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { MarkdownRenderer } from 'vs/editor/contrib/markdown/markdownRenderer';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { TimeoutTimer, CancelablePromise, createCancelablePromise, disposableTimeout } from 'vs/base/common/async';
import { CompletionItemKind, completionKindToCssClass, CompletionItemTag } from 'vs/editor/common/modes';
import { IconLabel, IIconLabelValueOptions } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { IModelService } from 'vs/editor/common/services/modelService';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { FileKind } from 'vs/platform/files/common/files';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { flatten, isFalsyOrEmpty } from 'vs/base/common/arrays';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { ActionBar, IActionViewItemProvider, ActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IAction } from 'vs/base/common/actions';
import { Codicon, registerIcon } from 'vs/base/common/codicons';

const expandSuggestionDocsByDefault = false;

const suggestMoreInfoIcon = registerIcon('suggest-more-info', Codicon.chevronRight);

interface ISuggestionTemplateData {
	root: HTMLElement;

	/**
	 * Flexbox
	 * < ------------- left ------------ >     < --- right -- >
	 * <icon><label><signature><qualifier>     <type><readmore>
	 */
	left: HTMLElement;
	right: HTMLElement;

	icon: HTMLElement;
	colorspan: HTMLElement;
	iconLabel: IconLabel;
	iconContainer: HTMLElement;
	parametersLabel: HTMLElement;
	qualifierLabel: HTMLElement;
	/**
	 * Showing either `CompletionItem#details` or `CompletionItemLabel#type`
	 */
	detailsLabel: HTMLElement;
	readMore: HTMLElement;
	disposables: DisposableStore;
}

/**
 * Suggest widget colors
 */
export const editorSuggestWidgetBackground = registerColor('editorSuggestWidget.background', { dark: editorWidgetBackground, light: editorWidgetBackground, hc: editorWidgetBackground }, nls.localize('editorSuggestWidgetBackground', 'Background color of the suggest widget.'));
export const editorSuggestWidgetBorder = registerColor('editorSuggestWidget.border', { dark: editorWidgetBorder, light: editorWidgetBorder, hc: editorWidgetBorder }, nls.localize('editorSuggestWidgetBorder', 'Border color of the suggest widget.'));
export const editorSuggestWidgetForeground = registerColor('editorSuggestWidget.foreground', { dark: editorForeground, light: editorForeground, hc: editorForeground }, nls.localize('editorSuggestWidgetForeground', 'Foreground color of the suggest widget.'));
export const editorSuggestWidgetSelectedBackground = registerColor('editorSuggestWidget.selectedBackground', { dark: listFocusBackground, light: listFocusBackground, hc: listFocusBackground }, nls.localize('editorSuggestWidgetSelectedBackground', 'Background color of the selected entry in the suggest widget.'));
export const editorSuggestWidgetHighlightForeground = registerColor('editorSuggestWidget.highlightForeground', { dark: listHighlightForeground, light: listHighlightForeground, hc: listHighlightForeground }, nls.localize('editorSuggestWidgetHighlightForeground', 'Color of the match highlights in the suggest widget.'));

const colorRegExp = /^(#([\da-f]{3}){1,2}|(rgb|hsl)a\(\s*(\d{1,3}%?\s*,\s*){3}(1|0?\.\d+)\)|(rgb|hsl)\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}\s*\))$/i;
function extractColor(item: CompletionItem, out: string[]): boolean {
	const label = typeof item.completion.label === 'string'
		? item.completion.label
		: item.completion.label.name;

	if (label.match(colorRegExp)) {
		out[0] = label;
		return true;
	}
	if (typeof item.completion.documentation === 'string' && item.completion.documentation.match(colorRegExp)) {
		out[0] = item.completion.documentation;
		return true;
	}
	return false;
}

function canExpandCompletionItem(item: CompletionItem | null) {
	if (!item) {
		return false;
	}
	const suggestion = item.completion;
	if (suggestion.documentation) {
		return true;
	}
	return (suggestion.detail && suggestion.detail !== suggestion.label);
}

function getAriaId(index: number): string {
	return `suggest-aria-id:${index}`;
}

class ItemRenderer implements IListRenderer<CompletionItem, ISuggestionTemplateData> {

	constructor(
		private widget: SuggestWidget,
		private editor: ICodeEditor,
		private triggerKeybindingLabel: string,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@IThemeService private readonly _themeService: IThemeService,
	) {

	}

	get templateId(): string {
		return 'suggestion';
	}

	renderTemplate(container: HTMLElement): ISuggestionTemplateData {
		const data = <ISuggestionTemplateData>Object.create(null);
		data.disposables = new DisposableStore();

		data.root = container;
		data.root.classList.add('show-file-icons');

		data.icon = append(container, $('.icon'));
		data.colorspan = append(data.icon, $('span.colorspan'));

		const text = append(container, $('.contents'));
		const main = append(text, $('.main'));

		data.iconContainer = append(main, $('.icon-label.codicon'));
		data.left = append(main, $('span.left'));
		data.right = append(main, $('span.right'));

		data.iconLabel = new IconLabel(data.left, { supportHighlights: true, supportCodicons: true });
		data.disposables.add(data.iconLabel);

		data.parametersLabel = append(data.left, $('span.signature-label'));
		data.qualifierLabel = append(data.left, $('span.qualifier-label'));
		data.detailsLabel = append(data.right, $('span.details-label'));

		data.readMore = append(data.right, $('span.readMore' + suggestMoreInfoIcon.cssSelector));
		data.readMore.title = nls.localize('readMore', "Read More...{0}", this.triggerKeybindingLabel);

		const configureFont = () => {
			const options = this.editor.getOptions();
			const fontInfo = options.get(EditorOption.fontInfo);
			const fontFamily = fontInfo.fontFamily;
			const fontFeatureSettings = fontInfo.fontFeatureSettings;
			const fontSize = options.get(EditorOption.suggestFontSize) || fontInfo.fontSize;
			const lineHeight = options.get(EditorOption.suggestLineHeight) || fontInfo.lineHeight;
			const fontWeight = fontInfo.fontWeight;
			const fontSizePx = `${fontSize}px`;
			const lineHeightPx = `${lineHeight}px`;

			data.root.style.fontSize = fontSizePx;
			data.root.style.fontWeight = fontWeight;
			main.style.fontFamily = fontFamily;
			main.style.fontFeatureSettings = fontFeatureSettings;
			main.style.lineHeight = lineHeightPx;
			data.icon.style.height = lineHeightPx;
			data.icon.style.width = lineHeightPx;
			data.readMore.style.height = lineHeightPx;
			data.readMore.style.width = lineHeightPx;
		};

		configureFont();

		data.disposables.add(Event.chain<ConfigurationChangedEvent>(this.editor.onDidChangeConfiguration.bind(this.editor))
			.filter(e => e.hasChanged(EditorOption.fontInfo) || e.hasChanged(EditorOption.suggestFontSize) || e.hasChanged(EditorOption.suggestLineHeight))
			.on(configureFont, null));

		return data;
	}

	renderElement(element: CompletionItem, index: number, templateData: ISuggestionTemplateData): void {
		const data = <ISuggestionTemplateData>templateData;
		const suggestion = (<CompletionItem>element).completion;
		const textLabel = typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.name;

		data.root.id = getAriaId(index);
		data.colorspan.style.backgroundColor = '';

		const labelOptions: IIconLabelValueOptions = {
			labelEscapeNewLines: true,
			matches: createMatches(element.score)
		};

		let color: string[] = [];
		if (suggestion.kind === CompletionItemKind.Color && extractColor(element, color)) {
			// special logic for 'color' completion items
			data.icon.className = 'icon customcolor';
			data.iconContainer.className = 'icon hide';
			data.colorspan.style.backgroundColor = color[0];

		} else if (suggestion.kind === CompletionItemKind.File && this._themeService.getFileIconTheme().hasFileIcons) {
			// special logic for 'file' completion items
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			const labelClasses = getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: textLabel }), FileKind.FILE);
			const detailClasses = getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: suggestion.detail }), FileKind.FILE);
			labelOptions.extraClasses = labelClasses.length > detailClasses.length ? labelClasses : detailClasses;

		} else if (suggestion.kind === CompletionItemKind.Folder && this._themeService.getFileIconTheme().hasFolderIcons) {
			// special logic for 'folder' completion items
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			labelOptions.extraClasses = flatten([
				getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: textLabel }), FileKind.FOLDER),
				getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: suggestion.detail }), FileKind.FOLDER)
			]);
		} else {
			// normal icon
			data.icon.className = 'icon hide';
			data.iconContainer.className = '';
			addClasses(data.iconContainer, `suggest-icon ${completionKindToCssClass(suggestion.kind)}`);
		}

		if (suggestion.tags && suggestion.tags.indexOf(CompletionItemTag.Deprecated) >= 0) {
			labelOptions.extraClasses = (labelOptions.extraClasses || []).concat(['deprecated']);
			labelOptions.matches = [];
		}

		data.iconLabel.setLabel(textLabel, undefined, labelOptions);
		if (typeof suggestion.label === 'string') {
			data.parametersLabel.textContent = '';
			data.qualifierLabel.textContent = '';
			data.detailsLabel.textContent = (suggestion.detail || '').replace(/\n.*$/m, '');
			data.root.classList.add('string-label');
		} else {
			data.parametersLabel.textContent = (suggestion.label.parameters || '').replace(/\n.*$/m, '');
			data.qualifierLabel.textContent = (suggestion.label.qualifier || '').replace(/\n.*$/m, '');
			data.detailsLabel.textContent = (suggestion.label.type || '').replace(/\n.*$/m, '');
			data.root.classList.remove('string-label');
		}

		if (canExpandCompletionItem(element)) {
			data.right.classList.add('can-expand-details');
			show(data.readMore);
			data.readMore.onmousedown = e => {
				e.stopPropagation();
				e.preventDefault();
			};
			data.readMore.onclick = e => {
				e.stopPropagation();
				e.preventDefault();
				this.widget.toggleDetails();
			};
		} else {
			data.right.classList.remove('can-expand-details');
			hide(data.readMore);
			data.readMore.onmousedown = null;
			data.readMore.onclick = null;
		}
	}

	disposeTemplate(templateData: ISuggestionTemplateData): void {
		templateData.disposables.dispose();
	}
}

const enum State {
	Hidden,
	Loading,
	Empty,
	Open,
	Frozen,
	Details
}


class SuggestionDetails {

	private el: HTMLElement;
	private close: HTMLElement;
	private scrollbar: DomScrollableElement;
	private body: HTMLElement;
	private header: HTMLElement;
	private type: HTMLElement;
	private docs: HTMLElement;
	private readonly disposables: DisposableStore;
	private renderDisposeable?: IDisposable;
	private borderWidth: number = 1;

	constructor(
		container: HTMLElement,
		private readonly widget: SuggestWidget,
		private readonly editor: ICodeEditor,
		private readonly markdownRenderer: MarkdownRenderer,
		private readonly kbToggleDetails: string,
	) {
		this.disposables = new DisposableStore();

		this.el = append(container, $('.details'));
		this.disposables.add(toDisposable(() => container.removeChild(this.el)));

		this.body = $('.body');

		this.scrollbar = new DomScrollableElement(this.body, {});
		append(this.el, this.scrollbar.getDomNode());
		this.disposables.add(this.scrollbar);

		this.header = append(this.body, $('.header'));
		this.close = append(this.header, $('span' + Codicon.close.cssSelector));
		this.close.title = nls.localize('readLess', "Read less...{0}", this.kbToggleDetails);
		this.type = append(this.header, $('p.type'));

		this.docs = append(this.body, $('p.docs'));

		this.configureFont();

		Event.chain<ConfigurationChangedEvent>(this.editor.onDidChangeConfiguration.bind(this.editor))
			.filter(e => e.hasChanged(EditorOption.fontInfo))
			.on(this.configureFont, this, this.disposables);

		markdownRenderer.onDidRenderCodeBlock(() => this.scrollbar.scanDomNode(), this, this.disposables);
	}

	get element() {
		return this.el;
	}

	renderLoading(): void {
		this.type.textContent = nls.localize('loading', "Loading...");
		this.docs.textContent = '';
	}

	renderItem(item: CompletionItem, explainMode: boolean): void {
		dispose(this.renderDisposeable);
		this.renderDisposeable = undefined;

		let { documentation, detail } = item.completion;
		// --- documentation

		if (explainMode) {
			let md = '';
			md += `score: ${item.score[0]}${item.word ? `, compared '${item.completion.filterText && (item.completion.filterText + ' (filterText)') || item.completion.label}' with '${item.word}'` : ' (no prefix)'}\n`;
			md += `distance: ${item.distance}, see localityBonus-setting\n`;
			md += `index: ${item.idx}, based on ${item.completion.sortText && `sortText: "${item.completion.sortText}"` || 'label'}\n`;
			documentation = new MarkdownString().appendCodeblock('empty', md);
			detail = `Provider: ${item.provider._debugDisplayName}`;
		}

		if (!explainMode && !canExpandCompletionItem(item)) {
			this.type.textContent = '';
			this.docs.textContent = '';
			this.el.classList.add('no-docs');
			return;
		}
		this.el.classList.remove('no-docs');
		if (typeof documentation === 'string') {
			this.docs.classList.remove('markdown-docs');
			this.docs.textContent = documentation;
		} else {
			this.docs.classList.add('markdown-docs');
			this.docs.innerHTML = '';
			const renderedContents = this.markdownRenderer.render(documentation);
			this.renderDisposeable = renderedContents;
			this.docs.appendChild(renderedContents.element);
		}

		// --- details
		if (detail) {
			this.type.innerText = detail;
			show(this.type);
		} else {
			this.type.innerText = '';
			hide(this.type);
		}

		this.el.style.height = this.header.offsetHeight + this.docs.offsetHeight + (this.borderWidth * 2) + 'px';
		this.el.style.userSelect = 'text';
		this.el.tabIndex = -1;

		this.close.onmousedown = e => {
			e.preventDefault();
			e.stopPropagation();
		};
		this.close.onclick = e => {
			e.preventDefault();
			e.stopPropagation();
			this.widget.toggleDetails();
		};

		this.body.scrollTop = 0;
		this.scrollbar.scanDomNode();
	}

	scrollDown(much = 8): void {
		this.body.scrollTop += much;
	}

	scrollUp(much = 8): void {
		this.body.scrollTop -= much;
	}

	scrollTop(): void {
		this.body.scrollTop = 0;
	}

	scrollBottom(): void {
		this.body.scrollTop = this.body.scrollHeight;
	}

	pageDown(): void {
		this.scrollDown(80);
	}

	pageUp(): void {
		this.scrollUp(80);
	}

	setBorderWidth(width: number): void {
		this.borderWidth = width;
	}

	private configureFont() {
		const options = this.editor.getOptions();
		const fontInfo = options.get(EditorOption.fontInfo);
		const fontFamily = fontInfo.fontFamily;
		const fontSize = options.get(EditorOption.suggestFontSize) || fontInfo.fontSize;
		const lineHeight = options.get(EditorOption.suggestLineHeight) || fontInfo.lineHeight;
		const fontWeight = fontInfo.fontWeight;
		const fontSizePx = `${fontSize}px`;
		const lineHeightPx = `${lineHeight}px`;

		this.el.style.fontSize = fontSizePx;
		this.el.style.fontWeight = fontWeight;
		this.el.style.fontFeatureSettings = fontInfo.fontFeatureSettings;
		this.type.style.fontFamily = fontFamily;
		this.close.style.height = lineHeightPx;
		this.close.style.width = lineHeightPx;
	}

	dispose(): void {
		this.disposables.dispose();
		dispose(this.renderDisposeable);
		this.renderDisposeable = undefined;
	}
}

export interface ISelectedSuggestion {
	item: CompletionItem;
	index: number;
	model: CompletionModel;
}

export class SuggestWidget implements IContentWidget, IListVirtualDelegate<CompletionItem>, IDisposable {

	private static readonly ID: string = 'editor.widget.suggestWidget';

	static LOADING_MESSAGE: string = nls.localize('suggestWidget.loading', "Loading...");
	static NO_SUGGESTIONS_MESSAGE: string = nls.localize('suggestWidget.noSuggestions', "No suggestions.");

	// Editor.IContentWidget.allowEditorOverflow
	readonly allowEditorOverflow = true;
	readonly suppressMouseDown = false;

	private state: State = State.Hidden;
	private isAddedAsContentWidget: boolean = false;
	private isAuto: boolean = false;
	private loadingTimeout: IDisposable = Disposable.None;
	private currentSuggestionDetails: CancelablePromise<void> | null = null;
	private focusedItem: CompletionItem | null;
	private ignoreFocusEvents: boolean = false;
	private completionModel: CompletionModel | null = null;

	private element: HTMLElement;
	private messageElement: HTMLElement;
	private listElement: HTMLElement;
	private statusBarElement: HTMLElement;
	private details: SuggestionDetails;
	private list: List<CompletionItem>;
	private listHeight?: number;

	private readonly ctxSuggestWidgetVisible: IContextKey<boolean>;
	private readonly ctxSuggestWidgetDetailsVisible: IContextKey<boolean>;
	private readonly ctxSuggestWidgetMultipleSuggestions: IContextKey<boolean>;

	private readonly showTimeout = new TimeoutTimer();
	private readonly toDispose = new DisposableStore();

	private readonly onDidSelectEmitter = new Emitter<ISelectedSuggestion>();
	private readonly onDidFocusEmitter = new Emitter<ISelectedSuggestion>();
	private readonly onDidHideEmitter = new Emitter<this>();
	private readonly onDidShowEmitter = new Emitter<this>();

	readonly onDidSelect: Event<ISelectedSuggestion> = this.onDidSelectEmitter.event;
	readonly onDidFocus: Event<ISelectedSuggestion> = this.onDidFocusEmitter.event;
	readonly onDidHide: Event<this> = this.onDidHideEmitter.event;
	readonly onDidShow: Event<this> = this.onDidShowEmitter.event;

	private readonly maxWidgetWidth = 660;
	private readonly listWidth = 330;
	private readonly storageService: IStorageService;
	private detailsFocusBorderColor?: string;
	private detailsBorderColor?: string;

	private firstFocusInCurrentList: boolean = false;

	private preferDocPositionTop: boolean = false;
	private docsPositionPreviousWidgetY: number | null = null;
	private explainMode: boolean = false;

	private readonly _onDetailsKeydown = new Emitter<IKeyboardEvent>();
	public readonly onDetailsKeyDown: Event<IKeyboardEvent> = this._onDetailsKeydown.event;

	constructor(
		private readonly editor: ICodeEditor,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IModeService modeService: IModeService,
		@IOpenerService openerService: IOpenerService,
		@IMenuService menuService: IMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		const markdownRenderer = this.toDispose.add(new MarkdownRenderer(editor, modeService, openerService));

		const kbToggleDetails = keybindingService.lookupKeybinding('toggleSuggestionDetails')?.getLabel() ?? '';

		this.isAuto = false;
		this.focusedItem = null;
		this.storageService = storageService;

		this.element = $('.editor-widget.suggest-widget');
		this.toDispose.add(addDisposableListener(this.element, 'click', e => {
			if (e.target === this.element) {
				this.hideWidget();
			}
		}));

		this.messageElement = append(this.element, $('.message'));
		this.listElement = append(this.element, $('.tree'));

		const applyStatusBarStyle = () => this.element.classList.toggle('with-status-bar', this.editor.getOption(EditorOption.suggest).statusBar.visible);
		applyStatusBarStyle();

		this.statusBarElement = append(this.element, $('.suggest-status-bar'));
		const actionViewItemProvider = <IActionViewItemProvider>(action => {
			const kb = keybindingService.lookupKeybindings(action.id);
			return new class extends ActionViewItem {
				constructor() {
					super(undefined, action, { label: true, icon: false });
				}
				updateLabel() {
					if (isFalsyOrEmpty(kb) || !this.label) {
						return super.updateLabel();
					}
					const { label } = this.getAction();
					this.label.textContent = /{\d}/.test(label)
						? strings.format(this.getAction().label, kb[0].getLabel())
						: `${this.getAction().label} (${kb[0].getLabel()})`;
				}
			};
		});
		const leftActions = new ActionBar(this.statusBarElement, { actionViewItemProvider });
		const rightActions = new ActionBar(this.statusBarElement, { actionViewItemProvider });
		const menu = menuService.createMenu(suggestWidgetStatusbarMenu, contextKeyService);
		const renderMenu = () => {
			const left: IAction[] = [];
			const right: IAction[] = [];
			for (let [group, actions] of menu.getActions()) {
				if (group === 'left') {
					left.push(...actions);
				} else {
					right.push(...actions);
				}
			}
			leftActions.clear();
			leftActions.push(left);
			rightActions.clear();
			rightActions.push(right);
		};
		this.toDispose.add(menu.onDidChange(() => renderMenu()));
		this.toDispose.add(menu);

		this.details = instantiationService.createInstance(SuggestionDetails, this.element, this, this.editor, markdownRenderer, kbToggleDetails);

		const applyIconStyle = () => this.element.classList.toggle('no-icons', !this.editor.getOption(EditorOption.suggest).showIcons);
		applyIconStyle();

		let renderer = instantiationService.createInstance(ItemRenderer, this, this.editor, kbToggleDetails);

		this.list = new List('SuggestWidget', this.listElement, this, [renderer], {
			useShadows: false,
			openController: { shouldOpen: () => false },
			mouseSupport: false,
			accessibilityProvider: {
				getRole: () => 'option',
				getAriaLabel: (item: CompletionItem) => {
					const textLabel = typeof item.completion.label === 'string' ? item.completion.label : item.completion.label.name;
					if (item.isResolved && this.expandDocsSettingFromStorage()) {
						const { documentation, detail } = item.completion;
						const docs = strings.format(
							'{0}{1}',
							detail || '',
							documentation ? (typeof documentation === 'string' ? documentation : documentation.value) : '');

						return nls.localize('ariaCurrenttSuggestionReadDetails', "Item {0}, docs: {1}", textLabel, docs);
					} else {
						return textLabel;
					}
				},
				getWidgetAriaLabel: () => nls.localize('suggest', "Suggest"),
				getWidgetRole: () => 'listbox'
			}
		});

		this.toDispose.add(attachListStyler(this.list, themeService, {
			listInactiveFocusBackground: editorSuggestWidgetSelectedBackground,
			listInactiveFocusOutline: activeContrastBorder
		}));
		this.toDispose.add(themeService.onDidColorThemeChange(t => this.onThemeChange(t)));
		this.toDispose.add(editor.onDidLayoutChange(() => this.onEditorLayoutChange()));
		this.toDispose.add(this.list.onMouseDown(e => this.onListMouseDownOrTap(e)));
		this.toDispose.add(this.list.onTap(e => this.onListMouseDownOrTap(e)));
		this.toDispose.add(this.list.onDidChangeSelection(e => this.onListSelection(e)));
		this.toDispose.add(this.list.onDidChangeFocus(e => this.onListFocus(e)));
		this.toDispose.add(this.editor.onDidChangeCursorSelection(() => this.onCursorSelectionChanged()));
		this.toDispose.add(this.editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.suggest)) {
				applyStatusBarStyle();
				applyIconStyle();
			}
		}));

		this.ctxSuggestWidgetVisible = SuggestContext.Visible.bindTo(contextKeyService);
		this.ctxSuggestWidgetDetailsVisible = SuggestContext.DetailsVisible.bindTo(contextKeyService);
		this.ctxSuggestWidgetMultipleSuggestions = SuggestContext.MultipleSuggestions.bindTo(contextKeyService);

		this.onThemeChange(themeService.getColorTheme());

		this.toDispose.add(addStandardDisposableListener(this.details.element, 'keydown', e => {
			this._onDetailsKeydown.fire(e);
		}));

		this.toDispose.add(this.editor.onMouseDown((e: IEditorMouseEvent) => this.onEditorMouseDown(e)));
	}

	private onEditorMouseDown(mouseEvent: IEditorMouseEvent): void {
		// Clicking inside details
		if (this.details.element.contains(mouseEvent.target.element)) {
			this.details.element.focus();
		}
		// Clicking outside details and inside suggest
		else {
			if (this.element.contains(mouseEvent.target.element)) {
				this.editor.focus();
			}
		}
	}

	private onCursorSelectionChanged(): void {
		if (this.state === State.Hidden) {
			return;
		}

		this.editor.layoutContentWidget(this);
	}

	private onEditorLayoutChange(): void {
		if ((this.state === State.Open || this.state === State.Details) && this.expandDocsSettingFromStorage()) {
			this.expandSideOrBelow();
		}
	}

	private onListMouseDownOrTap(e: IListMouseEvent<CompletionItem> | IListGestureEvent<CompletionItem>): void {
		if (typeof e.element === 'undefined' || typeof e.index === 'undefined') {
			return;
		}

		// prevent stealing browser focus from the editor
		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		this.select(e.element, e.index);
	}

	private onListSelection(e: IListEvent<CompletionItem>): void {
		if (!e.elements.length) {
			return;
		}

		this.select(e.elements[0], e.indexes[0]);
	}

	private select(item: CompletionItem, index: number): void {
		const completionModel = this.completionModel;

		if (!completionModel) {
			return;
		}

		this.onDidSelectEmitter.fire({ item, index, model: completionModel });
		this.editor.focus();
	}

	private onThemeChange(theme: IColorTheme) {
		const backgroundColor = theme.getColor(editorSuggestWidgetBackground);
		if (backgroundColor) {
			this.listElement.style.backgroundColor = backgroundColor.toString();
			this.statusBarElement.style.backgroundColor = backgroundColor.toString();
			this.details.element.style.backgroundColor = backgroundColor.toString();
			this.messageElement.style.backgroundColor = backgroundColor.toString();
		}
		const borderColor = theme.getColor(editorSuggestWidgetBorder);
		if (borderColor) {
			this.listElement.style.borderColor = borderColor.toString();
			this.statusBarElement.style.borderColor = borderColor.toString();
			this.details.element.style.borderColor = borderColor.toString();
			this.messageElement.style.borderColor = borderColor.toString();
			this.detailsBorderColor = borderColor.toString();
		}
		const focusBorderColor = theme.getColor(focusBorder);
		if (focusBorderColor) {
			this.detailsFocusBorderColor = focusBorderColor.toString();
		}
		this.details.setBorderWidth(theme.type === 'hc' ? 2 : 1);
	}

	private onListFocus(e: IListEvent<CompletionItem>): void {
		if (this.ignoreFocusEvents) {
			return;
		}

		if (!e.elements.length) {
			if (this.currentSuggestionDetails) {
				this.currentSuggestionDetails.cancel();
				this.currentSuggestionDetails = null;
				this.focusedItem = null;
			}

			this.editor.setAriaOptions({ activeDescendant: undefined });
			return;
		}

		if (!this.completionModel) {
			return;
		}

		const item = e.elements[0];
		const index = e.indexes[0];

		this.firstFocusInCurrentList = !this.focusedItem;
		if (item !== this.focusedItem) {

			if (this.currentSuggestionDetails) {
				this.currentSuggestionDetails.cancel();
				this.currentSuggestionDetails = null;
			}

			this.focusedItem = item;

			this.list.reveal(index);

			this.currentSuggestionDetails = createCancelablePromise(async token => {
				const loading = disposableTimeout(() => this.showDetails(true), 250);
				token.onCancellationRequested(() => loading.dispose());
				const result = await item.resolve(token);
				loading.dispose();
				return result;
			});

			this.currentSuggestionDetails.then(() => {
				if (index >= this.list.length || item !== this.list.element(index)) {
					return;
				}

				// item can have extra information, so re-render
				this.ignoreFocusEvents = true;
				this.list.splice(index, 1, [item]);
				this.list.setFocus([index]);
				this.ignoreFocusEvents = false;

				if (this.expandDocsSettingFromStorage()) {
					this.showDetails(false);
				} else {
					this.element.classList.remove('docs-side');
				}

				this.editor.setAriaOptions({ activeDescendant: getAriaId(index) });
			}).catch(onUnexpectedError);
		}

		// emit an event
		this.onDidFocusEmitter.fire({ item, index, model: this.completionModel });
	}

	private setState(state: State): void {
		if (!this.element) {
			return;
		}

		if (!this.isAddedAsContentWidget && state !== State.Hidden) {
			this.isAddedAsContentWidget = true;
			this.editor.addContentWidget(this);
		}

		const stateChanged = this.state !== state;
		this.state = state;

		this.element.classList.toggle('frozen', state === State.Frozen);

		switch (state) {
			case State.Hidden:
				hide(this.messageElement, this.details.element, this.listElement, this.statusBarElement);
				this.hide();
				this.listHeight = 0;
				if (stateChanged) {
					this.list.splice(0, this.list.length);
				}
				this.focusedItem = null;
				break;
			case State.Loading:
				this.messageElement.textContent = SuggestWidget.LOADING_MESSAGE;
				hide(this.listElement, this.details.element, this.statusBarElement);
				show(this.messageElement);
				this.element.classList.remove('docs-side');
				this.show();
				this.focusedItem = null;
				break;
			case State.Empty:
				this.messageElement.textContent = SuggestWidget.NO_SUGGESTIONS_MESSAGE;
				hide(this.listElement, this.details.element, this.statusBarElement);
				show(this.messageElement);
				this.element.classList.remove('docs-side');
				this.show();
				this.focusedItem = null;
				break;
			case State.Open:
				hide(this.messageElement);
				show(this.listElement, this.statusBarElement);
				this.show();
				break;
			case State.Frozen:
				hide(this.messageElement);
				show(this.listElement);
				this.show();
				break;
			case State.Details:
				hide(this.messageElement);
				show(this.details.element, this.listElement, this.statusBarElement);
				this.show();
				break;
		}
	}

	showTriggered(auto: boolean, delay: number) {
		if (this.state !== State.Hidden) {
			return;
		}

		this.isAuto = !!auto;

		if (!this.isAuto) {
			this.loadingTimeout = disposableTimeout(() => this.setState(State.Loading), delay);
		}
	}

	showSuggestions(completionModel: CompletionModel, selectionIndex: number, isFrozen: boolean, isAuto: boolean): void {
		this.preferDocPositionTop = false;
		this.docsPositionPreviousWidgetY = null;

		this.loadingTimeout.dispose();

		if (this.currentSuggestionDetails) {
			this.currentSuggestionDetails.cancel();
			this.currentSuggestionDetails = null;
		}

		if (this.completionModel !== completionModel) {
			this.completionModel = completionModel;
		}

		if (isFrozen && this.state !== State.Empty && this.state !== State.Hidden) {
			this.setState(State.Frozen);
			return;
		}

		let visibleCount = this.completionModel.items.length;

		const isEmpty = visibleCount === 0;
		this.ctxSuggestWidgetMultipleSuggestions.set(visibleCount > 1);

		if (isEmpty) {
			if (isAuto) {
				this.setState(State.Hidden);
			} else {
				this.setState(State.Empty);
			}

			this.completionModel = null;

		} else {

			if (this.state !== State.Open) {
				const { stats } = this.completionModel;
				stats['wasAutomaticallyTriggered'] = !!isAuto;
				/* __GDPR__
					"suggestWidget" : {
						"wasAutomaticallyTriggered" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
						"${include}": [
							"${ICompletionStats}"
						]
					}
				*/
				this.telemetryService.publicLog('suggestWidget', { ...stats });
			}

			this.focusedItem = null;
			this.list.splice(0, this.list.length, this.completionModel.items);

			if (isFrozen) {
				this.setState(State.Frozen);
			} else {
				this.setState(State.Open);
			}

			this.list.reveal(selectionIndex, 0);
			this.list.setFocus([selectionIndex]);

			// Reset focus border
			if (this.detailsBorderColor) {
				this.details.element.style.borderColor = this.detailsBorderColor;
			}
		}
	}

	selectNextPage(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Details:
				this.details.pageDown();
				return true;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusNextPage();
				return true;
		}
	}

	selectNext(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusNext(1, true);
				return true;
		}
	}

	selectLast(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Details:
				this.details.scrollBottom();
				return true;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusLast();
				return true;
		}
	}

	selectPreviousPage(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Details:
				this.details.pageUp();
				return true;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusPreviousPage();
				return true;
		}
	}

	selectPrevious(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusPrevious(1, true);
				return false;
		}
	}

	selectFirst(): boolean {
		switch (this.state) {
			case State.Hidden:
				return false;
			case State.Details:
				this.details.scrollTop();
				return true;
			case State.Loading:
				return !this.isAuto;
			default:
				this.list.focusFirst();
				return true;
		}
	}

	getFocusedItem(): ISelectedSuggestion | undefined {
		if (this.state !== State.Hidden
			&& this.state !== State.Empty
			&& this.state !== State.Loading
			&& this.completionModel
		) {

			return {
				item: this.list.getFocusedElements()[0],
				index: this.list.getFocus()[0],
				model: this.completionModel
			};
		}
		return undefined;
	}

	toggleDetailsFocus(): void {
		if (this.state === State.Details) {
			this.setState(State.Open);
			if (this.detailsBorderColor) {
				this.details.element.style.borderColor = this.detailsBorderColor;
			}
		} else if (this.state === State.Open && this.expandDocsSettingFromStorage()) {
			this.setState(State.Details);
			if (this.detailsFocusBorderColor) {
				this.details.element.style.borderColor = this.detailsFocusBorderColor;
			}
		}
		this.telemetryService.publicLog2('suggestWidget:toggleDetailsFocus');
	}

	toggleDetails(): void {
		if (!canExpandCompletionItem(this.list.getFocusedElements()[0])) {
			return;
		}

		if (this.expandDocsSettingFromStorage()) {
			this.ctxSuggestWidgetDetailsVisible.set(false);
			this.updateExpandDocsSetting(false);
			hide(this.details.element);
			this.element.classList.remove('docs-side', 'doc-below');
			this.editor.layoutContentWidget(this);
			this.telemetryService.publicLog2('suggestWidget:collapseDetails');
		} else {
			if (this.state !== State.Open && this.state !== State.Details && this.state !== State.Frozen) {
				return;
			}

			this.ctxSuggestWidgetDetailsVisible.set(true);
			this.updateExpandDocsSetting(true);
			this.showDetails(false);
			this.telemetryService.publicLog2('suggestWidget:expandDetails');
		}
	}

	showDetails(loading: boolean): void {
		if (!loading) {
			// When loading, don't re-layout docs, as item is not resolved yet #88731
			this.expandSideOrBelow();
		}

		show(this.details.element);

		this.details.element.style.maxHeight = this.maxWidgetHeight + 'px';

		if (loading) {
			this.details.renderLoading();
		} else {
			this.details.renderItem(this.list.getFocusedElements()[0], this.explainMode);
		}

		// Reset margin-top that was set as Fix for #26416
		this.listElement.style.marginTop = '0px';

		// with docs showing up widget width/height may change, so reposition the widget
		this.editor.layoutContentWidget(this);

		this.adjustDocsPosition();

		this.editor.focus();
	}

	toggleExplainMode(): void {
		if (this.list.getFocusedElements()[0] && this.expandDocsSettingFromStorage()) {
			this.explainMode = !this.explainMode;
			this.showDetails(false);
		}
	}

	private show(): void {
		const newHeight = this.updateListHeight();
		if (newHeight !== this.listHeight) {
			this.editor.layoutContentWidget(this);
			this.listHeight = newHeight;
		}

		this.ctxSuggestWidgetVisible.set(true);

		this.showTimeout.cancelAndSet(() => {
			this.element.classList.add('visible');
			this.onDidShowEmitter.fire(this);
		}, 100);
	}

	private hide(): void {
		this.ctxSuggestWidgetVisible.reset();
		this.ctxSuggestWidgetMultipleSuggestions.reset();
		this.element.classList.remove('visible');
	}

	hideWidget(): void {
		this.loadingTimeout.dispose();
		this.setState(State.Hidden);
		this.onDidHideEmitter.fire(this);
	}

	getPosition(): IContentWidgetPosition | null {
		if (this.state === State.Hidden) {
			return null;
		}

		let preference = [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE];
		if (this.preferDocPositionTop) {
			preference = [ContentWidgetPositionPreference.ABOVE];
		}

		return {
			position: this.editor.getPosition(),
			preference: preference
		};
	}

	getDomNode(): HTMLElement {
		return this.element;
	}

	getId(): string {
		return SuggestWidget.ID;
	}

	isFrozen(): boolean {
		return this.state === State.Frozen;
	}

	private updateListHeight(): number {
		let height = 0;

		if (this.state === State.Empty || this.state === State.Loading) {
			height = this.unfocusedHeight;
		} else {
			const suggestionCount = this.list.contentHeight / this.unfocusedHeight;
			const { maxVisibleSuggestions } = this.editor.getOption(EditorOption.suggest);
			height = Math.min(suggestionCount, maxVisibleSuggestions) * this.unfocusedHeight;
		}

		this.element.style.lineHeight = `${this.unfocusedHeight}px`;
		this.listElement.style.height = `${height}px`;
		this.statusBarElement.style.top = `${height}px`;
		this.list.layout(height);
		return height;
	}

	/**
	 * Adds the propert classes, margins when positioning the docs to the side
	 */
	private adjustDocsPosition() {
		if (!this.editor.hasModel()) {
			return;
		}

		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const cursorCoords = this.editor.getScrolledVisiblePosition(this.editor.getPosition());
		const editorCoords = getDomNodePagePosition(this.editor.getDomNode());
		const cursorX = editorCoords.left + cursorCoords.left;
		const cursorY = editorCoords.top + cursorCoords.top + cursorCoords.height;
		const widgetCoords = getDomNodePagePosition(this.element);
		const widgetX = widgetCoords.left;
		const widgetY = widgetCoords.top;

		// Fixes #27649
		// Check if the Y changed to the top of the cursor and keep the widget flagged to prefer top
		if (this.docsPositionPreviousWidgetY &&
			this.docsPositionPreviousWidgetY < widgetY &&
			!this.preferDocPositionTop) {
			this.preferDocPositionTop = true;
			this.adjustDocsPosition();
			return;
		}
		this.docsPositionPreviousWidgetY = widgetY;

		if (widgetX < cursorX - this.listWidth) {
			// Widget is too far to the left of cursor, swap list and docs
			this.element.classList.add('list-right');
		} else {
			this.element.classList.remove('list-right');
		}

		// Compare top of the cursor (cursorY - lineheight) with widgetTop to determine if
		// margin-top needs to be applied on list to make it appear right above the cursor
		// Cannot compare cursorY directly as it may be a few decimals off due to zoooming
		if (this.element.classList.contains('docs-side')
			&& cursorY - lineHeight > widgetY
			&& this.details.element.offsetHeight > this.listElement.offsetHeight) {

			// Fix for #26416
			// Docs is bigger than list and widget is above cursor, apply margin-top so that list appears right above cursor
			this.listElement.style.marginTop = `${this.details.element.offsetHeight - this.listElement.offsetHeight}px`;
		}
	}

	/**
	 * Adds the proper classes for positioning the docs to the side or below depending on item
	 */
	private expandSideOrBelow() {
		if (!canExpandCompletionItem(this.focusedItem) && this.firstFocusInCurrentList) {
			this.element.classList.remove('docs-side', 'docs-below');
			return;
		}

		let matches = this.element.style.maxWidth!.match(/(\d+)px/);
		if (!matches || Number(matches[1]) < this.maxWidgetWidth) {
			this.element.classList.add('docs-below');
			this.element.classList.remove('docs-side');
		} else if (canExpandCompletionItem(this.focusedItem)) {
			this.element.classList.add('docs-side');
			this.element.classList.remove('docs-below');
		}
	}

	// Heights

	private get maxWidgetHeight(): number {
		return this.unfocusedHeight * this.editor.getOption(EditorOption.suggest).maxVisibleSuggestions;
	}

	private get unfocusedHeight(): number {
		const options = this.editor.getOptions();
		return options.get(EditorOption.suggestLineHeight) || options.get(EditorOption.fontInfo).lineHeight;
	}

	// IDelegate

	getHeight(element: CompletionItem): number {
		return this.unfocusedHeight;
	}

	getTemplateId(element: CompletionItem): string {
		return 'suggestion';
	}

	private expandDocsSettingFromStorage(): boolean {
		return this.storageService.getBoolean('expandSuggestionDocs', StorageScope.GLOBAL, expandSuggestionDocsByDefault);
	}

	private updateExpandDocsSetting(value: boolean) {
		this.storageService.store('expandSuggestionDocs', value, StorageScope.GLOBAL);
	}

	dispose(): void {
		this.details.dispose();
		this.list.dispose();
		this.toDispose.dispose();
		this.loadingTimeout.dispose();
		this.showTimeout.dispose();
		this.editor.removeContentWidget(this);
	}
}

registerThemingParticipant((theme, collector) => {
	const matchHighlight = theme.getColor(editorSuggestWidgetHighlightForeground);
	if (matchHighlight) {
		collector.addRule(`.monaco-editor .suggest-widget .monaco-list .monaco-list-row .monaco-highlighted-label .highlight { color: ${matchHighlight}; }`);
	}
	const foreground = theme.getColor(editorSuggestWidgetForeground);
	if (foreground) {
		collector.addRule(`.monaco-editor .suggest-widget { color: ${foreground}; }`);
	}

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-editor .suggest-widget a { color: ${link}; }`);
	}

	const codeBackground = theme.getColor(textCodeBlockBackground);
	if (codeBackground) {
		collector.addRule(`.monaco-editor .suggest-widget code { background-color: ${codeBackground}; }`);
	}
});
