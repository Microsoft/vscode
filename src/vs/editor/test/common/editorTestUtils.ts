/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { DefaultEndOfLine, ITextModelCreationOptions } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';

export function withEditorModel(text: string[], callback: (model: TextModel) => void): void {
	let model = createTextModel(text.join('\n'));
	callback(model);
	model.dispose();
}

export interface IRelaxedTextModelCreationOptions {
	tabSize?: number;
	indentSize?: number;
	insertSpaces?: boolean;
	detectIndentation?: boolean;
	trimAutoWhitespace?: boolean;
	defaultEOL?: DefaultEndOfLine;
	isForSimpleWidget?: boolean;
	largeFileOptimizations?: boolean;
}

export function createTextModel(text: string, _options: IRelaxedTextModelCreationOptions = TextModel.DEFAULT_CREATION_OPTIONS, languageIdentifier: LanguageIdentifier | null = null, uri: URI | null = null): TextModel {
	const options: ITextModelCreationOptions = {
		tabSize: (typeof _options.tabSize === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.tabSize : _options.tabSize),
		indentSize: (typeof _options.indentSize === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.indentSize : _options.indentSize),
		insertSpaces: (typeof _options.insertSpaces === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.insertSpaces : _options.insertSpaces),
		detectIndentation: (typeof _options.detectIndentation === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.detectIndentation : _options.detectIndentation),
		trimAutoWhitespace: (typeof _options.trimAutoWhitespace === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.trimAutoWhitespace : _options.trimAutoWhitespace),
		defaultEOL: (typeof _options.defaultEOL === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.defaultEOL : _options.defaultEOL),
		isForSimpleWidget: (typeof _options.isForSimpleWidget === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.isForSimpleWidget : _options.isForSimpleWidget),
		largeFileOptimizations: (typeof _options.largeFileOptimizations === 'undefined' ? TextModel.DEFAULT_CREATION_OPTIONS.largeFileOptimizations : _options.largeFileOptimizations),
	};
	const dialogService = new TestDialogService();
	const notificationService = new TestNotificationService();
	const undoRedoService = new UndoRedoService(dialogService, notificationService);
	return new TextModel(text, options, languageIdentifier, uri, undoRedoService);
}
