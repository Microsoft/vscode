/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { ShiftCommand } from 'vs/editor/common/commands/shiftCommand';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IndentAction } from 'vs/editor/common/modes/languageConfiguration';
import { IIndentConverter, LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { IndentConsts } from 'vs/editor/common/modes/supports/indentRules';
import * as indentUtils from 'vs/editor/contrib/indentation/indentUtils';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

export class MoveLinesCommand implements ICommand {

	private readonly _selection: Selection;
	private readonly _isMovingDown: boolean;
	private readonly _autoIndent: EditorAutoIndentStrategy;

	private _selectionId: string | null;
	private _moveEndPositionDown?: boolean;
	private _moveEndLineSelectionShrink: boolean;

	constructor(selection: Selection, isMovingDown: boolean, autoIndent: EditorAutoIndentStrategy) {
		this._selection = selection;
		this._isMovingDown = isMovingDown;
		this._autoIndent = autoIndent;
		this._selectionId = null;
		this._moveEndLineSelectionShrink = false;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {

		let modelLineCount = model.getLineCount();

		if (this._isMovingDown && this._selection.endLineNumber === modelLineCount) {
			this._selectionId = builder.trackSelection(this._selection);
			return;
		}
		if (!this._isMovingDown && this._selection.startLineNumber === 1) {
			this._selectionId = builder.trackSelection(this._selection);
			return;
		}

		this._moveEndPositionDown = false;
		let s = this._selection;

		if (s.startLineNumber < s.endLineNumber && s.endColumn === 1) {
			this._moveEndPositionDown = true;
			s = s.setEndPosition(s.endLineNumber - 1, model.getLineMaxColumn(s.endLineNumber - 1));
		}

		const { tabSize, indentSize, insertSpaces } = model.getOptions();
		let indentConverter = this.buildIndentConverter(tabSize, indentSize, insertSpaces);
		let virtualModel = {
			getLineTokens: (lineNumber: number) => {
				return model.getLineTokens(lineNumber);
			},
			getLanguageIdentifier: () => {
				return model.getLanguageIdentifier();
			},
			getLanguageIdAtPosition: (lineNumber: number, column: number) => {
				return model.getLanguageIdAtPosition(lineNumber, column);
			},
			getLineContent: null as unknown as (lineNumber: number) => string,
		};

		if (s.startLineNumber === s.endLineNumber && model.getLineMaxColumn(s.startLineNumber) === 1) {
			// Current line is empty
			let lineNumber = s.startLineNumber;
			let otherLineNumber = (this._isMovingDown ? lineNumber + 1 : lineNumber - 1);

			if (model.getLineMaxColumn(otherLineNumber) === 1) {
				// Other line number is empty too, so no editing is needed
				// Add a no-op to force running by the model
				builder.addEditOperation(new Range(1, 1, 1, 1), null);
			} else {
				// Type content from other line number on line number
				builder.addEditOperation(new Range(lineNumber, 1, lineNumber, 1), model.getLineContent(otherLineNumber));

				// Remove content from other line number
				builder.addEditOperation(new Range(otherLineNumber, 1, otherLineNumber, model.getLineMaxColumn(otherLineNumber)), null);
			}
			// Track selection at the other line number
			s = new Selection(otherLineNumber, 1, otherLineNumber, 1);

		} else {

			let movingLineNumber: number;
			let movingLineText: string;

			if (this._isMovingDown) {
				movingLineNumber = s.endLineNumber + 1;
				movingLineText = model.getLineContent(movingLineNumber);
				// Delete line that needs to be moved
				builder.addEditOperation(new Range(movingLineNumber - 1, model.getLineMaxColumn(movingLineNumber - 1), movingLineNumber, model.getLineMaxColumn(movingLineNumber)), null);

				let insertingText = movingLineText;

				if (this.shouldAutoIndent(model, s)) {
					let movingLineMatchResult = this.matchEnterRule(model, indentConverter, tabSize, movingLineNumber, s.startLineNumber - 1);
					// if s.startLineNumber - 1 matches onEnter rule, we still honor that.
					if (movingLineMatchResult !== null) {
						let oldIndentation = strings.getLeadingWhitespace(model.getLineContent(movingLineNumber));
						let newSpaceCnt = movingLineMatchResult + indentUtils.getSpaceCnt(oldIndentation, tabSize);
						let newIndentation = indentUtils.generateIndent(newSpaceCnt, tabSize, insertSpaces);
						insertingText = newIndentation + this.trimLeft(movingLineText);
					} else {
						// no enter rule matches, let's check indentatin rules then.
						virtualModel.getLineContent = (lineNumber: number) => {
							if (lineNumber === s.startLineNumber) {
								return model.getLineContent(movingLineNumber);
							} else {
								return model.getLineContent(lineNumber);
							}
						};
						let indentOfMovingLine = LanguageConfigurationRegistry.getGoodIndentForLine(this._autoIndent, virtualModel, model.getLanguageIdAtPosition(
							movingLineNumber, 1), s.startLineNumber, indentConverter);
						if (indentOfMovingLine !== null) {
							let oldIndentation = strings.getLeadingWhitespace(model.getLineContent(movingLineNumber));
							let newSpaceCnt = indentUtils.getSpaceCnt(indentOfMovingLine, tabSize);
							let oldSpaceCnt = indentUtils.getSpaceCnt(oldIndentation, tabSize);
							if (newSpaceCnt !== oldSpaceCnt) {
								let newIndentation = indentUtils.generateIndent(newSpaceCnt, tabSize, insertSpaces);
								insertingText = newIndentation + this.trimLeft(movingLineText);
							}
						}
					}

					// add edit operations for moving line first to make sure it's executed after we make indentation change
					// to s.startLineNumber
					builder.addEditOperation(new Range(s.startLineNumber, 1, s.startLineNumber, 1), insertingText + '\n');

					let ret = this.matchEnterRule(model, indentConverter, tabSize, s.startLineNumber, s.startLineNumber, insertingText);
					// check if the line being moved before matches onEnter rules, if so let's adjust the indentation by onEnter rules.
					if (ret !== null) {
						if (ret !== 0) {
							this.getIndentEditsOfMovingBlock(model, builder, s, tabSize, insertSpaces, ret);
						}
					} else {
						// it doesn't match onEnter rules, let's check indentation rules then.
						virtualModel.getLineContent = (lineNumber: number) => {
							if (lineNumber === s.startLineNumber) {
								return insertingText;
							} else if (lineNumber >= s.startLineNumber + 1 && lineNumber <= s.endLineNumber + 1) {
								return model.getLineContent(lineNumber - 1);
							} else {
								return model.getLineContent(lineNumber);
							}
						};

						let newIndentatOfMovingBlock = LanguageConfigurationRegistry.getGoodIndentForLine(this._autoIndent, virtualModel, model.getLanguageIdAtPosition(
							movingLineNumber, 1), s.startLineNumber + 1, indentConverter);

						if (newIndentatOfMovingBlock !== null) {
							const oldIndentation = strings.getLeadingWhitespace(model.getLineContent(s.startLineNumber));
							const newSpaceCnt = indentUtils.getSpaceCnt(newIndentatOfMovingBlock, tabSize);
							const oldSpaceCnt = indentUtils.getSpaceCnt(oldIndentation, tabSize);
							if (newSpaceCnt !== oldSpaceCnt) {
								const spaceCntOffset = newSpaceCnt - oldSpaceCnt;

								this.getIndentEditsOfMovingBlock(model, builder, s, tabSize, insertSpaces, spaceCntOffset);
							}
						}
					}
				} else {
					// Insert line that needs to be moved before
					builder.addEditOperation(new Range(s.startLineNumber, 1, s.startLineNumber, 1), insertingText + '\n');
				}
			} else {
				movingLineNumber = s.startLineNumber - 1;
				movingLineText = model.getLineContent(movingLineNumber);

				// Delete line that needs to be moved
				builder.addEditOperation(new Range(movingLineNumber, 1, movingLineNumber + 1, 1), null);

				// Insert line that needs to be moved after
				builder.addEditOperation(new Range(s.endLineNumber, model.getLineMaxColumn(s.endLineNumber), s.endLineNumber, model.getLineMaxColumn(s.endLineNumber)), '\n' + movingLineText);

				if (this.shouldAutoIndent(model, s)) {
					virtualModel.getLineContent = (lineNumber: number) => {
						if (lineNumber === movingLineNumber) {
							return model.getLineContent(s.startLineNumber);
						} else {
							return model.getLineContent(lineNumber);
						}
					};

					let ret = this.matchEnterRule(model, indentConverter, tabSize, s.startLineNumber, s.startLineNumber - 2);
					// check if s.startLineNumber - 2 matches onEnter rules, if so adjust the moving block by onEnter rules.
					if (ret !== null) {
						if (ret !== 0) {
							this.getIndentEditsOfMovingBlock(model, builder, s, tabSize, insertSpaces, ret);
						}
					} else {
						// it doesn't match any onEnter rule, let's check indentation rules then.
						let indentOfFirstLine = LanguageConfigurationRegistry.getGoodIndentForLine(this._autoIndent, virtualModel, model.getLanguageIdAtPosition(s.startLineNumber, 1), movingLineNumber, indentConverter);
						if (indentOfFirstLine !== null) {
							// adjust the indentation of the moving block
							let oldIndent = strings.getLeadingWhitespace(model.getLineContent(s.startLineNumber));
							let newSpaceCnt = indentUtils.getSpaceCnt(indentOfFirstLine, tabSize);
							let oldSpaceCnt = indentUtils.getSpaceCnt(oldIndent, tabSize);
							if (newSpaceCnt !== oldSpaceCnt) {
								let spaceCntOffset = newSpaceCnt - oldSpaceCnt;

								this.getIndentEditsOfMovingBlock(model, builder, s, tabSize, insertSpaces, spaceCntOffset);
							}
						}
					}
				}
			}
		}

		this._selectionId = builder.trackSelection(s);
	}

	private buildIndentConverter(tabSize: number, indentSize: number, insertSpaces: boolean): IIndentConverter {
		return {
			shiftIndent: (indentation) => {
				return ShiftCommand.shiftIndent(indentation, indentation.length + 1, tabSize, indentSize, insertSpaces);
			},
			unshiftIndent: (indentation) => {
				return ShiftCommand.unshiftIndent(indentation, indentation.length + 1, tabSize, indentSize, insertSpaces);
			}
		};
	}

	private matchEnterRule(model: ITextModel, indentConverter: IIndentConverter, tabSize: number, line: number, oneLineAbove: number, oneLineAboveText?: string) {
		let validPrecedingLine = oneLineAbove;
		while (validPrecedingLine >= 1) {
			// ship empty lines as empty lines just inherit indentation
			let lineContent;
			if (validPrecedingLine === oneLineAbove && oneLineAboveText !== undefined) {
				lineContent = oneLineAboveText;
			} else {
				lineContent = model.getLineContent(validPrecedingLine);
			}

			let nonWhitespaceIdx = strings.lastNonWhitespaceIndex(lineContent);
			if (nonWhitespaceIdx >= 0) {
				break;
			}
			validPrecedingLine--;
		}

		if (validPrecedingLine < 1 || line > model.getLineCount()) {
			return null;
		}

		let maxColumn = model.getLineMaxColumn(validPrecedingLine);
		let enter = LanguageConfigurationRegistry.getEnterAction(this._autoIndent, model, new Range(validPrecedingLine, maxColumn, validPrecedingLine, maxColumn));

		if (enter) {
			let enterPrefix = enter.indentation;

			if (enter.indentAction === IndentAction.None) {
				enterPrefix = enter.indentation + enter.appendText;
			} else if (enter.indentAction === IndentAction.Indent) {
				enterPrefix = enter.indentation + enter.appendText;
			} else if (enter.indentAction === IndentAction.IndentOutdent) {
				enterPrefix = enter.indentation;
			} else if (enter.indentAction === IndentAction.Outdent) {
				enterPrefix = indentConverter.unshiftIndent(enter.indentation) + enter.appendText;
			}
			let movingLineText = model.getLineContent(line);
			if (this.trimLeft(movingLineText).indexOf(this.trimLeft(enterPrefix)) >= 0) {
				let oldIndentation = strings.getLeadingWhitespace(model.getLineContent(line));
				let newIndentation = strings.getLeadingWhitespace(enterPrefix);
				let indentMetadataOfMovelingLine = LanguageConfigurationRegistry.getIndentMetadata(model, line);
				if (indentMetadataOfMovelingLine !== null && indentMetadataOfMovelingLine & IndentConsts.DECREASE_MASK) {
					newIndentation = indentConverter.unshiftIndent(newIndentation);
				}
				let newSpaceCnt = indentUtils.getSpaceCnt(newIndentation, tabSize);
				let oldSpaceCnt = indentUtils.getSpaceCnt(oldIndentation, tabSize);
				return newSpaceCnt - oldSpaceCnt;
			}
		}

		return null;
	}

	private trimLeft(str: string) {
		return str.replace(/^\s+/, '');
	}

	private shouldAutoIndent(model: ITextModel, selection: Selection) {
		if (this._autoIndent < EditorAutoIndentStrategy.Full) {
			return false;
		}
		// if it's not easy to tokenize, we stop auto indent.
		if (!model.isCheapToTokenize(selection.startLineNumber)) {
			return false;
		}
		let languageAtSelectionStart = model.getLanguageIdAtPosition(selection.startLineNumber, 1);
		let languageAtSelectionEnd = model.getLanguageIdAtPosition(selection.endLineNumber, 1);

		if (languageAtSelectionStart !== languageAtSelectionEnd) {
			return false;
		}

		if (LanguageConfigurationRegistry.getIndentRulesSupport(languageAtSelectionStart) === null) {
			return false;
		}

		return true;
	}

	private getIndentEditsOfMovingBlock(model: ITextModel, builder: IEditOperationBuilder, s: Selection, tabSize: number, insertSpaces: boolean, offset: number) {
		for (let i = s.startLineNumber; i <= s.endLineNumber; i++) {
			let lineContent = model.getLineContent(i);
			let originalIndent = strings.getLeadingWhitespace(lineContent);
			let originalSpacesCnt = indentUtils.getSpaceCnt(originalIndent, tabSize);
			let newSpacesCnt = originalSpacesCnt + offset;
			let newIndent = indentUtils.generateIndent(newSpacesCnt, tabSize, insertSpaces);

			if (newIndent !== originalIndent) {
				builder.addEditOperation(new Range(i, 1, i, originalIndent.length + 1), newIndent);

				if (i === s.endLineNumber && s.endColumn <= originalIndent.length + 1 && newIndent === '') {
					// as users select part of the original indent white spaces
					// when we adjust the indentation of endLine, we should adjust the cursor position as well.
					this._moveEndLineSelectionShrink = true;
				}
			}

		}
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let result = helper.getTrackedSelection(this._selectionId!);

		if (this._moveEndPositionDown) {
			result = result.setEndPosition(result.endLineNumber + 1, 1);
		}

		if (this._moveEndLineSelectionShrink && result.startLineNumber < result.endLineNumber) {
			result = result.setEndPosition(result.endLineNumber, 2);
		}

		return result;
	}
}
