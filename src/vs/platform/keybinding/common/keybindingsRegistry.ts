/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, Keybinding, SimpleKeybinding, createKeybinding } from 'vs/base/common/keyCodes';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { CommandsRegistry, ICommandHandler, ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';

export interface IKeybindingItem {
	keybinding: Keybinding;
	command: string;
	commandArgs?: any;
	when: ContextKeyExpression | null | undefined;
	weight1: number;
	weight2: number;
	extensionId: string | null;
	isBuiltinExtension: boolean;
}

export interface IKeybindings {
	primary?: number;
	secondary?: number[];
	win?: {
		primary: number;
		secondary?: number[];
	};
	linux?: {
		primary: number;
		secondary?: number[];
	};
	mac?: {
		primary: number;
		secondary?: number[];
	};
}

export interface IKeybindingRule extends IKeybindings {
	id: string;
	weight: number;
	args?: any;
	when?: ContextKeyExpression | null | undefined;
}

export interface IKeybindingRule2 {
	primary: Keybinding | null;
	win?: { primary: Keybinding | null; } | null;
	linux?: { primary: Keybinding | null; } | null;
	mac?: { primary: Keybinding | null; } | null;
	id: string;
	args?: any;
	weight: number;
	when: ContextKeyExpression | undefined;
	extensionId?: string;
	isBuiltinExtension?: boolean;
}

export const enum KeybindingWeight {
	EditorCore = 0,
	EditorContrib = 100,
	WorkbenchContrib = 200,
	BuiltinExtension = 300,
	ExternalExtension = 400
}

export interface ICommandAndKeybindingRule extends IKeybindingRule {
	handler: ICommandHandler;
	description?: ICommandHandlerDescription | null;
}

export interface IKeybindingsRegistry {
	registerKeybindingRule(rule: IKeybindingRule): void;
	setExtensionKeybindings(rules: IKeybindingRule2[]): void;
	registerCommandAndKeybindingRule(desc: ICommandAndKeybindingRule): void;
	getDefaultKeybindings(): IKeybindingItem[];
}

class KeybindingsRegistryImpl implements IKeybindingsRegistry {

	private _coreKeybindings: IKeybindingItem[];
	private _extensionKeybindings: IKeybindingItem[];
	private _cachedMergedKeybindings: IKeybindingItem[] | null;

	constructor() {
		this._coreKeybindings = [];
		this._extensionKeybindings = [];
		this._cachedMergedKeybindings = null;
	}

	/**
	 * Take current platform into account and reduce to primary & secondary.
	 */
	private static bindToCurrentPlatform(kb: IKeybindings): { primary?: number; secondary?: number[]; } {
		if (OS === OperatingSystem.Windows) {
			if (kb && kb.win) {
				return kb.win;
			}
		} else if (OS === OperatingSystem.Macintosh) {
			if (kb && kb.mac) {
				return kb.mac;
			}
		} else {
			if (kb && kb.linux) {
				return kb.linux;
			}
		}

		return kb;
	}

	/**
	 * Take current platform into account and reduce to primary & secondary.
	 */
	private static bindToCurrentPlatform2(kb: IKeybindingRule2): { primary?: Keybinding | null; } {
		if (OS === OperatingSystem.Windows) {
			if (kb && kb.win) {
				return kb.win;
			}
		} else if (OS === OperatingSystem.Macintosh) {
			if (kb && kb.mac) {
				return kb.mac;
			}
		} else {
			if (kb && kb.linux) {
				return kb.linux;
			}
		}

		return kb;
	}

	public registerKeybindingRule(rule: IKeybindingRule): void {
		const actualKb = KeybindingsRegistryImpl.bindToCurrentPlatform(rule);

		if (actualKb && actualKb.primary) {
			const kk = createKeybinding(actualKb.primary, OS);
			if (kk) {
				this._registerDefaultKeybinding(kk, rule.id, rule.args, rule.weight, 0, rule.when);
			}
		}

		if (actualKb && Array.isArray(actualKb.secondary)) {
			for (let i = 0, len = actualKb.secondary.length; i < len; i++) {
				const k = actualKb.secondary[i];
				const kk = createKeybinding(k, OS);
				if (kk) {
					this._registerDefaultKeybinding(kk, rule.id, rule.args, rule.weight, -i - 1, rule.when);
				}
			}
		}
	}

	public setExtensionKeybindings(rules: IKeybindingRule2[]): void {
		let result: IKeybindingItem[] = [], keybindingsLen = 0;
		for (let i = 0, len = rules.length; i < len; i++) {
			const rule = rules[i];
			let actualKb = KeybindingsRegistryImpl.bindToCurrentPlatform2(rule);

			if (actualKb && actualKb.primary) {
				result[keybindingsLen++] = {
					keybinding: actualKb.primary,
					command: rule.id,
					commandArgs: rule.args,
					when: rule.when,
					weight1: rule.weight,
					weight2: 0,
					extensionId: rule.extensionId || null,
					isBuiltinExtension: rule.isBuiltinExtension || false
				};
			}
		}

		this._extensionKeybindings = result;
		this._cachedMergedKeybindings = null;
	}

	public registerCommandAndKeybindingRule(desc: ICommandAndKeybindingRule): void {
		this.registerKeybindingRule(desc);
		CommandsRegistry.registerCommand(desc);
	}

	private static _mightProduceChar(keyCode: KeyCode): boolean {
		if (keyCode >= KeyCode.KEY_0 && keyCode <= KeyCode.KEY_9) {
			return true;
		}
		if (keyCode >= KeyCode.KEY_A && keyCode <= KeyCode.KEY_Z) {
			return true;
		}
		return (
			keyCode === KeyCode.US_SEMICOLON
			|| keyCode === KeyCode.US_EQUAL
			|| keyCode === KeyCode.US_COMMA
			|| keyCode === KeyCode.US_MINUS
			|| keyCode === KeyCode.US_DOT
			|| keyCode === KeyCode.US_SLASH
			|| keyCode === KeyCode.US_BACKTICK
			|| keyCode === KeyCode.ABNT_C1
			|| keyCode === KeyCode.ABNT_C2
			|| keyCode === KeyCode.US_OPEN_SQUARE_BRACKET
			|| keyCode === KeyCode.US_BACKSLASH
			|| keyCode === KeyCode.US_CLOSE_SQUARE_BRACKET
			|| keyCode === KeyCode.US_QUOTE
			|| keyCode === KeyCode.OEM_8
			|| keyCode === KeyCode.OEM_102
		);
	}

	private _assertNoCtrlAlt(keybinding: SimpleKeybinding, commandId: string): void {
		if (keybinding.ctrlKey && keybinding.altKey && !keybinding.metaKey) {
			if (KeybindingsRegistryImpl._mightProduceChar(keybinding.keyCode)) {
				console.warn('Ctrl+Alt+ keybindings should not be used by default under Windows. Offender: ', keybinding, ' for ', commandId);
			}
		}
	}

	private _registerDefaultKeybinding(keybinding: Keybinding, commandId: string, commandArgs: any, weight1: number, weight2: number, when: ContextKeyExpression | null | undefined): void {
		if (OS === OperatingSystem.Windows) {
			this._assertNoCtrlAlt(keybinding.parts[0], commandId);
		}
		this._coreKeybindings.push({
			keybinding: keybinding,
			command: commandId,
			commandArgs: commandArgs,
			when: when,
			weight1: weight1,
			weight2: weight2,
			extensionId: null,
			isBuiltinExtension: false
		});
		this._cachedMergedKeybindings = null;
	}

	public getDefaultKeybindings(): IKeybindingItem[] {
		if (!this._cachedMergedKeybindings) {
			this._cachedMergedKeybindings = (<IKeybindingItem[]>[]).concat(this._coreKeybindings).concat(this._extensionKeybindings);
			this._cachedMergedKeybindings.sort(sorter);
		}
		return this._cachedMergedKeybindings.slice(0);
	}
}
export const KeybindingsRegistry: IKeybindingsRegistry = new KeybindingsRegistryImpl();

// Define extension point ids
export const Extensions = {
	EditorModes: 'platform.keybindingsRegistry'
};
Registry.add(Extensions.EditorModes, KeybindingsRegistry);

function sorter(a: IKeybindingItem, b: IKeybindingItem): number {
	if (a.weight1 !== b.weight1) {
		return a.weight1 - b.weight1;
	}
	if (a.command < b.command) {
		return -1;
	}
	if (a.command > b.command) {
		return 1;
	}
	return a.weight2 - b.weight2;
}
