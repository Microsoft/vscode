/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { ReplaceCommand } from 'vs/editor/common/commands/replaceCommand';
import { Range } from 'vs/editor/common/core/range';
import { ICommand } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { MoveOperations } from 'vs/editor/common/controller/cursorMoveOperations';

class TransposeLettersAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.transposeLetters',
			label: nls.localize('transposeLetters.label', "Transpose Letters"),
			alias: 'Transpose Letters',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: {
					primary: KeyMod.WinCtrl | KeyCode.KEY_T
				},
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		if (!editor.hasModel()) {
			return;
		}

		let model = editor.getModel();
		let commands: ICommand[] = [];
		let selections = editor.getSelections();

		for (let selection of selections) {
			if (!selection.isEmpty()) {
				continue;
			}

			let lineNumber = selection.startLineNumber;
			let column = selection.startColumn;

			let lastColumn = model.getLineMaxColumn(lineNumber);

			if (lineNumber === 1 && (column === 1 || (column === 2 && lastColumn === 2))) {
				// at beginning of file, nothing to do
				continue;
			}

			// handle special case: when at end of line, transpose left two chars
			// otherwise, transpose left and right chars
			let endPosition = (column === lastColumn) ?
				selection.getPosition() :
				MoveOperations.rightPosition(model, selection.getPosition().lineNumber, selection.getPosition().column);

			let middlePosition = MoveOperations.leftPosition(model, endPosition.lineNumber, endPosition.column);
			let beginPosition = MoveOperations.leftPosition(model, middlePosition.lineNumber, middlePosition.column);

			let leftChar = model.getValueInRange(Range.fromPositions(beginPosition, middlePosition));
			let rightChar = model.getValueInRange(Range.fromPositions(middlePosition, endPosition));

			let replaceRange = Range.fromPositions(beginPosition, endPosition);
			commands.push(new ReplaceCommand(replaceRange, rightChar + leftChar));
		}

		if (commands.length > 0) {
			editor.pushUndoStop();
			editor.executeCommands(this.id, commands);
			editor.pushUndoStop();
		}
	}
}

registerEditorAction(TransposeLettersAction);
