/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, IActionOptions, registerEditorAction, registerEditorContribution, ServicesAccessor, registerModelCommand } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { MenuId } from 'vs/platform/actions/common/actions';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { WordSelectionRangeProvider } from 'vs/editor/contrib/smartSelect/wordSelections';
import { BracketSelectionRangeProvider } from 'vs/editor/contrib/smartSelect/bracketSelections';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { onUnexpectedExternalError } from 'vs/base/common/errors';

class SelectionRanges {

	constructor(
		readonly index: number,
		readonly ranges: Range[]
	) { }

	mov(fwd: boolean): SelectionRanges {
		let index = this.index + (fwd ? 1 : -1);
		if (index < 0 || index >= this.ranges.length) {
			return this;
		}
		const res = new SelectionRanges(index, this.ranges);
		if (res.ranges[index].equalsRange(this.ranges[this.index])) {
			// next range equals this range, retry with next-next
			return res.mov(fwd);
		}
		return res;
	}
}

class SmartSelectController implements IEditorContribution {

	public static readonly ID = 'editor.contrib.smartSelectController';

	static get(editor: ICodeEditor): SmartSelectController {
		return editor.getContribution<SmartSelectController>(SmartSelectController.ID);
	}

	private readonly _editor: ICodeEditor;

	private _state?: SelectionRanges[];
	private _selectionListener?: IDisposable;
	private _ignoreSelection: boolean = false;

	constructor(editor: ICodeEditor) {
		this._editor = editor;
	}

	dispose(): void {
		dispose(this._selectionListener);
	}

	run(forward: boolean): Promise<void> | void {
		if (!this._editor.hasModel()) {
			return;
		}

		const selections = this._editor.getSelections();
		const model = this._editor.getModel();

		if (!modes.SelectionRangeRegistry.has(model)) {
			return;
		}


		let promise: Promise<void> = Promise.resolve(undefined);

		if (!this._state) {
			promise = provideSelectionRanges(model, selections.map(s => s.getPosition()), CancellationToken.None).then(ranges => {
				if (!arrays.isNonEmptyArray(ranges) || ranges.length !== selections.length) {
					// invalid result
					return;
				}
				if (!this._editor.hasModel() || !arrays.equals(this._editor.getSelections(), selections, (a, b) => a.equalsSelection(b))) {
					// invalid editor state
					return;
				}

				for (let i = 0; i < ranges.length; i++) {
					ranges[i] = ranges[i].filter(range => {
						// filter ranges inside the selection
						return range.containsPosition(selections[i].getStartPosition()) && range.containsPosition(selections[i].getEndPosition());
					});
					// prepend current selection
					ranges[i].unshift(selections[i]);
				}


				this._state = ranges.map(ranges => new SelectionRanges(0, ranges));

				// listen to caret move and forget about state
				dispose(this._selectionListener);
				this._selectionListener = this._editor.onDidChangeCursorPosition(() => {
					if (!this._ignoreSelection) {
						dispose(this._selectionListener);
						this._state = undefined;
					}
				});
			});
		}

		return promise.then(() => {
			if (!this._state) {
				// no state
				return;
			}
			this._state = this._state.map(state => state.mov(forward));
			const selections = this._state.map(state => Selection.fromPositions(state.ranges[state.index].getStartPosition(), state.ranges[state.index].getEndPosition()));
			this._ignoreSelection = true;
			try {
				this._editor.setSelections(selections);
			} finally {
				this._ignoreSelection = false;
			}

		});
	}
}

abstract class AbstractSmartSelect extends EditorAction {

	private readonly _forward: boolean;

	constructor(forward: boolean, opts: IActionOptions) {
		super(opts);
		this._forward = forward;
	}

	async run(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		let controller = SmartSelectController.get(editor);
		if (controller) {
			await controller.run(this._forward);
		}
	}
}

class GrowSelectionAction extends AbstractSmartSelect {
	constructor() {
		super(true, {
			id: 'editor.action.smartSelect.expand',
			label: nls.localize('smartSelect.expand', "Expand Selection"),
			alias: 'Expand Selection',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.RightArrow,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyMod.Shift | KeyCode.RightArrow,
					secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.RightArrow],
				},
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarSelectionMenu,
				group: '1_basic',
				title: nls.localize({ key: 'miSmartSelectGrow', comment: ['&& denotes a mnemonic'] }, "&&Expand Selection"),
				order: 2
			}
		});
	}
}

// renamed command id
CommandsRegistry.registerCommandAlias('editor.action.smartSelect.grow', 'editor.action.smartSelect.expand');

class ShrinkSelectionAction extends AbstractSmartSelect {
	constructor() {
		super(false, {
			id: 'editor.action.smartSelect.shrink',
			label: nls.localize('smartSelect.shrink', "Shrink Selection"),
			alias: 'Shrink Selection',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Shift | KeyMod.Alt | KeyCode.LeftArrow,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyMod.Shift | KeyCode.LeftArrow,
					secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.LeftArrow],
				},
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarSelectionMenu,
				group: '1_basic',
				title: nls.localize({ key: 'miSmartSelectShrink', comment: ['&& denotes a mnemonic'] }, "&&Shrink Selection"),
				order: 3
			}
		});
	}
}

registerEditorContribution(SmartSelectController.ID, SmartSelectController);
registerEditorAction(GrowSelectionAction);
registerEditorAction(ShrinkSelectionAction);

// word selection
modes.SelectionRangeRegistry.register('*', new WordSelectionRangeProvider());

export function provideSelectionRanges(model: ITextModel, positions: Position[], token: CancellationToken): Promise<Range[][]> {

	const providers = modes.SelectionRangeRegistry.all(model);

	if (providers.length === 1) {
		// add word selection and bracket selection when no provider exists
		providers.unshift(new BracketSelectionRangeProvider());
	}

	let work: Promise<any>[] = [];
	let allRawRanges: Range[][] = [];

	for (const provider of providers) {

		work.push(Promise.resolve(provider.provideSelectionRanges(model, positions, token)).then(allProviderRanges => {
			if (arrays.isNonEmptyArray(allProviderRanges) && allProviderRanges.length === positions.length) {
				for (let i = 0; i < positions.length; i++) {
					if (!allRawRanges[i]) {
						allRawRanges[i] = [];
					}
					for (const oneProviderRanges of allProviderRanges[i]) {
						if (Range.isIRange(oneProviderRanges.range) && Range.containsPosition(oneProviderRanges.range, positions[i])) {
							allRawRanges[i].push(Range.lift(oneProviderRanges.range));
						}
					}
				}
			}
		}, onUnexpectedExternalError));
	}

	return Promise.all(work).then(() => {

		return allRawRanges.map(oneRawRanges => {

			if (oneRawRanges.length === 0) {
				return [];
			}

			// sort all by start/end position
			oneRawRanges.sort((a, b) => {
				if (Position.isBefore(a.getStartPosition(), b.getStartPosition())) {
					return 1;
				} else if (Position.isBefore(b.getStartPosition(), a.getStartPosition())) {
					return -1;
				} else if (Position.isBefore(a.getEndPosition(), b.getEndPosition())) {
					return -1;
				} else if (Position.isBefore(b.getEndPosition(), a.getEndPosition())) {
					return 1;
				} else {
					return 0;
				}
			});

			// remove ranges that don't contain the former range or that are equal to the
			// former range
			let oneRanges: Range[] = [];
			let last: Range | undefined;
			for (const range of oneRawRanges) {
				if (!last || (Range.containsRange(range, last) && !Range.equalsRange(range, last))) {
					oneRanges.push(range);
					last = range;
				}
			}

			// add ranges that expand trivia at line starts and ends whenever a range
			// wraps onto the a new line
			let oneRangesWithTrivia: Range[] = [oneRanges[0]];
			for (let i = 1; i < oneRanges.length; i++) {
				const prev = oneRanges[i - 1];
				const cur = oneRanges[i];
				if (cur.startLineNumber !== prev.startLineNumber || cur.endLineNumber !== prev.endLineNumber) {
					// add line/block range without leading/failing whitespace
					const rangeNoWhitespace = new Range(prev.startLineNumber, model.getLineFirstNonWhitespaceColumn(prev.startLineNumber), prev.endLineNumber, model.getLineLastNonWhitespaceColumn(prev.endLineNumber));
					if (rangeNoWhitespace.containsRange(prev) && !rangeNoWhitespace.equalsRange(prev) && cur.containsRange(rangeNoWhitespace) && !cur.equalsRange(rangeNoWhitespace)) {
						oneRangesWithTrivia.push(rangeNoWhitespace);
					}
					// add line/block range
					const rangeFull = new Range(prev.startLineNumber, 1, prev.endLineNumber, model.getLineMaxColumn(prev.endLineNumber));
					if (rangeFull.containsRange(prev) && !rangeFull.equalsRange(rangeNoWhitespace) && cur.containsRange(rangeFull) && !cur.equalsRange(rangeFull)) {
						oneRangesWithTrivia.push(rangeFull);
					}
				}
				oneRangesWithTrivia.push(cur);
			}
			return oneRangesWithTrivia;
		});
	});
}

registerModelCommand('_executeSelectionRangeProvider', function (model, ...args) {
	const [positions] = args;
	return provideSelectionRanges(model, positions, CancellationToken.None);
});
