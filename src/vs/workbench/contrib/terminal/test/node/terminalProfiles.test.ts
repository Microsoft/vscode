/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, fail, ok, strictEqual } from 'assert';
import { isWindows } from 'vs/base/common/platform';
import { SafeConfigProvider } from 'vs/platform/terminal/common/terminal';
import { ITerminalConfiguration, ITerminalProfile, ITerminalProfiles, ProfileSource } from 'vs/workbench/contrib/terminal/common/terminal';
import { detectAvailableProfiles, IFsProvider } from 'vs/workbench/contrib/terminal/node/terminalProfiles';

/**
 * Assets that two profiles objects are equal, this will treat explicit undefined and unset
 * properties the same. Order of the profiles is ignored.
 */
function profilesEqual(actualProfiles: ITerminalProfile[], expectedProfiles: ITerminalProfile[]) {
	strictEqual(actualProfiles.length, expectedProfiles.length);
	for (const expected of expectedProfiles) {
		const actual = actualProfiles.find(e => e.profileName === expected.profileName);
		ok(actual, `Expected profile ${expected.profileName} not found`);
		strictEqual(actual.profileName, expected.profileName);
		strictEqual(actual.path, expected.path);
		deepStrictEqual(actual.args, expected.args);
		strictEqual(actual.isAutoDetected, expected.isAutoDetected);
		strictEqual(actual.overrideName, expected.overrideName);
	}
}

function buildTestSafeConfigProvider(config: ITestTerminalConfig): SafeConfigProvider {
	return (key: string) => {
		switch (key) {
			case 'terminal.integrated.profiles.linux': return config.profiles.linux as any;
			case 'terminal.integrated.profiles.osx': return config.profiles.osx as any;
			case 'terminal.integrated.profiles.windows': return config.profiles.windows as any;
			case 'terminal.integrated.useWslProfiles': return config.useWslProfiles;
			default: throw new Error('Unexpected config key');
		}
	};
}

suite('Workbench - TerminalProfiles', () => {
	suite('detectAvailableProfiles', () => {
		if (isWindows) {
			test('should detect Git Bash and provide login args', async () => {
				const fsProvider = createFsProvider([
					'C:\\Program Files\\Git\\bin\\bash.exe'
				]);
				const config: ITestTerminalConfig = {
					profiles: {
						windows: {
							'Git Bash': { source: ProfileSource.GitBash }
						},
						linux: {},
						osx: {}
					},
					useWslProfiles: false
				};
				const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(config), fsProvider, undefined, undefined, undefined);
				const expected = [
					{ profileName: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login'] }
				];
				profilesEqual(profiles, expected);
			});
			test('should allow source to have args', async () => {
				const fsProvider = createFsProvider([
					'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
				]);
				const config: ITestTerminalConfig = {
					profiles: {
						windows: {
							'PowerShell NoProfile': { source: ProfileSource.Pwsh, args: ['-NoProfile'], overrideName: true }
						},
						linux: {},
						osx: {},
					},
					useWslProfiles: false
				};
				const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(config), fsProvider, undefined, undefined, undefined);
				const expected = [
					{ profileName: 'PowerShell NoProfile', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', overrideName: true, args: ['-NoProfile'] }
				];
				profilesEqual(profiles, expected);
			});
			test('configured args should override default source ones', async () => {
				const fsProvider = createFsProvider([
					'C:\\Program Files\\Git\\bin\\bash.exe'
				]);
				const config: ITestTerminalConfig = {
					profiles: {
						windows: {
							'Git Bash': { source: ProfileSource.GitBash, args: [] }
						},
						linux: {},
						osx: {}
					},
					useWslProfiles: false
				};
				const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(config), fsProvider, undefined, undefined, undefined);
				const expected = [{ profileName: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe', args: [], isAutoDetected: undefined, overrideName: undefined }];
				profilesEqual(profiles, expected);
			});
			suite('pwsh source detection/fallback', async () => {
				const pwshSourceConfig = ({
					profiles: {
						windows: {
							'PowerShell': { source: ProfileSource.Pwsh }
						},
						linux: {},
						osx: {},
					},
					useWslProfiles: false
				} as ITestTerminalConfig) as ITerminalConfiguration;

				test('should prefer pwsh 7 to Windows PowerShell', async () => {
					const fsProvider = createFsProvider([
						'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
						'C:\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe',
						'C:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
					]);
					const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(pwshSourceConfig), fsProvider, undefined, undefined, undefined);
					const expected = [
						{ profileName: 'PowerShell', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }
					];
					profilesEqual(profiles, expected);
				});
				test('should prefer pwsh 7 to pwsh 6', async () => {
					const fsProvider = createFsProvider([
						'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
						'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
						'C:\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe',
						'C:\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
					]);
					const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(pwshSourceConfig), fsProvider, undefined, undefined, undefined);
					const expected = [
						{ profileName: 'PowerShell', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }
					];
					profilesEqual(profiles, expected);
				});
				test.skip('should fallback to Windows PowerShell', async () => {
					const fsProvider = createFsProvider([
						'C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe',
						'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
					]);
					const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(pwshSourceConfig), fsProvider, undefined, undefined, undefined);
					strictEqual(profiles.length, 1);
					strictEqual(profiles[0].profileName, 'PowerShell');
				});
			});
		} else {
			const absoluteConfig = ({
				profiles: {
					windows: {},
					osx: {
						'fakeshell1': { path: '/bin/fakeshell1' },
						'fakeshell2': { path: '/bin/fakeshell2' },
						'fakeshell3': { path: '/bin/fakeshell3' }
					},
					linux: {
						'fakeshell1': { path: '/bin/fakeshell1' },
						'fakeshell2': { path: '/bin/fakeshell2' },
						'fakeshell3': { path: '/bin/fakeshell3' }
					}
				},
				useWslProfiles: false
			} as ITestTerminalConfig) as ITerminalConfiguration;
			const onPathConfig = ({
				profiles: {
					windows: {},
					osx: {
						'fakeshell1': { path: 'fakeshell1' },
						'fakeshell2': { path: 'fakeshell2' },
						'fakeshell3': { path: 'fakeshell3' }
					},
					linux: {
						'fakeshell1': { path: 'fakeshell1' },
						'fakeshell2': { path: 'fakeshell2' },
						'fakeshell3': { path: 'fakeshell3' }
					}
				},
				useWslProfiles: false
			} as ITestTerminalConfig) as ITerminalConfiguration;

			test('should detect shells via absolute paths', async () => {
				const fsProvider = createFsProvider([
					'/bin/fakeshell1',
					'/bin/fakeshell3'
				]);
				const profiles = await detectAvailableProfiles(true, buildTestSafeConfigProvider(absoluteConfig), fsProvider, undefined, undefined, undefined);
				const expected: ITerminalProfile[] = [
					{ profileName: 'fakeshell1', path: '/bin/fakeshell1' },
					{ profileName: 'fakeshell3', path: '/bin/fakeshell3' }
				];
				profilesEqual(profiles, expected);
			});
			test('should auto detect shells via /etc/shells', async () => {
				const fsProvider = createFsProvider([
					'/bin/fakeshell1',
					'/bin/fakeshell3'
				], '/bin/fakeshell1\n/bin/fakeshell3');
				const profiles = await detectAvailableProfiles(false, buildTestSafeConfigProvider(onPathConfig), fsProvider, undefined, undefined, undefined);
				const expected: ITerminalProfile[] = [
					{ profileName: 'fakeshell1', path: 'fakeshell1' },
					{ profileName: 'fakeshell3', path: 'fakeshell3' }
				];
				profilesEqual(profiles, expected);
			});
			test('should validate auto detected shells from /etc/shells exist', async () => {
				// fakeshell3 exists in /etc/shells but not on FS
				const fsProvider = createFsProvider([
					'/bin/fakeshell1'
				], '/bin/fakeshell1\n/bin/fakeshell3');
				const profiles = await detectAvailableProfiles(false, buildTestSafeConfigProvider(onPathConfig), fsProvider, undefined, undefined, undefined);
				const expected: ITerminalProfile[] = [
					{ profileName: 'fakeshell1', path: 'fakeshell1' }
				];
				profilesEqual(profiles, expected);
			});
		}
	});

	function createFsProvider(expectedPaths: string[], etcShellsContent: string = ''): IFsProvider {
		const provider = {
			async existsFile(path: string): Promise<boolean> {
				return expectedPaths.includes(path);
			},
			async readFile(path: string, options: { encoding: BufferEncoding, flag?: string | number } | BufferEncoding): Promise<string> {
				if (path !== '/etc/shells') {
					fail('Unexected path');
				}
				return etcShellsContent;
			}
		};
		return provider;
	}
});

export interface ITestTerminalConfig {
	profiles: ITerminalProfiles;
	useWslProfiles: boolean
}
