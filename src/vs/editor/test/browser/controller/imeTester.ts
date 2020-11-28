/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createFastDomNode } from 'vs/base/browser/fastDomNode';
import { ITextAreaInputHost, TextAreaInput } from 'vs/editor/browser/controller/textAreaInput';
import { ISimpleModel, PagedScreenReaderStrategy, TextAreaState } from 'vs/editor/browser/controller/textAreaState';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { EndOfLinePreference } from 'vs/editor/common/model';
import * as dom from 'vs/base/browser/dom';

// To run this test, open imeTester.html

class SingleLineTestModel implements ISimpleModel {

	private _line: string;

	constructor(line: string) {
		this._line = line;
	}

	_setText(text: string) {
		this._line = text;
	}

	getLineMaxColumn(lineNumber: number): number {
		return this._line.length + 1;
	}

	getValueInRange(range: IRange, eol: EndOfLinePreference): string {
		return this._line.substring(range.startColumn - 1, range.endColumn - 1);
	}

	getModelLineContent(lineNumber: number): string {
		return this._line;
	}

	getLineCount(): number {
		return 1;
	}
}

class TestView {

	private readonly _model: SingleLineTestModel;

	constructor(model: SingleLineTestModel) {
		this._model = model;
	}

	public paint(output: HTMLElement) {
		dom.clearNode(output);
		for (let i = 1; i <= this._model.getLineCount(); i++) {
			const textNode = document.createTextNode(this._model.getModelLineContent(i));
			output.appendChild(textNode);
			const br = document.createElement('br');
			output.appendChild(br);
		}
	}
}

function doCreateTest(description: string, inputStr: string, expectedStr: string): HTMLElement {
	let cursorOffset: number = 0;
	let cursorLength: number = 0;

	let container = document.createElement('div');
	container.className = 'container';

	let title = document.createElement('div');
	title.className = 'title';

	const inputStrStrong = document.createElement('strong');
	inputStrStrong.innerText = inputStr;

	title.innerText = description + '. Type ';
	title.appendChild(inputStrStrong);

	container.appendChild(title);

	let startBtn = document.createElement('button');
	startBtn.innerText = 'Start';
	container.appendChild(startBtn);


	let input = document.createElement('textarea');
	input.setAttribute('rows', '10');
	input.setAttribute('cols', '40');
	container.appendChild(input);

	let model = new SingleLineTestModel('some  text');

	const textAreaInputHost: ITextAreaInputHost = {
		getDataToCopy: () => {
			return {
				isFromEmptySelection: false,
				multicursorText: null,
				text: '',
				html: undefined,
				mode: null
			};
		},
		getScreenReaderContent: (currentState: TextAreaState): TextAreaState => {
			const selection = new Range(1, 1 + cursorOffset, 1, 1 + cursorOffset + cursorLength);

			return PagedScreenReaderStrategy.fromEditorSelection(currentState, model, selection, 10, true);
		},
		deduceModelPosition: (viewAnchorPosition: Position, deltaOffset: number, lineFeedCnt: number): Position => {
			return null!;
		}
	};

	let handler = new TextAreaInput(textAreaInputHost, createFastDomNode(input));

	let output = document.createElement('pre');
	output.className = 'output';
	container.appendChild(output);

	let check = document.createElement('pre');
	check.className = 'check';
	container.appendChild(check);

	let br = document.createElement('br');
	br.style.clear = 'both';
	container.appendChild(br);

	let view = new TestView(model);

	let updatePosition = (off: number, len: number) => {
		cursorOffset = off;
		cursorLength = len;
		handler.writeScreenReaderContent('selection changed');
		handler.focusTextArea();
	};

	let updateModelAndPosition = (text: string, off: number, len: number) => {
		model._setText(text);
		updatePosition(off, len);
		view.paint(output);

		let expected = 'some ' + expectedStr + ' text';
		if (text === expected) {
			check.innerText = '[GOOD]';
			check.className = 'check good';
		} else {
			check.innerText = '[BAD]';
			check.className = 'check bad';
		}
		check.appendChild(document.createTextNode(expected));
	};

	handler.onType((e) => {
		console.log('type text: ' + e.text + ', replaceCharCnt: ' + e.replaceCharCnt);
		let text = model.getModelLineContent(1);
		let preText = text.substring(0, cursorOffset - e.replaceCharCnt);
		let postText = text.substring(cursorOffset + cursorLength);
		let midText = e.text;

		updateModelAndPosition(preText + midText + postText, (preText + midText).length, 0);
	});

	view.paint(output);

	startBtn.onclick = function () {
		updateModelAndPosition('some  text', 5, 0);
		input.focus();
	};

	return container;
}

const TESTS = [
	{ description: 'Japanese IME 1', in: 'sennsei [Enter]', out: 'せんせい' },
	{ description: 'Japanese IME 2', in: 'konnichiha [Enter]', out: 'こんいちは' },
	{ description: 'Japanese IME 3', in: 'mikann [Enter]', out: 'みかん' },
	{ description: 'Korean IME 1', in: 'gksrmf [Space]', out: '한글 ' },
	{ description: 'Chinese IME 1', in: '.,', out: '。，' },
	{ description: 'Chinese IME 2', in: 'ni [Space] hao [Space]', out: '你好' },
	{ description: 'Chinese IME 3', in: 'hazni [Space]', out: '哈祝你' },
	{ description: 'Mac dead key 1', in: '`.', out: '`.' },
	{ description: 'Mac hold key 1', in: 'e long press and 1', out: 'é' }
];

TESTS.forEach((t) => {
	document.body.appendChild(doCreateTest(t.description, t.in, t.out));
});
