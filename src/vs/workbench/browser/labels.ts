/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { dirname, isEqual, basenameOrAuthority } from 'vs/base/common/resources';
import { IconLabel, IIconLabelValueOptions, IIconLabelCreationOptions } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IDecorationsService, IResourceDecorationChangeEvent } from 'vs/workbench/services/decorations/browser/decorations';
import { Schemas } from 'vs/base/common/network';
import { FileKind, FILES_ASSOCIATIONS_CONFIG } from 'vs/platform/files/common/files';
import { ITextModel } from 'vs/editor/common/model';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { Event, Emitter } from 'vs/base/common/event';
import { ILabelService } from 'vs/platform/label/common/label';
import { getIconClasses, detectModeId } from 'vs/editor/common/services/getIconClasses';
import { Disposable, dispose, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { withNullAsUndefined } from 'vs/base/common/types';
import { normalizeDriveLetter } from 'vs/base/common/labels';

export interface IResourceLabelProps {
	resource?: URI | { primary?: URI, secondary?: URI };
	name?: string | string[];
	description?: string;
}

function toResource(props: IResourceLabelProps | undefined): URI | undefined {
	if (!props || !props.resource) {
		return undefined;
	}

	if (URI.isUri(props.resource)) {
		return props.resource;
	}

	return props.resource.primary;
}

export interface IResourceLabelOptions extends IIconLabelValueOptions {

	/**
	 * A hint to the file kind of the resource.
	 */
	fileKind?: FileKind;

	/**
	 * File decorations to use for the label.
	 */
	fileDecorations?: { colors: boolean, badges: boolean };

	/**
	 * Will take the provided label as is and e.g. not override it for untitled files.
	 */
	forceLabel?: boolean;
}

export interface IFileLabelOptions extends IResourceLabelOptions {
	hideLabel?: boolean;
	hidePath?: boolean;
}

export interface IResourceLabel extends IDisposable {
	readonly element: HTMLElement;
	readonly onDidRender: Event<void>;

	/**
	 * Most generic way to apply a label with raw information.
	 */
	setLabel(label?: string, description?: string, options?: IIconLabelValueOptions): void;

	/**
	 * Convenient method to apply a label by passing a resource along.
	 *
	 * Note: for file resources consider to use the #setFile() method instead.
	 */
	setResource(label: IResourceLabelProps, options?: IResourceLabelOptions): void;

	/**
	 * Convenient method to render a file label based on a resource.
	 */
	setFile(resource: URI, options?: IFileLabelOptions): void;

	/**
	 * Resets the label to be empty.
	 */
	clear(): void;
}

export interface IResourceLabelsContainer {
	readonly onDidChangeVisibility: Event<boolean>;
}

export const DEFAULT_LABELS_CONTAINER: IResourceLabelsContainer = {
	onDidChangeVisibility: Event.None
};

export class ResourceLabels extends Disposable {

	private _onDidChangeDecorations = this._register(new Emitter<void>());
	readonly onDidChangeDecorations = this._onDidChangeDecorations.event;

	private widgets: ResourceLabelWidget[] = [];
	private labels: IResourceLabel[] = [];

	constructor(
		container: IResourceLabelsContainer,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IDecorationsService private readonly decorationsService: IDecorationsService,
		@IThemeService private readonly themeService: IThemeService,
		@ILabelService private readonly labelService: ILabelService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		super();

		this.registerListeners(container);
	}

	private registerListeners(container: IResourceLabelsContainer): void {

		// notify when visibility changes
		this._register(container.onDidChangeVisibility(visible => {
			this.widgets.forEach(widget => widget.notifyVisibilityChanged(visible));
		}));

		// notify when extensions are registered with potentially new languages
		this._register(this.modeService.onLanguagesMaybeChanged(() => this.widgets.forEach(widget => widget.notifyExtensionsRegistered())));

		// notify when model mode changes
		this._register(this.modelService.onModelModeChanged(e => {
			if (!e.model.uri) {
				return; // we need the resource to compare
			}

			this.widgets.forEach(widget => widget.notifyModelModeChanged(e.model));
		}));

		// notify when model is added
		this._register(this.modelService.onModelAdded(model => {
			if (!model.uri) {
				return; // we need the resource to compare
			}

			this.widgets.forEach(widget => widget.notifyModelAdded(model));
		}));

		// notify when file decoration changes
		this._register(this.decorationsService.onDidChangeDecorations(e => {
			let notifyDidChangeDecorations = false;
			this.widgets.forEach(widget => {
				if (widget.notifyFileDecorationsChanges(e)) {
					notifyDidChangeDecorations = true;
				}
			});

			if (notifyDidChangeDecorations) {
				this._onDidChangeDecorations.fire();
			}
		}));

		// notify when theme changes
		this._register(this.themeService.onDidColorThemeChange(() => this.widgets.forEach(widget => widget.notifyThemeChange())));

		// notify when files.associations changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FILES_ASSOCIATIONS_CONFIG)) {
				this.widgets.forEach(widget => widget.notifyFileAssociationsChange());
			}
		}));

		// notify when label formatters change
		this._register(this.labelService.onDidChangeFormatters(e => {
			this.widgets.forEach(widget => widget.notifyFormattersChange(e.scheme));
		}));

		// notify when untitled labels change
		this._register(this.textFileService.untitled.onDidChangeLabel(model => {
			this.widgets.forEach(widget => widget.notifyUntitledLabelChange(model.resource));
		}));
	}

	get(index: number): IResourceLabel {
		return this.labels[index];
	}

	create(container: HTMLElement, options?: IIconLabelCreationOptions): IResourceLabel {
		const widget = this.instantiationService.createInstance(ResourceLabelWidget, container, options);

		// Only expose a handle to the outside
		const label: IResourceLabel = {
			element: widget.element,
			onDidRender: widget.onDidRender,
			setLabel: (label: string, description?: string, options?: IIconLabelValueOptions) => widget.setLabel(label, description, options),
			setResource: (label: IResourceLabelProps, options?: IResourceLabelOptions) => widget.setResource(label, options),
			setFile: (resource: URI, options?: IFileLabelOptions) => widget.setFile(resource, options),
			clear: () => widget.clear(),
			dispose: () => this.disposeWidget(widget)
		};

		// Store
		this.labels.push(label);
		this.widgets.push(widget);

		return label;
	}

	private disposeWidget(widget: ResourceLabelWidget): void {
		const index = this.widgets.indexOf(widget);
		if (index > -1) {
			this.widgets.splice(index, 1);
			this.labels.splice(index, 1);
		}

		dispose(widget);
	}

	clear(): void {
		this.widgets = dispose(this.widgets);
		this.labels = [];
	}

	override dispose(): void {
		super.dispose();

		this.clear();
	}
}

/**
 * Note: please consider to use `ResourceLabels` if you are in need
 * of more than one label for your widget.
 */
export class ResourceLabel extends ResourceLabels {

	private label: IResourceLabel;
	get element(): IResourceLabel { return this.label; }

	constructor(
		container: HTMLElement,
		options: IIconLabelCreationOptions | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService,
		@IDecorationsService decorationsService: IDecorationsService,
		@IThemeService themeService: IThemeService,
		@ILabelService labelService: ILabelService,
		@ITextFileService textFileService: ITextFileService
	) {
		super(DEFAULT_LABELS_CONTAINER, instantiationService, configurationService, modelService, modeService, decorationsService, themeService, labelService, textFileService);

		this.label = this._register(this.create(container, options));
	}
}

enum Redraw {
	Basic = 1,
	Full = 2
}

class ResourceLabelWidget extends IconLabel {

	private _onDidRender = this._register(new Emitter<void>());
	readonly onDidRender = this._onDidRender.event;

	private readonly renderDisposables = this._register(new DisposableStore());

	private label?: IResourceLabelProps;
	private options?: IResourceLabelOptions;
	private computedIconClasses?: string[];
	private lastKnownDetectedModeId?: string;
	private computedPathLabel?: string;

	private needsRedraw?: Redraw;
	private isHidden: boolean = false;

	constructor(
		container: HTMLElement,
		options: IIconLabelCreationOptions | undefined,
		@IModeService private readonly modeService: IModeService,
		@IModelService private readonly modelService: IModelService,
		@IDecorationsService private readonly decorationsService: IDecorationsService,
		@ILabelService private readonly labelService: ILabelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService
	) {
		super(container, options);
	}

	notifyVisibilityChanged(visible: boolean): void {
		if (visible === this.isHidden) {
			this.isHidden = !visible;

			if (visible && this.needsRedraw) {
				this.render(this.needsRedraw === Redraw.Basic ? false : true);
				this.needsRedraw = undefined;
			}
		}
	}

	notifyModelModeChanged(model: ITextModel): void {
		this.handleModelEvent(model);
	}

	notifyModelAdded(model: ITextModel): void {
		this.handleModelEvent(model);
	}

	private handleModelEvent(model: ITextModel): void {
		const resource = toResource(this.label);
		if (!resource) {
			return; // only update if resource exists
		}

		if (isEqual(model.uri, resource)) {
			if (this.lastKnownDetectedModeId !== model.getModeId()) {
				this.render(true); // update if the language id of the model has changed from our last known state
			}
		}
	}

	notifyFileDecorationsChanges(e: IResourceDecorationChangeEvent): boolean {
		if (!this.options) {
			return false;
		}

		const resource = toResource(this.label);
		if (!resource) {
			return false;
		}

		if (this.options.fileDecorations && e.affectsResource(resource)) {
			return this.render(false);
		}

		return false;
	}

	notifyExtensionsRegistered(): void {
		this.render(true);
	}

	notifyThemeChange(): void {
		this.render(false);
	}

	notifyFileAssociationsChange(): void {
		this.render(true);
	}

	notifyFormattersChange(scheme: string): void {
		if (toResource(this.label)?.scheme === scheme) {
			this.render(false);
		}
	}

	notifyUntitledLabelChange(resource: URI): void {
		if (isEqual(resource, toResource(this.label))) {
			this.render(false);
		}
	}

	setFile(resource: URI, options?: IFileLabelOptions): void {
		const hideLabel = options?.hideLabel;
		let name: string | undefined;
		if (!hideLabel) {
			if (options?.fileKind === FileKind.ROOT_FOLDER) {
				const workspaceFolder = this.contextService.getWorkspaceFolder(resource);
				if (workspaceFolder) {
					name = workspaceFolder.name;
				}
			}

			if (!name) {
				name = normalizeDriveLetter(basenameOrAuthority(resource));
			}
		}

		let description: string | undefined;
		if (!options?.hidePath) {
			description = this.labelService.getUriLabel(dirname(resource), { relative: true });
		}

		this.setResource({ resource, name, description }, options);
	}

	setResource(label: IResourceLabelProps, options: IResourceLabelOptions = Object.create(null)): void {
		const resource = toResource(label);
		const isSideBySideEditor = label?.resource && !URI.isUri(label.resource);

		if (!options.forceLabel && !isSideBySideEditor && resource?.scheme === Schemas.untitled) {
			// Untitled labels are very dynamic because they may change
			// whenever the content changes (unless a path is associated).
			// As such we always ask the actual editor for it's name and
			// description to get latest in case name/description are
			// provided. If they are not provided from the label we got
			// we assume that the client does not want to display them
			// and as such do not override.
			//
			// We do not touch the label if it represents a primary-secondary
			// because in that case we expect it to carry a proper label
			// and description.
			const untitledModel = this.textFileService.untitled.get(resource);
			if (untitledModel && !untitledModel.hasAssociatedFilePath) {
				if (typeof label.name === 'string') {
					label.name = untitledModel.name;
				}

				if (typeof label.description === 'string') {
					let untitledDescription = untitledModel.resource.path;
					if (label.name !== untitledDescription) {
						label.description = untitledDescription;
					} else {
						label.description = undefined;
					}
				}

				let untitledTitle = untitledModel.resource.path;
				if (untitledModel.name !== untitledTitle) {
					options.title = `${untitledModel.name} • ${untitledTitle}`;
				} else {
					options.title = untitledTitle;
				}
			}
		}

		const hasPathLabelChanged = this.hasPathLabelChanged(label, options);
		const clearIconCache = this.clearIconCache(label, options);

		this.label = label;
		this.options = options;

		if (hasPathLabelChanged) {
			this.computedPathLabel = undefined; // reset path label due to resource change
		}

		this.render(clearIconCache);
	}

	private clearIconCache(newLabel: IResourceLabelProps, newOptions?: IResourceLabelOptions): boolean {
		const newResource = toResource(newLabel);
		const oldResource = toResource(this.label);

		const newFileKind = newOptions ? newOptions.fileKind : undefined;
		const oldFileKind = this.options ? this.options.fileKind : undefined;

		if (newFileKind !== oldFileKind) {
			return true; // same resource but different kind (file, folder)
		}

		if (newResource && oldResource) {
			return newResource.toString() !== oldResource.toString();
		}

		if (!newResource && !oldResource) {
			return false;
		}

		return true;
	}

	private hasPathLabelChanged(newLabel: IResourceLabelProps, newOptions?: IResourceLabelOptions): boolean {
		const newResource = toResource(newLabel);

		return !!newResource && this.computedPathLabel !== this.labelService.getUriLabel(newResource);
	}

	clear(): void {
		this.label = undefined;
		this.options = undefined;
		this.lastKnownDetectedModeId = undefined;
		this.computedIconClasses = undefined;
		this.computedPathLabel = undefined;

		this.setLabel('');
	}

	private render(clearIconCache: boolean): boolean {
		if (this.isHidden) {
			if (!this.needsRedraw) {
				this.needsRedraw = clearIconCache ? Redraw.Full : Redraw.Basic;
			}

			if (this.needsRedraw === Redraw.Basic && clearIconCache) {
				this.needsRedraw = Redraw.Full;
			}

			return false;
		}

		if (this.label) {
			const resource = toResource(this.label);
			const detectedModeId = resource ? withNullAsUndefined(detectModeId(this.modelService, this.modeService, resource)) : undefined;
			if (this.lastKnownDetectedModeId !== detectedModeId) {
				clearIconCache = true;
				this.lastKnownDetectedModeId = detectedModeId;
			}
		}

		if (clearIconCache) {
			this.computedIconClasses = undefined;
		}

		if (!this.label) {
			return false;
		}

		this.renderDisposables.clear();

		const iconLabelOptions: IIconLabelValueOptions & { extraClasses: string[] } = {
			title: '',
			italic: this.options?.italic,
			strikethrough: this.options?.strikethrough,
			matches: this.options?.matches,
			descriptionMatches: this.options?.descriptionMatches,
			extraClasses: [],
			separator: this.options?.separator,
			domId: this.options?.domId
		};

		const resource = toResource(this.label);
		const label = this.label.name;

		if (this.options && (this.options.title !== undefined)) {
			iconLabelOptions.title = this.options.title;
		} else if (resource && resource.scheme !== Schemas.data /* do not accidentally inline Data URIs */) {
			if (!this.computedPathLabel) {
				this.computedPathLabel = this.labelService.getUriLabel(resource);
			}

			iconLabelOptions.title = this.computedPathLabel;
		}

		if (this.options && !this.options.hideIcon) {
			if (!this.computedIconClasses) {
				this.computedIconClasses = getIconClasses(this.modelService, this.modeService, resource, this.options && this.options.fileKind);
			}
			iconLabelOptions.extraClasses = this.computedIconClasses.slice(0);
		}

		if (this.options?.extraClasses) {
			iconLabelOptions.extraClasses.push(...this.options.extraClasses);
		}

		if (this.options?.fileDecorations && resource) {
			const deco = this.decorationsService.getDecoration(
				resource,
				this.options.fileKind !== FileKind.FILE
			);

			if (deco) {
				this.renderDisposables.add(deco);

				if (deco.tooltip && (typeof iconLabelOptions.title === 'string')) {
					iconLabelOptions.title = `${iconLabelOptions.title} • ${deco.tooltip}`;
				}

				if (this.options.fileDecorations.colors) {
					iconLabelOptions.extraClasses.push(deco.labelClassName);
				}

				if (this.options.fileDecorations.badges) {
					iconLabelOptions.extraClasses.push(deco.badgeClassName);
					iconLabelOptions.extraClasses.push(deco.iconClassName);
				}
			}
		}

		this.setLabel(label || '', this.label.description, iconLabelOptions);

		this._onDidRender.fire();

		return true;
	}

	override dispose(): void {
		super.dispose();

		this.label = undefined;
		this.options = undefined;
		this.lastKnownDetectedModeId = undefined;
		this.computedIconClasses = undefined;
		this.computedPathLabel = undefined;
	}
}
