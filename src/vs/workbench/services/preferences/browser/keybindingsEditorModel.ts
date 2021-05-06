/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { distinct, coalesce } from 'vs/base/common/arrays';
import * as strings from 'vs/base/common/strings';
import { OperatingSystem, Language } from 'vs/base/common/platform';
import { IMatch, IFilter, or, matchesContiguousSubString, matchesPrefix, matchesCamelCase, matchesWords } from 'vs/base/common/filters';
import { Registry } from 'vs/platform/registry/common/platform';
import { ResolvedKeybinding, ResolvedKeybindingPart } from 'vs/base/common/keyCodes';
import { AriaLabelProvider, UserSettingsLabelProvider, UILabelProvider, ModifierLabels as ModLabels } from 'vs/base/common/keybindingLabels';
import { MenuRegistry, ILocalizedString, ICommandAction } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { EditorModel } from 'vs/workbench/common/editor';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { getAllUnboundCommands } from 'vs/workbench/services/keybinding/browser/unboundCommands';
import { IKeybindingItemEntry, KeybindingMatches, KeybindingMatch, IKeybindingItem } from 'vs/workbench/services/preferences/common/preferences';

export const KEYBINDING_ENTRY_TEMPLATE_ID = 'keybinding.entry.template';

const SOURCE_DEFAULT = localize('default', "Default");
const SOURCE_EXTENSION = localize('extension', "Extension");
const SOURCE_USER = localize('user', "User");

interface ModifierLabels {
	ui: ModLabels;
	aria: ModLabels;
	user: ModLabels;
}

const wordFilter = or(matchesPrefix, matchesWords, matchesContiguousSubString);

export class KeybindingsEditorModel extends EditorModel {

	private _keybindingItems: IKeybindingItem[];
	private _keybindingItemsSortedByPrecedence: IKeybindingItem[];
	private modifierLabels: ModifierLabels;

	constructor(
		os: OperatingSystem,
		@IKeybindingService private readonly keybindingsService: IKeybindingService
	) {
		super();
		this._keybindingItems = [];
		this._keybindingItemsSortedByPrecedence = [];
		this.modifierLabels = {
			ui: UILabelProvider.modifierLabels[os],
			aria: AriaLabelProvider.modifierLabels[os],
			user: UserSettingsLabelProvider.modifierLabels[os]
		};
	}

	fetch(searchValue: string, sortByPrecedence: boolean = false): IKeybindingItemEntry[] {
		let keybindingItems = sortByPrecedence ? this._keybindingItemsSortedByPrecedence : this._keybindingItems;

		const commandIdMatches = /@command:\s*(.+)/i.exec(searchValue);
		if (commandIdMatches && commandIdMatches[1]) {
			return keybindingItems.filter(k => k.command === commandIdMatches[1])
				.map(keybindingItem => (<IKeybindingItemEntry>{ id: KeybindingsEditorModel.getId(keybindingItem), keybindingItem, templateId: KEYBINDING_ENTRY_TEMPLATE_ID }));
		}

		if (/@source:\s*(user|default|extension)/i.test(searchValue)) {
			keybindingItems = this.filterBySource(keybindingItems, searchValue);
			searchValue = searchValue.replace(/@source:\s*(user|default|extension)/i, '');
		} else {
			const keybindingMatches = /@keybinding:\s*((\".+\")|(\S+))/i.exec(searchValue);
			if (keybindingMatches && (keybindingMatches[2] || keybindingMatches[3])) {
				searchValue = keybindingMatches[2] || `"${keybindingMatches[3]}"`;
			}
		}

		searchValue = searchValue.trim();
		if (!searchValue) {
			return keybindingItems.map(keybindingItem => (<IKeybindingItemEntry>{ id: KeybindingsEditorModel.getId(keybindingItem), keybindingItem, templateId: KEYBINDING_ENTRY_TEMPLATE_ID }));
		}

		return this.filterByText(keybindingItems, searchValue);
	}

	private filterBySource(keybindingItems: IKeybindingItem[], searchValue: string): IKeybindingItem[] {
		if (/@source:\s*default/i.test(searchValue)) {
			return keybindingItems.filter(k => k.source === SOURCE_DEFAULT);
		}
		if (/@source:\s*user/i.test(searchValue)) {
			return keybindingItems.filter(k => k.source === SOURCE_USER);
		}
		if (/@source:\s*extension/i.test(searchValue)) {
			return keybindingItems.filter(k => k.source === SOURCE_EXTENSION);
		}
		return keybindingItems;
	}

	private filterByText(keybindingItems: IKeybindingItem[], searchValue: string): IKeybindingItemEntry[] {
		const quoteAtFirstChar = searchValue.charAt(0) === '"';
		const quoteAtLastChar = searchValue.charAt(searchValue.length - 1) === '"';
		const completeMatch = quoteAtFirstChar && quoteAtLastChar;
		if (quoteAtFirstChar) {
			searchValue = searchValue.substring(1);
		}
		if (quoteAtLastChar) {
			searchValue = searchValue.substring(0, searchValue.length - 1);
		}
		searchValue = searchValue.trim();

		const result: IKeybindingItemEntry[] = [];
		const words = searchValue.split(' ');
		const keybindingWords = this.splitKeybindingWords(words);
		for (const keybindingItem of keybindingItems) {
			const keybindingMatches = new KeybindingItemMatches(this.modifierLabels, keybindingItem, searchValue, words, keybindingWords, completeMatch);
			if (keybindingMatches.commandIdMatches
				|| keybindingMatches.commandLabelMatches
				|| keybindingMatches.commandDefaultLabelMatches
				|| keybindingMatches.sourceMatches
				|| keybindingMatches.whenMatches
				|| keybindingMatches.keybindingMatches) {
				result.push({
					id: KeybindingsEditorModel.getId(keybindingItem),
					templateId: KEYBINDING_ENTRY_TEMPLATE_ID,
					commandLabelMatches: keybindingMatches.commandLabelMatches || undefined,
					commandDefaultLabelMatches: keybindingMatches.commandDefaultLabelMatches || undefined,
					keybindingItem,
					keybindingMatches: keybindingMatches.keybindingMatches || undefined,
					commandIdMatches: keybindingMatches.commandIdMatches || undefined,
					sourceMatches: keybindingMatches.sourceMatches || undefined,
					whenMatches: keybindingMatches.whenMatches || undefined
				});
			}
		}
		return result;
	}

	private splitKeybindingWords(wordsSeparatedBySpaces: string[]): string[] {
		const result: string[] = [];
		for (const word of wordsSeparatedBySpaces) {
			result.push(...coalesce(word.split('+')));
		}
		return result;
	}

	override async resolve(actionLabels = new Map<string, string>()): Promise<void> {
		const workbenchActionsRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);

		this._keybindingItemsSortedByPrecedence = [];
		const boundCommands: Map<string, boolean> = new Map<string, boolean>();
		for (const keybinding of this.keybindingsService.getKeybindings()) {
			if (keybinding.command) { // Skip keybindings without commands
				this._keybindingItemsSortedByPrecedence.push(KeybindingsEditorModel.toKeybindingEntry(keybinding.command, keybinding, workbenchActionsRegistry, actionLabels));
				boundCommands.set(keybinding.command, true);
			}
		}

		const commandsWithDefaultKeybindings = this.keybindingsService.getDefaultKeybindings().map(keybinding => keybinding.command);
		for (const command of getAllUnboundCommands(boundCommands)) {
			const keybindingItem = new ResolvedKeybindingItem(undefined, command, null, undefined, commandsWithDefaultKeybindings.indexOf(command) === -1, null, false);
			this._keybindingItemsSortedByPrecedence.push(KeybindingsEditorModel.toKeybindingEntry(command, keybindingItem, workbenchActionsRegistry, actionLabels));
		}
		this._keybindingItems = this._keybindingItemsSortedByPrecedence.slice(0).sort((a, b) => KeybindingsEditorModel.compareKeybindingData(a, b));
	}

	private static getId(keybindingItem: IKeybindingItem): string {
		return keybindingItem.command + (keybindingItem.keybinding ? keybindingItem.keybinding.getAriaLabel() : '') + keybindingItem.source + keybindingItem.when;
	}

	private static compareKeybindingData(a: IKeybindingItem, b: IKeybindingItem): number {
		if (a.keybinding && !b.keybinding) {
			return -1;
		}
		if (b.keybinding && !a.keybinding) {
			return 1;
		}
		if (a.commandLabel && !b.commandLabel) {
			return -1;
		}
		if (b.commandLabel && !a.commandLabel) {
			return 1;
		}
		if (a.commandLabel && b.commandLabel) {
			if (a.commandLabel !== b.commandLabel) {
				return a.commandLabel.localeCompare(b.commandLabel);
			}
		}
		if (a.command === b.command) {
			return a.keybindingItem.isDefault ? 1 : -1;
		}
		return a.command.localeCompare(b.command);
	}

	private static toKeybindingEntry(command: string, keybindingItem: ResolvedKeybindingItem, workbenchActionsRegistry: IWorkbenchActionRegistry, actions: Map<string, string>): IKeybindingItem {
		const menuCommand = MenuRegistry.getCommand(command)!;
		const editorActionLabel = actions.get(command)!;
		return <IKeybindingItem>{
			keybinding: keybindingItem.resolvedKeybinding,
			keybindingItem,
			command,
			commandLabel: KeybindingsEditorModel.getCommandLabel(menuCommand, editorActionLabel),
			commandDefaultLabel: KeybindingsEditorModel.getCommandDefaultLabel(menuCommand, workbenchActionsRegistry),
			when: keybindingItem.when ? keybindingItem.when.serialize() : '',
			source: (
				keybindingItem.extensionId
					? (keybindingItem.isBuiltinExtension ? SOURCE_DEFAULT : SOURCE_EXTENSION)
					: (keybindingItem.isDefault ? SOURCE_DEFAULT : SOURCE_USER)
			)
		};
	}

	private static getCommandDefaultLabel(menuCommand: ICommandAction, workbenchActionsRegistry: IWorkbenchActionRegistry): string | null {
		if (!Language.isDefaultVariant()) {
			if (menuCommand && menuCommand.title && (<ILocalizedString>menuCommand.title).original) {
				const category: string | undefined = menuCommand.category ? (<ILocalizedString>menuCommand.category).original : undefined;
				const title = (<ILocalizedString>menuCommand.title).original;
				return category ? localize('cat.title', "{0}: {1}", category, title) : title;
			}
		}
		return null;
	}

	private static getCommandLabel(menuCommand: ICommandAction, editorActionLabel: string): string {
		if (menuCommand) {
			const category: string | undefined = menuCommand.category ? typeof menuCommand.category === 'string' ? menuCommand.category : menuCommand.category.value : undefined;
			const title = typeof menuCommand.title === 'string' ? menuCommand.title : menuCommand.title.value;
			return category ? localize('cat.title', "{0}: {1}", category, title) : title;
		}

		if (editorActionLabel) {
			return editorActionLabel;
		}

		return '';
	}
}

class KeybindingItemMatches {

	readonly commandIdMatches: IMatch[] | null = null;
	readonly commandLabelMatches: IMatch[] | null = null;
	readonly commandDefaultLabelMatches: IMatch[] | null = null;
	readonly sourceMatches: IMatch[] | null = null;
	readonly whenMatches: IMatch[] | null = null;
	readonly keybindingMatches: KeybindingMatches | null = null;

	constructor(private modifierLabels: ModifierLabels, keybindingItem: IKeybindingItem, searchValue: string, words: string[], keybindingWords: string[], completeMatch: boolean) {
		if (!completeMatch) {
			this.commandIdMatches = this.matches(searchValue, keybindingItem.command, or(matchesWords, matchesCamelCase), words);
			this.commandLabelMatches = keybindingItem.commandLabel ? this.matches(searchValue, keybindingItem.commandLabel, (word, wordToMatchAgainst) => matchesWords(word, keybindingItem.commandLabel, true), words) : null;
			this.commandDefaultLabelMatches = keybindingItem.commandDefaultLabel ? this.matches(searchValue, keybindingItem.commandDefaultLabel, (word, wordToMatchAgainst) => matchesWords(word, keybindingItem.commandDefaultLabel, true), words) : null;
			this.sourceMatches = this.matches(searchValue, keybindingItem.source, (word, wordToMatchAgainst) => matchesWords(word, keybindingItem.source, true), words);
			this.whenMatches = keybindingItem.when ? this.matches(null, keybindingItem.when, or(matchesWords, matchesCamelCase), words) : null;
		}
		this.keybindingMatches = keybindingItem.keybinding ? this.matchesKeybinding(keybindingItem.keybinding, searchValue, keybindingWords, completeMatch) : null;
	}

	private matches(searchValue: string | null, wordToMatchAgainst: string, wordMatchesFilter: IFilter, words: string[]): IMatch[] | null {
		let matches = searchValue ? wordFilter(searchValue, wordToMatchAgainst) : null;
		if (!matches) {
			matches = this.matchesWords(words, wordToMatchAgainst, wordMatchesFilter);
		}
		if (matches) {
			matches = this.filterAndSort(matches);
		}
		return matches;
	}

	private matchesWords(words: string[], wordToMatchAgainst: string, wordMatchesFilter: IFilter): IMatch[] | null {
		let matches: IMatch[] | null = [];
		for (const word of words) {
			const wordMatches = wordMatchesFilter(word, wordToMatchAgainst);
			if (wordMatches) {
				matches = [...(matches || []), ...wordMatches];
			} else {
				matches = null;
				break;
			}
		}
		return matches;
	}

	private filterAndSort(matches: IMatch[]): IMatch[] {
		return distinct(matches, (a => a.start + '.' + a.end)).filter(match => !matches.some(m => !(m.start === match.start && m.end === match.end) && (m.start <= match.start && m.end >= match.end))).sort((a, b) => a.start - b.start);
	}

	private matchesKeybinding(keybinding: ResolvedKeybinding, searchValue: string, words: string[], completeMatch: boolean): KeybindingMatches | null {
		const [firstPart, chordPart] = keybinding.getParts();

		const userSettingsLabel = keybinding.getUserSettingsLabel();
		const ariaLabel = keybinding.getAriaLabel();
		const label = keybinding.getLabel();
		if ((userSettingsLabel && strings.compareIgnoreCase(searchValue, userSettingsLabel) === 0)
			|| (ariaLabel && strings.compareIgnoreCase(searchValue, ariaLabel) === 0)
			|| (label && strings.compareIgnoreCase(searchValue, label) === 0)) {
			return {
				firstPart: this.createCompleteMatch(firstPart),
				chordPart: this.createCompleteMatch(chordPart)
			};
		}

		const firstPartMatch: KeybindingMatch = {};
		let chordPartMatch: KeybindingMatch = {};

		const matchedWords: number[] = [];
		const firstPartMatchedWords: number[] = [];
		let chordPartMatchedWords: number[] = [];
		let matchFirstPart = true;
		for (let index = 0; index < words.length; index++) {
			const word = words[index];
			let firstPartMatched = false;
			let chordPartMatched = false;

			matchFirstPart = matchFirstPart && !firstPartMatch.keyCode;
			let matchChordPart = !chordPartMatch.keyCode;

			if (matchFirstPart) {
				firstPartMatched = this.matchPart(firstPart, firstPartMatch, word, completeMatch);
				if (firstPartMatch.keyCode) {
					for (const cordPartMatchedWordIndex of chordPartMatchedWords) {
						if (firstPartMatchedWords.indexOf(cordPartMatchedWordIndex) === -1) {
							matchedWords.splice(matchedWords.indexOf(cordPartMatchedWordIndex), 1);
						}
					}
					chordPartMatch = {};
					chordPartMatchedWords = [];
					matchChordPart = false;
				}
			}

			if (matchChordPart) {
				chordPartMatched = this.matchPart(chordPart, chordPartMatch, word, completeMatch);
			}

			if (firstPartMatched) {
				firstPartMatchedWords.push(index);
			}
			if (chordPartMatched) {
				chordPartMatchedWords.push(index);
			}
			if (firstPartMatched || chordPartMatched) {
				matchedWords.push(index);
			}

			matchFirstPart = matchFirstPart && this.isModifier(word);
		}
		if (matchedWords.length !== words.length) {
			return null;
		}
		if (completeMatch && (!this.isCompleteMatch(firstPart, firstPartMatch) || !this.isCompleteMatch(chordPart, chordPartMatch))) {
			return null;
		}
		return this.hasAnyMatch(firstPartMatch) || this.hasAnyMatch(chordPartMatch) ? { firstPart: firstPartMatch, chordPart: chordPartMatch } : null;
	}

	private matchPart(part: ResolvedKeybindingPart | null, match: KeybindingMatch, word: string, completeMatch: boolean): boolean {
		let matched = false;
		if (this.matchesMetaModifier(part, word)) {
			matched = true;
			match.metaKey = true;
		}
		if (this.matchesCtrlModifier(part, word)) {
			matched = true;
			match.ctrlKey = true;
		}
		if (this.matchesShiftModifier(part, word)) {
			matched = true;
			match.shiftKey = true;
		}
		if (this.matchesAltModifier(part, word)) {
			matched = true;
			match.altKey = true;
		}
		if (this.matchesKeyCode(part, word, completeMatch)) {
			match.keyCode = true;
			matched = true;
		}
		return matched;
	}

	private matchesKeyCode(keybinding: ResolvedKeybindingPart | null, word: string, completeMatch: boolean): boolean {
		if (!keybinding) {
			return false;
		}
		const ariaLabel: string = keybinding.keyAriaLabel || '';
		if (completeMatch || ariaLabel.length === 1 || word.length === 1) {
			if (strings.compareIgnoreCase(ariaLabel, word) === 0) {
				return true;
			}
		} else {
			if (matchesContiguousSubString(word, ariaLabel)) {
				return true;
			}
		}
		return false;
	}

	private matchesMetaModifier(keybinding: ResolvedKeybindingPart | null, word: string): boolean {
		if (!keybinding) {
			return false;
		}
		if (!keybinding.metaKey) {
			return false;
		}
		return this.wordMatchesMetaModifier(word);
	}

	private matchesCtrlModifier(keybinding: ResolvedKeybindingPart | null, word: string): boolean {
		if (!keybinding) {
			return false;
		}
		if (!keybinding.ctrlKey) {
			return false;
		}
		return this.wordMatchesCtrlModifier(word);
	}

	private matchesShiftModifier(keybinding: ResolvedKeybindingPart | null, word: string): boolean {
		if (!keybinding) {
			return false;
		}
		if (!keybinding.shiftKey) {
			return false;
		}
		return this.wordMatchesShiftModifier(word);
	}

	private matchesAltModifier(keybinding: ResolvedKeybindingPart | null, word: string): boolean {
		if (!keybinding) {
			return false;
		}
		if (!keybinding.altKey) {
			return false;
		}
		return this.wordMatchesAltModifier(word);
	}

	private hasAnyMatch(keybindingMatch: KeybindingMatch): boolean {
		return !!keybindingMatch.altKey ||
			!!keybindingMatch.ctrlKey ||
			!!keybindingMatch.metaKey ||
			!!keybindingMatch.shiftKey ||
			!!keybindingMatch.keyCode;
	}

	private isCompleteMatch(part: ResolvedKeybindingPart | null, match: KeybindingMatch): boolean {
		if (!part) {
			return true;
		}
		if (!match.keyCode) {
			return false;
		}
		if (part.metaKey && !match.metaKey) {
			return false;
		}
		if (part.altKey && !match.altKey) {
			return false;
		}
		if (part.ctrlKey && !match.ctrlKey) {
			return false;
		}
		if (part.shiftKey && !match.shiftKey) {
			return false;
		}
		return true;
	}

	private createCompleteMatch(part: ResolvedKeybindingPart | null): KeybindingMatch {
		const match: KeybindingMatch = {};
		if (part) {
			match.keyCode = true;
			if (part.metaKey) {
				match.metaKey = true;
			}
			if (part.altKey) {
				match.altKey = true;
			}
			if (part.ctrlKey) {
				match.ctrlKey = true;
			}
			if (part.shiftKey) {
				match.shiftKey = true;
			}
		}
		return match;
	}

	private isModifier(word: string): boolean {
		if (this.wordMatchesAltModifier(word)) {
			return true;
		}
		if (this.wordMatchesCtrlModifier(word)) {
			return true;
		}
		if (this.wordMatchesMetaModifier(word)) {
			return true;
		}
		if (this.wordMatchesShiftModifier(word)) {
			return true;
		}
		return false;
	}

	private wordMatchesAltModifier(word: string): boolean {
		if (strings.equalsIgnoreCase(this.modifierLabels.ui.altKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.aria.altKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.user.altKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(localize('option', "option"), word)) {
			return true;
		}
		return false;
	}

	private wordMatchesCtrlModifier(word: string): boolean {
		if (strings.equalsIgnoreCase(this.modifierLabels.ui.ctrlKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.aria.ctrlKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.user.ctrlKey, word)) {
			return true;
		}
		return false;
	}

	private wordMatchesMetaModifier(word: string): boolean {
		if (strings.equalsIgnoreCase(this.modifierLabels.ui.metaKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.aria.metaKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.user.metaKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(localize('meta', "meta"), word)) {
			return true;
		}
		return false;
	}

	private wordMatchesShiftModifier(word: string): boolean {
		if (strings.equalsIgnoreCase(this.modifierLabels.ui.shiftKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.aria.shiftKey, word)) {
			return true;
		}
		if (strings.equalsIgnoreCase(this.modifierLabels.user.shiftKey, word)) {
			return true;
		}
		return false;
	}
}
