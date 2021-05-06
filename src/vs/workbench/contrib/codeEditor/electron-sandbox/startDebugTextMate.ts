/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Range } from 'vs/editor/common/core/range';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { ITextMateService } from 'vs/workbench/services/textMate/common/textMateService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ITextModel } from 'vs/editor/common/model';
import { Constants } from 'vs/base/common/uint';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { ILoggerService } from 'vs/platform/log/common/log';
import { joinPath } from 'vs/base/common/resources';
import { IFileService } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

class StartDebugTextMate extends Action2 {

	private static resource = URI.parse(`inmemory:///tm-log.txt`);

	constructor() {
		super({
			id: 'editor.action.startDebugTextMate',
			title: { value: nls.localize('startDebugTextMate', "Start Text Mate Syntax Grammar Logging"), original: 'Start Text Mate Syntax Grammar Logging' },
			category: CATEGORIES.Developer.value,
			f1: true
		});
	}

	private _getOrCreateModel(modelService: IModelService): ITextModel {
		const model = modelService.getModel(StartDebugTextMate.resource);
		if (model) {
			return model;
		}
		return modelService.createModel('', null, StartDebugTextMate.resource);
	}

	private _append(model: ITextModel, str: string) {
		const lineCount = model.getLineCount();
		model.applyEdits([{
			range: new Range(lineCount, Constants.MAX_SAFE_SMALL_INTEGER, lineCount, Constants.MAX_SAFE_SMALL_INTEGER),
			text: str
		}]);
	}

	async run(accessor: ServicesAccessor) {
		const textMateService = accessor.get(ITextMateService);
		const modelService = accessor.get(IModelService);
		const editorService = accessor.get(IEditorService);
		const codeEditorService = accessor.get(ICodeEditorService);
		const hostService = accessor.get(IHostService);
		const environmentService = accessor.get(INativeWorkbenchEnvironmentService);
		const loggerService = accessor.get(ILoggerService);
		const fileService = accessor.get(IFileService);

		const pathInTemp = joinPath(environmentService.tmpDir, `vcode-tm-log-${generateUuid()}.txt`);
		await fileService.createFile(pathInTemp);
		const logger = loggerService.createLogger(pathInTemp, { name: 'debug textmate' });
		const model = this._getOrCreateModel(modelService);
		const append = (str: string) => {
			this._append(model, str + '\n');
			scrollEditor();
			logger.info(str);
			logger.flush();
		};
		await hostService.openWindow([{ fileUri: pathInTemp }], { forceNewWindow: true });
		const textEditorPane = await editorService.openEditor({
			resource: model.uri,
			options: { pinned: true }
		});
		if (!textEditorPane) {
			return;
		}
		const scrollEditor = () => {
			const editors = codeEditorService.listCodeEditors();
			for (const editor of editors) {
				if (editor.hasModel()) {
					if (editor.getModel().uri.toString() === StartDebugTextMate.resource.toString()) {
						editor.revealLine(editor.getModel().getLineCount());
					}
				}
			}
		};

		append(`// Open the file you want to test to the side and watch here`);
		append(`// Output mirrored at ${pathInTemp}`);

		textMateService.startDebugMode(
			(str) => {
				this._append(model, str + '\n');
				scrollEditor();
				logger.info(str);
				logger.flush();
			},
			() => {

			}
		);
	}
}

registerAction2(StartDebugTextMate);
