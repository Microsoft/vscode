/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEncodingSupport, ISaveOptions, IModeSupport } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { URI } from 'vs/base/common/uri';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { Event, Emitter } from 'vs/base/common/event';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { ITextBufferFactory, ITextModel } from 'vs/editor/common/model';
import { createTextBufferFactory } from 'vs/editor/common/model/textModel';
import { IResolvedTextEditorModel, ITextEditorModel } from 'vs/editor/common/services/resolverService';
import { IWorkingCopyService, IWorkingCopy, WorkingCopyCapabilities, IWorkingCopyBackup } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { withNullAsUndefined, assertIsDefined } from 'vs/base/common/types';
import { ILabelService } from 'vs/platform/label/common/label';
import { ensureValidWordDefinition } from 'vs/editor/common/model/wordHelper';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export interface IUntitledTextEditorModel extends ITextEditorModel, IModeSupport, IEncodingSupport, IWorkingCopy {

	/**
	 * Emits an event when the encoding of this untitled model changes.
	 */
	readonly onDidChangeEncoding: Event<void>;

	/**
	 * Emits an event when the name of this untitled model changes.
	 */
	readonly onDidChangeName: Event<void>;

	/**
	 * Emits an event when this untitled model is reverted.
	 */
	readonly onDidRevert: Event<void>;

	/**
	 * Whether this untitled text model has an associated file path.
	 */
	readonly hasAssociatedFilePath: boolean;

	/**
	 * Whether this model has an explicit language mode or not.
	 */
	readonly hasModeSetExplicitly: boolean;

	/**
	 * Sets the encoding to use for this untitled model.
	 */
	setEncoding(encoding: string): void;

	/**
	 * Load the untitled model.
	 */
	load(): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;

	/**
	 * Updates the value of the untitled model optionally allowing to ignore dirty.
	 * The model must be resolved for this method to work.
	 */
	setValue(this: IResolvedTextEditorModel, value: string, ignoreDirty?: boolean): void;
}

export class UntitledTextEditorModel extends BaseTextEditorModel implements IUntitledTextEditorModel {

	private static readonly FIRST_LINE_NAME_MAX_LENGTH = 40;

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	private readonly _onDidChangeName = this._register(new Emitter<void>());
	readonly onDidChangeName = this._onDidChangeName.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<void>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidRevert = this._register(new Emitter<void>());
	readonly onDidRevert = this._onDidRevert.event;

	readonly capabilities = WorkingCopyCapabilities.Untitled;

	private cachedModelFirstLineWords: string | undefined = undefined;
	get name(): string {
		// Take name from first line if present and only if
		// we have no associated file path. In that case we
		// prefer the file name as title.
		if (this.configuredLabelFormat === 'content' && !this.hasAssociatedFilePath && this.cachedModelFirstLineWords) {
			return this.cachedModelFirstLineWords;
		}

		// Otherwise fallback to resource
		return this.labelService.getUriBasenameLabel(this.resource);
	}

	private dirty = this.hasAssociatedFilePath || !!this.initialValue;
	private ignoreDirtyOnModelContentChange = false;

	private versionId = 0;

	private configuredEncoding: string | undefined;
	private configuredLabelFormat: 'content' | 'name' = 'content';

	constructor(
		public readonly resource: URI,
		public readonly hasAssociatedFilePath: boolean,
		private readonly initialValue: string | undefined,
		private preferredMode: string | undefined,
		private preferredEncoding: string | undefined,
		@IModeService modeService: IModeService,
		@IModelService modelService: IModelService,
		@IBackupFileService private readonly backupFileService: IBackupFileService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(modelService, modeService);

		// Make known to working copy service
		this._register(this.workingCopyService.registerWorkingCopy(this));

		if (preferredMode) {
			this.setMode(preferredMode);
		}

		// Fetch config
		this.onConfigurationChange(false);

		this.registerListeners();
	}

	private registerListeners(): void {

		// Config Changes
		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(e => this.onConfigurationChange(true)));
	}

	private onConfigurationChange(fromEvent: boolean): void {

		// Encoding
		const configuredEncoding = this.textResourceConfigurationService.getValue<string>(this.resource, 'files.encoding');
		if (this.configuredEncoding !== configuredEncoding) {
			this.configuredEncoding = configuredEncoding;

			if (fromEvent && !this.preferredEncoding) {
				this._onDidChangeEncoding.fire(); // do not fire event if we have a preferred encoding set
			}
		}

		// Label Format
		const configuredLabelFormat = this.textResourceConfigurationService.getValue<string>(this.resource, 'workbench.editor.untitled.labelFormat');
		if (this.configuredLabelFormat !== configuredLabelFormat && (configuredLabelFormat === 'content' || configuredLabelFormat === 'name')) {
			this.configuredLabelFormat = configuredLabelFormat;

			if (fromEvent) {
				this._onDidChangeName.fire();
			}
		}
	}

	getVersionId(): number {
		return this.versionId;
	}

	private _hasModeSetExplicitly: boolean = false;
	get hasModeSetExplicitly(): boolean { return this._hasModeSetExplicitly; }

	setMode(mode: string): void {

		// Remember that an explicit mode was set
		this._hasModeSetExplicitly = true;

		let actualMode: string | undefined = undefined;
		if (mode === '${activeEditorLanguage}') {
			// support the special '${activeEditorLanguage}' mode by
			// looking up the language mode from the currently
			// active text editor if any
			actualMode = this.editorService.activeTextEditorMode;
		} else {
			actualMode = mode;
		}

		this.preferredMode = actualMode;

		if (actualMode) {
			super.setMode(actualMode);
		}
	}

	getMode(): string | undefined {
		if (this.textEditorModel) {
			return this.textEditorModel.getModeId();
		}

		return this.preferredMode;
	}

	getEncoding(): string | undefined {
		return this.preferredEncoding || this.configuredEncoding;
	}

	setEncoding(encoding: string): void {
		const oldEncoding = this.getEncoding();
		this.preferredEncoding = encoding;

		// Emit if it changed
		if (oldEncoding !== this.preferredEncoding) {
			this._onDidChangeEncoding.fire();
		}
	}

	setValue(value: string, ignoreDirty?: boolean): void {
		if (ignoreDirty) {
			this.ignoreDirtyOnModelContentChange = true;
		}

		try {
			this.updateTextEditorModel(createTextBufferFactory(value));
		} finally {
			this.ignoreDirtyOnModelContentChange = false;
		}
	}

	isReadonly(): boolean {
		return false;
	}

	isDirty(): boolean {
		return this.dirty;
	}

	private setDirty(dirty: boolean): void {
		if (this.dirty === dirty) {
			return;
		}

		this.dirty = dirty;
		this._onDidChangeDirty.fire();
	}

	async save(options?: ISaveOptions): Promise<boolean> {
		const target = await this.textFileService.save(this.resource, options);

		return !!target;
	}

	async revert(): Promise<void> {
		this.setDirty(false);

		// Emit as event
		this._onDidRevert.fire();

		// A reverted untitled model is invalid because it has
		// no actual source on disk to revert to. As such we
		// dispose the model.
		this.dispose();
	}

	async backup(): Promise<IWorkingCopyBackup> {
		return { content: withNullAsUndefined(this.createSnapshot()) };
	}

	async load(): Promise<UntitledTextEditorModel & IResolvedTextEditorModel> {

		// Check for backups
		const backup = await this.backupFileService.resolve(this.resource);

		let untitledContents: ITextBufferFactory;
		if (backup) {
			untitledContents = backup.value;
		} else {
			untitledContents = createTextBufferFactory(this.initialValue || '');
		}

		// Create text editor model if not yet done
		let createdUntitledModel = false;
		if (!this.textEditorModel) {
			this.createTextEditorModel(untitledContents, this.resource, this.preferredMode);
			createdUntitledModel = true;
		}

		// Otherwise: the untitled model already exists and we must assume
		// that the value of the model was changed by the user. As such we
		// do not update the contents, only the mode if configured.
		else {
			this.updateTextEditorModel(undefined, this.preferredMode);
		}

		// Listen to text model events
		const textEditorModel = assertIsDefined(this.textEditorModel);
		this._register(textEditorModel.onDidChangeContent(e => this.onModelContentChanged(textEditorModel, e)));
		this._register(textEditorModel.onDidChangeLanguage(() => this.onConfigurationChange(true))); // mode change can have impact on config

		// Only adjust name and dirty state etc. if we
		// actually created the untitled model
		if (createdUntitledModel) {

			// Name
			if (backup || this.initialValue) {
				this.updateNameFromFirstLine();
			}

			// Untitled associated to file path are dirty right away as well as untitled with content
			this.setDirty(this.hasAssociatedFilePath || !!backup || !!this.initialValue);

			// If we have initial contents, make sure to emit this
			// as the appropiate events to the outside.
			if (backup || this.initialValue) {
				this._onDidChangeContent.fire();
			}
		}

		return this as UntitledTextEditorModel & IResolvedTextEditorModel;
	}

	private onModelContentChanged(model: ITextModel, e: IModelContentChangedEvent): void {
		this.versionId++;

		if (!this.ignoreDirtyOnModelContentChange) {
			// mark the untitled text editor as non-dirty once its content becomes empty and we do
			// not have an associated path set. we never want dirty indicator in that case.
			if (!this.hasAssociatedFilePath && model.getLineCount() === 1 && model.getLineContent(1) === '') {
				this.setDirty(false);
			}

			// turn dirty otherwise
			else {
				this.setDirty(true);
			}
		}

		// Check for name change if first line changed in the range of 0-FIRST_LINE_NAME_MAX_LENGTH columns
		if (e.changes.some(change => (change.range.startLineNumber === 1 || change.range.endLineNumber === 1) && change.range.startColumn <= UntitledTextEditorModel.FIRST_LINE_NAME_MAX_LENGTH)) {
			this.updateNameFromFirstLine();
		}

		// Emit as general content change event
		this._onDidChangeContent.fire();
	}

	private updateNameFromFirstLine(): void {
		if (this.hasAssociatedFilePath) {
			return; // not in case of an associated file path
		}

		// Determine the first words of the model following these rules:
		// - cannot be only whitespace (so we trim())
		// - cannot be only non-alphanumeric characters (so we run word definition regex over it)
		// - cannot be longer than FIRST_LINE_MAX_TITLE_LENGTH

		let modelFirstWordsCandidate: string | undefined = undefined;

		const firstLineText = this.textEditorModel?.getValueInRange({ startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: UntitledTextEditorModel.FIRST_LINE_NAME_MAX_LENGTH + 1 }).trim();
		if (firstLineText && ensureValidWordDefinition().exec(firstLineText)) {
			modelFirstWordsCandidate = firstLineText;
		}

		if (modelFirstWordsCandidate !== this.cachedModelFirstLineWords) {
			this.cachedModelFirstLineWords = modelFirstWordsCandidate;
			this._onDidChangeName.fire();
		}
	}
}
