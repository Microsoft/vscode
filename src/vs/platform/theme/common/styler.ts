/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { focusBorder, inputBackground, inputForeground, ColorIdentifier, selectForeground, selectBackground, selectListBackground, selectBorder, inputBorder, contrastBorder, inputActiveOptionBorder, inputActiveOptionBackground, inputActiveOptionForeground, listFocusBackground, listFocusForeground, listActiveSelectionBackground, listActiveSelectionForeground, listInactiveSelectionForeground, listInactiveSelectionBackground, listInactiveFocusBackground, listHoverBackground, listHoverForeground, listDropBackground, pickerGroupForeground, widgetShadow, inputValidationInfoBorder, inputValidationInfoBackground, inputValidationWarningBorder, inputValidationWarningBackground, inputValidationErrorBorder, inputValidationErrorBackground, activeContrastBorder, buttonForeground, buttonBackground, buttonHoverBackground, ColorFunction, badgeBackground, badgeForeground, progressBarBackground, breadcrumbsForeground, breadcrumbsFocusForeground, breadcrumbsActiveSelectionForeground, breadcrumbsBackground, editorWidgetBorder, inputValidationInfoForeground, inputValidationWarningForeground, inputValidationErrorForeground, menuForeground, menuBackground, menuSelectionForeground, menuSelectionBackground, menuSelectionBorder, menuBorder, menuSeparatorBackground, listFilterWidgetOutline, listFilterWidgetNoMatchesOutline, listFilterWidgetBackground, editorWidgetBackground, treeIndentGuidesStroke, editorWidgetForeground, simpleCheckboxBackground, simpleCheckboxBorder, simpleCheckboxForeground, ColorValue, resolveColorValue, textLinkForeground, problemsWarningIconForeground, problemsErrorIconForeground, problemsInfoIconForeground, buttonSecondaryBackground, buttonSecondaryForeground, buttonSecondaryHoverBackground, listFocusOutline, listInactiveFocusOutline, tableColumnsBorder, quickInputListFocusBackground, buttonBorder, keybindingLabelForeground, keybindingLabelBackground, keybindingLabelBorder, keybindingLabelBottomBorder, quickInputListFocusForeground } from 'vs/platform/theme/common/colorRegistry';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Color } from 'vs/base/common/color';
import { IThemable, styleFn } from 'vs/base/common/styler';
import { ColorScheme } from 'vs/platform/theme/common/theme';

export interface IStyleOverrides {
	[color: string]: ColorIdentifier | undefined;
}

export interface IColorMapping {
	[optionsKey: string]: ColorValue | undefined;
}

export interface IComputedStyles {
	[color: string]: Color | undefined;
}

export function computeStyles(theme: IColorTheme, styleMap: IColorMapping): IComputedStyles {
	const styles = Object.create(null) as IComputedStyles;
	for (let key in styleMap) {
		const value = styleMap[key];
		if (value) {
			styles[key] = resolveColorValue(value, theme);
		}
	}

	return styles;
}

export function attachStyler<T extends IColorMapping>(themeService: IThemeService, styleMap: T, widgetOrCallback: IThemable | styleFn): IDisposable {
	function applyStyles(theme: IColorTheme): void {
		const styles = computeStyles(themeService.getColorTheme(), styleMap);

		if (typeof widgetOrCallback === 'function') {
			widgetOrCallback(styles);
		} else {
			widgetOrCallback.style(styles);
		}
	}

	applyStyles(themeService.getColorTheme());

	return themeService.onDidColorThemeChange(applyStyles);
}

export interface ICheckboxStyleOverrides extends IStyleOverrides {
	inputActiveOptionBorderColor?: ColorIdentifier;
	inputActiveOptionForegroundColor?: ColorIdentifier;
	inputActiveOptionBackgroundColor?: ColorIdentifier;
}

export function attachCheckboxStyler(widget: IThemable, themeService: IThemeService, style?: ICheckboxStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		inputActiveOptionBorder: style?.inputActiveOptionBorderColor || inputActiveOptionBorder,
		inputActiveOptionForeground: style?.inputActiveOptionForegroundColor || inputActiveOptionForeground,
		inputActiveOptionBackground: style?.inputActiveOptionBackgroundColor || inputActiveOptionBackground
	} as ICheckboxStyleOverrides, widget);
}

export interface IBadgeStyleOverrides extends IStyleOverrides {
	badgeBackground?: ColorIdentifier;
	badgeForeground?: ColorIdentifier;
}

export function attachBadgeStyler(widget: IThemable, themeService: IThemeService, style?: IBadgeStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		badgeBackground: style?.badgeBackground || badgeBackground,
		badgeForeground: style?.badgeForeground || badgeForeground,
		badgeBorder: contrastBorder
	} as IBadgeStyleOverrides, widget);
}

export interface IInputBoxStyleOverrides extends IStyleOverrides {
	inputBackground?: ColorIdentifier;
	inputForeground?: ColorIdentifier;
	inputBorder?: ColorIdentifier;
	inputActiveOptionBorder?: ColorIdentifier;
	inputActiveOptionForeground?: ColorIdentifier;
	inputActiveOptionBackground?: ColorIdentifier;
	inputValidationInfoBorder?: ColorIdentifier;
	inputValidationInfoBackground?: ColorIdentifier;
	inputValidationInfoForeground?: ColorIdentifier;
	inputValidationWarningBorder?: ColorIdentifier;
	inputValidationWarningBackground?: ColorIdentifier;
	inputValidationWarningForeground?: ColorIdentifier;
	inputValidationErrorBorder?: ColorIdentifier;
	inputValidationErrorBackground?: ColorIdentifier;
	inputValidationErrorForeground?: ColorIdentifier;
}

export function attachInputBoxStyler(widget: IThemable, themeService: IThemeService, style?: IInputBoxStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		inputBackground: style?.inputBackground || inputBackground,
		inputForeground: style?.inputForeground || inputForeground,
		inputBorder: style?.inputBorder || inputBorder,
		inputValidationInfoBorder: style?.inputValidationInfoBorder || inputValidationInfoBorder,
		inputValidationInfoBackground: style?.inputValidationInfoBackground || inputValidationInfoBackground,
		inputValidationInfoForeground: style?.inputValidationInfoForeground || inputValidationInfoForeground,
		inputValidationWarningBorder: style?.inputValidationWarningBorder || inputValidationWarningBorder,
		inputValidationWarningBackground: style?.inputValidationWarningBackground || inputValidationWarningBackground,
		inputValidationWarningForeground: style?.inputValidationWarningForeground || inputValidationWarningForeground,
		inputValidationErrorBorder: style?.inputValidationErrorBorder || inputValidationErrorBorder,
		inputValidationErrorBackground: style?.inputValidationErrorBackground || inputValidationErrorBackground,
		inputValidationErrorForeground: style?.inputValidationErrorForeground || inputValidationErrorForeground
	} as IInputBoxStyleOverrides, widget);
}

export interface ISelectBoxStyleOverrides extends IStyleOverrides, IListStyleOverrides {
	selectBackground?: ColorIdentifier;
	selectListBackground?: ColorIdentifier;
	selectForeground?: ColorIdentifier;
	decoratorRightForeground?: ColorIdentifier;
	selectBorder?: ColorIdentifier;
	focusBorder?: ColorIdentifier;
}

export function attachSelectBoxStyler(widget: IThemable, themeService: IThemeService, style?: ISelectBoxStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		selectBackground: style?.selectBackground || selectBackground,
		selectListBackground: style?.selectListBackground || selectListBackground,
		selectForeground: style?.selectForeground || selectForeground,
		decoratorRightForeground: style?.pickerGroupForeground || pickerGroupForeground,
		selectBorder: style?.selectBorder || selectBorder,
		focusBorder: style?.focusBorder || focusBorder,
		listFocusBackground: style?.listFocusBackground || quickInputListFocusBackground,
		listFocusForeground: style?.listFocusForeground || quickInputListFocusForeground,
		listFocusOutline: style?.listFocusOutline || ((theme: IColorTheme) => theme.type === ColorScheme.HIGH_CONTRAST ? activeContrastBorder : Color.transparent),
		listHoverBackground: style?.listHoverBackground || listHoverBackground,
		listHoverForeground: style?.listHoverForeground || listHoverForeground,
		listHoverOutline: style?.listFocusOutline || activeContrastBorder,
		selectListBorder: style?.selectListBorder || editorWidgetBorder
	} as ISelectBoxStyleOverrides, widget);
}

export function attachFindReplaceInputBoxStyler(widget: IThemable, themeService: IThemeService, style?: IInputBoxStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		inputBackground: style?.inputBackground || inputBackground,
		inputForeground: style?.inputForeground || inputForeground,
		inputBorder: style?.inputBorder || inputBorder,
		inputActiveOptionBorder: style?.inputActiveOptionBorder || inputActiveOptionBorder,
		inputActiveOptionForeground: style?.inputActiveOptionForeground || inputActiveOptionForeground,
		inputActiveOptionBackground: style?.inputActiveOptionBackground || inputActiveOptionBackground,
		inputValidationInfoBorder: style?.inputValidationInfoBorder || inputValidationInfoBorder,
		inputValidationInfoBackground: style?.inputValidationInfoBackground || inputValidationInfoBackground,
		inputValidationInfoForeground: style?.inputValidationInfoForeground || inputValidationInfoForeground,
		inputValidationWarningBorder: style?.inputValidationWarningBorder || inputValidationWarningBorder,
		inputValidationWarningBackground: style?.inputValidationWarningBackground || inputValidationWarningBackground,
		inputValidationWarningForeground: style?.inputValidationWarningForeground || inputValidationWarningForeground,
		inputValidationErrorBorder: style?.inputValidationErrorBorder || inputValidationErrorBorder,
		inputValidationErrorBackground: style?.inputValidationErrorBackground || inputValidationErrorBackground,
		inputValidationErrorForeground: style?.inputValidationErrorForeground || inputValidationErrorForeground
	} as IInputBoxStyleOverrides, widget);
}

export interface IListStyleOverrides extends IStyleOverrides {
	listBackground?: ColorIdentifier;
	listFocusBackground?: ColorIdentifier;
	listFocusForeground?: ColorIdentifier;
	listFocusOutline?: ColorIdentifier;
	listActiveSelectionBackground?: ColorIdentifier;
	listActiveSelectionForeground?: ColorIdentifier;
	listFocusAndSelectionBackground?: ColorIdentifier;
	listFocusAndSelectionForeground?: ColorIdentifier;
	listInactiveSelectionBackground?: ColorIdentifier;
	listInactiveSelectionForeground?: ColorIdentifier;
	listInactiveFocusBackground?: ColorIdentifier;
	listInactiveFocusOutline?: ColorIdentifier;
	listHoverBackground?: ColorIdentifier;
	listHoverForeground?: ColorIdentifier;
	listDropBackground?: ColorIdentifier;
	listSelectionOutline?: ColorIdentifier;
	listHoverOutline?: ColorIdentifier;
	listFilterWidgetBackground?: ColorIdentifier;
	listFilterWidgetOutline?: ColorIdentifier;
	listFilterWidgetNoMatchesOutline?: ColorIdentifier;
	listMatchesShadow?: ColorIdentifier;
	treeIndentGuidesStroke?: ColorIdentifier;
	tableColumnsBorder?: ColorIdentifier;
}

export function attachListStyler(widget: IThemable, themeService: IThemeService, overrides?: IColorMapping): IDisposable {
	return attachStyler(themeService, { ...defaultListStyles, ...(overrides || {}) }, widget);
}

export const defaultListStyles: IColorMapping = {
	listFocusBackground,
	listFocusForeground,
	listFocusOutline,
	listActiveSelectionBackground,
	listActiveSelectionForeground,
	listFocusAndSelectionBackground: listActiveSelectionBackground,
	listFocusAndSelectionForeground: listActiveSelectionForeground,
	listInactiveSelectionBackground,
	listInactiveSelectionForeground,
	listInactiveFocusBackground,
	listInactiveFocusOutline,
	listHoverBackground,
	listHoverForeground,
	listDropBackground,
	listSelectionOutline: activeContrastBorder,
	listHoverOutline: activeContrastBorder,
	listFilterWidgetBackground,
	listFilterWidgetOutline,
	listFilterWidgetNoMatchesOutline,
	listMatchesShadow: widgetShadow,
	treeIndentGuidesStroke,
	tableColumnsBorder
};

export interface IButtonStyleOverrides extends IStyleOverrides {
	buttonForeground?: ColorIdentifier;
	buttonBackground?: ColorIdentifier;
	buttonHoverBackground?: ColorIdentifier;
	buttonSecondaryForeground?: ColorIdentifier;
	buttonSecondaryBackground?: ColorIdentifier;
	buttonSecondaryHoverBackground?: ColorIdentifier;
	buttonBorder?: ColorIdentifier;
}

export function attachButtonStyler(widget: IThemable, themeService: IThemeService, style?: IButtonStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		buttonForeground: style?.buttonForeground || buttonForeground,
		buttonBackground: style?.buttonBackground || buttonBackground,
		buttonHoverBackground: style?.buttonHoverBackground || buttonHoverBackground,
		buttonSecondaryForeground: style?.buttonSecondaryForeground || buttonSecondaryForeground,
		buttonSecondaryBackground: style?.buttonSecondaryBackground || buttonSecondaryBackground,
		buttonSecondaryHoverBackground: style?.buttonSecondaryHoverBackground || buttonSecondaryHoverBackground,
		buttonBorder: style?.buttonBorder || buttonBorder,
	} as IButtonStyleOverrides, widget);
}

export interface IKeybindingLabelStyleOverrides extends IStyleOverrides {
	keybindingLabelBackground?: ColorIdentifier;
	keybindingLabelForeground?: ColorIdentifier;
	keybindingLabelBorder?: ColorIdentifier;
	keybindingLabelBottomBorder?: ColorIdentifier;
	keybindingLabelShadow?: ColorIdentifier;
}

export function attachKeybindingLabelStyler(widget: IThemable, themeService: IThemeService, style?: IKeybindingLabelStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		keybindingLabelBackground: (style && style.keybindingLabelBackground) || keybindingLabelBackground,
		keybindingLabelForeground: (style && style.keybindingLabelForeground) || keybindingLabelForeground,
		keybindingLabelBorder: (style && style.keybindingLabelBorder) || keybindingLabelBorder,
		keybindingLabelBottomBorder: (style && style.keybindingLabelBottomBorder) || keybindingLabelBottomBorder,
		keybindingLabelShadow: (style && style.keybindingLabelShadow) || widgetShadow
	} as IKeybindingLabelStyleOverrides, widget);
}

export interface ILinkStyleOverrides extends IStyleOverrides {
	textLinkForeground?: ColorIdentifier;
}

export function attachLinkStyler(widget: IThemable, themeService: IThemeService, style?: ILinkStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		textLinkForeground: style?.textLinkForeground || textLinkForeground,
	} as ILinkStyleOverrides, widget);
}

export interface IProgressBarStyleOverrides extends IStyleOverrides {
	progressBarBackground?: ColorIdentifier;
}

export function attachProgressBarStyler(widget: IThemable, themeService: IThemeService, style?: IProgressBarStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		progressBarBackground: style?.progressBarBackground || progressBarBackground
	} as IProgressBarStyleOverrides, widget);
}

export function attachStylerCallback(themeService: IThemeService, colors: { [name: string]: ColorIdentifier }, callback: styleFn): IDisposable {
	return attachStyler(themeService, colors, callback);
}

export interface IBreadcrumbsWidgetStyleOverrides extends IColorMapping {
	breadcrumbsBackground?: ColorIdentifier | ColorFunction;
	breadcrumbsForeground?: ColorIdentifier;
	breadcrumbsHoverForeground?: ColorIdentifier;
	breadcrumbsFocusForeground?: ColorIdentifier;
	breadcrumbsFocusAndSelectionForeground?: ColorIdentifier;
}

export const defaultBreadcrumbsStyles = <IBreadcrumbsWidgetStyleOverrides>{
	breadcrumbsBackground: breadcrumbsBackground,
	breadcrumbsForeground: breadcrumbsForeground,
	breadcrumbsHoverForeground: breadcrumbsFocusForeground,
	breadcrumbsFocusForeground: breadcrumbsFocusForeground,
	breadcrumbsFocusAndSelectionForeground: breadcrumbsActiveSelectionForeground,
};

export function attachBreadcrumbsStyler(widget: IThemable, themeService: IThemeService, style?: IBreadcrumbsWidgetStyleOverrides): IDisposable {
	return attachStyler(themeService, { ...defaultBreadcrumbsStyles, ...style }, widget);
}

export interface IMenuStyleOverrides extends IColorMapping {
	shadowColor?: ColorIdentifier;
	borderColor?: ColorIdentifier;
	foregroundColor?: ColorIdentifier;
	backgroundColor?: ColorIdentifier;
	selectionForegroundColor?: ColorIdentifier;
	selectionBackgroundColor?: ColorIdentifier;
	selectionBorderColor?: ColorIdentifier;
	separatorColor?: ColorIdentifier;
}

export const defaultMenuStyles = <IMenuStyleOverrides>{
	shadowColor: widgetShadow,
	borderColor: menuBorder,
	foregroundColor: menuForeground,
	backgroundColor: menuBackground,
	selectionForegroundColor: menuSelectionForeground,
	selectionBackgroundColor: menuSelectionBackground,
	selectionBorderColor: menuSelectionBorder,
	separatorColor: menuSeparatorBackground
};

export function attachMenuStyler(widget: IThemable, themeService: IThemeService, style?: IMenuStyleOverrides): IDisposable {
	return attachStyler(themeService, { ...defaultMenuStyles, ...style }, widget);
}

export interface IDialogStyleOverrides extends IButtonStyleOverrides, ILinkStyleOverrides {
	dialogForeground?: ColorIdentifier;
	dialogBackground?: ColorIdentifier;
	dialogShadow?: ColorIdentifier;
	dialogBorder?: ColorIdentifier;
	checkboxBorder?: ColorIdentifier;
	checkboxBackground?: ColorIdentifier;
	checkboxForeground?: ColorIdentifier;
	errorIconForeground?: ColorIdentifier;
	warningIconForeground?: ColorIdentifier;
	infoIconForeground?: ColorIdentifier;
	inputBackground?: ColorIdentifier;
	inputForeground?: ColorIdentifier;
	inputBorder?: ColorIdentifier;
}

export const defaultDialogStyles = <IDialogStyleOverrides>{
	dialogBackground: editorWidgetBackground,
	dialogForeground: editorWidgetForeground,
	dialogShadow: widgetShadow,
	dialogBorder: contrastBorder,
	buttonForeground: buttonForeground,
	buttonBackground: buttonBackground,
	buttonSecondaryBackground: buttonSecondaryBackground,
	buttonSecondaryForeground: buttonSecondaryForeground,
	buttonSecondaryHoverBackground: buttonSecondaryHoverBackground,
	buttonHoverBackground: buttonHoverBackground,
	buttonBorder: buttonBorder,
	checkboxBorder: simpleCheckboxBorder,
	checkboxBackground: simpleCheckboxBackground,
	checkboxForeground: simpleCheckboxForeground,
	errorIconForeground: problemsErrorIconForeground,
	warningIconForeground: problemsWarningIconForeground,
	infoIconForeground: problemsInfoIconForeground,
	inputBackground: inputBackground,
	inputForeground: inputForeground,
	inputBorder: inputBorder,
	textLinkForeground: textLinkForeground
};


export function attachDialogStyler(widget: IThemable, themeService: IThemeService, style?: IDialogStyleOverrides): IDisposable {
	return attachStyler(themeService, { ...defaultDialogStyles, ...style }, widget);
}
