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
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { SearchConfiguration } from './searchEditorInput';
import { assertIsDefined } from 'vs/base/common/types';


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
		@IBackupFileService readonly backupService: IBackupFileService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService) {
		this.onModelResolved = new Promise<ITextModel>(resolve => this.resolveContents = resolve);
		this.onModelResolved.then(model => this.cachedContentsModel = model);
		this.ongoingResolve = backupService.resolve(modelUri)
			.then(backup => modelService.getModel(modelUri) ?? (backup ? modelService.createModel(backup.value, modeService.create('search-result'), modelUri) : undefined))
			.then(model => { if (model) { this.resolveContents(model); } });
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
