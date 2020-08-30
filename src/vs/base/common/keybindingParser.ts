/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChordKeybinding, KeyCodeUtils, Keybinding, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OperatingSystem } from 'vs/base/common/platform';
import { ScanCodeBinding, ScanCodeUtils } from 'vs/base/common/scanCode';

export class KeybindingParser {

	private static _readModifiers(input: string) {
		input = input.toLowerCase().trim();

		let ctrl = false;
		let shift = false;
		let alt = false;
		let meta = false;

		let matchedModifier: boolean;

		do {
			matchedModifier = false;
			if (/^ctrl(\+|\-)/.test(input)) {
				ctrl = true;
				input = input.substr('ctrl-'.length);
				matchedModifier = true;
			}
			if (/^shift(\+|\-)/.test(input)) {
				shift = true;
				input = input.substr('shift-'.length);
				matchedModifier = true;
			}
			if (/^alt(\+|\-)/.test(input)) {
				alt = true;
				input = input.substr('alt-'.length);
				matchedModifier = true;
			}
			if (/^meta(\+|\-)/.test(input)) {
				meta = true;
				input = input.substr('meta-'.length);
				matchedModifier = true;
			}
			if (/^win(\+|\-)/.test(input)) {
				meta = true;
				input = input.substr('win-'.length);
				matchedModifier = true;
			}
			if (/^cmd(\+|\-)/.test(input)) {
				meta = true;
				input = input.substr('cmd-'.length);
				matchedModifier = true;
			}
		} while (matchedModifier);

		let key: string;

		const firstSpaceIdx = input.indexOf(' ');
		if (firstSpaceIdx > 0) {
			key = input.substring(0, firstSpaceIdx);
			input = input.substring(firstSpaceIdx);
		} else {
			key = input;
			input = '';
		}

		return {
			remains: input,
			ctrl,
			shift,
			alt,
			meta,
			key
		};
	}

	private static parseSimpleKeybinding(input: string): [SimpleKeybinding, string] {
		const mods = this._readModifiers(input);
		const keyCode = KeyCodeUtils.fromUserSettings(mods.key);
		return [new SimpleKeybinding(mods.ctrl, mods.shift, mods.alt, mods.meta, keyCode), mods.remains];
	}

	public static parseKeybinding(input: string, OS: OperatingSystem): Keybinding | null {
		if (!input) {
			return null;
		}

		const parts: SimpleKeybinding[] = [];
		let part: SimpleKeybinding;

		do {
			[part, input] = this.parseSimpleKeybinding(input);
			parts.push(part);
		} while (input.length > 0);
		return new ChordKeybinding(parts);
	}

	private static parseSimpleUserBinding(input: string): [SimpleKeybinding | ScanCodeBinding, string] {
		const mods = this._readModifiers(input);
		const scanCodeMatch = mods.key.match(/^\[([^\]]+)\]$/);
		if (scanCodeMatch) {
			const strScanCode = scanCodeMatch[1];
			const scanCode = ScanCodeUtils.lowerCaseToEnum(strScanCode);
			return [new ScanCodeBinding(mods.ctrl, mods.shift, mods.alt, mods.meta, scanCode), mods.remains];
		}
		const keyCode = KeyCodeUtils.fromUserSettings(mods.key);
		return [new SimpleKeybinding(mods.ctrl, mods.shift, mods.alt, mods.meta, keyCode), mods.remains];
	}

	static parseUserBinding(input: string): (SimpleKeybinding | ScanCodeBinding)[] {
		if (!input) {
			return [];
		}

		const parts: (SimpleKeybinding | ScanCodeBinding)[] = [];
		let part: SimpleKeybinding | ScanCodeBinding;

		while (input.length > 0) {
			[part, input] = this.parseSimpleUserBinding(input);
			parts.push(part);
		}
		return parts;
	}
}
