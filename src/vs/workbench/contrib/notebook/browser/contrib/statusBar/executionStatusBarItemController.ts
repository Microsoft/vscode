/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import { ICellVisibilityChangeEvent, NotebookVisibleCellObserver } from 'vs/workbench/contrib/notebook/browser/contrib/statusBar/notebookVisibleCellObserver';
import { ICellViewModel, INotebookEditor, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { cellStatusIconError, cellStatusIconSuccess } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellStatusbarAlignment, INotebookCellStatusBarItem, NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class NotebookStatusBarController extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.statusBar.exec';

	private readonly _visibleCells = new Map<number, IDisposable[]>();

	private readonly _observer: NotebookVisibleCellObserver;

	constructor(
		private readonly _notebookEditor: INotebookEditor,
	) {
		super();
		this._observer = this._register(new NotebookVisibleCellObserver(this._notebookEditor));
		this._register(this._observer.onDidChangeVisibleCells(this._updateVisibleCells, this));

		this._updateEverything();
	}

	private _updateEverything(): void {
		this._visibleCells.forEach(dispose);
		this._visibleCells.clear();
		this._updateVisibleCells({ added: this._observer.visibleCells, removed: [] });
	}

	private _updateVisibleCells(e: ICellVisibilityChangeEvent): void {
		const vm = this._notebookEditor.viewModel;
		if (!vm) {
			return;
		}

		for (let newCell of e.added) {
			const helpers = [
				new ExecutionStateCellStatusBarHelper(vm, newCell),
				new TimerCellStatusBarHelper(vm, newCell)
			];
			this._visibleCells.set(newCell.handle, helpers);
		}

		for (let oldCell of e.removed) {
			this._visibleCells.get(oldCell.handle)?.forEach(dispose);
			this._visibleCells.delete(oldCell.handle);
		}
	}

	override dispose(): void {
		super.dispose();

		this._visibleCells.forEach(dispose);
		this._visibleCells.clear();
	}
}

/**
 * Shows the cell's execution state in the cell status bar. When the "executing" state is shown, it will be shown for a minimum brief time.
 */
class ExecutionStateCellStatusBarHelper extends Disposable {
	private static readonly MIN_SPINNER_TIME = 500;

	private _currentItemIds: string[] = [];

	private _currentExecutingStateTimer: any;

	constructor(
		private readonly _notebookViewModel: NotebookViewModel,
		private readonly _cell: ICellViewModel,
	) {
		super();

		this._update();
		this._register(this._cell.model.onDidChangeMetadata(() => this._update()));
	}

	private async _update() {
		const items = this._getItemsForCell(this._cell);
		if (Array.isArray(items)) {
			this._currentItemIds = this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items }]);
		}
	}

	/**
	 *	Returns undefined if there should be no change, and an empty array if all items should be removed.
	 */
	private _getItemsForCell(cell: ICellViewModel): INotebookCellStatusBarItem[] | undefined {
		if (this._currentExecutingStateTimer) {
			return;
		}

		const item = this._getItemForState(cell.metadata?.runState, cell.metadata?.lastRunSuccess);

		// Show the execution spinner for a minimum time
		if (cell.metadata?.runState === NotebookCellExecutionState.Executing) {
			this._currentExecutingStateTimer = setTimeout(() => {
				this._currentExecutingStateTimer = undefined;
				if (cell.metadata?.runState !== NotebookCellExecutionState.Executing) {
					this._update();
				}
			}, ExecutionStateCellStatusBarHelper.MIN_SPINNER_TIME);
		}

		return item ? [item] : [];
	}

	private _getItemForState(runState: NotebookCellExecutionState | undefined, lastRunSuccess: boolean | undefined): INotebookCellStatusBarItem | undefined {
		if (runState === NotebookCellExecutionState.Idle && lastRunSuccess) {
			return <INotebookCellStatusBarItem>{
				text: '$(notebook-state-success)',
				color: themeColorFromId(cellStatusIconSuccess),
				tooltip: localize('notebook.cell.status.success', "Success"),
				alignment: CellStatusbarAlignment.Left,
				priority: Number.MAX_SAFE_INTEGER
			};
		} else if (runState === NotebookCellExecutionState.Idle && lastRunSuccess === false) {
			return <INotebookCellStatusBarItem>{
				text: '$(notebook-state-error)',
				color: themeColorFromId(cellStatusIconError),
				tooltip: localize('notebook.cell.status.failed', "Failed"),
				alignment: CellStatusbarAlignment.Left,
				priority: Number.MAX_SAFE_INTEGER
			};
		} else if (runState === NotebookCellExecutionState.Pending) {
			return <INotebookCellStatusBarItem>{
				text: '$(notebook-state-pending)',
				tooltip: localize('notebook.cell.status.pending', "Pending"),
				alignment: CellStatusbarAlignment.Left,
				priority: Number.MAX_SAFE_INTEGER
			};
		} else if (runState === NotebookCellExecutionState.Executing) {
			return <INotebookCellStatusBarItem>{
				text: '$(notebook-state-executing~spin)',
				tooltip: localize('notebook.cell.status.executing', "Executing"),
				alignment: CellStatusbarAlignment.Left,
				priority: Number.MAX_SAFE_INTEGER
			};
		}

		return;
	}

	override dispose() {
		super.dispose();

		this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items: [] }]);
	}
}

class TimerCellStatusBarHelper extends Disposable {
	private static UPDATE_INTERVAL = 100;
	private _currentItemIds: string[] = [];

	private _scheduler: RunOnceScheduler;

	constructor(
		private readonly _notebookViewModel: NotebookViewModel,
		private readonly _cell: ICellViewModel,
	) {
		super();

		this._scheduler = this._register(new RunOnceScheduler(() => this._update(), TimerCellStatusBarHelper.UPDATE_INTERVAL));
		this._update();
		this._register(this._cell.model.onDidChangeMetadata(() => this._update()));
	}

	private async _update() {
		let item: INotebookCellStatusBarItem | undefined;
		if (this._cell.metadata?.runState === NotebookCellExecutionState.Executing) {
			const startTime = this._cell.metadata.runStartTime;
			const adjustment = this._cell.metadata.runStartTimeAdjustment;
			if (typeof startTime === 'number') {
				item = this._getTimeItem(startTime, Date.now(), adjustment);
				this._scheduler.schedule();
			}
		} else if (this._cell.metadata?.runState === NotebookCellExecutionState.Idle) {
			const startTime = this._cell.metadata.runStartTime;
			const endTime = this._cell.metadata.runEndTime;
			if (typeof startTime === 'number' && typeof endTime === 'number') {
				item = this._getTimeItem(startTime, endTime);
			}
		}

		const items = item ? [item] : [];
		this._currentItemIds = this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items }]);
	}

	private _getTimeItem(startTime: number, endTime: number, adjustment: number = 0): INotebookCellStatusBarItem {
		const duration = endTime - startTime + adjustment;
		return <INotebookCellStatusBarItem>{
			text: this._formatDuration(duration),
			alignment: CellStatusbarAlignment.Left,
			priority: Number.MAX_SAFE_INTEGER - 1
		};
	}

	private _formatDuration(duration: number) {
		const seconds = Math.floor(duration / 1000);
		const tenths = String(duration - seconds * 1000).charAt(0);

		return `${seconds}.${tenths}s`;
	}

	override dispose() {
		super.dispose();

		this._notebookViewModel.deltaCellStatusBarItems(this._currentItemIds, [{ handle: this._cell.handle, items: [] }]);
	}
}

registerNotebookContribution(NotebookStatusBarController.id, NotebookStatusBarController);
