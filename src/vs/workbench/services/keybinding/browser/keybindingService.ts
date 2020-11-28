/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import * as dom from 'vs/base/browser/dom';
import { printKeyboardEvent, printStandardKeyboardEvent, StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Emitter, Event } from 'vs/base/common/event';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Keybinding, ResolvedKeybinding, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingParser } from 'vs/base/common/keybindingParser';
import { OS, OperatingSystem, isMacintosh } from 'vs/base/common/platform';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Extensions as ConfigExtensions, IConfigurationNode, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr, IContextKeyService, ContextKeyExpression, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { Extensions, IJSONContributionRegistry } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { AbstractKeybindingService } from 'vs/platform/keybinding/common/abstractKeybindingService';
import { IKeyboardEvent, IUserFriendlyKeybinding, KeybindingSource, IKeybindingService, IKeybindingEvent, KeybindingsSchemaContribution } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingResolver } from 'vs/platform/keybinding/common/keybindingResolver';
import { IKeybindingItem, IKeybindingRule2, KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionMessageCollector, ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { IUserKeybindingItem, KeybindingIO, OutputBuilder } from 'vs/workbench/services/keybinding/common/keybindingIO';
import { IKeyboardMapper } from 'vs/platform/keyboardLayout/common/keyboardMapper';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { MenuRegistry } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { commandsExtensionPoint } from 'vs/workbench/api/common/menusExtensionPoint';
import { Disposable } from 'vs/base/common/lifecycle';
import { RunOnceScheduler } from 'vs/base/common/async';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { parse } from 'vs/base/common/json';
import * as objects from 'vs/base/common/objects';
import { IKeyboardLayoutService } from 'vs/platform/keyboardLayout/common/keyboardLayout';
import { getDispatchConfig } from 'vs/platform/keyboardLayout/common/dispatchConfig';
import { isArray } from 'vs/base/common/types';
import { INavigatorWithKeyboard, IKeyboard } from 'vs/workbench/services/keybinding/browser/navigatorKeyboard';
import { ScanCode, ScanCodeUtils, IMMUTABLE_CODE_TO_KEY_CODE } from 'vs/base/common/scanCode';
import { flatten } from 'vs/base/common/arrays';
import { BrowserFeatures, KeyboardSupport } from 'vs/base/browser/canIUse';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { dirname } from 'vs/base/common/resources';

interface ContributedKeyBinding {
	command: string;
	args?: any;
	key: string;
	when?: string;
	mac?: string;
	linux?: string;
	win?: string;
}

function isContributedKeyBindingsArray(thing: ContributedKeyBinding | ContributedKeyBinding[]): thing is ContributedKeyBinding[] {
	return Array.isArray(thing);
}

function isValidContributedKeyBinding(keyBinding: ContributedKeyBinding, rejects: string[]): boolean {
	if (!keyBinding) {
		rejects.push(nls.localize('nonempty', "expected non-empty value."));
		return false;
	}
	if (typeof keyBinding.command !== 'string') {
		rejects.push(nls.localize('requirestring', "property `{0}` is mandatory and must be of type `string`", 'command'));
		return false;
	}
	if (keyBinding.key && typeof keyBinding.key !== 'string') {
		rejects.push(nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'key'));
		return false;
	}
	if (keyBinding.when && typeof keyBinding.when !== 'string') {
		rejects.push(nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'when'));
		return false;
	}
	if (keyBinding.mac && typeof keyBinding.mac !== 'string') {
		rejects.push(nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'mac'));
		return false;
	}
	if (keyBinding.linux && typeof keyBinding.linux !== 'string') {
		rejects.push(nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'linux'));
		return false;
	}
	if (keyBinding.win && typeof keyBinding.win !== 'string') {
		rejects.push(nls.localize('optstring', "property `{0}` can be omitted or must be of type `string`", 'win'));
		return false;
	}
	return true;
}

let keybindingType: IJSONSchema = {
	type: 'object',
	default: { command: '', key: '' },
	properties: {
		command: {
			description: nls.localize('vscode.extension.contributes.keybindings.command', 'Identifier of the command to run when keybinding is triggered.'),
			type: 'string'
		},
		args: {
			description: nls.localize('vscode.extension.contributes.keybindings.args', "Arguments to pass to the command to execute.")
		},
		key: {
			description: nls.localize('vscode.extension.contributes.keybindings.key', 'Key or key sequence (separate keys with plus-sign and sequences with space, e.g. Ctrl+O and Ctrl+L L for a chord).'),
			type: 'string'
		},
		mac: {
			description: nls.localize('vscode.extension.contributes.keybindings.mac', 'Mac specific key or key sequence.'),
			type: 'string'
		},
		linux: {
			description: nls.localize('vscode.extension.contributes.keybindings.linux', 'Linux specific key or key sequence.'),
			type: 'string'
		},
		win: {
			description: nls.localize('vscode.extension.contributes.keybindings.win', 'Windows specific key or key sequence.'),
			type: 'string'
		},
		when: {
			description: nls.localize('vscode.extension.contributes.keybindings.when', 'Condition when the key is active.'),
			type: 'string'
		},
	}
};

const keybindingsExtPoint = ExtensionsRegistry.registerExtensionPoint<ContributedKeyBinding | ContributedKeyBinding[]>({
	extensionPoint: 'keybindings',
	deps: [commandsExtensionPoint],
	jsonSchema: {
		description: nls.localize('vscode.extension.contributes.keybindings', "Contributes keybindings."),
		oneOf: [
			keybindingType,
			{
				type: 'array',
				items: keybindingType
			}
		]
	}
});

const NUMPAD_PRINTABLE_SCANCODES = [
	ScanCode.NumpadDivide,
	ScanCode.NumpadMultiply,
	ScanCode.NumpadSubtract,
	ScanCode.NumpadAdd,
	ScanCode.Numpad1,
	ScanCode.Numpad2,
	ScanCode.Numpad3,
	ScanCode.Numpad4,
	ScanCode.Numpad5,
	ScanCode.Numpad6,
	ScanCode.Numpad7,
	ScanCode.Numpad8,
	ScanCode.Numpad9,
	ScanCode.Numpad0,
	ScanCode.NumpadDecimal
];

const otherMacNumpadMapping = new Map<ScanCode, KeyCode>();
otherMacNumpadMapping.set(ScanCode.Numpad1, KeyCode.KEY_1);
otherMacNumpadMapping.set(ScanCode.Numpad2, KeyCode.KEY_2);
otherMacNumpadMapping.set(ScanCode.Numpad3, KeyCode.KEY_3);
otherMacNumpadMapping.set(ScanCode.Numpad4, KeyCode.KEY_4);
otherMacNumpadMapping.set(ScanCode.Numpad5, KeyCode.KEY_5);
otherMacNumpadMapping.set(ScanCode.Numpad6, KeyCode.KEY_6);
otherMacNumpadMapping.set(ScanCode.Numpad7, KeyCode.KEY_7);
otherMacNumpadMapping.set(ScanCode.Numpad8, KeyCode.KEY_8);
otherMacNumpadMapping.set(ScanCode.Numpad9, KeyCode.KEY_9);
otherMacNumpadMapping.set(ScanCode.Numpad0, KeyCode.KEY_0);

export class WorkbenchKeybindingService extends AbstractKeybindingService {

	private _keyboardMapper: IKeyboardMapper;
	private _cachedResolver: KeybindingResolver | null;
	private userKeybindings: UserKeybindings;
	private isComposingGlobalContextKey: IContextKey<boolean>;
	private readonly _contributions: KeybindingsSchemaContribution[] = [];

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHostService private readonly hostService: IHostService,
		@IExtensionService extensionService: IExtensionService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@IKeyboardLayoutService private readonly keyboardLayoutService: IKeyboardLayoutService
	) {
		super(contextKeyService, commandService, telemetryService, notificationService, logService);

		this.isComposingGlobalContextKey = contextKeyService.createKey('isComposing', false);
		this.updateSchema();

		let dispatchConfig = getDispatchConfig(configurationService);
		configurationService.onDidChangeConfiguration((e) => {
			let newDispatchConfig = getDispatchConfig(configurationService);
			if (dispatchConfig === newDispatchConfig) {
				return;
			}

			dispatchConfig = newDispatchConfig;
			this._keyboardMapper = this.keyboardLayoutService.getKeyboardMapper(dispatchConfig);
			this.updateResolver({ source: KeybindingSource.Default });
		});

		this._keyboardMapper = this.keyboardLayoutService.getKeyboardMapper(dispatchConfig);
		this.keyboardLayoutService.onDidChangeKeyboardLayout(() => {
			this._keyboardMapper = this.keyboardLayoutService.getKeyboardMapper(dispatchConfig);
			this.updateResolver({ source: KeybindingSource.Default });
		});

		this._cachedResolver = null;

		this.userKeybindings = this._register(new UserKeybindings(environmentService.keybindingsResource, fileService, logService));
		this.userKeybindings.initialize().then(() => {
			if (this.userKeybindings.keybindings.length) {
				this.updateResolver({ source: KeybindingSource.User });
			}
		});
		this._register(this.userKeybindings.onDidChange(() => {
			logService.debug('User keybindings changed');
			this.updateResolver({
				source: KeybindingSource.User,
				keybindings: this.userKeybindings.keybindings
			});
		}));

		keybindingsExtPoint.setHandler((extensions) => {

			let keybindings: IKeybindingRule2[] = [];
			for (let extension of extensions) {
				this._handleKeybindingsExtensionPointUser(extension.description.identifier, extension.description.isBuiltin, extension.value, extension.collector, keybindings);
			}

			KeybindingsRegistry.setExtensionKeybindings(keybindings);
			this.updateResolver({ source: KeybindingSource.Default });
		});

		this.updateSchema();
		this._register(extensionService.onDidRegisterExtensions(() => this.updateSchema()));

		this._register(dom.addDisposableListener(window, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			this.isComposingGlobalContextKey.set(e.isComposing);
			const keyEvent = new StandardKeyboardEvent(e);
			this._log(`/ Received  keydown event - ${printKeyboardEvent(e)}`);
			this._log(`| Converted keydown event - ${printStandardKeyboardEvent(keyEvent)}`);
			const shouldPreventDefault = this._dispatch(keyEvent, keyEvent.target);
			if (shouldPreventDefault) {
				keyEvent.preventDefault();
			}
			this.isComposingGlobalContextKey.set(false);
		}));

		let data = this.keyboardLayoutService.getCurrentKeyboardLayout();
		/* __GDPR__FRAGMENT__
			"IKeyboardLayoutInfo" : {
				"name" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"id": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"text": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		/* __GDPR__FRAGMENT__
			"IKeyboardLayoutInfo" : {
				"model" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"layout": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"variant": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"options": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"rules": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		/* __GDPR__FRAGMENT__
			"IKeyboardLayoutInfo" : {
				"id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"lang": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		/* __GDPR__
			"keyboardLayout" : {
				"currentKeyboardLayout": { "${inline}": [ "${IKeyboardLayoutInfo}" ] }
			}
		*/
		telemetryService.publicLog('keyboardLayout', {
			currentKeyboardLayout: data
		});

		this._register(browser.onDidChangeFullscreen(() => {
			const keyboard: IKeyboard | null = (<INavigatorWithKeyboard>navigator).keyboard;

			if (BrowserFeatures.keyboard === KeyboardSupport.None) {
				return;
			}

			if (browser.isFullscreen()) {
				keyboard?.lock(['Escape']);
			} else {
				keyboard?.unlock();
			}

			// update resolver which will bring back all unbound keyboard shortcuts
			this._cachedResolver = null;
			this._onDidUpdateKeybindings.fire({ source: KeybindingSource.User });
		}));
	}

	public registerSchemaContribution(contribution: KeybindingsSchemaContribution): void {
		this._contributions.push(contribution);
		if (contribution.onDidChange) {
			this._register(contribution.onDidChange(() => this.updateSchema()));
		}
		this.updateSchema();
	}

	private updateSchema() {
		updateSchema(flatten(this._contributions.map(x => x.getSchemaAdditions())));
	}

	public _dumpDebugInfo(): string {
		const layoutInfo = JSON.stringify(this.keyboardLayoutService.getCurrentKeyboardLayout(), null, '\t');
		const mapperInfo = this._keyboardMapper.dumpDebugInfo();
		const rawMapping = JSON.stringify(this.keyboardLayoutService.getRawKeyboardMapping(), null, '\t');
		return `Layout info:\n${layoutInfo}\n${mapperInfo}\n\nRaw mapping:\n${rawMapping}`;
	}

	public _dumpDebugInfoJSON(): string {
		const info = {
			layout: this.keyboardLayoutService.getCurrentKeyboardLayout(),
			rawMapping: this.keyboardLayoutService.getRawKeyboardMapping()
		};
		return JSON.stringify(info, null, '\t');
	}

	public customKeybindingsCount(): number {
		return this.userKeybindings.keybindings.length;
	}

	private updateResolver(event: IKeybindingEvent): void {
		this._cachedResolver = null;
		this._onDidUpdateKeybindings.fire(event);
	}

	protected _getResolver(): KeybindingResolver {
		if (!this._cachedResolver) {
			const defaults = this._resolveKeybindingItems(KeybindingsRegistry.getDefaultKeybindings(), true);
			const overrides = this._resolveUserKeybindingItems(this.userKeybindings.keybindings.map((k) => KeybindingIO.readUserKeybindingItem(k)), false);
			this._cachedResolver = new KeybindingResolver(defaults, overrides, (str) => this._log(str));
		}
		return this._cachedResolver;
	}

	protected _documentHasFocus(): boolean {
		// it is possible that the document has lost focus, but the
		// window is still focused, e.g. when a <webview> element
		// has focus
		return this.hostService.hasFocus;
	}

	private _resolveKeybindingItems(items: IKeybindingItem[], isDefault: boolean): ResolvedKeybindingItem[] {
		let result: ResolvedKeybindingItem[] = [], resultLen = 0;
		for (const item of items) {
			const when = item.when || undefined;
			const keybinding = item.keybinding;
			if (!keybinding) {
				// This might be a removal keybinding item in user settings => accept it
				result[resultLen++] = new ResolvedKeybindingItem(undefined, item.command, item.commandArgs, when, isDefault, item.extensionId, item.isBuiltinExtension);
			} else {
				if (this._assertBrowserConflicts(keybinding, item.command)) {
					continue;
				}

				const resolvedKeybindings = this.resolveKeybinding(keybinding);
				for (let i = resolvedKeybindings.length - 1; i >= 0; i--) {
					const resolvedKeybinding = resolvedKeybindings[i];
					result[resultLen++] = new ResolvedKeybindingItem(resolvedKeybinding, item.command, item.commandArgs, when, isDefault, item.extensionId, item.isBuiltinExtension);
				}
			}
		}

		return result;
	}

	private _resolveUserKeybindingItems(items: IUserKeybindingItem[], isDefault: boolean): ResolvedKeybindingItem[] {
		let result: ResolvedKeybindingItem[] = [], resultLen = 0;
		for (const item of items) {
			const when = item.when || undefined;
			const parts = item.parts;
			if (parts.length === 0) {
				// This might be a removal keybinding item in user settings => accept it
				result[resultLen++] = new ResolvedKeybindingItem(undefined, item.command, item.commandArgs, when, isDefault, null, false);
			} else {
				const resolvedKeybindings = this._keyboardMapper.resolveUserBinding(parts);
				for (const resolvedKeybinding of resolvedKeybindings) {
					result[resultLen++] = new ResolvedKeybindingItem(resolvedKeybinding, item.command, item.commandArgs, when, isDefault, null, false);
				}
			}
		}

		return result;
	}

	private _assertBrowserConflicts(kb: Keybinding, commandId: string): boolean {
		if (BrowserFeatures.keyboard === KeyboardSupport.Always) {
			return false;
		}

		if (BrowserFeatures.keyboard === KeyboardSupport.FullScreen && browser.isFullscreen()) {
			return false;
		}

		for (let part of kb.parts) {
			if (!part.metaKey && !part.altKey && !part.ctrlKey && !part.shiftKey) {
				continue;
			}

			const modifiersMask = KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift;

			let partModifiersMask = 0;
			if (part.metaKey) {
				partModifiersMask |= KeyMod.CtrlCmd;
			}

			if (part.shiftKey) {
				partModifiersMask |= KeyMod.Shift;
			}

			if (part.altKey) {
				partModifiersMask |= KeyMod.Alt;
			}

			if (part.ctrlKey && OS === OperatingSystem.Macintosh) {
				partModifiersMask |= KeyMod.WinCtrl;
			}

			if ((partModifiersMask & modifiersMask) === KeyMod.CtrlCmd && part.keyCode === KeyCode.KEY_W) {
				// console.warn('Ctrl/Cmd+W keybindings should not be used by default in web. Offender: ', kb.getHashCode(), ' for ', commandId);

				return true;
			}

			if ((partModifiersMask & modifiersMask) === KeyMod.CtrlCmd && part.keyCode === KeyCode.KEY_N) {
				// console.warn('Ctrl/Cmd+N keybindings should not be used by default in web. Offender: ', kb.getHashCode(), ' for ', commandId);

				return true;
			}

			if ((partModifiersMask & modifiersMask) === KeyMod.CtrlCmd && part.keyCode === KeyCode.KEY_T) {
				// console.warn('Ctrl/Cmd+T keybindings should not be used by default in web. Offender: ', kb.getHashCode(), ' for ', commandId);

				return true;
			}

			if ((partModifiersMask & modifiersMask) === (KeyMod.CtrlCmd | KeyMod.Alt) && (part.keyCode === KeyCode.LeftArrow || part.keyCode === KeyCode.RightArrow)) {
				// console.warn('Ctrl/Cmd+Arrow keybindings should not be used by default in web. Offender: ', kb.getHashCode(), ' for ', commandId);

				return true;
			}

			if ((partModifiersMask & modifiersMask) === KeyMod.CtrlCmd && part.keyCode >= KeyCode.KEY_0 && part.keyCode <= KeyCode.KEY_9) {
				// console.warn('Ctrl/Cmd+Num keybindings should not be used by default in web. Offender: ', kb.getHashCode(), ' for ', commandId);

				return true;
			}
		}

		return false;
	}

	public resolveKeybinding(kb: Keybinding): ResolvedKeybinding[] {
		return this._keyboardMapper.resolveKeybinding(kb);
	}

	public resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding {
		this.keyboardLayoutService.validateCurrentKeyboardMapping(keyboardEvent);
		return this._keyboardMapper.resolveKeyboardEvent(keyboardEvent);
	}

	public resolveUserBinding(userBinding: string): ResolvedKeybinding[] {
		const parts = KeybindingParser.parseUserBinding(userBinding);
		return this._keyboardMapper.resolveUserBinding(parts);
	}

	private _handleKeybindingsExtensionPointUser(extensionId: ExtensionIdentifier, isBuiltin: boolean, keybindings: ContributedKeyBinding | ContributedKeyBinding[], collector: ExtensionMessageCollector, result: IKeybindingRule2[]): void {
		if (isContributedKeyBindingsArray(keybindings)) {
			for (let i = 0, len = keybindings.length; i < len; i++) {
				this._handleKeybinding(extensionId, isBuiltin, i + 1, keybindings[i], collector, result);
			}
		} else {
			this._handleKeybinding(extensionId, isBuiltin, 1, keybindings, collector, result);
		}
	}

	private _handleKeybinding(extensionId: ExtensionIdentifier, isBuiltin: boolean, idx: number, keybindings: ContributedKeyBinding, collector: ExtensionMessageCollector, result: IKeybindingRule2[]): void {

		let rejects: string[] = [];

		if (isValidContributedKeyBinding(keybindings, rejects)) {
			let rule = this._asCommandRule(extensionId, isBuiltin, idx++, keybindings);
			if (rule) {
				result.push(rule);
			}
		}

		if (rejects.length > 0) {
			collector.error(nls.localize(
				'invalid.keybindings',
				"Invalid `contributes.{0}`: {1}",
				keybindingsExtPoint.name,
				rejects.join('\n')
			));
		}
	}

	private _asCommandRule(extensionId: ExtensionIdentifier, isBuiltin: boolean, idx: number, binding: ContributedKeyBinding): IKeybindingRule2 | undefined {

		let { command, args, when, key, mac, linux, win } = binding;

		let weight: number;
		if (isBuiltin) {
			weight = KeybindingWeight.BuiltinExtension + idx;
		} else {
			weight = KeybindingWeight.ExternalExtension + idx;
		}

		let commandAction = MenuRegistry.getCommand(command);
		let precondition = commandAction && commandAction.precondition;
		let fullWhen: ContextKeyExpression | undefined;
		if (when && precondition) {
			fullWhen = ContextKeyExpr.and(precondition, ContextKeyExpr.deserialize(when));
		} else if (when) {
			fullWhen = ContextKeyExpr.deserialize(when);
		} else if (precondition) {
			fullWhen = precondition;
		}

		let desc: IKeybindingRule2 = {
			id: command,
			args,
			when: fullWhen,
			weight: weight,
			primary: KeybindingParser.parseKeybinding(key, OS),
			mac: mac ? { primary: KeybindingParser.parseKeybinding(mac, OS) } : null,
			linux: linux ? { primary: KeybindingParser.parseKeybinding(linux, OS) } : null,
			win: win ? { primary: KeybindingParser.parseKeybinding(win, OS) } : null,
			extensionId: extensionId.value,
			isBuiltinExtension: isBuiltin
		};

		if (!desc.primary && !desc.mac && !desc.linux && !desc.win) {
			return undefined;
		}

		return desc;
	}

	public getDefaultKeybindingsContent(): string {
		const resolver = this._getResolver();
		const defaultKeybindings = resolver.getDefaultKeybindings();
		const boundCommands = resolver.getDefaultBoundCommands();
		return (
			WorkbenchKeybindingService._getDefaultKeybindings(defaultKeybindings)
			+ '\n\n'
			+ WorkbenchKeybindingService._getAllCommandsAsComment(boundCommands)
		);
	}

	private static _getDefaultKeybindings(defaultKeybindings: readonly ResolvedKeybindingItem[]): string {
		let out = new OutputBuilder();
		out.writeLine('[');

		let lastIndex = defaultKeybindings.length - 1;
		defaultKeybindings.forEach((k, index) => {
			KeybindingIO.writeKeybindingItem(out, k);
			if (index !== lastIndex) {
				out.writeLine(',');
			} else {
				out.writeLine();
			}
		});
		out.writeLine(']');
		return out.toString();
	}

	private static _getAllCommandsAsComment(boundCommands: Map<string, boolean>): string {
		const unboundCommands = KeybindingResolver.getAllUnboundCommands(boundCommands);
		let pretty = unboundCommands.sort().join('\n// - ');
		return '// ' + nls.localize('unboundCommands', "Here are other available commands: ") + '\n// - ' + pretty;
	}

	mightProducePrintableCharacter(event: IKeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			// ignore ctrl/cmd/alt-combination but not shift-combinatios
			return false;
		}
		const code = ScanCodeUtils.toEnum(event.code);

		if (NUMPAD_PRINTABLE_SCANCODES.indexOf(code) !== -1) {
			// This is a numpad key that might produce a printable character based on NumLock.
			// Let's check if NumLock is on or off based on the event's keyCode.
			// e.g.
			// - when NumLock is off, ScanCode.Numpad4 produces KeyCode.LeftArrow
			// - when NumLock is on, ScanCode.Numpad4 produces KeyCode.NUMPAD_4
			// However, ScanCode.NumpadAdd always produces KeyCode.NUMPAD_ADD
			if (event.keyCode === IMMUTABLE_CODE_TO_KEY_CODE[code]) {
				// NumLock is on or this is /, *, -, + on the numpad
				return true;
			}
			if (isMacintosh && event.keyCode === otherMacNumpadMapping.get(code)) {
				// on macOS, the numpad keys can also map to keys 1 - 0.
				return true;
			}
			return false;
		}

		const keycode = IMMUTABLE_CODE_TO_KEY_CODE[code];
		if (keycode !== -1) {
			// https://github.com/microsoft/vscode/issues/74934
			return false;
		}
		// consult the KeyboardMapperFactory to check the given event for
		// a printable value.
		const mapping = this.keyboardLayoutService.getRawKeyboardMapping();
		if (!mapping) {
			return false;
		}
		const keyInfo = mapping[event.code];
		if (!keyInfo) {
			return false;
		}
		if (!keyInfo.value || /\s/.test(keyInfo.value)) {
			return false;
		}
		return true;
	}
}

class UserKeybindings extends Disposable {

	private _keybindings: IUserFriendlyKeybinding[] = [];
	get keybindings(): IUserFriendlyKeybinding[] { return this._keybindings; }

	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly keybindingsResource: URI,
		private readonly fileService: IFileService,
		logService: ILogService,
	) {
		super();

		this._register(fileService.watch(dirname(keybindingsResource)));
		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this.reload().then(changed => {
			if (changed) {
				this._onDidChange.fire();
			}
		}), 50));
		this._register(Event.filter(this.fileService.onDidFilesChange, e => e.contains(this.keybindingsResource))(() => {
			logService.debug('Keybindings file changed');
			this.reloadConfigurationScheduler.schedule();
		}));
	}

	async initialize(): Promise<void> {
		await this.reload();
	}

	private async reload(): Promise<boolean> {
		const existing = this._keybindings;
		try {
			const content = await this.fileService.readFile(this.keybindingsResource);
			const value = parse(content.value.toString());
			this._keybindings = isArray(value) ? value : [];
		} catch (e) {
			this._keybindings = [];
		}
		return existing ? !objects.equals(existing, this._keybindings) : true;
	}
}

let schemaId = 'vscode://schemas/keybindings';
let commandsSchemas: IJSONSchema[] = [];
let commandsEnum: string[] = [];
let commandsEnumDescriptions: (string | undefined)[] = [];
let schema: IJSONSchema = {
	id: schemaId,
	type: 'array',
	title: nls.localize('keybindings.json.title', "Keybindings configuration"),
	allowTrailingCommas: true,
	allowComments: true,
	definitions: {
		'editorGroupsSchema': {
			'type': 'array',
			'items': {
				'type': 'object',
				'properties': {
					'groups': {
						'$ref': '#/definitions/editorGroupsSchema',
						'default': [{}, {}]
					},
					'size': {
						'type': 'number',
						'default': 0.5
					}
				}
			}
		}
	},
	items: {
		'required': ['key'],
		'type': 'object',
		'defaultSnippets': [{ 'body': { 'key': '$1', 'command': '$2', 'when': '$3' } }],
		'properties': {
			'key': {
				'type': 'string',
				'description': nls.localize('keybindings.json.key', "Key or key sequence (separated by space)"),
			},
			'command': {
				'anyOf': [
					{
						'type': 'string',
						'enum': commandsEnum,
						'enumDescriptions': <any>commandsEnumDescriptions,
						'description': nls.localize('keybindings.json.command', "Name of the command to execute"),
					},
					{
						'type': 'string'
					}
				]
			},
			'when': {
				'type': 'string',
				'description': nls.localize('keybindings.json.when', "Condition when the key is active.")
			},
			'args': {
				'description': nls.localize('keybindings.json.args', "Arguments to pass to the command to execute.")
			}
		},
		'allOf': commandsSchemas
	}
};

let schemaRegistry = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution);
schemaRegistry.registerSchema(schemaId, schema);

function updateSchema(additionalContributions: readonly IJSONSchema[]) {
	commandsSchemas.length = 0;
	commandsEnum.length = 0;
	commandsEnumDescriptions.length = 0;

	const knownCommands = new Set<string>();
	const addKnownCommand = (commandId: string, description?: string | undefined) => {
		if (!/^_/.test(commandId)) {
			if (!knownCommands.has(commandId)) {
				knownCommands.add(commandId);

				commandsEnum.push(commandId);
				commandsEnumDescriptions.push(description);

				// Also add the negative form for keybinding removal
				commandsEnum.push(`-${commandId}`);
				commandsEnumDescriptions.push(description);
			}
		}
	};

	const allCommands = CommandsRegistry.getCommands();
	for (const [commandId, command] of allCommands) {
		const commandDescription = command.description;

		addKnownCommand(commandId, commandDescription ? commandDescription.description : undefined);

		if (!commandDescription || !commandDescription.args || commandDescription.args.length !== 1 || !commandDescription.args[0].schema) {
			continue;
		}

		const argsSchema = commandDescription.args[0].schema;
		const argsRequired = Array.isArray(argsSchema.required) && argsSchema.required.length > 0;
		const addition = {
			'if': {
				'properties': {
					'command': { 'const': commandId }
				}
			},
			'then': {
				'required': (<string[]>[]).concat(argsRequired ? ['args'] : []),
				'properties': {
					'args': argsSchema
				}
			}
		};

		commandsSchemas.push(addition);
	}

	const menuCommands = MenuRegistry.getCommands();
	for (const commandId of menuCommands.keys()) {
		addKnownCommand(commandId);
	}

	commandsSchemas.push(...additionalContributions);
	schemaRegistry.notifySchemaChanged(schemaId);
}

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration);
const keyboardConfiguration: IConfigurationNode = {
	'id': 'keyboard',
	'order': 15,
	'type': 'object',
	'title': nls.localize('keyboardConfigurationTitle', "Keyboard"),
	'properties': {
		'keyboard.dispatch': {
			'type': 'string',
			'enum': ['code', 'keyCode'],
			'default': 'code',
			'markdownDescription': nls.localize('dispatch', "Controls the dispatching logic for key presses to use either `code` (recommended) or `keyCode`."),
			'included': OS === OperatingSystem.Macintosh || OS === OperatingSystem.Linux
		}
	}
};

configurationRegistry.registerConfiguration(keyboardConfiguration);

registerSingleton(IKeybindingService, WorkbenchKeybindingService);
