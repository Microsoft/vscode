/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI as Uri } from 'vs/base/common/uri';
import { IStringDictionary } from 'vs/base/common/collections';
import { addTerminalEnvironmentKeys, mergeEnvironments, getCwd, getDefaultShell, getLangEnvVariable, shouldSetLangEnvVariable } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { isWindows, Platform } from 'vs/base/common/platform';

suite('Workbench - TerminalEnvironment', () => {
	suite('addTerminalEnvironmentKeys', () => {
		test('should set expected variables', () => {
			const env: { [key: string]: any } = {};
			addTerminalEnvironmentKeys(env, '1.2.3', 'en', 'on');
			assert.strictEqual(env['TERM_PROGRAM'], 'vscode');
			assert.strictEqual(env['TERM_PROGRAM_VERSION'], '1.2.3');
			assert.strictEqual(env['COLORTERM'], 'truecolor');
			assert.strictEqual(env['LANG'], 'en_US.UTF-8');
		});
		test('should use language variant for LANG that is provided in locale', () => {
			const env: { [key: string]: any } = {};
			addTerminalEnvironmentKeys(env, '1.2.3', 'en-au', 'on');
			assert.strictEqual(env['LANG'], 'en_AU.UTF-8', 'LANG is equal to the requested locale with UTF-8');
		});
		test('should fallback to en_US when no locale is provided', () => {
			const env2: { [key: string]: any } = { FOO: 'bar' };
			addTerminalEnvironmentKeys(env2, '1.2.3', undefined, 'on');
			assert.strictEqual(env2['LANG'], 'en_US.UTF-8', 'LANG is equal to en_US.UTF-8 as fallback.'); // More info on issue #14586
		});
		test('should fallback to en_US when an invalid locale is provided', () => {
			const env3 = { LANG: 'replace' };
			addTerminalEnvironmentKeys(env3, '1.2.3', undefined, 'on');
			assert.strictEqual(env3['LANG'], 'en_US.UTF-8', 'LANG is set to the fallback LANG');
		});
		test('should override existing LANG', () => {
			const env4 = { LANG: 'en_AU.UTF-8' };
			addTerminalEnvironmentKeys(env4, '1.2.3', undefined, 'on');
			assert.strictEqual(env4['LANG'], 'en_US.UTF-8', 'LANG is equal to the parent environment\'s LANG');
		});
	});

	suite('shouldSetLangEnvVariable', () => {
		test('auto', () => {
			assert.strictEqual(shouldSetLangEnvVariable({}, 'auto'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'auto'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'auto'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'auto'), false);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'auto'), false);
		});
		test('off', () => {
			assert.strictEqual(shouldSetLangEnvVariable({}, 'off'), false);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'off'), false);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'off'), false);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'off'), false);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'off'), false);
		});
		test('on', () => {
			assert.strictEqual(shouldSetLangEnvVariable({}, 'on'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'on'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'on'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'on'), true);
			assert.strictEqual(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'on'), true);
		});
	});

	suite('getLangEnvVariable', () => {
		test('should fallback to en_US when no locale is provided', () => {
			assert.strictEqual(getLangEnvVariable(undefined), 'en_US.UTF-8');
			assert.strictEqual(getLangEnvVariable(''), 'en_US.UTF-8');
		});
		test('should fallback to default language variants when variant isn\'t provided', () => {
			assert.strictEqual(getLangEnvVariable('af'), 'af_ZA.UTF-8');
			assert.strictEqual(getLangEnvVariable('am'), 'am_ET.UTF-8');
			assert.strictEqual(getLangEnvVariable('be'), 'be_BY.UTF-8');
			assert.strictEqual(getLangEnvVariable('bg'), 'bg_BG.UTF-8');
			assert.strictEqual(getLangEnvVariable('ca'), 'ca_ES.UTF-8');
			assert.strictEqual(getLangEnvVariable('cs'), 'cs_CZ.UTF-8');
			assert.strictEqual(getLangEnvVariable('da'), 'da_DK.UTF-8');
			assert.strictEqual(getLangEnvVariable('de'), 'de_DE.UTF-8');
			assert.strictEqual(getLangEnvVariable('el'), 'el_GR.UTF-8');
			assert.strictEqual(getLangEnvVariable('en'), 'en_US.UTF-8');
			assert.strictEqual(getLangEnvVariable('es'), 'es_ES.UTF-8');
			assert.strictEqual(getLangEnvVariable('et'), 'et_EE.UTF-8');
			assert.strictEqual(getLangEnvVariable('eu'), 'eu_ES.UTF-8');
			assert.strictEqual(getLangEnvVariable('fi'), 'fi_FI.UTF-8');
			assert.strictEqual(getLangEnvVariable('fr'), 'fr_FR.UTF-8');
			assert.strictEqual(getLangEnvVariable('he'), 'he_IL.UTF-8');
			assert.strictEqual(getLangEnvVariable('hr'), 'hr_HR.UTF-8');
			assert.strictEqual(getLangEnvVariable('hu'), 'hu_HU.UTF-8');
			assert.strictEqual(getLangEnvVariable('hy'), 'hy_AM.UTF-8');
			assert.strictEqual(getLangEnvVariable('is'), 'is_IS.UTF-8');
			assert.strictEqual(getLangEnvVariable('it'), 'it_IT.UTF-8');
			assert.strictEqual(getLangEnvVariable('ja'), 'ja_JP.UTF-8');
			assert.strictEqual(getLangEnvVariable('kk'), 'kk_KZ.UTF-8');
			assert.strictEqual(getLangEnvVariable('ko'), 'ko_KR.UTF-8');
			assert.strictEqual(getLangEnvVariable('lt'), 'lt_LT.UTF-8');
			assert.strictEqual(getLangEnvVariable('nl'), 'nl_NL.UTF-8');
			assert.strictEqual(getLangEnvVariable('no'), 'no_NO.UTF-8');
			assert.strictEqual(getLangEnvVariable('pl'), 'pl_PL.UTF-8');
			assert.strictEqual(getLangEnvVariable('pt'), 'pt_BR.UTF-8');
			assert.strictEqual(getLangEnvVariable('ro'), 'ro_RO.UTF-8');
			assert.strictEqual(getLangEnvVariable('ru'), 'ru_RU.UTF-8');
			assert.strictEqual(getLangEnvVariable('sk'), 'sk_SK.UTF-8');
			assert.strictEqual(getLangEnvVariable('sl'), 'sl_SI.UTF-8');
			assert.strictEqual(getLangEnvVariable('sr'), 'sr_YU.UTF-8');
			assert.strictEqual(getLangEnvVariable('sv'), 'sv_SE.UTF-8');
			assert.strictEqual(getLangEnvVariable('tr'), 'tr_TR.UTF-8');
			assert.strictEqual(getLangEnvVariable('uk'), 'uk_UA.UTF-8');
			assert.strictEqual(getLangEnvVariable('zh'), 'zh_CN.UTF-8');
		});
		test('should set language variant based on full locale', () => {
			assert.strictEqual(getLangEnvVariable('en-AU'), 'en_AU.UTF-8');
			assert.strictEqual(getLangEnvVariable('en-au'), 'en_AU.UTF-8');
			assert.strictEqual(getLangEnvVariable('fa-ke'), 'fa_KE.UTF-8');
		});
	});

	suite('mergeEnvironments', () => {
		test('should add keys', () => {
			const parent = {
				a: 'b'
			};
			const other = {
				c: 'd'
			};
			mergeEnvironments(parent, other);
			assert.deepStrictEqual(parent, {
				a: 'b',
				c: 'd'
			});
		});

		(!isWindows ? test.skip : test)('should add keys ignoring case on Windows', () => {
			const parent = {
				a: 'b'
			};
			const other = {
				A: 'c'
			};
			mergeEnvironments(parent, other);
			assert.deepStrictEqual(parent, {
				a: 'c'
			});
		});

		test('null values should delete keys from the parent env', () => {
			const parent = {
				a: 'b',
				c: 'd'
			};
			const other: IStringDictionary<string | null> = {
				a: null
			};
			mergeEnvironments(parent, other);
			assert.deepStrictEqual(parent, {
				c: 'd'
			});
		});

		(!isWindows ? test.skip : test)('null values should delete keys from the parent env ignoring case on Windows', () => {
			const parent = {
				a: 'b',
				c: 'd'
			};
			const other: IStringDictionary<string | null> = {
				A: null
			};
			mergeEnvironments(parent, other);
			assert.deepStrictEqual(parent, {
				c: 'd'
			});
		});
	});

	suite('getCwd', () => {
		// This helper checks the paths in a cross-platform friendly manner
		function assertPathsMatch(a: string, b: string): void {
			assert.strictEqual(Uri.file(a).fsPath, Uri.file(b).fsPath);
		}

		test('should default to userHome for an empty workspace', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined), '/userHome/');
		});

		test('should use to the workspace if it exists', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, Uri.file('/foo'), undefined), '/foo');
		});

		test('should use an absolute custom cwd as is', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, '/foo'), '/foo');
		});

		test('should normalize a relative custom cwd against the workspace path', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, Uri.file('/bar'), 'foo'), '/bar/foo');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, Uri.file('/bar'), './foo'), '/bar/foo');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, Uri.file('/bar'), '../foo'), '/foo');
		});

		test('should fall back for relative a custom cwd that doesn\'t have a workspace', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, 'foo'), '/userHome/');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, './foo'), '/userHome/');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, '../foo'), '/userHome/');
		});

		test('should ignore custom cwd when told to ignore', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [], ignoreConfigurationCwd: true }, '/userHome/', undefined, Uri.file('/bar'), '/foo'), '/bar');
		});
	});

	suite('getDefaultShell', () => {
		test('should change Sysnative to System32 in non-WoW64 systems', () => {
			const shell = getDefaultShell(key => {
				return ({ 'terminal.integrated.shell.windows': 'C:\\Windows\\Sysnative\\cmd.exe' } as any)[key];
			}, 'DEFAULT', false, 'C:\\Windows', undefined, {} as any, false, Platform.Windows);
			assert.strictEqual(shell, 'C:\\Windows\\System32\\cmd.exe');
		});

		test('should not change Sysnative to System32 in WoW64 systems', () => {
			const shell = getDefaultShell(key => {
				return ({ 'terminal.integrated.shell.windows': 'C:\\Windows\\Sysnative\\cmd.exe' } as any)[key];
			}, 'DEFAULT', true, 'C:\\Windows', undefined, {} as any, false, Platform.Windows);
			assert.strictEqual(shell, 'C:\\Windows\\Sysnative\\cmd.exe');
		});

		test('should use automationShell when specified', () => {
			const shell1 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': 'shell',
					'terminal.integrated.automationShell.windows': undefined
				} as any)[key];
			}, 'DEFAULT', false, 'C:\\Windows', undefined, {} as any, false, Platform.Windows);
			assert.strictEqual(shell1, 'shell', 'automationShell was false');
			const shell2 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': 'shell',
					'terminal.integrated.automationShell.windows': undefined
				} as any)[key];
			}, 'DEFAULT', false, 'C:\\Windows', undefined, {} as any, true, Platform.Windows);
			assert.strictEqual(shell2, 'shell', 'automationShell was true');
			const shell3 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': 'shell',
					'terminal.integrated.automationShell.windows': 'automationShell'
				} as any)[key];
			}, 'DEFAULT', false, 'C:\\Windows', undefined, {} as any, true, Platform.Windows);
			assert.strictEqual(shell3, 'automationShell', 'automationShell was true and specified in settings');
		});
	});
});
