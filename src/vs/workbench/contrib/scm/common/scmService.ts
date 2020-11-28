/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { ISCMService, ISCMProvider, ISCMInput, ISCMRepository, IInputValidator, ISCMInputChangeEvent, SCMInputChangeReason } from './scm';
import { ILogService } from 'vs/platform/log/common/log';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { HistoryNavigator2 } from 'vs/base/common/history';

class SCMInput implements ISCMInput {

	private _value = '';

	get value(): string {
		return this._value;
	}

	private readonly _onDidChange = new Emitter<ISCMInputChangeEvent>();
	readonly onDidChange: Event<ISCMInputChangeEvent> = this._onDidChange.event;

	private _placeholder = '';

	get placeholder(): string {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._placeholder = placeholder;
		this._onDidChangePlaceholder.fire(placeholder);
	}

	private readonly _onDidChangePlaceholder = new Emitter<string>();
	readonly onDidChangePlaceholder: Event<string> = this._onDidChangePlaceholder.event;

	private _visible = true;

	get visible(): boolean {
		return this._visible;
	}

	set visible(visible: boolean) {
		this._visible = visible;
		this._onDidChangeVisibility.fire(visible);
	}

	private readonly _onDidChangeVisibility = new Emitter<boolean>();
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility
		.event;

	private _validateInput: IInputValidator = () => Promise.resolve(undefined);

	get validateInput(): IInputValidator {
		return this._validateInput;
	}

	set validateInput(validateInput: IInputValidator) {
		this._validateInput = validateInput;
		this._onDidChangeValidateInput.fire();
	}

	private readonly _onDidChangeValidateInput = new Emitter<void>();
	readonly onDidChangeValidateInput: Event<void> = this._onDidChangeValidateInput.event;

	private historyNavigator: HistoryNavigator2<string>;

	constructor(
		readonly repository: ISCMRepository,
		@IStorageService private storageService: IStorageService
	) {
		const historyKey = `scm/input:${this.repository.provider.label}:${this.repository.provider.rootUri?.path}`;
		let history: string[] | undefined;
		let rawHistory = this.storageService.get(historyKey, StorageScope.GLOBAL, '');

		if (rawHistory) {
			try {
				history = JSON.parse(rawHistory);
			} catch {
				// noop
			}
		}

		if (!history || history.length === 0) {
			history = [this._value];
		} else {
			this._value = history[history.length - 1];
		}

		this.historyNavigator = new HistoryNavigator2(history, 50);

		this.storageService.onWillSaveState(e => {
			if (this.historyNavigator.isAtEnd()) {
				this.historyNavigator.replaceLast(this._value);
			}

			if (this.repository.provider.rootUri) {
				this.storageService.store(historyKey, JSON.stringify([...this.historyNavigator]), StorageScope.GLOBAL, StorageTarget.USER);
			}
		});
	}

	setValue(value: string, transient: boolean, reason?: SCMInputChangeReason) {
		if (value === this._value) {
			return;
		}

		if (!transient) {
			this.historyNavigator.replaceLast(this._value);
			this.historyNavigator.add(value);
		}

		this._value = value;
		this._onDidChange.fire({ value, reason });
	}

	showNextHistoryValue(): void {
		if (this.historyNavigator.isAtEnd()) {
			return;
		} else if (!this.historyNavigator.has(this.value)) {
			this.historyNavigator.replaceLast(this._value);
			this.historyNavigator.resetCursor();
		}

		const value = this.historyNavigator.next();
		this.setValue(value, true, SCMInputChangeReason.HistoryNext);
	}

	showPreviousHistoryValue(): void {
		if (this.historyNavigator.isAtEnd()) {
			this.historyNavigator.replaceLast(this._value);
		} else if (!this.historyNavigator.has(this._value)) {
			this.historyNavigator.replaceLast(this._value);
			this.historyNavigator.resetCursor();
		}

		const value = this.historyNavigator.previous();
		this.setValue(value, true, SCMInputChangeReason.HistoryPrevious);
	}
}

class SCMRepository implements ISCMRepository {

	private _selected = false;
	get selected(): boolean {
		return this._selected;
	}

	private readonly _onDidChangeSelection = new Emitter<boolean>();
	readonly onDidChangeSelection: Event<boolean> = this._onDidChangeSelection.event;

	readonly input: ISCMInput = new SCMInput(this, this.storageService);

	constructor(
		public readonly provider: ISCMProvider,
		private disposable: IDisposable,
		@IStorageService private storageService: IStorageService
	) { }

	setSelected(selected: boolean): void {
		if (this._selected === selected) {
			return;
		}

		this._selected = selected;
		this._onDidChangeSelection.fire(selected);
	}

	dispose(): void {
		this.disposable.dispose();
		this.provider.dispose();
	}
}

export class SCMService implements ISCMService {

	declare readonly _serviceBrand: undefined;

	private _providerIds = new Set<string>();
	private _repositories: ISCMRepository[] = [];
	get repositories(): ISCMRepository[] { return [...this._repositories]; }

	private providerCount: IContextKey<number>;

	private readonly _onDidAddProvider = new Emitter<ISCMRepository>();
	readonly onDidAddRepository: Event<ISCMRepository> = this._onDidAddProvider.event;

	private readonly _onDidRemoveProvider = new Emitter<ISCMRepository>();
	readonly onDidRemoveRepository: Event<ISCMRepository> = this._onDidRemoveProvider.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private storageService: IStorageService
	) {
		this.providerCount = contextKeyService.createKey('scm.providerCount', 0);
	}

	registerSCMProvider(provider: ISCMProvider): ISCMRepository {
		this.logService.trace('SCMService#registerSCMProvider');

		if (this._providerIds.has(provider.id)) {
			throw new Error(`SCM Provider ${provider.id} already exists.`);
		}

		this._providerIds.add(provider.id);

		const disposable = toDisposable(() => {
			const index = this._repositories.indexOf(repository);

			if (index < 0) {
				return;
			}

			this._providerIds.delete(provider.id);
			this._repositories.splice(index, 1);
			this._onDidRemoveProvider.fire(repository);

			this.providerCount.set(this._repositories.length);
		});

		const repository = new SCMRepository(provider, disposable, this.storageService);
		this._repositories.push(repository);
		this._onDidAddProvider.fire(repository);

		this.providerCount.set(this._repositories.length);
		return repository;
	}
}
