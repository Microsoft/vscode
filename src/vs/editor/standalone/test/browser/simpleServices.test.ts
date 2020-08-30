/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { KeyCode } from 'vs/base/common/keyCodes';
import { SimpleConfigurationService, SimpleNotificationService, StandaloneCommandService, StandaloneKeybindingService } from 'vs/editor/standalone/browser/simpleServices';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';

suite('StandaloneKeybindingService', () => {

	class TestStandaloneKeybindingService extends StandaloneKeybindingService {
		public testDispatch(e: IKeyboardEvent): void {
			super._dispatch(e, null!);
		}
	}

	test('issue Microsoft/monaco-editor#167', () => {

		let serviceCollection = new ServiceCollection();
		const instantiationService = new InstantiationService(serviceCollection, true);

		let configurationService = new SimpleConfigurationService();

		let contextKeyService = new ContextKeyService(configurationService);

		let commandService = new StandaloneCommandService(instantiationService);

		let notificationService = new SimpleNotificationService();

		let domElement = document.createElement('div');

		let keybindingService = new TestStandaloneKeybindingService(contextKeyService, commandService, NullTelemetryService, notificationService, domElement);

		let commandInvoked = false;
		keybindingService.addDynamicKeybinding('testCommand', KeyCode.F9, () => {
			commandInvoked = true;
		}, undefined);

		keybindingService.testDispatch({
			_standardKeyboardEventBrand: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			metaKey: false,
			keyCode: KeyCode.F9,
			code: null!
		});

		assert.ok(commandInvoked, 'command invoked');
	});
});
