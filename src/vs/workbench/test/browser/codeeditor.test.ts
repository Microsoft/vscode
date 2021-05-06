/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestEditorService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { RangeHighlightDecorations } from 'vs/workbench/browser/codeeditor';
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
		const range: IRange = new Range(1, 1, 1, 1);
		testObject.highlightRange({ resource: model.uri, range });

		const actuals = rangeHighlightDecorations(model);

		assert.deepStrictEqual(actuals, [range]);
	});

	test('remove highlight range', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		testObject.removeHighlightRange();

		const actuals = rangeHighlightDecorations(model);

		assert.deepStrictEqual(actuals, []);
	});

	test('highlight range for the resource removes previous highlight', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		const range: IRange = new Range(2, 2, 4, 3);
		testObject.highlightRange({ resource: model.uri, range });

		const actuals = rangeHighlightDecorations(model);

		assert.deepStrictEqual(actuals, [range]);
	});

	test('highlight range for a new resource removes highlight of previous resource', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });

		const anotherModel = prepareActiveEditor('anotherModel');
		const range: IRange = new Range(2, 2, 4, 3);
		testObject.highlightRange({ resource: anotherModel.uri, range });

		let actuals = rangeHighlightDecorations(model);
		assert.deepStrictEqual(actuals, []);
		actuals = rangeHighlightDecorations(anotherModel);
		assert.deepStrictEqual(actuals, [range]);
	});

	test('highlight is removed on model change', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		prepareActiveEditor('anotherModel');

		const actuals = rangeHighlightDecorations(model);
		assert.deepStrictEqual(actuals, []);
	});

	test('highlight is removed on cursor position change', function () {
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });
		codeEditor.trigger('mouse', CoreNavigationCommands.MoveTo.id, {
			position: new Position(2, 1)
		});

		const actuals = rangeHighlightDecorations(model);
		assert.deepStrictEqual(actuals, []);
	});

	test('range is not highlight if not active editor', function () {
		const model = aModel(URI.file('some model'));
		testObject.highlightRange({ resource: model.uri, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } });

		const actuals = rangeHighlightDecorations(model);
		assert.deepStrictEqual(actuals, []);
	});

	test('previous highlight is not removed if not active editor', function () {
		const range = new Range(1, 1, 1, 1);
		testObject.highlightRange({ resource: model.uri, range });

		const model1 = aModel(URI.file('some model'));
		testObject.highlightRange({ resource: model1.uri, range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 1 } });

		const actuals = rangeHighlightDecorations(model);
		assert.deepStrictEqual(actuals, [range]);
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
