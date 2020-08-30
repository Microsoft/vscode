/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ServerResponse } from '../typescriptService';

type Resolve<T extends Proto.Response> = () => Promise<ServerResponse.Response<T>>;

/**
 * Caches a class of TS Server request based on document.
 */
export class CachedResponse<T extends Proto.Response> {
	private response?: Promise<ServerResponse.Response<T>>;
	private version: number = -1;
	private document: string = '';

	/**
	 * Execute a request. May return cached value or resolve the new value
	 *
	 * Caller must ensure that all input `resolve` functions return equivilent results (keyed only off of document).
	 */
	public execute(
		document: vscode.TextDocument,
		resolve: Resolve<T>
	): Promise<ServerResponse.Response<T>> {
		if (this.response && this.matches(document)) {
			// Chain so that on cancellation we fall back to the next resolve
			return this.response = this.response.then(result => result.type === 'cancelled' ? resolve() : result);
		}
		return this.reset(document, resolve);
	}

	private matches(document: vscode.TextDocument): boolean {
		return this.version === document.version && this.document === document.uri.toString();
	}

	private async reset(
		document: vscode.TextDocument,
		resolve: Resolve<T>
	): Promise<ServerResponse.Response<T>> {
		this.version = document.version;
		this.document = document.uri.toString();
		return this.response = resolve();
	}
}
