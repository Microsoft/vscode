/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/style';

import { registerThemingParticipant, IColorTheme, ICssStyleCollector, HIGH_CONTRAST } from 'vs/platform/theme/common/themeService';
import { iconForeground, foreground, selectionBackground, focusBorder, scrollbarShadow, scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground, listHighlightForeground, inputPlaceholderForeground } from 'vs/platform/theme/common/colorRegistry';
import { WORKBENCH_BACKGROUND, TITLE_BAR_ACTIVE_BACKGROUND } from 'vs/workbench/common/theme';
import { isWeb, isIOS, isMacintosh, isWindows } from 'vs/base/common/platform';
import { createMetaElement } from 'vs/base/browser/dom';
import { isSafari, isStandalone } from 'vs/base/browser/browser';

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	// Foreground
	const windowForeground = theme.getColor(foreground);
	if (windowForeground) {
		collector.addRule(`.monaco-workbench { color: ${windowForeground}; }`);
	}

	// Background (We need to set the workbench background color so that on Windows we get subpixel-antialiasing)
	const workbenchBackground = WORKBENCH_BACKGROUND(theme);
	collector.addRule(`.monaco-workbench { background-color: ${workbenchBackground}; }`);

	// Icon defaults
	const iconForegroundColor = theme.getColor(iconForeground);
	if (iconForegroundColor) {
		collector.addRule(`.monaco-workbench .codicon { color: ${iconForegroundColor}; }`);
	}

	// Selection
	const windowSelectionBackground = theme.getColor(selectionBackground);
	if (windowSelectionBackground) {
		collector.addRule(`.monaco-workbench ::selection { background-color: ${windowSelectionBackground}; }`);
	}

	// Input placeholder
	const placeholderForeground = theme.getColor(inputPlaceholderForeground);
	if (placeholderForeground) {
		collector.addRule(`
			.monaco-workbench input::placeholder { color: ${placeholderForeground}; }
			.monaco-workbench input::-webkit-input-placeholder  { color: ${placeholderForeground}; }
			.monaco-workbench input::-moz-placeholder { color: ${placeholderForeground}; }
		`);
		collector.addRule(`
			.monaco-workbench textarea::placeholder { color: ${placeholderForeground}; }
			.monaco-workbench textarea::-webkit-input-placeholder { color: ${placeholderForeground}; }
			.monaco-workbench textarea::-moz-placeholder { color: ${placeholderForeground}; }
		`);
	}

	// List highlight
	const listHighlightForegroundColor = theme.getColor(listHighlightForeground);
	if (listHighlightForegroundColor) {
		collector.addRule(`
			.monaco-workbench .monaco-list .monaco-list-row .monaco-highlighted-label .highlight {
				color: ${listHighlightForegroundColor};
			}
		`);
	}

	// Scrollbars
	const scrollbarShadowColor = theme.getColor(scrollbarShadow);
	if (scrollbarShadowColor) {
		collector.addRule(`
			.monaco-workbench .monaco-scrollable-element > .shadow.top {
				box-shadow: ${scrollbarShadowColor} 0 6px 6px -6px inset;
			}

			.monaco-workbench .monaco-scrollable-element > .shadow.left {
				box-shadow: ${scrollbarShadowColor} 6px 0 6px -6px inset;
			}

			.monaco-workbench .monaco-scrollable-element > .shadow.top.left {
				box-shadow: ${scrollbarShadowColor} 6px 6px 6px -6px inset;
			}
		`);
	}

	const scrollbarSliderBackgroundColor = theme.getColor(scrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider {
				background: ${scrollbarSliderBackgroundColor};
			}
		`);
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(scrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider:hover {
				background: ${scrollbarSliderHoverBackgroundColor};
			}
		`);
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(scrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .monaco-scrollable-element > .scrollbar > .slider.active {
				background: ${scrollbarSliderActiveBackgroundColor};
			}
		`);
	}

	// Focus outline
	const focusOutline = theme.getColor(focusBorder);
	if (focusOutline) {
		collector.addRule(`
		.monaco-workbench [tabindex="0"]:focus,
		.monaco-workbench [tabindex="-1"]:focus,
		.monaco-workbench .synthetic-focus,
		.monaco-workbench select:focus,
		.monaco-workbench .monaco-list:not(.element-focused):focus:before,
		.monaco-workbench input[type="button"]:focus,
		.monaco-workbench input[type="text"]:focus,
		.monaco-workbench button:focus,
		.monaco-workbench textarea:focus,
		.monaco-workbench input[type="search"]:focus,
		.monaco-workbench input[type="checkbox"]:focus {
			outline-color: ${focusOutline};
		}
		`);
	}

	// High Contrast theme overwrites for outline
	if (theme.type === HIGH_CONTRAST) {
		collector.addRule(`
		.hc-black [tabindex="0"]:focus,
		.hc-black [tabindex="-1"]:focus,
		.hc-black .synthetic-focus,
		.hc-black select:focus,
		.hc-black input[type="button"]:focus,
		.hc-black input[type="text"]:focus,
		.hc-black textarea:focus,
		.hc-black input[type="checkbox"]:focus {
			outline-style: solid;
			outline-width: 1px;
		}

		.hc-black .synthetic-focus input {
			background: transparent; /* Search input focus fix when in high contrast */
		}
		`);
	}

	// Update <meta name="theme-color" content=""> based on selected theme
	if (isWeb) {
		const titleBackground = theme.getColor(TITLE_BAR_ACTIVE_BACKGROUND);
		if (titleBackground) {
			const metaElementId = 'monaco-workbench-meta-theme-color';
			let metaElement = document.getElementById(metaElementId) as HTMLMetaElement | null;
			if (!metaElement) {
				metaElement = createMetaElement();
				metaElement.name = 'theme-color';
				metaElement.id = metaElementId;
			}

			metaElement.content = titleBackground.toString();
		}
	}

	// We disable user select on the root element, however on Safari this seems
	// to prevent any text selection in the monaco editor. As a workaround we
	// allow to select text in monaco editor instances.
	if (isSafari) {
		collector.addRule(`
			body.web {
				touch-action: none;
			}
			.monaco-workbench .monaco-editor .view-lines {
				user-select: text;
				-webkit-user-select: text;
			}
		`);
	}

	// Update body background color to ensure the home indicator area looks similar to the workbench
	if (isIOS && isStandalone) {
		collector.addRule(`body { background-color: ${workbenchBackground}; }`);
	}
});

/**
 * The best font-family to be used in CSS based on the platform:
 * - Windows: Segoe preferred, fallback to sans-serif
 * - macOS: standard system font, fallback to sans-serif
 * - Linux: standard system font preferred, fallback to Ubuntu fonts
 *
 * Note: this currently does not adjust for different locales.
 */
export const DEFAULT_FONT_FAMILY = isWindows ? '"Segoe WPC", "Segoe UI", sans-serif' : isMacintosh ? '-apple-system, BlinkMacSystemFont, sans-serif' : 'system-ui, "Ubuntu", "Droid Sans", sans-serif';
