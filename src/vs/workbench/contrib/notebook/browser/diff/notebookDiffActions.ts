/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBulkEditService, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { localize } from 'vs/nls';
import { Action2, ICommandActionTitle, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ActiveEditorContext, viewColumnToEditorGroup } from 'vs/workbench/common/editor';
import { DiffElementViewModelBase } from 'vs/workbench/contrib/notebook/browser/diff/diffElementViewModel';
import { NOTEBOOK_DIFF_CELL_PROPERTY, NOTEBOOK_DIFF_CELL_PROPERTY_EXPANDED } from 'vs/workbench/contrib/notebook/browser/diff/notebookDiffEditorBrowser';
import { NotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffEditor';
import { NotebookDiffEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookDiffEditorInput';
import { openAsTextIcon, renderOutputIcon, revertIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { EditorOverride } from 'vs/platform/editor/common/editor';

// ActiveEditorContext.isEqualTo(SearchEditorConstants.SearchEditorID)

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.diff.switchToText',
			icon: openAsTextIcon,
			title: { value: localize('notebook.diff.switchToText', "Open Text Diff Editor"), original: 'Open Text Diff Editor' },
			precondition: ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID),
			menu: [{
				id: MenuId.EditorTitle,
				group: 'navigation',
				when: ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID)
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);

		const activeEditor = editorService.activeEditorPane;
		if (activeEditor && activeEditor instanceof NotebookTextDiffEditor) {
			const diffEditorInput = activeEditor.input as NotebookDiffEditorInput;
			const leftResource = diffEditorInput.originalResource;
			const rightResource = diffEditorInput.resource;
			const options = {
				preserveFocus: false
			};

			const label = diffEditorInput.textDiffName;
			const input = editorService.createEditorInput({ leftResource, rightResource, label, options });
			await editorService.openEditor(input, { override: EditorOverride.DISABLED }, viewColumnToEditorGroup(editorGroupService, undefined));
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.revertMetadata',
				title: localize('notebook.diff.cell.revertMetadata', "Revert Metadata"),
				icon: revertIcon,
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellMetadataTitle,
					when: NOTEBOOK_DIFF_CELL_PROPERTY
				},
				precondition: NOTEBOOK_DIFF_CELL_PROPERTY
			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: DiffElementViewModelBase }) {
		if (!context) {
			return;
		}

		const original = context.cell.original;
		const modified = context.cell.modified;

		if (!original || !modified) {
			return;
		}

		modified.textModel.metadata = original.metadata;
	}
});

// registerAction2(class extends Action2 {
// 	constructor() {
// 		super(
// 			{
// 				id: 'notebook.diff.cell.switchOutputRenderingStyle',
// 				title: localize('notebook.diff.cell.switchOutputRenderingStyle', "Switch Outputs Rendering"),
// 				icon: renderOutputIcon,
// 				f1: false,
// 				menu: {
// 					id: MenuId.NotebookDiffCellOutputsTitle
// 				}
// 			}
// 		);
// 	}
// 	run(accessor: ServicesAccessor, context?: { cell: DiffElementViewModelBase }) {
// 		if (!context) {
// 			return;
// 		}

// 		context.cell.renderOutput = true;
// 	}
// });


registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.switchOutputRenderingStyleToText',
				title: localize('notebook.diff.cell.switchOutputRenderingStyleToText', "Switch Output Rendering"),
				icon: renderOutputIcon,
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellOutputsTitle,
					when: NOTEBOOK_DIFF_CELL_PROPERTY_EXPANDED
				}
			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: DiffElementViewModelBase }) {
		if (!context) {
			return;
		}

		context.cell.renderOutput = !context.cell.renderOutput;
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.revertOutputs',
				title: localize('notebook.diff.cell.revertOutputs', "Revert Outputs"),
				icon: revertIcon,
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellOutputsTitle,
					when: NOTEBOOK_DIFF_CELL_PROPERTY
				},
				precondition: NOTEBOOK_DIFF_CELL_PROPERTY
			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: DiffElementViewModelBase }) {
		if (!context) {
			return;
		}

		const original = context.cell.original;
		const modified = context.cell.modified;

		if (!original || !modified) {
			return;
		}

		modified.textModel.spliceNotebookCellOutputs([[0, modified.outputs.length, original.outputs]]);
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: 'notebook.diff.cell.revertInput',
				title: localize('notebook.diff.cell.revertInput', "Revert Input"),
				icon: revertIcon,
				f1: false,
				menu: {
					id: MenuId.NotebookDiffCellInputTitle,
					when: NOTEBOOK_DIFF_CELL_PROPERTY
				},
				precondition: NOTEBOOK_DIFF_CELL_PROPERTY

			}
		);
	}
	run(accessor: ServicesAccessor, context?: { cell: DiffElementViewModelBase }) {
		if (!context) {
			return;
		}

		const original = context.cell.original;
		const modified = context.cell.modified;

		if (!original || !modified) {
			return;
		}

		const bulkEditService = accessor.get(IBulkEditService);
		return bulkEditService.apply([
			new ResourceTextEdit(modified.uri, { range: modified.textModel.getFullModelRange(), text: original.textModel.getValue() }),
		], { quotableLabel: 'Split Notebook Cell' });
	}
});

class ToggleRenderAction extends Action2 {
	constructor(id: string, title: string | ICommandActionTitle, precondition: ContextKeyExpression | undefined, toggled: ContextKeyExpression | undefined, order: number, private readonly toggleOutputs?: boolean, private readonly toggleMetadata?: boolean) {
		super({
			id: id,
			title: title,
			precondition: precondition,
			menu: [{
				id: MenuId.EditorTitle,
				group: 'notebook',
				when: precondition,
				order: order,
			}],
			toggled: toggled
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		if (this.toggleOutputs !== undefined) {
			const oldValue = configurationService.getValue<boolean>('notebook.diff.ignoreOutputs');
			configurationService.updateValue('notebook.diff.ignoreOutputs', !oldValue);
		}

		if (this.toggleMetadata !== undefined) {
			const oldValue = configurationService.getValue<boolean>('notebook.diff.ignoreMetadata');
			configurationService.updateValue('notebook.diff.ignoreMetadata', !oldValue);
		}
	}
}

registerAction2(class extends ToggleRenderAction {
	constructor() {
		super('notebook.diff.showOutputs',
			{ value: localize('notebook.diff.showOutputs', "Show Outputs Differences"), original: 'Show Outputs Differences' },
			ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID),
			ContextKeyExpr.notEquals('config.notebook.diff.ignoreOutputs', true),
			2,
			true,
			undefined
		);
	}
});

registerAction2(class extends ToggleRenderAction {
	constructor() {
		super('notebook.diff.showMetadata',
			{ value: localize('notebook.diff.showMetadata', "Show Metadata Differences"), original: 'Show Metadata Differences' },
			ActiveEditorContext.isEqualTo(NotebookTextDiffEditor.ID),
			ContextKeyExpr.notEquals('config.notebook.diff.ignoreMetadata', true),
			1,
			undefined,
			true
		);
	}
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'notebook',
	order: 100,
	type: 'object',
	'properties': {
		'notebook.diff.ignoreMetadata': {
			type: 'boolean',
			default: false,
			markdownDescription: localize('notebook.diff.ignoreMetadata', "Hide Metadata Differences")
		},
		'notebook.diff.ignoreOutputs': {
			type: 'boolean',
			default: false,
			markdownDescription: localize('notebook.diff.ignoreOutputs', "Hide Outputs Differences")
		},
	}
});
