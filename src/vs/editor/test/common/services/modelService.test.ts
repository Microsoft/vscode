/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CharCode } from 'vs/base/common/charCode';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { createStringBuilder } from 'vs/editor/common/core/stringBuilder';
import { DefaultEndOfLine } from 'vs/editor/common/model';
import { createTextBuffer } from 'vs/editor/common/model/textModel';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { NullLogService } from 'vs/platform/log/common/log';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

const GENERATE_TESTS = false;

suite('ModelService', () => {
	let modelService: ModelServiceImpl;

	setup(() => {
		const configService = new TestConfigurationService();
		configService.setUserConfiguration('files', { 'eol': '\n' });
		configService.setUserConfiguration('files', { 'eol': '\r\n' }, URI.file(platform.isWindows ? 'c:\\myroot' : '/myroot'));

		const dialogService = new TestDialogService();
		modelService = new ModelServiceImpl(configService, new TestTextResourcePropertiesService(configService), new TestThemeService(), new NullLogService(), new UndoRedoService(dialogService, new TestNotificationService()));
	});

	teardown(() => {
		modelService.dispose();
	});

	test('EOL setting respected depending on root', () => {
		const model1 = modelService.createModel('farboo', null);
		const model2 = modelService.createModel('farboo', null, URI.file(platform.isWindows ? 'c:\\myroot\\myfile.txt' : '/myroot/myfile.txt'));
		const model3 = modelService.createModel('farboo', null, URI.file(platform.isWindows ? 'c:\\other\\myfile.txt' : '/other/myfile.txt'));

		assert.equal(model1.getOptions().defaultEOL, DefaultEndOfLine.LF);
		assert.equal(model2.getOptions().defaultEOL, DefaultEndOfLine.CRLF);
		assert.equal(model3.getOptions().defaultEOL, DefaultEndOfLine.LF);
	});

	test('_computeEdits no change', function () {

		const model = createTextModel(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n')
		);

		const textBuffer = createTextBuffer(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n'),
			DefaultEndOfLine.LF
		);

		const actual = ModelServiceImpl._computeEdits(model, textBuffer);

		assert.deepEqual(actual, []);
	});

	test('_computeEdits first line changed', function () {

		const model = createTextModel(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n')
		);

		const textBuffer = createTextBuffer(
			[
				'This is line One', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n'),
			DefaultEndOfLine.LF
		);

		const actual = ModelServiceImpl._computeEdits(model, textBuffer);

		assert.deepEqual(actual, [
			EditOperation.replaceMove(new Range(1, 1, 2, 1), 'This is line One\n')
		]);
	});

	test('_computeEdits EOL changed', function () {

		const model = createTextModel(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n')
		);

		const textBuffer = createTextBuffer(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\r\n'),
			DefaultEndOfLine.LF
		);

		const actual = ModelServiceImpl._computeEdits(model, textBuffer);

		assert.deepEqual(actual, []);
	});

	test('_computeEdits EOL and other change 1', function () {

		const model = createTextModel(
			[
				'This is line one', //16
				'and this is line number two', //27
				'it is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\n')
		);

		const textBuffer = createTextBuffer(
			[
				'This is line One', //16
				'and this is line number two', //27
				'It is followed by #3', //20
				'and finished with the fourth.', //29
			].join('\r\n'),
			DefaultEndOfLine.LF
		);

		const actual = ModelServiceImpl._computeEdits(model, textBuffer);

		assert.deepEqual(actual, [
			EditOperation.replaceMove(
				new Range(1, 1, 4, 1),
				[
					'This is line One',
					'and this is line number two',
					'It is followed by #3',
					''
				].join('\r\n')
			)
		]);
	});

	test('_computeEdits EOL and other change 2', function () {

		const model = createTextModel(
			[
				'package main',	// 1
				'func foo() {',	// 2
				'}'				// 3
			].join('\n')
		);

		const textBuffer = createTextBuffer(
			[
				'package main',	// 1
				'func foo() {',	// 2
				'}',			// 3
				''
			].join('\r\n'),
			DefaultEndOfLine.LF
		);

		const actual = ModelServiceImpl._computeEdits(model, textBuffer);

		assert.deepEqual(actual, [
			EditOperation.replaceMove(new Range(3, 2, 3, 2), '\r\n')
		]);
	});

	test('generated1', () => {
		const file1 = ['pram', 'okctibad', 'pjuwtemued', 'knnnm', 'u', ''];
		const file2 = ['tcnr', 'rxwlicro', 'vnzy', '', '', 'pjzcogzur', 'ptmxyp', 'dfyshia', 'pee', 'ygg'];
		assertComputeEdits(file1, file2);
	});

	test('generated2', () => {
		const file1 = ['', 'itls', 'hrilyhesv', ''];
		const file2 = ['vdl', '', 'tchgz', 'bhx', 'nyl'];
		assertComputeEdits(file1, file2);
	});

	test('generated3', () => {
		const file1 = ['ubrbrcv', 'wv', 'xodspybszt', 's', 'wednjxm', 'fklajt', 'fyfc', 'lvejgge', 'rtpjlodmmk', 'arivtgmjdm'];
		const file2 = ['s', 'qj', 'tu', 'ur', 'qerhjjhyvx', 't'];
		assertComputeEdits(file1, file2);
	});

	test('generated4', () => {
		const file1 = ['ig', 'kh', 'hxegci', 'smvker', 'pkdmjjdqnv', 'vgkkqqx', '', 'jrzeb'];
		const file2 = ['yk', ''];
		assertComputeEdits(file1, file2);
	});

	test('does insertions in the middle of the document', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3'
		];
		const file2 = [
			'line 1',
			'line 2',
			'line 5',
			'line 3'
		];
		assertComputeEdits(file1, file2);
	});

	test('does insertions at the end of the document', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3'
		];
		const file2 = [
			'line 1',
			'line 2',
			'line 3',
			'line 4'
		];
		assertComputeEdits(file1, file2);
	});

	test('does insertions at the beginning of the document', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3'
		];
		const file2 = [
			'line 0',
			'line 1',
			'line 2',
			'line 3'
		];
		assertComputeEdits(file1, file2);
	});

	test('does replacements', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3'
		];
		const file2 = [
			'line 1',
			'line 7',
			'line 3'
		];
		assertComputeEdits(file1, file2);
	});

	test('does deletions', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3'
		];
		const file2 = [
			'line 1',
			'line 3'
		];
		assertComputeEdits(file1, file2);
	});

	test('does insert, replace, and delete', () => {
		const file1 = [
			'line 1',
			'line 2',
			'line 3',
			'line 4',
			'line 5',
		];
		const file2 = [
			'line 0', // insert line 0
			'line 1',
			'replace line 2', // replace line 2
			'line 3',
			// delete line 4
			'line 5',
		];
		assertComputeEdits(file1, file2);
	});

	test('maintains undo for same resource and same content', () => {
		const resource = URI.parse('file://test.txt');

		// create a model
		const model1 = modelService.createModel('text', null, resource);
		// make an edit
		model1.pushEditOperations(null, [{ range: new Range(1, 5, 1, 5), text: '1' }], () => [new Selection(1, 5, 1, 5)]);
		assert.equal(model1.getValue(), 'text1');
		// dispose it
		modelService.destroyModel(resource);

		// create a new model with the same content
		const model2 = modelService.createModel('text1', null, resource);
		// undo
		model2.undo();
		assert.equal(model2.getValue(), 'text');
	});

	test('maintains version id and alternative version id for same resource and same content', () => {
		const resource = URI.parse('file://test.txt');

		// create a model
		const model1 = modelService.createModel('text', null, resource);
		// make an edit
		model1.pushEditOperations(null, [{ range: new Range(1, 5, 1, 5), text: '1' }], () => [new Selection(1, 5, 1, 5)]);
		assert.equal(model1.getValue(), 'text1');
		const versionId = model1.getVersionId();
		const alternativeVersionId = model1.getAlternativeVersionId();
		// dispose it
		modelService.destroyModel(resource);

		// create a new model with the same content
		const model2 = modelService.createModel('text1', null, resource);
		assert.equal(model2.getVersionId(), versionId);
		assert.equal(model2.getAlternativeVersionId(), alternativeVersionId);
	});

	test('does not maintain undo for same resource and different content', () => {
		const resource = URI.parse('file://test.txt');

		// create a model
		const model1 = modelService.createModel('text', null, resource);
		// make an edit
		model1.pushEditOperations(null, [{ range: new Range(1, 5, 1, 5), text: '1' }], () => [new Selection(1, 5, 1, 5)]);
		assert.equal(model1.getValue(), 'text1');
		// dispose it
		modelService.destroyModel(resource);

		// create a new model with the same content
		const model2 = modelService.createModel('text2', null, resource);
		// undo
		model2.undo();
		assert.equal(model2.getValue(), 'text2');
	});

	test('setValue should clear undo stack', () => {
		const resource = URI.parse('file://test.txt');

		const model = modelService.createModel('text', null, resource);
		model.pushEditOperations(null, [{ range: new Range(1, 5, 1, 5), text: '1' }], () => [new Selection(1, 5, 1, 5)]);
		assert.equal(model.getValue(), 'text1');

		model.setValue('text2');
		model.undo();
		assert.equal(model.getValue(), 'text2');
	});
});

function assertComputeEdits(lines1: string[], lines2: string[]): void {
	const model = createTextModel(lines1.join('\n'));
	const textBuffer = createTextBuffer(lines2.join('\n'), DefaultEndOfLine.LF);

	// compute required edits
	// let start = Date.now();
	const edits = ModelServiceImpl._computeEdits(model, textBuffer);
	// console.log(`took ${Date.now() - start} ms.`);

	// apply edits
	model.pushEditOperations([], edits, null);

	assert.equal(model.getValue(), lines2.join('\n'));
}

function getRandomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomString(minLength: number, maxLength: number): string {
	let length = getRandomInt(minLength, maxLength);
	let t = createStringBuilder(length);
	for (let i = 0; i < length; i++) {
		t.appendASCII(getRandomInt(CharCode.a, CharCode.z));
	}
	return t.build();
}

function generateFile(small: boolean): string[] {
	let lineCount = getRandomInt(1, small ? 3 : 10000);
	let lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		lines.push(getRandomString(0, small ? 3 : 10000));
	}
	return lines;
}

if (GENERATE_TESTS) {
	let number = 1;
	while (true) {

		console.log('------TEST: ' + number++);

		const file1 = generateFile(true);
		const file2 = generateFile(true);

		console.log('------TEST GENERATED');

		try {
			assertComputeEdits(file1, file2);
		} catch (err) {
			console.log(err);
			console.log(`
const file1 = ${JSON.stringify(file1).replace(/"/g, '\'')};
const file2 = ${JSON.stringify(file2).replace(/"/g, '\'')};
assertComputeEdits(file1, file2);
`);
			break;
		}
	}
}

export class TestTextResourcePropertiesService implements ITextResourcePropertiesService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
	}

	getEOL(resource: URI, language?: string): string {
		const eol = this.configurationService.getValue<string>('files.eol', { overrideIdentifier: language, resource });
		if (eol && eol !== 'auto') {
			return eol;
		}
		return (platform.isLinux || platform.isMacintosh) ? '\n' : '\r\n';
	}
}
