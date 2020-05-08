/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { window, tasks, Disposable, TaskDefinition, Task, EventEmitter, CustomExecution, Pseudoterminal, TaskScope, commands, Task2, env, UIKind } from 'vscode';

// Disable tasks tests:
// - Web https://github.com/microsoft/vscode/issues/90528
((env.uiKind === UIKind.Web) ? suite.skip : suite)('vscode API - tasks', () => {

	suite('Tasks', () => {
		let disposables: Disposable[] = [];

		teardown(() => {
			disposables.forEach(d => d.dispose());
			disposables.length = 0;
		});

		test('CustomExecution task should start and shutdown successfully', (done) => {
			interface CustomTestingTaskDefinition extends TaskDefinition {
				/**
				 * One of the task properties. This can be used to customize the task in the tasks.json
				 */
				customProp1: string;
			}
			const taskType: string = 'customTesting';
			const taskName = 'First custom task';
			let isPseudoterminalClosed = false;
			disposables.push(window.onDidOpenTerminal(term => {
				disposables.push(window.onDidWriteTerminalData(e => {
					try {
						assert.equal(e.data, 'testing\r\n');
					} catch (e) {
						done(e);
					}
					disposables.push(window.onDidCloseTerminal(() => {
						try {
							// Pseudoterminal.close should have fired by now, additionally we want
							// to make sure all events are flushed before continuing with more tests
							assert.ok(isPseudoterminalClosed);
						} catch (e) {
							done(e);
							return;
						}
						done();
					}));
					term.dispose();
				}));
			}));
			disposables.push(tasks.registerTaskProvider(taskType, {
				provideTasks: () => {
					const result: Task[] = [];
					const kind: CustomTestingTaskDefinition = {
						type: taskType,
						customProp1: 'testing task one'
					};
					const writeEmitter = new EventEmitter<string>();
					const execution = new CustomExecution((): Thenable<Pseudoterminal> => {
						const pty: Pseudoterminal = {
							onDidWrite: writeEmitter.event,
							open: () => writeEmitter.fire('testing\r\n'),
							close: () => isPseudoterminalClosed = true
						};
						return Promise.resolve(pty);
					});
					const task = new Task2(kind, TaskScope.Workspace, taskName, taskType, execution);
					result.push(task);
					return result;
				},
				resolveTask(_task: Task): Task | undefined {
					try {
						assert.fail('resolveTask should not trigger during the test');
					} catch (e) {
						done(e);
					}
					return undefined;
				}
			}));
			commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
		});

		test('sync CustomExecution task should flush all data on close', (done) => {
			interface CustomTestingTaskDefinition extends TaskDefinition {
				/**
				 * One of the task properties. This can be used to customize the task in the tasks.json
				 */
				customProp1: string;
			}
			const taskType: string = 'customTesting';
			const taskName = 'First custom task';
			disposables.push(window.onDidOpenTerminal(term => {
				disposables.push(window.onDidWriteTerminalData(e => {
					try {
						assert.equal(e.data, 'exiting');
					} catch (e) {
						done(e);
					}
					disposables.push(window.onDidCloseTerminal(() => done()));
					term.dispose();
				}));
			}));
			disposables.push(tasks.registerTaskProvider(taskType, {
				provideTasks: () => {
					const result: Task[] = [];
					const kind: CustomTestingTaskDefinition = {
						type: taskType,
						customProp1: 'testing task one'
					};
					const writeEmitter = new EventEmitter<string>();
					const closeEmitter = new EventEmitter<void>();
					const execution = new CustomExecution((): Thenable<Pseudoterminal> => {
						const pty: Pseudoterminal = {
							onDidWrite: writeEmitter.event,
							onDidClose: closeEmitter.event,
							open: () => {
								writeEmitter.fire('exiting');
								closeEmitter.fire();
							},
							close: () => {}
						};
						return Promise.resolve(pty);
					});
					const task = new Task2(kind, TaskScope.Workspace, taskName, taskType, execution);
					result.push(task);
					return result;
				},
				resolveTask(_task: Task): Task | undefined {
					try {
						assert.fail('resolveTask should not trigger during the test');
					} catch (e) {
						done(e);
					}
					return undefined;
				}
			}));
			commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
		});
	});
});
