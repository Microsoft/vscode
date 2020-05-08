/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/actions';

import { Action } from 'vs/base/common/actions';
import * as nls from 'vs/nls';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { domEvent } from 'vs/base/browser/event';
import { Event } from 'vs/base/common/event';
import { IDisposable, toDisposable, dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { getDomNodePagePosition, createStyleSheet, createCSSRule, append, $ } from 'vs/base/browser/dom';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Context } from 'vs/platform/contextkey/browser/contextKeyService';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { timeout } from 'vs/base/common/async';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { clamp } from 'vs/base/common/numbers';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';

class InspectContextKeysAction extends Action {

	static readonly ID = 'workbench.action.inspectContextKeys';
	static readonly LABEL = nls.localize('inspect context keys', "Inspect Context Keys");

	constructor(
		id: string,
		label: string,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const disposables = new DisposableStore();

		const stylesheet = createStyleSheet();
		disposables.add(toDisposable(() => {
			if (stylesheet.parentNode) {
				stylesheet.parentNode.removeChild(stylesheet);
			}
		}));
		createCSSRule('*', 'cursor: crosshair !important;', stylesheet);

		const hoverFeedback = document.createElement('div');
		document.body.appendChild(hoverFeedback);
		disposables.add(toDisposable(() => document.body.removeChild(hoverFeedback)));

		hoverFeedback.style.position = 'absolute';
		hoverFeedback.style.pointerEvents = 'none';
		hoverFeedback.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
		hoverFeedback.style.zIndex = '1000';

		const onMouseMove = domEvent(document.body, 'mousemove', true);
		disposables.add(onMouseMove(e => {
			const target = e.target as HTMLElement;
			const position = getDomNodePagePosition(target);

			hoverFeedback.style.top = `${position.top}px`;
			hoverFeedback.style.left = `${position.left}px`;
			hoverFeedback.style.width = `${position.width}px`;
			hoverFeedback.style.height = `${position.height}px`;
		}));

		const onMouseDown = Event.once(domEvent(document.body, 'mousedown', true));
		onMouseDown(e => { e.preventDefault(); e.stopPropagation(); }, null, disposables);

		const onMouseUp = Event.once(domEvent(document.body, 'mouseup', true));
		onMouseUp(e => {
			e.preventDefault();
			e.stopPropagation();

			const context = this.contextKeyService.getContext(e.target as HTMLElement) as Context;
			console.log(context.collectAllValues());

			dispose(disposables);
		}, null, disposables);
	}
}

class ToggleScreencastModeAction extends Action {

	static readonly ID = 'workbench.action.toggleScreencastMode';
	static readonly LABEL = nls.localize('toggle screencast mode', "Toggle Screencast Mode");

	static disposable: IDisposable | undefined;

	constructor(
		id: string,
		label: string,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		if (ToggleScreencastModeAction.disposable) {
			ToggleScreencastModeAction.disposable.dispose();
			ToggleScreencastModeAction.disposable = undefined;
			return;
		}

		const disposables = new DisposableStore();

		const container = this.layoutService.container;
		const mouseMarker = append(container, $('.screencast-mouse'));
		disposables.add(toDisposable(() => mouseMarker.remove()));

		const onMouseDown = domEvent(container, 'mousedown', true);
		const onMouseUp = domEvent(container, 'mouseup', true);
		const onMouseMove = domEvent(container, 'mousemove', true);

		disposables.add(onMouseDown(e => {
			mouseMarker.style.top = `${e.clientY - 10}px`;
			mouseMarker.style.left = `${e.clientX - 10}px`;
			mouseMarker.style.display = 'block';

			const mouseMoveListener = onMouseMove(e => {
				mouseMarker.style.top = `${e.clientY - 10}px`;
				mouseMarker.style.left = `${e.clientX - 10}px`;
			});

			Event.once(onMouseUp)(() => {
				mouseMarker.style.display = 'none';
				mouseMoveListener.dispose();
			});
		}));

		const keyboardMarker = append(container, $('.screencast-keyboard'));
		disposables.add(toDisposable(() => keyboardMarker.remove()));

		const updateKeyboardMarker = () => {
			keyboardMarker.style.bottom = `${clamp(this.configurationService.getValue<number>('screencastMode.verticalOffset') || 0, 0, 90)}%`;
		};

		updateKeyboardMarker();
		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('screencastMode.verticalOffset')) {
				updateKeyboardMarker();
			}
		}));

		const onKeyDown = domEvent(window, 'keydown', true);
		let keyboardTimeout: IDisposable = Disposable.None;
		let length = 0;

		disposables.add(onKeyDown(e => {
			keyboardTimeout.dispose();

			const event = new StandardKeyboardEvent(e);
			const shortcut = this.keybindingService.softDispatch(event, event.target);

			if (shortcut || !this.configurationService.getValue<boolean>('screencastMode.onlyKeyboardShortcuts')) {
				if (
					event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
					|| length > 20
					|| event.keyCode === KeyCode.Backspace || event.keyCode === KeyCode.Escape
				) {
					keyboardMarker.innerHTML = '';
					length = 0;
				}

				const keybinding = this.keybindingService.resolveKeyboardEvent(event);
				const label = keybinding.getLabel();
				const key = $('span.key', {}, label || '');
				length++;
				append(keyboardMarker, key);
			}

			const promise = timeout(800);
			keyboardTimeout = toDisposable(() => promise.cancel());

			promise.then(() => {
				keyboardMarker.textContent = '';
				length = 0;
			});
		}));

		ToggleScreencastModeAction.disposable = disposables;
	}
}

class LogStorageAction extends Action {

	static readonly ID = 'workbench.action.logStorage';
	static readonly LABEL = nls.localize({ key: 'logStorage', comment: ['A developer only action to log the contents of the storage for the current window.'] }, "Log Storage Database Contents");

	constructor(
		id: string,
		label: string,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		this.storageService.logStorage();
	}
}

class LogWorkingCopiesAction extends Action {

	static readonly ID = 'workbench.action.logWorkingCopies';
	static readonly LABEL = nls.localize({ key: 'logWorkingCopies', comment: ['A developer only action to log the working copies that exist.'] }, "Log Working Copies");

	constructor(
		id: string,
		label: string,
		@ILogService private logService: ILogService,
		@IWorkingCopyService private workingCopyService: IWorkingCopyService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const msg = [
			`Dirty Working Copies:`,
			...this.workingCopyService.dirtyWorkingCopies.map(workingCopy => workingCopy.resource.toString(true)),
			``,
			`All Working Copies:`,
			...this.workingCopyService.workingCopies.map(workingCopy => workingCopy.resource.toString(true)),
		];

		this.logService.info(msg.join('\n'));
	}
}

// --- Actions Registration

const developerCategory = nls.localize('developer', "Developer");
const registry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(InspectContextKeysAction), 'Developer: Inspect Context Keys', developerCategory);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleScreencastModeAction), 'Developer: Toggle Screencast Mode', developerCategory);
registry.registerWorkbenchAction(SyncActionDescriptor.from(LogStorageAction), 'Developer: Log Storage Database Contents', developerCategory);
registry.registerWorkbenchAction(SyncActionDescriptor.from(LogWorkingCopiesAction), 'Developer: Log Working Copies', developerCategory);

// Screencast Mode
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'screencastMode',
	order: 9,
	title: nls.localize('screencastModeConfigurationTitle', "Screencast Mode"),
	type: 'object',
	properties: {
		'screencastMode.verticalOffset': {
			type: 'number',
			default: 20,
			minimum: 0,
			maximum: 90,
			description: nls.localize('screencastMode.location.verticalPosition', "Controls the vertical offset of the screencast mode overlay from the bottom as a percentage of the workbench height.")
		},
		'screencastMode.onlyKeyboardShortcuts': {
			type: 'boolean',
			description: nls.localize('screencastMode.onlyKeyboardShortcuts', "Only show keyboard shortcuts in Screencast Mode."),
			default: false
		}
	}
});
