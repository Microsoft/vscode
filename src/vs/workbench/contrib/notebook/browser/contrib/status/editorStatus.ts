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
import { INotebookKernelInfo2 } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Disposable, DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/common/statusbar';
import { NotebookKernelProviderAssociation, NotebookKernelProviderAssociations, notebookKernelProviderAssociationsSettingId } from 'vs/workbench/contrib/notebook/browser/notebookKernelAssociation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { configureKernelIcon, selectKernelIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.selectKernel',
			category: NOTEBOOK_ACTIONS_CATEGORY,
			title: { value: nls.localize('notebookActions.selectKernel', "Select Notebook Kernel"), original: 'Select Notebook Kernel' },
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			icon: selectKernelIcon,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookActionContext): Promise<void> {
		const editorService = accessor.get<IEditorService>(IEditorService);
		const quickInputService = accessor.get<IQuickInputService>(IQuickInputService);
		const configurationService = accessor.get<IConfigurationService>(IConfigurationService);

		const activeEditorPane = editorService.activeEditorPane as unknown as { isNotebookEditor?: boolean } | undefined;
		if (!activeEditorPane?.isNotebookEditor) {
			return;
		}
		const editor = editorService.activeEditorPane?.getControl() as INotebookEditor;
		const activeKernel = editor.activeKernel;

		const picker = quickInputService.createQuickPick<(IQuickPickItem & { run(): void; kernelProviderId?: string })>();
		picker.placeholder = nls.localize('notebook.runCell.selectKernel', "Select a notebook kernel to run this notebook");
		picker.matchOnDetail = true;
		picker.show();
		picker.busy = true;

		const tokenSource = new CancellationTokenSource();
		const availableKernels2 = await editor.beginComputeContributedKernels();
		const picks: QuickPickInput<IQuickPickItem & { run(): void; kernelProviderId?: string; }>[] = [...availableKernels2].map((a) => {
			return {
				id: a.id,
				label: a.label,
				picked: a.id === activeKernel?.id,
				description:
					a.description
						? a.description
						: a.extension.value + (a.id === activeKernel?.id
							? nls.localize('currentActiveKernel', " (Currently Active)")
							: ''),
				detail: a.detail,
				kernelProviderId: a.extension.value,
				run: async () => {
					editor.activeKernel = a;
					a.resolve(editor.uri!, editor.getId(), tokenSource.token);
				},
				buttons: [{
					iconClass: ThemeIcon.asClassName(configureKernelIcon),
					tooltip: nls.localize('notebook.promptKernel.setDefaultTooltip', "Set as default kernel provider for '{0}'", editor.viewModel!.viewType)
				}]
			};
		});

		picker.items = picks;
		picker.busy = false;
		picker.activeItems = picks.filter(pick => (pick as IQuickPickItem).picked) as (IQuickPickItem & { run(): void; kernelProviderId?: string; })[];

		const pickedItem = await new Promise<(IQuickPickItem & { run(): void; kernelProviderId?: string; }) | undefined>(resolve => {
			picker.onDidAccept(() => {
				resolve(picker.selectedItems.length === 1 ? picker.selectedItems[0] : undefined);
				picker.dispose();
			});

			picker.onDidTriggerItemButton(e => {
				const pick = e.item;
				const id = pick.id;
				resolve(pick); // open the view
				picker.dispose();

				// And persist the setting
				if (pick && id && pick.kernelProviderId) {
					const newAssociation: NotebookKernelProviderAssociation = { viewType: editor.viewModel!.viewType, kernelProvider: pick.kernelProviderId };
					const currentAssociations = [...configurationService.getValue<NotebookKernelProviderAssociations>(notebookKernelProviderAssociationsSettingId)];

					// First try updating existing association
					for (let i = 0; i < currentAssociations.length; ++i) {
						const existing = currentAssociations[i];
						if (existing.viewType === newAssociation.viewType) {
							currentAssociations.splice(i, 1, newAssociation);
							configurationService.updateValue(notebookKernelProviderAssociationsSettingId, currentAssociations);
							return;
						}
					}

					// Otherwise, create a new one
					currentAssociations.unshift(newAssociation);
					configurationService.updateValue(notebookKernelProviderAssociationsSettingId, currentAssociations);
				}
			});

		});

		tokenSource.dispose();
		return pickedItem?.run();
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

		if (activeEditor) {
			this._editorDisposable.add(activeEditor.onDidChangeKernel(() => {
				if (activeEditor.multipleKernelsAvailable) {
					this.showKernelStatus(activeEditor.activeKernel);
				} else {
					this.kernelInfoElement.clear();
				}
			}));

			this._editorDisposable.add(activeEditor.onDidChangeAvailableKernels(() => {
				if (activeEditor.multipleKernelsAvailable) {
					this.showKernelStatus(activeEditor.activeKernel);
				} else {
					this.kernelInfoElement.clear();
				}
			}));
		}

		if (activeEditor && activeEditor.multipleKernelsAvailable) {
			this.showKernelStatus(activeEditor.activeKernel);
		} else {
			this.kernelInfoElement.clear();
		}
	}

	showKernelStatus(kernel: INotebookKernelInfo2 | undefined) {
		this.kernelInfoElement.value = this._statusbarService.addEntry({
			text: kernel ? kernel.label : 'Choose Kernel',
			ariaLabel: kernel ? kernel.label : 'Choose Kernel',
			tooltip: nls.localize('chooseActiveKernel', "Choose kernel for current notebook"),
			command: 'notebook.selectKernel',
		}, 'notebook.selectKernel', nls.localize('notebook.selectKernel', "Choose kernel for current notebook"), StatusbarAlignment.RIGHT, 100);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(KernelStatus, LifecyclePhase.Ready);

