/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { StringDecoder } from 'string_decoder';
import * as which from 'which';
import * as path from 'path';
import * as vscode from 'vscode';
import { ThrottledDelayer } from './utils/async';
import * as nls from 'vscode-nls';
let localize = nls.loadMessageBundle();

const enum Setting {
	Run = 'php.validate.run',
	CheckedExecutablePath = 'php.validate.checkedExecutablePath',
	Enable = 'php.validate.enable',
	ExecutablePath = 'php.validate.executablePath',
}

export class LineDecoder {
	private stringDecoder: StringDecoder;
	private remaining: string | null;

	constructor(encoding: BufferEncoding = 'utf8') {
		this.stringDecoder = new StringDecoder(encoding);
		this.remaining = null;
	}

	public write(buffer: Buffer): string[] {
		let result: string[] = [];
		let value = this.remaining
			? this.remaining + this.stringDecoder.write(buffer)
			: this.stringDecoder.write(buffer);

		if (value.length < 1) {
			return result;
		}
		let start = 0;
		let ch: number;
		while (start < value.length && ((ch = value.charCodeAt(start)) === 13 || ch === 10)) {
			start++;
		}
		let idx = start;
		while (idx < value.length) {
			ch = value.charCodeAt(idx);
			if (ch === 13 || ch === 10) {
				result.push(value.substring(start, idx));
				idx++;
				while (idx < value.length && ((ch = value.charCodeAt(idx)) === 13 || ch === 10)) {
					idx++;
				}
				start = idx;
			} else {
				idx++;
			}
		}
		this.remaining = start < value.length ? value.substr(start) : null;
		return result;
	}

	public end(): string | null {
		return this.remaining;
	}
}

enum RunTrigger {
	onSave,
	onType
}

namespace RunTrigger {
	export let strings = {
		onSave: 'onSave',
		onType: 'onType'
	};
	export let from = function (value: string): RunTrigger {
		if (value === 'onType') {
			return RunTrigger.onType;
		} else {
			return RunTrigger.onSave;
		}
	};
}

export default class PHPValidationProvider {

	private static MatchExpression: RegExp = /(?:(?:Parse|Fatal) error): (.*)(?: in )(.*?)(?: on line )(\d+)/;
	private static BufferArgs: string[] = ['-l', '-n', '-d', 'display_errors=On', '-d', 'log_errors=Off'];
	private static FileArgs: string[] = ['-l', '-n', '-d', 'display_errors=On', '-d', 'log_errors=Off', '-f'];

	private validationEnabled: boolean;
	private pauseValidation: boolean;
	private config: IPhpConfig | undefined;
	private loadConfigP: Promise<void>;

	private documentListener: vscode.Disposable | null = null;
	private diagnosticCollection?: vscode.DiagnosticCollection;
	private delayers?: { [key: string]: ThrottledDelayer<void> };

	constructor(private workspaceStore: vscode.Memento) {
		this.validationEnabled = true;
		this.pauseValidation = false;
		this.loadConfigP = this.loadConfiguration();
	}

	public activate(subscriptions: vscode.Disposable[]) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection();
		subscriptions.push(this);
		subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => this.loadConfigP = this.loadConfiguration()));

		vscode.workspace.onDidOpenTextDocument(this.triggerValidate, this, subscriptions);
		vscode.workspace.onDidCloseTextDocument((textDocument) => {
			this.diagnosticCollection!.delete(textDocument.uri);
			delete this.delayers![textDocument.uri.toString()];
		}, null, subscriptions);
		subscriptions.push(vscode.commands.registerCommand('php.untrustValidationExecutable', this.untrustValidationExecutable, this));
	}

	public dispose(): void {
		if (this.diagnosticCollection) {
			this.diagnosticCollection.clear();
			this.diagnosticCollection.dispose();
		}
		if (this.documentListener) {
			this.documentListener.dispose();
			this.documentListener = null;
		}
	}

	private async loadConfiguration(): Promise<void> {
		const section = vscode.workspace.getConfiguration();
		const oldExecutable = this.config?.executable;
		this.validationEnabled = section.get<boolean>(Setting.Enable, true);

		this.config = await getConfig();

		if (this.config.executableIsUserDefined !== true && this.workspaceStore.get<string | undefined>(Setting.CheckedExecutablePath, undefined) !== undefined) {
			vscode.commands.executeCommand('setContext', 'php.untrustValidationExecutableContext', true);
		}

		const trustEnabled = vscode.workspace.getConfiguration().get('security.workspace.trust.enabled');
		if (trustEnabled) {
			vscode.workspace.requestWorkspaceTrust();
		}

		this.delayers = Object.create(null);
		if (this.pauseValidation) {
			this.pauseValidation = oldExecutable === this.config.executable;
		}
		if (this.documentListener) {
			this.documentListener.dispose();
			this.documentListener = null;
		}
		this.diagnosticCollection!.clear();
		if (this.validationEnabled) {
			if (this.config.trigger === RunTrigger.onType) {
				this.documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
					this.triggerValidate(e.document);
				});
			} else {
				this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerValidate, this);
			}
			// Configuration has changed. Reevaluate all documents.
			vscode.workspace.textDocuments.forEach(this.triggerValidate, this);
		}
	}

	private untrustValidationExecutable() {
		this.workspaceStore.update(Setting.CheckedExecutablePath, undefined);
		vscode.commands.executeCommand('setContext', 'php.untrustValidationExecutableContext', false);
	}

	private async triggerValidate(textDocument: vscode.TextDocument): Promise<void> {
		await this.loadConfigP;
		if (textDocument.languageId !== 'php' || this.pauseValidation || !this.validationEnabled) {
			return;
		}


		let trigger = () => {
			let key = textDocument.uri.toString();
			let delayer = this.delayers![key];
			if (!delayer) {
				delayer = new ThrottledDelayer<void>(this.config?.trigger === RunTrigger.onType ? 250 : 0);
				this.delayers![key] = delayer;
			}
			delayer.trigger(() => this.doValidate(textDocument));
		};

		const trustEnabled = vscode.workspace.getConfiguration().get('security.workspace.trust.enabled');
		if (trustEnabled) {
			if (vscode.workspace.isTrusted) {
				trigger();
			}
		} else if (this.config!.executableIsUserDefined !== undefined && !this.config!.executableIsUserDefined) {
			const checkedExecutablePath = this.workspaceStore.get<string | undefined>(Setting.CheckedExecutablePath, undefined);
			if (!checkedExecutablePath || checkedExecutablePath !== this.config!.executable) {
				if (await this.showCustomTrustDialog()) {
					this.workspaceStore.update(Setting.CheckedExecutablePath, this.config!.executable);
					vscode.commands.executeCommand('setContext', 'php.untrustValidationExecutableContext', true);
				} else {
					this.pauseValidation = true;
					return;
				}
			}

			trigger();
		}
	}

	private async showCustomTrustDialog(): Promise<boolean> {
		interface MessageItem extends vscode.MessageItem {
			id: string;
		}

		const selected = await vscode.window.showInformationMessage<MessageItem>(
			localize('php.useExecutablePath', 'Do you allow {0} (defined as a workspace setting) to be executed to lint PHP files?', this.config!.executable),
			{
				title: localize('php.yes', 'Allow'),
				id: 'yes'
			},
			{
				title: localize('php.no', 'Disallow'),
				isCloseAffordance: true,
				id: 'no'
			}
		);

		if (selected && selected.id === 'yes') {
			return true;
		}

		return false;
	}

	private doValidate(textDocument: vscode.TextDocument): Promise<void> {
		return new Promise<void>(async (resolve) => {
			const executable = this.config!.executable;
			if (!executable) {
				this.showErrorMessage(localize('noPhp', 'Cannot validate since a PHP installation could not be found. Use the setting \'php.validate.executablePath\' to configure the PHP executable.'));
				this.pauseValidation = true;
				resolve();
				return;
			}

			if (!path.isAbsolute(executable)) {
				// executable should either be resolved to an absolute path or undefined.
				// This is just to be sure.
				return;
			}

			let decoder = new LineDecoder();
			let diagnostics: vscode.Diagnostic[] = [];
			let processLine = (line: string) => {
				let matches = line.match(PHPValidationProvider.MatchExpression);
				if (matches) {
					let message = matches[1];
					let line = parseInt(matches[3]) - 1;
					let diagnostic: vscode.Diagnostic = new vscode.Diagnostic(
						new vscode.Range(line, 0, line, Number.MAX_VALUE),
						message
					);
					diagnostics.push(diagnostic);
				}
			};

			let options = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]) ? { cwd: vscode.workspace.workspaceFolders[0].uri.fsPath } : undefined;
			let args: string[];
			if (this.config!.trigger === RunTrigger.onSave) {
				args = PHPValidationProvider.FileArgs.slice(0);
				args.push(textDocument.fileName);
			} else {
				args = PHPValidationProvider.BufferArgs;
			}
			try {
				let childProcess = cp.spawn(executable, args, options);
				childProcess.on('error', (error: Error) => {
					if (this.pauseValidation) {
						resolve();
						return;
					}
					this.showError(error, executable);
					this.pauseValidation = true;
					resolve();
				});
				if (childProcess.pid) {
					if (this.config!.trigger === RunTrigger.onType) {
						childProcess.stdin.write(textDocument.getText());
						childProcess.stdin.end();
					}
					childProcess.stdout.on('data', (data: Buffer) => {
						decoder.write(data).forEach(processLine);
					});
					childProcess.stdout.on('end', () => {
						let line = decoder.end();
						if (line) {
							processLine(line);
						}
						this.diagnosticCollection!.set(textDocument.uri, diagnostics);
						resolve();
					});
				} else {
					resolve();
				}
			} catch (error) {
				this.showError(error, executable);
			}
		});
	}

	private async showError(error: any, executable: string): Promise<void> {
		let message: string | null = null;
		if (error.code === 'ENOENT') {
			if (this.config!.executable) {
				message = localize('wrongExecutable', 'Cannot validate since {0} is not a valid php executable. Use the setting \'php.validate.executablePath\' to configure the PHP executable.', executable);
			} else {
				message = localize('noExecutable', 'Cannot validate since no PHP executable is set. Use the setting \'php.validate.executablePath\' to configure the PHP executable.');
			}
		} else {
			message = error.message ? error.message : localize('unknownReason', 'Failed to run php using path: {0}. Reason is unknown.', executable);
		}
		if (!message) {
			return;
		}

		return this.showErrorMessage(message);
	}

	private async showErrorMessage(message: string): Promise<void> {
		const openSettings = localize('goToSetting', 'Open Settings');
		if (await vscode.window.showInformationMessage(message, openSettings) === openSettings) {
			vscode.commands.executeCommand('workbench.action.openSettings', Setting.ExecutablePath);
		}
	}
}

interface IPhpConfig {
	readonly executable: string | undefined;
	readonly executableIsUserDefined: boolean | undefined;
	readonly trigger: RunTrigger;
}

async function getConfig(): Promise<IPhpConfig> {
	const section = vscode.workspace.getConfiguration();

	let executable: string | undefined;
	let executableIsUserDefined: boolean | undefined;
	const inspect = section.inspect<string>(Setting.ExecutablePath);
	if (inspect && inspect.workspaceValue) {
		executable = inspect.workspaceValue;
		executableIsUserDefined = false;
	} else if (inspect && inspect.globalValue) {
		executable = inspect.globalValue;
		executableIsUserDefined = true;
	} else {
		executable = undefined;
		executableIsUserDefined = undefined;
	}

	if (executable && !path.isAbsolute(executable)) {
		const first = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
		if (first) {
			executable = vscode.Uri.joinPath(first.uri, executable).fsPath;
		} else {
			executable = undefined;
		}
	} else if (!executable) {
		executable = await getPhpPath();
	}

	const trigger = RunTrigger.from(section.get<string>(Setting.Run, RunTrigger.strings.onSave));
	return {
		executable,
		executableIsUserDefined,
		trigger
	};
}

async function getPhpPath(): Promise<string | undefined> {
	try {
		return await which('php');
	} catch (e) {
		return undefined;
	}
}
