/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { KeybindingEditorDecorationsRenderer } from 'vs/workbench/contrib/preferences/browser/keybindingsEditorContribution';

suite('KeybindingsEditorContribution', () => {

	function assertUserSettingsFuzzyEquals(a: string, b: string, expected: boolean): void {
		const actual = KeybindingEditorDecorationsRenderer._userSettingsFuzzyEquals(a, b);
		const message = expected ? `${a} == ${b}` : `${a} != ${b}`;
		assert.strictEqual(actual, expected, 'fuzzy: ' + message);
	}

	function assertEqual(a: string, b: string): void {
		assertUserSettingsFuzzyEquals(a, b, true);
	}

	function assertDifferent(a: string, b: string): void {
		assertUserSettingsFuzzyEquals(a, b, false);
	}

	test('_userSettingsFuzzyEquals', () => {
		assertEqual('a', 'a');
		assertEqual('a', 'A');
		assertEqual('ctrl+a', 'CTRL+A');
		assertEqual('ctrl+a', ' CTRL+A ');

		assertEqual('ctrl+shift+a', 'shift+ctrl+a');
		assertEqual('ctrl+shift+a ctrl+alt+b', 'shift+ctrl+a alt+ctrl+b');

		assertDifferent('ctrl+[KeyA]', 'ctrl+a');

		// issue #23335
		assertEqual('cmd+shift+p', 'shift+cmd+p');
		assertEqual('cmd+shift+p', 'shift-cmd-p');
	});
});
