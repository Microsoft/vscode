/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Keybinding, ResolvedKeybinding, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OS } from 'vs/base/common/platform';
import { IContextKey, IContextKeyChangeEvent, IContextKeyService, IContextKeyServiceTarget, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingEvent, IKeybindingService, IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { IResolveResult } from 'vs/platform/keybinding/common/keybindingResolver';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';

class MockKeybindingContextKey<T> implements IContextKey<T> {
	private _defaultValue: T | undefined;
	private _value: T | undefined;

	constructor(defaultValue: T | undefined) {
		this._defaultValue = defaultValue;
		this._value = this._defaultValue;
	}

	public set(value: T | undefined): void {
		this._value = value;
	}

	public reset(): void {
		this._value = this._defaultValue;
	}

	public get(): T | undefined {
		return this._value;
	}
}

export class MockContextKeyService implements IContextKeyService {

	public _serviceBrand: undefined;
	private _keys = new Map<string, IContextKey<any>>();

	public dispose(): void {
		//
	}
	public createKey<T>(key: string, defaultValue: T | undefined): IContextKey<T> {
		let ret = new MockKeybindingContextKey(defaultValue);
		this._keys.set(key, ret);
		return ret;
	}
	public contextMatchesRules(rules: ContextKeyExpression): boolean {
		return false;
	}
	public get onDidChangeContext(): Event<IContextKeyChangeEvent> {
		return Event.None;
	}
	public bufferChangeEvents(callback: () => void) { callback(); }
	public getContextKeyValue(key: string) {
		const value = this._keys.get(key);
		if (value) {
			return value.get();
		}
	}
	public getContext(domNode: HTMLElement): any {
		return null;
	}
	public createScoped(domNode: HTMLElement): IContextKeyService {
		return this;
	}
	public createOverlay(): IContextKeyService {
		return this;
	}
	updateParent(_parentContextKeyService: IContextKeyService): void {
		// no-op
	}
}

export class MockScopableContextKeyService extends MockContextKeyService {
	/**
	 * Don't implement this for all tests since we rarely depend on this behavior and it isn't implemented fully
	 */
	public override createScoped(domNote: HTMLElement): IContextKeyService {
		return new MockContextKeyService();
	}
}

export class MockKeybindingService implements IKeybindingService {
	public _serviceBrand: undefined;

	public readonly inChordMode: boolean = false;

	public get onDidUpdateKeybindings(): Event<IKeybindingEvent> {
		return Event.None;
	}

	public getDefaultKeybindingsContent(): string {
		return '';
	}

	public getDefaultKeybindings(): ResolvedKeybindingItem[] {
		return [];
	}

	public getKeybindings(): ResolvedKeybindingItem[] {
		return [];
	}

	public resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[] {
		return [new USLayoutResolvedKeybinding(keybinding, OS)];
	}

	public resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding {
		let keybinding = new SimpleKeybinding(
			keyboardEvent.ctrlKey,
			keyboardEvent.shiftKey,
			keyboardEvent.altKey,
			keyboardEvent.metaKey,
			keyboardEvent.keyCode
		);
		return this.resolveKeybinding(keybinding.toChord())[0];
	}

	public resolveUserBinding(userBinding: string): ResolvedKeybinding[] {
		return [];
	}

	public lookupKeybindings(commandId: string): ResolvedKeybinding[] {
		return [];
	}

	public lookupKeybinding(commandId: string): ResolvedKeybinding | undefined {
		return undefined;
	}

	public customKeybindingsCount(): number {
		return 0;
	}

	public softDispatch(keybinding: IKeyboardEvent, target: IContextKeyServiceTarget): IResolveResult | null {
		return null;
	}

	public dispatchByUserSettingsLabel(userSettingsLabel: string, target: IContextKeyServiceTarget): void {

	}

	public dispatchEvent(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		return false;
	}

	public mightProducePrintableCharacter(e: IKeyboardEvent): boolean {
		return false;
	}

	public toggleLogging(): boolean {
		return false;
	}

	public _dumpDebugInfo(): string {
		return '';
	}

	public _dumpDebugInfoJSON(): string {
		return '';
	}

	public registerSchemaContribution() {
		// noop
	}
}
