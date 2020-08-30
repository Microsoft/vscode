/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { windowOpenNoOpener } from 'vs/base/browser/dom';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CodeEditorServiceImpl } from 'vs/editor/browser/services/codeEditorServiceImpl';
import { IRange } from 'vs/editor/common/core/range';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';

export class StandaloneCodeEditorServiceImpl extends CodeEditorServiceImpl {

	public getActiveCodeEditor(): ICodeEditor | null {
		return null; // not supported in the standalone case
	}

	public openCodeEditor(input: IResourceEditorInput, source: ICodeEditor | null, sideBySide?: boolean): Promise<ICodeEditor | null> {
		if (!source) {
			return Promise.resolve(null);
		}

		return Promise.resolve(this.doOpenEditor(source, input));
	}

	private doOpenEditor(editor: ICodeEditor, input: IResourceEditorInput): ICodeEditor | null {
		const model = this.findModel(editor, input.resource);
		if (!model) {
			if (input.resource) {

				const schema = input.resource.scheme;
				if (schema === Schemas.http || schema === Schemas.https) {
					// This is a fully qualified http or https URL
					windowOpenNoOpener(input.resource.toString());
					return editor;
				}
			}
			return null;
		}

		const selection = <IRange>(input.options ? input.options.selection : null);
		if (selection) {
			if (typeof selection.endLineNumber === 'number' && typeof selection.endColumn === 'number') {
				editor.setSelection(selection);
				editor.revealRangeInCenter(selection, ScrollType.Immediate);
			} else {
				const pos = {
					lineNumber: selection.startLineNumber,
					column: selection.startColumn
				};
				editor.setPosition(pos);
				editor.revealPositionInCenter(pos, ScrollType.Immediate);
			}
		}

		return editor;
	}

	private findModel(editor: ICodeEditor, resource: URI): ITextModel | null {
		const model = editor.getModel();
		if (model && model.uri.toString() !== resource.toString()) {
			return null;
		}

		return model;
	}
}
