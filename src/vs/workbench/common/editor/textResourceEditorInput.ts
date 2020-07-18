/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput, Verbosity, GroupIdentifier, IEditorInput, ISaveOptions, IRevertOptions } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { ITextFileService, ITextFileSaveOptions } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { createMemoizer } from 'vs/base/common/decorators';
import { Schemas } from 'vs/base/common/network';
import { dirname, extUri } from 'vs/base/common/resources';

/**
 * The base class for all editor inputs that open in text editors.
 */
export abstract class AbstractTextResourceEditorInput extends EditorInput {

	private static readonly MEMOIZER = createMemoizer();

	private _preferredResource: URI;
	get preferredResource(): URI { return this._preferredResource; }

	constructor(
		public readonly resource: URI,
		preferredResource: URI | undefined,
		@IEditorService protected readonly editorService: IEditorService,
		@IEditorGroupsService protected readonly editorGroupService: IEditorGroupsService,
		@ITextFileService protected readonly textFileService: ITextFileService,
		@ILabelService protected readonly labelService: ILabelService,
		@IFileService protected readonly fileService: IFileService,
		@IFilesConfigurationService protected readonly filesConfigurationService: IFilesConfigurationService
	) {
		super();

		this._preferredResource = preferredResource || resource;

		this.registerListeners();
	}

	protected registerListeners(): void {

		// Clear label memoizer on certain events that have impact
		this._register(this.labelService.onDidChangeFormatters(e => this.onLabelEvent(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onLabelEvent(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onLabelEvent(e.scheme)));
	}

	private onLabelEvent(scheme: string): void {
		if (scheme === this._preferredResource.scheme) {
			this.updateLabel();
		}
	}

	private updateLabel(): void {

		// Clear any cached labels from before
		AbstractTextResourceEditorInput.MEMOIZER.clear();

		// Trigger recompute of label
		this._onDidChangeLabel.fire();
	}

	setPreferredResource(preferredResource: URI): void {
		if (!extUri.isEqual(preferredResource, this._preferredResource)) {
			this._preferredResource = preferredResource;

			this.updateLabel();
		}
	}

	getName(): string {
		return this.basename;
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get basename(): string {
		return this.labelService.getUriBasenameLabel(this._preferredResource);
	}

	getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortDescription;
			case Verbosity.LONG:
				return this.longDescription;
			case Verbosity.MEDIUM:
			default:
				return this.mediumDescription;
		}
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get shortDescription(): string {
		return this.labelService.getUriBasenameLabel(dirname(this._preferredResource));
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get mediumDescription(): string {
		return this.labelService.getUriLabel(dirname(this._preferredResource), { relative: true });
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get longDescription(): string {
		return this.labelService.getUriLabel(dirname(this._preferredResource));
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get shortTitle(): string {
		return this.getName();
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get mediumTitle(): string {
		return this.labelService.getUriLabel(this._preferredResource, { relative: true });
	}

	@AbstractTextResourceEditorInput.MEMOIZER
	private get longTitle(): string {
		return this.labelService.getUriLabel(this._preferredResource);
	}

	getTitle(verbosity: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.shortTitle;
			case Verbosity.LONG:
				return this.longTitle;
			default:
			case Verbosity.MEDIUM:
				return this.mediumTitle;
		}
	}

	isUntitled(): boolean {
		return this.resource.scheme === Schemas.untitled;
	}

	isReadonly(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never readonly
		}

		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	isSaving(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never saving automatically
		}

		if (this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
			return true; // a short auto save is configured, treat this as being saved
		}

		return false;
	}

	save(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		return this.doSave(group, options, false);
	}

	saveAs(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		return this.doSave(group, options, true);
	}

	private async doSave(group: GroupIdentifier, options: ISaveOptions | undefined, saveAs: boolean): Promise<IEditorInput | undefined> {

		// Save / Save As
		let target: URI | undefined;
		if (saveAs) {
			target = await this.textFileService.saveAs(this.resource, undefined, options);
		} else {
			target = await this.textFileService.save(this.resource, options);
		}

		if (!target) {
			return undefined; // save cancelled
		}

		// If the target is a different resource, return with a new editor input
		if (!extUri.isEqual(target, this.resource)) {
			return this.editorService.createEditorInput({ resource: target });
		}

		return this;
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		await this.textFileService.revert(this.resource, options);
	}
}
