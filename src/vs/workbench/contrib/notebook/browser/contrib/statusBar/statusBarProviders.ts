/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { CellKind, CellStatusbarAlignment, INotebookCellStatusBarItem, INotebookCellStatusBarItemList, INotebookCellStatusBarItemProvider } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CHANGE_CELL_LANGUAGE, EXECUTE_CELL_COMMAND_ID, QUIT_EDIT_CELL_COMMAND_ID } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { NotebookSelector } from 'vs/workbench/contrib/notebook/common/notebookSelector';

class CellStatusBarPlaceholderProvider implements INotebookCellStatusBarItemProvider {
	readonly selector: NotebookSelector = {
		pattern: '**/*'
	};

	constructor(
		@INotebookService private readonly _notebookService: INotebookService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) { }

	async provideCellStatusBarItems(uri: URI, index: number, token: CancellationToken): Promise<INotebookCellStatusBarItemList | undefined> {
		const doc = this._notebookService.getNotebookTextModel(uri);
		const cell = doc?.cells[index];
		if (!cell || typeof cell.metadata.runState !== 'undefined' || typeof cell.metadata.lastRunSuccess !== 'undefined') {
			return;
		}

		let text: string;
		if (cell.cellKind === CellKind.Code) {
			const keybinding = this._keybindingService.lookupKeybinding(EXECUTE_CELL_COMMAND_ID)?.getLabel();
			if (!keybinding) {
				return;
			}

			text = localize('notebook.cell.status.codeExecuteTip', "Press {0} to execute cell", keybinding);
		} else {
			const keybinding = this._keybindingService.lookupKeybinding(QUIT_EDIT_CELL_COMMAND_ID)?.getLabel();
			if (!keybinding) {
				return;
			}

			text = localize('notebook.cell.status.markdownExecuteTip', "Press {0} to stop editing", keybinding);
		}

		const item = <INotebookCellStatusBarItem>{
			text,
			tooltip: text,
			alignment: CellStatusbarAlignment.Left,
			opacity: '0.7',
			onlyShowWhenActive: true
		};
		return {
			items: [item]
		};
	}
}

class CellStatusBarLanguagePickerProvider implements INotebookCellStatusBarItemProvider {
	readonly selector: NotebookSelector = {
		pattern: '**/*'
	};

	constructor(
		@INotebookService private readonly _notebookService: INotebookService,
		@IModeService private readonly _modeService: IModeService,
	) { }

	async provideCellStatusBarItems(uri: URI, index: number, _token: CancellationToken): Promise<INotebookCellStatusBarItemList | undefined> {
		const doc = this._notebookService.getNotebookTextModel(uri);
		const cell = doc?.cells[index];
		if (!cell) {
			return;
		}

		const modeId = cell.cellKind === CellKind.Markdown ?
			'markdown' :
			(this._modeService.getModeIdForLanguageName(cell.language) || cell.language);
		const text = this._modeService.getLanguageName(modeId) || this._modeService.getLanguageName('plaintext');
		const item = <INotebookCellStatusBarItem>{
			text,
			command: CHANGE_CELL_LANGUAGE,
			tooltip: localize('notebook.cell.status.language', "Select Cell Language Mode"),
			alignment: CellStatusbarAlignment.Right,
			priority: -Number.MAX_SAFE_INTEGER
		};
		return {
			items: [item]
		};
	}
}

class BuiltinCellStatusBarProviders extends Disposable {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotebookCellStatusBarService notebookCellStatusBarService: INotebookCellStatusBarService) {
		super();

		const builtinProviders = [
			CellStatusBarPlaceholderProvider,
			CellStatusBarLanguagePickerProvider,
		];
		builtinProviders.forEach(p => {
			this._register(notebookCellStatusBarService.registerCellStatusBarItemProvider(instantiationService.createInstance(p)));
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BuiltinCellStatusBarProviders, LifecyclePhase.Restored);
