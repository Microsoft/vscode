/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import { Position } from 'vs/workbench/api/common/extHostTypes';
import { Range } from 'vs/editor/common/core/range';
import { MainThreadDocumentsShape } from 'vs/workbench/api/common/extHost.protocol';
import { IModelChangedEvent } from 'vs/editor/common/model/mirrorTextModel';
import { mock } from 'vs/base/test/common/mock';
import * as perfData from './extHostDocumentData.test.perf-data';

suite('ExtHostDocumentData', () => {

	let data: ExtHostDocumentData;

	function assertPositionAt(offset: number, line: number, character: number) {
		let position = data.document.positionAt(offset);
		assert.strictEqual(position.line, line);
		assert.strictEqual(position.character, character);
	}

	function assertOffsetAt(line: number, character: number, offset: number) {
		let pos = new Position(line, character);
		let actual = data.document.offsetAt(pos);
		assert.strictEqual(actual, offset);
	}

	setup(function () {
		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			'This is line one', //16
			'and this is line number two', //27
			'it is followed by #3', //20
			'and finished with the fourth.', //29
		], '\n', 1, 'text', false);
	});

	test('readonly-ness', () => {
		assert.throws(() => (data as any).document.uri = null);
		assert.throws(() => (data as any).document.fileName = 'foofile');
		assert.throws(() => (data as any).document.isDirty = false);
		assert.throws(() => (data as any).document.isUntitled = false);
		assert.throws(() => (data as any).document.languageId = 'dddd');
		assert.throws(() => (data as any).document.lineCount = 9);
	});

	test('save, when disposed', function () {
		let saved: URI;
		let data = new ExtHostDocumentData(new class extends mock<MainThreadDocumentsShape>() {
			override $trySaveDocument(uri: URI) {
				assert.ok(!saved);
				saved = uri;
				return Promise.resolve(true);
			}
		}, URI.parse('foo:bar'), [], '\n', 1, 'text', true);

		return data.document.save().then(() => {
			assert.strictEqual(saved.toString(), 'foo:bar');

			data.dispose();

			return data.document.save().then(() => {
				assert.ok(false, 'expected failure');
			}, err => {
				assert.ok(err);
			});
		});
	});

	test('read, when disposed', function () {
		data.dispose();

		const { document } = data;
		assert.strictEqual(document.lineCount, 4);
		assert.strictEqual(document.lineAt(0).text, 'This is line one');
	});

	test('lines', () => {

		assert.strictEqual(data.document.lineCount, 4);

		assert.throws(() => data.document.lineAt(-1));
		assert.throws(() => data.document.lineAt(data.document.lineCount));
		assert.throws(() => data.document.lineAt(Number.MAX_VALUE));
		assert.throws(() => data.document.lineAt(Number.MIN_VALUE));
		assert.throws(() => data.document.lineAt(0.8));

		let line = data.document.lineAt(0);
		assert.strictEqual(line.lineNumber, 0);
		assert.strictEqual(line.text.length, 16);
		assert.strictEqual(line.text, 'This is line one');
		assert.strictEqual(line.isEmptyOrWhitespace, false);
		assert.strictEqual(line.firstNonWhitespaceCharacterIndex, 0);

		data.onEvents({
			changes: [{
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: '\t '
			}],
			eol: undefined!,
			versionId: undefined!,
		});

		// line didn't change
		assert.strictEqual(line.text, 'This is line one');
		assert.strictEqual(line.firstNonWhitespaceCharacterIndex, 0);

		// fetch line again
		line = data.document.lineAt(0);
		assert.strictEqual(line.text, '\t This is line one');
		assert.strictEqual(line.firstNonWhitespaceCharacterIndex, 2);
	});

	test('line, issue #5704', function () {

		let line = data.document.lineAt(0);
		let { range, rangeIncludingLineBreak } = line;
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.end.character, 16);
		assert.strictEqual(rangeIncludingLineBreak.end.line, 1);
		assert.strictEqual(rangeIncludingLineBreak.end.character, 0);

		line = data.document.lineAt(data.document.lineCount - 1);
		range = line.range;
		rangeIncludingLineBreak = line.rangeIncludingLineBreak;
		assert.strictEqual(range.end.line, 3);
		assert.strictEqual(range.end.character, 29);
		assert.strictEqual(rangeIncludingLineBreak.end.line, 3);
		assert.strictEqual(rangeIncludingLineBreak.end.character, 29);

	});

	test('offsetAt', () => {
		assertOffsetAt(0, 0, 0);
		assertOffsetAt(0, 1, 1);
		assertOffsetAt(0, 16, 16);
		assertOffsetAt(1, 0, 17);
		assertOffsetAt(1, 3, 20);
		assertOffsetAt(2, 0, 45);
		assertOffsetAt(4, 29, 95);
		assertOffsetAt(4, 30, 95);
		assertOffsetAt(4, Number.MAX_VALUE, 95);
		assertOffsetAt(5, 29, 95);
		assertOffsetAt(Number.MAX_VALUE, 29, 95);
		assertOffsetAt(Number.MAX_VALUE, Number.MAX_VALUE, 95);
	});

	test('offsetAt, after remove', function () {

		data.onEvents({
			changes: [{
				range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: ''
			}],
			eol: undefined!,
			versionId: undefined!,
		});

		assertOffsetAt(0, 1, 1);
		assertOffsetAt(0, 13, 13);
		assertOffsetAt(1, 0, 14);
	});

	test('offsetAt, after replace', function () {

		data.onEvents({
			changes: [{
				range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: 'is could be'
			}],
			eol: undefined!,
			versionId: undefined!,
		});

		assertOffsetAt(0, 1, 1);
		assertOffsetAt(0, 24, 24);
		assertOffsetAt(1, 0, 25);
	});

	test('offsetAt, after insert line', function () {

		data.onEvents({
			changes: [{
				range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: 'is could be\na line with number'
			}],
			eol: undefined!,
			versionId: undefined!,
		});

		assertOffsetAt(0, 1, 1);
		assertOffsetAt(0, 13, 13);
		assertOffsetAt(1, 0, 14);
		assertOffsetAt(1, 18, 13 + 1 + 18);
		assertOffsetAt(1, 29, 13 + 1 + 29);
		assertOffsetAt(2, 0, 13 + 1 + 29 + 1);
	});

	test('offsetAt, after remove line', function () {

		data.onEvents({
			changes: [{
				range: { startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 6 },
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: ''
			}],
			eol: undefined!,
			versionId: undefined!,
		});

		assertOffsetAt(0, 1, 1);
		assertOffsetAt(0, 2, 2);
		assertOffsetAt(1, 0, 25);
	});

	test('positionAt', () => {
		assertPositionAt(0, 0, 0);
		assertPositionAt(Number.MIN_VALUE, 0, 0);
		assertPositionAt(1, 0, 1);
		assertPositionAt(16, 0, 16);
		assertPositionAt(17, 1, 0);
		assertPositionAt(20, 1, 3);
		assertPositionAt(45, 2, 0);
		assertPositionAt(95, 3, 29);
		assertPositionAt(96, 3, 29);
		assertPositionAt(99, 3, 29);
		assertPositionAt(Number.MAX_VALUE, 3, 29);
	});

	test('getWordRangeAtPosition', () => {
		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			'aaaa bbbb+cccc abc'
		], '\n', 1, 'text', false);

		let range = data.document.getWordRangeAtPosition(new Position(0, 2))!;
		assert.strictEqual(range.start.line, 0);
		assert.strictEqual(range.start.character, 0);
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.end.character, 4);

		// ignore bad regular expresson /.*/
		assert.throws(() => data.document.getWordRangeAtPosition(new Position(0, 2), /.*/)!);

		range = data.document.getWordRangeAtPosition(new Position(0, 5), /[a-z+]+/)!;
		assert.strictEqual(range.start.line, 0);
		assert.strictEqual(range.start.character, 5);
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.end.character, 14);

		range = data.document.getWordRangeAtPosition(new Position(0, 17), /[a-z+]+/)!;
		assert.strictEqual(range.start.line, 0);
		assert.strictEqual(range.start.character, 15);
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.end.character, 18);

		range = data.document.getWordRangeAtPosition(new Position(0, 11), /yy/)!;
		assert.strictEqual(range, undefined);
	});

	test('getWordRangeAtPosition doesn\'t quite use the regex as expected, #29102', function () {
		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			'some text here',
			'/** foo bar */',
			'function() {',
			'	"far boo"',
			'}'
		], '\n', 1, 'text', false);

		let range = data.document.getWordRangeAtPosition(new Position(0, 0), /\/\*.+\*\//);
		assert.strictEqual(range, undefined);

		range = data.document.getWordRangeAtPosition(new Position(1, 0), /\/\*.+\*\//)!;
		assert.strictEqual(range.start.line, 1);
		assert.strictEqual(range.start.character, 0);
		assert.strictEqual(range.end.line, 1);
		assert.strictEqual(range.end.character, 14);

		range = data.document.getWordRangeAtPosition(new Position(3, 0), /("|').*\1/);
		assert.strictEqual(range, undefined);

		range = data.document.getWordRangeAtPosition(new Position(3, 1), /("|').*\1/)!;
		assert.strictEqual(range.start.line, 3);
		assert.strictEqual(range.start.character, 1);
		assert.strictEqual(range.end.line, 3);
		assert.strictEqual(range.end.character, 10);
	});


	test('getWordRangeAtPosition can freeze the extension host #95319', function () {

		const regex = /(https?:\/\/github\.com\/(([^\s]+)\/([^\s]+))\/([^\s]+\/)?(issues|pull)\/([0-9]+))|(([^\s]+)\/([^\s]+))?#([1-9][0-9]*)($|[\s\:\;\-\(\=])/;

		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			perfData._$_$_expensive
		], '\n', 1, 'text', false);

		let range = data.document.getWordRangeAtPosition(new Position(0, 1_177_170), regex)!;
		assert.strictEqual(range, undefined);

		const pos = new Position(0, 1177170);
		range = data.document.getWordRangeAtPosition(pos)!;
		assert.ok(range);
		assert.ok(range.contains(pos));
		assert.strictEqual(data.document.getText(range), 'TaskDefinition');
	});

	test('Rename popup sometimes populates with text on the left side omitted #96013', function () {

		const regex = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;
		const line = 'int abcdefhijklmnopqwvrstxyz;';

		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			line
		], '\n', 1, 'text', false);

		let range = data.document.getWordRangeAtPosition(new Position(0, 27), regex)!;
		assert.strictEqual(range.start.line, 0);
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.start.character, 4);
		assert.strictEqual(range.end.character, 28);
	});

	test('Custom snippet $TM_SELECTED_TEXT not show suggestion #108892', function () {

		data = new ExtHostDocumentData(undefined!, URI.file(''), [
			`        <p><span xml:lang="en">Sheldon</span>, soprannominato "<span xml:lang="en">Shelly</span> dalla madre e dalla sorella, è nato a <span xml:lang="en">Galveston</span>, in <span xml:lang="en">Texas</span>, il 26 febbraio 1980 in un supermercato. È stato un bambino prodigio, come testimoniato dal suo quoziente d'intelligenza (187, di molto superiore alla norma) e dalla sua rapida carriera scolastica: si è diplomato all'eta di 11 anni approdando alla stessa età alla formazione universitaria e all'età di 16 anni ha ottenuto il suo primo dottorato di ricerca. All'inizio della serie e per gran parte di essa vive con il coinquilino Leonard nell'appartamento 4A al 2311 <span xml:lang="en">North Los Robles Avenue</span> di <span xml:lang="en">Pasadena</span>, per poi trasferirsi nell'appartamento di <span xml:lang="en">Penny</span> con <span xml:lang="en">Amy</span> nella decima stagione. Come più volte afferma lui stesso possiede una memoria eidetica e un orecchio assoluto. È stato educato da una madre estremamente religiosa e, in più occasioni, questo aspetto contrasta con il rigore scientifico di <span xml:lang="en">Sheldon</span>; tuttavia la donna sembra essere l'unica persona in grado di comandarlo a bacchetta.</p>`
		], '\n', 1, 'text', false);

		const pos = new Position(0, 55);
		const range = data.document.getWordRangeAtPosition(pos)!;
		assert.strictEqual(range.start.line, 0);
		assert.strictEqual(range.end.line, 0);
		assert.strictEqual(range.start.character, 47);
		assert.strictEqual(range.end.character, 61);
		assert.strictEqual(data.document.getText(range), 'soprannominato');
	});
});

enum AssertDocumentLineMappingDirection {
	OffsetToPosition,
	PositionToOffset
}

suite('ExtHostDocumentData updates line mapping', () => {

	function positionToStr(position: { line: number; character: number; }): string {
		return '(' + position.line + ',' + position.character + ')';
	}

	function assertDocumentLineMapping(doc: ExtHostDocumentData, direction: AssertDocumentLineMappingDirection): void {
		let allText = doc.getText();

		let line = 0, character = 0, previousIsCarriageReturn = false;
		for (let offset = 0; offset <= allText.length; offset++) {
			// The position coordinate system cannot express the position between \r and \n
			const position: Position = new Position(line, character + (previousIsCarriageReturn ? -1 : 0));

			if (direction === AssertDocumentLineMappingDirection.OffsetToPosition) {
				let actualPosition = doc.document.positionAt(offset);
				assert.strictEqual(positionToStr(actualPosition), positionToStr(position), 'positionAt mismatch for offset ' + offset);
			} else {
				// The position coordinate system cannot express the position between \r and \n
				let expectedOffset: number = offset + (previousIsCarriageReturn ? -1 : 0);
				let actualOffset = doc.document.offsetAt(position);
				assert.strictEqual(actualOffset, expectedOffset, 'offsetAt mismatch for position ' + positionToStr(position));
			}

			if (allText.charAt(offset) === '\n') {
				line++;
				character = 0;
			} else {
				character++;
			}

			previousIsCarriageReturn = (allText.charAt(offset) === '\r');
		}
	}

	function createChangeEvent(range: Range, text: string, eol?: string): IModelChangedEvent {
		return {
			changes: [{
				range: range,
				rangeOffset: undefined!,
				rangeLength: undefined!,
				text: text
			}],
			eol: eol!,
			versionId: undefined!,
		};
	}

	function testLineMappingDirectionAfterEvents(lines: string[], eol: string, direction: AssertDocumentLineMappingDirection, e: IModelChangedEvent): void {
		let myDocument = new ExtHostDocumentData(undefined!, URI.file(''), lines.slice(0), eol, 1, 'text', false);
		assertDocumentLineMapping(myDocument, direction);

		myDocument.onEvents(e);
		assertDocumentLineMapping(myDocument, direction);
	}

	function testLineMappingAfterEvents(lines: string[], e: IModelChangedEvent): void {
		testLineMappingDirectionAfterEvents(lines, '\n', AssertDocumentLineMappingDirection.PositionToOffset, e);
		testLineMappingDirectionAfterEvents(lines, '\n', AssertDocumentLineMappingDirection.OffsetToPosition, e);

		testLineMappingDirectionAfterEvents(lines, '\r\n', AssertDocumentLineMappingDirection.PositionToOffset, e);
		testLineMappingDirectionAfterEvents(lines, '\r\n', AssertDocumentLineMappingDirection.OffsetToPosition, e);
	}

	test('line mapping', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], { changes: [], eol: undefined!, versionId: 7 });
	});

	test('after remove', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 1, 6), ''));
	});

	test('after replace', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 1, 6), 'is could be'));
	});

	test('after insert line', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 1, 6), 'is could be\na line with number'));
	});

	test('after insert two lines', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 1, 6), 'is could be\na line with number\nyet another line'));
	});

	test('after remove line', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 2, 6), ''));
	});

	test('after remove two lines', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 3, 6), ''));
	});

	test('after deleting entire content', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 4, 30), ''));
	});

	test('after replacing entire content', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 3, 4, 30), 'some new text\nthat\nspans multiple lines'));
	});

	test('after changing EOL to CRLF', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 1, 1, 1), '', '\r\n'));
	});

	test('after changing EOL to LF', () => {
		testLineMappingAfterEvents([
			'This is line one',
			'and this is line number two',
			'it is followed by #3',
			'and finished with the fourth.',
		], createChangeEvent(new Range(1, 1, 1, 1), '', '\n'));
	});
});
