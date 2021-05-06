/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { window, tasks, Disposable, TaskDefinition, Task, EventEmitter, CustomExecution, Pseudoterminal, TaskScope, commands, env, UIKind, ShellExecution, TaskExecution, Terminal, Event, workspace, ConfigurationTarget, TaskProcessStartEvent } from 'vscode';
import { assertNoRpc } from '../utils';

// Disable tasks tests:
// - Web https://github.com/microsoft/vscode/issues/90528
((env.uiKind === UIKind.Web) ? suite.skip : suite)('vscode API - tasks', () => {

	suiteSetup(async () => {
		const config = workspace.getConfiguration('terminal.integrated');
		// Disable conpty in integration tests because of https://github.com/microsoft/vscode/issues/76548
		await config.update('windowsEnableConpty', false, ConfigurationTarget.Global);
		// Disable exit alerts as tests may trigger then and we're not testing the notifications
		await config.update('showExitAlert', false, ConfigurationTarget.Global);
		// Canvas may cause problems when running in a container
		await config.update('gpuAcceleration', 'off', ConfigurationTarget.Global);
		// Disable env var relaunch for tests to prevent terminals relaunching themselves
		await config.update('environmentChangesRelaunch', false, ConfigurationTarget.Global);
	});

	suite('Tasks', () => {
		let disposables: Disposable[] = [];

		teardown(() => {
			assertNoRpc();
			disposables.forEach(d => d.dispose());
			disposables.length = 0;
		});

		suite('ShellExecution', () => {
			test('Execution from onDidEndTaskProcess and onDidStartTaskProcess are equal to original', () => {
				return new Promise<void>(async (resolve) => {
					const task = new Task({ type: 'testTask' }, TaskScope.Workspace, 'echo', 'testTask', new ShellExecution('echo', ['hello test']));
					let taskExecution: TaskExecution | undefined;
					const executeDoneEvent: EventEmitter<void> = new EventEmitter();
					const taskExecutionShouldBeSet: Promise<void> = new Promise(resolve => {
						const disposable = executeDoneEvent.event(() => {
							resolve();
							disposable.dispose();
						});
					});
					let count = 2;
					const progressMade: EventEmitter<void> = new EventEmitter();
					let startSucceeded = false;
					let endSucceeded = false;
					disposables.push(progressMade.event(() => {
						count--;
						if ((count === 0) && startSucceeded && endSucceeded) {
							resolve();
						}
					}));


					disposables.push(tasks.onDidStartTaskProcess(async (e) => {
						await taskExecutionShouldBeSet;
						if (e.execution === taskExecution) {
							startSucceeded = true;
							progressMade.fire();
						}
					}));

					disposables.push(tasks.onDidEndTaskProcess(async (e) => {
						await taskExecutionShouldBeSet;
						if (e.execution === taskExecution) {
							endSucceeded = true;
							progressMade.fire();
						}
					}));
					taskExecution = await tasks.executeTask(task);
					executeDoneEvent.fire();
				});
			});

			test('dependsOn task should start with a different processId (#118256)', async () => {
				// Set up dependsOn task by creating tasks.json since this is not possible via the API
				// Tasks API
				const tasksConfig = workspace.getConfiguration('tasks');
				await tasksConfig.update('version', '2.0.0', ConfigurationTarget.Workspace);
				await tasksConfig.update('tasks', [
					{
						label: 'taskToDependOn',
						type: 'shell',
						command: 'sleep 1',
						problemMatcher: []
					},
					{
						label: 'Run this task',
						type: 'shell',
						command: 'sleep 1',
						problemMatcher: [],
						dependsOn: 'taskToDependOn'
					}
				], ConfigurationTarget.Workspace);

				// Run the task
				commands.executeCommand('workbench.action.tasks.runTask', 'Run this task');

				// Listen for first task and verify valid process ID
				const startEvent1 = await new Promise<TaskProcessStartEvent>(r => {
					const listener = tasks.onDidStartTaskProcess(async (e) => {
						if (e.execution.task.name === 'taskToDependOn') {
							listener.dispose();
							r(e);
						}
					});
				});
				assert.ok(startEvent1.processId);

				// Listen for second task, verify valid process ID and that it's not the process ID of
				// the first task
				const startEvent2 = await new Promise<TaskProcessStartEvent>(r => {
					const listener = tasks.onDidStartTaskProcess(async (e) => {
						if (e.execution.task.name === 'Run this task') {
							listener.dispose();
							r(e);
						}
					});
				});
				assert.ok(startEvent2.processId);
				assert.notStrictEqual(startEvent1.processId, startEvent2.processId);

				// Clear out tasks config
				await tasksConfig.update('tasks', []);
			});
		});

		suite('CustomExecution', () => {
			test('task should start and shutdown successfully', async () => {
				window.terminals.forEach(terminal => terminal.dispose());
				interface CustomTestingTaskDefinition extends TaskDefinition {
					/**
					 * One of the task properties. This can be used to customize the task in the tasks.json
					 */
					customProp1: string;
				}
				const taskType: string = 'customTesting';
				const taskName = 'First custom task';
				let isPseudoterminalClosed = false;
				// There's a strict order that should be observed here:
				// 1. The terminal opens
				// 2. The terminal is written to.
				// 3. The terminal is closed.
				enum TestOrder {
					Start,
					TerminalOpened,
					TerminalWritten,
					TerminalClosed
				}

				let testOrder = TestOrder.Start;

				// Launch the task
				const terminal = await new Promise<Terminal>(r => {
					disposables.push(window.onDidOpenTerminal(e => {
						assert.strictEqual(testOrder, TestOrder.Start);
						testOrder = TestOrder.TerminalOpened;
						r(e);
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
							const task = new Task(kind, TaskScope.Workspace, taskName, taskType, execution);
							result.push(task);
							return result;
						},
						resolveTask(_task: Task): Task | undefined {
							assert.fail('resolveTask should not trigger during the test');
						}
					}));
					commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
				});

				// Verify the output
				await new Promise<void>(r => {
					disposables.push(window.onDidWriteTerminalData(e => {
						if (e.terminal !== terminal) {
							return;
						}
						assert.strictEqual(testOrder, TestOrder.TerminalOpened);
						testOrder = TestOrder.TerminalWritten;
						assert.notStrictEqual(terminal, undefined);
						assert.strictEqual(e.data, 'testing\r\n');
						r();
					}));
				});

				// Dispose the terminal
				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal((e) => {
						if (e !== terminal) {
							return;
						}
						assert.strictEqual(testOrder, TestOrder.TerminalWritten);
						testOrder = TestOrder.TerminalClosed;
						// Pseudoterminal.close should have fired by now, additionally we want
						// to make sure all events are flushed before continuing with more tests
						assert.ok(isPseudoterminalClosed);
						r();
					}));
					terminal.dispose();
				});
			});

			test('sync task should flush all data on close', async () => {
				interface CustomTestingTaskDefinition extends TaskDefinition {
					/**
					 * One of the task properties. This can be used to customize the task in the tasks.json
					 */
					customProp1: string;
				}
				const taskType: string = 'customTesting';
				const taskName = 'First custom task';

				// Launch the task
				const terminal = await new Promise<Terminal>(r => {
					disposables.push(window.onDidOpenTerminal(e => r(e)));
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
									close: () => { }
								};
								return Promise.resolve(pty);
							});
							const task = new Task(kind, TaskScope.Workspace, taskName, taskType, execution);
							result.push(task);
							return result;
						},
						resolveTask(_task: Task): Task | undefined {
							assert.fail('resolveTask should not trigger during the test');
						}
					}));
					commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
				});

				// Verify the output
				await new Promise<void>(r => {
					disposables.push(window.onDidWriteTerminalData(e => {
						if (e.terminal !== terminal) {
							return;
						}
						assert.strictEqual(e.data, 'exiting');
						r();
					}));
				});

				// Dispose the terminal
				await new Promise<void>(r => {
					disposables.push(window.onDidCloseTerminal(() => r()));
					terminal.dispose();
				});
			});

			test('A task can be fetched and executed (#100577)', () => {
				return new Promise<void>(async (resolve, reject) => {
					class CustomTerminal implements Pseudoterminal {
						private readonly writeEmitter = new EventEmitter<string>();
						public readonly onDidWrite: Event<string> = this.writeEmitter.event;
						public async close(): Promise<void> { }
						private closeEmitter = new EventEmitter<void>();
						onDidClose: Event<void> = this.closeEmitter.event;
						public open(): void {
							this.closeEmitter.fire();
							resolve();
						}
					}

					function buildTask(): Task {
						const task = new Task(
							{
								type: 'customTesting',
							},
							TaskScope.Workspace,
							'Test Task',
							'customTesting',
							new CustomExecution(
								async (): Promise<Pseudoterminal> => {
									return new CustomTerminal();
								}
							)
						);
						return task;
					}

					disposables.push(tasks.registerTaskProvider('customTesting', {
						provideTasks: () => {
							return [buildTask()];
						},
						resolveTask(_task: Task): undefined {
							return undefined;
						}
					}));

					const task = await tasks.fetchTasks({ type: 'customTesting' });

					if (task && task.length > 0) {
						await tasks.executeTask(task[0]);
					} else {
						reject('fetched task can\'t be undefined');
					}
				});
			});
		});
	});
});
