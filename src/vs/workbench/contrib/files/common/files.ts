/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IWorkbenchEditorConfiguration, IEditorIdentifier, IEditorInput, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { IFilesConfiguration as PlatformIFilesConfiguration, FileChangeType, IFileService } from 'vs/platform/files/common/files';
import { ContextKeyExpr, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService, ILanguageSelection } from 'vs/editor/common/services/modeService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { InputFocusedContextKey } from 'vs/platform/contextkey/common/contextkeys';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { once } from 'vs/base/common/functional';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

/**
 * Explorer viewlet id.
 */
export const VIEWLET_ID = 'workbench.view.explorer';

/**
 * Explorer file view id.
 */
export const VIEW_ID = 'workbench.explorer.fileView';

/**
 * Context Keys to use with keybindings for the Explorer and Open Editors view
 */
export const ExplorerViewletVisibleContext = new RawContextKey<boolean>('explorerViewletVisible', true);
export const ExplorerFolderContext = new RawContextKey<boolean>('explorerResourceIsFolder', false);
export const ExplorerResourceReadonlyContext = new RawContextKey<boolean>('explorerResourceReadonly', false);
export const ExplorerResourceNotReadonlyContext = ExplorerResourceReadonlyContext.toNegated();
/**
 * Comma separated list of editor ids that can be used for the selected explorer resource.
 */
export const ExplorerResourceAvailableEditorIdsContext = new RawContextKey<string>('explorerResourceAvailableEditorIds', '');
export const ExplorerRootContext = new RawContextKey<boolean>('explorerResourceIsRoot', false);
export const ExplorerResourceCut = new RawContextKey<boolean>('explorerResourceCut', false);
export const ExplorerResourceMoveableToTrash = new RawContextKey<boolean>('explorerResourceMoveableToTrash', false);
export const FilesExplorerFocusedContext = new RawContextKey<boolean>('filesExplorerFocus', true);
export const OpenEditorsVisibleContext = new RawContextKey<boolean>('openEditorsVisible', false);
export const OpenEditorsFocusedContext = new RawContextKey<boolean>('openEditorsFocus', true);
export const ExplorerFocusedContext = new RawContextKey<boolean>('explorerViewletFocus', true);

// compressed nodes
export const ExplorerCompressedFocusContext = new RawContextKey<boolean>('explorerViewletCompressedFocus', true);
export const ExplorerCompressedFirstFocusContext = new RawContextKey<boolean>('explorerViewletCompressedFirstFocus', true);
export const ExplorerCompressedLastFocusContext = new RawContextKey<boolean>('explorerViewletCompressedLastFocus', true);

export const FilesExplorerFocusCondition = ContextKeyExpr.and(ExplorerViewletVisibleContext, FilesExplorerFocusedContext, ContextKeyExpr.not(InputFocusedContextKey));
export const ExplorerFocusCondition = ContextKeyExpr.and(ExplorerViewletVisibleContext, ExplorerFocusedContext, ContextKeyExpr.not(InputFocusedContextKey));

/**
 * Text file editor id.
 */
export const TEXT_FILE_EDITOR_ID = 'workbench.editors.files.textFileEditor';

/**
 * File editor input id.
 */
export const FILE_EDITOR_INPUT_ID = 'workbench.editors.files.fileEditorInput';

/**
 * Binary file editor id.
 */
export const BINARY_FILE_EDITOR_ID = 'workbench.editors.files.binaryFileEditor';

export interface IFilesConfiguration extends PlatformIFilesConfiguration, IWorkbenchEditorConfiguration {
	explorer: {
		openEditors: {
			visible: number;
			sortOrder: 'editorOrder' | 'alphabetical';
		};
		autoReveal: boolean | 'focusNoScroll';
		enableDragAndDrop: boolean;
		confirmDelete: boolean;
		sortOrder: SortOrder;
		decorations: {
			colors: boolean;
			badges: boolean;
		};
		incrementalNaming: 'simple' | 'smart';
	};
	editor: IEditorOptions;
}

export interface IFileResource {
	resource: URI;
	isDirectory?: boolean;
}

export const enum SortOrder {
	Default = 'default',
	Mixed = 'mixed',
	FilesFirst = 'filesFirst',
	Type = 'type',
	Modified = 'modified'
}

export class TextFileContentProvider extends Disposable implements ITextModelContentProvider {
	private readonly fileWatcherDisposable = this._register(new MutableDisposable());

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@IFileService private readonly fileService: IFileService,
		@IModeService private readonly modeService: IModeService,
		@IModelService private readonly modelService: IModelService
	) {
		super();
	}

	static async open(resource: URI, scheme: string, label: string, editorService: IEditorService, options?: ITextEditorOptions): Promise<void> {
		await editorService.openEditor({
			leftResource: TextFileContentProvider.resourceToTextFile(scheme, resource),
			rightResource: resource,
			label,
			options
		});
	}

	private static resourceToTextFile(scheme: string, resource: URI): URI {
		return resource.with({ scheme, query: JSON.stringify({ scheme: resource.scheme, query: resource.query }) });
	}

	private static textFileToResource(resource: URI): URI {
		const { scheme, query } = JSON.parse(resource.query);
		return resource.with({ scheme, query });
	}

	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		if (!resource.query) {
			// We require the URI to use the `query` to transport the original scheme and query
			// as done by `resourceToTextFile`
			return null;
		}

		const savedFileResource = TextFileContentProvider.textFileToResource(resource);

		// Make sure our text file is resolved up to date
		const codeEditorModel = await this.resolveEditorModel(resource);

		// Make sure to keep contents up to date when it changes
		if (!this.fileWatcherDisposable.value) {
			this.fileWatcherDisposable.value = this.fileService.onDidFilesChange(changes => {
				if (changes.contains(savedFileResource, FileChangeType.UPDATED)) {
					this.resolveEditorModel(resource, false /* do not create if missing */); // update model when resource changes
				}
			});

			if (codeEditorModel) {
				once(codeEditorModel.onWillDispose)(() => this.fileWatcherDisposable.clear());
			}
		}

		return codeEditorModel;
	}

	private resolveEditorModel(resource: URI, createAsNeeded?: true): Promise<ITextModel>;
	private resolveEditorModel(resource: URI, createAsNeeded?: boolean): Promise<ITextModel | null>;
	private async resolveEditorModel(resource: URI, createAsNeeded: boolean = true): Promise<ITextModel | null> {
		const savedFileResource = TextFileContentProvider.textFileToResource(resource);

		const content = await this.textFileService.readStream(savedFileResource);

		let codeEditorModel = this.modelService.getModel(resource);
		if (codeEditorModel) {
			this.modelService.updateModel(codeEditorModel, content.value);
		} else if (createAsNeeded) {
			const textFileModel = this.modelService.getModel(savedFileResource);

			let languageSelector: ILanguageSelection;
			if (textFileModel) {
				languageSelector = this.modeService.create(textFileModel.getModeId());
			} else {
				languageSelector = this.modeService.createByFilepathOrFirstLine(savedFileResource);
			}

			codeEditorModel = this.modelService.createModel(content.value, languageSelector, resource);
		}

		return codeEditorModel;
	}
}

export class OpenEditor implements IEditorIdentifier {

	private id: number;
	private static COUNTER = 0;

	constructor(private _editor: IEditorInput, private _group: IEditorGroup) {
		this.id = OpenEditor.COUNTER++;
	}

	get editor() {
		return this._editor;
	}

	get group() {
		return this._group;
	}

	get groupId() {
		return this._group.id;
	}

	getId(): string {
		return `openeditor:${this.groupId}:${this.id}`;
	}

	isPreview(): boolean {
		return this._group.previewEditor === this.editor;
	}

	isSticky(): boolean {
		return this._group.isSticky(this.editor);
	}

	getResource(): URI | undefined {
		return EditorResourceAccessor.getOriginalUri(this.editor, { supportSideBySide: SideBySideEditor.PRIMARY });
	}
}
