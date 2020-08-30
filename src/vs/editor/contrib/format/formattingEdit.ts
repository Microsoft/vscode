/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { EndOfLineSequence, ISingleEditOperation } from 'vs/editor/common/model';
import { TextEdit } from 'vs/editor/common/modes';

export class FormattingEdit {

	private static _handleEolEdits(editor: ICodeEditor, edits: TextEdit[]): ISingleEditOperation[] {
		let newEol: EndOfLineSequence | undefined = undefined;
		let singleEdits: ISingleEditOperation[] = [];

		for (let edit of edits) {
			if (typeof edit.eol === 'number') {
				newEol = edit.eol;
			}
			if (edit.range && typeof edit.text === 'string') {
				singleEdits.push(edit);
			}
		}

		if (typeof newEol === 'number') {
			if (editor.hasModel()) {
				editor.getModel().pushEOL(newEol);
			}
		}

		return singleEdits;
	}

	private static _isFullModelReplaceEdit(editor: ICodeEditor, edit: ISingleEditOperation): boolean {
		if (!editor.hasModel()) {
			return false;
		}
		const model = editor.getModel();
		const editRange = model.validateRange(edit.range);
		const fullModelRange = model.getFullModelRange();
		return fullModelRange.equalsRange(editRange);
	}

	static execute(editor: ICodeEditor, _edits: TextEdit[], addUndoStops: boolean) {
		if (addUndoStops) {
			editor.pushUndoStop();
		}
		const edits = FormattingEdit._handleEolEdits(editor, _edits);
		if (edits.length === 1 && FormattingEdit._isFullModelReplaceEdit(editor, edits[0])) {
			// We use replace semantics and hope that markers stay put...
			editor.executeEdits('formatEditsCommand', edits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text)));
		} else {
			editor.executeEdits('formatEditsCommand', edits.map(edit => EditOperation.replaceMove(Range.lift(edit.range), edit.text)));
		}
		if (addUndoStops) {
			editor.pushUndoStop();
		}
	}
}
