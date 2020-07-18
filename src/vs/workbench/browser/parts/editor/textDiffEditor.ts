/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as objects from 'vs/base/common/objects';
import { isFunction, isObject, isArray, assertIsDefined } from 'vs/base/common/types';
import { IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { IDiffEditorOptions, IEditorOptions as ICodeEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BaseTextEditor, IEditorConfiguration } from 'vs/workbench/browser/parts/editor/textEditor';
import { TextEditorOptions, EditorInput, EditorOptions, TEXT_DIFF_EDITOR_ID, IEditorInputFactoryRegistry, Extensions as EditorInputExtensions, ITextDiffEditorPane, IEditorInput } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { DiffNavigator } from 'vs/editor/browser/widget/diffNavigator';
import { DiffEditorWidget } from 'vs/editor/browser/widget/diffEditorWidget';
import { TextDiffEditorModel } from 'vs/workbench/common/editor/textDiffEditorModel';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TextFileOperationError, TextFileOperationResult } from 'vs/workbench/services/textfile/common/textfiles';
import { ScrollType, IDiffEditorViewState, IDiffEditorModel } from 'vs/editor/common/editorCommon';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { EditorActivation, IEditorOptions } from 'vs/platform/editor/common/editor';

/**
 * The text editor that leverages the diff text editor for the editing experience.
 */
export class TextDiffEditor extends BaseTextEditor implements ITextDiffEditorPane {

	static readonly ID = TEXT_DIFF_EDITOR_ID;

	private diffNavigator: DiffNavigator | undefined;
	private readonly diffNavigatorDisposables = this._register(new DisposableStore());

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService configurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService
	) {
		super(TextDiffEditor.ID, telemetryService, instantiationService, storageService, configurationService, themeService, editorService, editorGroupService);
	}

	protected onWillCloseEditorInGroup(editor: IEditorInput): void {

		// React to editors closing to preserve or clear view state. This needs to happen
		// in the onWillCloseEditor because at that time the editor has not yet
		// been disposed and we can safely persist the view state still as needed.
		this.doSaveOrClearTextDiffEditorViewState(editor);
	}

	getTitle(): string {
		if (this.input) {
			return this.input.getName();
		}

		return nls.localize('textDiffEditor', "Text Diff Editor");
	}

	createEditorControl(parent: HTMLElement, configuration: ICodeEditorOptions): IDiffEditor {
		return this.instantiationService.createInstance(DiffEditorWidget, parent, configuration);
	}

	async setInput(input: EditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {

		// Dispose previous diff navigator
		this.diffNavigatorDisposables.clear();

		// Update/clear view settings if input changes
		this.doSaveOrClearTextDiffEditorViewState(this.input);

		// Set input and resolve
		await super.setInput(input, options, token);

		try {
			const resolvedModel = await input.resolve();

			// Check for cancellation
			if (token.isCancellationRequested) {
				return undefined;
			}

			// Assert Model Instance
			if (!(resolvedModel instanceof TextDiffEditorModel) && this.openAsBinary(input, options)) {
				return undefined;
			}

			// Set Editor Model
			const diffEditor = assertIsDefined(this.getControl());
			const resolvedDiffEditorModel = <TextDiffEditorModel>resolvedModel;
			diffEditor.setModel(resolvedDiffEditorModel.textDiffEditorModel);

			// Apply Options from TextOptions
			let optionsGotApplied = false;
			if (options && isFunction((<TextEditorOptions>options).apply)) {
				optionsGotApplied = (<TextEditorOptions>options).apply(diffEditor, ScrollType.Immediate);
			}

			// Otherwise restore View State
			let hasPreviousViewState = false;
			if (!optionsGotApplied) {
				hasPreviousViewState = this.restoreTextDiffEditorViewState(input, diffEditor);
			}

			// Diff navigator
			this.diffNavigator = new DiffNavigator(diffEditor, {
				alwaysRevealFirst: !optionsGotApplied && !hasPreviousViewState // only reveal first change if we had no options or viewstate
			});
			this.diffNavigatorDisposables.add(this.diffNavigator);

			// Since the resolved model provides information about being readonly
			// or not, we apply it here to the editor even though the editor input
			// was already asked for being readonly or not. The rationale is that
			// a resolved model might have more specific information about being
			// readonly or not that the input did not have.
			diffEditor.updateOptions({
				readOnly: resolvedDiffEditorModel.modifiedModel?.isReadonly(),
				originalEditable: !resolvedDiffEditorModel.originalModel?.isReadonly()
			});
		} catch (error) {

			// In case we tried to open a file and the response indicates that this is not a text file, fallback to binary diff.
			if (this.isFileBinaryError(error) && this.openAsBinary(input, options)) {
				return;
			}

			throw error;
		}
	}

	private restoreTextDiffEditorViewState(editor: EditorInput, control: IDiffEditor): boolean {
		if (editor instanceof DiffEditorInput) {
			const resource = this.toDiffEditorViewStateResource(editor);
			if (resource) {
				const viewState = this.loadTextEditorViewState(resource);
				if (viewState) {
					control.restoreViewState(viewState);

					return true;
				}
			}
		}

		return false;
	}

	private openAsBinary(input: EditorInput, options: EditorOptions | undefined): boolean {
		if (input instanceof DiffEditorInput) {
			const originalInput = input.originalInput;
			const modifiedInput = input.modifiedInput;

			const binaryDiffInput = new DiffEditorInput(input.getName(), input.getDescription(), originalInput, modifiedInput, true);

			// Forward binary flag to input if supported
			const fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).getFileEditorInputFactory();
			if (fileEditorInputFactory.isFileEditorInput(originalInput)) {
				originalInput.setForceOpenAsBinary();
			}

			if (fileEditorInputFactory.isFileEditorInput(modifiedInput)) {
				modifiedInput.setForceOpenAsBinary();
			}

			// Make sure to not steal away the currently active group
			// because we are triggering another openEditor() call
			// and do not control the initial intent that resulted
			// in us now opening as binary.
			const preservingOptions: IEditorOptions = {
				activation: EditorActivation.PRESERVE,
				pinned: this.group?.isPinned(input),
				sticky: this.group?.isSticky(input)
			};

			if (options) {
				options.overwrite(preservingOptions);
			} else {
				options = EditorOptions.create(preservingOptions);
			}

			// Replace this editor with the binary one
			this.editorService.replaceEditors([{ editor: input, replacement: binaryDiffInput, options }], this.group || ACTIVE_GROUP);

			return true;
		}

		return false;
	}

	protected computeConfiguration(configuration: IEditorConfiguration): ICodeEditorOptions {
		const editorConfiguration = super.computeConfiguration(configuration);

		// Handle diff editor specially by merging in diffEditor configuration
		if (isObject(configuration.diffEditor)) {
			// User settings defines `diffEditor.codeLens`, but there is also `editor.codeLens`.
			// Due to the mixin, the two settings cannot be distinguished anymore.
			//
			// So we map `diffEditor.codeLens` to `diffEditor.originalCodeLens` and `diffEditor.modifiedCodeLens`.
			const diffEditorConfiguration = <IDiffEditorOptions>objects.deepClone(configuration.diffEditor);
			diffEditorConfiguration.originalCodeLens = diffEditorConfiguration.codeLens;
			diffEditorConfiguration.modifiedCodeLens = diffEditorConfiguration.codeLens;
			delete diffEditorConfiguration.codeLens;

			objects.mixin(editorConfiguration, diffEditorConfiguration);
		}

		return editorConfiguration;
	}

	protected getConfigurationOverrides(): ICodeEditorOptions {
		const options: IDiffEditorOptions = super.getConfigurationOverrides();

		options.readOnly = this.input instanceof DiffEditorInput && this.input.modifiedInput.isReadonly();
		options.originalEditable = this.input instanceof DiffEditorInput && !this.input.originalInput.isReadonly();
		options.lineDecorationsWidth = '2ch';

		return options;
	}

	private isFileBinaryError(error: Error[]): boolean;
	private isFileBinaryError(error: Error): boolean;
	private isFileBinaryError(error: Error | Error[]): boolean {
		if (isArray(error)) {
			const errors = <Error[]>error;

			return errors.some(error => this.isFileBinaryError(error));
		}

		return (<TextFileOperationError>error).textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY;
	}

	clearInput(): void {

		// Dispose previous diff navigator
		this.diffNavigatorDisposables.clear();

		// Update/clear editor view state in settings
		this.doSaveOrClearTextDiffEditorViewState(this.input);

		// Clear Model
		const diffEditor = this.getControl();
		if (diffEditor) {
			diffEditor.setModel(null);
		}

		// Pass to super
		super.clearInput();
	}

	getDiffNavigator(): DiffNavigator | undefined {
		return this.diffNavigator;
	}

	getControl(): IDiffEditor | undefined {
		return super.getControl() as IDiffEditor | undefined;
	}

	protected loadTextEditorViewState(resource: URI): IDiffEditorViewState {
		return super.loadTextEditorViewState(resource) as IDiffEditorViewState;  // overridden for text diff editor support
	}

	protected saveState(): void {

		// Update/clear editor view State
		this.doSaveOrClearTextDiffEditorViewState(this.input);

		super.saveState();
	}

	private doSaveOrClearTextDiffEditorViewState(input: IEditorInput | undefined): void {
		if (!(input instanceof DiffEditorInput)) {
			return; // only supported for diff editor inputs
		}

		const resource = this.toDiffEditorViewStateResource(input);
		if (!resource) {
			return; // unable to retrieve input resource
		}

		// Clear view state if input is disposed or we are configured to not storing any state
		if (input.isDisposed() || (!this.shouldRestoreViewState && (!this.group || !this.group.isOpened(input)))) {
			super.clearTextEditorViewState([resource], this.group);
		}

		// Otherwise save it
		else {
			super.saveTextEditorViewState(resource);

			// Make sure to clean up when the input gets disposed
			Event.once(input.onDispose)(() => {
				super.clearTextEditorViewState([resource], this.group);
			});
		}
	}

	protected retrieveTextEditorViewState(resource: URI): IDiffEditorViewState | null {
		return this.retrieveTextDiffEditorViewState(resource); // overridden for text diff editor support
	}

	private retrieveTextDiffEditorViewState(resource: URI): IDiffEditorViewState | null {
		const control = assertIsDefined(this.getControl());
		const model = control.getModel();
		if (!model || !model.modified || !model.original) {
			return null; // view state always needs a model
		}

		const modelUri = this.toDiffEditorViewStateResource(model);
		if (!modelUri) {
			return null; // model URI is needed to make sure we save the view state correctly
		}

		if (modelUri.toString() !== resource.toString()) {
			return null; // prevent saving view state for a model that is not the expected one
		}

		return control.saveViewState();
	}

	private toDiffEditorViewStateResource(modelOrInput: IDiffEditorModel | DiffEditorInput): URI | undefined {
		let original: URI | undefined;
		let modified: URI | undefined;

		if (modelOrInput instanceof DiffEditorInput) {
			original = modelOrInput.originalInput.resource;
			modified = modelOrInput.modifiedInput.resource;
		} else {
			original = modelOrInput.original.uri;
			modified = modelOrInput.modified.uri;
		}

		if (!original || !modified) {
			return undefined;
		}

		// create a URI that is the Base64 concatenation of original + modified resource
		return URI.from({ scheme: 'diff', path: `${btoa(original.toString())}${btoa(modified.toString())}` });
	}
}
