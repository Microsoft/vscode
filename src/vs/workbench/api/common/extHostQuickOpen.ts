/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asPromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { IExtHostWorkspaceProvider } from 'vs/workbench/api/common/extHostWorkspace';
import { InputBox, InputBoxOptions, QuickInput, QuickInputButton, QuickPick, QuickPickItem, QuickPickOptions, WorkspaceFolder, WorkspaceFolderPickOptions } from 'vscode';
import { ExtHostQuickOpenShape, IMainContext, MainContext, MainThreadQuickOpenShape, TransferQuickPickItems, TransferQuickInput, TransferQuickInputButton } from './extHost.protocol';
import { URI } from 'vs/base/common/uri';
import { ThemeIcon, QuickInputButtons } from 'vs/workbench/api/common/extHostTypes';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { coalesce } from 'vs/base/common/arrays';

export type Item = string | QuickPickItem;

export class ExtHostQuickOpen implements ExtHostQuickOpenShape {

	private _proxy: MainThreadQuickOpenShape;
	private _workspace: IExtHostWorkspaceProvider;
	private _commands: ExtHostCommands;

	private _onDidSelectItem?: (handle: number) => void;
	private _validateInput?: (input: string) => string | undefined | null | Thenable<string | undefined | null>;

	private _sessions = new Map<number, ExtHostQuickInput>();

	private _instances = 0;

	constructor(mainContext: IMainContext, workspace: IExtHostWorkspaceProvider, commands: ExtHostCommands) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadQuickOpen);
		this._workspace = workspace;
		this._commands = commands;
	}

	showQuickPick(itemsOrItemsPromise: QuickPickItem[] | Promise<QuickPickItem[]>, enableProposedApi: boolean, options: QuickPickOptions & { canPickMany: true; }, token?: CancellationToken): Promise<QuickPickItem[] | undefined>;
	showQuickPick(itemsOrItemsPromise: string[] | Promise<string[]>, enableProposedApi: boolean, options?: QuickPickOptions, token?: CancellationToken): Promise<string | undefined>;
	showQuickPick(itemsOrItemsPromise: QuickPickItem[] | Promise<QuickPickItem[]>, enableProposedApi: boolean, options?: QuickPickOptions, token?: CancellationToken): Promise<QuickPickItem | undefined>;
	showQuickPick(itemsOrItemsPromise: Item[] | Promise<Item[]>, enableProposedApi: boolean, options?: QuickPickOptions, token: CancellationToken = CancellationToken.None): Promise<Item | Item[] | undefined> {

		// clear state from last invocation
		this._onDidSelectItem = undefined;

		const itemsPromise = <Promise<Item[]>>Promise.resolve(itemsOrItemsPromise);

		const instance = ++this._instances;

		const quickPickWidget = this._proxy.$show(instance, {
			placeHolder: options && options.placeHolder,
			matchOnDescription: options && options.matchOnDescription,
			matchOnDetail: options && options.matchOnDetail,
			ignoreFocusLost: options && options.ignoreFocusOut,
			canPickMany: options && options.canPickMany
		}, token);

		const widgetClosedMarker = {};
		const widgetClosedPromise = quickPickWidget.then(() => widgetClosedMarker);

		return Promise.race([widgetClosedPromise, itemsPromise]).then(result => {
			if (result === widgetClosedMarker) {
				return undefined;
			}

			return itemsPromise.then(items => {

				const pickItems: TransferQuickPickItems[] = [];
				for (let handle = 0; handle < items.length; handle++) {

					const item = items[handle];
					let label: string;
					let description: string | undefined;
					let detail: string | undefined;
					let picked: boolean | undefined;
					let alwaysShow: boolean | undefined;

					if (typeof item === 'string') {
						label = item;
					} else {
						label = item.label;
						description = item.description;
						detail = item.detail;
						picked = item.picked;
						alwaysShow = item.alwaysShow;
					}
					pickItems.push({
						label,
						description,
						handle,
						detail,
						picked,
						alwaysShow
					});
				}

				// handle selection changes
				if (options && typeof options.onDidSelectItem === 'function') {
					this._onDidSelectItem = (handle) => {
						options.onDidSelectItem!(items[handle]);
					};
				}

				// show items
				this._proxy.$setItems(instance, pickItems);

				return quickPickWidget.then(handle => {
					if (typeof handle === 'number') {
						return items[handle];
					} else if (Array.isArray(handle)) {
						return handle.map(h => items[h]);
					}
					return undefined;
				});
			});
		}).then(undefined, err => {
			if (isPromiseCanceledError(err)) {
				return undefined;
			}

			this._proxy.$setError(instance, err);

			return Promise.reject(err);
		});
	}

	$onItemSelected(handle: number): void {
		if (this._onDidSelectItem) {
			this._onDidSelectItem(handle);
		}
	}

	// ---- input

	showInput(options?: InputBoxOptions, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {

		// global validate fn used in callback below
		this._validateInput = options ? options.validateInput : undefined;

		return this._proxy.$input(options, typeof this._validateInput === 'function', token)
			.then(undefined, err => {
				if (isPromiseCanceledError(err)) {
					return undefined;
				}

				return Promise.reject(err);
			});
	}

	$validateInput(input: string): Promise<string | null | undefined> {
		if (this._validateInput) {
			return asPromise(() => this._validateInput!(input));
		}
		return Promise.resolve(undefined);
	}

	// ---- workspace folder picker

	async showWorkspaceFolderPick(options?: WorkspaceFolderPickOptions, token = CancellationToken.None): Promise<WorkspaceFolder | undefined> {
		const selectedFolder = await this._commands.executeCommand<WorkspaceFolder>('_workbench.pickWorkspaceFolder', [options]);
		if (!selectedFolder) {
			return undefined;
		}
		const workspaceFolders = await this._workspace.getWorkspaceFolders2();
		if (!workspaceFolders) {
			return undefined;
		}
		return workspaceFolders.find(folder => folder.uri.toString() === selectedFolder.uri.toString());
	}

	// ---- QuickInput

	createQuickPick<T extends QuickPickItem>(extensionId: ExtensionIdentifier, enableProposedApi: boolean): QuickPick<T> {
		const session: ExtHostQuickPick<T> = new ExtHostQuickPick(this._proxy, extensionId, enableProposedApi, () => this._sessions.delete(session._id));
		this._sessions.set(session._id, session);
		return session;
	}

	createInputBox(extensionId: ExtensionIdentifier): InputBox {
		const session: ExtHostInputBox = new ExtHostInputBox(this._proxy, extensionId, () => this._sessions.delete(session._id));
		this._sessions.set(session._id, session);
		return session;
	}

	$onDidChangeValue(sessionId: number, value: string): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session._fireDidChangeValue(value);
		}
	}

	$onDidAccept(sessionId: number): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session._fireDidAccept();
		}
	}

	$onDidChangeActive(sessionId: number, handles: number[]): void {
		const session = this._sessions.get(sessionId);
		if (session instanceof ExtHostQuickPick) {
			session._fireDidChangeActive(handles);
		}
	}

	$onDidChangeSelection(sessionId: number, handles: number[]): void {
		const session = this._sessions.get(sessionId);
		if (session instanceof ExtHostQuickPick) {
			session._fireDidChangeSelection(handles);
		}
	}

	$onDidTriggerButton(sessionId: number, handle: number): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session._fireDidTriggerButton(handle);
		}
	}

	$onDidHide(sessionId: number): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session._fireDidHide();
		}
	}
}

class ExtHostQuickInput implements QuickInput {

	private static _nextId = 1;
	_id = ExtHostQuickPick._nextId++;

	private _title: string | undefined;
	private _steps: number | undefined;
	private _totalSteps: number | undefined;
	private _visible = false;
	private _expectingHide = false;
	private _enabled = true;
	private _busy = false;
	private _ignoreFocusOut = true;
	private _value = '';
	private _placeholder: string | undefined;
	private _buttons: QuickInputButton[] = [];
	private _handlesToButtons = new Map<number, QuickInputButton>();
	private readonly _onDidAcceptEmitter = new Emitter<void>();
	private readonly _onDidChangeValueEmitter = new Emitter<string>();
	private readonly _onDidTriggerButtonEmitter = new Emitter<QuickInputButton>();
	private readonly _onDidHideEmitter = new Emitter<void>();
	private _updateTimeout: any;
	private _pendingUpdate: TransferQuickInput = { id: this._id };

	private _disposed = false;
	protected _disposables: IDisposable[] = [
		this._onDidTriggerButtonEmitter,
		this._onDidHideEmitter,
		this._onDidAcceptEmitter,
		this._onDidChangeValueEmitter
	];

	constructor(protected _proxy: MainThreadQuickOpenShape, protected _extensionId: ExtensionIdentifier, private _onDidDispose: () => void) {
	}

	get title() {
		return this._title;
	}

	set title(title: string | undefined) {
		this._title = title;
		this.update({ title });
	}

	get step() {
		return this._steps;
	}

	set step(step: number | undefined) {
		this._steps = step;
		this.update({ step });
	}

	get totalSteps() {
		return this._totalSteps;
	}

	set totalSteps(totalSteps: number | undefined) {
		this._totalSteps = totalSteps;
		this.update({ totalSteps });
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(enabled: boolean) {
		this._enabled = enabled;
		this.update({ enabled });
	}

	get busy() {
		return this._busy;
	}

	set busy(busy: boolean) {
		this._busy = busy;
		this.update({ busy });
	}

	get ignoreFocusOut() {
		return this._ignoreFocusOut;
	}

	set ignoreFocusOut(ignoreFocusOut: boolean) {
		this._ignoreFocusOut = ignoreFocusOut;
		this.update({ ignoreFocusOut });
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value;
		this.update({ value });
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string | undefined) {
		this._placeholder = placeholder;
		this.update({ placeholder });
	}

	onDidChangeValue = this._onDidChangeValueEmitter.event;

	onDidAccept = this._onDidAcceptEmitter.event;

	get buttons() {
		return this._buttons;
	}

	set buttons(buttons: QuickInputButton[]) {
		this._buttons = buttons.slice();
		this._handlesToButtons.clear();
		buttons.forEach((button, i) => {
			const handle = button === QuickInputButtons.Back ? -1 : i;
			this._handlesToButtons.set(handle, button);
		});
		this.update({
			buttons: buttons.map<TransferQuickInputButton>((button, i) => ({
				iconPath: getIconUris(button.iconPath),
				tooltip: button.tooltip,
				handle: button === QuickInputButtons.Back ? -1 : i,
			}))
		});
	}

	onDidTriggerButton = this._onDidTriggerButtonEmitter.event;

	show(): void {
		this._visible = true;
		this._expectingHide = true;
		this.update({ visible: true });
	}

	hide(): void {
		this._visible = false;
		this.update({ visible: false });
	}

	onDidHide = this._onDidHideEmitter.event;

	_fireDidAccept() {
		this._onDidAcceptEmitter.fire();
	}

	_fireDidChangeValue(value: string) {
		this._value = value;
		this._onDidChangeValueEmitter.fire(value);
	}

	_fireDidTriggerButton(handle: number) {
		const button = this._handlesToButtons.get(handle);
		if (button) {
			this._onDidTriggerButtonEmitter.fire(button);
		}
	}

	_fireDidHide() {
		if (this._expectingHide) {
			this._expectingHide = false;
			this._onDidHideEmitter.fire();
		}
	}

	dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._fireDidHide();
		this._disposables = dispose(this._disposables);
		if (this._updateTimeout) {
			clearTimeout(this._updateTimeout);
			this._updateTimeout = undefined;
		}
		this._onDidDispose();
		this._proxy.$dispose(this._id);
	}

	protected update(properties: Record<string, any>): void {
		if (this._disposed) {
			return;
		}
		for (const key of Object.keys(properties)) {
			const value = properties[key];
			this._pendingUpdate[key] = value === undefined ? null : value;
		}

		if ('visible' in this._pendingUpdate) {
			if (this._updateTimeout) {
				clearTimeout(this._updateTimeout);
				this._updateTimeout = undefined;
			}
			this.dispatchUpdate();
		} else if (this._visible && !this._updateTimeout) {
			// Defer the update so that multiple changes to setters dont cause a redraw each
			this._updateTimeout = setTimeout(() => {
				this._updateTimeout = undefined;
				this.dispatchUpdate();
			}, 0);
		}
	}

	private dispatchUpdate() {
		this._proxy.$createOrUpdate(this._pendingUpdate);
		this._pendingUpdate = { id: this._id };
	}
}

function getIconUris(iconPath: QuickInputButton['iconPath']): { dark: URI, light?: URI } | { id: string } {
	if (iconPath instanceof ThemeIcon) {
		return { id: iconPath.id };
	}
	const dark = getDarkIconUri(iconPath as URI | { light: URI; dark: URI; });
	const light = getLightIconUri(iconPath as URI | { light: URI; dark: URI; });
	// Tolerate strings: https://github.com/microsoft/vscode/issues/110432#issuecomment-726144556
	return {
		dark: typeof dark === 'string' ? URI.file(dark) : dark,
		light: typeof light === 'string' ? URI.file(light) : light
	};
}

function getLightIconUri(iconPath: URI | { light: URI; dark: URI; }) {
	return typeof iconPath === 'object' && 'light' in iconPath ? iconPath.light : iconPath;
}

function getDarkIconUri(iconPath: URI | { light: URI; dark: URI; }) {
	return typeof iconPath === 'object' && 'dark' in iconPath ? iconPath.dark : iconPath;
}

class ExtHostQuickPick<T extends QuickPickItem> extends ExtHostQuickInput implements QuickPick<T> {

	private _items: T[] = [];
	private _handlesToItems = new Map<number, T>();
	private _itemsToHandles = new Map<T, number>();
	private _canSelectMany = false;
	private _matchOnDescription = true;
	private _matchOnDetail = true;
	private _sortByLabel = true;
	private _activeItems: T[] = [];
	private readonly _onDidChangeActiveEmitter = new Emitter<T[]>();
	private _selectedItems: T[] = [];
	private readonly _onDidChangeSelectionEmitter = new Emitter<T[]>();

	constructor(proxy: MainThreadQuickOpenShape, extensionId: ExtensionIdentifier, enableProposedApi: boolean, onDispose: () => void) {
		super(proxy, extensionId, onDispose);
		this._disposables.push(
			this._onDidChangeActiveEmitter,
			this._onDidChangeSelectionEmitter,
		);
		this.update({ type: 'quickPick' });
	}

	get items() {
		return this._items;
	}

	set items(items: T[]) {
		this._items = items.slice();
		this._handlesToItems.clear();
		this._itemsToHandles.clear();
		items.forEach((item, i) => {
			this._handlesToItems.set(i, item);
			this._itemsToHandles.set(item, i);
		});
		this.update({
			items: items.map((item, i) => ({
				label: item.label,
				description: item.description,
				handle: i,
				detail: item.detail,
				picked: item.picked,
				alwaysShow: item.alwaysShow
			}))
		});
	}

	get canSelectMany() {
		return this._canSelectMany;
	}

	set canSelectMany(canSelectMany: boolean) {
		this._canSelectMany = canSelectMany;
		this.update({ canSelectMany });
	}

	get matchOnDescription() {
		return this._matchOnDescription;
	}

	set matchOnDescription(matchOnDescription: boolean) {
		this._matchOnDescription = matchOnDescription;
		this.update({ matchOnDescription });
	}

	get matchOnDetail() {
		return this._matchOnDetail;
	}

	set matchOnDetail(matchOnDetail: boolean) {
		this._matchOnDetail = matchOnDetail;
		this.update({ matchOnDetail });
	}

	get sortByLabel() {
		return this._sortByLabel;
	}

	set sortByLabel(sortByLabel: boolean) {
		this._sortByLabel = sortByLabel;
		this.update({ sortByLabel });
	}

	get activeItems() {
		return this._activeItems;
	}

	set activeItems(activeItems: T[]) {
		this._activeItems = activeItems.filter(item => this._itemsToHandles.has(item));
		this.update({ activeItems: this._activeItems.map(item => this._itemsToHandles.get(item)) });
	}

	onDidChangeActive = this._onDidChangeActiveEmitter.event;

	get selectedItems() {
		return this._selectedItems;
	}

	set selectedItems(selectedItems: T[]) {
		this._selectedItems = selectedItems.filter(item => this._itemsToHandles.has(item));
		this.update({ selectedItems: this._selectedItems.map(item => this._itemsToHandles.get(item)) });
	}

	onDidChangeSelection = this._onDidChangeSelectionEmitter.event;

	_fireDidChangeActive(handles: number[]) {
		const items = coalesce(handles.map(handle => this._handlesToItems.get(handle)));
		this._activeItems = items;
		this._onDidChangeActiveEmitter.fire(items);
	}

	_fireDidChangeSelection(handles: number[]) {
		const items = coalesce(handles.map(handle => this._handlesToItems.get(handle)));
		this._selectedItems = items;
		this._onDidChangeSelectionEmitter.fire(items);
	}
}

class ExtHostInputBox extends ExtHostQuickInput implements InputBox {

	private _password = false;
	private _prompt: string | undefined;
	private _validationMessage: string | undefined;

	constructor(proxy: MainThreadQuickOpenShape, extensionId: ExtensionIdentifier, onDispose: () => void) {
		super(proxy, extensionId, onDispose);
		this.update({ type: 'inputBox' });
	}

	get password() {
		return this._password;
	}

	set password(password: boolean) {
		this._password = password;
		this.update({ password });
	}

	get prompt() {
		return this._prompt;
	}

	set prompt(prompt: string | undefined) {
		this._prompt = prompt;
		this.update({ prompt });
	}

	get validationMessage() {
		return this._validationMessage;
	}

	set validationMessage(validationMessage: string | undefined) {
		this._validationMessage = validationMessage;
		this.update({ validationMessage });
	}
}
