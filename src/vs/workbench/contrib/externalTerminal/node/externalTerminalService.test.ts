/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepEqual, equal } from 'assert';
import { WindowsExternalTerminalService, LinuxExternalTerminalService, MacExternalTerminalService } from 'vs/workbench/contrib/externalTerminal/node/externalTerminalService';
import { DEFAULT_TERMINAL_OSX } from 'vs/workbench/contrib/externalTerminal/node/externalTerminal';

suite('ExternalTerminalService', () => {
	let mockOnExit: Function;
	let mockOnError: Function;
	let mockConfig: any;

	setup(() => {
		mockConfig = {
			terminal: {
				explorerKind: 'external',
				external: {
					windowsExec: 'testWindowsShell',
					osxExec: 'testOSXShell',
					linuxExec: 'testLinuxShell'
				}
			}
		};
		mockOnExit = (s: any) => s;
		mockOnError = (e: any) => e;
	});

	test(`WinTerminalService - uses terminal from configuration`, done => {
		let testShell = 'cmd';
		let testCwd = 'path/to/workspace';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(command, testShell, 'shell should equal expected');
				equal(args[args.length - 1], mockConfig.terminal.external.windowsExec, 'terminal should equal expected');
				equal(opts.cwd, testCwd, 'opts.cwd should equal expected');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		let testService = new WindowsExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testShell,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`WinTerminalService - uses default terminal when configuration.terminal.external.windowsExec is undefined`, done => {
		let testShell = 'cmd';
		let testCwd = 'path/to/workspace';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(args[args.length - 1], WindowsExternalTerminalService.getDefaultTerminalWindows(), 'terminal should equal expected');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		mockConfig.terminal.external.windowsExec = undefined;
		let testService = new WindowsExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testShell,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`WinTerminalService - uses default terminal when configuration.terminal.external.windowsExec is undefined`, done => {
		let testShell = 'cmd';
		let testCwd = 'c:/foo';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(opts.cwd, 'C:/foo', 'cwd should be uppercase regardless of the case that\'s passed in');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		let testService = new WindowsExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testShell,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`WinTerminalService - cmder should be spawned differently`, done => {
		let testShell = 'cmd';
		mockConfig.terminal.external.windowsExec = 'cmder';
		let testCwd = 'c:/foo';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				deepEqual(args, ['C:/foo']);
				equal(opts, undefined);
				done();
				return { on: (evt: any) => evt };
			}
		};
		let testService = new WindowsExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testShell,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`WinTerminalService - windows terminal should open workspace directory`, done => {
		let testShell = 'wt';
		let testCwd = 'c:/foo';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(opts.cwd, 'C:/foo');
				done();
				return { on: (evt: any) => evt };
			}
		};
		let testService = new WindowsExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testShell,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`MacTerminalService - uses terminal from configuration`, done => {
		let testCwd = 'path/to/workspace';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(args[1], mockConfig.terminal.external.osxExec, 'terminal should equal expected');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		let testService = new MacExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`MacTerminalService - uses default terminal when configuration.terminal.external.osxExec is undefined`, done => {
		let testCwd = 'path/to/workspace';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(args[1], DEFAULT_TERMINAL_OSX, 'terminal should equal expected');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		mockConfig.terminal.external.osxExec = undefined;
		let testService = new MacExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`LinuxTerminalService - uses terminal from configuration`, done => {
		let testCwd = 'path/to/workspace';
		let mockSpawner = {
			spawn: (command: any, args: any, opts: any) => {
				// assert
				equal(command, mockConfig.terminal.external.linuxExec, 'terminal should equal expected');
				equal(opts.cwd, testCwd, 'opts.cwd should equal expected');
				done();
				return {
					on: (evt: any) => evt
				};
			}
		};
		let testService = new LinuxExternalTerminalService(mockConfig);
		(<any>testService).spawnTerminal(
			mockSpawner,
			mockConfig,
			testCwd,
			mockOnExit,
			mockOnError
		);
	});

	test(`LinuxTerminalService - uses default terminal when configuration.terminal.external.linuxExec is undefined`, done => {
		LinuxExternalTerminalService.getDefaultTerminalLinuxReady().then(defaultTerminalLinux => {
			let testCwd = 'path/to/workspace';
			let mockSpawner = {
				spawn: (command: any, args: any, opts: any) => {
					// assert
					equal(command, defaultTerminalLinux, 'terminal should equal expected');
					done();
					return {
						on: (evt: any) => evt
					};
				}
			};
			mockConfig.terminal.external.linuxExec = undefined;
			let testService = new LinuxExternalTerminalService(mockConfig);
			(<any>testService).spawnTerminal(
				mockSpawner,
				mockConfig,
				testCwd,
				mockOnExit,
				mockOnError
			);
		});
	});
});
