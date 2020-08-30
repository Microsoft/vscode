/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestEditorService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { RangeHighlightDecorations } from 'vs/workbench/browser/parts/editor/rangeDecorations';
import { TextModel } from 'vs/editor/common/model/textModel';
import { createTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { Range, IRange } from 'vs/editor/common/core/range';
import { Position } from 'vs/editor/common/core/position';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { CoreNavigationCommands } from 'vs/editor/browser/controller/coreCommands';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';

suite('Editor - Range decorations', () => {

	let instantiationService: TestInstantiationService;
	let codeEditor: ICodeEditor;
	let model: TextModel;
	let text: string;
	let testObject: RangeHighlightDecorations;
	let modelsToDispose: TextModel[] = [];

	setup(() => {
		instantiationService = <TestInstantiationService>workbenchInstantiationService();
		instantiationService.stub(IEditorService, new TestEditorService());
		instantiationService.stub(IModeService, ModeServiceImpl);
		instantiationService.stub(IModelService, stubModelService(instantiationService));
		text = 'LINE1' + '\n' + 'LINE2' + '\n' + 'LINE3' + '\n' + 'LINE4' + '\r\n' + 'LINE5';
		model = aModel(URI.file('some_file'));
		codeEditor = createTestCodeEditor({ model: model });

		instantiationService.stub(IEditorService, 'activeEditor', { get resource() { return codeEditor.getModel()!.uri; } });
		instantiationService.stub(IEditorService, 'activeTextEditorControl', codeEditor);

		testObject = instantiationService.createInstance(RangeHighlightDecorations);
	});

	teardown(() => {
		codeEditor.dispose();
		modelsToDispose.forEach(model => model.dispose());
	});

	test('highlight range for the resource if it is an active editor', function () {
		let range: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
		testObject.highlightRange({ resource: model.uri, range });

		let actuals = rangeHighlightDecorations(model);

		assert.deepEqual([range], actuals);
	});

	test('remove highlight range', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		testObject.removeHighlightRange();

		let actuals = rangeHighlightDecorations(model);

		assert.deepEqual([], actuals);
	});

	test('highlight range for the resource removes previous highlight', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		let range: IRange = { startLineNumber: 2, startColumn: 2, endLineNumber: 4, endColumn: 3 };
		testObject.highlightRange({ resource: model.uri, range });

		let actuals = rangeHighlightDecorations(model);

		assert.deepEqual([range], actuals);
	});

	test('highlight range for a new resource removes highlight of previous resource', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });

		let anotherModel = prepareActiveEditor('anotherModel');
		let range: IRange = { startLineNumber: 2, startColumn: 2, endLineNumber: 4, endColumn: 3 };
		testObject.highlightRange({ resource: anotherModel.uri, range });

		let actuals = rangeHighlightDecorations(model);
		assert.deepEqual([], actuals);
		actuals = rangeHighlightDecorations(anotherModel);
		assert.deepEqual([range], actuals);
	});

	test('highlight is removed on model change', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		prepareActiveEditor('anotherModel');

		let actuals = rangeHighlightDecorations(model);
		assert.deepEqual([], actuals);
	});

	test('highlight is removed on cursor position change', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		codeEditor.trigger('mouse', CoreNavigationCommands.MoveTo.id, {
			position: new Position(2, 1)
		});

		let actuals = rangeHighlightDecorations(model);
		assert.deepEqual([], actuals);
	});

	test('range is not highlight if not active editor', function () {
		let model = aModel(URI.file('some model'));
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });

		let actuals = rangeHighlightDecorations(model);
		assert.deepEqual([], actuals);
	});

	test('previous highlight is not removed if not active editor', function () {
		let range: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
		testObject.highlightRange({ resource: model.uri, range });

		let model1 = aModel(URI.file('some model'));
		testObject.highlightRange({ resource: model1.uri, range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 } });

		let actuals = rangeHighlightDecorations(model);
		assert.deepEqual([range], actuals);
	});

	function prepareActiveEditor(resource: string): TextModel {
		let model = aModel(URI.file(resource));
		codeEditor.setModel(model);
		return model;
	}

	function aModel(resource: URI, content: string = text): TextModel {
		let model = createTextModel(content, TextModel.DEFAULT_CREATION_OPTIONS, null, resource);
		modelsToDispose.push(model);
		return model;
	}

	function rangeHighlightDecorations(m: TextModel): IRange[] {
		let rangeHighlights: IRange[] = [];

		for (let dec of m.getAllDecorations()) {
			if (dec.options.className === 'rangeHighlight') {
				rangeHighlights.push(dec.range);
			}
		}

		rangeHighlights.sort(Range.compareRangesUsingStarts);
		return rangeHighlights;
	}

	function stubModelService(instantiationService: TestInstantiationService): IModelService {
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IThemeService, new TestThemeService());
		return instantiationService.createInstance(ModelServiceImpl);
	}
});
