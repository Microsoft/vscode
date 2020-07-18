/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { MenuId, MenuRegistry, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CoreNavigationCommands } from 'vs/editor/browser/controller/coreCommands';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { CursorColumns } from 'vs/editor/common/controller/cursorCommon';

export class ToggleColumnSelectionAction extends Action {
	public static readonly ID = 'editor.action.toggleColumnSelection';
	public static readonly LABEL = nls.localize('toggleColumnSelection', "Toggle Column Selection Mode");

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService
	) {
		super(id, label);
	}

	private _getCodeEditor(): ICodeEditor | null {
		const codeEditor = this._codeEditorService.getFocusedCodeEditor();
		if (codeEditor) {
			return codeEditor;
		}
		return this._codeEditorService.getActiveCodeEditor();
	}

	public async run(): Promise<any> {
		const oldValue = this._configurationService.getValue<boolean>('editor.columnSelection');
		const codeEditor = this._getCodeEditor();
		await this._configurationService.updateValue('editor.columnSelection', !oldValue, ConfigurationTarget.USER);
		const newValue = this._configurationService.getValue<boolean>('editor.columnSelection');
		if (!codeEditor || codeEditor !== this._getCodeEditor() || oldValue === newValue || !codeEditor.hasModel()) {
			return;
		}
		const viewModel = codeEditor._getViewModel();
		if (codeEditor.getOption(EditorOption.columnSelection)) {
			const selection = codeEditor.getSelection();
			const modelSelectionStart = new Position(selection.selectionStartLineNumber, selection.selectionStartColumn);
			const viewSelectionStart = viewModel.coordinatesConverter.convertModelPositionToViewPosition(modelSelectionStart);
			const modelPosition = new Position(selection.positionLineNumber, selection.positionColumn);
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(modelPosition);

			CoreNavigationCommands.MoveTo.runCoreEditorCommand(viewModel, {
				position: modelSelectionStart,
				viewPosition: viewSelectionStart
			});
			const visibleColumn = CursorColumns.visibleColumnFromColumn2(viewModel.cursorConfig, viewModel, viewPosition);
			CoreNavigationCommands.ColumnSelect.runCoreEditorCommand(viewModel, {
				position: modelPosition,
				viewPosition: viewPosition,
				doColumnSelect: true,
				mouseColumn: visibleColumn + 1
			});
		} else {
			const columnSelectData = viewModel.getCursorColumnSelectData();
			const fromViewColumn = CursorColumns.columnFromVisibleColumn2(viewModel.cursorConfig, viewModel, columnSelectData.fromViewLineNumber, columnSelectData.fromViewVisualColumn);
			const fromPosition = viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(columnSelectData.fromViewLineNumber, fromViewColumn));
			const toViewColumn = CursorColumns.columnFromVisibleColumn2(viewModel.cursorConfig, viewModel, columnSelectData.toViewLineNumber, columnSelectData.toViewVisualColumn);
			const toPosition = viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(columnSelectData.toViewLineNumber, toViewColumn));

			codeEditor.setSelection(new Selection(fromPosition.lineNumber, fromPosition.column, toPosition.lineNumber, toPosition.column));
		}
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleColumnSelectionAction), 'Toggle Column Selection Mode');

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
	group: '4_config',
	command: {
		id: ToggleColumnSelectionAction.ID,
		title: nls.localize({ key: 'miColumnSelection', comment: ['&& denotes a mnemonic'] }, "Column &&Selection Mode"),
		toggled: ContextKeyExpr.equals('config.editor.columnSelection', true)
	},
	order: 2
});
