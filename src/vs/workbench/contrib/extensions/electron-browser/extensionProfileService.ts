/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionHostProfile, ProfileSession, IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Disposable, toDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { onUnexpectedError } from 'vs/base/common/errors';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';
import { IExtensionHostProfileService, ProfileSessionState } from 'vs/workbench/contrib/extensions/electron-browser/runtimeExtensionsEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { randomPort } from 'vs/base/node/ports';
import { IProductService } from 'vs/platform/product/common/productService';
import { RuntimeExtensionsInput } from 'vs/workbench/contrib/extensions/common/runtimeExtensionsInput';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ExtensionHostProfiler } from 'vs/workbench/services/extensions/electron-browser/extensionHostProfiler';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';

export class ExtensionHostProfileService extends Disposable implements IExtensionHostProfileService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onDidChangeLastProfile: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeLastProfile: Event<void> = this._onDidChangeLastProfile.event;

	private readonly _unresponsiveProfiles = new Map<string, IExtensionHostProfile>();
	private _profile: IExtensionHostProfile | null;
	private _profileSession: ProfileSession | null;
	private _state: ProfileSessionState = ProfileSessionState.None;

	private profilingStatusBarIndicator: IStatusbarEntryAccessor | undefined;
	private readonly profilingStatusBarIndicatorLabelUpdater = this._register(new MutableDisposable());

	public get state() { return this._state; }
	public get lastProfile() { return this._profile; }

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IProductService private readonly _productService: IProductService
	) {
		super();
		this._profile = null;
		this._profileSession = null;
		this._setState(ProfileSessionState.None);

		CommandsRegistry.registerCommand('workbench.action.extensionHostProfiler.stop', () => {
			this.stopProfiling();
			this._editorService.openEditor(RuntimeExtensionsInput.instance, { revealIfOpened: true, pinned: true });
		});
	}

	private _setState(state: ProfileSessionState): void {
		if (this._state === state) {
			return;
		}
		this._state = state;

		if (this._state === ProfileSessionState.Running) {
			this.updateProfilingStatusBarIndicator(true);
		} else if (this._state === ProfileSessionState.Stopping) {
			this.updateProfilingStatusBarIndicator(false);
		}

		this._onDidChangeState.fire(undefined);
	}

	private updateProfilingStatusBarIndicator(visible: boolean): void {
		this.profilingStatusBarIndicatorLabelUpdater.clear();

		if (visible) {
			const indicator: IStatusbarEntry = {
				text: nls.localize('profilingExtensionHost', "Profiling Extension Host"),
				showProgress: true,
				ariaLabel: nls.localize('profilingExtensionHost', "Profiling Extension Host"),
				tooltip: nls.localize('selectAndStartDebug', "Click to stop profiling."),
				command: 'workbench.action.extensionHostProfiler.stop'
			};

			const timeStarted = Date.now();
			const handle = setInterval(() => {
				if (this.profilingStatusBarIndicator) {
					this.profilingStatusBarIndicator.update({ ...indicator, text: nls.localize('profilingExtensionHostTime', "Profiling Extension Host ({0} sec)", Math.round((new Date().getTime() - timeStarted) / 1000)), });
				}
			}, 1000);
			this.profilingStatusBarIndicatorLabelUpdater.value = toDisposable(() => clearInterval(handle));

			if (!this.profilingStatusBarIndicator) {
				this.profilingStatusBarIndicator = this._statusbarService.addEntry(indicator, 'status.profiler', nls.localize('status.profiler', "Extension Profiler"), StatusbarAlignment.RIGHT);
			} else {
				this.profilingStatusBarIndicator.update(indicator);
			}
		} else {
			if (this.profilingStatusBarIndicator) {
				this.profilingStatusBarIndicator.dispose();
				this.profilingStatusBarIndicator = undefined;
			}
		}
	}

	public async startProfiling(): Promise<any> {
		if (this._state !== ProfileSessionState.None) {
			return null;
		}

		const inspectPort = await this._extensionService.getInspectPort(true);
		if (!inspectPort) {
			return this._dialogService.confirm({
				type: 'info',
				message: nls.localize('restart1', "Profile Extensions"),
				detail: nls.localize('restart2', "In order to profile extensions a restart is required. Do you want to restart '{0}' now?", this._productService.nameLong),
				primaryButton: nls.localize('restart3', "&&Restart"),
				secondaryButton: nls.localize('cancel', "&&Cancel")
			}).then(res => {
				if (res.confirmed) {
					this._nativeHostService.relaunch({ addArgs: [`--inspect-extensions=${randomPort()}`] });
				}
			});
		}

		this._setState(ProfileSessionState.Starting);

		return this._instantiationService.createInstance(ExtensionHostProfiler, inspectPort).start().then((value) => {
			this._profileSession = value;
			this._setState(ProfileSessionState.Running);
		}, (err) => {
			onUnexpectedError(err);
			this._setState(ProfileSessionState.None);
		});
	}

	public stopProfiling(): void {
		if (this._state !== ProfileSessionState.Running || !this._profileSession) {
			return;
		}

		this._setState(ProfileSessionState.Stopping);
		this._profileSession.stop().then((result) => {
			this._setLastProfile(result);
			this._setState(ProfileSessionState.None);
		}, (err) => {
			onUnexpectedError(err);
			this._setState(ProfileSessionState.None);
		});
		this._profileSession = null;
	}

	private _setLastProfile(profile: IExtensionHostProfile) {
		this._profile = profile;
		this._onDidChangeLastProfile.fire(undefined);
	}

	getUnresponsiveProfile(extensionId: ExtensionIdentifier): IExtensionHostProfile | undefined {
		return this._unresponsiveProfiles.get(ExtensionIdentifier.toKey(extensionId));
	}

	setUnresponsiveProfile(extensionId: ExtensionIdentifier, profile: IExtensionHostProfile): void {
		this._unresponsiveProfiles.set(ExtensionIdentifier.toKey(extensionId), profile);
		this._setLastProfile(profile);
	}

}
