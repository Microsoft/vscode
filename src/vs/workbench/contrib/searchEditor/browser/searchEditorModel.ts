/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { parseSavedSearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { SearchConfiguration } from './searchEditorInput';
import { assertIsDefined } from 'vs/base/common/types';
import { NO_TYPE_ID } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { createTextBufferFactoryFromStream } from 'vs/editor/common/model/textModel';
import { SearchEditorScheme, SearchEditorWorkingCopyTypeId } from 'vs/workbench/contrib/searchEditor/browser/constants';


export class SearchEditorModel {
	private cachedContentsModel: ITextModel | undefined = undefined;
	private resolveContents!: (model: ITextModel) => void;
	public onModelResolved: Promise<ITextModel>;

	private ongoingResolve = Promise.resolve<any>(undefined);

	constructor(
		private modelUri: URI,
		public config: SearchConfiguration,
		private existingData: ({ config: Partial<SearchConfiguration>; backingUri?: URI; } &
			({ modelUri: URI; text?: never; } |
			{ text: string; modelUri?: never; } |
			{ backingUri: URI; text?: never; modelUri?: never; })),
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkingCopyBackupService readonly workingCopyBackupService: IWorkingCopyBackupService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService) {
		this.onModelResolved = new Promise<ITextModel>(resolve => this.resolveContents = resolve);
		this.onModelResolved.then(model => this.cachedContentsModel = model);

		this.ongoingResolve = (async () => {
			let discardLegacyBackup = false;
			let backup = await workingCopyBackupService.resolve({ resource: modelUri, typeId: SearchEditorWorkingCopyTypeId });
			if (!backup) {
				// TODO@bpasero remove this fallback after some releases
				backup = await workingCopyBackupService.resolve({ resource: modelUri, typeId: NO_TYPE_ID });

				if (backup && modelUri.scheme === SearchEditorScheme) {
					discardLegacyBackup = true;
				}
			}

			let model = modelService.getModel(modelUri);
			if (!model && backup) {
				const factory = await createTextBufferFactoryFromStream(backup.value);

				if (discardLegacyBackup) {
					await workingCopyBackupService.discardBackup({ resource: modelUri, typeId: NO_TYPE_ID });
				}

				model = modelService.createModel(factory, modeService.create('search-result'), modelUri);
			}

			if (model) {
				this.resolveContents(model);
			}

			return model;
		})();
	}

	async resolve(): Promise<ITextModel> {
		await (this.ongoingResolve = this.ongoingResolve.then(() => this.cachedContentsModel || this.createModel()));
		return assertIsDefined(this.cachedContentsModel);
	}

	private async createModel() {
		const getContents = async () => {
			if (this.existingData.text !== undefined) {
				return this.existingData.text;
			}
			else if (this.existingData.backingUri !== undefined) {
				return (await this.instantiationService.invokeFunction(parseSavedSearchEditor, this.existingData.backingUri)).text;
			}
			else {
				return '';
			}
		};

		const contents = await getContents();
		const model = this.modelService.getModel(this.modelUri) ?? this.modelService.createModel(contents, this.modeService.create('search-result'), this.modelUri);
		this.resolveContents(model);
		return model;
	}
}
