/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';

class EditorFontZoomIn extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.fontZoomIn',
			label: nls.localize('EditorFontZoomIn.label', "Editor Font Zoom In"),
			alias: 'Editor Font Zoom In',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		EditorZoom.setZoomLevel(EditorZoom.getZoomLevel() + 1);
	}
}

class EditorFontZoomOut extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.fontZoomOut',
			label: nls.localize('EditorFontZoomOut.label', "Editor Font Zoom Out"),
			alias: 'Editor Font Zoom Out',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		EditorZoom.setZoomLevel(EditorZoom.getZoomLevel() - 1);
	}
}

class EditorFontZoomReset extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.fontZoomReset',
			label: nls.localize('EditorFontZoomReset.label', "Editor Font Zoom Reset"),
			alias: 'Editor Font Zoom Reset',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		EditorZoom.setZoomLevel(0);
	}
}

registerEditorAction(EditorFontZoomIn);
registerEditorAction(EditorFontZoomOut);
registerEditorAction(EditorFontZoomReset);
