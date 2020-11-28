/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { assertIsDefined, isFunction, withNullAsUndefined } from 'vs/base/common/types';
import { ICodeEditor, getCodeEditor, IPasteEvent } from 'vs/editor/browser/editorBrowser';
import { TextEditorOptions, EditorInput, EditorOptions, IEditorOpenContext } from 'vs/workbench/common/editor';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { BaseTextEditor } from 'vs/workbench/browser/parts/editor/textEditor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ScrollType, IEditor } from 'vs/editor/common/editorCommon';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { EditorOption, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ModelConstants } from 'vs/editor/common/model';

/**
 * An editor implementation that is capable of showing the contents of resource inputs. Uses
 * the TextEditor widget to show the contents.
 */
export class AbstractTextResourceEditor extends BaseTextEditor {

	constructor(
		id: string,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(id, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorService, editorGroupService);
	}

	getTitle(): string | undefined {
		if (this.input) {
			return this.input.getName();
		}

		return nls.localize('textEditor', "Text Editor");
	}

	async setInput(input: EditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {

		// Remember view settings if input changes
		this.saveTextResourceEditorViewState(this.input);

		// Set input and resolve
		await super.setInput(input, options, context, token);
		const resolvedModel = await input.resolve();

		// Check for cancellation
		if (token.isCancellationRequested) {
			return undefined;
		}

		// Assert Model instance
		if (!(resolvedModel instanceof BaseTextEditorModel)) {
			throw new Error('Unable to open file as text');
		}

		// Set Editor Model
		const textEditor = assertIsDefined(this.getControl());
		const textEditorModel = resolvedModel.textEditorModel;
		textEditor.setModel(textEditorModel);

		// Apply Options from TextOptions
		let optionsGotApplied = false;
		const textOptions = <TextEditorOptions>options;
		if (textOptions && isFunction(textOptions.apply)) {
			optionsGotApplied = textOptions.apply(textEditor, ScrollType.Immediate);
		}

		// Otherwise restore View State unless disabled via settings
		if (!optionsGotApplied && this.shouldRestoreTextEditorViewState(input, context)) {
			this.restoreTextResourceEditorViewState(input, textEditor);
		}

		// Since the resolved model provides information about being readonly
		// or not, we apply it here to the editor even though the editor input
		// was already asked for being readonly or not. The rationale is that
		// a resolved model might have more specific information about being
		// readonly or not that the input did not have.
		textEditor.updateOptions({ readOnly: resolvedModel.isReadonly() });
	}

	private restoreTextResourceEditorViewState(editor: EditorInput, control: IEditor) {
		if (editor instanceof UntitledTextEditorInput || editor instanceof ResourceEditorInput) {
			const viewState = this.loadTextEditorViewState(editor.resource);
			if (viewState) {
				control.restoreViewState(viewState);
			}
		}
	}

	/**
	 * Reveals the last line of this editor if it has a model set.
	 */
	revealLastLine(): void {
		const codeEditor = <ICodeEditor>this.getControl();
		const model = codeEditor.getModel();

		if (model) {
			const lastLine = model.getLineCount();
			codeEditor.revealPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) }, ScrollType.Smooth);
		}
	}

	clearInput(): void {

		// Keep editor view state in settings to restore when coming back
		this.saveTextResourceEditorViewState(this.input);

		// Clear Model
		const textEditor = this.getControl();
		if (textEditor) {
			textEditor.setModel(null);
		}

		super.clearInput();
	}

	protected saveState(): void {

		// Save View State (only for untitled)
		if (this.input instanceof UntitledTextEditorInput) {
			this.saveTextResourceEditorViewState(this.input);
		}

		super.saveState();
	}

	private saveTextResourceEditorViewState(input: EditorInput | undefined): void {
		if (!(input instanceof UntitledTextEditorInput) && !(input instanceof ResourceEditorInput)) {
			return; // only enabled for untitled and resource inputs
		}

		const resource = input.resource;

		// Clear view state if input is disposed
		if (input.isDisposed()) {
			super.clearTextEditorViewState([resource]);
		}

		// Otherwise save it
		else {
			super.saveTextEditorViewState(resource, input);
		}
	}
}

export class TextResourceEditor extends AbstractTextResourceEditor {

	static readonly ID = 'workbench.editors.textResourceEditor';

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService
	) {
		super(TextResourceEditor.ID, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorGroupService, editorService);
	}

	protected createEditorControl(parent: HTMLElement, configuration: IEditorOptions): IEditor {
		const control = super.createEditorControl(parent, configuration);

		// Install a listener for paste to update this editors
		// language mode if the paste includes a specific mode
		const codeEditor = getCodeEditor(control);
		if (codeEditor) {
			this._register(codeEditor.onDidPaste(e => this.onDidEditorPaste(e, codeEditor)));
		}

		return control;
	}

	private onDidEditorPaste(e: IPasteEvent, codeEditor: ICodeEditor): void {
		if (this.input instanceof UntitledTextEditorInput && this.input.model.hasModeSetExplicitly) {
			return; // do not override mode if it was set explicitly
		}

		if (e.range.startLineNumber !== 1 || e.range.startColumn !== 1) {
			return; // only when pasting into first line, first column (= empty document)
		}

		if (codeEditor.getOption(EditorOption.readOnly)) {
			return; // not for readonly editors
		}

		const textModel = codeEditor.getModel();
		if (!textModel) {
			return; // require a live model
		}

		const currentMode = textModel.getModeId();
		if (currentMode !== PLAINTEXT_MODE_ID) {
			return; // require current mode to be unspecific
		}

		let candidateMode: string | undefined = undefined;

		// A mode is provided via the paste event so text was copied using
		// VSCode. As such we trust this mode and use it if specific
		if (e.mode) {
			candidateMode = e.mode;
		}

		// A mode was not provided, so the data comes from outside VSCode
		// We can still try to guess a good mode from the first line if
		// the paste changed the first line
		else {
			candidateMode = withNullAsUndefined(this.modeService.getModeIdByFilepathOrFirstLine(textModel.uri, textModel.getLineContent(1).substr(0, ModelConstants.FIRST_LINE_DETECTION_LENGTH_LIMIT)));
		}

		// Finally apply mode to model if specified
		if (candidateMode !== PLAINTEXT_MODE_ID) {
			this.modelService.setMode(textModel, this.modeService.create(candidateMode));
		}
	}
}
