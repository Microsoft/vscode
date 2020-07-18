/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IIdentityProvider, IKeyboardNavigationLabelProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IDataSource, ITreeNode, ITreeRenderer, ITreeSorter, ITreeFilter } from 'vs/base/browser/ui/tree/tree';
import { createMatches, FuzzyScore } from 'vs/base/common/filters';
import 'vs/css!./media/outlineTree';
import 'vs/css!./media/symbol-icons';
import { Range } from 'vs/editor/common/core/range';
import { SymbolKind, SymbolKinds, SymbolTag } from 'vs/editor/common/modes';
import { OutlineElement, OutlineGroup, OutlineModel } from 'vs/editor/contrib/documentSymbols/outlineModel';
import { localize } from 'vs/nls';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { OutlineConfigKeys } from 'vs/editor/contrib/documentSymbols/outline';
import { MarkerSeverity } from 'vs/platform/markers/common/markers';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { registerColor, listErrorForeground, listWarningForeground, foreground } from 'vs/platform/theme/common/colorRegistry';
import { IdleValue } from 'vs/base/common/async';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { URI } from 'vs/base/common/uri';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { Iterable } from 'vs/base/common/iterator';
import { Codicon } from 'vs/base/common/codicons';

export type OutlineItem = OutlineGroup | OutlineElement;

export class OutlineNavigationLabelProvider implements IKeyboardNavigationLabelProvider<OutlineItem> {

	getKeyboardNavigationLabel(element: OutlineItem): { toString(): string; } {
		if (element instanceof OutlineGroup) {
			return element.label;
		} else {
			return element.symbol.name;
		}
	}
}

export class OutlineAccessibilityProvider implements IListAccessibilityProvider<OutlineItem> {

	constructor(private readonly ariaLabel: string) { }

	getWidgetAriaLabel(): string {
		return this.ariaLabel;
	}

	getAriaLabel(element: OutlineItem): string | null {
		if (element instanceof OutlineGroup) {
			return element.label;
		} else {
			return element.symbol.name;
		}
	}
}

export class OutlineIdentityProvider implements IIdentityProvider<OutlineItem> {
	getId(element: OutlineItem): { toString(): string; } {
		return element.id;
	}
}

export class OutlineGroupTemplate {
	static readonly id = 'OutlineGroupTemplate';
	constructor(
		readonly labelContainer: HTMLElement,
		readonly label: HighlightedLabel,
	) { }
}

export class OutlineElementTemplate {
	static readonly id = 'OutlineElementTemplate';
	constructor(
		readonly container: HTMLElement,
		readonly iconLabel: IconLabel,
		readonly iconClass: HTMLElement,
		readonly decoration: HTMLElement,
	) { }
}

export class OutlineVirtualDelegate implements IListVirtualDelegate<OutlineItem> {

	getHeight(_element: OutlineItem): number {
		return 22;
	}

	getTemplateId(element: OutlineItem): string {
		if (element instanceof OutlineGroup) {
			return OutlineGroupTemplate.id;
		} else {
			return OutlineElementTemplate.id;
		}
	}
}

export class OutlineGroupRenderer implements ITreeRenderer<OutlineGroup, FuzzyScore, OutlineGroupTemplate> {

	readonly templateId: string = OutlineGroupTemplate.id;

	renderTemplate(container: HTMLElement): OutlineGroupTemplate {
		const labelContainer = dom.$('.outline-element-label');
		container.classList.add('outline-element');
		dom.append(container, labelContainer);
		return new OutlineGroupTemplate(labelContainer, new HighlightedLabel(labelContainer, true));
	}

	renderElement(node: ITreeNode<OutlineGroup, FuzzyScore>, index: number, template: OutlineGroupTemplate): void {
		template.label.set(
			node.element.label,
			createMatches(node.filterData)
		);
	}

	disposeTemplate(_template: OutlineGroupTemplate): void {
		// nothing
	}
}

export class OutlineElementRenderer implements ITreeRenderer<OutlineElement, FuzzyScore, OutlineElementTemplate> {

	readonly templateId: string = OutlineElementTemplate.id;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IThemeService private readonly _themeService: IThemeService,
	) { }

	renderTemplate(container: HTMLElement): OutlineElementTemplate {
		container.classList.add('outline-element');
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		const iconClass = dom.$('.outline-element-icon');
		const decoration = dom.$('.outline-element-decoration');
		container.prepend(iconClass);
		container.appendChild(decoration);
		return new OutlineElementTemplate(container, iconLabel, iconClass, decoration);
	}

	renderElement(node: ITreeNode<OutlineElement, FuzzyScore>, index: number, template: OutlineElementTemplate): void {
		const { element } = node;
		const options = {
			matches: createMatches(node.filterData),
			labelEscapeNewLines: true,
			extraClasses: <string[]>[],
			title: localize('title.template', "{0} ({1})", element.symbol.name, OutlineElementRenderer._symbolKindNames[element.symbol.kind])
		};
		if (this._configurationService.getValue(OutlineConfigKeys.icons)) {
			// add styles for the icons
			template.iconClass.className = '';
			dom.addClasses(template.iconClass, `outline-element-icon ${SymbolKinds.toCssClassName(element.symbol.kind, true)}`);
		}
		if (element.symbol.tags.indexOf(SymbolTag.Deprecated) >= 0) {
			options.extraClasses.push(`deprecated`);
			options.matches = [];
		}
		template.iconLabel.setLabel(element.symbol.name, element.symbol.detail, options);
		this._renderMarkerInfo(element, template);
	}

	private _renderMarkerInfo(element: OutlineElement, template: OutlineElementTemplate): void {

		if (!element.marker) {
			dom.hide(template.decoration);
			template.container.style.removeProperty('--outline-element-color');
			return;
		}

		const { count, topSev } = element.marker;
		const color = this._themeService.getColorTheme().getColor(topSev === MarkerSeverity.Error ? listErrorForeground : listWarningForeground);
		const cssColor = color ? color.toString() : 'inherit';

		// color of the label
		if (this._configurationService.getValue(OutlineConfigKeys.problemsColors)) {
			template.container.style.setProperty('--outline-element-color', cssColor);
		} else {
			template.container.style.removeProperty('--outline-element-color');
		}

		// badge with color/rollup
		if (!this._configurationService.getValue(OutlineConfigKeys.problemsBadges)) {
			dom.hide(template.decoration);

		} else if (count > 0) {
			dom.show(template.decoration);
			template.decoration.classList.remove('bubble');
			template.decoration.innerText = count < 10 ? count.toString() : '+9';
			template.decoration.title = count === 1 ? localize('1.problem', "1 problem in this element") : localize('N.problem', "{0} problems in this element", count);
			template.decoration.style.setProperty('--outline-element-color', cssColor);

		} else {
			dom.show(template.decoration);
			template.decoration.classList.add('bubble');
			template.decoration.innerText = '\uea71';
			template.decoration.title = localize('deep.problem', "Contains elements with problems");
			template.decoration.style.setProperty('--outline-element-color', cssColor);
		}
	}

	private static _symbolKindNames: { [symbol: number]: string } = {
		[SymbolKind.Array]: localize('Array', "array"),
		[SymbolKind.Boolean]: localize('Boolean', "boolean"),
		[SymbolKind.Class]: localize('Class', "class"),
		[SymbolKind.Constant]: localize('Constant', "constant"),
		[SymbolKind.Constructor]: localize('Constructor', "constructor"),
		[SymbolKind.Enum]: localize('Enum', "enumeration"),
		[SymbolKind.EnumMember]: localize('EnumMember', "enumeration member"),
		[SymbolKind.Event]: localize('Event', "event"),
		[SymbolKind.Field]: localize('Field', "field"),
		[SymbolKind.File]: localize('File', "file"),
		[SymbolKind.Function]: localize('Function', "function"),
		[SymbolKind.Interface]: localize('Interface', "interface"),
		[SymbolKind.Key]: localize('Key', "key"),
		[SymbolKind.Method]: localize('Method', "method"),
		[SymbolKind.Module]: localize('Module', "module"),
		[SymbolKind.Namespace]: localize('Namespace', "namespace"),
		[SymbolKind.Null]: localize('Null', "null"),
		[SymbolKind.Number]: localize('Number', "number"),
		[SymbolKind.Object]: localize('Object', "object"),
		[SymbolKind.Operator]: localize('Operator', "operator"),
		[SymbolKind.Package]: localize('Package', "package"),
		[SymbolKind.Property]: localize('Property', "property"),
		[SymbolKind.String]: localize('String', "string"),
		[SymbolKind.Struct]: localize('Struct', "struct"),
		[SymbolKind.TypeParameter]: localize('TypeParameter', "type parameter"),
		[SymbolKind.Variable]: localize('Variable', "variable"),
	};

	disposeTemplate(_template: OutlineElementTemplate): void {
		_template.iconLabel.dispose();
	}
}

export const enum OutlineSortOrder {
	ByPosition,
	ByName,
	ByKind
}

export class OutlineFilter implements ITreeFilter<OutlineItem> {

	static readonly configNameToKind = Object.freeze({
		['showFiles']: SymbolKind.File,
		['showModules']: SymbolKind.Module,
		['showNamespaces']: SymbolKind.Namespace,
		['showPackages']: SymbolKind.Package,
		['showClasses']: SymbolKind.Class,
		['showMethods']: SymbolKind.Method,
		['showProperties']: SymbolKind.Property,
		['showFields']: SymbolKind.Field,
		['showConstructors']: SymbolKind.Constructor,
		['showEnums']: SymbolKind.Enum,
		['showInterfaces']: SymbolKind.Interface,
		['showFunctions']: SymbolKind.Function,
		['showVariables']: SymbolKind.Variable,
		['showConstants']: SymbolKind.Constant,
		['showStrings']: SymbolKind.String,
		['showNumbers']: SymbolKind.Number,
		['showBooleans']: SymbolKind.Boolean,
		['showArrays']: SymbolKind.Array,
		['showObjects']: SymbolKind.Object,
		['showKeys']: SymbolKind.Key,
		['showNull']: SymbolKind.Null,
		['showEnumMembers']: SymbolKind.EnumMember,
		['showStructs']: SymbolKind.Struct,
		['showEvents']: SymbolKind.Event,
		['showOperators']: SymbolKind.Operator,
		['showTypeParameters']: SymbolKind.TypeParameter,
	});

	static readonly kindToConfigName = Object.freeze({
		[SymbolKind.File]: 'showFiles',
		[SymbolKind.Module]: 'showModules',
		[SymbolKind.Namespace]: 'showNamespaces',
		[SymbolKind.Package]: 'showPackages',
		[SymbolKind.Class]: 'showClasses',
		[SymbolKind.Method]: 'showMethods',
		[SymbolKind.Property]: 'showProperties',
		[SymbolKind.Field]: 'showFields',
		[SymbolKind.Constructor]: 'showConstructors',
		[SymbolKind.Enum]: 'showEnums',
		[SymbolKind.Interface]: 'showInterfaces',
		[SymbolKind.Function]: 'showFunctions',
		[SymbolKind.Variable]: 'showVariables',
		[SymbolKind.Constant]: 'showConstants',
		[SymbolKind.String]: 'showStrings',
		[SymbolKind.Number]: 'showNumbers',
		[SymbolKind.Boolean]: 'showBooleans',
		[SymbolKind.Array]: 'showArrays',
		[SymbolKind.Object]: 'showObjects',
		[SymbolKind.Key]: 'showKeys',
		[SymbolKind.Null]: 'showNull',
		[SymbolKind.EnumMember]: 'showEnumMembers',
		[SymbolKind.Struct]: 'showStructs',
		[SymbolKind.Event]: 'showEvents',
		[SymbolKind.Operator]: 'showOperators',
		[SymbolKind.TypeParameter]: 'showTypeParameters',
	});

	constructor(
		private readonly _prefix: string,
		@ITextResourceConfigurationService private readonly _textResourceConfigService: ITextResourceConfigurationService,
	) { }

	filter(element: OutlineItem): boolean {
		const outline = OutlineModel.get(element);
		let uri: URI | undefined;

		if (outline) {
			uri = outline.uri;
		}

		if (!(element instanceof OutlineElement)) {
			return true;
		}

		const configName = OutlineFilter.kindToConfigName[element.symbol.kind];
		const configKey = `${this._prefix}.${configName}`;
		return this._textResourceConfigService.getValue(uri, configKey);
	}
}

export class OutlineItemComparator implements ITreeSorter<OutlineItem> {

	private readonly _collator = new IdleValue<Intl.Collator>(() => new Intl.Collator(undefined, { numeric: true }));

	constructor(
		public type: OutlineSortOrder = OutlineSortOrder.ByPosition
	) { }

	compare(a: OutlineItem, b: OutlineItem): number {
		if (a instanceof OutlineGroup && b instanceof OutlineGroup) {
			return a.order - b.order;

		} else if (a instanceof OutlineElement && b instanceof OutlineElement) {
			if (this.type === OutlineSortOrder.ByKind) {
				return a.symbol.kind - b.symbol.kind || this._collator.value.compare(a.symbol.name, b.symbol.name);
			} else if (this.type === OutlineSortOrder.ByName) {
				return this._collator.value.compare(a.symbol.name, b.symbol.name) || Range.compareRangesUsingStarts(a.symbol.range, b.symbol.range);
			} else if (this.type === OutlineSortOrder.ByPosition) {
				return Range.compareRangesUsingStarts(a.symbol.range, b.symbol.range) || this._collator.value.compare(a.symbol.name, b.symbol.name);
			}
		}
		return 0;
	}
}

export class OutlineDataSource implements IDataSource<OutlineModel, OutlineItem> {

	getChildren(element: undefined | OutlineModel | OutlineGroup | OutlineElement) {
		if (!element) {
			return Iterable.empty();
		}
		return element.children.values();
	}
}

export const SYMBOL_ICON_ARRAY_FOREGROUND = registerColor('symbolIcon.arrayForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.arrayForeground', 'The foreground color for array symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_BOOLEAN_FOREGROUND = registerColor('symbolIcon.booleanForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.booleanForeground', 'The foreground color for boolean symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_CLASS_FOREGROUND = registerColor('symbolIcon.classForeground', {
	dark: '#EE9D28',
	light: '#D67E00',
	hc: '#EE9D28'
}, localize('symbolIcon.classForeground', 'The foreground color for class symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_COLOR_FOREGROUND = registerColor('symbolIcon.colorForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.colorForeground', 'The foreground color for color symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_CONSTANT_FOREGROUND = registerColor('symbolIcon.constantForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.constantForeground', 'The foreground color for constant symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_CONSTRUCTOR_FOREGROUND = registerColor('symbolIcon.constructorForeground', {
	dark: '#B180D7',
	light: '#652D90',
	hc: '#B180D7'
}, localize('symbolIcon.constructorForeground', 'The foreground color for constructor symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_ENUMERATOR_FOREGROUND = registerColor('symbolIcon.enumeratorForeground', {
	dark: '#EE9D28',
	light: '#D67E00',
	hc: '#EE9D28'
}, localize('symbolIcon.enumeratorForeground', 'The foreground color for enumerator symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_ENUMERATOR_MEMBER_FOREGROUND = registerColor('symbolIcon.enumeratorMemberForeground', {
	dark: '#75BEFF',
	light: '#007ACC',
	hc: '#75BEFF'
}, localize('symbolIcon.enumeratorMemberForeground', 'The foreground color for enumerator member symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_EVENT_FOREGROUND = registerColor('symbolIcon.eventForeground', {
	dark: '#EE9D28',
	light: '#D67E00',
	hc: '#EE9D28'
}, localize('symbolIcon.eventForeground', 'The foreground color for event symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_FIELD_FOREGROUND = registerColor('symbolIcon.fieldForeground', {
	dark: '#75BEFF',
	light: '#007ACC',
	hc: '#75BEFF'
}, localize('symbolIcon.fieldForeground', 'The foreground color for field symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_FILE_FOREGROUND = registerColor('symbolIcon.fileForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.fileForeground', 'The foreground color for file symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_FOLDER_FOREGROUND = registerColor('symbolIcon.folderForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.folderForeground', 'The foreground color for folder symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_FUNCTION_FOREGROUND = registerColor('symbolIcon.functionForeground', {
	dark: '#B180D7',
	light: '#652D90',
	hc: '#B180D7'
}, localize('symbolIcon.functionForeground', 'The foreground color for function symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_INTERFACE_FOREGROUND = registerColor('symbolIcon.interfaceForeground', {
	dark: '#75BEFF',
	light: '#007ACC',
	hc: '#75BEFF'
}, localize('symbolIcon.interfaceForeground', 'The foreground color for interface symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_KEY_FOREGROUND = registerColor('symbolIcon.keyForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.keyForeground', 'The foreground color for key symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_KEYWORD_FOREGROUND = registerColor('symbolIcon.keywordForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.keywordForeground', 'The foreground color for keyword symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_METHOD_FOREGROUND = registerColor('symbolIcon.methodForeground', {
	dark: '#B180D7',
	light: '#652D90',
	hc: '#B180D7'
}, localize('symbolIcon.methodForeground', 'The foreground color for method symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_MODULE_FOREGROUND = registerColor('symbolIcon.moduleForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.moduleForeground', 'The foreground color for module symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_NAMESPACE_FOREGROUND = registerColor('symbolIcon.namespaceForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.namespaceForeground', 'The foreground color for namespace symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_NULL_FOREGROUND = registerColor('symbolIcon.nullForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.nullForeground', 'The foreground color for null symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_NUMBER_FOREGROUND = registerColor('symbolIcon.numberForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.numberForeground', 'The foreground color for number symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_OBJECT_FOREGROUND = registerColor('symbolIcon.objectForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.objectForeground', 'The foreground color for object symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_OPERATOR_FOREGROUND = registerColor('symbolIcon.operatorForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.operatorForeground', 'The foreground color for operator symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_PACKAGE_FOREGROUND = registerColor('symbolIcon.packageForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.packageForeground', 'The foreground color for package symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_PROPERTY_FOREGROUND = registerColor('symbolIcon.propertyForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.propertyForeground', 'The foreground color for property symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_REFERENCE_FOREGROUND = registerColor('symbolIcon.referenceForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.referenceForeground', 'The foreground color for reference symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_SNIPPET_FOREGROUND = registerColor('symbolIcon.snippetForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.snippetForeground', 'The foreground color for snippet symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_STRING_FOREGROUND = registerColor('symbolIcon.stringForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.stringForeground', 'The foreground color for string symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_STRUCT_FOREGROUND = registerColor('symbolIcon.structForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.structForeground', 'The foreground color for struct symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_TEXT_FOREGROUND = registerColor('symbolIcon.textForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.textForeground', 'The foreground color for text symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_TYPEPARAMETER_FOREGROUND = registerColor('symbolIcon.typeParameterForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.typeParameterForeground', 'The foreground color for type parameter symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_UNIT_FOREGROUND = registerColor('symbolIcon.unitForeground', {
	dark: foreground,
	light: foreground,
	hc: foreground
}, localize('symbolIcon.unitForeground', 'The foreground color for unit symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

export const SYMBOL_ICON_VARIABLE_FOREGROUND = registerColor('symbolIcon.variableForeground', {
	dark: '#75BEFF',
	light: '#007ACC',
	hc: '#75BEFF'
}, localize('symbolIcon.variableForeground', 'The foreground color for variable symbols. These symbols appear in the outline, breadcrumb, and suggest widget.'));

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	const symbolIconArrayColor = theme.getColor(SYMBOL_ICON_ARRAY_FOREGROUND);
	if (symbolIconArrayColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolArray.cssSelector} { color: ${symbolIconArrayColor}; }`);
	}

	const symbolIconBooleanColor = theme.getColor(SYMBOL_ICON_BOOLEAN_FOREGROUND);
	if (symbolIconBooleanColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolBoolean.cssSelector} { color: ${symbolIconBooleanColor}; }`);
	}

	const symbolIconClassColor = theme.getColor(SYMBOL_ICON_CLASS_FOREGROUND);
	if (symbolIconClassColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolClass.cssSelector} { color: ${symbolIconClassColor}; }`);
	}

	const symbolIconMethodColor = theme.getColor(SYMBOL_ICON_METHOD_FOREGROUND);
	if (symbolIconMethodColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolMethod.cssSelector} { color: ${symbolIconMethodColor}; }`);
	}

	const symbolIconColorColor = theme.getColor(SYMBOL_ICON_COLOR_FOREGROUND);
	if (symbolIconColorColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolColor.cssSelector} { color: ${symbolIconColorColor}; }`);
	}

	const symbolIconConstantColor = theme.getColor(SYMBOL_ICON_CONSTANT_FOREGROUND);
	if (symbolIconConstantColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolConstant.cssSelector} { color: ${symbolIconConstantColor}; }`);
	}

	const symbolIconConstructorColor = theme.getColor(SYMBOL_ICON_CONSTRUCTOR_FOREGROUND);
	if (symbolIconConstructorColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolConstructor.cssSelector} { color: ${symbolIconConstructorColor}; }`);
	}

	const symbolIconEnumeratorColor = theme.getColor(SYMBOL_ICON_ENUMERATOR_FOREGROUND);
	if (symbolIconEnumeratorColor) {
		collector.addRule(`
			.monaco-workbench ${Codicon.symbolValue.cssSelector},.monaco-workbench ${Codicon.symbolEnum.cssSelector} { color: ${symbolIconEnumeratorColor}; }`);
	}

	const symbolIconEnumeratorMemberColor = theme.getColor(SYMBOL_ICON_ENUMERATOR_MEMBER_FOREGROUND);
	if (symbolIconEnumeratorMemberColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolEnumMember.cssSelector} { color: ${symbolIconEnumeratorMemberColor}; }`);
	}

	const symbolIconEventColor = theme.getColor(SYMBOL_ICON_EVENT_FOREGROUND);
	if (symbolIconEventColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolEvent.cssSelector} { color: ${symbolIconEventColor}; }`);
	}

	const symbolIconFieldColor = theme.getColor(SYMBOL_ICON_FIELD_FOREGROUND);
	if (symbolIconFieldColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolField.cssSelector} { color: ${symbolIconFieldColor}; }`);
	}

	const symbolIconFileColor = theme.getColor(SYMBOL_ICON_FILE_FOREGROUND);
	if (symbolIconFileColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolFile.cssSelector} { color: ${symbolIconFileColor}; }`);
	}

	const symbolIconFolderColor = theme.getColor(SYMBOL_ICON_FOLDER_FOREGROUND);
	if (symbolIconFolderColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolFolder.cssSelector} { color: ${symbolIconFolderColor}; }`);
	}

	const symbolIconFunctionColor = theme.getColor(SYMBOL_ICON_FUNCTION_FOREGROUND);
	if (symbolIconFunctionColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolFunction.cssSelector} { color: ${symbolIconFunctionColor}; }`);
	}

	const symbolIconInterfaceColor = theme.getColor(SYMBOL_ICON_INTERFACE_FOREGROUND);
	if (symbolIconInterfaceColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolInterface.cssSelector} { color: ${symbolIconInterfaceColor}; }`);
	}

	const symbolIconKeyColor = theme.getColor(SYMBOL_ICON_KEY_FOREGROUND);
	if (symbolIconKeyColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolKey.cssSelector} { color: ${symbolIconKeyColor}; }`);
	}

	const symbolIconKeywordColor = theme.getColor(SYMBOL_ICON_KEYWORD_FOREGROUND);
	if (symbolIconKeywordColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolKeyword.cssSelector} { color: ${symbolIconKeywordColor}; }`);
	}

	const symbolIconModuleColor = theme.getColor(SYMBOL_ICON_MODULE_FOREGROUND);
	if (symbolIconModuleColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolModule.cssSelector} { color: ${symbolIconModuleColor}; }`);
	}

	const outlineNamespaceColor = theme.getColor(SYMBOL_ICON_NAMESPACE_FOREGROUND);
	if (outlineNamespaceColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolNamespace.cssSelector} { color: ${outlineNamespaceColor}; }`);
	}

	const symbolIconNullColor = theme.getColor(SYMBOL_ICON_NULL_FOREGROUND);
	if (symbolIconNullColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolNull.cssSelector} { color: ${symbolIconNullColor}; }`);
	}

	const symbolIconNumberColor = theme.getColor(SYMBOL_ICON_NUMBER_FOREGROUND);
	if (symbolIconNumberColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolNumber.cssSelector} { color: ${symbolIconNumberColor}; }`);
	}

	const symbolIconObjectColor = theme.getColor(SYMBOL_ICON_OBJECT_FOREGROUND);
	if (symbolIconObjectColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolObject.cssSelector} { color: ${symbolIconObjectColor}; }`);
	}

	const symbolIconOperatorColor = theme.getColor(SYMBOL_ICON_OPERATOR_FOREGROUND);
	if (symbolIconOperatorColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolOperator.cssSelector} { color: ${symbolIconOperatorColor}; }`);
	}

	const symbolIconPackageColor = theme.getColor(SYMBOL_ICON_PACKAGE_FOREGROUND);
	if (symbolIconPackageColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolPackage.cssSelector} { color: ${symbolIconPackageColor}; }`);
	}

	const symbolIconPropertyColor = theme.getColor(SYMBOL_ICON_PROPERTY_FOREGROUND);
	if (symbolIconPropertyColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolProperty.cssSelector} { color: ${symbolIconPropertyColor}; }`);
	}

	const symbolIconReferenceColor = theme.getColor(SYMBOL_ICON_REFERENCE_FOREGROUND);
	if (symbolIconReferenceColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolReference.cssSelector} { color: ${symbolIconReferenceColor}; }`);
	}

	const symbolIconSnippetColor = theme.getColor(SYMBOL_ICON_SNIPPET_FOREGROUND);
	if (symbolIconSnippetColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolSnippet.cssSelector} { color: ${symbolIconSnippetColor}; }`);
	}

	const symbolIconStringColor = theme.getColor(SYMBOL_ICON_STRING_FOREGROUND);
	if (symbolIconStringColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolString.cssSelector} { color: ${symbolIconStringColor}; }`);
	}

	const symbolIconStructColor = theme.getColor(SYMBOL_ICON_STRUCT_FOREGROUND);
	if (symbolIconStructColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolStruct.cssSelector} { color: ${symbolIconStructColor}; }`);
	}

	const symbolIconTextColor = theme.getColor(SYMBOL_ICON_TEXT_FOREGROUND);
	if (symbolIconTextColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolText.cssSelector} { color: ${symbolIconTextColor}; }`);
	}

	const symbolIconTypeParameterColor = theme.getColor(SYMBOL_ICON_TYPEPARAMETER_FOREGROUND);
	if (symbolIconTypeParameterColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolTypeParameter.cssSelector} { color: ${symbolIconTypeParameterColor}; }`);
	}

	const symbolIconUnitColor = theme.getColor(SYMBOL_ICON_UNIT_FOREGROUND);
	if (symbolIconUnitColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolUnit.cssSelector} { color: ${symbolIconUnitColor}; }`);
	}

	const symbolIconVariableColor = theme.getColor(SYMBOL_ICON_VARIABLE_FOREGROUND);
	if (symbolIconVariableColor) {
		collector.addRule(`.monaco-workbench ${Codicon.symbolVariable.cssSelector} { color: ${symbolIconVariableColor}; }`);
	}

});
