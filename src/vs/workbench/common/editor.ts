/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { withNullAsUndefined, assertIsDefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { IDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IEditor, IEditorViewState, ScrollType, IDiffEditor } from 'vs/editor/common/editorCommon';
import { IEditorModel, IEditorOptions, ITextEditorOptions, IBaseResourceEditorInput, IResourceEditorInput, EditorActivation, EditorOpenContext, ITextEditorSelection, TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { IInstantiationService, IConstructorSignature0, ServicesAccessor, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITextModel } from 'vs/editor/common/model';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ICompositeControl, IComposite } from 'vs/workbench/common/composite';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { IPathData } from 'vs/platform/windows/common/windows';
import { coalesce, firstOrDefault } from 'vs/base/common/arrays';
import { ACTIVE_GROUP, IResourceEditorInputType, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IRange } from 'vs/editor/common/core/range';
import { IExtUri } from 'vs/base/common/resources';

// Editor State Context Keys
export const ActiveEditorDirtyContext = new RawContextKey<boolean>('activeEditorIsDirty', false);
export const ActiveEditorPinnedContext = new RawContextKey<boolean>('activeEditorIsNotPreview', false);
export const ActiveEditorStickyContext = new RawContextKey<boolean>('activeEditorIsPinned', false);
export const ActiveEditorReadonlyContext = new RawContextKey<boolean>('activeEditorIsReadonly', false);

// Editor Kind Context Keys
export const ActiveEditorContext = new RawContextKey<string | null>('activeEditor', null);
export const ActiveEditorAvailableEditorIdsContext = new RawContextKey<string>('activeEditorAvailableEditorIds', '');
export const TextCompareEditorVisibleContext = new RawContextKey<boolean>('textCompareEditorVisible', false);
export const TextCompareEditorActiveContext = new RawContextKey<boolean>('textCompareEditorActive', false);

// Editor Group Context Keys
export const EditorGroupEditorsCountContext = new RawContextKey<number>('groupEditorsCount', 0);
export const ActiveEditorGroupEmptyContext = new RawContextKey<boolean>('activeEditorGroupEmpty', false);
export const ActiveEditorGroupIndexContext = new RawContextKey<number>('activeEditorGroupIndex', 0);
export const ActiveEditorGroupLastContext = new RawContextKey<boolean>('activeEditorGroupLast', false);
export const MultipleEditorGroupsContext = new RawContextKey<boolean>('multipleEditorGroups', false);
export const SingleEditorGroupsContext = MultipleEditorGroupsContext.toNegated();

// Editor Layout Context Keys
export const EditorsVisibleContext = new RawContextKey<boolean>('editorIsOpen', false);
export const InEditorZenModeContext = new RawContextKey<boolean>('inZenMode', false);
export const IsCenteredLayoutContext = new RawContextKey<boolean>('isCenteredLayout', false);
export const SplitEditorsVertically = new RawContextKey<boolean>('splitEditorsVertically', false);
export const EditorAreaVisibleContext = new RawContextKey<boolean>('editorAreaVisible', true);

/**
 * Text diff editor id.
 */
export const TEXT_DIFF_EDITOR_ID = 'workbench.editors.textDiffEditor';

/**
 * Binary diff editor id.
 */
export const BINARY_DIFF_EDITOR_ID = 'workbench.editors.binaryResourceDiffEditor';

/**
 * The editor pane is the container for workbench editors.
 */
export interface IEditorPane extends IComposite {

	/**
	 * The assigned input of this editor.
	 */
	readonly input: IEditorInput | undefined;

	/**
	 * The assigned options of the editor.
	 */
	readonly options: EditorOptions | undefined;

	/**
	 * The assigned group this editor is showing in.
	 */
	readonly group: IEditorGroup | undefined;

	/**
	 * The minimum width of this editor.
	 */
	readonly minimumWidth: number;

	/**
	 * The maximum width of this editor.
	 */
	readonly maximumWidth: number;

	/**
	 * The minimum height of this editor.
	 */
	readonly minimumHeight: number;

	/**
	 * The maximum height of this editor.
	 */
	readonly maximumHeight: number;

	/**
	 * An event to notify whenever minimum/maximum width/height changes.
	 */
	readonly onDidSizeConstraintsChange: Event<{ width: number; height: number; } | undefined>;

	/**
	 * The context key service for this editor. Should be overridden by
	 * editors that have their own ScopedContextKeyService
	 */
	readonly scopedContextKeyService: IContextKeyService | undefined;

	/**
	 * Returns the underlying control of this editor. Callers need to cast
	 * the control to a specific instance as needed, e.g. by using the
	 * `isCodeEditor` helper method to access the text code editor.
	 */
	getControl(): IEditorControl | undefined;

	/**
	 * Finds out if this editor is visible or not.
	 */
	isVisible(): boolean;
}

/**
 * Overrides `IEditorPane` where `input` and `group` are known to be set.
 */
export interface IVisibleEditorPane extends IEditorPane {
	readonly input: IEditorInput;
	readonly group: IEditorGroup;
}

/**
 * The text editor pane is the container for workbench text editors.
 */
export interface ITextEditorPane extends IEditorPane {

	/**
	 * Returns the underlying text editor widget of this editor.
	 */
	getControl(): IEditor | undefined;

	/**
	 * Returns the current view state of the text editor if any.
	 */
	getViewState(): IEditorViewState | undefined;
}

export function isTextEditorPane(thing: IEditorPane | undefined): thing is ITextEditorPane {
	const candidate = thing as ITextEditorPane | undefined;

	return typeof candidate?.getViewState === 'function';
}

/**
 * The text editor pane is the container for workbench text diff editors.
 */
export interface ITextDiffEditorPane extends IEditorPane {

	/**
	 * Returns the underlying text editor widget of this editor.
	 */
	getControl(): IDiffEditor | undefined;
}

/**
 * Marker interface for the control inside an editor pane. Callers
 * have to cast the control to work with it, e.g. via methods
 * such as `isCodeEditor(control)`.
 */
export interface IEditorControl extends ICompositeControl { }

export interface IFileEditorInputFactory {

	/**
	 * Creates new new editor input capable of showing files.
	 */
	createFileEditorInput(resource: URI, preferredResource: URI | undefined, preferredName: string | undefined, preferredDescription: string | undefined, preferredEncoding: string | undefined, preferredMode: string | undefined, instantiationService: IInstantiationService): IFileEditorInput;

	/**
	 * Check if the provided object is a file editor input.
	 */
	isFileEditorInput(obj: unknown): obj is IFileEditorInput;
}

interface ICustomEditorInputFactory {
	createCustomEditorInput(resource: URI, instantiationService: IInstantiationService): Promise<IEditorInput>;
	canResolveBackup(editorInput: IEditorInput, backupResource: URI): boolean;
}

export interface IEditorInputFactoryRegistry {

	/**
	 * Registers the file editor input factory to use for file inputs.
	 */
	registerFileEditorInputFactory(factory: IFileEditorInputFactory): void;

	/**
	 * Returns the file editor input factory to use for file inputs.
	 */
	getFileEditorInputFactory(): IFileEditorInputFactory;

	/**
	 * Registers the custom editor input factory to use for custom inputs.
	 */
	registerCustomEditorInputFactory(scheme: string, factory: ICustomEditorInputFactory): void;

	/**
	 * Returns the custom editor input factory to use for custom inputs.
	 */
	getCustomEditorInputFactory(scheme: string): ICustomEditorInputFactory | undefined;

	/**
	 * Registers a editor input factory for the given editor input to the registry. An editor input factory
	 * is capable of serializing and deserializing editor inputs from string data.
	 *
	 * @param editorInputId the identifier of the editor input
	 * @param factory the editor input factory for serialization/deserialization
	 */
	registerEditorInputFactory<Services extends BrandedService[]>(editorInputId: string, ctor: { new(...Services: Services): IEditorInputFactory }): IDisposable;

	/**
	 * Returns the editor input factory for the given editor input.
	 *
	 * @param editorInputId the identifier of the editor input
	 */
	getEditorInputFactory(editorInputId: string): IEditorInputFactory | undefined;

	/**
	 * Starts the registry by providing the required services.
	 */
	start(accessor: ServicesAccessor): void;
}

export interface IEditorInputFactory {

	/**
	 * Determines whether the given editor input can be serialized by the factory.
	 */
	canSerialize(editorInput: IEditorInput): boolean;

	/**
	 * Returns a string representation of the provided editor input that contains enough information
	 * to deserialize back to the original editor input from the deserialize() method.
	 */
	serialize(editorInput: IEditorInput): string | undefined;

	/**
	 * Returns an editor input from the provided serialized form of the editor input. This form matches
	 * the value returned from the serialize() method.
	 */
	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined;
}

export interface IUntitledTextResourceEditorInput extends IBaseResourceEditorInput {

	/**
	 * Optional resource. If the resource is not provided a new untitled file is created (e.g. Untitled-1).
	 * If the used scheme for the resource is not `untitled://`, `forceUntitled: true` must be configured to
	 * force use the provided resource as associated path. As such, the resource will be used when saving
	 * the untitled editor.
	 */
	readonly resource?: URI;

	/**
	 * Optional language of the untitled resource.
	 */
	readonly mode?: string;

	/**
	 * Optional contents of the untitled resource.
	 */
	readonly contents?: string;

	/**
	 * Optional encoding of the untitled resource.
	 */
	readonly encoding?: string;
}

export interface IResourceDiffEditorInput extends IBaseResourceEditorInput {

	/**
	 * The left hand side URI to open inside a diff editor.
	 */
	readonly leftResource: URI;

	/**
	 * The right hand side URI to open inside a diff editor.
	 */
	readonly rightResource: URI;
}

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG
}

export const enum SaveReason {

	/**
	 * Explicit user gesture.
	 */
	EXPLICIT = 1,

	/**
	 * Auto save after a timeout.
	 */
	AUTO = 2,

	/**
	 * Auto save after editor focus change.
	 */
	FOCUS_CHANGE = 3,

	/**
	 * Auto save after window change.
	 */
	WINDOW_CHANGE = 4
}

export interface ISaveOptions {

	/**
	 * An indicator how the save operation was triggered.
	 */
	reason?: SaveReason;

	/**
	 * Forces to save the contents of the working copy
	 * again even if the working copy is not dirty.
	 */
	readonly force?: boolean;

	/**
	 * Instructs the save operation to skip any save participants.
	 */
	readonly skipSaveParticipants?: boolean;

	/**
	 * A hint as to which file systems should be available for saving.
	 */
	readonly availableFileSystems?: string[];
}

export interface IRevertOptions {

	/**
	 * Forces to load the contents of the working copy
	 * again even if the working copy is not dirty.
	 */
	readonly force?: boolean;

	/**
	 * A soft revert will clear dirty state of a working copy
	 * but will not attempt to load it from its persisted state.
	 *
	 * This option may be used in scenarios where an editor is
	 * closed and where we do not require to load the contents.
	 */
	readonly soft?: boolean;
}

export interface IMoveResult {
	editor: EditorInput | IResourceEditorInputType;
	options?: IEditorOptions;
}

export interface IEditorInput extends IDisposable {

	/**
	 * Triggered when this input is disposed.
	 */
	readonly onDispose: Event<void>;

	/**
	 * Triggered when this input changes its dirty state.
	 */
	readonly onDidChangeDirty: Event<void>;

	/**
	 * Triggered when this input changes its label
	 */
	readonly onDidChangeLabel: Event<void>;

	/**
	 * Returns the optional associated resource of this input.
	 *
	 * This resource should be unique for all editors of the same
	 * kind and input and is often used to identify the editor input among
	 * others.
	 *
	 * **Note:** DO NOT use this property for anything but identity
	 * checks. DO NOT use this property to present as label to the user.
	 * Please refer to `EditorResourceAccessor` documentation in that case.
	 */
	readonly resource: URI | undefined;

	/**
	 * Unique type identifier for this inpput.
	 */
	getTypeId(): string;

	/**
	 * Returns the display name of this input.
	 */
	getName(): string;

	/**
	 * Returns the display description of this input.
	 */
	getDescription(verbosity?: Verbosity): string | undefined;

	/**
	 * Returns the display title of this input.
	 */
	getTitle(verbosity?: Verbosity): string | undefined;

	/**
	 * Returns the aria label to be read out by a screen reader.
	 */
	getAriaLabel(): string;

	/**
	 * Returns a type of `IEditorModel` that represents the resolved input.
	 * Subclasses should override to provide a meaningful model or return
	 * `null` if the editor does not require a model.
	 */
	resolve(): Promise<IEditorModel | null>;

	/**
	 * Returns if this input is readonly or not.
	 */
	isReadonly(): boolean;

	/**
	 * Returns if the input is an untitled editor or not.
	 */
	isUntitled(): boolean;

	/**
	 * Returns if this input is dirty or not.
	 */
	isDirty(): boolean;

	/**
	 * Returns if this input is currently being saved or soon to be
	 * saved. Based on this assumption the editor may for example
	 * decide to not signal the dirty state to the user assuming that
	 * the save is scheduled to happen anyway.
	 */
	isSaving(): boolean;

	/**
	 * Saves the editor. The provided groupId helps implementors
	 * to e.g. preserve view state of the editor and re-open it
	 * in the correct group after saving.
	 *
	 * @returns the resulting editor input (typically the same) of
	 * this operation or `undefined` to indicate that the operation
	 * failed or was canceled.
	 */
	save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined>;

	/**
	 * Saves the editor to a different location. The provided `group`
	 * helps implementors to e.g. preserve view state of the editor
	 * and re-open it in the correct group after saving.
	 *
	 * @returns the resulting editor input (typically a different one)
	 * of this operation or `undefined` to indicate that the operation
	 * failed or was canceled.
	 */
	saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined>;

	/**
	 * Reverts this input from the provided group.
	 */
	revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void>;

	/**
	 * Called to determine how to handle a resource that is renamed that matches
	 * the editors resource (or is a child of).
	 *
	 * Implementors are free to not implement this method to signal no intent
	 * to participate. If an editor is returned though, it will replace the
	 * current one with that editor and optional options.
	 */
	rename(group: GroupIdentifier, target: URI): IMoveResult | undefined;

	/**
	 * Subclasses can set this to false if it does not make sense to split the editor input.
	 */
	supportsSplitEditor(): boolean;

	/**
	 * Returns if the other object matches this input.
	 */
	matches(other: unknown): boolean;

	/**
	 * Returns if this editor is disposed.
	 */
	isDisposed(): boolean;
}

/**
 * Editor inputs are lightweight objects that can be passed to the workbench API to open inside the editor part.
 * Each editor input is mapped to an editor that is capable of opening it through the Platform facade.
 */
export abstract class EditorInput extends Disposable implements IEditorInput {

	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	protected readonly _onDidChangeLabel = this._register(new Emitter<void>());
	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	private disposed: boolean = false;

	abstract get resource(): URI | undefined;

	abstract getTypeId(): string;

	getName(): string {
		return `Editor ${this.getTypeId()}`;
	}

	getDescription(verbosity?: Verbosity): string | undefined {
		return undefined;
	}

	getTitle(verbosity?: Verbosity): string {
		return this.getName();
	}

	getAriaLabel(): string {
		return this.getTitle(Verbosity.SHORT);
	}

	/**
	 * Returns the preferred editor for this input. A list of candidate editors is passed in that whee registered
	 * for the input. This allows subclasses to decide late which editor to use for the input on a case by case basis.
	 */
	getPreferredEditorId(candidates: string[]): string | undefined {
		return firstOrDefault(candidates);
	}

	/**
	* Returns a descriptor suitable for telemetry events.
	*
	* Subclasses should extend if they can contribute.
	*/
	getTelemetryDescriptor(): { [key: string]: unknown } {
		/* __GDPR__FRAGMENT__
			"EditorTelemetryDescriptor" : {
				"typeId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		return { typeId: this.getTypeId() };
	}

	isReadonly(): boolean {
		return true;
	}

	isUntitled(): boolean {
		return false;
	}

	isDirty(): boolean {
		return false;
	}

	isSaving(): boolean {
		return false;
	}

	async resolve(): Promise<IEditorModel | null> {
		return null;
	}

	async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this;
	}

	async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this;
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> { }

	rename(group: GroupIdentifier, target: URI): IMoveResult | undefined {
		return undefined;
	}

	supportsSplitEditor(): boolean {
		return true;
	}

	matches(otherInput: unknown): boolean {
		return this === otherInput;
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	dispose(): void {
		if (!this.disposed) {
			this.disposed = true;
			this._onDispose.fire();
		}

		super.dispose();
	}
}

export const enum EncodingMode {

	/**
	 * Instructs the encoding support to encode the current input with the provided encoding
	 */
	Encode,

	/**
	 * Instructs the encoding support to decode the current input with the provided encoding
	 */
	Decode
}

export interface IEncodingSupport {

	/**
	 * Gets the encoding of the type if known.
	 */
	getEncoding(): string | undefined;

	/**
	 * Sets the encoding for the type for saving.
	 */
	setEncoding(encoding: string, mode: EncodingMode): void;
}

export interface IModeSupport {

	/**
	 * Sets the language mode of the type.
	 */
	setMode(mode: string): void;
}

export interface IEditorInputWithPreferredResource {

	/**
	 * An editor may provide an additional preferred resource alongside
	 * the `resource` property. While the `resource` property serves as
	 * unique identifier of the editor that should be used whenever we
	 * compare to other editors, the `preferredResource` should be used
	 * in places where e.g. the resource is shown to the user.
	 *
	 * For example: on Windows and macOS, the same URI with different
	 * casing may point to the same file. The editor may chose to
	 * "normalize" the URIs so that only one editor opens for different
	 * URIs. But when displaying the editor label to the user, the
	 * preferred URI should be used.
	 *
	 * Not all editors have a `preferredResouce`. The `EditorResourceAccessor`
	 * utility can be used to always get the right resource without having
	 * to do instanceof checks.
	 */
	readonly preferredResource: URI;
}

export function isEditorInputWithPreferredResource(obj: unknown): obj is IEditorInputWithPreferredResource {
	const editorInputWithPreferredResource = obj as IEditorInputWithPreferredResource;

	return editorInputWithPreferredResource && !!editorInputWithPreferredResource.preferredResource;
}

/**
 * This is a tagging interface to declare an editor input being capable of dealing with files. It is only used in the editor registry
 * to register this kind of input to the platform.
 */
export interface IFileEditorInput extends IEditorInput, IEncodingSupport, IModeSupport, IEditorInputWithPreferredResource {

	/**
	 * Gets the resource this file input is about. This will always be the
	 * canonical form of the resource, so it may differ from the original
	 * resource that was provided to create the input. Use `preferredResource`
	 * for the form as it was created.
	 */
	readonly resource: URI;

	/**
	 * Sets the preferred resource to use for this file input.
	 */
	setPreferredResource(preferredResource: URI): void;

	/**
	 * Sets the preferred name to use for this file input.
	 *
	 * Note: for certain file schemes the input may decide to ignore this
	 * name and use our standard naming. Specifically for schemes we own,
	 * we do not let others override the name.
	 */
	setPreferredName(name: string): void;

	/**
	 * Sets the preferred description to use for this file input.
	 *
	 * Note: for certain file schemes the input may decide to ignore this
	 * description and use our standard naming. Specifically for schemes we own,
	 * we do not let others override the description.
	 */
	setPreferredDescription(description: string): void;

	/**
	 * Sets the preferred encoding to use for this file input.
	 */
	setPreferredEncoding(encoding: string): void;

	/**
	 * Sets the preferred language mode to use for this file input.
	 */
	setPreferredMode(mode: string): void;

	/**
	 * Forces this file input to open as binary instead of text.
	 */
	setForceOpenAsBinary(): void;

	/**
	 * Figure out if the file input has been resolved or not.
	 */
	isResolved(): boolean;
}

/**
 * Side by side editor inputs that have a primary and secondary side.
 */
export class SideBySideEditorInput extends EditorInput {

	static readonly ID: string = 'workbench.editorinputs.sidebysideEditorInput';

	constructor(
		protected readonly name: string | undefined,
		protected readonly description: string | undefined,
		private readonly _secondary: EditorInput,
		private readonly _primary: EditorInput
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// When the primary or secondary input gets disposed, dispose this diff editor input
		const onceSecondaryDisposed = Event.once(this.secondary.onDispose);
		this._register(onceSecondaryDisposed(() => {
			if (!this.isDisposed()) {
				this.dispose();
			}
		}));

		const oncePrimaryDisposed = Event.once(this.primary.onDispose);
		this._register(oncePrimaryDisposed(() => {
			if (!this.isDisposed()) {
				this.dispose();
			}
		}));

		// Reemit some events from the primary side to the outside
		this._register(this.primary.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		this._register(this.primary.onDidChangeLabel(() => this._onDidChangeLabel.fire()));
	}

	/**
	 * Use `EditorResourceAccessor` utility method to access the resources
	 * of both sides of the diff editor.
	 */
	get resource(): URI | undefined {
		return undefined;
	}

	get primary(): EditorInput {
		return this._primary;
	}

	get secondary(): EditorInput {
		return this._secondary;
	}

	getTypeId(): string {
		return SideBySideEditorInput.ID;
	}

	getName(): string {
		if (!this.name) {
			return localize('sideBySideLabels', "{0} - {1}", this._secondary.getName(), this._primary.getName());
		}

		return this.name;
	}

	getDescription(): string | undefined {
		return this.description;
	}

	isReadonly(): boolean {
		return this.primary.isReadonly();
	}

	isUntitled(): boolean {
		return this.primary.isUntitled();
	}

	isDirty(): boolean {
		return this.primary.isDirty();
	}

	isSaving(): boolean {
		return this.primary.isSaving();
	}

	save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this.primary.save(group, options);
	}

	saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		return this.primary.saveAs(group, options);
	}

	revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		return this.primary.revert(group, options);
	}

	getTelemetryDescriptor(): { [key: string]: unknown } {
		const descriptor = this.primary.getTelemetryDescriptor();

		return Object.assign(descriptor, super.getTelemetryDescriptor());
	}

	matches(otherInput: unknown): boolean {
		if (otherInput === this) {
			return true;
		}

		if (otherInput instanceof SideBySideEditorInput) {
			return this.primary.matches(otherInput.primary) && this.secondary.matches(otherInput.secondary);
		}

		return false;
	}
}

export interface ITextEditorModel extends IEditorModel {
	textEditorModel: ITextModel;
}

/**
 * The editor model is the heavyweight counterpart of editor input. Depending on the editor input, it
 * connects to the disk to retrieve content and may allow for saving it back or reverting it. Editor models
 * are typically cached for some while because they are expensive to construct.
 */
export class EditorModel extends Disposable implements IEditorModel {

	private readonly _onDispose = this._register(new Emitter<void>());
	readonly onDispose = this._onDispose.event;

	private disposed = false;

	/**
	 * Causes this model to load returning a promise when loading is completed.
	 */
	async load(): Promise<IEditorModel> {
		return this;
	}

	/**
	 * Returns whether this model was loaded or not.
	 */
	isResolved(): boolean {
		return true;
	}

	/**
	 * Find out if this model has been disposed.
	 */
	isDisposed(): boolean {
		return this.disposed;
	}

	/**
	 * Subclasses should implement to free resources that have been claimed through loading.
	 */
	dispose(): void {
		this.disposed = true;
		this._onDispose.fire();

		super.dispose();
	}
}

export interface IEditorInputWithOptions {
	editor: IEditorInput;
	options?: IEditorOptions | ITextEditorOptions;
}

export function isEditorInputWithOptions(obj: unknown): obj is IEditorInputWithOptions {
	const editorInputWithOptions = obj as IEditorInputWithOptions;

	return !!editorInputWithOptions && !!editorInputWithOptions.editor;
}

/**
 * The editor options is the base class of options that can be passed in when opening an editor.
 */
export class EditorOptions implements IEditorOptions {

	/**
	 * Helper to create EditorOptions inline.
	 */
	static create(settings: IEditorOptions): EditorOptions {
		const options = new EditorOptions();
		options.overwrite(settings);

		return options;
	}

	/**
	 * Tells the editor to not receive keyboard focus when the editor is being opened.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	preserveFocus: boolean | undefined;

	/**
	 * This option is only relevant if an editor is opened into a group that is not active
	 * already and allows to control if the inactive group should become active, restored
	 * or preserved.
	 *
	 * By default, the editor group will become active unless `preserveFocus` or `inactive`
	 * is specified.
	 */
	activation: EditorActivation | undefined;

	/**
	 * Tells the editor to reload the editor input in the editor even if it is identical to the one
	 * already showing. By default, the editor will not reload the input if it is identical to the
	 * one showing.
	 */
	forceReload: boolean | undefined;

	/**
	 * Will reveal the editor if it is already opened and visible in any of the opened editor groups.
	 */
	revealIfVisible: boolean | undefined;

	/**
	 * Will reveal the editor if it is already opened (even when not visible) in any of the opened editor groups.
	 */
	revealIfOpened: boolean | undefined;

	/**
	 * An editor that is pinned remains in the editor stack even when another editor is being opened.
	 * An editor that is not pinned will always get replaced by another editor that is not pinned.
	 */
	pinned: boolean | undefined;

	/**
	 * An editor that is sticky moves to the beginning of the editors list within the group and will remain
	 * there unless explicitly closed. Operations such as "Close All" will not close sticky editors.
	 */
	sticky: boolean | undefined;

	/**
	 * The index in the document stack where to insert the editor into when opening.
	 */
	index: number | undefined;

	/**
	 * An active editor that is opened will show its contents directly. Set to true to open an editor
	 * in the background without loading its contents.
	 *
	 * Will also not activate the group the editor opens in unless the group is already
	 * the active one. This behaviour can be overridden via the `activation` option.
	 */
	inactive: boolean | undefined;

	/**
	 * Will not show an error in case opening the editor fails and thus allows to show a custom error
	 * message as needed. By default, an error will be presented as notification if opening was not possible.
	 */
	ignoreError: boolean | undefined;

	/**
	 * Allows to override the editor that should be used to display the input:
	 * - `undefined`: let the editor decide for itself
	 * - `false`: disable overrides
	 * - `string`: specific override by id
	 */
	override?: false | string;

	/**
	 * A optional hint to signal in which context the editor opens.
	 *
	 * If configured to be `EditorOpenContext.USER`, this hint can be
	 * used in various places to control the experience. For example,
	 * if the editor to open fails with an error, a notification could
	 * inform about this in a modal dialog. If the editor opened through
	 * some background task, the notification would show in the background,
	 * not as a modal dialog.
	 */
	context: EditorOpenContext | undefined;

	/**
	 * Overwrites option values from the provided bag.
	 */
	overwrite(options: IEditorOptions): EditorOptions {
		if (typeof options.forceReload === 'boolean') {
			this.forceReload = options.forceReload;
		}

		if (typeof options.revealIfVisible === 'boolean') {
			this.revealIfVisible = options.revealIfVisible;
		}

		if (typeof options.revealIfOpened === 'boolean') {
			this.revealIfOpened = options.revealIfOpened;
		}

		if (typeof options.preserveFocus === 'boolean') {
			this.preserveFocus = options.preserveFocus;
		}

		if (typeof options.activation === 'number') {
			this.activation = options.activation;
		}

		if (typeof options.pinned === 'boolean') {
			this.pinned = options.pinned;
		}

		if (typeof options.sticky === 'boolean') {
			this.sticky = options.sticky;
		}

		if (typeof options.inactive === 'boolean') {
			this.inactive = options.inactive;
		}

		if (typeof options.ignoreError === 'boolean') {
			this.ignoreError = options.ignoreError;
		}

		if (typeof options.index === 'number') {
			this.index = options.index;
		}

		if (typeof options.override === 'string' || options.override === false) {
			this.override = options.override;
		}

		if (typeof options.context === 'number') {
			this.context = options.context;
		}

		return this;
	}
}

/**
 * Base Text Editor Options.
 */
export class TextEditorOptions extends EditorOptions implements ITextEditorOptions {

	/**
	 * Text editor selection.
	 */
	selection: ITextEditorSelection | undefined;

	/**
	 * Text editor view state.
	 */
	editorViewState: IEditorViewState | undefined;

	/**
	 * Option to control the text editor selection reveal type.
	 */
	selectionRevealType: TextEditorSelectionRevealType | undefined;

	static from(input?: IBaseResourceEditorInput): TextEditorOptions | undefined {
		if (!input?.options) {
			return undefined;
		}

		return TextEditorOptions.create(input.options);
	}

	/**
	 * Helper to convert options bag to real class
	 */
	static create(options: ITextEditorOptions = Object.create(null)): TextEditorOptions {
		const textEditorOptions = new TextEditorOptions();
		textEditorOptions.overwrite(options);

		return textEditorOptions;
	}

	/**
	 * Overwrites option values from the provided bag.
	 */
	overwrite(options: ITextEditorOptions): TextEditorOptions {
		super.overwrite(options);

		if (options.selection) {
			this.selection = {
				startLineNumber: options.selection.startLineNumber,
				startColumn: options.selection.startColumn,
				endLineNumber: options.selection.endLineNumber ?? options.selection.startLineNumber,
				endColumn: options.selection.endColumn ?? options.selection.startColumn
			};
		}

		if (options.viewState) {
			this.editorViewState = options.viewState as IEditorViewState;
		}

		if (typeof options.selectionRevealType !== 'undefined') {
			this.selectionRevealType = options.selectionRevealType;
		}

		return this;
	}

	/**
	 * Returns if this options object has objects defined for the editor.
	 */
	hasOptionsDefined(): boolean {
		return !!this.editorViewState || !!this.selectionRevealType || !!this.selection;
	}

	/**
	 * Create a TextEditorOptions inline to be used when the editor is opening.
	 */
	static fromEditor(editor: IEditor, settings?: IEditorOptions): TextEditorOptions {
		const options = TextEditorOptions.create(settings);

		// View state
		options.editorViewState = withNullAsUndefined(editor.saveViewState());

		return options;
	}

	/**
	 * Apply the view state or selection to the given editor.
	 *
	 * @return if something was applied
	 */
	apply(editor: IEditor, scrollType: ScrollType): boolean {
		let gotApplied = false;

		// First try viewstate
		if (this.editorViewState) {
			editor.restoreViewState(this.editorViewState);
			gotApplied = true;
		}

		// Otherwise check for selection
		else if (this.selection) {
			const range: IRange = {
				startLineNumber: this.selection.startLineNumber,
				startColumn: this.selection.startColumn,
				endLineNumber: this.selection.endLineNumber ?? this.selection.startLineNumber,
				endColumn: this.selection.endColumn ?? this.selection.startColumn
			};

			editor.setSelection(range);

			if (this.selectionRevealType === TextEditorSelectionRevealType.NearTop) {
				editor.revealRangeNearTop(range, scrollType);
			} else if (this.selectionRevealType === TextEditorSelectionRevealType.NearTopIfOutsideViewport) {
				editor.revealRangeNearTopIfOutsideViewport(range, scrollType);
			} else if (this.selectionRevealType === TextEditorSelectionRevealType.CenterIfOutsideViewport) {
				editor.revealRangeInCenterIfOutsideViewport(range, scrollType);
			} else {
				editor.revealRangeInCenter(range, scrollType);
			}

			gotApplied = true;
		}

		return gotApplied;
	}
}

/**
 * Context passed into `EditorPane#setInput` to give additional
 * context information around why the editor was opened.
 */
export interface IEditorOpenContext {

	/**
	 * An indicator if the editor input is new for the group the editor is in.
	 * An editor is new for a group if it was not part of the group before and
	 * otherwise was already opened in the group and just became the active editor.
	 *
	 * This hint can e.g. be used to decide wether to restore view state or not.
	 */
	newInGroup?: boolean;
}

export interface IEditorIdentifier {
	groupId: GroupIdentifier;
	editor: IEditorInput;
}

/**
 * The editor commands context is used for editor commands (e.g. in the editor title)
 * and we must ensure that the context is serializable because it potentially travels
 * to the extension host!
 */
export interface IEditorCommandsContext {
	groupId: GroupIdentifier;
	editorIndex?: number;
}

export class EditorCommandsContextActionRunner extends ActionRunner {

	constructor(
		private context: IEditorCommandsContext
	) {
		super();
	}

	run(action: IAction): Promise<void> {
		return super.run(action, this.context);
	}
}

export interface IEditorCloseEvent extends IEditorIdentifier {
	replaced: boolean;
	index: number;
	sticky: boolean;
}

export type GroupIdentifier = number;

export interface IWorkbenchEditorConfiguration {
	workbench: {
		editor: IEditorPartConfiguration,
		iconTheme: string;
	};
}

interface IEditorPartConfiguration {
	showTabs?: boolean;
	scrollToSwitchTabs?: boolean;
	highlightModifiedTabs?: boolean;
	tabCloseButton?: 'left' | 'right' | 'off';
	tabSizing?: 'fit' | 'shrink';
	pinnedTabSizing?: 'normal' | 'compact' | 'shrink';
	titleScrollbarSizing?: 'default' | 'large';
	focusRecentEditorAfterClose?: boolean;
	showIcons?: boolean;
	enablePreview?: boolean;
	enablePreviewFromQuickOpen?: boolean;
	closeOnFileDelete?: boolean;
	openPositioning?: 'left' | 'right' | 'first' | 'last';
	openSideBySideDirection?: 'right' | 'down';
	closeEmptyGroups?: boolean;
	revealIfOpen?: boolean;
	mouseBackForwardToNavigate?: boolean;
	labelFormat?: 'default' | 'short' | 'medium' | 'long';
	restoreViewState?: boolean;
	splitSizing?: 'split' | 'distribute';
	splitOnDragAndDrop?: boolean;
	limit?: {
		enabled?: boolean;
		value?: number;
		perEditorGroup?: boolean;
	};
}

export interface IEditorPartOptions extends IEditorPartConfiguration {
	hasIcons?: boolean;
}

export interface IEditorPartOptionsChangeEvent {
	oldPartOptions: IEditorPartOptions;
	newPartOptions: IEditorPartOptions;
}

export enum SideBySideEditor {
	PRIMARY = 1,
	SECONDARY = 2,
	BOTH = 3
}

export interface IEditorResourceAccessorOptions {

	/**
	 * Allows to access the `resource(s)` of side by side editors. If not
	 * specified, a `resource` for a side by side editor will always be
	 * `undefined`.
	 */
	supportSideBySide?: SideBySideEditor;

	/**
	 * Allows to filter the scheme to consider. A resource scheme that does
	 * not match a filter will not be considered.
	 */
	filterByScheme?: string | string[];
}

class EditorResourceAccessorImpl {

	/**
	 * The original URI of an editor is the URI that was used originally to open
	 * the editor and should be used whenever the URI is presented to the user,
	 * e.g. as a label.
	 *
	 * In contrast, the canonical URI (#getCanonicalUri) may be different and should
	 * be used whenever the URI is used to e.g. compare with other editors or when
	 * caching certain data based on the URI.
	 *
	 * For example: on Windows and macOS, the same file URI with different casing may
	 * point to the same file. The editor may chose to "normalize" the URI into a canonical
	 * form so that only one editor opens for same file URIs with different casing. As
	 * such, the original URI and the canonical URI can be different.
	 */
	getOriginalUri(editor: IEditorInput | undefined | null): URI | undefined;
	getOriginalUri(editor: IEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide?: SideBySideEditor.PRIMARY | SideBySideEditor.SECONDARY }): URI | undefined;
	getOriginalUri(editor: IEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide: SideBySideEditor.BOTH }): URI | { primary?: URI, secondary?: URI } | undefined;
	getOriginalUri(editor: IEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI, secondary?: URI } | undefined {
		if (!editor) {
			return undefined;
		}

		// Optionally support side-by-side editors
		if (options?.supportSideBySide && editor instanceof SideBySideEditorInput) {
			if (options?.supportSideBySide === SideBySideEditor.BOTH) {
				return {
					primary: this.getOriginalUri(editor.primary, { filterByScheme: options.filterByScheme }),
					secondary: this.getOriginalUri(editor.secondary, { filterByScheme: options.filterByScheme })
				};
			}

			editor = options.supportSideBySide === SideBySideEditor.PRIMARY ? editor.primary : editor.secondary;
		}

		// Original URI is the `preferredResource` of an editor if any
		const originalResource = isEditorInputWithPreferredResource(editor) ? editor.preferredResource : editor.resource;
		if (!originalResource || !options || !options.filterByScheme) {
			return originalResource;
		}

		return this.filterUri(originalResource, options.filterByScheme);
	}

	/**
	 * The canonical URI of an editor is the true unique identifier of the editor
	 * and should be used whenever the URI is used e.g. to compare with other
	 * editors or when caching certain data based on the URI.
	 *
	 * In contrast, the original URI (#getOriginalUri) may be different and should
	 * be used whenever the URI is presented to the user, e.g. as a label.
	 *
	 * For example: on Windows and macOS, the same file URI with different casing may
	 * point to the same file. The editor may chose to "normalize" the URI into a canonical
	 * form so that only one editor opens for same file URIs with different casing. As
	 * such, the original URI and the canonical URI can be different.
	 */
	getCanonicalUri(editor: IEditorInput | undefined | null): URI | undefined;
	getCanonicalUri(editor: IEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide?: SideBySideEditor.PRIMARY | SideBySideEditor.SECONDARY }): URI | undefined;
	getCanonicalUri(editor: IEditorInput | undefined | null, options: IEditorResourceAccessorOptions & { supportSideBySide: SideBySideEditor.BOTH }): URI | { primary?: URI, secondary?: URI } | undefined;
	getCanonicalUri(editor: IEditorInput | undefined | null, options?: IEditorResourceAccessorOptions): URI | { primary?: URI, secondary?: URI } | undefined {
		if (!editor) {
			return undefined;
		}

		// Optionally support side-by-side editors
		if (options?.supportSideBySide && editor instanceof SideBySideEditorInput) {
			if (options?.supportSideBySide === SideBySideEditor.BOTH) {
				return {
					primary: this.getCanonicalUri(editor.primary, { filterByScheme: options.filterByScheme }),
					secondary: this.getCanonicalUri(editor.secondary, { filterByScheme: options.filterByScheme })
				};
			}

			editor = options.supportSideBySide === SideBySideEditor.PRIMARY ? editor.primary : editor.secondary;
		}

		// Canonical URI is the `resource` of an editor
		const canonicalResource = editor.resource;
		if (!canonicalResource || !options || !options.filterByScheme) {
			return canonicalResource;
		}

		return this.filterUri(canonicalResource, options.filterByScheme);
	}

	private filterUri(resource: URI, filter: string | string[]): URI | undefined {

		// Multiple scheme filter
		if (Array.isArray(filter)) {
			if (filter.some(scheme => resource.scheme === scheme)) {
				return resource;
			}
		}

		// Single scheme filter
		else {
			if (filter === resource.scheme) {
				return resource;
			}
		}

		return undefined;
	}
}

export const EditorResourceAccessor = new EditorResourceAccessorImpl();

export const enum CloseDirection {
	LEFT,
	RIGHT
}

export interface IEditorMemento<T> {

	saveEditorState(group: IEditorGroup, resource: URI, state: T): void;
	saveEditorState(group: IEditorGroup, editor: IEditorInput, state: T): void;

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: IEditorInput): T | undefined;

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: IEditorInput, group?: IEditorGroup): void;

	clearEditorStateOnDispose(resource: URI, editor: IEditorInput): void;

	moveEditorState(source: URI, target: URI, comparer: IExtUri): void;
}

class EditorInputFactoryRegistry implements IEditorInputFactoryRegistry {
	private instantiationService: IInstantiationService | undefined;
	private fileEditorInputFactory: IFileEditorInputFactory | undefined;
	private customEditorInputFactoryInstances: Map<string, ICustomEditorInputFactory> = new Map();

	private readonly editorInputFactoryConstructors: Map<string, IConstructorSignature0<IEditorInputFactory>> = new Map();
	private readonly editorInputFactoryInstances: Map<string, IEditorInputFactory> = new Map();

	start(accessor: ServicesAccessor): void {
		const instantiationService = this.instantiationService = accessor.get(IInstantiationService);

		this.editorInputFactoryConstructors.forEach((ctor, key) => {
			this.createEditorInputFactory(key, ctor, instantiationService);
		});

		this.editorInputFactoryConstructors.clear();
	}

	private createEditorInputFactory(editorInputId: string, ctor: IConstructorSignature0<IEditorInputFactory>, instantiationService: IInstantiationService): void {
		const instance = instantiationService.createInstance(ctor);
		this.editorInputFactoryInstances.set(editorInputId, instance);
	}

	registerFileEditorInputFactory(factory: IFileEditorInputFactory): void {
		this.fileEditorInputFactory = factory;
	}

	getFileEditorInputFactory(): IFileEditorInputFactory {
		return assertIsDefined(this.fileEditorInputFactory);
	}

	registerCustomEditorInputFactory(scheme: string, factory: ICustomEditorInputFactory): void {
		this.customEditorInputFactoryInstances.set(scheme, factory);
	}

	getCustomEditorInputFactory(scheme: string): ICustomEditorInputFactory | undefined {
		return this.customEditorInputFactoryInstances.get(scheme);
	}

	registerEditorInputFactory(editorInputId: string, ctor: IConstructorSignature0<IEditorInputFactory>): IDisposable {
		if (!this.instantiationService) {
			this.editorInputFactoryConstructors.set(editorInputId, ctor);
		} else {
			this.createEditorInputFactory(editorInputId, ctor, this.instantiationService);

		}

		return toDisposable(() => {
			this.editorInputFactoryConstructors.delete(editorInputId);
			this.editorInputFactoryInstances.delete(editorInputId);
		});
	}

	getEditorInputFactory(editorInputId: string): IEditorInputFactory | undefined {
		return this.editorInputFactoryInstances.get(editorInputId);
	}
}

export const Extensions = {
	EditorInputFactories: 'workbench.contributions.editor.inputFactories'
};

Registry.add(Extensions.EditorInputFactories, new EditorInputFactoryRegistry());

export async function pathsToEditors(paths: IPathData[] | undefined, fileService: IFileService): Promise<(IResourceEditorInput | IUntitledTextResourceEditorInput)[]> {
	if (!paths || !paths.length) {
		return [];
	}

	const editors = await Promise.all(paths.map(async path => {
		const resource = URI.revive(path.fileUri);
		if (!resource || !fileService.canHandleResource(resource)) {
			return;
		}

		const exists = (typeof path.exists === 'boolean') ? path.exists : await fileService.exists(resource);
		if (!exists && path.openOnlyIfExists) {
			return;
		}

		const options: ITextEditorOptions = (exists && typeof path.lineNumber === 'number') ? {
			selection: {
				startLineNumber: path.lineNumber,
				startColumn: path.columnNumber || 1
			},
			pinned: true,
			override: path.overrideId
		} : {
				pinned: true,
				override: path.overrideId
			};

		let input: IResourceEditorInput | IUntitledTextResourceEditorInput;
		if (!exists) {
			input = { resource, options, forceUntitled: true };
		} else {
			input = { resource, options, forceFile: true };
		}

		return input;
	}));

	return coalesce(editors);
}

export const enum EditorsOrder {

	/**
	 * Editors sorted by most recent activity (most recent active first)
	 */
	MOST_RECENTLY_ACTIVE,

	/**
	 * Editors sorted by sequential order
	 */
	SEQUENTIAL
}

export function computeEditorAriaLabel(input: IEditorInput, index: number | undefined, group: IEditorGroup | undefined, groupCount: number): string {
	let ariaLabel = input.getAriaLabel();
	if (group && !group.isPinned(input)) {
		ariaLabel = localize('preview', "{0}, preview", ariaLabel);
	}

	if (group && group.isSticky(index ?? input)) {
		ariaLabel = localize('pinned', "{0}, pinned", ariaLabel);
	}

	// Apply group information to help identify in
	// which group we are (only if more than one group
	// is actually opened)
	if (group && groupCount > 1) {
		ariaLabel = `${ariaLabel}, ${group.ariaLabel}`;
	}

	return ariaLabel;
}


//#region Editor Group Column

/**
 * A way to address editor groups through a column based system
 * where `0` is the first column. Will fallback to `SIDE_GROUP`
 * in case the column does not exist yet.
 */
export type EditorGroupColumn = number;

export function viewColumnToEditorGroup(editorGroupService: IEditorGroupsService, viewColumn?: EditorGroupColumn): GroupIdentifier {
	if (typeof viewColumn !== 'number' || viewColumn === ACTIVE_GROUP) {
		return ACTIVE_GROUP; // prefer active group when position is undefined or passed in as such
	}

	const groups = editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE);

	let candidateGroup = groups[viewColumn];
	if (candidateGroup) {
		return candidateGroup.id; // found direct match
	}

	let firstGroup = groups[0];
	if (groups.length === 1 && firstGroup.count === 0) {
		return firstGroup.id; // first editor should always open in first group independent from position provided
	}

	return SIDE_GROUP; // open to the side if group not found or we are instructed to
}

export function editorGroupToViewColumn(editorGroupService: IEditorGroupsService, editorGroup: IEditorGroup | GroupIdentifier): EditorGroupColumn {
	const group = (typeof editorGroup === 'number') ? editorGroupService.getGroup(editorGroup) : editorGroup;
	if (!group) {
		throw new Error('Invalid group provided');
	}

	return editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).indexOf(group);
}

//#endregion
