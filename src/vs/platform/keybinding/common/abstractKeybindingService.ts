/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as arrays from 'vs/base/common/arrays';
import { IntervalTimer, TimeoutTimer } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode, Keybinding, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextKeyService, IContextKeyServiceTarget } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingEvent, IKeybindingService, IKeyboardEvent, KeybindingsSchemaContribution } from 'vs/platform/keybinding/common/keybinding';
import { IResolveResult, KeybindingResolver } from 'vs/platform/keybinding/common/keybindingResolver';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { ILogService } from 'vs/platform/log/common/log';

interface CurrentChord {
	keypress: string;
	label: string | null;
}

export abstract class AbstractKeybindingService extends Disposable implements IKeybindingService {
	public _serviceBrand: undefined;

	protected readonly _onDidUpdateKeybindings: Emitter<IKeybindingEvent> = this._register(new Emitter<IKeybindingEvent>());
	get onDidUpdateKeybindings(): Event<IKeybindingEvent> {
		return this._onDidUpdateKeybindings ? this._onDidUpdateKeybindings.event : Event.None; // Sinon stubbing walks properties on prototype
	}

	private _currentChord: CurrentChord | null;
	private _currentChordChecker: IntervalTimer;
	private _currentChordStatusMessage: IDisposable | null;
	private _currentSingleModifier: null | string;
	private _currentSingleModifierClearTimeout: TimeoutTimer;

	protected _logging: boolean;

	public get inChordMode(): boolean {
		return !!this._currentChord;
	}

	constructor(
		private _contextKeyService: IContextKeyService,
		protected _commandService: ICommandService,
		protected _telemetryService: ITelemetryService,
		private _notificationService: INotificationService,
		protected _logService: ILogService,
	) {
		super();

		this._currentChord = null;
		this._currentChordChecker = new IntervalTimer();
		this._currentChordStatusMessage = null;
		this._currentSingleModifier = null;
		this._currentSingleModifierClearTimeout = new TimeoutTimer();
		this._logging = false;
	}

	public override dispose(): void {
		super.dispose();
	}

	protected abstract _getResolver(): KeybindingResolver;
	protected abstract _documentHasFocus(): boolean;
	public abstract resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[];
	public abstract resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding;
	public abstract resolveUserBinding(userBinding: string): ResolvedKeybinding[];
	public abstract registerSchemaContribution(contribution: KeybindingsSchemaContribution): void;
	public abstract _dumpDebugInfo(): string;
	public abstract _dumpDebugInfoJSON(): string;

	public getDefaultKeybindingsContent(): string {
		return '';
	}

	public toggleLogging(): boolean {
		this._logging = !this._logging;
		return this._logging;
	}

	protected _log(str: string): void {
		if (this._logging) {
			this._logService.info(`[KeybindingService]: ${str}`);
		}
	}

	public getDefaultKeybindings(): readonly ResolvedKeybindingItem[] {
		return this._getResolver().getDefaultKeybindings();
	}

	public getKeybindings(): readonly ResolvedKeybindingItem[] {
		return this._getResolver().getKeybindings();
	}

	public customKeybindingsCount(): number {
		return 0;
	}

	public lookupKeybindings(commandId: string): ResolvedKeybinding[] {
		return arrays.coalesce(
			this._getResolver().lookupKeybindings(commandId).map(item => item.resolvedKeybinding)
		);
	}

	public lookupKeybinding(commandId: string): ResolvedKeybinding | undefined {
		const result = this._getResolver().lookupPrimaryKeybinding(commandId);
		if (!result) {
			return undefined;
		}
		return result.resolvedKeybinding;
	}

	public dispatchEvent(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		return this._dispatch(e, target);
	}

	public softDispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): IResolveResult | null {
		const keybinding = this.resolveKeyboardEvent(e);
		if (keybinding.isChord()) {
			console.warn('Unexpected keyboard event mapped to a chord');
			return null;
		}
		const [firstPart,] = keybinding.getDispatchParts();
		if (firstPart === null) {
			// cannot be dispatched, probably only modifier keys
			return null;
		}

		const contextValue = this._contextKeyService.getContext(target);
		const currentChord = this._currentChord ? this._currentChord.keypress : null;
		return this._getResolver().resolve(contextValue, currentChord, firstPart);
	}

	private _enterChordMode(firstPart: string, keypressLabel: string | null): void {
		this._currentChord = {
			keypress: firstPart,
			label: keypressLabel
		};
		this._currentChordStatusMessage = this._notificationService.status(nls.localize('first.chord', "({0}) was pressed. Waiting for second key of chord...", keypressLabel));
		const chordEnterTime = Date.now();
		this._currentChordChecker.cancelAndSet(() => {

			if (!this._documentHasFocus()) {
				// Focus has been lost => leave chord mode
				this._leaveChordMode();
				return;
			}

			if (Date.now() - chordEnterTime > 5000) {
				// 5 seconds elapsed => leave chord mode
				this._leaveChordMode();
			}

		}, 500);
	}

	private _leaveChordMode(): void {
		if (this._currentChordStatusMessage) {
			this._currentChordStatusMessage.dispose();
			this._currentChordStatusMessage = null;
		}
		this._currentChordChecker.cancel();
		this._currentChord = null;
	}

	public dispatchByUserSettingsLabel(userSettingsLabel: string, target: IContextKeyServiceTarget): void {
		const keybindings = this.resolveUserBinding(userSettingsLabel);
		if (keybindings.length >= 1) {
			this._doDispatch(keybindings[0], target, /*isSingleModiferChord*/false);
		}
	}

	protected _dispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		return this._doDispatch(this.resolveKeyboardEvent(e), target, /*isSingleModiferChord*/false);
	}

	protected _singleModifierDispatch(e: IKeyboardEvent, target: IContextKeyServiceTarget): boolean {
		const keybinding = this.resolveKeyboardEvent(e);
		const [singleModifier,] = keybinding.getSingleModifierDispatchParts();

		if (singleModifier !== null && this._currentSingleModifier === null) {
			// we have a valid `singleModifier`, store it for the next keyup, but clear it in 300ms
			this._log(`+ Storing single modifier for possible chord ${singleModifier}.`);
			this._currentSingleModifier = singleModifier;
			this._currentSingleModifierClearTimeout.cancelAndSet(() => {
				this._log(`+ Clearing single modifier due to 300ms elapsed.`);
				this._currentSingleModifier = null;
			}, 300);
			return false;
		}

		if (singleModifier !== null && singleModifier === this._currentSingleModifier) {
			// bingo!
			this._log(`/ Dispatching single modifier chord ${singleModifier} ${singleModifier}`);
			this._currentSingleModifierClearTimeout.cancel();
			this._currentSingleModifier = null;
			return this._doDispatch(keybinding, target, /*isSingleModiferChord*/true);
		}

		this._currentSingleModifierClearTimeout.cancel();
		this._currentSingleModifier = null;
		return false;
	}

	private _doDispatch(keybinding: ResolvedKeybinding, target: IContextKeyServiceTarget, isSingleModiferChord = false): boolean {
		let shouldPreventDefault = false;

		if (keybinding.isChord()) {
			console.warn('Unexpected keyboard event mapped to a chord');
			return false;
		}

		let firstPart: string | null = null; // the first keybinding i.e. Ctrl+K
		let currentChord: string | null = null;// the "second" keybinding i.e. Ctrl+K "Ctrl+D"

		if (isSingleModiferChord) {
			const [dispatchKeyname,] = keybinding.getSingleModifierDispatchParts();
			firstPart = dispatchKeyname;
			currentChord = dispatchKeyname;
		} else {
			[firstPart,] = keybinding.getDispatchParts();
			currentChord = this._currentChord ? this._currentChord.keypress : null;
		}

		if (firstPart === null) {
			this._log(`\\ Keyboard event cannot be dispatched in keydown phase.`);
			// cannot be dispatched, probably only modifier keys
			return shouldPreventDefault;
		}

		const contextValue = this._contextKeyService.getContext(target);
		const keypressLabel = keybinding.getLabel();
		const resolveResult = this._getResolver().resolve(contextValue, currentChord, firstPart);

		this._logService.trace('KeybindingService#dispatch', keypressLabel, resolveResult?.commandId);

		if (resolveResult && resolveResult.enterChord) {
			shouldPreventDefault = true;
			this._enterChordMode(firstPart, keypressLabel);
			return shouldPreventDefault;
		}

		if (this._currentChord) {
			if (!resolveResult || !resolveResult.commandId) {
				this._notificationService.status(nls.localize('missing.chord', "The key combination ({0}, {1}) is not a command.", this._currentChord.label, keypressLabel), { hideAfter: 10 * 1000 /* 10s */ });
				shouldPreventDefault = true;
			}
		}

		this._leaveChordMode();

		if (resolveResult && resolveResult.commandId) {
			if (!resolveResult.bubble) {
				shouldPreventDefault = true;
			}
			if (typeof resolveResult.commandArgs === 'undefined') {
				this._commandService.executeCommand(resolveResult.commandId).then(undefined, err => this._notificationService.warn(err));
			} else {
				this._commandService.executeCommand(resolveResult.commandId, resolveResult.commandArgs).then(undefined, err => this._notificationService.warn(err));
			}
			this._telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: resolveResult.commandId, from: 'keybinding' });
		}

		return shouldPreventDefault;
	}

	mightProducePrintableCharacter(event: IKeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey) {
			// ignore ctrl/cmd-combination but not shift/alt-combinatios
			return false;
		}
		// weak check for certain ranges. this is properly implemented in a subclass
		// with access to the KeyboardMapperFactory.
		if ((event.keyCode >= KeyCode.KEY_A && event.keyCode <= KeyCode.KEY_Z)
			|| (event.keyCode >= KeyCode.KEY_0 && event.keyCode <= KeyCode.KEY_9)) {
			return true;
		}
		return false;
	}
}
