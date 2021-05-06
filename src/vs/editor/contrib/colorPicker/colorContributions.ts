/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import color detector contribution
import 'vs/editor/contrib/colorPicker/colorDetector';

import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ModesHoverController } from 'vs/editor/contrib/hover/hover';
import { Range } from 'vs/editor/common/core/range';
import { HoverStartMode } from 'vs/editor/contrib/hover/hoverOperation';

export class ColorContribution extends Disposable implements IEditorContribution {

	public static readonly ID: string = 'editor.contrib.colorContribution';

	static readonly RECOMPUTE_TIME = 1000; // ms

	constructor(private readonly _editor: ICodeEditor,
	) {
		super();
		this._register(_editor.onMouseDown((e) => this.onMouseDown(e)));
	}

	override dispose(): void {
		super.dispose();
	}

	private onMouseDown(mouseEvent: IEditorMouseEvent) {
		const targetType = mouseEvent.target.type;

		if (targetType !== MouseTargetType.CONTENT_TEXT) {
			return;
		}

		const hoverOnColorDecorator = [...mouseEvent.target.element?.classList.values() || []].find(className => className.startsWith('ced-colorBox'));
		if (!hoverOnColorDecorator) {
			return;
		}

		if (!mouseEvent.target.range) {
			return;
		}

		const hoverController = this._editor.getContribution<ModesHoverController>(ModesHoverController.ID);
		if (!hoverController.isColorPickerVisible()) {
			const range = new Range(mouseEvent.target.range.startLineNumber, mouseEvent.target.range.startColumn + 1, mouseEvent.target.range.endLineNumber, mouseEvent.target.range.endColumn + 1);
			hoverController.showContentHover(range, HoverStartMode.Delayed, false);
		}
	}
}

registerEditorContribution(ColorContribution.ID, ColorContribution);
