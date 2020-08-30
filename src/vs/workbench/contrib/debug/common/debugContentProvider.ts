/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI as uri } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { guessMimeTypes, MIME_TEXT } from 'vs/base/common/mime';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { DEBUG_SCHEME, IDebugService, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { CancellationTokenSource } from 'vs/base/common/cancellation';

/**
 * Debug URI format
 *
 * a debug URI represents a Source object and the debug session where the Source comes from.
 *
 *       debug:arbitrary_path?session=123e4567-e89b-12d3-a456-426655440000&ref=1016
 *       \___/ \____________/ \__________________________________________/ \______/
 *         |          |                             |                          |
 *      scheme   source.path                    session id            source.reference
 *
 * the arbitrary_path and the session id are encoded with 'encodeURIComponent'
 *
 */
export class DebugContentProvider implements IWorkbenchContribution, ITextModelContentProvider {

	private static INSTANCE: DebugContentProvider;

	private readonly pendingUpdates = new Map<string, CancellationTokenSource>();

	constructor(
		@ITextModelService textModelResolverService: ITextModelService,
		@IDebugService private readonly debugService: IDebugService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IEditorWorkerService private readonly editorWorkerService: IEditorWorkerService
	) {
		textModelResolverService.registerTextModelContentProvider(DEBUG_SCHEME, this);
		DebugContentProvider.INSTANCE = this;
	}

	dispose(): void {
		this.pendingUpdates.forEach(cancellationSource => cancellationSource.dispose());
	}

	provideTextContent(resource: uri): Promise<ITextModel> | null {
		return this.createOrUpdateContentModel(resource, true);
	}

	/**
	 * Reload the model content of the given resource.
	 * If there is no model for the given resource, this method does nothing.
	 */
	static refreshDebugContent(resource: uri): void {
		if (DebugContentProvider.INSTANCE) {
			DebugContentProvider.INSTANCE.createOrUpdateContentModel(resource, false);
		}
	}

	/**
	 * Create or reload the model content of the given resource.
	 */
	private createOrUpdateContentModel(resource: uri, createIfNotExists: boolean): Promise<ITextModel> | null {

		const model = this.modelService.getModel(resource);
		if (!model && !createIfNotExists) {
			// nothing to do
			return null;
		}

		let session: IDebugSession | undefined;

		if (resource.query) {
			const data = Source.getEncodedDebugData(resource);
			session = this.debugService.getModel().getSession(data.sessionId);
		}

		if (!session) {
			// fallback: use focused session
			session = this.debugService.getViewModel().focusedSession;
		}

		if (!session) {
			return Promise.reject(new Error(localize('unable', "Unable to resolve the resource without a debug session")));
		}
		const createErrModel = (errMsg?: string) => {
			this.debugService.sourceIsNotAvailable(resource);
			const languageSelection = this.modeService.create(MIME_TEXT);
			const message = errMsg
				? localize('canNotResolveSourceWithError', "Could not load source '{0}': {1}.", resource.path, errMsg)
				: localize('canNotResolveSource', "Could not load source '{0}'.", resource.path);
			return this.modelService.createModel(message, languageSelection, resource);
		};

		return session.loadSource(resource).then(response => {

			if (response && response.body) {

				if (model) {

					const newContent = response.body.content;

					// cancel and dispose an existing update
					const cancellationSource = this.pendingUpdates.get(model.id);
					if (cancellationSource) {
						cancellationSource.cancel();
					}

					// create and keep update token
					const myToken = new CancellationTokenSource();
					this.pendingUpdates.set(model.id, myToken);

					// update text model
					return this.editorWorkerService.computeMoreMinimalEdits(model.uri, [{ text: newContent, range: model.getFullModelRange() }]).then(edits => {

						// remove token
						this.pendingUpdates.delete(model.id);

						if (!myToken.token.isCancellationRequested && edits && edits.length > 0) {
							// use the evil-edit as these models show in readonly-editor only
							model.applyEdits(edits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text)));
						}
						return model;
					});
				} else {
					// create text model
					const mime = response.body.mimeType || guessMimeTypes(resource)[0];
					const languageSelection = this.modeService.create(mime);
					return this.modelService.createModel(response.body.content, languageSelection, resource);
				}
			}

			return createErrModel();

		}, (err: DebugProtocol.ErrorResponse) => createErrModel(err.message));
	}
}
