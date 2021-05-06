/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressOptions } from 'vscode';
import { MainThreadProgressShape, ExtHostProgressShape } from './extHost.protocol';
import { ProgressLocation } from './extHostTypeConverters';
import { Progress, IProgressStep } from 'vs/platform/progress/common/progress';
import { localize } from 'vs/nls';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { throttle } from 'vs/base/common/decorators';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';

export class ExtHostProgress implements ExtHostProgressShape {

	private _proxy: MainThreadProgressShape;
	private _handles: number = 0;
	private _mapHandleToCancellationSource: Map<number, CancellationTokenSource> = new Map();

	constructor(proxy: MainThreadProgressShape) {
		this._proxy = proxy;
	}

	withProgress<R>(extension: IExtensionDescription, options: ProgressOptions, task: (progress: Progress<IProgressStep>, token: CancellationToken) => Thenable<R>): Thenable<R> {
		const handle = this._handles++;
		const { title, location, cancellable } = options;
		const source = { label: localize('extensionSource', "{0} (Extension)", extension.displayName || extension.name), id: extension.identifier.value };

		this._proxy.$startProgress(handle, { location: ProgressLocation.from(location), title, source, cancellable }, extension);
		return this._withProgress(handle, task, !!cancellable);
	}

	private _withProgress<R>(handle: number, task: (progress: Progress<IProgressStep>, token: CancellationToken) => Thenable<R>, cancellable: boolean): Thenable<R> {
		let source: CancellationTokenSource | undefined;
		if (cancellable) {
			source = new CancellationTokenSource();
			this._mapHandleToCancellationSource.set(handle, source);
		}

		const progressEnd = (handle: number): void => {
			this._proxy.$progressEnd(handle);
			this._mapHandleToCancellationSource.delete(handle);
			if (source) {
				source.dispose();
			}
		};

		let p: Thenable<R>;

		try {
			p = task(new ProgressCallback(this._proxy, handle), cancellable && source ? source.token : CancellationToken.None);
		} catch (err) {
			progressEnd(handle);
			throw err;
		}

		p.then(result => progressEnd(handle), err => progressEnd(handle));
		return p;
	}

	public $acceptProgressCanceled(handle: number): void {
		const source = this._mapHandleToCancellationSource.get(handle);
		if (source) {
			source.cancel();
			this._mapHandleToCancellationSource.delete(handle);
		}
	}
}

function mergeProgress(result: IProgressStep, currentValue: IProgressStep): IProgressStep {
	result.message = currentValue.message;
	if (typeof currentValue.increment === 'number') {
		if (typeof result.increment === 'number') {
			result.increment += currentValue.increment;
		} else {
			result.increment = currentValue.increment;
		}
	}

	return result;
}

class ProgressCallback extends Progress<IProgressStep> {
	constructor(private _proxy: MainThreadProgressShape, private _handle: number) {
		super(p => this.throttledReport(p));
	}

	@throttle(100, (result: IProgressStep, currentValue: IProgressStep) => mergeProgress(result, currentValue), () => Object.create(null))
	throttledReport(p: IProgressStep): void {
		this._proxy.$progressReport(this._handle, p);
	}
}
