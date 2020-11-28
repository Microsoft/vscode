/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { isEmptyObject } from 'vs/base/common/types';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface ISearchHistoryService {
	readonly _serviceBrand: undefined;
	onDidClearHistory: Event<void>;
	clearHistory(): void;
	load(): ISearchHistoryValues;
	save(history: ISearchHistoryValues): void;
}

export const ISearchHistoryService = createDecorator<ISearchHistoryService>('searchHistoryService');

export interface ISearchHistoryValues {
	search?: string[];
	replace?: string[];
	include?: string[];
	exclude?: string[];
}

export class SearchHistoryService implements ISearchHistoryService {
	declare readonly _serviceBrand: undefined;

	private static readonly SEARCH_HISTORY_KEY = 'workbench.search.history';

	private readonly _onDidClearHistory = new Emitter<void>();
	readonly onDidClearHistory: Event<void> = this._onDidClearHistory.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) { }

	clearHistory(): void {
		this.storageService.remove(SearchHistoryService.SEARCH_HISTORY_KEY, StorageScope.WORKSPACE);
		this._onDidClearHistory.fire();
	}

	load(): ISearchHistoryValues {
		let result: ISearchHistoryValues | undefined;
		const raw = this.storageService.get(SearchHistoryService.SEARCH_HISTORY_KEY, StorageScope.WORKSPACE);

		if (raw) {
			try {
				result = JSON.parse(raw);
			} catch (e) {
				// Invalid data
			}
		}

		return result || {};
	}

	save(history: ISearchHistoryValues): void {
		if (isEmptyObject(history)) {
			this.storageService.remove(SearchHistoryService.SEARCH_HISTORY_KEY, StorageScope.WORKSPACE);
		} else {
			this.storageService.store(SearchHistoryService.SEARCH_HISTORY_KEY, JSON.stringify(history), StorageScope.WORKSPACE, StorageTarget.USER);
		}
	}
}
