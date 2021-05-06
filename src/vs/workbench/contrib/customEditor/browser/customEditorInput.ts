/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { memoize } from 'vs/base/common/decorators';
import { IReference } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { basename } from 'vs/base/common/path';
import { isEqual } from 'vs/base/common/resources';
import { assertIsDefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { GroupIdentifier, IEditorInput, IRevertOptions, ISaveOptions, Verbosity } from 'vs/workbench/common/editor';
import { defaultCustomEditor } from 'vs/workbench/contrib/customEditor/common/contributedCustomEditors';
import { ICustomEditorModel, ICustomEditorService } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { decorateFileEditorLabel } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { IWebviewService, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { IWebviewWorkbenchService, LazilyResolvedWebviewEditorInput } from 'vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';

export class CustomEditorInput extends LazilyResolvedWebviewEditorInput {

	static create(
		instantiationService: IInstantiationService,
		resource: URI,
		viewType: string,
		group: GroupIdentifier | undefined,
		options?: { readonly customClasses?: string },
	): IEditorInput {
		return instantiationService.invokeFunction(accessor => {
			if (viewType === defaultCustomEditor.id) {
				return accessor.get(IEditorService).createEditorInput({ resource, forceFile: true });
			}
			// If it's an untitled file we must populate the untitledDocumentData
			const untitledString = accessor.get(IUntitledTextEditorService).getValue(resource);
			let untitledDocumentData = untitledString ? VSBuffer.fromString(untitledString) : undefined;
			const id = generateUuid();
			const webview = accessor.get(IWebviewService).createWebviewOverlay(id, { customClasses: options?.customClasses }, {}, undefined);
			const input = instantiationService.createInstance(CustomEditorInput, resource, viewType, id, webview, { untitledDocumentData: untitledDocumentData });
			if (typeof group !== 'undefined') {
				input.updateGroup(group);
			}
			return input;
		});
	}

	public static override readonly typeId = 'workbench.editors.webviewEditor';

	private readonly _editorResource: URI;
	private _defaultDirtyState: boolean | undefined;

	private readonly _backupId: string | undefined;

	private readonly _untitledDocumentData: VSBuffer | undefined;

	override get resource() { return this._editorResource; }

	private _modelRef?: IReference<ICustomEditorModel>;

	constructor(
		resource: URI,
		viewType: string,
		id: string,
		webview: WebviewOverlay,
		options: { startsDirty?: boolean, backupId?: string, untitledDocumentData?: VSBuffer },
		@IWebviewWorkbenchService webviewWorkbenchService: IWebviewWorkbenchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILabelService private readonly labelService: ILabelService,
		@ICustomEditorService private readonly customEditorService: ICustomEditorService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IEditorService private readonly editorService: IEditorService,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
	) {
		super(id, viewType, '', webview, webviewWorkbenchService);
		this._editorResource = resource;
		this._defaultDirtyState = options.startsDirty;
		this._backupId = options.backupId;
		this._untitledDocumentData = options.untitledDocumentData;
	}

	public override get typeId(): string {
		return CustomEditorInput.typeId;
	}

	public override canSplit() {
		return !!this.customEditorService.getCustomEditorCapabilities(this.viewType)?.supportsMultipleEditorsPerDocument;
	}

	override getName(): string {
		const name = basename(this.labelService.getUriLabel(this.resource));
		return this.decorateLabel(name);
	}

	override matches(other: IEditorInput): boolean {
		return this === other || (other instanceof CustomEditorInput
			&& this.viewType === other.viewType
			&& isEqual(this.resource, other.resource));
	}

	override copy(): IEditorInput {
		return CustomEditorInput.create(this.instantiationService, this.resource, this.viewType, this.group, this.webview.options);
	}

	@memoize
	private get shortTitle(): string {
		return this.getName();
	}

	@memoize
	private get mediumTitle(): string {
		return this.labelService.getUriLabel(this.resource, { relative: true });
	}

	@memoize
	private get longTitle(): string {
		return this.labelService.getUriLabel(this.resource);
	}

	public override getTitle(verbosity?: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.decorateLabel(this.shortTitle);
			default:
			case Verbosity.MEDIUM:
				return this.decorateLabel(this.mediumTitle);
			case Verbosity.LONG:
				return this.decorateLabel(this.longTitle);
		}
	}

	private decorateLabel(label: string): string {
		const orphaned = !!this._modelRef?.object.isOrphaned();

		const readonly = this._modelRef
			? this._modelRef.object.isEditable() && this._modelRef.object.isOnReadonlyFileSystem()
			: false;

		return decorateFileEditorLabel(label, {
			orphaned,
			readonly
		});
	}

	public override isReadonly(): boolean {
		return this._modelRef ? !this._modelRef.object.isEditable() : false;
	}

	public override isUntitled(): boolean {
		return this.resource.scheme === Schemas.untitled;
	}

	public override isDirty(): boolean {
		if (!this._modelRef) {
			return !!this._defaultDirtyState;
		}
		return this._modelRef.object.isDirty();
	}

	public override async save(groupId: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (!this._modelRef) {
			return undefined;
		}

		const target = await this._modelRef.object.saveCustomEditor(options);
		if (!target) {
			return undefined; // save cancelled
		}

		if (!isEqual(target, this.resource)) {
			return CustomEditorInput.create(this.instantiationService, target, this.viewType, groupId);
		}

		return this;
	}

	public override async saveAs(groupId: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (!this._modelRef) {
			return undefined;
		}

		const dialogPath = this._editorResource;
		const target = await this.fileDialogService.pickFileToSave(dialogPath, options?.availableFileSystems);
		if (!target) {
			return undefined; // save cancelled
		}

		if (!await this._modelRef.object.saveCustomEditorAs(this._editorResource, target, options)) {
			return undefined;
		}

		return this.rename(groupId, target)?.editor;
	}

	public override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		if (this._modelRef) {
			return this._modelRef.object.revert(options);
		}
		this._defaultDirtyState = false;
		this._onDidChangeDirty.fire();
	}

	public override async resolve(): Promise<null> {
		await super.resolve();

		if (this.isDisposed()) {
			return null;
		}

		if (!this._modelRef) {
			this._modelRef = this._register(assertIsDefined(await this.customEditorService.models.tryRetain(this.resource, this.viewType)));
			this._register(this._modelRef.object.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
			this._register(this._modelRef.object.onDidChangeOrphaned(() => this._onDidChangeLabel.fire()));
			// If we're loading untitled file data we should ensure it's dirty
			if (this._untitledDocumentData) {
				this._defaultDirtyState = true;
			}
			if (this.isDirty()) {
				this._onDidChangeDirty.fire();
			}
		}

		return null;
	}

	override rename(group: GroupIdentifier, newResource: URI): { editor: IEditorInput } | undefined {
		// See if we can keep using the same custom editor provider
		const editorInfo = this.customEditorService.getCustomEditor(this.viewType);
		if (editorInfo?.matches(newResource)) {
			return { editor: this.doMove(group, newResource) };
		}

		return { editor: this.editorService.createEditorInput({ resource: newResource, forceFile: true }) };
	}

	private doMove(group: GroupIdentifier, newResource: URI): IEditorInput {
		if (!this._moveHandler) {
			return CustomEditorInput.create(this.instantiationService, newResource, this.viewType, group);
		}

		this._moveHandler(newResource);
		const newEditor = this.instantiationService.createInstance(CustomEditorInput,
			newResource,
			this.viewType,
			this.id,
			undefined!,  // this webview is replaced in the transfer call
			{ startsDirty: this._defaultDirtyState, backupId: this._backupId });
		this.transfer(newEditor);
		newEditor.updateGroup(group);
		return newEditor;
	}

	public undo(): void | Promise<void> {
		assertIsDefined(this._modelRef);
		return this.undoRedoService.undo(this.resource);
	}

	public redo(): void | Promise<void> {
		assertIsDefined(this._modelRef);
		return this.undoRedoService.redo(this.resource);
	}

	private _moveHandler?: (newResource: URI) => void;

	public onMove(handler: (newResource: URI) => void): void {
		// TODO: Move this to the service
		this._moveHandler = handler;
	}

	protected override transfer(other: CustomEditorInput): CustomEditorInput | undefined {
		if (!super.transfer(other)) {
			return;
		}

		other._moveHandler = this._moveHandler;
		this._moveHandler = undefined;
		return other;
	}

	get backupId(): string | undefined {
		if (this._modelRef) {
			return this._modelRef.object.backupId;
		}
		return this._backupId;
	}

	get untitledDocumentData(): VSBuffer | undefined {
		return this._untitledDocumentData;
	}
}
