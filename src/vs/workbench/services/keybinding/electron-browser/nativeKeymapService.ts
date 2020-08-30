/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nativeKeymap from 'native-keymap';
import { Disposable } from 'vs/base/common/lifecycle';
import { IKeymapService, IKeyboardLayoutInfo, IKeyboardMapping } from 'vs/workbench/services/keybinding/common/keymapInfo';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IKeyboardMapper, CachedKeyboardMapper } from 'vs/workbench/services/keybinding/common/keyboardMapper';
import { Emitter, Event } from 'vs/base/common/event';
import { DispatchConfig } from 'vs/workbench/services/keybinding/common/dispatchConfig';
import { MacLinuxFallbackKeyboardMapper } from 'vs/workbench/services/keybinding/common/macLinuxFallbackKeyboardMapper';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { WindowsKeyboardMapper, windowsKeyboardMappingEquals } from 'vs/workbench/services/keybinding/common/windowsKeyboardMapper';
import { MacLinuxKeyboardMapper, macLinuxKeyboardMappingEquals, IMacLinuxKeyboardMapping } from 'vs/workbench/services/keybinding/common/macLinuxKeyboardMapper';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';

export class KeyboardMapperFactory {
	public static readonly INSTANCE = new KeyboardMapperFactory();

	private _layoutInfo: nativeKeymap.IKeyboardLayoutInfo | null;
	private _rawMapping: nativeKeymap.IKeyboardMapping | null;
	private _keyboardMapper: IKeyboardMapper | null;
	private _initialized: boolean;

	private readonly _onDidChangeKeyboardMapper = new Emitter<void>();
	public readonly onDidChangeKeyboardMapper: Event<void> = this._onDidChangeKeyboardMapper.event;

	private constructor() {
		this._layoutInfo = null;
		this._rawMapping = null;
		this._keyboardMapper = null;
		this._initialized = false;
	}

	public _onKeyboardLayoutChanged(): void {
		if (this._initialized) {
			this._setKeyboardData(nativeKeymap.getCurrentKeyboardLayout(), nativeKeymap.getKeyMap());
		}
	}

	public getKeyboardMapper(dispatchConfig: DispatchConfig): IKeyboardMapper {
		if (!this._initialized) {
			this._setKeyboardData(nativeKeymap.getCurrentKeyboardLayout(), nativeKeymap.getKeyMap());
		}
		if (dispatchConfig === DispatchConfig.KeyCode) {
			// Forcefully set to use keyCode
			return new MacLinuxFallbackKeyboardMapper(OS);
		}
		return this._keyboardMapper!;
	}

	public getCurrentKeyboardLayout(): nativeKeymap.IKeyboardLayoutInfo | null {
		if (!this._initialized) {
			this._setKeyboardData(nativeKeymap.getCurrentKeyboardLayout(), nativeKeymap.getKeyMap());
		}
		return this._layoutInfo;
	}

	private static _isUSStandard(_kbInfo: nativeKeymap.IKeyboardLayoutInfo): boolean {
		if (OS === OperatingSystem.Linux) {
			const kbInfo = <nativeKeymap.ILinuxKeyboardLayoutInfo>_kbInfo;
			return (kbInfo && (kbInfo.layout === 'us' || /^us,/.test(kbInfo.layout)));
		}

		if (OS === OperatingSystem.Macintosh) {
			const kbInfo = <nativeKeymap.IMacKeyboardLayoutInfo>_kbInfo;
			return (kbInfo && kbInfo.id === 'com.apple.keylayout.US');
		}

		if (OS === OperatingSystem.Windows) {
			const kbInfo = <nativeKeymap.IWindowsKeyboardLayoutInfo>_kbInfo;
			return (kbInfo && kbInfo.name === '00000409');
		}

		return false;
	}

	public getRawKeyboardMapping(): nativeKeymap.IKeyboardMapping | null {
		if (!this._initialized) {
			this._setKeyboardData(nativeKeymap.getCurrentKeyboardLayout(), nativeKeymap.getKeyMap());
		}
		return this._rawMapping;
	}

	private _setKeyboardData(layoutInfo: nativeKeymap.IKeyboardLayoutInfo, rawMapping: nativeKeymap.IKeyboardMapping): void {
		this._layoutInfo = layoutInfo;

		if (this._initialized && KeyboardMapperFactory._equals(this._rawMapping, rawMapping)) {
			// nothing to do...
			return;
		}

		this._initialized = true;
		this._rawMapping = rawMapping;
		this._keyboardMapper = new CachedKeyboardMapper(
			KeyboardMapperFactory._createKeyboardMapper(this._layoutInfo, this._rawMapping)
		);
		this._onDidChangeKeyboardMapper.fire();
	}

	private static _createKeyboardMapper(layoutInfo: nativeKeymap.IKeyboardLayoutInfo, rawMapping: nativeKeymap.IKeyboardMapping): IKeyboardMapper {
		const isUSStandard = KeyboardMapperFactory._isUSStandard(layoutInfo);
		if (OS === OperatingSystem.Windows) {
			return new WindowsKeyboardMapper(isUSStandard, <nativeKeymap.IWindowsKeyboardMapping>rawMapping);
		}

		if (Object.keys(rawMapping).length === 0) {
			// Looks like reading the mappings failed (most likely Mac + Japanese/Chinese keyboard layouts)
			return new MacLinuxFallbackKeyboardMapper(OS);
		}

		if (OS === OperatingSystem.Macintosh) {
			const kbInfo = <nativeKeymap.IMacKeyboardLayoutInfo>layoutInfo;
			if (kbInfo.id === 'com.apple.keylayout.DVORAK-QWERTYCMD') {
				// Use keyCode based dispatching for DVORAK - QWERTY ⌘
				return new MacLinuxFallbackKeyboardMapper(OS);
			}
		}

		return new MacLinuxKeyboardMapper(isUSStandard, <IMacLinuxKeyboardMapping>rawMapping, OS);
	}

	private static _equals(a: nativeKeymap.IKeyboardMapping | null, b: nativeKeymap.IKeyboardMapping | null): boolean {
		if (OS === OperatingSystem.Windows) {
			return windowsKeyboardMappingEquals(<nativeKeymap.IWindowsKeyboardMapping>a, <nativeKeymap.IWindowsKeyboardMapping>b);
		}

		return macLinuxKeyboardMappingEquals(<IMacLinuxKeyboardMapping>a, <IMacLinuxKeyboardMapping>b);
	}
}

class NativeKeymapService extends Disposable implements IKeymapService {
	public _serviceBrand: undefined;

	private readonly _onDidChangeKeyboardMapper = new Emitter<void>();
	public readonly onDidChangeKeyboardMapper: Event<void> = this._onDidChangeKeyboardMapper.event;

	constructor() {
		super();

		this._register(KeyboardMapperFactory.INSTANCE.onDidChangeKeyboardMapper(() => {
			this._onDidChangeKeyboardMapper.fire();
		}));
	}

	getKeyboardMapper(dispatchConfig: DispatchConfig): IKeyboardMapper {
		return KeyboardMapperFactory.INSTANCE.getKeyboardMapper(dispatchConfig);
	}

	public getCurrentKeyboardLayout(): IKeyboardLayoutInfo | null {
		return KeyboardMapperFactory.INSTANCE.getCurrentKeyboardLayout();
	}

	getAllKeyboardLayouts(): IKeyboardLayoutInfo[] {
		return [];
	}

	public getRawKeyboardMapping(): IKeyboardMapping | null {
		return KeyboardMapperFactory.INSTANCE.getRawKeyboardMapping();
	}

	public validateCurrentKeyboardMapping(keyboardEvent: IKeyboardEvent): void {
		return;
	}
}

registerSingleton(IKeymapService, NativeKeymapService, true);
