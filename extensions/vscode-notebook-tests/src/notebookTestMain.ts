/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { smokeTestActivate } from './notebookSmokeTestMain';

export function activate(context: vscode.ExtensionContext): any {
	smokeTestActivate(context);

	const _onDidChangeNotebook = new vscode.EventEmitter<vscode.NotebookDocumentEditEvent | vscode.NotebookDocumentContentChangeEvent>();
	context.subscriptions.push(_onDidChangeNotebook);
	context.subscriptions.push(vscode.notebook.registerNotebookContentProvider('notebookCoreTest', {
		onDidChangeNotebook: _onDidChangeNotebook.event,
		openNotebook: async (_resource: vscode.Uri) => {
			if (/.*empty\-.*\.vsctestnb$/.test(_resource.path)) {
				return {
					languages: ['typescript'],
					metadata: {},
					cells: []
				};
			}

			const dto: vscode.NotebookData = {
				languages: ['typescript'],
				metadata: {
					custom: { testMetadata: false }
				},
				cells: [
					{
						source: 'test',
						language: 'typescript',
						cellKind: vscode.CellKind.Code,
						outputs: [],
						metadata: {
							custom: { testCellMetadata: 123 }
						}
					}
				]
			};

			return dto;
		},
		resolveNotebook: async (_document: vscode.NotebookDocument) => {
			return;
		},
		saveNotebook: async (_document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken) => {
			return;
		},
		saveNotebookAs: async (_targetResource: vscode.Uri, _document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken) => {
			return;
		},
		backupNotebook: async (_document: vscode.NotebookDocument, _context: vscode.NotebookDocumentBackupContext, _cancellation: vscode.CancellationToken) => {
			return {
				id: '1',
				delete: () => { }
			};
		}
	}));

	context.subscriptions.push(vscode.notebook.registerNotebookKernel('notebookKernelTest', ['*.vsctestnb'], {
		label: 'Notebook Test Kernel',
		executeAllCells: async (_document: vscode.NotebookDocument) => {
			const cell = _document.cells[0];

			cell.outputs = [{
				outputKind: vscode.CellOutputKind.Rich,
				data: {
					'text/plain': ['my output']
				}
			}];
			return;
		},
		cancelAllCellsExecution: async (_document: vscode.NotebookDocument) => { },
		executeCell: async (document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined) => {
			if (!cell) {
				cell = document.cells[0];
			}

			if (document.uri.path.endsWith('customRenderer.vsctestnb')) {
				cell.outputs = [{
					outputKind: vscode.CellOutputKind.Rich,
					data: {
						'text/custom': 'test'
					}
				}];

				return;
			}

			const previousOutputs = cell.outputs;
			const newOutputs: vscode.CellOutput[] = [{
				outputKind: vscode.CellOutputKind.Rich,
				data: {
					'text/plain': ['my output']
				}
			}];

			cell.outputs = newOutputs;

			_onDidChangeNotebook.fire({
				document: document,
				undo: () => {
					if (cell) {
						cell.outputs = previousOutputs;
					}
				},
				redo: () => {
					if (cell) {
						cell.outputs = newOutputs;
					}
				}
			});
			return;
		},
		cancelCellExecution: async (_document: vscode.NotebookDocument, _cell: vscode.NotebookCell) => { }
	}));
}
