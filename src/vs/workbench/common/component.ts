/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Memento, MementoObject } from 'vs/workbench/common/memento';
import { IThemeService, Themable } from 'vs/platform/theme/common/themeService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';

export class Component extends Themable {

	private readonly memento: Memento;

	constructor(
		private readonly id: string,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(themeService);

		this.id = id;
		this.memento = new Memento(this.id, storageService);

		this._register(storageService.onWillSaveState(() => {

			// Ask the component to persist state into the memento
			this.saveState();

			// Then save the memento into storage
			this.memento.saveMemento();
		}));
	}

	getId(): string {
		return this.id;
	}

	protected getMemento(scope: StorageScope): MementoObject {
		return this.memento.getMemento(scope);
	}

	protected saveState(): void {
		// Subclasses to implement for storing state
	}
}
