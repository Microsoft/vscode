/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import { WordNavigationType, WordPartOperations } from 'vs/editor/common/controller/cursorWordOperations';
import { WordCharacterClassifier } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ITextModel } from 'vs/editor/common/model';
import { DeleteWordCommand, MoveWordCommand } from 'vs/editor/contrib/wordOperations/wordOperations';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

export class DeleteWordPartLeft extends DeleteWordCommand {
	constructor() {
		super({
			whitespaceHeuristics: true,
			wordNavigationType: WordNavigationType.WordStart,
			id: 'deleteWordPartLeft',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Backspace },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _delete(wordSeparators: WordCharacterClassifier, model: ITextModel, selection: Selection, whitespaceHeuristics: boolean, wordNavigationType: WordNavigationType): Range {
		let r = WordPartOperations.deleteWordPartLeft(wordSeparators, model, selection, whitespaceHeuristics);
		if (r) {
			return r;
		}
		return new Range(1, 1, 1, 1);
	}
}

export class DeleteWordPartRight extends DeleteWordCommand {
	constructor() {
		super({
			whitespaceHeuristics: true,
			wordNavigationType: WordNavigationType.WordEnd,
			id: 'deleteWordPartRight',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Delete },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _delete(wordSeparators: WordCharacterClassifier, model: ITextModel, selection: Selection, whitespaceHeuristics: boolean, wordNavigationType: WordNavigationType): Range {
		let r = WordPartOperations.deleteWordPartRight(wordSeparators, model, selection, whitespaceHeuristics);
		if (r) {
			return r;
		}
		const lineCount = model.getLineCount();
		const maxColumn = model.getLineMaxColumn(lineCount);
		return new Range(lineCount, maxColumn, lineCount, maxColumn);
	}
}

export class WordPartLeftCommand extends MoveWordCommand {
	protected _move(wordSeparators: WordCharacterClassifier, model: ITextModel, position: Position, wordNavigationType: WordNavigationType): Position {
		return WordPartOperations.moveWordPartLeft(wordSeparators, model, position);
	}
}
export class CursorWordPartLeft extends WordPartLeftCommand {
	constructor() {
		super({
			inSelectionMode: false,
			wordNavigationType: WordNavigationType.WordStart,
			id: 'cursorWordPartLeft',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.LeftArrow },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}
// Register previous id for compatibility purposes
CommandsRegistry.registerCommandAlias('cursorWordPartStartLeft', 'cursorWordPartLeft');

export class CursorWordPartLeftSelect extends WordPartLeftCommand {
	constructor() {
		super({
			inSelectionMode: true,
			wordNavigationType: WordNavigationType.WordStart,
			id: 'cursorWordPartLeftSelect',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyMod.Shift | KeyCode.LeftArrow },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}
// Register previous id for compatibility purposes
CommandsRegistry.registerCommandAlias('cursorWordPartStartLeftSelect', 'cursorWordPartLeftSelect');

export class WordPartRightCommand extends MoveWordCommand {
	protected _move(wordSeparators: WordCharacterClassifier, model: ITextModel, position: Position, wordNavigationType: WordNavigationType): Position {
		return WordPartOperations.moveWordPartRight(wordSeparators, model, position);
	}
}
export class CursorWordPartRight extends WordPartRightCommand {
	constructor() {
		super({
			inSelectionMode: false,
			wordNavigationType: WordNavigationType.WordEnd,
			id: 'cursorWordPartRight',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.RightArrow },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}
export class CursorWordPartRightSelect extends WordPartRightCommand {
	constructor() {
		super({
			inSelectionMode: true,
			wordNavigationType: WordNavigationType.WordEnd,
			id: 'cursorWordPartRightSelect',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyMod.Shift | KeyCode.RightArrow },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
}


registerEditorCommand(new DeleteWordPartLeft());
registerEditorCommand(new DeleteWordPartRight());
registerEditorCommand(new CursorWordPartLeft());
registerEditorCommand(new CursorWordPartLeftSelect());
registerEditorCommand(new CursorWordPartRight());
registerEditorCommand(new CursorWordPartRightSelect());
