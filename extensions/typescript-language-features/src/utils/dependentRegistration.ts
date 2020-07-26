/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITypeScriptServiceClient, ClientCapability } from '../typescriptService';
import API from './api';
import { Disposable } from './dispose';

export class Condition extends Disposable {
	private _value: boolean;

	constructor(
		private readonly getValue: () => boolean,
		onUpdate: (handler: () => void) => void,
	) {
		super();
		this._value = this.getValue();

		onUpdate(() => {
			const newValue = this.getValue();
			if (newValue !== this._value) {
				this._value = newValue;
				this._onDidChange.fire();
			}
		});
	}

	public get value(): boolean { return this._value; }

	private readonly _onDidChange = this._register(new vscode.EventEmitter<void>());
	public readonly onDidChange = this._onDidChange.event;
}

class ConditionalRegistration {
	private registration: vscode.Disposable | undefined = undefined;

	public constructor(
		private readonly conditions: readonly Condition[],
		private readonly doRegister: () => vscode.Disposable
	) {
		for (const condition of conditions) {
			condition.onDidChange(() => this.update());
		}
		this.update();
	}

	public dispose() {
		this.registration?.dispose();
		this.registration = undefined;
	}

	private update() {
		const enabled = this.conditions.every(condition => condition.value);
		if (enabled) {
			if (!this.registration) {
				this.registration = this.doRegister();
			}
		} else {
			if (this.registration) {
				this.registration.dispose();
				this.registration = undefined;
			}
		}
	}
}

export function conditionalRegistration(
	conditions: readonly Condition[],
	doRegister: () => vscode.Disposable,
): vscode.Disposable {
	return new ConditionalRegistration(conditions, doRegister);
}

export function requireMinVersion(
	client: ITypeScriptServiceClient,
	minVersion: API,
) {
	return new Condition(
		() => client.apiVersion.gte(minVersion),
		client.onTsServerStarted
	);
}

export function requireConfiguration(
	language: string,
	configValue: string,
) {
	return new Condition(
		() => {
			const config = vscode.workspace.getConfiguration(language, null);
			return !!config.get<boolean>(configValue);
		},
		vscode.workspace.onDidChangeConfiguration
	);
}

export function requireSomeCapability(
	client: ITypeScriptServiceClient,
	...capabilities: readonly ClientCapability[]
) {
	return new Condition(
		() => capabilities.some(requiredCapability => client.capabilities.has(requiredCapability)),
		client.onDidChangeCapabilities
	);
}
