/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { distinct, deepClone } from 'vs/base/common/objects';
import { Event } from 'vs/base/common/event';
import { isObject, assertIsDefined, withNullAsUndefined, isFunction } from 'vs/base/common/types';
import { Dimension } from 'vs/base/browser/dom';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { EditorInput, EditorOptions, IEditorMemento, ITextEditorPane, TextEditorOptions, IEditorCloseEvent, IEditorInput, IEditorOpenContext, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { computeEditorAriaLabel } from 'vs/workbench/browser/editor';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorViewState, IEditor, ScrollType } from 'vs/editor/common/editorCommon';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { isCodeEditor, getCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorGroupsService, IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtUri } from 'vs/base/common/resources';
import { MutableDisposable } from 'vs/base/common/lifecycle';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

export interface IEditorConfiguration {
	editor: object;
	diffEditor: object;
}

/**
 * The base class of editors that leverage the text editor for the editing experience. This class is only intended to
 * be subclassed and not instantiated.
 */
export abstract class BaseTextEditor extends EditorPane implements ITextEditorPane {

	static readonly TEXT_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'textEditorViewState';

	private editorControl: IEditor | undefined;
	private editorContainer: HTMLElement | undefined;
	private hasPendingConfigurationChange: boolean | undefined;
	private lastAppliedEditorOptions?: IEditorOptions;
	private editorMemento: IEditorMemento<IEditorViewState>;

	private readonly groupListener = this._register(new MutableDisposable());

	override get scopedContextKeyService(): IContextKeyService | undefined {
		return isCodeEditor(this.editorControl) ? this.editorControl.invokeWithinContext(accessor => accessor.get(IContextKeyService)) : undefined;
	}

	constructor(
		id: string,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService protected readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorService protected editorService: IEditorService,
		@IEditorGroupsService protected editorGroupService: IEditorGroupsService
	) {
		super(id, telemetryService, themeService, storageService);

		this.editorMemento = this.getEditorMemento<IEditorViewState>(editorGroupService, BaseTextEditor.TEXT_EDITOR_VIEW_STATE_PREFERENCE_KEY, 100);

		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(() => {
			const resource = this.getActiveResource();
			const value = resource ? this.textResourceConfigurationService.getValue<IEditorConfiguration>(resource) : undefined;

			return this.handleConfigurationChangeEvent(value);
		}));

		// ARIA: if a group is added or removed, update the editor's ARIA
		// label so that it appears in the label for when there are > 1 groups
		this._register(Event.any(this.editorGroupService.onDidAddGroup, this.editorGroupService.onDidRemoveGroup)(() => {
			const ariaLabel = this.computeAriaLabel();

			this.editorContainer?.setAttribute('aria-label', ariaLabel);
			this.editorControl?.updateOptions({ ariaLabel });
		}));
	}

	protected handleConfigurationChangeEvent(configuration?: IEditorConfiguration): void {
		if (this.isVisible()) {
			this.updateEditorConfiguration(configuration);
		} else {
			this.hasPendingConfigurationChange = true;
		}
	}

	private consumePendingConfigurationChangeEvent(): void {
		if (this.hasPendingConfigurationChange) {
			this.updateEditorConfiguration();
			this.hasPendingConfigurationChange = false;
		}
	}

	protected computeConfiguration(configuration: IEditorConfiguration): IEditorOptions {

		// Specific editor options always overwrite user configuration
		const editorConfiguration: IEditorOptions = isObject(configuration.editor) ? deepClone(configuration.editor) : Object.create(null);
		Object.assign(editorConfiguration, this.getConfigurationOverrides());

		// ARIA label
		editorConfiguration.ariaLabel = this.computeAriaLabel();

		return editorConfiguration;
	}

	private computeAriaLabel(): string {
		return this._input ? computeEditorAriaLabel(this._input, undefined, this.group, this.editorGroupService.count) : localize('editor', "Editor");
	}

	protected getConfigurationOverrides(): IEditorOptions {
		return {
			overviewRulerLanes: 3,
			lineNumbersMinChars: 3,
			fixedOverflowWidgets: true,
			readOnly: this.input?.isReadonly(),
			// render problems even in readonly editors
			// https://github.com/microsoft/vscode/issues/89057
			renderValidationDecorations: 'on'
		};
	}

	protected createEditor(parent: HTMLElement): void {

		// Editor for Text
		this.editorContainer = parent;
		this.editorControl = this._register(this.createEditorControl(parent, this.computeConfiguration(this.textResourceConfigurationService.getValue<IEditorConfiguration>(this.getActiveResource()))));

		// Model & Language changes
		const codeEditor = getCodeEditor(this.editorControl);
		if (codeEditor) {
			this._register(codeEditor.onDidChangeModelLanguage(() => this.updateEditorConfiguration()));
			this._register(codeEditor.onDidChangeModel(() => this.updateEditorConfiguration()));
		}
	}

	/**
	 * This method creates and returns the text editor control to be used. Subclasses can override to
	 * provide their own editor control that should be used (e.g. a DiffEditor).
	 *
	 * The passed in configuration object should be passed to the editor control when creating it.
	 */
	protected createEditorControl(parent: HTMLElement, configuration: IEditorOptions): IEditor {

		// Use a getter for the instantiation service since some subclasses might use scoped instantiation services
		return this.instantiationService.createInstance(CodeEditorWidget, parent, configuration, {});
	}

	override async setInput(input: EditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		// Update editor options after having set the input. We do this because there can be
		// editor input specific options (e.g. an ARIA label depending on the input showing)
		this.updateEditorConfiguration();

		// Update aria label on editor
		const editorContainer = assertIsDefined(this.editorContainer);
		editorContainer.setAttribute('aria-label', this.computeAriaLabel());
	}

	override setOptions(options: EditorOptions | undefined): void {
		const textOptions = options as TextEditorOptions;
		if (textOptions && isFunction(textOptions.apply)) {
			const textEditor = assertIsDefined(this.getControl());
			textOptions.apply(textEditor, ScrollType.Smooth);
		}
	}

	protected override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {

		// Pass on to Editor
		const editorControl = assertIsDefined(this.editorControl);
		if (visible) {
			this.consumePendingConfigurationChangeEvent();
			editorControl.onVisible();
		} else {
			editorControl.onHide();
		}

		// Listen to close events to trigger `onWillCloseEditorInGroup`
		this.groupListener.value = group?.onWillCloseEditor(e => this.onWillCloseEditor(e));

		super.setEditorVisible(visible, group);
	}

	private onWillCloseEditor(e: IEditorCloseEvent): void {
		const editor = e.editor;
		if (editor === this.input) {
			this.onWillCloseEditorInGroup(editor);
		}
	}

	protected onWillCloseEditorInGroup(editor: IEditorInput): void {
		// Subclasses can override
	}

	override focus(): void {

		// Pass on to Editor
		const editorControl = assertIsDefined(this.editorControl);
		editorControl.focus();
	}

	layout(dimension: Dimension): void {

		// Pass on to Editor
		const editorControl = assertIsDefined(this.editorControl);
		editorControl.layout(dimension);
	}

	override getControl(): IEditor | undefined {
		return this.editorControl;
	}

	getViewState(): IEditorViewState | undefined {
		const resource = this.input?.resource;
		if (resource) {
			return withNullAsUndefined(this.retrieveTextEditorViewState(resource));
		}

		return undefined;
	}

	protected saveTextEditorViewState(resource: URI, cleanUpOnDispose?: IEditorInput): void {
		const editorViewState = this.retrieveTextEditorViewState(resource);
		if (!editorViewState || !this.group) {
			return;
		}

		this.editorMemento.saveEditorState(this.group, resource, editorViewState);

		if (cleanUpOnDispose) {
			this.editorMemento.clearEditorStateOnDispose(resource, cleanUpOnDispose);
		}
	}

	protected shouldRestoreTextEditorViewState(editor: IEditorInput, context?: IEditorOpenContext): boolean {

		// new editor: check with workbench.editor.restoreViewState setting
		if (context?.newInGroup) {
			return this.textResourceConfigurationService.getValue<boolean>(EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }), 'workbench.editor.restoreViewState') === false ? false : true /* restore by default */;
		}

		// existing editor: always restore viewstate
		return true;
	}

	protected retrieveTextEditorViewState(resource: URI): IEditorViewState | null {
		const control = this.getControl();
		if (!isCodeEditor(control)) {
			return null;
		}

		const model = control.getModel();
		if (!model) {
			return null; // view state always needs a model
		}

		const modelUri = model.uri;
		if (!modelUri) {
			return null; // model URI is needed to make sure we save the view state correctly
		}

		if (modelUri.toString() !== resource.toString()) {
			return null; // prevent saving view state for a model that is not the expected one
		}

		return control.saveViewState();
	}

	protected loadTextEditorViewState(resource: URI): IEditorViewState | undefined {
		return this.group ? this.editorMemento.loadEditorState(this.group, resource) : undefined;
	}

	protected moveTextEditorViewState(source: URI, target: URI, comparer: IExtUri): void {
		return this.editorMemento.moveEditorState(source, target, comparer);
	}

	protected clearTextEditorViewState(resources: URI[], group?: IEditorGroup): void {
		for (const resource of resources) {
			this.editorMemento.clearEditorState(resource, group);
		}
	}

	private updateEditorConfiguration(configuration?: IEditorConfiguration): void {
		if (!configuration) {
			const resource = this.getActiveResource();
			if (resource) {
				configuration = this.textResourceConfigurationService.getValue<IEditorConfiguration>(resource);
			}
		}

		if (!this.editorControl || !configuration) {
			return;
		}

		const editorConfiguration = this.computeConfiguration(configuration);

		// Try to figure out the actual editor options that changed from the last time we updated the editor.
		// We do this so that we are not overwriting some dynamic editor settings (e.g. word wrap) that might
		// have been applied to the editor directly.
		let editorSettingsToApply = editorConfiguration;
		if (this.lastAppliedEditorOptions) {
			editorSettingsToApply = distinct(this.lastAppliedEditorOptions, editorSettingsToApply);
		}

		if (Object.keys(editorSettingsToApply).length > 0) {
			this.lastAppliedEditorOptions = editorConfiguration;
			this.editorControl.updateOptions(editorSettingsToApply);
		}
	}

	private getActiveResource(): URI | undefined {
		const codeEditor = getCodeEditor(this.editorControl);
		if (codeEditor) {
			const model = codeEditor.getModel();
			if (model) {
				return model.uri;
			}
		}

		if (this.input) {
			return this.input.resource;
		}

		return undefined;
	}

	override dispose(): void {
		this.lastAppliedEditorOptions = undefined;

		super.dispose();
	}
}
