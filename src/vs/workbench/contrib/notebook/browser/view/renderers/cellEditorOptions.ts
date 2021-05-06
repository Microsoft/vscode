/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { deepClone } from 'vs/base/common/objects';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorOptions, LineNumbersType } from 'vs/editor/common/config/editorOptions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EDITOR_BOTTOM_PADDING, EDITOR_BOTTOM_PADDING_WITHOUT_STATUSBAR } from 'vs/workbench/contrib/notebook/browser/constants';
import { EditorTopPaddingChangeEvent, getEditorTopPadding, getNotebookEditorFromEditorPane, ICellViewModel, NOTEBOOK_CELL_LINE_NUMBERS, NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_IS_ACTIVE_EDITOR } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { ShowCellStatusBarKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { NOTEBOOK_ACTIONS_CATEGORY } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';

export class CellEditorOptions {

	private static fixedEditorOptions: IEditorOptions = {
		scrollBeyondLastLine: false,
		scrollbar: {
			verticalScrollbarSize: 14,
			horizontal: 'auto',
			useShadows: true,
			verticalHasArrows: false,
			horizontalHasArrows: false,
			alwaysConsumeMouseWheel: false
		},
		renderLineHighlightOnlyWhenFocus: true,
		overviewRulerLanes: 0,
		selectOnLineNumbers: false,
		lineNumbers: 'off',
		lineDecorationsWidth: 0,
		glyphMargin: false,
		fixedOverflowWidgets: true,
		minimap: { enabled: false },
		renderValidationDecorations: 'on'
	};

	private _value: IEditorOptions;
	private _lineNumbers: 'on' | 'off' | 'inherit' = 'inherit';
	private disposable: IDisposable;

	private readonly _onDidChange = new Emitter<IEditorOptions>();
	readonly onDidChange: Event<IEditorOptions> = this._onDidChange.event;

	constructor(readonly configurationService: IConfigurationService, language: string) {

		this.disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor') || e.affectsConfiguration('notebook') || e.affectsConfiguration(ShowCellStatusBarKey)) {
				this._value = computeEditorOptions();
				this._onDidChange.fire(this.value);
			}
		});

		EditorTopPaddingChangeEvent(() => {
			this._value = computeEditorOptions();
			this._onDidChange.fire(this.value);

		});

		const computeEditorOptions = () => {
			const showCellStatusBar = configurationService.getValue<boolean>(ShowCellStatusBarKey);
			const editorPadding = {
				top: getEditorTopPadding(),
				bottom: showCellStatusBar ? EDITOR_BOTTOM_PADDING : EDITOR_BOTTOM_PADDING_WITHOUT_STATUSBAR
			};

			const renderLiNumbers = configurationService.getValue<'on' | 'off'>('notebook.lineNumbers') === 'on';
			const lineNumbers: LineNumbersType = renderLiNumbers ? 'on' : 'off';
			const editorOptions = deepClone(configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
			const computed = {
				...editorOptions,
				...CellEditorOptions.fixedEditorOptions,
				...{ padding: editorPadding, lineNumbers },
			};

			if (!computed.folding) {
				computed.lineDecorationsWidth = 16;
			}

			return computed;
		};

		this._value = computeEditorOptions();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this.disposable.dispose();
	}

	get value(): IEditorOptions {
		return this._value;
	}

	setGlyphMargin(gm: boolean): void {
		if (gm !== this._value.glyphMargin) {
			this._value.glyphMargin = gm;
			this._onDidChange.fire(this.value);
		}
	}

	setLineNumbers(lineNumbers: 'on' | 'off' | 'inherit'): void {
		this._lineNumbers = lineNumbers;
		if (this._lineNumbers === 'inherit') {
			const renderLiNumbers = this.configurationService.getValue<'on' | 'off'>('notebook.lineNumbers') === 'on';
			const lineNumbers: LineNumbersType = renderLiNumbers ? 'on' : 'off';
			this._value.lineNumbers = lineNumbers;
		} else {
			this._value.lineNumbers = lineNumbers as LineNumbersType;
		}
		this._onDidChange.fire(this.value);
	}
}

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'notebook',
	order: 100,
	type: 'object',
	'properties': {
		'notebook.lineNumbers': {
			type: 'string',
			enum: ['off', 'on'],
			default: 'off',
			markdownDescription: localize('notebook.lineNumbers', "Controls the display of line numbers in the cell editor.")
		}
	}
});

registerAction2(class ToggleLineNumberAction extends Action2 {
	constructor() {
		super({
			id: 'notebook.toggleLineNumbers',
			title: { value: localize('notebook.toggleLineNumbers', "Toggle Notebook Line Numbers"), original: 'Toggle Notebook Line Numbers' },
			precondition: NOTEBOOK_EDITOR_FOCUSED,
			menu: [{
				id: MenuId.EditorTitle,
				group: 'LineNumber',
				order: 0,
				when: NOTEBOOK_IS_ACTIVE_EDITOR
			}],
			category: NOTEBOOK_ACTIONS_CATEGORY,
			f1: true,
			toggled: {
				condition: ContextKeyExpr.notEquals('config.notebook.lineNumbers', 'off'),
				title: { value: localize('notebook.showLineNumbers', "Show Notebook Line Numbers"), original: 'Show Notebook Line Numbers' },
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const renderLiNumbers = configurationService.getValue<'on' | 'off'>('notebook.lineNumbers') === 'on';

		if (renderLiNumbers) {
			configurationService.updateValue('notebook.lineNumbers', 'off');
		} else {
			configurationService.updateValue('notebook.lineNumbers', 'on');
		}
	}
});

registerAction2(class ToggleActiveLineNumberAction extends Action2 {
	constructor() {
		super({
			id: 'notebook.cell.toggleLineNumbers',
			title: 'Show Cell Line Numbers',
			precondition: NOTEBOOK_EDITOR_FOCUSED,
			menu: [{
				id: MenuId.NotebookCellTitle,
				group: 'View',
				order: 1
			}],
			toggled: ContextKeyExpr.or(
				NOTEBOOK_CELL_LINE_NUMBERS.isEqualTo('on'),
				ContextKeyExpr.and(NOTEBOOK_CELL_LINE_NUMBERS.isEqualTo('inherit'), ContextKeyExpr.equals('config.notebook.lineNumbers', 'on'))
			)
		});
	}

	async run(accessor: ServicesAccessor, context?: { cell: ICellViewModel; }): Promise<void> {
		let cell = context?.cell;
		if (!cell) {
			const editor = getNotebookEditorFromEditorPane(accessor.get(IEditorService).activeEditorPane);
			if (!editor || !editor.hasModel()) {
				return;
			}

			cell = editor.getActiveCell();
		}

		if (cell) {
			const configurationService = accessor.get(IConfigurationService);
			const renderLineNumbers = configurationService.getValue<'on' | 'off'>('notebook.lineNumbers') === 'on';
			const cellLineNumbers = cell.lineNumbers;
			// 'on', 'inherit' 	-> 'on'
			// 'on', 'off'		-> 'off'
			// 'on', 'on'		-> 'on'
			// 'off', 'inherit'	-> 'off'
			// 'off', 'off'		-> 'off'
			// 'off', 'on'		-> 'on'
			const currentLineNumberIsOn = cellLineNumbers === 'on' || (cellLineNumbers === 'inherit' && renderLineNumbers);

			if (currentLineNumberIsOn) {
				cell.lineNumbers = 'off';
			} else {
				cell.lineNumbers = 'on';
			}
		}
	}
});
