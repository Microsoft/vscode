/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { deepClone } from 'vs/base/common/objects';
import { isFunction, isObject, isArray, assertIsDefined, withUndefinedAsNull } from 'vs/base/common/types';
import { IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { IDiffEditorOptions, IEditorOptions as ICodeEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BaseTextEditor, IEditorConfiguration } from 'vs/workbench/browser/parts/editor/textEditor';
import { TextEditorOptions, EditorInput, EditorOptions, TEXT_DIFF_EDITOR_ID, IEditorInputFactoryRegistry, EditorExtensions, ITextDiffEditorPane, IEditorInput, IEditorOpenContext } from 'vs/workbench/common/editor';
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
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { EditorActivation, IEditorOptions } from 'vs/platform/editor/common/editor';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { isEqual } from 'vs/base/common/resources';
import { multibyteAwareBtoa } from 'vs/base/browser/dom';
import { IFileService } from 'vs/platform/files/common/files';

/**
 * The text editor that leverages the diff text editor for the editing experience.
 */
export class TextDiffEditor extends BaseTextEditor implements ITextDiffEditorPane {

	static readonly ID = TEXT_DIFF_EDITOR_ID;

	private diffNavigator: DiffNavigator | undefined;
	private readonly diffNavigatorDisposables = this._register(new DisposableStore());

	override get scopedContextKeyService(): IContextKeyService | undefined {
		const control = this.getControl();
		if (!control) {
			return undefined;
		}

		const originalEditor = control.getOriginalEditor();
		const modifiedEditor = control.getModifiedEditor();

		return (originalEditor.hasTextFocus() ? originalEditor : modifiedEditor).invokeWithinContext(accessor => accessor.get(IContextKeyService));
	}

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService configurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService private readonly fileService: IFileService
	) {
		super(TextDiffEditor.ID, telemetryService, instantiationService, storageService, configurationService, themeService, editorService, editorGroupService);

		// Listen to file system provider changes
		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onDidFileSystemProviderChange(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onDidFileSystemProviderChange(e.scheme)));
	}

	private onDidFileSystemProviderChange(scheme: string): void {
		const control = this.getControl();
		const input = this.input;

		if (control && input instanceof DiffEditorInput) {
			if (input.originalInput.resource?.scheme === scheme || input.modifiedInput.resource?.scheme === scheme) {
				control.updateOptions({
					readOnly: input.modifiedInput.isReadonly(),
					originalEditable: !input.originalInput.isReadonly()
				});
			}
		}
	}

	protected override onWillCloseEditorInGroup(editor: IEditorInput): void {

		// React to editors closing to preserve or clear view state. This needs to happen
		// in the onWillCloseEditor because at that time the editor has not yet
		// been disposed and we can safely persist the view state still as needed.
		this.doSaveOrClearTextDiffEditorViewState(editor);
	}

	override getTitle(): string {
		if (this.input) {
			return this.input.getName();
		}

		return localize('textDiffEditor', "Text Diff Editor");
	}

	override createEditorControl(parent: HTMLElement, configuration: ICodeEditorOptions): IDiffEditor {
		return this.instantiationService.createInstance(DiffEditorWidget, parent, configuration, {});
	}

	override async setInput(input: EditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {

		// Dispose previous diff navigator
		this.diffNavigatorDisposables.clear();

		// Update/clear view settings if input changes
		this.doSaveOrClearTextDiffEditorViewState(this.input);

		// Set input and resolve
		await super.setInput(input, options, context, token);

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
			const resolvedDiffEditorModel = resolvedModel as TextDiffEditorModel;
			diffEditor.setModel(withUndefinedAsNull(resolvedDiffEditorModel.textDiffEditorModel));

			// Apply Options from TextOptions
			let optionsGotApplied = false;
			if (options && isFunction((<TextEditorOptions>options).apply)) {
				optionsGotApplied = (<TextEditorOptions>options).apply(diffEditor, ScrollType.Immediate);
			}

			// Otherwise restore View State unless disabled via settings
			let hasPreviousViewState = false;
			if (!optionsGotApplied && this.shouldRestoreTextEditorViewState(input, context)) {
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

			const binaryDiffInput = this.instantiationService.createInstance(DiffEditorInput, input.getName(), input.getDescription(), originalInput, modifiedInput, true);

			// Forward binary flag to input if supported
			const fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).getFileEditorInputFactory();
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

	protected override computeConfiguration(configuration: IEditorConfiguration): ICodeEditorOptions {
		const editorConfiguration = super.computeConfiguration(configuration);

		// Handle diff editor specially by merging in diffEditor configuration
		if (isObject(configuration.diffEditor)) {
			const diffEditorConfiguration: IDiffEditorOptions = deepClone(configuration.diffEditor);

			// User settings defines `diffEditor.codeLens`, but here we rename that to `diffEditor.diffCodeLens` to avoid collisions with `editor.codeLens`.
			diffEditorConfiguration.diffCodeLens = diffEditorConfiguration.codeLens;
			delete diffEditorConfiguration.codeLens;

			// User settings defines `diffEditor.wordWrap`, but here we rename that to `diffEditor.diffWordWrap` to avoid collisions with `editor.wordWrap`.
			diffEditorConfiguration.diffWordWrap = <'off' | 'on' | 'inherit' | undefined>diffEditorConfiguration.wordWrap;
			delete diffEditorConfiguration.wordWrap;

			Object.assign(editorConfiguration, diffEditorConfiguration);
		}

		return editorConfiguration;
	}

	protected override getConfigurationOverrides(): ICodeEditorOptions {
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

	override clearInput(): void {

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

	override getControl(): IDiffEditor | undefined {
		return super.getControl() as IDiffEditor | undefined;
	}

	protected override loadTextEditorViewState(resource: URI): IDiffEditorViewState {
		return super.loadTextEditorViewState(resource) as IDiffEditorViewState;  // overridden for text diff editor support
	}

	protected override saveState(): void {

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
		if (input.isDisposed() || (!this.shouldRestoreTextEditorViewState(input) && (!this.group || !this.group.contains(input)))) {
			super.clearTextEditorViewState([resource], this.group);
		}

		// Otherwise save it
		else {
			super.saveTextEditorViewState(resource, input);
		}
	}

	protected override retrieveTextEditorViewState(resource: URI): IDiffEditorViewState | null {
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

		if (!isEqual(modelUri, resource)) {
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
		return URI.from({ scheme: 'diff', path: `${multibyteAwareBtoa(original.toString())}${multibyteAwareBtoa(modified.toString())}` });
	}
}
