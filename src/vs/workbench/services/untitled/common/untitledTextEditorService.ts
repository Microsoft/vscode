/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { UntitledTextEditorModel, IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { IFilesConfiguration } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Event, Emitter } from 'vs/base/common/event';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';

export const IUntitledTextEditorService = createDecorator<IUntitledTextEditorService>('untitledTextEditorService');

export interface INewUntitledTextEditorOptions {

	/**
	 * Initial value of the untitled editor. An untitled editor with initial
	 * value is dirty right from the beginning.
	 */
	initialValue?: string;

	/**
	 * Preferred language mode to use when saving the untitled editor.
	 */
	mode?: string;

	/**
	 * Preferred encoding to use when saving the untitled editor.
	 */
	encoding?: string;
}

export interface IExistingUntitledTextEditorOptions extends INewUntitledTextEditorOptions {

	/**
	 * A resource to identify the untitled editor to create or return
	 * if already existing.
	 *
	 * Note: the resource will not be used unless the scheme is `untitled`.
	 */
	untitledResource?: URI;
}

export interface INewUntitledTextEditorWithAssociatedResourceOptions extends INewUntitledTextEditorOptions {

	/**
	 * Resource components to associate with the untitled editor. When saving
	 * the untitled editor, the associated components will be used and the user
	 * is not being asked to provide a file path.
	 *
	 * Note: currently it is not possible to specify the `scheme` to use. The
	 * untitled editor will saved to the default local or remote resource.
	 */
	associatedResource?: { authority: string; path: string; query: string; fragment: string; }
}

type IInternalUntitledTextEditorOptions = IExistingUntitledTextEditorOptions & INewUntitledTextEditorWithAssociatedResourceOptions;

export interface IUntitledTextEditorModelManager {

	/**
	 * Events for when untitled text editors change (e.g. getting dirty, saved or reverted).
	 */
	readonly onDidChangeDirty: Event<IUntitledTextEditorModel>;

	/**
	 * Events for when untitled text editor encodings change.
	 */
	readonly onDidChangeEncoding: Event<IUntitledTextEditorModel>;

	/**
	 * Events for when untitled text editor labels change.
	 */
	readonly onDidChangeLabel: Event<IUntitledTextEditorModel>;

	/**
	 * Events for when untitled text editors are disposed.
	 */
	readonly onDidDispose: Event<IUntitledTextEditorModel>;

	/**
	 * Creates a new untitled editor model with the provided options. If the `untitledResource`
	 * property is provided and the untitled editor exists, it will return that existing
	 * instance instead of creating a new one.
	 */
	create(options?: INewUntitledTextEditorOptions): IUntitledTextEditorModel;
	create(options?: INewUntitledTextEditorWithAssociatedResourceOptions): IUntitledTextEditorModel;
	create(options?: IExistingUntitledTextEditorOptions): IUntitledTextEditorModel;

	/**
	 * Returns an existing untitled editor model if already created before.
	 */
	get(resource: URI): IUntitledTextEditorModel | undefined;

	/**
	 * Resolves an untitled editor model from the provided options. If the `untitledResource`
	 * property is provided and the untitled editor exists, it will return that existing
	 * instance instead of creating a new one.
	 */
	resolve(options?: INewUntitledTextEditorOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;
	resolve(options?: INewUntitledTextEditorWithAssociatedResourceOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;
	resolve(options?: IExistingUntitledTextEditorOptions): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel>;
}

export interface IUntitledTextEditorService extends IUntitledTextEditorModelManager {

	readonly _serviceBrand: undefined;
}

export class UntitledTextEditorService extends Disposable implements IUntitledTextEditorService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeDirty = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidDispose = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChangeLabel = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	private readonly mapResourceToModel = new ResourceMap<UntitledTextEditorModel>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	get(resource: URI): UntitledTextEditorModel | undefined {
		return this.mapResourceToModel.get(resource);
	}

	resolve(options?: IInternalUntitledTextEditorOptions): Promise<UntitledTextEditorModel & IResolvedTextEditorModel> {
		return this.doCreateOrGet(options).load();
	}

	create(options?: IInternalUntitledTextEditorOptions): UntitledTextEditorModel {
		return this.doCreateOrGet(options);
	}

	private doCreateOrGet(options: IInternalUntitledTextEditorOptions = Object.create(null)): UntitledTextEditorModel {
		const massagedOptions = this.massageOptions(options);

		// Return existing instance if asked for it
		if (massagedOptions.untitledResource && this.mapResourceToModel.has(massagedOptions.untitledResource)) {
			return this.mapResourceToModel.get(massagedOptions.untitledResource)!;
		}

		// Create new instance otherwise
		return this.doCreate(massagedOptions);
	}

	private massageOptions(options: IInternalUntitledTextEditorOptions): IInternalUntitledTextEditorOptions {
		const massagedOptions: IInternalUntitledTextEditorOptions = Object.create(null);

		// Figure out associated and untitled resource
		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		} else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
		}

		// Language mode
		if (options.mode) {
			massagedOptions.mode = options.mode;
		} else if (!massagedOptions.associatedResource) {
			const configuration = this.configurationService.getValue<IFilesConfiguration>();
			if (configuration.files?.defaultLanguage) {
				massagedOptions.mode = configuration.files.defaultLanguage;
			}
		}

		// Take over encoding and initial value
		massagedOptions.encoding = options.encoding;
		massagedOptions.initialValue = options.initialValue;

		return massagedOptions;
	}

	private doCreate(options: IInternalUntitledTextEditorOptions): UntitledTextEditorModel {

		// Create a new untitled resource if none is provided
		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToModel.has(untitledResource));
		}

		// Create new model with provided options
		const model = this._register(this.instantiationService.createInstance(UntitledTextEditorModel, untitledResource, !!options.associatedResource, options.initialValue, options.mode, options.encoding));

		this.registerModel(model);

		return model;
	}

	private registerModel(model: UntitledTextEditorModel): void {

		// Install model listeners
		const modelListeners = new DisposableStore();
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidChangeName(() => this._onDidChangeLabel.fire(model)));
		modelListeners.add(model.onDidChangeEncoding(() => this._onDidChangeEncoding.fire(model)));
		modelListeners.add(model.onDispose(() => this._onDidDispose.fire(model)));

		// Remove from cache on dispose
		Event.once(model.onDispose)(() => {

			// Registry
			this.mapResourceToModel.delete(model.resource);

			// Listeners
			modelListeners.dispose();
		});

		// Add to cache
		this.mapResourceToModel.set(model.resource, model);

		// If the model is dirty right from the beginning,
		// make sure to emit this as an event
		if (model.isDirty()) {
			this._onDidChangeDirty.fire(model);
		}
	}
}

registerSingleton(IUntitledTextEditorService, UntitledTextEditorService, true);
