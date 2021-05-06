/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { debounce } from 'vs/base/common/decorators';
import { DisposableStore, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { asPromise } from 'vs/base/common/async';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { MainContext, MainThreadSCMShape, SCMRawResource, SCMRawResourceSplice, SCMRawResourceSplices, IMainContext, ExtHostSCMShape, ICommandDto, MainThreadTelemetryShape, SCMGroupFeatures } from './extHost.protocol';
import { sortedDiff, equals } from 'vs/base/common/arrays';
import { comparePaths } from 'vs/base/common/comparers';
import type * as vscode from 'vscode';
import { ISplice } from 'vs/base/common/sequence';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { checkProposedApiEnabled } from 'vs/workbench/services/extensions/common/extensions';

type ProviderHandle = number;
type GroupHandle = number;
type ResourceStateHandle = number;

function getIconResource(decorations?: vscode.SourceControlResourceThemableDecorations): vscode.Uri | undefined {
	if (!decorations) {
		return undefined;
	} else if (typeof decorations.iconPath === 'string') {
		return URI.file(decorations.iconPath);
	} else {
		return decorations.iconPath;
	}
}

function compareResourceThemableDecorations(a: vscode.SourceControlResourceThemableDecorations, b: vscode.SourceControlResourceThemableDecorations): number {
	if (!a.iconPath && !b.iconPath) {
		return 0;
	} else if (!a.iconPath) {
		return -1;
	} else if (!b.iconPath) {
		return 1;
	}

	const aPath = typeof a.iconPath === 'string' ? a.iconPath : a.iconPath.fsPath;
	const bPath = typeof b.iconPath === 'string' ? b.iconPath : b.iconPath.fsPath;
	return comparePaths(aPath, bPath);
}

function compareResourceStatesDecorations(a: vscode.SourceControlResourceDecorations, b: vscode.SourceControlResourceDecorations): number {
	let result = 0;

	if (a.strikeThrough !== b.strikeThrough) {
		return a.strikeThrough ? 1 : -1;
	}

	if (a.faded !== b.faded) {
		return a.faded ? 1 : -1;
	}

	if (a.tooltip !== b.tooltip) {
		return (a.tooltip || '').localeCompare(b.tooltip || '');
	}

	result = compareResourceThemableDecorations(a, b);

	if (result !== 0) {
		return result;
	}

	if (a.light && b.light) {
		result = compareResourceThemableDecorations(a.light, b.light);
	} else if (a.light) {
		return 1;
	} else if (b.light) {
		return -1;
	}

	if (result !== 0) {
		return result;
	}

	if (a.dark && b.dark) {
		result = compareResourceThemableDecorations(a.dark, b.dark);
	} else if (a.dark) {
		return 1;
	} else if (b.dark) {
		return -1;
	}

	return result;
}

function compareCommands(a: vscode.Command, b: vscode.Command): number {
	if (a.command !== b.command) {
		return a.command < b.command ? -1 : 1;
	}

	if (a.title !== b.title) {
		return a.title < b.title ? -1 : 1;
	}

	if (a.tooltip !== b.tooltip) {
		if (a.tooltip !== undefined && b.tooltip !== undefined) {
			return a.tooltip < b.tooltip ? -1 : 1;
		} else if (a.tooltip !== undefined) {
			return 1;
		} else if (b.tooltip !== undefined) {
			return -1;
		}
	}

	if (a.arguments === b.arguments) {
		return 0;
	} else if (!a.arguments) {
		return -1;
	} else if (!b.arguments) {
		return 1;
	} else if (a.arguments.length !== b.arguments.length) {
		return a.arguments.length - b.arguments.length;
	}

	for (let i = 0; i < a.arguments.length; i++) {
		const aArg = a.arguments[i];
		const bArg = b.arguments[i];

		if (aArg === bArg) {
			continue;
		}

		return aArg < bArg ? -1 : 1;
	}

	return 0;
}

function compareResourceStates(a: vscode.SourceControlResourceState, b: vscode.SourceControlResourceState): number {
	let result = comparePaths(a.resourceUri.fsPath, b.resourceUri.fsPath, true);

	if (result !== 0) {
		return result;
	}

	if (a.command && b.command) {
		result = compareCommands(a.command, b.command);
	} else if (a.command) {
		return 1;
	} else if (b.command) {
		return -1;
	}

	if (result !== 0) {
		return result;
	}

	if (a.decorations && b.decorations) {
		result = compareResourceStatesDecorations(a.decorations, b.decorations);
	} else if (a.decorations) {
		return 1;
	} else if (b.decorations) {
		return -1;
	}

	return result;
}

function compareArgs(a: any[], b: any[]): boolean {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}

	return true;
}

function commandEquals(a: vscode.Command, b: vscode.Command): boolean {
	return a.command === b.command
		&& a.title === b.title
		&& a.tooltip === b.tooltip
		&& (a.arguments && b.arguments ? compareArgs(a.arguments, b.arguments) : a.arguments === b.arguments);
}

function commandListEquals(a: readonly vscode.Command[], b: readonly vscode.Command[]): boolean {
	return equals(a, b, commandEquals);
}

export interface IValidateInput {
	(value: string, cursorPosition: number): vscode.ProviderResult<vscode.SourceControlInputBoxValidation | undefined | null>;
}

export class ExtHostSCMInputBox implements vscode.SourceControlInputBox {

	private _value: string = '';

	get value(): string {
		return this._value;
	}

	set value(value: string) {
		this._proxy.$setInputBoxValue(this._sourceControlHandle, value);
		this.updateValue(value);
	}

	private readonly _onDidChange = new Emitter<string>();

	get onDidChange(): Event<string> {
		return this._onDidChange.event;
	}

	private _placeholder: string = '';

	get placeholder(): string {
		return this._placeholder;
	}

	set placeholder(placeholder: string) {
		this._proxy.$setInputBoxPlaceholder(this._sourceControlHandle, placeholder);
		this._placeholder = placeholder;
	}

	private _validateInput: IValidateInput | undefined;

	get validateInput(): IValidateInput | undefined {
		checkProposedApiEnabled(this._extension);

		return this._validateInput;
	}

	set validateInput(fn: IValidateInput | undefined) {
		checkProposedApiEnabled(this._extension);

		if (fn && typeof fn !== 'function') {
			throw new Error(`[${this._extension.identifier.value}]: Invalid SCM input box validation function`);
		}

		this._validateInput = fn;
		this._proxy.$setValidationProviderIsEnabled(this._sourceControlHandle, !!fn);
	}

	private _visible: boolean = true;

	get visible(): boolean {
		return this._visible;
	}

	set visible(visible: boolean) {
		visible = !!visible;

		if (this._visible === visible) {
			return;
		}

		this._visible = visible;
		this._proxy.$setInputBoxVisibility(this._sourceControlHandle, visible);
	}

	constructor(private _extension: IExtensionDescription, private _proxy: MainThreadSCMShape, private _sourceControlHandle: number) {
		// noop
	}

	focus(): void {
		checkProposedApiEnabled(this._extension);

		if (!this._visible) {
			this.visible = true;
		}

		this._proxy.$setInputBoxFocus(this._sourceControlHandle);
	}

	showValidationMessage(message: string, type: vscode.SourceControlInputBoxValidationType) {
		checkProposedApiEnabled(this._extension);

		this._proxy.$showValidationMessage(this._sourceControlHandle, message, type as any);
	}

	$onInputBoxValueChange(value: string): void {
		this.updateValue(value);
	}

	private updateValue(value: string): void {
		this._value = value;
		this._onDidChange.fire(value);
	}
}

class ExtHostSourceControlResourceGroup implements vscode.SourceControlResourceGroup {

	private static _handlePool: number = 0;
	private _resourceHandlePool: number = 0;
	private _resourceStates: vscode.SourceControlResourceState[] = [];

	private _resourceStatesMap = new Map<ResourceStateHandle, vscode.SourceControlResourceState>();
	private _resourceStatesCommandsMap = new Map<ResourceStateHandle, vscode.Command>();
	private _resourceStatesDisposablesMap = new Map<ResourceStateHandle, IDisposable>();

	private readonly _onDidUpdateResourceStates = new Emitter<void>();
	readonly onDidUpdateResourceStates = this._onDidUpdateResourceStates.event;

	private _disposed = false;
	get disposed(): boolean { return this._disposed; }
	private readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose = this._onDidDispose.event;

	private _handlesSnapshot: number[] = [];
	private _resourceSnapshot: vscode.SourceControlResourceState[] = [];

	get id(): string { return this._id; }

	get label(): string { return this._label; }
	set label(label: string) {
		this._label = label;
		this._proxy.$updateGroupLabel(this._sourceControlHandle, this.handle, label);
	}

	private _hideWhenEmpty: boolean | undefined = undefined;
	get hideWhenEmpty(): boolean | undefined { return this._hideWhenEmpty; }
	set hideWhenEmpty(hideWhenEmpty: boolean | undefined) {
		this._hideWhenEmpty = hideWhenEmpty;
		this._proxy.$updateGroup(this._sourceControlHandle, this.handle, this.features);
	}

	get features(): SCMGroupFeatures {
		return {
			hideWhenEmpty: this.hideWhenEmpty
		};
	}

	get resourceStates(): vscode.SourceControlResourceState[] { return [...this._resourceStates]; }
	set resourceStates(resources: vscode.SourceControlResourceState[]) {
		this._resourceStates = [...resources];
		this._onDidUpdateResourceStates.fire();
	}

	readonly handle = ExtHostSourceControlResourceGroup._handlePool++;

	constructor(
		private _proxy: MainThreadSCMShape,
		private _commands: ExtHostCommands,
		private _sourceControlHandle: number,
		private _id: string,
		private _label: string,
	) { }

	getResourceState(handle: number): vscode.SourceControlResourceState | undefined {
		return this._resourceStatesMap.get(handle);
	}

	$executeResourceCommand(handle: number, preserveFocus: boolean): Promise<void> {
		const command = this._resourceStatesCommandsMap.get(handle);

		if (!command) {
			return Promise.resolve(undefined);
		}

		return asPromise(() => this._commands.executeCommand(command.command, ...(command.arguments || []), preserveFocus));
	}

	_takeResourceStateSnapshot(): SCMRawResourceSplice[] {
		const snapshot = [...this._resourceStates].sort(compareResourceStates);
		const diffs = sortedDiff(this._resourceSnapshot, snapshot, compareResourceStates);

		const splices = diffs.map<ISplice<{ rawResource: SCMRawResource, handle: number }>>(diff => {
			const toInsert = diff.toInsert.map(r => {
				const handle = this._resourceHandlePool++;
				this._resourceStatesMap.set(handle, r);

				const sourceUri = r.resourceUri;
				const iconUri = getIconResource(r.decorations);
				const lightIconUri = r.decorations && getIconResource(r.decorations.light) || iconUri;
				const darkIconUri = r.decorations && getIconResource(r.decorations.dark) || iconUri;
				const icons: UriComponents[] = [];
				let command: ICommandDto | undefined;

				if (r.command) {
					if (r.command.command === 'vscode.open' || r.command.command === 'vscode.diff') {
						const disposables = new DisposableStore();
						command = this._commands.converter.toInternal(r.command, disposables);
						this._resourceStatesDisposablesMap.set(handle, disposables);
					} else {
						this._resourceStatesCommandsMap.set(handle, r.command);
					}
				}

				if (lightIconUri) {
					icons.push(lightIconUri);
				}

				if (darkIconUri && (darkIconUri.toString() !== lightIconUri?.toString())) {
					icons.push(darkIconUri);
				}

				const tooltip = (r.decorations && r.decorations.tooltip) || '';
				const strikeThrough = r.decorations && !!r.decorations.strikeThrough;
				const faded = r.decorations && !!r.decorations.faded;
				const contextValue = r.contextValue || '';

				const rawResource = [handle, sourceUri, icons, tooltip, strikeThrough, faded, contextValue, command] as SCMRawResource;

				return { rawResource, handle };
			});

			return { start: diff.start, deleteCount: diff.deleteCount, toInsert };
		});

		const rawResourceSplices = splices
			.map(({ start, deleteCount, toInsert }) => [start, deleteCount, toInsert.map(i => i.rawResource)] as SCMRawResourceSplice);

		const reverseSplices = splices.reverse();

		for (const { start, deleteCount, toInsert } of reverseSplices) {
			const handles = toInsert.map(i => i.handle);
			const handlesToDelete = this._handlesSnapshot.splice(start, deleteCount, ...handles);

			for (const handle of handlesToDelete) {
				this._resourceStatesMap.delete(handle);
				this._resourceStatesCommandsMap.delete(handle);
				this._resourceStatesDisposablesMap.get(handle)?.dispose();
				this._resourceStatesDisposablesMap.delete(handle);
			}
		}

		this._resourceSnapshot = snapshot;
		return rawResourceSplices;
	}

	dispose(): void {
		this._disposed = true;
		this._onDidDispose.fire();
	}
}

class ExtHostSourceControl implements vscode.SourceControl {

	private static _handlePool: number = 0;
	private _groups: Map<GroupHandle, ExtHostSourceControlResourceGroup> = new Map<GroupHandle, ExtHostSourceControlResourceGroup>();

	get id(): string {
		return this._id;
	}

	get label(): string {
		return this._label;
	}

	get rootUri(): vscode.Uri | undefined {
		return this._rootUri;
	}

	private _inputBox: ExtHostSCMInputBox;
	get inputBox(): ExtHostSCMInputBox { return this._inputBox; }

	private _count: number | undefined = undefined;

	get count(): number | undefined {
		return this._count;
	}

	set count(count: number | undefined) {
		if (this._count === count) {
			return;
		}

		this._count = count;
		this._proxy.$updateSourceControl(this.handle, { count });
	}

	private _quickDiffProvider: vscode.QuickDiffProvider | undefined = undefined;

	get quickDiffProvider(): vscode.QuickDiffProvider | undefined {
		return this._quickDiffProvider;
	}

	set quickDiffProvider(quickDiffProvider: vscode.QuickDiffProvider | undefined) {
		this._quickDiffProvider = quickDiffProvider;
		this._proxy.$updateSourceControl(this.handle, { hasQuickDiffProvider: !!quickDiffProvider });
	}

	private _commitTemplate: string | undefined = undefined;

	get commitTemplate(): string | undefined {
		return this._commitTemplate;
	}

	set commitTemplate(commitTemplate: string | undefined) {
		if (commitTemplate === this._commitTemplate) {
			return;
		}

		this._commitTemplate = commitTemplate;
		this._proxy.$updateSourceControl(this.handle, { commitTemplate });
	}

	private _acceptInputDisposables = new MutableDisposable<DisposableStore>();
	private _acceptInputCommand: vscode.Command | undefined = undefined;

	get acceptInputCommand(): vscode.Command | undefined {
		return this._acceptInputCommand;
	}

	set acceptInputCommand(acceptInputCommand: vscode.Command | undefined) {
		this._acceptInputDisposables.value = new DisposableStore();

		this._acceptInputCommand = acceptInputCommand;

		const internal = this._commands.converter.toInternal(acceptInputCommand, this._acceptInputDisposables.value);
		this._proxy.$updateSourceControl(this.handle, { acceptInputCommand: internal });
	}

	private _statusBarDisposables = new MutableDisposable<DisposableStore>();
	private _statusBarCommands: vscode.Command[] | undefined = undefined;

	get statusBarCommands(): vscode.Command[] | undefined {
		return this._statusBarCommands;
	}

	set statusBarCommands(statusBarCommands: vscode.Command[] | undefined) {
		if (this._statusBarCommands && statusBarCommands && commandListEquals(this._statusBarCommands, statusBarCommands)) {
			return;
		}

		this._statusBarDisposables.value = new DisposableStore();

		this._statusBarCommands = statusBarCommands;

		const internal = (statusBarCommands || []).map(c => this._commands.converter.toInternal(c, this._statusBarDisposables.value!)) as ICommandDto[];
		this._proxy.$updateSourceControl(this.handle, { statusBarCommands: internal });
	}

	private _selected: boolean = false;

	get selected(): boolean {
		return this._selected;
	}

	private readonly _onDidChangeSelection = new Emitter<boolean>();
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	private handle: number = ExtHostSourceControl._handlePool++;

	constructor(
		_extension: IExtensionDescription,
		private _proxy: MainThreadSCMShape,
		private _commands: ExtHostCommands,
		private _id: string,
		private _label: string,
		private _rootUri?: vscode.Uri
	) {
		this._inputBox = new ExtHostSCMInputBox(_extension, this._proxy, this.handle);
		this._proxy.$registerSourceControl(this.handle, _id, _label, _rootUri);
	}

	private createdResourceGroups = new Map<ExtHostSourceControlResourceGroup, IDisposable>();
	private updatedResourceGroups = new Set<ExtHostSourceControlResourceGroup>();

	createResourceGroup(id: string, label: string): ExtHostSourceControlResourceGroup {
		const group = new ExtHostSourceControlResourceGroup(this._proxy, this._commands, this.handle, id, label);
		const disposable = Event.once(group.onDidDispose)(() => this.createdResourceGroups.delete(group));
		this.createdResourceGroups.set(group, disposable);
		this.eventuallyAddResourceGroups();
		return group;
	}

	@debounce(100)
	eventuallyAddResourceGroups(): void {
		const groups: [number /*handle*/, string /*id*/, string /*label*/, SCMGroupFeatures][] = [];
		const splices: SCMRawResourceSplices[] = [];

		for (const [group, disposable] of this.createdResourceGroups) {
			disposable.dispose();

			const updateListener = group.onDidUpdateResourceStates(() => {
				this.updatedResourceGroups.add(group);
				this.eventuallyUpdateResourceStates();
			});

			Event.once(group.onDidDispose)(() => {
				this.updatedResourceGroups.delete(group);
				updateListener.dispose();
				this._groups.delete(group.handle);
				this._proxy.$unregisterGroup(this.handle, group.handle);
			});

			groups.push([group.handle, group.id, group.label, group.features]);

			const snapshot = group._takeResourceStateSnapshot();

			if (snapshot.length > 0) {
				splices.push([group.handle, snapshot]);
			}

			this._groups.set(group.handle, group);
		}

		this._proxy.$registerGroups(this.handle, groups, splices);
		this.createdResourceGroups.clear();
	}

	@debounce(100)
	eventuallyUpdateResourceStates(): void {
		const splices: SCMRawResourceSplices[] = [];

		this.updatedResourceGroups.forEach(group => {
			const snapshot = group._takeResourceStateSnapshot();

			if (snapshot.length === 0) {
				return;
			}

			splices.push([group.handle, snapshot]);
		});

		if (splices.length > 0) {
			this._proxy.$spliceResourceStates(this.handle, splices);
		}

		this.updatedResourceGroups.clear();
	}

	getResourceGroup(handle: GroupHandle): ExtHostSourceControlResourceGroup | undefined {
		return this._groups.get(handle);
	}

	setSelectionState(selected: boolean): void {
		this._selected = selected;
		this._onDidChangeSelection.fire(selected);
	}

	dispose(): void {
		this._acceptInputDisposables.dispose();
		this._statusBarDisposables.dispose();

		this._groups.forEach(group => group.dispose());
		this._proxy.$unregisterSourceControl(this.handle);
	}
}

export class ExtHostSCM implements ExtHostSCMShape {

	private static _handlePool: number = 0;

	private _proxy: MainThreadSCMShape;
	private readonly _telemetry: MainThreadTelemetryShape;
	private _sourceControls: Map<ProviderHandle, ExtHostSourceControl> = new Map<ProviderHandle, ExtHostSourceControl>();
	private _sourceControlsByExtension: Map<string, ExtHostSourceControl[]> = new Map<string, ExtHostSourceControl[]>();

	private readonly _onDidChangeActiveProvider = new Emitter<vscode.SourceControl>();
	get onDidChangeActiveProvider(): Event<vscode.SourceControl> { return this._onDidChangeActiveProvider.event; }

	private _selectedSourceControlHandle: number | undefined;

	constructor(
		mainContext: IMainContext,
		private _commands: ExtHostCommands,
		@ILogService private readonly logService: ILogService
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadSCM);
		this._telemetry = mainContext.getProxy(MainContext.MainThreadTelemetry);

		_commands.registerArgumentProcessor({
			processArgument: arg => {
				if (arg && arg.$mid === 3) {
					const sourceControl = this._sourceControls.get(arg.sourceControlHandle);

					if (!sourceControl) {
						return arg;
					}

					const group = sourceControl.getResourceGroup(arg.groupHandle);

					if (!group) {
						return arg;
					}

					return group.getResourceState(arg.handle);
				} else if (arg && arg.$mid === 4) {
					const sourceControl = this._sourceControls.get(arg.sourceControlHandle);

					if (!sourceControl) {
						return arg;
					}

					return sourceControl.getResourceGroup(arg.groupHandle);
				} else if (arg && arg.$mid === 5) {
					const sourceControl = this._sourceControls.get(arg.handle);

					if (!sourceControl) {
						return arg;
					}

					return sourceControl;
				}

				return arg;
			}
		});
	}

	createSourceControl(extension: IExtensionDescription, id: string, label: string, rootUri: vscode.Uri | undefined): vscode.SourceControl {
		this.logService.trace('ExtHostSCM#createSourceControl', extension.identifier.value, id, label, rootUri);

		type TEvent = { extensionId: string; };
		type TMeta = { extensionId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' }; };
		this._telemetry.$publicLog2<TEvent, TMeta>('api/scm/createSourceControl', {
			extensionId: extension.identifier.value,
		});

		const handle = ExtHostSCM._handlePool++;
		const sourceControl = new ExtHostSourceControl(extension, this._proxy, this._commands, id, label, rootUri);
		this._sourceControls.set(handle, sourceControl);

		const sourceControls = this._sourceControlsByExtension.get(ExtensionIdentifier.toKey(extension.identifier)) || [];
		sourceControls.push(sourceControl);
		this._sourceControlsByExtension.set(ExtensionIdentifier.toKey(extension.identifier), sourceControls);

		return sourceControl;
	}

	// Deprecated
	getLastInputBox(extension: IExtensionDescription): ExtHostSCMInputBox | undefined {
		this.logService.trace('ExtHostSCM#getLastInputBox', extension.identifier.value);

		const sourceControls = this._sourceControlsByExtension.get(ExtensionIdentifier.toKey(extension.identifier));
		const sourceControl = sourceControls && sourceControls[sourceControls.length - 1];
		return sourceControl && sourceControl.inputBox;
	}

	$provideOriginalResource(sourceControlHandle: number, uriComponents: UriComponents, token: CancellationToken): Promise<UriComponents | null> {
		const uri = URI.revive(uriComponents);
		this.logService.trace('ExtHostSCM#$provideOriginalResource', sourceControlHandle, uri.toString());

		const sourceControl = this._sourceControls.get(sourceControlHandle);

		if (!sourceControl || !sourceControl.quickDiffProvider || !sourceControl.quickDiffProvider.provideOriginalResource) {
			return Promise.resolve(null);
		}

		return asPromise(() => sourceControl.quickDiffProvider!.provideOriginalResource!(uri, token))
			.then<UriComponents | null>(r => r || null);
	}

	$onInputBoxValueChange(sourceControlHandle: number, value: string): Promise<void> {
		this.logService.trace('ExtHostSCM#$onInputBoxValueChange', sourceControlHandle);

		const sourceControl = this._sourceControls.get(sourceControlHandle);

		if (!sourceControl) {
			return Promise.resolve(undefined);
		}

		sourceControl.inputBox.$onInputBoxValueChange(value);
		return Promise.resolve(undefined);
	}

	$executeResourceCommand(sourceControlHandle: number, groupHandle: number, handle: number, preserveFocus: boolean): Promise<void> {
		this.logService.trace('ExtHostSCM#$executeResourceCommand', sourceControlHandle, groupHandle, handle);

		const sourceControl = this._sourceControls.get(sourceControlHandle);

		if (!sourceControl) {
			return Promise.resolve(undefined);
		}

		const group = sourceControl.getResourceGroup(groupHandle);

		if (!group) {
			return Promise.resolve(undefined);
		}

		return group.$executeResourceCommand(handle, preserveFocus);
	}

	$validateInput(sourceControlHandle: number, value: string, cursorPosition: number): Promise<[string, number] | undefined> {
		this.logService.trace('ExtHostSCM#$validateInput', sourceControlHandle);

		const sourceControl = this._sourceControls.get(sourceControlHandle);

		if (!sourceControl) {
			return Promise.resolve(undefined);
		}

		if (!sourceControl.inputBox.validateInput) {
			return Promise.resolve(undefined);
		}

		return asPromise(() => sourceControl.inputBox.validateInput!(value, cursorPosition)).then(result => {
			if (!result) {
				return Promise.resolve(undefined);
			}

			return Promise.resolve<[string, number]>([result.message, result.type]);
		});
	}

	$setSelectedSourceControl(selectedSourceControlHandle: number | undefined): Promise<void> {
		this.logService.trace('ExtHostSCM#$setSelectedSourceControl', selectedSourceControlHandle);

		if (selectedSourceControlHandle !== undefined) {
			this._sourceControls.get(selectedSourceControlHandle)?.setSelectionState(true);
		}

		if (this._selectedSourceControlHandle !== undefined) {
			this._sourceControls.get(this._selectedSourceControlHandle)?.setSelectionState(false);
		}

		this._selectedSourceControlHandle = selectedSourceControlHandle;
		return Promise.resolve(undefined);
	}
}
