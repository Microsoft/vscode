/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export namespace EditorContextKeys {

	export const editorSimpleInput = new RawContextKey<boolean>('editorSimpleInput', false, true);
	/**
	 * A context key that is set when the editor's text has focus (cursor is blinking).
	 * Is false when focus is in simple editor widgets (repl input, scm commit input).
	 */
	export const editorTextFocus = new RawContextKey<boolean>('editorTextFocus', false, nls.localize('editorTextFocus', "Whether the editor text has focus (cursor is blinking)"));
	/**
	 * A context key that is set when the editor's text or an editor's widget has focus.
	 */
	export const focus = new RawContextKey<boolean>('editorFocus', false, nls.localize('editorFocus', "Whether the editor or an editor widget has focus (e.g. focus is in the find widget)"));

	/**
	 * A context key that is set when any editor input has focus (regular editor, repl input...).
	 */
	export const textInputFocus = new RawContextKey<boolean>('textInputFocus', false, nls.localize('textInputFocus', "Whether an editor or a rich text input has focus (cursor is blinking)"));

	export const readOnly = new RawContextKey<boolean>('editorReadonly', false, nls.localize('editorReadonly', "Whether the editor is read only"));
	export const inDiffEditor = new RawContextKey<boolean>('inDiffEditor', false, nls.localize('inDiffEditor', "Whether the context is a diff editor"));
	export const columnSelection = new RawContextKey<boolean>('editorColumnSelection', false, nls.localize('editorColumnSelection', "Whether `editor.columnSelection` is enabled"));
	export const writable = readOnly.toNegated();
	export const hasNonEmptySelection = new RawContextKey<boolean>('editorHasSelection', false, nls.localize('editorHasSelection', "Whether the editor has text selected"));
	export const hasOnlyEmptySelection = hasNonEmptySelection.toNegated();
	export const hasMultipleSelections = new RawContextKey<boolean>('editorHasMultipleSelections', false, nls.localize('editorHasMultipleSelections', "Whether the editor has multiple selections"));
	export const hasSingleSelection = hasMultipleSelections.toNegated();
	export const tabMovesFocus = new RawContextKey<boolean>('editorTabMovesFocus', false, nls.localize('editorTabMovesFocus', "Whether `Tab` will move focus out of the editor"));
	export const tabDoesNotMoveFocus = tabMovesFocus.toNegated();
	export const isInWalkThroughSnippet = new RawContextKey<boolean>('isInEmbeddedEditor', false, true);
	export const canUndo = new RawContextKey<boolean>('canUndo', false, true);
	export const canRedo = new RawContextKey<boolean>('canRedo', false, true);

	export const hoverVisible = new RawContextKey<boolean>('editorHoverVisible', false, nls.localize('editorHoverVisible', "Whether the editor hover is visible"));

	/**
	 * A context key that is set when an editor is part of a larger editor, like notebooks or
	 * (future) a diff editor
	 */
	export const inCompositeEditor = new RawContextKey<boolean>('inCompositeEditor', undefined, nls.localize('inCompositeEditor', "Whether the editor is part of a larger editor (e.g. notebooks)"));
	export const notInCompositeEditor = inCompositeEditor.toNegated();

	// -- mode context keys
	export const languageId = new RawContextKey<string>('editorLangId', '', nls.localize('editorLangId', "The language identifier of the editor"));
	export const hasCompletionItemProvider = new RawContextKey<boolean>('editorHasCompletionItemProvider', false, nls.localize('editorHasCompletionItemProvider', "Whether the editor has a completion item provider"));
	export const hasCodeActionsProvider = new RawContextKey<boolean>('editorHasCodeActionsProvider', false, nls.localize('editorHasCodeActionsProvider', "Whether the editor has a code actions provider"));
	export const hasCodeLensProvider = new RawContextKey<boolean>('editorHasCodeLensProvider', false, nls.localize('editorHasCodeLensProvider', "Whether the editor has a code lens provider"));
	export const hasDefinitionProvider = new RawContextKey<boolean>('editorHasDefinitionProvider', false, nls.localize('editorHasDefinitionProvider', "Whether the editor has a definition provider"));
	export const hasDeclarationProvider = new RawContextKey<boolean>('editorHasDeclarationProvider', false, nls.localize('editorHasDeclarationProvider', "Whether the editor has a declaration provider"));
	export const hasImplementationProvider = new RawContextKey<boolean>('editorHasImplementationProvider', false, nls.localize('editorHasImplementationProvider', "Whether the editor has an implementation provider"));
	export const hasTypeDefinitionProvider = new RawContextKey<boolean>('editorHasTypeDefinitionProvider', false, nls.localize('editorHasTypeDefinitionProvider', "Whether the editor has a type definition provider"));
	export const hasHoverProvider = new RawContextKey<boolean>('editorHasHoverProvider', false, nls.localize('editorHasHoverProvider', "Whether the editor has a hover provider"));
	export const hasDocumentHighlightProvider = new RawContextKey<boolean>('editorHasDocumentHighlightProvider', false, nls.localize('editorHasDocumentHighlightProvider', "Whether the editor has a document highlight provider"));
	export const hasDocumentSymbolProvider = new RawContextKey<boolean>('editorHasDocumentSymbolProvider', false, nls.localize('editorHasDocumentSymbolProvider', "Whether the editor has a document symbol provider"));
	export const hasReferenceProvider = new RawContextKey<boolean>('editorHasReferenceProvider', false, nls.localize('editorHasReferenceProvider', "Whether the editor has a reference provider"));
	export const hasRenameProvider = new RawContextKey<boolean>('editorHasRenameProvider', false, nls.localize('editorHasRenameProvider', "Whether the editor has a rename provider"));
	export const hasSignatureHelpProvider = new RawContextKey<boolean>('editorHasSignatureHelpProvider', false, nls.localize('editorHasSignatureHelpProvider', "Whether the editor has a signature help provider"));
	export const hasInlayHintsProvider = new RawContextKey<boolean>('editorHasInlayHintsProvider', false, nls.localize('editorHasInlayHintsProvider', "Whether the editor has an inline hints provider"));

	// -- mode context keys: formatting
	export const hasDocumentFormattingProvider = new RawContextKey<boolean>('editorHasDocumentFormattingProvider', false, nls.localize('editorHasDocumentFormattingProvider', "Whether the editor has a document formatting provider"));
	export const hasDocumentSelectionFormattingProvider = new RawContextKey<boolean>('editorHasDocumentSelectionFormattingProvider', false, nls.localize('editorHasDocumentSelectionFormattingProvider', "Whether the editor has a document selection formatting provider"));
	export const hasMultipleDocumentFormattingProvider = new RawContextKey<boolean>('editorHasMultipleDocumentFormattingProvider', false, nls.localize('editorHasMultipleDocumentFormattingProvider', "Whether the editor has multiple document formatting providers"));
	export const hasMultipleDocumentSelectionFormattingProvider = new RawContextKey<boolean>('editorHasMultipleDocumentSelectionFormattingProvider', false, nls.localize('editorHasMultipleDocumentSelectionFormattingProvider', "Whether the editor has multiple document selection formatting providers"));

}
