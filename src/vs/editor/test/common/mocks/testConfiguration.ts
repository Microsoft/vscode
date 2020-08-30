/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommonEditorConfiguration, IEnvConfiguration } from 'vs/editor/common/config/commonEditorConfig';
import { IEditorOptions, EditorFontLigatures } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';

export class TestConfiguration extends CommonEditorConfiguration {

	constructor(opts: IEditorOptions) {
		super(false, opts);
		this._recomputeOptions();
	}

	protected _getEnvConfiguration(): IEnvConfiguration {
		return {
			extraEditorClassName: '',
			outerWidth: 100,
			outerHeight: 100,
			emptySelectionClipboard: true,
			pixelRatio: 1,
			zoomLevel: 0,
			accessibilitySupport: AccessibilitySupport.Unknown
		};
	}

	protected readConfiguration(styling: BareFontInfo): FontInfo {
		return new FontInfo({
			zoomLevel: 0,
			fontFamily: 'mockFont',
			fontWeight: 'normal',
			fontSize: 14,
			fontFeatureSettings: EditorFontLigatures.OFF,
			lineHeight: 19,
			letterSpacing: 1.5,
			isMonospace: true,
			typicalHalfwidthCharacterWidth: 10,
			typicalFullwidthCharacterWidth: 20,
			canUseHalfwidthRightwardsArrow: true,
			spaceWidth: 10,
			middotWidth: 10,
			wsmiddotWidth: 10,
			maxDigitWidth: 10,
		}, true);
	}
}
