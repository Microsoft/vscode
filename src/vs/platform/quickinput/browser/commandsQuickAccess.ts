/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { PickerQuickAccessProvider, IPickerQuickAccessItem, IPickerQuickAccessProviderOptions } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore, Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { or, matchesPrefix, matchesWords, matchesContiguousSubString } from 'vs/base/common/filters';
import { withNullAsUndefined } from 'vs/base/common/types';
import { LRUCache } from 'vs/base/common/map';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { toErrorMessage } from 'vs/base/common/errorMessage';

export interface ICommandQuickPick extends IPickerQuickAccessItem {
	commandId: string;
	commandAlias?: string;
}

export interface ICommandsQuickAccessOptions extends IPickerQuickAccessProviderOptions<ICommandQuickPick> {
	showAlias: boolean;
}

export abstract class AbstractCommandsQuickAccessProvider extends PickerQuickAccessProvider<ICommandQuickPick> implements IDisposable {

	static PREFIX = '>';

	private static WORD_FILTER = or(matchesPrefix, matchesWords, matchesContiguousSubString);

	private readonly commandsHistory = this._register(this.instantiationService.createInstance(CommandsHistory));

	constructor(
		protected options: ICommandsQuickAccessOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(AbstractCommandsQuickAccessProvider.PREFIX, options);
	}

	protected async getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Promise<Array<ICommandQuickPick | IQuickPickSeparator>> {

		// Ask subclass for all command picks
		const allCommandPicks = await this.getCommandPicks(disposables, token);

		if (token.isCancellationRequested) {
			return [];
		}

		// Filter
		const filteredCommandPicks: ICommandQuickPick[] = [];
		for (const commandPick of allCommandPicks) {
			const labelHighlights = withNullAsUndefined(AbstractCommandsQuickAccessProvider.WORD_FILTER(filter, commandPick.label));
			const aliasHighlights = commandPick.commandAlias ? withNullAsUndefined(AbstractCommandsQuickAccessProvider.WORD_FILTER(filter, commandPick.commandAlias)) : undefined;

			// Add if matching in label or alias
			if (labelHighlights || aliasHighlights) {
				commandPick.highlights = {
					label: labelHighlights,
					detail: this.options.showAlias ? aliasHighlights : undefined
				};

				filteredCommandPicks.push(commandPick);
			}

			// Also add if we have a 100% command ID match
			else if (filter === commandPick.commandId) {
				filteredCommandPicks.push(commandPick);
			}
		}

		// Add description to commands that have duplicate labels
		const mapLabelToCommand = new Map<string, ICommandQuickPick>();
		for (const commandPick of filteredCommandPicks) {
			const existingCommandForLabel = mapLabelToCommand.get(commandPick.label);
			if (existingCommandForLabel) {
				commandPick.description = commandPick.commandId;
				existingCommandForLabel.description = existingCommandForLabel.commandId;
			} else {
				mapLabelToCommand.set(commandPick.label, commandPick);
			}
		}

		// Sort by MRU order and fallback to name otherwise
		filteredCommandPicks.sort((commandPickA, commandPickB) => {
			const commandACounter = this.commandsHistory.peek(commandPickA.commandId);
			const commandBCounter = this.commandsHistory.peek(commandPickB.commandId);

			if (commandACounter && commandBCounter) {
				return commandACounter > commandBCounter ? -1 : 1; // use more recently used command before older
			}

			if (commandACounter) {
				return -1; // first command was used, so it wins over the non used one
			}

			if (commandBCounter) {
				return 1; // other command was used so it wins over the command
			}

			// both commands were never used, so we sort by name
			return commandPickA.label.localeCompare(commandPickB.label);
		});

		const commandPicks: Array<ICommandQuickPick | IQuickPickSeparator> = [];

		let addSeparator = false;
		for (let i = 0; i < filteredCommandPicks.length; i++) {
			const commandPick = filteredCommandPicks[i];
			const keybinding = this.keybindingService.lookupKeybinding(commandPick.commandId);
			const ariaLabel = keybinding ?
				localize('commandPickAriaLabelWithKeybinding', "{0}, {1}", commandPick.label, keybinding.getAriaLabel()) :
				commandPick.label;

			// Separator: recently used
			if (i === 0 && this.commandsHistory.peek(commandPick.commandId)) {
				commandPicks.push({ type: 'separator', label: localize('recentlyUsed', "recently used") });
				addSeparator = true;
			}

			// Separator: other commands
			if (i !== 0 && addSeparator && !this.commandsHistory.peek(commandPick.commandId)) {
				commandPicks.push({ type: 'separator', label: localize('morecCommands', "other commands") });
				addSeparator = false; // only once
			}

			// Command
			commandPicks.push({
				...commandPick,
				ariaLabel,
				detail: this.options.showAlias && commandPick.commandAlias !== commandPick.label ? commandPick.commandAlias : undefined,
				keybinding,
				accept: async () => {

					// Add to history
					this.commandsHistory.push(commandPick.commandId);

					// Telementry
					this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', {
						id: commandPick.commandId,
						from: 'quick open'
					});

					// Run
					try {
						await this.commandService.executeCommand(commandPick.commandId);
					} catch (error) {
						if (!isPromiseCanceledError(error)) {
							this.notificationService.error(localize('canNotRun', "Command '{0}' resulted in an error ({1})", commandPick.label, toErrorMessage(error)));
						}
					}
				}
			});
		}

		return commandPicks;
	}

	/**
	 * Subclasses to provide the actual command entries.
	 */
	protected abstract getCommandPicks(disposables: DisposableStore, token: CancellationToken): Promise<Array<ICommandQuickPick>>;
}

interface ISerializedCommandHistory {
	usesLRU?: boolean;
	entries: { key: string; value: number }[];
}

interface ICommandsQuickAccessConfiguration {
	workbench: {
		commandPalette: {
			history: number;
			preserveInput: boolean;
		}
	};
}

export class CommandsHistory extends Disposable {

	static readonly DEFAULT_COMMANDS_HISTORY_LENGTH = 50;

	private static readonly PREF_KEY_CACHE = 'commandPalette.mru.cache';
	private static readonly PREF_KEY_COUNTER = 'commandPalette.mru.counter';

	private static cache: LRUCache<string, number> | undefined;
	private static counter = 1;

	private configuredCommandsHistoryLength = 0;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this.updateConfiguration();
		this.load();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(() => this.updateConfiguration()));
	}

	private updateConfiguration(): void {
		this.configuredCommandsHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(this.configurationService);

		if (CommandsHistory.cache && CommandsHistory.cache.limit !== this.configuredCommandsHistoryLength) {
			CommandsHistory.cache.limit = this.configuredCommandsHistoryLength;

			CommandsHistory.saveState(this.storageService);
		}
	}

	private load(): void {
		const raw = this.storageService.get(CommandsHistory.PREF_KEY_CACHE, StorageScope.GLOBAL);
		let serializedCache: ISerializedCommandHistory | undefined;
		if (raw) {
			try {
				serializedCache = JSON.parse(raw);
			} catch (error) {
				// invalid data
			}
		}

		const cache = CommandsHistory.cache = new LRUCache<string, number>(this.configuredCommandsHistoryLength, 1);
		if (serializedCache) {
			let entries: { key: string; value: number }[];
			if (serializedCache.usesLRU) {
				entries = serializedCache.entries;
			} else {
				entries = serializedCache.entries.sort((a, b) => a.value - b.value);
			}
			entries.forEach(entry => cache.set(entry.key, entry.value));
		}

		CommandsHistory.counter = this.storageService.getNumber(CommandsHistory.PREF_KEY_COUNTER, StorageScope.GLOBAL, CommandsHistory.counter);
	}

	push(commandId: string): void {
		if (!CommandsHistory.cache) {
			return;
		}

		CommandsHistory.cache.set(commandId, CommandsHistory.counter++); // set counter to command

		CommandsHistory.saveState(this.storageService);
	}

	peek(commandId: string): number | undefined {
		return CommandsHistory.cache?.peek(commandId);
	}

	static saveState(storageService: IStorageService): void {
		if (!CommandsHistory.cache) {
			return;
		}

		const serializedCache: ISerializedCommandHistory = { usesLRU: true, entries: [] };
		CommandsHistory.cache.forEach((value, key) => serializedCache.entries.push({ key, value }));

		storageService.store(CommandsHistory.PREF_KEY_CACHE, JSON.stringify(serializedCache), StorageScope.GLOBAL, StorageTarget.USER);
		storageService.store(CommandsHistory.PREF_KEY_COUNTER, CommandsHistory.counter, StorageScope.GLOBAL, StorageTarget.USER);
	}

	static getConfiguredCommandHistoryLength(configurationService: IConfigurationService): number {
		const config = <ICommandsQuickAccessConfiguration>configurationService.getValue();

		const configuredCommandHistoryLength = config.workbench?.commandPalette?.history;
		if (typeof configuredCommandHistoryLength === 'number') {
			return configuredCommandHistoryLength;
		}

		return CommandsHistory.DEFAULT_COMMANDS_HISTORY_LENGTH;
	}

	static clearHistory(configurationService: IConfigurationService, storageService: IStorageService): void {
		const commandHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(configurationService);
		CommandsHistory.cache = new LRUCache<string, number>(commandHistoryLength);
		CommandsHistory.counter = 1;

		CommandsHistory.saveState(storageService);
	}
}

