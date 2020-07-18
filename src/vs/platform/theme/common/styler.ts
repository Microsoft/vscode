/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { focusBorder, inputBackground, inputForeground, ColorIdentifier, selectForeground, selectBackground, selectListBackground, selectBorder, inputBorder, foreground, editorBackground, contrastBorder, inputActiveOptionBorder, inputActiveOptionBackground, inputActiveOptionForeground, listFocusBackground, listFocusForeground, listActiveSelectionBackground, listActiveSelectionForeground, listInactiveSelectionForeground, listInactiveSelectionBackground, listInactiveFocusBackground, listHoverBackground, listHoverForeground, listDropBackground, pickerGroupBorder, pickerGroupForeground, widgetShadow, inputValidationInfoBorder, inputValidationInfoBackground, inputValidationWarningBorder, inputValidationWarningBackground, inputValidationErrorBorder, inputValidationErrorBackground, activeContrastBorder, buttonForeground, buttonBackground, buttonHoverBackground, ColorFunction, badgeBackground, badgeForeground, progressBarBackground, breadcrumbsForeground, breadcrumbsFocusForeground, breadcrumbsActiveSelectionForeground, breadcrumbsBackground, editorWidgetBorder, inputValidationInfoForeground, inputValidationWarningForeground, inputValidationErrorForeground, menuForeground, menuBackground, menuSelectionForeground, menuSelectionBackground, menuSelectionBorder, menuBorder, menuSeparatorBackground, darken, listFilterWidgetOutline, listFilterWidgetNoMatchesOutline, listFilterWidgetBackground, editorWidgetBackground, treeIndentGuidesStroke, editorWidgetForeground, simpleCheckboxBackground, simpleCheckboxBorder, simpleCheckboxForeground, ColorValue, resolveColorValue, textLinkForeground, problemsWarningIconForeground, problemsErrorIconForeground, problemsInfoIconForeground, buttonSecondaryBackground, buttonSecondaryForeground, buttonSecondaryHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Color } from 'vs/base/common/color';
import { IThemable, styleFn } from 'vs/base/common/styler';

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
		inputActiveOptionBorder: (style && style.inputActiveOptionBorderColor) || inputActiveOptionBorder,
		inputActiveOptionForeground: (style && style.inputActiveOptionForegroundColor) || inputActiveOptionForeground,
		inputActiveOptionBackground: (style && style.inputActiveOptionBackgroundColor) || inputActiveOptionBackground
	} as ICheckboxStyleOverrides, widget);
}

export interface IBadgeStyleOverrides extends IStyleOverrides {
	badgeBackground?: ColorIdentifier;
	badgeForeground?: ColorIdentifier;
}

export function attachBadgeStyler(widget: IThemable, themeService: IThemeService, style?: IBadgeStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		badgeBackground: (style && style.badgeBackground) || badgeBackground,
		badgeForeground: (style && style.badgeForeground) || badgeForeground,
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
		inputBackground: (style && style.inputBackground) || inputBackground,
		inputForeground: (style && style.inputForeground) || inputForeground,
		inputBorder: (style && style.inputBorder) || inputBorder,
		inputValidationInfoBorder: (style && style.inputValidationInfoBorder) || inputValidationInfoBorder,
		inputValidationInfoBackground: (style && style.inputValidationInfoBackground) || inputValidationInfoBackground,
		inputValidationInfoForeground: (style && style.inputValidationInfoForeground) || inputValidationInfoForeground,
		inputValidationWarningBorder: (style && style.inputValidationWarningBorder) || inputValidationWarningBorder,
		inputValidationWarningBackground: (style && style.inputValidationWarningBackground) || inputValidationWarningBackground,
		inputValidationWarningForeground: (style && style.inputValidationWarningForeground) || inputValidationWarningForeground,
		inputValidationErrorBorder: (style && style.inputValidationErrorBorder) || inputValidationErrorBorder,
		inputValidationErrorBackground: (style && style.inputValidationErrorBackground) || inputValidationErrorBackground,
		inputValidationErrorForeground: (style && style.inputValidationErrorForeground) || inputValidationErrorForeground
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
		selectBackground: (style && style.selectBackground) || selectBackground,
		selectListBackground: (style && style.selectListBackground) || selectListBackground,
		selectForeground: (style && style.selectForeground) || selectForeground,
		decoratorRightForeground: (style && style.pickerGroupForeground) || pickerGroupForeground,
		selectBorder: (style && style.selectBorder) || selectBorder,
		focusBorder: (style && style.focusBorder) || focusBorder,
		listFocusBackground: (style && style.listFocusBackground) || listFocusBackground,
		listFocusForeground: (style && style.listFocusForeground) || listFocusForeground,
		listFocusOutline: (style && style.listFocusOutline) || activeContrastBorder,
		listHoverBackground: (style && style.listHoverBackground) || listHoverBackground,
		listHoverForeground: (style && style.listHoverForeground) || listHoverForeground,
		listHoverOutline: (style && style.listFocusOutline) || activeContrastBorder,
		selectListBorder: (style && style.selectListBorder) || editorWidgetBorder
	} as ISelectBoxStyleOverrides, widget);
}

export function attachFindReplaceInputBoxStyler(widget: IThemable, themeService: IThemeService, style?: IInputBoxStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		inputBackground: (style && style.inputBackground) || inputBackground,
		inputForeground: (style && style.inputForeground) || inputForeground,
		inputBorder: (style && style.inputBorder) || inputBorder,
		inputActiveOptionBorder: (style && style.inputActiveOptionBorder) || inputActiveOptionBorder,
		inputActiveOptionForeground: (style && style.inputActiveOptionForeground) || inputActiveOptionForeground,
		inputActiveOptionBackground: (style && style.inputActiveOptionBackground) || inputActiveOptionBackground,
		inputValidationInfoBorder: (style && style.inputValidationInfoBorder) || inputValidationInfoBorder,
		inputValidationInfoBackground: (style && style.inputValidationInfoBackground) || inputValidationInfoBackground,
		inputValidationInfoForeground: (style && style.inputValidationInfoForeground) || inputValidationInfoForeground,
		inputValidationWarningBorder: (style && style.inputValidationWarningBorder) || inputValidationWarningBorder,
		inputValidationWarningBackground: (style && style.inputValidationWarningBackground) || inputValidationWarningBackground,
		inputValidationWarningForeground: (style && style.inputValidationWarningForeground) || inputValidationWarningForeground,
		inputValidationErrorBorder: (style && style.inputValidationErrorBorder) || inputValidationErrorBorder,
		inputValidationErrorBackground: (style && style.inputValidationErrorBackground) || inputValidationErrorBackground,
		inputValidationErrorForeground: (style && style.inputValidationErrorForeground) || inputValidationErrorForeground
	} as IInputBoxStyleOverrides, widget);
}

export interface IQuickInputStyleOverrides extends IListStyleOverrides, IInputBoxStyleOverrides, IProgressBarStyleOverrides {
	foreground?: ColorIdentifier;
	background?: ColorIdentifier;
	borderColor?: ColorIdentifier;
	widgetShadow?: ColorIdentifier;
	pickerGroupForeground?: ColorIdentifier;
	pickerGroupBorder?: ColorIdentifier;
}

export function attachQuickInputStyler(widget: IThemable, themeService: IThemeService, style?: IQuickInputStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		foreground: (style && style.foreground) || foreground,
		background: (style && style.background) || editorBackground,
		borderColor: style && style.borderColor || contrastBorder,
		widgetShadow: style && style.widgetShadow || widgetShadow,
		progressBarBackground: style && style.progressBarBackground || progressBarBackground,
		pickerGroupForeground: style && style.pickerGroupForeground || pickerGroupForeground,
		pickerGroupBorder: style && style.pickerGroupBorder || pickerGroupBorder,
		inputBackground: (style && style.inputBackground) || inputBackground,
		inputForeground: (style && style.inputForeground) || inputForeground,
		inputBorder: (style && style.inputBorder) || inputBorder,
		inputValidationInfoBorder: (style && style.inputValidationInfoBorder) || inputValidationInfoBorder,
		inputValidationInfoBackground: (style && style.inputValidationInfoBackground) || inputValidationInfoBackground,
		inputValidationInfoForeground: (style && style.inputValidationInfoForeground) || inputValidationInfoForeground,
		inputValidationWarningBorder: (style && style.inputValidationWarningBorder) || inputValidationWarningBorder,
		inputValidationWarningBackground: (style && style.inputValidationWarningBackground) || inputValidationWarningBackground,
		inputValidationWarningForeground: (style && style.inputValidationWarningForeground) || inputValidationWarningForeground,
		inputValidationErrorBorder: (style && style.inputValidationErrorBorder) || inputValidationErrorBorder,
		inputValidationErrorBackground: (style && style.inputValidationErrorBackground) || inputValidationErrorBackground,
		inputValidationErrorForeground: (style && style.inputValidationErrorForeground) || inputValidationErrorForeground,
		listFocusBackground: (style && style.listFocusBackground) || listFocusBackground,
		listFocusForeground: (style && style.listFocusForeground) || listFocusForeground,
		listActiveSelectionBackground: (style && style.listActiveSelectionBackground) || darken(listActiveSelectionBackground, 0.1),
		listActiveSelectionForeground: (style && style.listActiveSelectionForeground) || listActiveSelectionForeground,
		listFocusAndSelectionBackground: style && style.listFocusAndSelectionBackground || listActiveSelectionBackground,
		listFocusAndSelectionForeground: (style && style.listFocusAndSelectionForeground) || listActiveSelectionForeground,
		listInactiveSelectionBackground: (style && style.listInactiveSelectionBackground) || listInactiveSelectionBackground,
		listInactiveSelectionForeground: (style && style.listInactiveSelectionForeground) || listInactiveSelectionForeground,
		listInactiveFocusBackground: (style && style.listInactiveFocusBackground) || listInactiveFocusBackground,
		listHoverBackground: (style && style.listHoverBackground) || listHoverBackground,
		listHoverForeground: (style && style.listHoverForeground) || listHoverForeground,
		listDropBackground: (style && style.listDropBackground) || listDropBackground,
		listFocusOutline: (style && style.listFocusOutline) || activeContrastBorder,
		listSelectionOutline: (style && style.listSelectionOutline) || activeContrastBorder,
		listHoverOutline: (style && style.listHoverOutline) || activeContrastBorder
	} as IQuickInputStyleOverrides, widget);
}

export interface IListStyleOverrides extends IStyleOverrides {
	listBackground?: ColorIdentifier;
	listFocusBackground?: ColorIdentifier;
	listFocusForeground?: ColorIdentifier;
	listActiveSelectionBackground?: ColorIdentifier;
	listActiveSelectionForeground?: ColorIdentifier;
	listFocusAndSelectionBackground?: ColorIdentifier;
	listFocusAndSelectionForeground?: ColorIdentifier;
	listInactiveSelectionBackground?: ColorIdentifier;
	listInactiveSelectionForeground?: ColorIdentifier;
	listInactiveFocusBackground?: ColorIdentifier;
	listHoverBackground?: ColorIdentifier;
	listHoverForeground?: ColorIdentifier;
	listDropBackground?: ColorIdentifier;
	listFocusOutline?: ColorIdentifier;
	listInactiveFocusOutline?: ColorIdentifier;
	listSelectionOutline?: ColorIdentifier;
	listHoverOutline?: ColorIdentifier;
	listFilterWidgetBackground?: ColorIdentifier;
	listFilterWidgetOutline?: ColorIdentifier;
	listFilterWidgetNoMatchesOutline?: ColorIdentifier;
	listMatchesShadow?: ColorIdentifier;
	treeIndentGuidesStroke?: ColorIdentifier;
}

export function attachListStyler(widget: IThemable, themeService: IThemeService, overrides?: IColorMapping): IDisposable {
	return attachStyler(themeService, { ...defaultListStyles, ...(overrides || {}) }, widget);
}

export const defaultListStyles: IColorMapping = {
	listFocusBackground: listFocusBackground,
	listFocusForeground: listFocusForeground,
	listActiveSelectionBackground: darken(listActiveSelectionBackground, 0.1),
	listActiveSelectionForeground: listActiveSelectionForeground,
	listFocusAndSelectionBackground: listActiveSelectionBackground,
	listFocusAndSelectionForeground: listActiveSelectionForeground,
	listInactiveSelectionBackground: listInactiveSelectionBackground,
	listInactiveSelectionForeground: listInactiveSelectionForeground,
	listInactiveFocusBackground: listInactiveFocusBackground,
	listHoverBackground: listHoverBackground,
	listHoverForeground: listHoverForeground,
	listDropBackground: listDropBackground,
	listFocusOutline: activeContrastBorder,
	listSelectionOutline: activeContrastBorder,
	listHoverOutline: activeContrastBorder,
	listFilterWidgetBackground: listFilterWidgetBackground,
	listFilterWidgetOutline: listFilterWidgetOutline,
	listFilterWidgetNoMatchesOutline: listFilterWidgetNoMatchesOutline,
	listMatchesShadow: widgetShadow,
	treeIndentGuidesStroke: treeIndentGuidesStroke
};

export interface IButtonStyleOverrides extends IStyleOverrides {
	buttonForeground?: ColorIdentifier;
	buttonBackground?: ColorIdentifier;
	buttonHoverBackground?: ColorIdentifier;
	buttonSecondaryForeground?: ColorIdentifier;
	buttonSecondaryBackground?: ColorIdentifier;
	buttonSecondaryHoverBackground?: ColorIdentifier;
}

export function attachButtonStyler(widget: IThemable, themeService: IThemeService, style?: IButtonStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		buttonForeground: (style && style.buttonForeground) || buttonForeground,
		buttonBackground: (style && style.buttonBackground) || buttonBackground,
		buttonHoverBackground: (style && style.buttonHoverBackground) || buttonHoverBackground,
		buttonSecondaryForeground: (style && style.buttonSecondaryForeground) || buttonSecondaryForeground,
		buttonSecondaryBackground: (style && style.buttonSecondaryBackground) || buttonSecondaryBackground,
		buttonSecondaryHoverBackground: (style && style.buttonSecondaryHoverBackground) || buttonSecondaryHoverBackground,
		buttonBorder: contrastBorder
	} as IButtonStyleOverrides, widget);
}

export interface ILinkStyleOverrides extends IStyleOverrides {
	textLinkForeground?: ColorIdentifier;
}

export function attachLinkStyler(widget: IThemable, themeService: IThemeService, style?: ILinkStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		textLinkForeground: (style && style.textLinkForeground) || textLinkForeground,
	} as ILinkStyleOverrides, widget);
}

export interface IProgressBarStyleOverrides extends IStyleOverrides {
	progressBarBackground?: ColorIdentifier;
}

export function attachProgressBarStyler(widget: IThemable, themeService: IThemeService, style?: IProgressBarStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		progressBarBackground: (style && style.progressBarBackground) || progressBarBackground
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

export interface IDialogStyleOverrides extends IButtonStyleOverrides {
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
}

export const defaultDialogStyles = <IDialogStyleOverrides>{
	dialogBackground: editorWidgetBackground,
	dialogForeground: editorWidgetForeground,
	dialogShadow: widgetShadow,
	dialogBorder: contrastBorder,
	buttonForeground: buttonForeground,
	buttonBackground: buttonBackground,
	buttonHoverBackground: buttonHoverBackground,
	buttonBorder: contrastBorder,
	checkboxBorder: simpleCheckboxBorder,
	checkboxBackground: simpleCheckboxBackground,
	checkboxForeground: simpleCheckboxForeground,
	errorIconForeground: problemsErrorIconForeground,
	warningIconForeground: problemsWarningIconForeground,
	infoIconForeground: problemsInfoIconForeground
};


export function attachDialogStyler(widget: IThemable, themeService: IThemeService, style?: IDialogStyleOverrides): IDisposable {
	return attachStyler(themeService, { ...defaultDialogStyles, ...style }, widget);
}
