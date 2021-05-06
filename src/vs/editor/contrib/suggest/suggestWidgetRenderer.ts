/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { createMatches } from 'vs/base/common/filters';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { append, $, hide, show } from 'vs/base/browser/dom';
import { IListRenderer } from 'vs/base/browser/ui/list/list';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CompletionItem } from './suggest';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CompletionItemKind, completionKindToCssClass, CompletionItemTag } from 'vs/editor/common/modes';
import { IconLabel, IIconLabelValueOptions } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { IModelService } from 'vs/editor/common/services/modelService';
import { URI } from 'vs/base/common/uri';
import { FileKind } from 'vs/platform/files/common/files';
import { flatten } from 'vs/base/common/arrays';
import { canExpandCompletionItem } from './suggestWidgetDetails';
import { Codicon } from 'vs/base/common/codicons';
import { Emitter, Event } from 'vs/base/common/event';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export function getAriaId(index: number): string {
	return `suggest-aria-id:${index}`;
}

export const suggestMoreInfoIcon = registerIcon('suggest-more-info', Codicon.chevronRight, nls.localize('suggestMoreInfoIcon', 'Icon for more information in the suggest widget.'));

const _completionItemColor = new class ColorExtractor {

	private static _regexRelaxed = /(#([\da-fA-F]{3}){1,2}|(rgb|hsl)a\(\s*(\d{1,3}%?\s*,\s*){3}(1|0?\.\d+)\)|(rgb|hsl)\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}\s*\))/;
	private static _regexStrict = new RegExp(`^${ColorExtractor._regexRelaxed.source}$`, 'i');

	extract(item: CompletionItem, out: string[]): boolean {
		if (item.textLabel.match(ColorExtractor._regexStrict)) {
			out[0] = item.textLabel;
			return true;
		}
		if (item.completion.detail && item.completion.detail.match(ColorExtractor._regexStrict)) {
			out[0] = item.completion.detail;
			return true;
		}
		if (typeof item.completion.documentation === 'string') {
			const match = ColorExtractor._regexRelaxed.exec(item.completion.documentation);
			if (match && (match.index === 0 || match.index + match[0].length === item.completion.documentation.length)) {
				out[0] = match[0];
				return true;
			}
		}
		return false;
	}
};


export interface ISuggestionTemplateData {
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

export class ItemRenderer implements IListRenderer<CompletionItem, ISuggestionTemplateData> {

	private readonly _onDidToggleDetails = new Emitter<void>();
	readonly onDidToggleDetails: Event<void> = this._onDidToggleDetails.event;

	readonly templateId = 'suggestion';

	constructor(
		private readonly _editor: ICodeEditor,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
		@IThemeService private readonly _themeService: IThemeService
	) { }

	dispose(): void {
		this._onDidToggleDetails.dispose();
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

		data.iconLabel = new IconLabel(data.left, { supportHighlights: true, supportIcons: true });
		data.disposables.add(data.iconLabel);

		data.parametersLabel = append(data.left, $('span.signature-label'));
		data.qualifierLabel = append(data.left, $('span.qualifier-label'));
		data.detailsLabel = append(data.right, $('span.details-label'));

		data.readMore = append(data.right, $('span.readMore' + ThemeIcon.asCSSSelector(suggestMoreInfoIcon)));
		data.readMore.title = nls.localize('readMore', "Read More");

		const configureFont = () => {
			const options = this._editor.getOptions();
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

		data.disposables.add(this._editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.fontInfo) || e.hasChanged(EditorOption.suggestFontSize) || e.hasChanged(EditorOption.suggestLineHeight)) {
				configureFont();
			}
		}));

		return data;
	}

	renderElement(element: CompletionItem, index: number, data: ISuggestionTemplateData): void {
		const { completion } = element;
		data.root.id = getAriaId(index);
		data.colorspan.style.backgroundColor = '';

		const labelOptions: IIconLabelValueOptions = {
			labelEscapeNewLines: true,
			matches: createMatches(element.score)
		};

		let color: string[] = [];
		if (completion.kind === CompletionItemKind.Color && _completionItemColor.extract(element, color)) {
			// special logic for 'color' completion items
			data.icon.className = 'icon customcolor';
			data.iconContainer.className = 'icon hide';
			data.colorspan.style.backgroundColor = color[0];

		} else if (completion.kind === CompletionItemKind.File && this._themeService.getFileIconTheme().hasFileIcons) {
			// special logic for 'file' completion items
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			const labelClasses = getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: element.textLabel }), FileKind.FILE);
			const detailClasses = getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: completion.detail }), FileKind.FILE);
			labelOptions.extraClasses = labelClasses.length > detailClasses.length ? labelClasses : detailClasses;

		} else if (completion.kind === CompletionItemKind.Folder && this._themeService.getFileIconTheme().hasFolderIcons) {
			// special logic for 'folder' completion items
			data.icon.className = 'icon hide';
			data.iconContainer.className = 'icon hide';
			labelOptions.extraClasses = flatten([
				getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: element.textLabel }), FileKind.FOLDER),
				getIconClasses(this._modelService, this._modeService, URI.from({ scheme: 'fake', path: completion.detail }), FileKind.FOLDER)
			]);
		} else {
			// normal icon
			data.icon.className = 'icon hide';
			data.iconContainer.className = '';
			data.iconContainer.classList.add('suggest-icon', ...completionKindToCssClass(completion.kind).split(' '));
		}

		if (completion.tags && completion.tags.indexOf(CompletionItemTag.Deprecated) >= 0) {
			labelOptions.extraClasses = (labelOptions.extraClasses || []).concat(['deprecated']);
			labelOptions.matches = [];
		}

		data.iconLabel.setLabel(element.textLabel, undefined, labelOptions);
		if (typeof completion.label === 'string') {
			data.parametersLabel.textContent = '';
			data.qualifierLabel.textContent = '';
			data.detailsLabel.textContent = stripNewLines(completion.detail || '');
			data.root.classList.add('string-label');
			data.root.title = '';
		} else {
			data.parametersLabel.textContent = stripNewLines(completion.label.parameters || '');
			data.qualifierLabel.textContent = stripNewLines(completion.label.qualifier || '');
			data.detailsLabel.textContent = stripNewLines(completion.label.type || '');
			data.root.classList.remove('string-label');
			data.root.title = `${element.textLabel}${completion.label.parameters ?? ''}  ${completion.label.qualifier ?? ''}  ${completion.label.type ?? ''}`;
		}

		if (this._editor.getOption(EditorOption.suggest).showInlineDetails) {
			show(data.detailsLabel);
		} else {
			hide(data.detailsLabel);
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
				this._onDidToggleDetails.fire();
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

function stripNewLines(str: string): string {
	return str.replace(/\r\n|\r|\n/g, '');
}
