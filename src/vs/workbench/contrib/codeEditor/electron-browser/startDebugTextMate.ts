/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';

import * as nls from 'vs/nls';
import { Range } from 'vs/editor/common/core/range';
import { Action } from 'vs/base/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { ITextMateService } from 'vs/workbench/services/textMate/common/textMateService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { URI } from 'vs/base/common/uri';
import { createRotatingLogger } from 'vs/platform/log/node/spdlogService';
import { generateUuid } from 'vs/base/common/uuid';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ITextModel } from 'vs/editor/common/model';
import { Constants } from 'vs/base/common/uint';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { join } from 'vs/base/common/path';

class StartDebugTextMate extends Action {

	private static resource = URI.parse(`inmemory:///tm-log.txt`);

	public static readonly ID = 'editor.action.startDebugTextMate';
	public static readonly LABEL = nls.localize('startDebugTextMate', "Start Text Mate Syntax Grammar Logging");

	constructor(
		id: string,
		label: string,
		@ITextMateService private readonly _textMateService: ITextMateService,
		@IModelService private readonly _modelService: IModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IHostService private readonly _hostService: IHostService
	) {
		super(id, label);
	}

	private _getOrCreateModel(): ITextModel {
		const model = this._modelService.getModel(StartDebugTextMate.resource);
		if (model) {
			return model;
		}
		return this._modelService.createModel('', null, StartDebugTextMate.resource);
	}

	private _append(model: ITextModel, str: string) {
		const lineCount = model.getLineCount();
		model.applyEdits([{
			range: new Range(lineCount, Constants.MAX_SAFE_SMALL_INTEGER, lineCount, Constants.MAX_SAFE_SMALL_INTEGER),
			text: str
		}]);
	}

	public async run(): Promise<any> {
		const pathInTemp = join(os.tmpdir(), `vcode-tm-log-${generateUuid()}.txt`);
		const logger = createRotatingLogger(`tm-log`, pathInTemp, 1024 * 1024 * 30, 1);
		const model = this._getOrCreateModel();
		const append = (str: string) => {
			this._append(model, str + '\n');
			scrollEditor();
			logger.info(str);
			logger.flush();
		};
		await this._hostService.openWindow([{ fileUri: URI.file(pathInTemp) }], { forceNewWindow: true });
		const textEditorPane = await this._editorService.openEditor({
			resource: model.uri
		});
		if (!textEditorPane) {
			return;
		}
		const scrollEditor = () => {
			const editors = this._codeEditorService.listCodeEditors();
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

		this._textMateService.startDebugMode(
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

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(StartDebugTextMate), 'Start Text Mate Syntax Grammar Logging', nls.localize({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer"));
