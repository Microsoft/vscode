/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import * as json from 'vs/base/common/json';
import * as strings from 'vs/base/common/strings';
import { setProperty } from 'vs/base/common/jsonEdit';
import { Queue } from 'vs/base/common/async';
import { Edit } from 'vs/base/common/jsonFormatter';
import { IReference } from 'vs/base/common/lifecycle';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IFileService } from 'vs/platform/files/common/files';
import { ITextModelService, IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { IJSONEditingService, IJSONValue, JSONEditingError, JSONEditingErrorCode } from 'vs/workbench/services/configuration/common/jsonEditing';
import { ITextModel } from 'vs/editor/common/model';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class JSONEditingService implements IJSONEditingService {

	public _serviceBrand: undefined;

	private queue: Queue<void>;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@ITextFileService private readonly textFileService: ITextFileService
	) {
		this.queue = new Queue<void>();
	}

	write(resource: URI, values: IJSONValue[], save: boolean): Promise<void> {
		return Promise.resolve(this.queue.queue(() => this.doWriteConfiguration(resource, values, save))); // queue up writes to prevent race conditions
	}

	private async doWriteConfiguration(resource: URI, values: IJSONValue[], save: boolean): Promise<void> {
		const reference = await this.resolveAndValidate(resource, save);
		try {
			await this.writeToBuffer(reference.object.textEditorModel, values, save);
		} finally {
			reference.dispose();
		}
	}

	private async writeToBuffer(model: ITextModel, values: IJSONValue[], save: boolean): Promise<any> {
		let hasEdits: boolean = false;
		for (const value of values) {
			const edit = this.getEdits(model, value)[0];
			hasEdits = this.applyEditsToBuffer(edit, model);
		}
		if (hasEdits && save) {
			return this.textFileService.save(model.uri);
		}
	}

	private applyEditsToBuffer(edit: Edit, model: ITextModel): boolean {
		const startPosition = model.getPositionAt(edit.offset);
		const endPosition = model.getPositionAt(edit.offset + edit.length);
		const range = new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column);
		let currentText = model.getValueInRange(range);
		if (edit.content !== currentText) {
			const editOperation = currentText ? EditOperation.replace(range, edit.content) : EditOperation.insert(startPosition, edit.content);
			model.pushEditOperations([new Selection(startPosition.lineNumber, startPosition.column, startPosition.lineNumber, startPosition.column)], [editOperation], () => []);
			return true;
		}
		return false;
	}

	private getEdits(model: ITextModel, configurationValue: IJSONValue): Edit[] {
		const { tabSize, insertSpaces } = model.getOptions();
		const eol = model.getEOL();
		const { path, value } = configurationValue;

		// With empty path the entire file is being replaced, so we just use JSON.stringify
		if (!path.length) {
			const content = JSON.stringify(value, null, insertSpaces ? strings.repeat(' ', tabSize) : '\t');
			return [{
				content,
				length: content.length,
				offset: 0
			}];
		}

		return setProperty(model.getValue(), path, value, { tabSize, insertSpaces, eol });
	}

	private async resolveModelReference(resource: URI): Promise<IReference<IResolvedTextEditorModel>> {
		const exists = await this.fileService.exists(resource);
		if (!exists) {
			await this.textFileService.write(resource, '{}', { encoding: 'utf8' });
		}
		return this.textModelResolverService.createModelReference(resource);
	}

	private hasParseErrors(model: ITextModel): boolean {
		const parseErrors: json.ParseError[] = [];
		json.parse(model.getValue(), parseErrors, { allowTrailingComma: true, allowEmptyContent: true });
		return parseErrors.length > 0;
	}

	private async resolveAndValidate(resource: URI, checkDirty: boolean): Promise<IReference<IResolvedTextEditorModel>> {
		const reference = await this.resolveModelReference(resource);

		const model = reference.object.textEditorModel;

		if (this.hasParseErrors(model)) {
			reference.dispose();
			return this.reject<IReference<IResolvedTextEditorModel>>(JSONEditingErrorCode.ERROR_INVALID_FILE);
		}

		// Target cannot be dirty if not writing into buffer
		if (checkDirty && this.textFileService.isDirty(resource)) {
			reference.dispose();
			return this.reject<IReference<IResolvedTextEditorModel>>(JSONEditingErrorCode.ERROR_FILE_DIRTY);
		}

		return reference;
	}

	private reject<T>(code: JSONEditingErrorCode): Promise<T> {
		const message = this.toErrorMessage(code);
		return Promise.reject(new JSONEditingError(message, code));
	}

	private toErrorMessage(error: JSONEditingErrorCode): string {
		switch (error) {
			// User issues
			case JSONEditingErrorCode.ERROR_INVALID_FILE: {
				return nls.localize('errorInvalidFile', "Unable to write into the file. Please open the file to correct errors/warnings in the file and try again.");
			}
			case JSONEditingErrorCode.ERROR_FILE_DIRTY: {
				return nls.localize('errorFileDirty', "Unable to write into the file because the file is dirty. Please save the file and try again.");
			}
		}
	}
}

registerSingleton(IJSONEditingService, JSONEditingService, true);
