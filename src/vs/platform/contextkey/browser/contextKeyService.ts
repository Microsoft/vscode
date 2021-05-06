/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event, PauseableEmitter } from 'vs/base/common/event';
import { Iterable } from 'vs/base/common/iterator';
import { IDisposable, DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { TernarySearchTree } from 'vs/base/common/map';
import { distinct } from 'vs/base/common/objects';
import { localize } from 'vs/nls';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContext, IContextKey, IContextKeyChangeEvent, IContextKeyService, IContextKeyServiceTarget, IReadableSet, SET_CONTEXT_COMMAND_ID, ContextKeyExpression, RawContextKey, ContextKeyInfo } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingResolver } from 'vs/platform/keybinding/common/keybindingResolver';

const KEYBINDING_CONTEXT_ATTR = 'data-keybinding-context';

export class Context implements IContext {

	protected _parent: Context | null;
	protected _value: { [key: string]: any; };
	protected _id: number;

	constructor(id: number, parent: Context | null) {
		this._id = id;
		this._parent = parent;
		this._value = Object.create(null);
		this._value['_contextId'] = id;
	}

	public setValue(key: string, value: any): boolean {
		// console.log('SET ' + key + ' = ' + value + ' ON ' + this._id);
		if (this._value[key] !== value) {
			this._value[key] = value;
			return true;
		}
		return false;
	}

	public removeValue(key: string): boolean {
		// console.log('REMOVE ' + key + ' FROM ' + this._id);
		if (key in this._value) {
			delete this._value[key];
			return true;
		}
		return false;
	}

	public getValue<T>(key: string): T | undefined {
		const ret = this._value[key];
		if (typeof ret === 'undefined' && this._parent) {
			return this._parent.getValue<T>(key);
		}
		return ret;
	}

	public updateParent(parent: Context): void {
		this._parent = parent;
	}

	public collectAllValues(): { [key: string]: any; } {
		let result = this._parent ? this._parent.collectAllValues() : Object.create(null);
		result = { ...result, ...this._value };
		delete result['_contextId'];
		return result;
	}
}

class NullContext extends Context {

	static readonly INSTANCE = new NullContext();

	constructor() {
		super(-1, null);
	}

	public override setValue(key: string, value: any): boolean {
		return false;
	}

	public override removeValue(key: string): boolean {
		return false;
	}

	public override getValue<T>(key: string): T | undefined {
		return undefined;
	}

	override collectAllValues(): { [key: string]: any; } {
		return Object.create(null);
	}
}

class ConfigAwareContextValuesContainer extends Context {
	private static readonly _keyPrefix = 'config.';

	private readonly _values = TernarySearchTree.forConfigKeys<any>();
	private readonly _listener: IDisposable;

	constructor(
		id: number,
		private readonly _configurationService: IConfigurationService,
		emitter: Emitter<IContextKeyChangeEvent>
	) {
		super(id, null);

		this._listener = this._configurationService.onDidChangeConfiguration(event => {
			if (event.source === ConfigurationTarget.DEFAULT) {
				// new setting, reset everything
				const allKeys = Array.from(Iterable.map(this._values, ([k]) => k));
				this._values.clear();
				emitter.fire(new ArrayContextKeyChangeEvent(allKeys));
			} else {
				const changedKeys: string[] = [];
				for (const configKey of event.affectedKeys) {
					const contextKey = `config.${configKey}`;

					const cachedItems = this._values.findSuperstr(contextKey);
					if (cachedItems !== undefined) {
						changedKeys.push(...Iterable.map(cachedItems, ([key]) => key));
						this._values.deleteSuperstr(contextKey);
					}

					if (this._values.has(contextKey)) {
						changedKeys.push(contextKey);
						this._values.delete(contextKey);
					}
				}

				emitter.fire(new ArrayContextKeyChangeEvent(changedKeys));
			}
		});
	}

	dispose(): void {
		this._listener.dispose();
	}

	override getValue(key: string): any {

		if (key.indexOf(ConfigAwareContextValuesContainer._keyPrefix) !== 0) {
			return super.getValue(key);
		}

		if (this._values.has(key)) {
			return this._values.get(key);
		}

		const configKey = key.substr(ConfigAwareContextValuesContainer._keyPrefix.length);
		const configValue = this._configurationService.getValue(configKey);
		let value: any = undefined;
		switch (typeof configValue) {
			case 'number':
			case 'boolean':
			case 'string':
				value = configValue;
				break;
			default:
				if (Array.isArray(configValue)) {
					value = JSON.stringify(configValue);
				} else {
					value = configValue;
				}
		}

		this._values.set(key, value);
		return value;
	}

	override setValue(key: string, value: any): boolean {
		return super.setValue(key, value);
	}

	override removeValue(key: string): boolean {
		return super.removeValue(key);
	}

	override collectAllValues(): { [key: string]: any; } {
		const result: { [key: string]: any } = Object.create(null);
		this._values.forEach((value, index) => result[index] = value);
		return { ...result, ...super.collectAllValues() };
	}
}

class ContextKey<T> implements IContextKey<T> {

	private _service: AbstractContextKeyService;
	private _key: string;
	private _defaultValue: T | undefined;

	constructor(service: AbstractContextKeyService, key: string, defaultValue: T | undefined) {
		this._service = service;
		this._key = key;
		this._defaultValue = defaultValue;
		this.reset();
	}

	public set(value: T): void {
		this._service.setContext(this._key, value);
	}

	public reset(): void {
		if (typeof this._defaultValue === 'undefined') {
			this._service.removeContext(this._key);
		} else {
			this._service.setContext(this._key, this._defaultValue);
		}
	}

	public get(): T | undefined {
		return this._service.getContextKeyValue<T>(this._key);
	}
}

class SimpleContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly key: string) { }
	affectsSome(keys: IReadableSet<string>): boolean {
		return keys.has(this.key);
	}
}

class ArrayContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly keys: string[]) { }
	affectsSome(keys: IReadableSet<string>): boolean {
		for (const key of this.keys) {
			if (keys.has(key)) {
				return true;
			}
		}
		return false;
	}
}

class CompositeContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly events: IContextKeyChangeEvent[]) { }
	affectsSome(keys: IReadableSet<string>): boolean {
		for (const e of this.events) {
			if (e.affectsSome(keys)) {
				return true;
			}
		}
		return false;
	}
}

export abstract class AbstractContextKeyService implements IContextKeyService {
	declare _serviceBrand: undefined;

	protected _isDisposed: boolean;
	protected _myContextId: number;

	protected _onDidChangeContext = new PauseableEmitter<IContextKeyChangeEvent>({ merge: input => new CompositeContextKeyChangeEvent(input) });
	readonly onDidChangeContext = this._onDidChangeContext.event;

	constructor(myContextId: number) {
		this._isDisposed = false;
		this._myContextId = myContextId;
	}

	public get contextId(): number {
		return this._myContextId;
	}

	abstract dispose(): void;

	public createKey<T>(key: string, defaultValue: T | undefined): IContextKey<T> {
		if (this._isDisposed) {
			throw new Error(`AbstractContextKeyService has been disposed`);
		}
		return new ContextKey(this, key, defaultValue);
	}


	bufferChangeEvents(callback: Function): void {
		this._onDidChangeContext.pause();
		try {
			callback();
		} finally {
			this._onDidChangeContext.resume();
		}
	}

	public createScoped(domNode: IContextKeyServiceTarget): IContextKeyService {
		if (this._isDisposed) {
			throw new Error(`AbstractContextKeyService has been disposed`);
		}
		return new ScopedContextKeyService(this, domNode);
	}

	createOverlay(overlay: Iterable<[string, any]> = Iterable.empty()): IContextKeyService {
		if (this._isDisposed) {
			throw new Error(`AbstractContextKeyService has been disposed`);
		}
		return new OverlayContextKeyService(this, overlay);
	}

	public contextMatchesRules(rules: ContextKeyExpression | undefined): boolean {
		if (this._isDisposed) {
			throw new Error(`AbstractContextKeyService has been disposed`);
		}
		const context = this.getContextValuesContainer(this._myContextId);
		const result = KeybindingResolver.contextMatchesRules(context, rules);
		// console.group(rules.serialize() + ' -> ' + result);
		// rules.keys().forEach(key => { console.log(key, ctx[key]); });
		// console.groupEnd();
		return result;
	}

	public getContextKeyValue<T>(key: string): T | undefined {
		if (this._isDisposed) {
			return undefined;
		}
		return this.getContextValuesContainer(this._myContextId).getValue<T>(key);
	}

	public setContext(key: string, value: any): void {
		if (this._isDisposed) {
			return;
		}
		const myContext = this.getContextValuesContainer(this._myContextId);
		if (!myContext) {
			return;
		}
		if (myContext.setValue(key, value)) {
			this._onDidChangeContext.fire(new SimpleContextKeyChangeEvent(key));
		}
	}

	public removeContext(key: string): void {
		if (this._isDisposed) {
			return;
		}
		if (this.getContextValuesContainer(this._myContextId).removeValue(key)) {
			this._onDidChangeContext.fire(new SimpleContextKeyChangeEvent(key));
		}
	}

	public getContext(target: IContextKeyServiceTarget | null): IContext {
		if (this._isDisposed) {
			return NullContext.INSTANCE;
		}
		return this.getContextValuesContainer(findContextAttr(target));
	}

	public abstract getContextValuesContainer(contextId: number): Context;
	public abstract createChildContext(parentContextId?: number): number;
	public abstract disposeContext(contextId: number): void;
	public abstract updateParent(parentContextKeyService?: IContextKeyService): void;
}

export class ContextKeyService extends AbstractContextKeyService implements IContextKeyService {

	private _lastContextId: number;
	private readonly _contexts = new Map<number, Context>();

	private readonly _toDispose = new DisposableStore();

	constructor(@IConfigurationService configurationService: IConfigurationService) {
		super(0);
		this._lastContextId = 0;


		const myContext = new ConfigAwareContextValuesContainer(this._myContextId, configurationService, this._onDidChangeContext);
		this._contexts.set(this._myContextId, myContext);
		this._toDispose.add(myContext);

		// Uncomment this to see the contexts continuously logged
		// let lastLoggedValue: string | null = null;
		// setInterval(() => {
		// 	let values = Object.keys(this._contexts).map((key) => this._contexts[key]);
		// 	let logValue = values.map(v => JSON.stringify(v._value, null, '\t')).join('\n');
		// 	if (lastLoggedValue !== logValue) {
		// 		lastLoggedValue = logValue;
		// 		console.log(lastLoggedValue);
		// 	}
		// }, 2000);
	}

	public dispose(): void {
		this._onDidChangeContext.dispose();
		this._isDisposed = true;
		this._toDispose.dispose();
	}

	public getContextValuesContainer(contextId: number): Context {
		if (this._isDisposed) {
			return NullContext.INSTANCE;
		}
		return this._contexts.get(contextId) || NullContext.INSTANCE;
	}

	public createChildContext(parentContextId: number = this._myContextId): number {
		if (this._isDisposed) {
			throw new Error(`ContextKeyService has been disposed`);
		}
		let id = (++this._lastContextId);
		this._contexts.set(id, new Context(id, this.getContextValuesContainer(parentContextId)));
		return id;
	}

	public disposeContext(contextId: number): void {
		if (!this._isDisposed) {
			this._contexts.delete(contextId);
		}
	}

	public updateParent(_parentContextKeyService: IContextKeyService): void {
		throw new Error('Cannot update parent of root ContextKeyService');
	}
}

class ScopedContextKeyService extends AbstractContextKeyService {

	private _parent: AbstractContextKeyService;
	private _domNode: IContextKeyServiceTarget;

	private readonly _parentChangeListener = new MutableDisposable();

	constructor(parent: AbstractContextKeyService, domNode: IContextKeyServiceTarget) {
		super(parent.createChildContext());
		this._parent = parent;
		this._updateParentChangeListener();

		this._domNode = domNode;
		if (this._domNode.hasAttribute(KEYBINDING_CONTEXT_ATTR)) {
			let extraInfo = '';
			if ((this._domNode as HTMLElement).classList) {
				extraInfo = Array.from((this._domNode as HTMLElement).classList.values()).join(', ');
			}

			console.error(`Element already has context attribute${extraInfo ? ': ' + extraInfo : ''}`);
		}
		this._domNode.setAttribute(KEYBINDING_CONTEXT_ATTR, String(this._myContextId));
	}

	private _updateParentChangeListener(): void {
		// Forward parent events to this listener. Parent will change.
		this._parentChangeListener.value = this._parent.onDidChangeContext(this._onDidChangeContext.fire, this._onDidChangeContext);
	}

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}

		this._onDidChangeContext.dispose();
		this._parent.disposeContext(this._myContextId);
		this._parentChangeListener.dispose();
		this._domNode.removeAttribute(KEYBINDING_CONTEXT_ATTR);
		this._isDisposed = true;
	}

	public getContextValuesContainer(contextId: number): Context {
		if (this._isDisposed) {
			return NullContext.INSTANCE;
		}
		return this._parent.getContextValuesContainer(contextId);
	}

	public createChildContext(parentContextId: number = this._myContextId): number {
		if (this._isDisposed) {
			throw new Error(`ScopedContextKeyService has been disposed`);
		}
		return this._parent.createChildContext(parentContextId);
	}

	public disposeContext(contextId: number): void {
		if (this._isDisposed) {
			return;
		}
		this._parent.disposeContext(contextId);
	}

	public updateParent(parentContextKeyService: AbstractContextKeyService): void {
		const thisContainer = this._parent.getContextValuesContainer(this._myContextId);
		const oldAllValues = thisContainer.collectAllValues();
		this._parent = parentContextKeyService;
		this._updateParentChangeListener();
		const newParentContainer = this._parent.getContextValuesContainer(this._parent.contextId);
		thisContainer.updateParent(newParentContainer);

		const newAllValues = thisContainer.collectAllValues();
		const allValuesDiff = {
			...distinct(oldAllValues, newAllValues),
			...distinct(newAllValues, oldAllValues)
		};
		const changedKeys = Object.keys(allValuesDiff);

		this._onDidChangeContext.fire(new ArrayContextKeyChangeEvent(changedKeys));
	}
}

class OverlayContext implements IContext {

	constructor(private parent: IContext, private overlay: ReadonlyMap<string, any>) { }

	getValue<T>(key: string): T | undefined {
		return this.overlay.has(key) ? this.overlay.get(key) : this.parent.getValue(key);
	}
}

class OverlayContextKeyService implements IContextKeyService {

	declare _serviceBrand: undefined;
	private overlay: Map<string, any>;

	get contextId(): number {
		return this.parent.contextId;
	}

	get onDidChangeContext(): Event<IContextKeyChangeEvent> {
		return this.parent.onDidChangeContext;
	}

	constructor(private parent: AbstractContextKeyService | OverlayContextKeyService, overlay: Iterable<[string, any]>) {
		this.overlay = new Map(overlay);
	}

	bufferChangeEvents(callback: Function): void {
		this.parent.bufferChangeEvents(callback);
	}

	createKey<T>(): IContextKey<T> {
		throw new Error('Not supported.');
	}

	getContext(target: IContextKeyServiceTarget | null): IContext {
		return new OverlayContext(this.parent.getContext(target), this.overlay);
	}

	getContextValuesContainer(contextId: number): IContext {
		const parentContext = this.parent.getContextValuesContainer(contextId);
		return new OverlayContext(parentContext, this.overlay);
	}

	contextMatchesRules(rules: ContextKeyExpression | undefined): boolean {
		const context = this.getContextValuesContainer(this.contextId);
		const result = KeybindingResolver.contextMatchesRules(context, rules);
		return result;
	}

	getContextKeyValue<T>(key: string): T | undefined {
		return this.overlay.has(key) ? this.overlay.get(key) : this.parent.getContextKeyValue(key);
	}

	createScoped(): IContextKeyService {
		throw new Error('Not supported.');
	}

	createOverlay(overlay: Iterable<[string, any]> = Iterable.empty()): IContextKeyService {
		return new OverlayContextKeyService(this, overlay);
	}

	updateParent(): void {
		throw new Error('Not supported.');
	}

	dispose(): void {
		// noop
	}
}

function findContextAttr(domNode: IContextKeyServiceTarget | null): number {
	while (domNode) {
		if (domNode.hasAttribute(KEYBINDING_CONTEXT_ATTR)) {
			const attr = domNode.getAttribute(KEYBINDING_CONTEXT_ATTR);
			if (attr) {
				return parseInt(attr, 10);
			}
			return NaN;
		}
		domNode = domNode.parentElement;
	}
	return 0;
}

CommandsRegistry.registerCommand(SET_CONTEXT_COMMAND_ID, function (accessor, contextKey: any, contextValue: any) {
	accessor.get(IContextKeyService).createKey(String(contextKey), contextValue);
});

CommandsRegistry.registerCommand({
	id: 'getContextKeyInfo',
	handler() {
		return [...RawContextKey.all()].sort((a, b) => a.key.localeCompare(b.key));
	},
	description: {
		description: localize('getContextKeyInfo', "A command that returns information about context keys"),
		args: []
	}
});

CommandsRegistry.registerCommand('_generateContextKeyInfo', function () {
	const result: ContextKeyInfo[] = [];
	const seen = new Set<string>();
	for (let info of RawContextKey.all()) {
		if (!seen.has(info.key)) {
			seen.add(info.key);
			result.push(info);
		}
	}
	result.sort((a, b) => a.key.localeCompare(b.key));
	console.log(JSON.stringify(result, undefined, 2));
});
