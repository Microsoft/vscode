/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { INotebookActionContext, NOTEBOOK_ACTIONS_CATEGORY, getActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { INotebookEditor, NOTEBOOK_IS_ACTIVE_EDITOR } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { INotebookKernelInfo2, INotebookKernelInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Disposable, DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/common/statusbar';


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.selectKernel',
			category: NOTEBOOK_ACTIONS_CATEGORY,
			title: { value: nls.localize('notebookActions.selectKernel', "Select Notebook Kernel"), original: 'Select Notebook Kernel' },
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			icon: { id: 'codicon/server-environment' },
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookActionContext): Promise<void> {
		const editorService = accessor.get<IEditorService>(IEditorService);
		const notebookService = accessor.get<INotebookService>(INotebookService);
		const quickInputService = accessor.get<IQuickInputService>(IQuickInputService);

		const activeEditorPane = editorService.activeEditorPane as unknown as { isNotebookEditor?: boolean } | undefined;
		if (!activeEditorPane?.isNotebookEditor) {
			return;
		}
		const editor = editorService.activeEditorPane?.getControl() as INotebookEditor;
		const activeKernel = editor.activeKernel;

		const tokenSource = new CancellationTokenSource();
		const availableKernels2 = await notebookService.getContributedNotebookKernels2(editor.viewModel!.viewType, editor.viewModel!.uri, tokenSource.token);
		const availableKernels = notebookService.getContributedNotebookKernels(editor.viewModel!.viewType, editor.viewModel!.uri);
		const picks: QuickPickInput<IQuickPickItem & { run(): void; }>[] = [...availableKernels2, ...availableKernels].map((a) => {
			return {
				id: a.id,
				label: a.label,
				picked: a.id === activeKernel?.id,
				description:
					(a as INotebookKernelInfo2).description
						? (a as INotebookKernelInfo2).description
						: a.extension.value + (a.id === activeKernel?.id
							? nls.localize('currentActiveKernel', " (Currently Active)")
							: ''),
				run: async () => {
					editor.activeKernel = a;
					if ((a as any).resolve) {
						(a as INotebookKernelInfo2).resolve(editor.uri!, editor.getId(), tokenSource.token);
					}
				}
			};
		});

		const provider = notebookService.getContributedNotebookProviders(editor.viewModel!.uri)[0];

		if (provider.kernel) {
			picks.unshift({
				id: provider.id,
				label: provider.displayName,
				picked: !activeKernel, // no active kernel, the builtin kernel of the provider is used
				description: activeKernel === undefined
					? nls.localize('currentActiveBuiltinKernel', " (Currently Active)")
					: '',
				run: () => {
					editor.activeKernel = undefined;
				}
			});
		}

		const action = await quickInputService.pick(picks, { placeHolder: nls.localize('pickAction', "Select Action"), matchOnDetail: true });
		tokenSource.dispose();
		return action?.run();

	}
});

export class KernelStatus extends Disposable implements IWorkbenchContribution {
	private _editorDisposable = new DisposableStore();
	private readonly kernelInfoElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
	) {
		super();
		this.registerListeners();
	}

	registerListeners() {
		this._register(this._editorService.onDidActiveEditorChange(() => this.updateStatusbar()));
		this._register(this._notebookService.onDidChangeActiveEditor(() => this.updateStatusbar()));
		this._register(this._notebookService.onDidChangeKernels(() => this.updateStatusbar()));
	}

	updateStatusbar() {
		this._editorDisposable.clear();

		const activeEditor = getActiveNotebookEditor(this._editorService);

		if (activeEditor && activeEditor.multipleKernelsAvailable) {
			this.showKernelStatus(activeEditor.activeKernel);
			this._editorDisposable.add(activeEditor.onDidChangeKernel(() => {
				if (activeEditor.multipleKernelsAvailable) {
					this.showKernelStatus(activeEditor.activeKernel);
				} else {
					this.kernelInfoElement.clear();
				}
			}));
		} else {
			this.kernelInfoElement.clear();
		}
	}

	showKernelStatus(kernel: INotebookKernelInfo | INotebookKernelInfo2 | undefined) {
		this.kernelInfoElement.value = this._statusbarService.addEntry({
			text: kernel ? kernel.label : 'Choose Kernel',
			ariaLabel: kernel ? kernel.label : 'Choose Kernel',
			tooltip: nls.localize('chooseActiveKernel', "Choose kernel for current notebook"),
			command: 'notebook.selectKernel',
		}, 'notebook.selectKernel', nls.localize('notebook.selectKernel', "Choose kernel for current notebook"), StatusbarAlignment.RIGHT, 100);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KernelStatus, LifecyclePhase.Ready);

