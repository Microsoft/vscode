/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { EDITOR_FONT_DEFAULTS } from 'vs/editor/common/config/editorOptions';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { LinuxDistro } from 'vs/workbench/contrib/terminal/browser/terminal';

class TestTerminalConfigHelper extends TerminalConfigHelper {
	set linuxDistro(distro: LinuxDistro) {
		this._linuxDistro = distro;
	}
}

suite('Workbench - TerminalConfigHelper', () => {
	let fixture: HTMLElement;

	setup(() => {
		fixture = document.body;
	});

	test('TerminalConfigHelper - getFont fontFamily', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
		await configurationService.setUserConfiguration('terminal', { integrated: { fontFamily: 'bar' } });
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontFamily, 'bar', 'terminal.integrated.fontFamily should be selected over editor.fontFamily');
	});

	test('TerminalConfigHelper - getFont fontFamily (Linux Fedora)', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
		await configurationService.setUserConfiguration('terminal', { integrated: { fontFamily: null } });
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.linuxDistro = LinuxDistro.Fedora;
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontFamily, '\'DejaVu Sans Mono\', monospace', 'Fedora should have its font overridden when terminal.integrated.fontFamily not set');
	});

	test('TerminalConfigHelper - getFont fontFamily (Linux Ubuntu)', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
		await configurationService.setUserConfiguration('terminal', { integrated: { fontFamily: null } });
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.linuxDistro = LinuxDistro.Ubuntu;
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontFamily, '\'Ubuntu Mono\', monospace', 'Ubuntu should have its font overridden when terminal.integrated.fontFamily not set');
	});

	test('TerminalConfigHelper - getFont fontFamily (Linux Unknown)', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
		await configurationService.setUserConfiguration('terminal', { integrated: { fontFamily: null } });
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontFamily, 'foo', 'editor.fontFamily should be the fallback when terminal.integrated.fontFamily not set');
	});

	test('TerminalConfigHelper - getFont fontSize', async () => {
		const configurationService = new TestConfigurationService();

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo',
			fontSize: 9
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 'bar',
				fontSize: 10
			}
		});
		let configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, 10, 'terminal.integrated.fontSize should be selected over editor.fontSize');

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: null,
				fontSize: 0
			}
		});
		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.linuxDistro = LinuxDistro.Ubuntu;
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, 8, 'The minimum terminal font size (with adjustment) should be used when terminal.integrated.fontSize less than it');

		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, 6, 'The minimum terminal font size should be used when terminal.integrated.fontSize less than it');

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 0,
				fontSize: 1500
			}
		});
		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, 25, 'The maximum terminal font size should be used when terminal.integrated.fontSize more than it');

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 0,
				fontSize: null
			}
		});
		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.linuxDistro = LinuxDistro.Ubuntu;
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, EDITOR_FONT_DEFAULTS.fontSize + 2, 'The default editor font size (with adjustment) should be used when terminal.integrated.fontSize is not set');

		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().fontSize, EDITOR_FONT_DEFAULTS.fontSize, 'The default editor font size should be used when terminal.integrated.fontSize is not set');
	});

	test('TerminalConfigHelper - getFont lineHeight', async () => {
		const configurationService = new TestConfigurationService();

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo',
			lineHeight: 1
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 0,
				lineHeight: 2
			}
		});
		let configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().lineHeight, 2, 'terminal.integrated.lineHeight should be selected over editor.lineHeight');

		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'foo',
			lineHeight: 1
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 0,
				lineHeight: 0
			}
		});
		configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.getFont().lineHeight, 1, 'editor.lineHeight should be 1 when terminal.integrated.lineHeight not set');
	});

	test('TerminalConfigHelper - isMonospace monospace', async function () {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 'monospace'
			}
		});

		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), true, 'monospace is monospaced');
	});

	test('TerminalConfigHelper - isMonospace sans-serif', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 'sans-serif'
			}
		});
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), false, 'sans-serif is not monospaced');
	});

	test('TerminalConfigHelper - isMonospace serif', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 'serif'
			}
		});
		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), false, 'serif is not monospaced');
	});

	test('TerminalConfigHelper - isMonospace monospace falls back to editor.fontFamily', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'monospace'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: null
			}
		});

		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), true, 'monospace is monospaced');
	});

	test('TerminalConfigHelper - isMonospace sans-serif falls back to editor.fontFamily', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'sans-serif'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: null
			}
		});

		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), false, 'sans-serif is not monospaced');
	});

	test('TerminalConfigHelper - isMonospace serif falls back to editor.fontFamily', async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', {
			fontFamily: 'serif'
		});
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: null
			}
		});

		const configHelper = new TestTerminalConfigHelper(configurationService, null!, null!, null!, null!, null!);
		configHelper.panelContainer = fixture;
		assert.strictEqual(configHelper.configFontIsMonospace(), false, 'serif is not monospaced');
	});
});
