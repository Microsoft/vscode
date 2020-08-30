/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import { URI as Uri } from 'vs/base/common/uri';
import { IStringDictionary } from 'vs/base/common/collections';
import { addTerminalEnvironmentKeys, mergeEnvironments, getCwd, getDefaultShell, getLangEnvVariable, shouldSetLangEnvVariable } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';

suite('Workbench - TerminalEnvironment', () => {
	suite('addTerminalEnvironmentKeys', () => {
		test('should set expected variables', () => {
			const env: { [key: string]: any } = {};
			addTerminalEnvironmentKeys(env, '1.2.3', 'en', 'on');
			assert.equal(env['TERM_PROGRAM'], 'vscode');
			assert.equal(env['TERM_PROGRAM_VERSION'], '1.2.3');
			assert.equal(env['COLORTERM'], 'truecolor');
			assert.equal(env['LANG'], 'en_US.UTF-8');
		});
		test('should use language variant for LANG that is provided in locale', () => {
			const env: { [key: string]: any } = {};
			addTerminalEnvironmentKeys(env, '1.2.3', 'en-au', 'on');
			assert.equal(env['LANG'], 'en_AU.UTF-8', 'LANG is equal to the requested locale with UTF-8');
		});
		test('should fallback to en_US when no locale is provided', () => {
			const env2: { [key: string]: any } = { FOO: 'bar' };
			addTerminalEnvironmentKeys(env2, '1.2.3', undefined, 'on');
			assert.equal(env2['LANG'], 'en_US.UTF-8', 'LANG is equal to en_US.UTF-8 as fallback.'); // More info on issue #14586
		});
		test('should fallback to en_US when an invalid locale is provided', () => {
			const env3 = { LANG: 'replace' };
			addTerminalEnvironmentKeys(env3, '1.2.3', undefined, 'on');
			assert.equal(env3['LANG'], 'en_US.UTF-8', 'LANG is set to the fallback LANG');
		});
		test('should override existing LANG', () => {
			const env4 = { LANG: 'en_AU.UTF-8' };
			addTerminalEnvironmentKeys(env4, '1.2.3', undefined, 'on');
			assert.equal(env4['LANG'], 'en_US.UTF-8', 'LANG is equal to the parent environment\'s LANG');
		});
	});

	suite('shouldSetLangEnvVariable', () => {
		test('auto', () => {
			assert.equal(shouldSetLangEnvVariable({}, 'auto'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'auto'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'auto'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'auto'), false);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'auto'), false);
		});
		test('off', () => {
			assert.equal(shouldSetLangEnvVariable({}, 'off'), false);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'off'), false);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'off'), false);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'off'), false);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'off'), false);
		});
		test('on', () => {
			assert.equal(shouldSetLangEnvVariable({}, 'on'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US' }, 'on'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf' }, 'on'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.utf8' }, 'on'), true);
			assert.equal(shouldSetLangEnvVariable({ LANG: 'en-US.UTF-8' }, 'on'), true);
		});
	});

	suite('getLangEnvVariable', () => {
		test('should fallback to en_US when no locale is provided', () => {
			assert.equal(getLangEnvVariable(undefined), 'en_US.UTF-8');
			assert.equal(getLangEnvVariable(''), 'en_US.UTF-8');
		});
		test('should fallback to default language variants when variant isn\'t provided', () => {
			assert.equal(getLangEnvVariable('af'), 'af_ZA.UTF-8');
			assert.equal(getLangEnvVariable('am'), 'am_ET.UTF-8');
			assert.equal(getLangEnvVariable('be'), 'be_BY.UTF-8');
			assert.equal(getLangEnvVariable('bg'), 'bg_BG.UTF-8');
			assert.equal(getLangEnvVariable('ca'), 'ca_ES.UTF-8');
			assert.equal(getLangEnvVariable('cs'), 'cs_CZ.UTF-8');
			assert.equal(getLangEnvVariable('da'), 'da_DK.UTF-8');
			assert.equal(getLangEnvVariable('de'), 'de_DE.UTF-8');
			assert.equal(getLangEnvVariable('el'), 'el_GR.UTF-8');
			assert.equal(getLangEnvVariable('en'), 'en_US.UTF-8');
			assert.equal(getLangEnvVariable('es'), 'es_ES.UTF-8');
			assert.equal(getLangEnvVariable('et'), 'et_EE.UTF-8');
			assert.equal(getLangEnvVariable('eu'), 'eu_ES.UTF-8');
			assert.equal(getLangEnvVariable('fi'), 'fi_FI.UTF-8');
			assert.equal(getLangEnvVariable('fr'), 'fr_FR.UTF-8');
			assert.equal(getLangEnvVariable('he'), 'he_IL.UTF-8');
			assert.equal(getLangEnvVariable('hr'), 'hr_HR.UTF-8');
			assert.equal(getLangEnvVariable('hu'), 'hu_HU.UTF-8');
			assert.equal(getLangEnvVariable('hy'), 'hy_AM.UTF-8');
			assert.equal(getLangEnvVariable('is'), 'is_IS.UTF-8');
			assert.equal(getLangEnvVariable('it'), 'it_IT.UTF-8');
			assert.equal(getLangEnvVariable('ja'), 'ja_JP.UTF-8');
			assert.equal(getLangEnvVariable('kk'), 'kk_KZ.UTF-8');
			assert.equal(getLangEnvVariable('ko'), 'ko_KR.UTF-8');
			assert.equal(getLangEnvVariable('lt'), 'lt_LT.UTF-8');
			assert.equal(getLangEnvVariable('nl'), 'nl_NL.UTF-8');
			assert.equal(getLangEnvVariable('no'), 'no_NO.UTF-8');
			assert.equal(getLangEnvVariable('pl'), 'pl_PL.UTF-8');
			assert.equal(getLangEnvVariable('pt'), 'pt_BR.UTF-8');
			assert.equal(getLangEnvVariable('ro'), 'ro_RO.UTF-8');
			assert.equal(getLangEnvVariable('ru'), 'ru_RU.UTF-8');
			assert.equal(getLangEnvVariable('sk'), 'sk_SK.UTF-8');
			assert.equal(getLangEnvVariable('sl'), 'sl_SI.UTF-8');
			assert.equal(getLangEnvVariable('sr'), 'sr_YU.UTF-8');
			assert.equal(getLangEnvVariable('sv'), 'sv_SE.UTF-8');
			assert.equal(getLangEnvVariable('tr'), 'tr_TR.UTF-8');
			assert.equal(getLangEnvVariable('uk'), 'uk_UA.UTF-8');
			assert.equal(getLangEnvVariable('zh'), 'zh_CN.UTF-8');
		});
		test('should set language variant based on full locale', () => {
			assert.equal(getLangEnvVariable('en-AU'), 'en_AU.UTF-8');
			assert.equal(getLangEnvVariable('en-au'), 'en_AU.UTF-8');
			assert.equal(getLangEnvVariable('fa-ke'), 'fa_KE.UTF-8');
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
			assert.deepEqual(parent, {
				a: 'b',
				c: 'd'
			});
		});

		test('should add keys ignoring case on Windows', () => {
			if (!platform.isWindows) {
				return;
			}
			const parent = {
				a: 'b'
			};
			const other = {
				A: 'c'
			};
			mergeEnvironments(parent, other);
			assert.deepEqual(parent, {
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
			assert.deepEqual(parent, {
				c: 'd'
			});
		});

		test('null values should delete keys from the parent env ignoring case on Windows', () => {
			if (!platform.isWindows) {
				return;
			}
			const parent = {
				a: 'b',
				c: 'd'
			};
			const other: IStringDictionary<string | null> = {
				A: null
			};
			mergeEnvironments(parent, other);
			assert.deepEqual(parent, {
				c: 'd'
			});
		});
	});

	suite('getCwd', () => {
		// This helper checks the paths in a cross-platform friendly manner
		function assertPathsMatch(a: string, b: string): void {
			assert.equal(Uri.file(a).fsPath, Uri.file(b).fsPath);
		}

		test('should default to userHome for an empty workspace', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined, undefined), '/userHome/');
		});

		test('should use to the workspace if it exists', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, Uri.file('/foo'), undefined), '/foo');
		});

		test('should use an absolute custom cwd as is', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined, '/foo'), '/foo');
		});

		test('should normalize a relative custom cwd against the workspace path', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, Uri.file('/bar'), 'foo'), '/bar/foo');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, Uri.file('/bar'), './foo'), '/bar/foo');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, Uri.file('/bar'), '../foo'), '/foo');
		});

		test('should fall back for relative a custom cwd that doesn\'t have a workspace', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined, 'foo'), '/userHome/');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined, './foo'), '/userHome/');
			assertPathsMatch(getCwd({ executable: undefined, args: [] }, '/userHome/', undefined, undefined, undefined, '../foo'), '/userHome/');
		});

		test('should ignore custom cwd when told to ignore', () => {
			assertPathsMatch(getCwd({ executable: undefined, args: [], ignoreConfigurationCwd: true }, '/userHome/', undefined, undefined, Uri.file('/bar'), '/foo'), '/bar');
		});
	});

	suite('getDefaultShell', () => {
		test('should change Sysnative to System32 in non-WoW64 systems', () => {
			const shell = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': { userValue: 'C:\\Windows\\Sysnative\\cmd.exe', value: undefined, defaultValue: undefined }
				} as any)[key];
			}, false, 'DEFAULT', false, 'C:\\Windows', undefined, undefined, {} as any, false, platform.Platform.Windows);
			assert.equal(shell, 'C:\\Windows\\System32\\cmd.exe');
		});

		test('should not change Sysnative to System32 in WoW64 systems', () => {
			const shell = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': { userValue: 'C:\\Windows\\Sysnative\\cmd.exe', value: undefined, defaultValue: undefined }
				} as any)[key];
			}, false, 'DEFAULT', true, 'C:\\Windows', undefined, undefined, {} as any, false, platform.Platform.Windows);
			assert.equal(shell, 'C:\\Windows\\Sysnative\\cmd.exe');
		});

		test('should use automationShell when specified', () => {
			const shell1 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': { userValue: 'shell', value: undefined, defaultValue: undefined },
					'terminal.integrated.automationShell.windows': { userValue: undefined, value: undefined, defaultValue: undefined }
				} as any)[key];
			}, false, 'DEFAULT', false, 'C:\\Windows', undefined, undefined, {} as any, false, platform.Platform.Windows);
			assert.equal(shell1, 'shell', 'automationShell was false');
			const shell2 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': { userValue: 'shell', value: undefined, defaultValue: undefined },
					'terminal.integrated.automationShell.windows': { userValue: undefined, value: undefined, defaultValue: undefined }
				} as any)[key];
			}, false, 'DEFAULT', false, 'C:\\Windows', undefined, undefined, {} as any, true, platform.Platform.Windows);
			assert.equal(shell2, 'shell', 'automationShell was true');
			const shell3 = getDefaultShell(key => {
				return ({
					'terminal.integrated.shell.windows': { userValue: 'shell', value: undefined, defaultValue: undefined },
					'terminal.integrated.automationShell.windows': { userValue: 'automationShell', value: undefined, defaultValue: undefined }
				} as any)[key];
			}, false, 'DEFAULT', false, 'C:\\Windows', undefined, undefined, {} as any, true, platform.Platform.Windows);
			assert.equal(shell3, 'automationShell', 'automationShell was true and specified in settings');
		});
	});
});
