/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { ExtHostContext, ExtHostDocumentContentProvidersShape, IExtHostContext, MainContext, MainThreadDocumentContentProvidersShape } from '../common/extHost.protocol';
import { CancellationTokenSource } from 'vs/base/common/cancellation';

@extHostNamedCustomer(MainContext.MainThreadDocumentContentProviders)
export class MainThreadDocumentContentProviders implements MainThreadDocumentContentProvidersShape {

	private readonly _resourceContentProvider = new Map<number, IDisposable>();
	private readonly _pendingUpdate = new Map<string, CancellationTokenSource>();
	private readonly _proxy: ExtHostDocumentContentProvidersShape;

	constructor(
		extHostContext: IExtHostContext,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IModeService private readonly _modeService: IModeService,
		@IModelService private readonly _modelService: IModelService,
		@IEditorWorkerService private readonly _editorWorkerService: IEditorWorkerService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDocumentContentProviders);
	}

	dispose(): void {
		dispose(this._resourceContentProvider.values());
		dispose(this._pendingUpdate.values());
	}

	$registerTextContentProvider(handle: number, scheme: string): void {
		const registration = this._textModelResolverService.registerTextModelContentProvider(scheme, {
			provideTextContent: (uri: URI): Promise<ITextModel | null> => {
				return this._proxy.$provideTextDocumentContent(handle, uri).then(value => {
					if (typeof value === 'string') {
						const firstLineText = value.substr(0, 1 + value.search(/\r?\n/));
						const languageSelection = this._modeService.createByFilepathOrFirstLine(uri, firstLineText);
						return this._modelService.createModel(value, languageSelection, uri);
					}
					return null;
				});
			}
		});
		this._resourceContentProvider.set(handle, registration);
	}

	$unregisterTextContentProvider(handle: number): void {
		const registration = this._resourceContentProvider.get(handle);
		if (registration) {
			registration.dispose();
			this._resourceContentProvider.delete(handle);
		}
	}

	$onVirtualDocumentChange(uri: UriComponents, value: string): void {
		const model = this._modelService.getModel(URI.revive(uri));
		if (!model) {
			return;
		}

		// cancel and dispose an existing update
		const pending = this._pendingUpdate.get(model.id);
		if (pending) {
			pending.cancel();
		}

		// create and keep update token
		const myToken = new CancellationTokenSource();
		this._pendingUpdate.set(model.id, myToken);

		this._editorWorkerService.computeMoreMinimalEdits(model.uri, [{ text: value, range: model.getFullModelRange() }]).then(edits => {
			// remove token
			this._pendingUpdate.delete(model.id);

			if (myToken.token.isCancellationRequested) {
				// ignore this
				return;
			}
			if (edits && edits.length > 0) {
				// use the evil-edit as these models show in readonly-editor only
				model.applyEdits(edits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text)));
			}
		}).catch(onUnexpectedError);
	}
}
