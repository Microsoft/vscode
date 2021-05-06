/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, isNonEmptyArray } from 'vs/base/common/arrays';
import * as htmlContent from 'vs/base/common/htmlContent';
import { DisposableStore } from 'vs/base/common/lifecycle';
import * as marked from 'vs/base/common/marked/marked';
import { parse } from 'vs/base/common/marshalling';
import { cloneAndChange } from 'vs/base/common/objects';
import { isDefined, isNumber, isString } from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { RenderLineNumbersType } from 'vs/editor/common/config/editorOptions';
import { IPosition } from 'vs/editor/common/core/position';
import * as editorRange from 'vs/editor/common/core/range';
import { ISelection } from 'vs/editor/common/core/selection';
import { IContentDecorationRenderOptions, IDecorationOptions, IDecorationRenderOptions, IThemeDecorationRenderOptions } from 'vs/editor/common/editorCommon';
import { EndOfLineSequence, TrackedRangeStickiness } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import * as languageSelector from 'vs/editor/common/modes/languageSelector';
import { EditorOverride, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IMarkerData, IRelatedInformation, MarkerSeverity, MarkerTag } from 'vs/platform/markers/common/markers';
import { ProgressLocation as MainProgressLocation } from 'vs/platform/progress/common/progress';
import * as extHostProtocol from 'vs/workbench/api/common/extHost.protocol';
import { CommandsConverter } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { EditorGroupColumn, SaveReason } from 'vs/workbench/common/editor';
import * as notebooks from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import * as search from 'vs/workbench/contrib/search/common/search';
import { ISerializedTestResults, ITestItem, ITestMessage, SerializedTestResultItem } from 'vs/workbench/contrib/testing/common/testCollection';
import { ACTIVE_GROUP, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import type * as vscode from 'vscode';
import * as types from './extHostTypes';

export interface PositionLike {
	line: number;
	character: number;
}

export interface RangeLike {
	start: PositionLike;
	end: PositionLike;
}

export interface SelectionLike extends RangeLike {
	anchor: PositionLike;
	active: PositionLike;
}
export namespace Selection {

	export function to(selection: ISelection): types.Selection {
		const { selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn } = selection;
		const start = new types.Position(selectionStartLineNumber - 1, selectionStartColumn - 1);
		const end = new types.Position(positionLineNumber - 1, positionColumn - 1);
		return new types.Selection(start, end);
	}

	export function from(selection: SelectionLike): ISelection {
		const { anchor, active } = selection;
		return {
			selectionStartLineNumber: anchor.line + 1,
			selectionStartColumn: anchor.character + 1,
			positionLineNumber: active.line + 1,
			positionColumn: active.character + 1
		};
	}
}
export namespace Range {

	export function from(range: undefined): undefined;
	export function from(range: RangeLike): editorRange.IRange;
	export function from(range: RangeLike | undefined): editorRange.IRange | undefined;
	export function from(range: RangeLike | undefined): editorRange.IRange | undefined {
		if (!range) {
			return undefined;
		}
		const { start, end } = range;
		return {
			startLineNumber: start.line + 1,
			startColumn: start.character + 1,
			endLineNumber: end.line + 1,
			endColumn: end.character + 1
		};
	}

	export function to(range: undefined): types.Range;
	export function to(range: editorRange.IRange): types.Range;
	export function to(range: editorRange.IRange | undefined): types.Range | undefined;
	export function to(range: editorRange.IRange | undefined): types.Range | undefined {
		if (!range) {
			return undefined;
		}
		const { startLineNumber, startColumn, endLineNumber, endColumn } = range;
		return new types.Range(startLineNumber - 1, startColumn - 1, endLineNumber - 1, endColumn - 1);
	}
}

export namespace TokenType {
	export function to(type: modes.StandardTokenType): types.StandardTokenType {
		switch (type) {
			case modes.StandardTokenType.Comment: return types.StandardTokenType.Comment;
			case modes.StandardTokenType.Other: return types.StandardTokenType.Other;
			case modes.StandardTokenType.RegEx: return types.StandardTokenType.RegEx;
			case modes.StandardTokenType.String: return types.StandardTokenType.String;
		}
	}
}

export namespace Position {
	export function to(position: IPosition): types.Position {
		return new types.Position(position.lineNumber - 1, position.column - 1);
	}
	export function from(position: types.Position | vscode.Position): IPosition {
		return { lineNumber: position.line + 1, column: position.character + 1 };
	}
}

export namespace DiagnosticTag {
	export function from(value: vscode.DiagnosticTag): MarkerTag | undefined {
		switch (value) {
			case types.DiagnosticTag.Unnecessary:
				return MarkerTag.Unnecessary;
			case types.DiagnosticTag.Deprecated:
				return MarkerTag.Deprecated;
		}
		return undefined;
	}
	export function to(value: MarkerTag): vscode.DiagnosticTag | undefined {
		switch (value) {
			case MarkerTag.Unnecessary:
				return types.DiagnosticTag.Unnecessary;
			case MarkerTag.Deprecated:
				return types.DiagnosticTag.Deprecated;
			default:
				return undefined;
		}
	}
}

export namespace Diagnostic {
	export function from(value: vscode.Diagnostic): IMarkerData {
		let code: string | { value: string; target: URI } | undefined;

		if (value.code) {
			if (isString(value.code) || isNumber(value.code)) {
				code = String(value.code);
			} else {
				code = {
					value: String(value.code.value),
					target: value.code.target,
				};
			}
		}

		return {
			...Range.from(value.range),
			message: value.message,
			source: value.source,
			code,
			severity: DiagnosticSeverity.from(value.severity),
			relatedInformation: value.relatedInformation && value.relatedInformation.map(DiagnosticRelatedInformation.from),
			tags: Array.isArray(value.tags) ? coalesce(value.tags.map(DiagnosticTag.from)) : undefined,
		};
	}

	export function to(value: IMarkerData): vscode.Diagnostic {
		const res = new types.Diagnostic(Range.to(value), value.message, DiagnosticSeverity.to(value.severity));
		res.source = value.source;
		res.code = isString(value.code) ? value.code : value.code?.value;
		res.relatedInformation = value.relatedInformation && value.relatedInformation.map(DiagnosticRelatedInformation.to);
		res.tags = value.tags && coalesce(value.tags.map(DiagnosticTag.to));
		return res;
	}
}

export namespace DiagnosticRelatedInformation {
	export function from(value: vscode.DiagnosticRelatedInformation): IRelatedInformation {
		return {
			...Range.from(value.location.range),
			message: value.message,
			resource: value.location.uri
		};
	}
	export function to(value: IRelatedInformation): types.DiagnosticRelatedInformation {
		return new types.DiagnosticRelatedInformation(new types.Location(value.resource, Range.to(value)), value.message);
	}
}
export namespace DiagnosticSeverity {

	export function from(value: number): MarkerSeverity {
		switch (value) {
			case types.DiagnosticSeverity.Error:
				return MarkerSeverity.Error;
			case types.DiagnosticSeverity.Warning:
				return MarkerSeverity.Warning;
			case types.DiagnosticSeverity.Information:
				return MarkerSeverity.Info;
			case types.DiagnosticSeverity.Hint:
				return MarkerSeverity.Hint;
		}
		return MarkerSeverity.Error;
	}

	export function to(value: MarkerSeverity): types.DiagnosticSeverity {
		switch (value) {
			case MarkerSeverity.Info:
				return types.DiagnosticSeverity.Information;
			case MarkerSeverity.Warning:
				return types.DiagnosticSeverity.Warning;
			case MarkerSeverity.Error:
				return types.DiagnosticSeverity.Error;
			case MarkerSeverity.Hint:
				return types.DiagnosticSeverity.Hint;
			default:
				return types.DiagnosticSeverity.Error;
		}
	}
}

export namespace ViewColumn {
	export function from(column?: vscode.ViewColumn): EditorGroupColumn {
		if (typeof column === 'number' && column >= types.ViewColumn.One) {
			return column - 1; // adjust zero index (ViewColumn.ONE => 0)
		}

		if (column === types.ViewColumn.Beside) {
			return SIDE_GROUP;
		}

		return ACTIVE_GROUP; // default is always the active group
	}

	export function to(position: EditorGroupColumn): vscode.ViewColumn {
		if (typeof position === 'number' && position >= 0) {
			return position + 1; // adjust to index (ViewColumn.ONE => 1)
		}

		throw new Error(`invalid 'EditorGroupColumn'`);
	}
}

function isDecorationOptions(something: any): something is vscode.DecorationOptions {
	return (typeof something.range !== 'undefined');
}

export function isDecorationOptionsArr(something: vscode.Range[] | vscode.DecorationOptions[]): something is vscode.DecorationOptions[] {
	if (something.length === 0) {
		return true;
	}
	return isDecorationOptions(something[0]) ? true : false;
}

export namespace MarkdownString {

	export function fromMany(markup: (vscode.MarkdownString | vscode.MarkedString)[]): htmlContent.IMarkdownString[] {
		return markup.map(MarkdownString.from);
	}

	interface Codeblock {
		language: string;
		value: string;
	}

	function isCodeblock(thing: any): thing is Codeblock {
		return thing && typeof thing === 'object'
			&& typeof (<Codeblock>thing).language === 'string'
			&& typeof (<Codeblock>thing).value === 'string';
	}

	export function from(markup: vscode.MarkdownString | vscode.MarkedString): htmlContent.IMarkdownString {
		let res: htmlContent.IMarkdownString;
		if (isCodeblock(markup)) {
			const { language, value } = markup;
			res = { value: '```' + language + '\n' + value + '\n```\n' };
		} else if (types.MarkdownString.isMarkdownString(markup)) {
			res = { value: markup.value, isTrusted: markup.isTrusted, supportThemeIcons: markup.supportThemeIcons };
		} else if (typeof markup === 'string') {
			res = { value: markup };
		} else {
			res = { value: '' };
		}

		// extract uris into a separate object
		const resUris: { [href: string]: UriComponents; } = Object.create(null);
		res.uris = resUris;

		const collectUri = (href: string): string => {
			try {
				let uri = URI.parse(href, true);
				uri = uri.with({ query: _uriMassage(uri.query, resUris) });
				resUris[href] = uri;
			} catch (e) {
				// ignore
			}
			return '';
		};
		const renderer = new marked.Renderer();
		renderer.link = collectUri;
		renderer.image = href => collectUri(htmlContent.parseHrefAndDimensions(href).href);

		marked(res.value, { renderer });

		return res;
	}

	function _uriMassage(part: string, bucket: { [n: string]: UriComponents; }): string {
		if (!part) {
			return part;
		}
		let data: any;
		try {
			data = parse(part);
		} catch (e) {
			// ignore
		}
		if (!data) {
			return part;
		}
		let changed = false;
		data = cloneAndChange(data, value => {
			if (URI.isUri(value)) {
				const key = `__uri_${Math.random().toString(16).slice(2, 8)}`;
				bucket[key] = value;
				changed = true;
				return key;
			} else {
				return undefined;
			}
		});

		if (!changed) {
			return part;
		}

		return JSON.stringify(data);
	}

	export function to(value: htmlContent.IMarkdownString): vscode.MarkdownString {
		const result = new types.MarkdownString(value.value, value.supportThemeIcons);
		result.isTrusted = value.isTrusted;
		return result;
	}

	export function fromStrict(value: string | vscode.MarkdownString): undefined | string | htmlContent.IMarkdownString {
		if (!value) {
			return undefined;
		}
		return typeof value === 'string' ? value : MarkdownString.from(value);
	}
}

export function fromRangeOrRangeWithMessage(ranges: vscode.Range[] | vscode.DecorationOptions[]): IDecorationOptions[] {
	if (isDecorationOptionsArr(ranges)) {
		return ranges.map((r): IDecorationOptions => {
			return {
				range: Range.from(r.range),
				hoverMessage: Array.isArray(r.hoverMessage)
					? MarkdownString.fromMany(r.hoverMessage)
					: (r.hoverMessage ? MarkdownString.from(r.hoverMessage) : undefined),
				renderOptions: <any> /* URI vs Uri */r.renderOptions
			};
		});
	} else {
		return ranges.map((r): IDecorationOptions => {
			return {
				range: Range.from(r)
			};
		});
	}
}

export function pathOrURIToURI(value: string | URI): URI {
	if (typeof value === 'undefined') {
		return value;
	}
	if (typeof value === 'string') {
		return URI.file(value);
	} else {
		return value;
	}
}

export namespace ThemableDecorationAttachmentRenderOptions {
	export function from(options: vscode.ThemableDecorationAttachmentRenderOptions): IContentDecorationRenderOptions {
		if (typeof options === 'undefined') {
			return options;
		}
		return {
			contentText: options.contentText,
			contentIconPath: options.contentIconPath ? pathOrURIToURI(options.contentIconPath) : undefined,
			border: options.border,
			borderColor: <string | types.ThemeColor>options.borderColor,
			fontStyle: options.fontStyle,
			fontWeight: options.fontWeight,
			textDecoration: options.textDecoration,
			color: <string | types.ThemeColor>options.color,
			backgroundColor: <string | types.ThemeColor>options.backgroundColor,
			margin: options.margin,
			width: options.width,
			height: options.height,
		};
	}
}

export namespace ThemableDecorationRenderOptions {
	export function from(options: vscode.ThemableDecorationRenderOptions): IThemeDecorationRenderOptions {
		if (typeof options === 'undefined') {
			return options;
		}
		return {
			backgroundColor: <string | types.ThemeColor>options.backgroundColor,
			outline: options.outline,
			outlineColor: <string | types.ThemeColor>options.outlineColor,
			outlineStyle: options.outlineStyle,
			outlineWidth: options.outlineWidth,
			border: options.border,
			borderColor: <string | types.ThemeColor>options.borderColor,
			borderRadius: options.borderRadius,
			borderSpacing: options.borderSpacing,
			borderStyle: options.borderStyle,
			borderWidth: options.borderWidth,
			fontStyle: options.fontStyle,
			fontWeight: options.fontWeight,
			textDecoration: options.textDecoration,
			cursor: options.cursor,
			color: <string | types.ThemeColor>options.color,
			opacity: options.opacity,
			letterSpacing: options.letterSpacing,
			gutterIconPath: options.gutterIconPath ? pathOrURIToURI(options.gutterIconPath) : undefined,
			gutterIconSize: options.gutterIconSize,
			overviewRulerColor: <string | types.ThemeColor>options.overviewRulerColor,
			before: options.before ? ThemableDecorationAttachmentRenderOptions.from(options.before) : undefined,
			after: options.after ? ThemableDecorationAttachmentRenderOptions.from(options.after) : undefined,
		};
	}
}

export namespace DecorationRangeBehavior {
	export function from(value: types.DecorationRangeBehavior): TrackedRangeStickiness {
		if (typeof value === 'undefined') {
			return value;
		}
		switch (value) {
			case types.DecorationRangeBehavior.OpenOpen:
				return TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges;
			case types.DecorationRangeBehavior.ClosedClosed:
				return TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
			case types.DecorationRangeBehavior.OpenClosed:
				return TrackedRangeStickiness.GrowsOnlyWhenTypingBefore;
			case types.DecorationRangeBehavior.ClosedOpen:
				return TrackedRangeStickiness.GrowsOnlyWhenTypingAfter;
		}
	}
}

export namespace DecorationRenderOptions {
	export function from(options: vscode.DecorationRenderOptions): IDecorationRenderOptions {
		return {
			isWholeLine: options.isWholeLine,
			rangeBehavior: options.rangeBehavior ? DecorationRangeBehavior.from(options.rangeBehavior) : undefined,
			overviewRulerLane: options.overviewRulerLane,
			light: options.light ? ThemableDecorationRenderOptions.from(options.light) : undefined,
			dark: options.dark ? ThemableDecorationRenderOptions.from(options.dark) : undefined,

			backgroundColor: <string | types.ThemeColor>options.backgroundColor,
			outline: options.outline,
			outlineColor: <string | types.ThemeColor>options.outlineColor,
			outlineStyle: options.outlineStyle,
			outlineWidth: options.outlineWidth,
			border: options.border,
			borderColor: <string | types.ThemeColor>options.borderColor,
			borderRadius: options.borderRadius,
			borderSpacing: options.borderSpacing,
			borderStyle: options.borderStyle,
			borderWidth: options.borderWidth,
			fontStyle: options.fontStyle,
			fontWeight: options.fontWeight,
			textDecoration: options.textDecoration,
			cursor: options.cursor,
			color: <string | types.ThemeColor>options.color,
			opacity: options.opacity,
			letterSpacing: options.letterSpacing,
			gutterIconPath: options.gutterIconPath ? pathOrURIToURI(options.gutterIconPath) : undefined,
			gutterIconSize: options.gutterIconSize,
			overviewRulerColor: <string | types.ThemeColor>options.overviewRulerColor,
			before: options.before ? ThemableDecorationAttachmentRenderOptions.from(options.before) : undefined,
			after: options.after ? ThemableDecorationAttachmentRenderOptions.from(options.after) : undefined,
		};
	}
}

export namespace TextEdit {

	export function from(edit: vscode.TextEdit): modes.TextEdit {
		return <modes.TextEdit>{
			text: edit.newText,
			eol: edit.newEol && EndOfLine.from(edit.newEol),
			range: Range.from(edit.range)
		};
	}

	export function to(edit: modes.TextEdit): types.TextEdit {
		const result = new types.TextEdit(Range.to(edit.range), edit.text);
		result.newEol = (typeof edit.eol === 'undefined' ? undefined : EndOfLine.to(edit.eol))!;
		return result;
	}
}

export namespace WorkspaceEdit {
	export function from(value: vscode.WorkspaceEdit, documents?: ExtHostDocumentsAndEditors, extHostNotebooks?: ExtHostNotebookController): extHostProtocol.IWorkspaceEditDto {
		const result: extHostProtocol.IWorkspaceEditDto = {
			edits: []
		};

		if (value instanceof types.WorkspaceEdit) {
			for (let entry of value._allEntries()) {

				if (entry._type === types.FileEditType.File) {
					// file operation
					result.edits.push(<extHostProtocol.IWorkspaceFileEditDto>{
						_type: extHostProtocol.WorkspaceEditType.File,
						oldUri: entry.from,
						newUri: entry.to,
						options: entry.options,
						metadata: entry.metadata
					});

				} else if (entry._type === types.FileEditType.Text) {
					// text edits
					const doc = documents?.getDocument(entry.uri);
					result.edits.push(<extHostProtocol.IWorkspaceTextEditDto>{
						_type: extHostProtocol.WorkspaceEditType.Text,
						resource: entry.uri,
						edit: TextEdit.from(entry.edit),
						modelVersionId: doc?.version,
						metadata: entry.metadata
					});
				} else if (entry._type === types.FileEditType.Cell) {
					result.edits.push(<extHostProtocol.IWorkspaceCellEditDto>{
						_type: extHostProtocol.WorkspaceEditType.Cell,
						metadata: entry.metadata,
						resource: entry.uri,
						edit: entry.edit,
						notebookMetadata: entry.notebookMetadata,
						notebookVersionId: extHostNotebooks?.lookupNotebookDocument(entry.uri)?.apiNotebook.version
					});

				} else if (entry._type === types.FileEditType.CellOutput) {
					if (entry.newOutputs) {
						result.edits.push({
							_type: extHostProtocol.WorkspaceEditType.Cell,
							metadata: entry.metadata,
							resource: entry.uri,
							edit: {
								editType: notebooks.CellEditType.Output,
								index: entry.index,
								append: entry.append,
								outputs: entry.newOutputs.map(NotebookCellOutput.from)
							}
						});
					}
					// todo@joh merge metadata and output edit?
					if (entry.newMetadata) {
						result.edits.push({
							_type: extHostProtocol.WorkspaceEditType.Cell,
							metadata: entry.metadata,
							resource: entry.uri,
							edit: {
								editType: notebooks.CellEditType.PartialMetadata,
								index: entry.index,
								metadata: entry.newMetadata
							}
						});
					}
				} else if (entry._type === types.FileEditType.CellReplace) {
					result.edits.push({
						_type: extHostProtocol.WorkspaceEditType.Cell,
						metadata: entry.metadata,
						resource: entry.uri,
						notebookVersionId: extHostNotebooks?.lookupNotebookDocument(entry.uri)?.apiNotebook.version,
						edit: {
							editType: notebooks.CellEditType.Replace,
							index: entry.index,
							count: entry.count,
							cells: entry.cells.map(NotebookCellData.from)
						}
					});
				} else if (entry._type === types.FileEditType.CellOutputItem) {
					result.edits.push({
						_type: extHostProtocol.WorkspaceEditType.Cell,
						metadata: entry.metadata,
						resource: entry.uri,
						edit: {
							editType: notebooks.CellEditType.OutputItems,
							outputId: entry.outputId,
							items: entry.newOutputItems?.map(NotebookCellOutputItem.from) || [],
							append: entry.append
						}
					});
				}
			}
		}
		return result;
	}

	export function to(value: extHostProtocol.IWorkspaceEditDto) {
		const result = new types.WorkspaceEdit();
		for (const edit of value.edits) {
			if ((<extHostProtocol.IWorkspaceTextEditDto>edit).edit) {
				result.replace(
					URI.revive((<extHostProtocol.IWorkspaceTextEditDto>edit).resource),
					Range.to((<extHostProtocol.IWorkspaceTextEditDto>edit).edit.range),
					(<extHostProtocol.IWorkspaceTextEditDto>edit).edit.text
				);
			} else {
				result.renameFile(
					URI.revive((<extHostProtocol.IWorkspaceFileEditDto>edit).oldUri!),
					URI.revive((<extHostProtocol.IWorkspaceFileEditDto>edit).newUri!),
					(<extHostProtocol.IWorkspaceFileEditDto>edit).options
				);
			}
		}
		return result;
	}
}


export namespace SymbolKind {

	const _fromMapping: { [kind: number]: modes.SymbolKind; } = Object.create(null);
	_fromMapping[types.SymbolKind.File] = modes.SymbolKind.File;
	_fromMapping[types.SymbolKind.Module] = modes.SymbolKind.Module;
	_fromMapping[types.SymbolKind.Namespace] = modes.SymbolKind.Namespace;
	_fromMapping[types.SymbolKind.Package] = modes.SymbolKind.Package;
	_fromMapping[types.SymbolKind.Class] = modes.SymbolKind.Class;
	_fromMapping[types.SymbolKind.Method] = modes.SymbolKind.Method;
	_fromMapping[types.SymbolKind.Property] = modes.SymbolKind.Property;
	_fromMapping[types.SymbolKind.Field] = modes.SymbolKind.Field;
	_fromMapping[types.SymbolKind.Constructor] = modes.SymbolKind.Constructor;
	_fromMapping[types.SymbolKind.Enum] = modes.SymbolKind.Enum;
	_fromMapping[types.SymbolKind.Interface] = modes.SymbolKind.Interface;
	_fromMapping[types.SymbolKind.Function] = modes.SymbolKind.Function;
	_fromMapping[types.SymbolKind.Variable] = modes.SymbolKind.Variable;
	_fromMapping[types.SymbolKind.Constant] = modes.SymbolKind.Constant;
	_fromMapping[types.SymbolKind.String] = modes.SymbolKind.String;
	_fromMapping[types.SymbolKind.Number] = modes.SymbolKind.Number;
	_fromMapping[types.SymbolKind.Boolean] = modes.SymbolKind.Boolean;
	_fromMapping[types.SymbolKind.Array] = modes.SymbolKind.Array;
	_fromMapping[types.SymbolKind.Object] = modes.SymbolKind.Object;
	_fromMapping[types.SymbolKind.Key] = modes.SymbolKind.Key;
	_fromMapping[types.SymbolKind.Null] = modes.SymbolKind.Null;
	_fromMapping[types.SymbolKind.EnumMember] = modes.SymbolKind.EnumMember;
	_fromMapping[types.SymbolKind.Struct] = modes.SymbolKind.Struct;
	_fromMapping[types.SymbolKind.Event] = modes.SymbolKind.Event;
	_fromMapping[types.SymbolKind.Operator] = modes.SymbolKind.Operator;
	_fromMapping[types.SymbolKind.TypeParameter] = modes.SymbolKind.TypeParameter;

	export function from(kind: vscode.SymbolKind): modes.SymbolKind {
		return typeof _fromMapping[kind] === 'number' ? _fromMapping[kind] : modes.SymbolKind.Property;
	}

	export function to(kind: modes.SymbolKind): vscode.SymbolKind {
		for (const k in _fromMapping) {
			if (_fromMapping[k] === kind) {
				return Number(k);
			}
		}
		return types.SymbolKind.Property;
	}
}

export namespace SymbolTag {

	export function from(kind: types.SymbolTag): modes.SymbolTag {
		switch (kind) {
			case types.SymbolTag.Deprecated: return modes.SymbolTag.Deprecated;
		}
	}

	export function to(kind: modes.SymbolTag): types.SymbolTag {
		switch (kind) {
			case modes.SymbolTag.Deprecated: return types.SymbolTag.Deprecated;
		}
	}
}

export namespace WorkspaceSymbol {
	export function from(info: vscode.SymbolInformation): search.IWorkspaceSymbol {
		return <search.IWorkspaceSymbol>{
			name: info.name,
			kind: SymbolKind.from(info.kind),
			tags: info.tags && info.tags.map(SymbolTag.from),
			containerName: info.containerName,
			location: location.from(info.location)
		};
	}
	export function to(info: search.IWorkspaceSymbol): types.SymbolInformation {
		const result = new types.SymbolInformation(
			info.name,
			SymbolKind.to(info.kind),
			info.containerName,
			location.to(info.location)
		);
		result.tags = info.tags && info.tags.map(SymbolTag.to);
		return result;
	}
}

export namespace DocumentSymbol {
	export function from(info: vscode.DocumentSymbol): modes.DocumentSymbol {
		const result: modes.DocumentSymbol = {
			name: info.name || '!!MISSING: name!!',
			detail: info.detail,
			range: Range.from(info.range),
			selectionRange: Range.from(info.selectionRange),
			kind: SymbolKind.from(info.kind),
			tags: info.tags?.map(SymbolTag.from) ?? []
		};
		if (info.children) {
			result.children = info.children.map(from);
		}
		return result;
	}
	export function to(info: modes.DocumentSymbol): vscode.DocumentSymbol {
		const result = new types.DocumentSymbol(
			info.name,
			info.detail,
			SymbolKind.to(info.kind),
			Range.to(info.range),
			Range.to(info.selectionRange),
		);
		if (isNonEmptyArray(info.tags)) {
			result.tags = info.tags.map(SymbolTag.to);
		}
		if (info.children) {
			result.children = info.children.map(to) as any;
		}
		return result;
	}
}

export namespace CallHierarchyItem {

	export function to(item: extHostProtocol.ICallHierarchyItemDto): types.CallHierarchyItem {
		const result = new types.CallHierarchyItem(
			SymbolKind.to(item.kind),
			item.name,
			item.detail || '',
			URI.revive(item.uri),
			Range.to(item.range),
			Range.to(item.selectionRange)
		);

		result._sessionId = item._sessionId;
		result._itemId = item._itemId;

		return result;
	}
}

export namespace CallHierarchyIncomingCall {

	export function to(item: extHostProtocol.IIncomingCallDto): types.CallHierarchyIncomingCall {
		return new types.CallHierarchyIncomingCall(
			CallHierarchyItem.to(item.from),
			item.fromRanges.map(r => Range.to(r))
		);
	}
}

export namespace CallHierarchyOutgoingCall {

	export function to(item: extHostProtocol.IOutgoingCallDto): types.CallHierarchyOutgoingCall {
		return new types.CallHierarchyOutgoingCall(
			CallHierarchyItem.to(item.to),
			item.fromRanges.map(r => Range.to(r))
		);
	}
}


export namespace location {
	export function from(value: vscode.Location): modes.Location {
		return {
			range: value.range && Range.from(value.range),
			uri: value.uri
		};
	}

	export function to(value: extHostProtocol.ILocationDto): types.Location {
		return new types.Location(URI.revive(value.uri), Range.to(value.range));
	}
}

export namespace DefinitionLink {
	export function from(value: vscode.Location | vscode.DefinitionLink): modes.LocationLink {
		const definitionLink = <vscode.DefinitionLink>value;
		const location = <vscode.Location>value;
		return {
			originSelectionRange: definitionLink.originSelectionRange
				? Range.from(definitionLink.originSelectionRange)
				: undefined,
			uri: definitionLink.targetUri ? definitionLink.targetUri : location.uri,
			range: Range.from(definitionLink.targetRange ? definitionLink.targetRange : location.range),
			targetSelectionRange: definitionLink.targetSelectionRange
				? Range.from(definitionLink.targetSelectionRange)
				: undefined,
		};
	}
	export function to(value: extHostProtocol.IDefinitionLinkDto): vscode.LocationLink {
		return {
			targetUri: URI.revive(value.uri),
			targetRange: Range.to(value.range),
			targetSelectionRange: value.targetSelectionRange
				? Range.to(value.targetSelectionRange)
				: undefined,
			originSelectionRange: value.originSelectionRange
				? Range.to(value.originSelectionRange)
				: undefined
		};
	}
}

export namespace Hover {
	export function from(hover: vscode.Hover): modes.Hover {
		return <modes.Hover>{
			range: Range.from(hover.range),
			contents: MarkdownString.fromMany(hover.contents)
		};
	}

	export function to(info: modes.Hover): types.Hover {
		return new types.Hover(info.contents.map(MarkdownString.to), Range.to(info.range));
	}
}

export namespace EvaluatableExpression {
	export function from(expression: vscode.EvaluatableExpression): modes.EvaluatableExpression {
		return <modes.EvaluatableExpression>{
			range: Range.from(expression.range),
			expression: expression.expression
		};
	}

	export function to(info: modes.EvaluatableExpression): types.EvaluatableExpression {
		return new types.EvaluatableExpression(Range.to(info.range), info.expression);
	}
}

export namespace InlineValue {
	export function from(inlineValue: vscode.InlineValue): modes.InlineValue {
		if (inlineValue instanceof types.InlineValueText) {
			return <modes.InlineValueText>{
				type: 'text',
				range: Range.from(inlineValue.range),
				text: inlineValue.text
			};
		} else if (inlineValue instanceof types.InlineValueVariableLookup) {
			return <modes.InlineValueVariableLookup>{
				type: 'variable',
				range: Range.from(inlineValue.range),
				variableName: inlineValue.variableName,
				caseSensitiveLookup: inlineValue.caseSensitiveLookup
			};
		} else if (inlineValue instanceof types.InlineValueEvaluatableExpression) {
			return <modes.InlineValueExpression>{
				type: 'expression',
				range: Range.from(inlineValue.range),
				expression: inlineValue.expression
			};
		} else {
			throw new Error(`Unknown 'InlineValue' type`);
		}
	}

	export function to(inlineValue: modes.InlineValue): vscode.InlineValue {
		switch (inlineValue.type) {
			case 'text':
				return <vscode.InlineValueText>{
					range: Range.to(inlineValue.range),
					text: inlineValue.text
				};
			case 'variable':
				return <vscode.InlineValueVariableLookup>{
					range: Range.to(inlineValue.range),
					variableName: inlineValue.variableName,
					caseSensitiveLookup: inlineValue.caseSensitiveLookup
				};
			case 'expression':
				return <vscode.InlineValueEvaluatableExpression>{
					range: Range.to(inlineValue.range),
					expression: inlineValue.expression
				};
		}
	}
}

export namespace InlineValueContext {
	export function from(inlineValueContext: vscode.InlineValueContext): extHostProtocol.IInlineValueContextDto {
		return <extHostProtocol.IInlineValueContextDto>{
			frameId: inlineValueContext.frameId,
			stoppedLocation: Range.from(inlineValueContext.stoppedLocation)
		};
	}

	export function to(inlineValueContext: extHostProtocol.IInlineValueContextDto): types.InlineValueContext {
		return new types.InlineValueContext(inlineValueContext.frameId, Range.to(inlineValueContext.stoppedLocation));
	}
}

export namespace DocumentHighlight {
	export function from(documentHighlight: vscode.DocumentHighlight): modes.DocumentHighlight {
		return {
			range: Range.from(documentHighlight.range),
			kind: documentHighlight.kind
		};
	}
	export function to(occurrence: modes.DocumentHighlight): types.DocumentHighlight {
		return new types.DocumentHighlight(Range.to(occurrence.range), occurrence.kind);
	}
}

export namespace CompletionTriggerKind {
	export function to(kind: modes.CompletionTriggerKind) {
		switch (kind) {
			case modes.CompletionTriggerKind.TriggerCharacter:
				return types.CompletionTriggerKind.TriggerCharacter;
			case modes.CompletionTriggerKind.TriggerForIncompleteCompletions:
				return types.CompletionTriggerKind.TriggerForIncompleteCompletions;
			case modes.CompletionTriggerKind.Invoke:
			default:
				return types.CompletionTriggerKind.Invoke;
		}
	}
}

export namespace CompletionContext {
	export function to(context: modes.CompletionContext): types.CompletionContext {
		return {
			triggerKind: CompletionTriggerKind.to(context.triggerKind),
			triggerCharacter: context.triggerCharacter
		};
	}
}

export namespace CompletionItemTag {

	export function from(kind: types.CompletionItemTag): modes.CompletionItemTag {
		switch (kind) {
			case types.CompletionItemTag.Deprecated: return modes.CompletionItemTag.Deprecated;
		}
	}

	export function to(kind: modes.CompletionItemTag): types.CompletionItemTag {
		switch (kind) {
			case modes.CompletionItemTag.Deprecated: return types.CompletionItemTag.Deprecated;
		}
	}
}

export namespace CompletionItemKind {

	const _from = new Map<types.CompletionItemKind, modes.CompletionItemKind>([
		[types.CompletionItemKind.Method, modes.CompletionItemKind.Method],
		[types.CompletionItemKind.Function, modes.CompletionItemKind.Function],
		[types.CompletionItemKind.Constructor, modes.CompletionItemKind.Constructor],
		[types.CompletionItemKind.Field, modes.CompletionItemKind.Field],
		[types.CompletionItemKind.Variable, modes.CompletionItemKind.Variable],
		[types.CompletionItemKind.Class, modes.CompletionItemKind.Class],
		[types.CompletionItemKind.Interface, modes.CompletionItemKind.Interface],
		[types.CompletionItemKind.Struct, modes.CompletionItemKind.Struct],
		[types.CompletionItemKind.Module, modes.CompletionItemKind.Module],
		[types.CompletionItemKind.Property, modes.CompletionItemKind.Property],
		[types.CompletionItemKind.Unit, modes.CompletionItemKind.Unit],
		[types.CompletionItemKind.Value, modes.CompletionItemKind.Value],
		[types.CompletionItemKind.Constant, modes.CompletionItemKind.Constant],
		[types.CompletionItemKind.Enum, modes.CompletionItemKind.Enum],
		[types.CompletionItemKind.EnumMember, modes.CompletionItemKind.EnumMember],
		[types.CompletionItemKind.Keyword, modes.CompletionItemKind.Keyword],
		[types.CompletionItemKind.Snippet, modes.CompletionItemKind.Snippet],
		[types.CompletionItemKind.Text, modes.CompletionItemKind.Text],
		[types.CompletionItemKind.Color, modes.CompletionItemKind.Color],
		[types.CompletionItemKind.File, modes.CompletionItemKind.File],
		[types.CompletionItemKind.Reference, modes.CompletionItemKind.Reference],
		[types.CompletionItemKind.Folder, modes.CompletionItemKind.Folder],
		[types.CompletionItemKind.Event, modes.CompletionItemKind.Event],
		[types.CompletionItemKind.Operator, modes.CompletionItemKind.Operator],
		[types.CompletionItemKind.TypeParameter, modes.CompletionItemKind.TypeParameter],
		[types.CompletionItemKind.Issue, modes.CompletionItemKind.Issue],
		[types.CompletionItemKind.User, modes.CompletionItemKind.User],
	]);

	export function from(kind: types.CompletionItemKind): modes.CompletionItemKind {
		return _from.get(kind) ?? modes.CompletionItemKind.Property;
	}

	const _to = new Map<modes.CompletionItemKind, types.CompletionItemKind>([
		[modes.CompletionItemKind.Method, types.CompletionItemKind.Method],
		[modes.CompletionItemKind.Function, types.CompletionItemKind.Function],
		[modes.CompletionItemKind.Constructor, types.CompletionItemKind.Constructor],
		[modes.CompletionItemKind.Field, types.CompletionItemKind.Field],
		[modes.CompletionItemKind.Variable, types.CompletionItemKind.Variable],
		[modes.CompletionItemKind.Class, types.CompletionItemKind.Class],
		[modes.CompletionItemKind.Interface, types.CompletionItemKind.Interface],
		[modes.CompletionItemKind.Struct, types.CompletionItemKind.Struct],
		[modes.CompletionItemKind.Module, types.CompletionItemKind.Module],
		[modes.CompletionItemKind.Property, types.CompletionItemKind.Property],
		[modes.CompletionItemKind.Unit, types.CompletionItemKind.Unit],
		[modes.CompletionItemKind.Value, types.CompletionItemKind.Value],
		[modes.CompletionItemKind.Constant, types.CompletionItemKind.Constant],
		[modes.CompletionItemKind.Enum, types.CompletionItemKind.Enum],
		[modes.CompletionItemKind.EnumMember, types.CompletionItemKind.EnumMember],
		[modes.CompletionItemKind.Keyword, types.CompletionItemKind.Keyword],
		[modes.CompletionItemKind.Snippet, types.CompletionItemKind.Snippet],
		[modes.CompletionItemKind.Text, types.CompletionItemKind.Text],
		[modes.CompletionItemKind.Color, types.CompletionItemKind.Color],
		[modes.CompletionItemKind.File, types.CompletionItemKind.File],
		[modes.CompletionItemKind.Reference, types.CompletionItemKind.Reference],
		[modes.CompletionItemKind.Folder, types.CompletionItemKind.Folder],
		[modes.CompletionItemKind.Event, types.CompletionItemKind.Event],
		[modes.CompletionItemKind.Operator, types.CompletionItemKind.Operator],
		[modes.CompletionItemKind.TypeParameter, types.CompletionItemKind.TypeParameter],
		[modes.CompletionItemKind.User, types.CompletionItemKind.User],
		[modes.CompletionItemKind.Issue, types.CompletionItemKind.Issue],
	]);

	export function to(kind: modes.CompletionItemKind): types.CompletionItemKind {
		return _to.get(kind) ?? types.CompletionItemKind.Property;
	}
}

export namespace CompletionItem {

	export function to(suggestion: modes.CompletionItem, converter?: CommandsConverter): types.CompletionItem {

		const result = new types.CompletionItem(typeof suggestion.label === 'string' ? suggestion.label : suggestion.label.name);
		if (typeof suggestion.label !== 'string') {
			result.label2 = suggestion.label;
		}

		result.insertText = suggestion.insertText;
		result.kind = CompletionItemKind.to(suggestion.kind);
		result.tags = suggestion.tags?.map(CompletionItemTag.to);
		result.detail = suggestion.detail;
		result.documentation = htmlContent.isMarkdownString(suggestion.documentation) ? MarkdownString.to(suggestion.documentation) : suggestion.documentation;
		result.sortText = suggestion.sortText;
		result.filterText = suggestion.filterText;
		result.preselect = suggestion.preselect;
		result.commitCharacters = suggestion.commitCharacters;

		// range
		if (editorRange.Range.isIRange(suggestion.range)) {
			result.range = Range.to(suggestion.range);
		} else if (typeof suggestion.range === 'object') {
			result.range = { inserting: Range.to(suggestion.range.insert), replacing: Range.to(suggestion.range.replace) };
		}

		result.keepWhitespace = typeof suggestion.insertTextRules === 'undefined' ? false : Boolean(suggestion.insertTextRules & modes.CompletionItemInsertTextRule.KeepWhitespace);
		// 'insertText'-logic
		if (typeof suggestion.insertTextRules !== 'undefined' && suggestion.insertTextRules & modes.CompletionItemInsertTextRule.InsertAsSnippet) {
			result.insertText = new types.SnippetString(suggestion.insertText);
		} else {
			result.insertText = suggestion.insertText;
			result.textEdit = result.range instanceof types.Range ? new types.TextEdit(result.range, result.insertText) : undefined;
		}
		if (suggestion.additionalTextEdits && suggestion.additionalTextEdits.length > 0) {
			result.additionalTextEdits = suggestion.additionalTextEdits.map(e => TextEdit.to(e as modes.TextEdit));
		}
		result.command = converter && suggestion.command ? converter.fromInternal(suggestion.command) : undefined;

		return result;
	}
}

export namespace ParameterInformation {
	export function from(info: types.ParameterInformation): modes.ParameterInformation {
		return {
			label: info.label,
			documentation: info.documentation ? MarkdownString.fromStrict(info.documentation) : undefined
		};
	}
	export function to(info: modes.ParameterInformation): types.ParameterInformation {
		return {
			label: info.label,
			documentation: htmlContent.isMarkdownString(info.documentation) ? MarkdownString.to(info.documentation) : info.documentation
		};
	}
}

export namespace SignatureInformation {

	export function from(info: types.SignatureInformation): modes.SignatureInformation {
		return {
			label: info.label,
			documentation: info.documentation ? MarkdownString.fromStrict(info.documentation) : undefined,
			parameters: Array.isArray(info.parameters) ? info.parameters.map(ParameterInformation.from) : [],
			activeParameter: info.activeParameter,
		};
	}

	export function to(info: modes.SignatureInformation): types.SignatureInformation {
		return {
			label: info.label,
			documentation: htmlContent.isMarkdownString(info.documentation) ? MarkdownString.to(info.documentation) : info.documentation,
			parameters: Array.isArray(info.parameters) ? info.parameters.map(ParameterInformation.to) : [],
			activeParameter: info.activeParameter,
		};
	}
}

export namespace SignatureHelp {

	export function from(help: types.SignatureHelp): modes.SignatureHelp {
		return {
			activeSignature: help.activeSignature,
			activeParameter: help.activeParameter,
			signatures: Array.isArray(help.signatures) ? help.signatures.map(SignatureInformation.from) : [],
		};
	}

	export function to(help: modes.SignatureHelp): types.SignatureHelp {
		return {
			activeSignature: help.activeSignature,
			activeParameter: help.activeParameter,
			signatures: Array.isArray(help.signatures) ? help.signatures.map(SignatureInformation.to) : [],
		};
	}
}

export namespace InlayHint {

	export function from(hint: vscode.InlayHint): modes.InlayHint {
		return {
			text: hint.text,
			position: Position.from(hint.position),
			kind: InlayHintKind.from(hint.kind ?? types.InlayHintKind.Other),
			whitespaceBefore: hint.whitespaceBefore,
			whitespaceAfter: hint.whitespaceAfter
		};
	}

	export function to(hint: modes.InlayHint): vscode.InlayHint {
		const res = new types.InlayHint(
			hint.text,
			Position.to(hint.position),
			InlayHintKind.to(hint.kind)
		);
		res.whitespaceAfter = hint.whitespaceAfter;
		res.whitespaceBefore = hint.whitespaceBefore;
		return res;
	}
}

export namespace InlayHintKind {
	export function from(kind: vscode.InlayHintKind): modes.InlayHintKind {
		return kind;
	}
	export function to(kind: modes.InlayHintKind): vscode.InlayHintKind {
		return kind;
	}
}

export namespace DocumentLink {

	export function from(link: vscode.DocumentLink): modes.ILink {
		return {
			range: Range.from(link.range),
			url: link.target,
			tooltip: link.tooltip
		};
	}

	export function to(link: modes.ILink): vscode.DocumentLink {
		let target: URI | undefined = undefined;
		if (link.url) {
			try {
				target = typeof link.url === 'string' ? URI.parse(link.url, true) : URI.revive(link.url);
			} catch (err) {
				// ignore
			}
		}
		return new types.DocumentLink(Range.to(link.range), target);
	}
}

export namespace ColorPresentation {
	export function to(colorPresentation: modes.IColorPresentation): types.ColorPresentation {
		const cp = new types.ColorPresentation(colorPresentation.label);
		if (colorPresentation.textEdit) {
			cp.textEdit = TextEdit.to(colorPresentation.textEdit);
		}
		if (colorPresentation.additionalTextEdits) {
			cp.additionalTextEdits = colorPresentation.additionalTextEdits.map(value => TextEdit.to(value));
		}
		return cp;
	}

	export function from(colorPresentation: vscode.ColorPresentation): modes.IColorPresentation {
		return {
			label: colorPresentation.label,
			textEdit: colorPresentation.textEdit ? TextEdit.from(colorPresentation.textEdit) : undefined,
			additionalTextEdits: colorPresentation.additionalTextEdits ? colorPresentation.additionalTextEdits.map(value => TextEdit.from(value)) : undefined
		};
	}
}

export namespace Color {
	export function to(c: [number, number, number, number]): types.Color {
		return new types.Color(c[0], c[1], c[2], c[3]);
	}
	export function from(color: types.Color): [number, number, number, number] {
		return [color.red, color.green, color.blue, color.alpha];
	}
}


export namespace SelectionRange {
	export function from(obj: vscode.SelectionRange): modes.SelectionRange {
		return { range: Range.from(obj.range) };
	}

	export function to(obj: modes.SelectionRange): vscode.SelectionRange {
		return new types.SelectionRange(Range.to(obj.range));
	}
}

export namespace TextDocumentSaveReason {

	export function to(reason: SaveReason): vscode.TextDocumentSaveReason {
		switch (reason) {
			case SaveReason.AUTO:
				return types.TextDocumentSaveReason.AfterDelay;
			case SaveReason.EXPLICIT:
				return types.TextDocumentSaveReason.Manual;
			case SaveReason.FOCUS_CHANGE:
			case SaveReason.WINDOW_CHANGE:
				return types.TextDocumentSaveReason.FocusOut;
		}
	}
}

export namespace TextEditorLineNumbersStyle {
	export function from(style: vscode.TextEditorLineNumbersStyle): RenderLineNumbersType {
		switch (style) {
			case types.TextEditorLineNumbersStyle.Off:
				return RenderLineNumbersType.Off;
			case types.TextEditorLineNumbersStyle.Relative:
				return RenderLineNumbersType.Relative;
			case types.TextEditorLineNumbersStyle.On:
			default:
				return RenderLineNumbersType.On;
		}
	}
	export function to(style: RenderLineNumbersType): vscode.TextEditorLineNumbersStyle {
		switch (style) {
			case RenderLineNumbersType.Off:
				return types.TextEditorLineNumbersStyle.Off;
			case RenderLineNumbersType.Relative:
				return types.TextEditorLineNumbersStyle.Relative;
			case RenderLineNumbersType.On:
			default:
				return types.TextEditorLineNumbersStyle.On;
		}
	}
}

export namespace EndOfLine {

	export function from(eol: vscode.EndOfLine): EndOfLineSequence | undefined {
		if (eol === types.EndOfLine.CRLF) {
			return EndOfLineSequence.CRLF;
		} else if (eol === types.EndOfLine.LF) {
			return EndOfLineSequence.LF;
		}
		return undefined;
	}

	export function to(eol: EndOfLineSequence): vscode.EndOfLine | undefined {
		if (eol === EndOfLineSequence.CRLF) {
			return types.EndOfLine.CRLF;
		} else if (eol === EndOfLineSequence.LF) {
			return types.EndOfLine.LF;
		}
		return undefined;
	}
}

export namespace ProgressLocation {
	export function from(loc: vscode.ProgressLocation | { viewId: string }): MainProgressLocation | string {
		if (typeof loc === 'object') {
			return loc.viewId;
		}

		switch (loc) {
			case types.ProgressLocation.SourceControl: return MainProgressLocation.Scm;
			case types.ProgressLocation.Window: return MainProgressLocation.Window;
			case types.ProgressLocation.Notification: return MainProgressLocation.Notification;
		}
		throw new Error(`Unknown 'ProgressLocation'`);
	}
}

export namespace FoldingRange {
	export function from(r: vscode.FoldingRange): modes.FoldingRange {
		const range: modes.FoldingRange = { start: r.start + 1, end: r.end + 1 };
		if (r.kind) {
			range.kind = FoldingRangeKind.from(r.kind);
		}
		return range;
	}
}

export namespace FoldingRangeKind {
	export function from(kind: vscode.FoldingRangeKind | undefined): modes.FoldingRangeKind | undefined {
		if (kind) {
			switch (kind) {
				case types.FoldingRangeKind.Comment:
					return modes.FoldingRangeKind.Comment;
				case types.FoldingRangeKind.Imports:
					return modes.FoldingRangeKind.Imports;
				case types.FoldingRangeKind.Region:
					return modes.FoldingRangeKind.Region;
			}
		}
		return undefined;
	}
}

export interface TextEditorOpenOptions extends vscode.TextDocumentShowOptions {
	background?: boolean;
	override?: boolean;
}

export namespace TextEditorOpenOptions {

	export function from(options?: TextEditorOpenOptions): ITextEditorOptions | undefined {
		if (options) {
			return {
				pinned: typeof options.preview === 'boolean' ? !options.preview : undefined,
				inactive: options.background,
				preserveFocus: options.preserveFocus,
				selection: typeof options.selection === 'object' ? Range.from(options.selection) : undefined,
				override: typeof options.override === 'boolean' ? EditorOverride.DISABLED : undefined
			};
		}

		return undefined;
	}

}

export namespace GlobPattern {

	export function from(pattern: vscode.GlobPattern): string | types.RelativePattern;
	export function from(pattern: undefined): undefined;
	export function from(pattern: null): null;
	export function from(pattern: vscode.GlobPattern | undefined | null): string | types.RelativePattern | undefined | null;
	export function from(pattern: vscode.GlobPattern | undefined | null): string | types.RelativePattern | undefined | null {
		if (pattern instanceof types.RelativePattern) {
			return pattern;
		}

		if (typeof pattern === 'string') {
			return pattern;
		}

		if (isRelativePattern(pattern)) {
			return new types.RelativePattern(pattern.base, pattern.pattern);
		}

		return pattern; // preserve `undefined` and `null`
	}

	function isRelativePattern(obj: any): obj is vscode.RelativePattern {
		const rp = obj as vscode.RelativePattern;
		return rp && typeof rp.base === 'string' && typeof rp.pattern === 'string';
	}
}

export namespace LanguageSelector {

	export function from(selector: undefined): undefined;
	export function from(selector: vscode.DocumentSelector): languageSelector.LanguageSelector;
	export function from(selector: vscode.DocumentSelector | undefined): languageSelector.LanguageSelector | undefined;
	export function from(selector: vscode.DocumentSelector | undefined): languageSelector.LanguageSelector | undefined {
		if (!selector) {
			return undefined;
		} else if (Array.isArray(selector)) {
			return <languageSelector.LanguageSelector>selector.map(from);
		} else if (typeof selector === 'string') {
			return selector;
		} else {
			const filter = selector as vscode.DocumentFilter; // TODO: microsoft/TypeScript#42768
			return <languageSelector.LanguageFilter>{
				language: filter.language,
				scheme: filter.scheme,
				pattern: typeof filter.pattern === 'undefined' ? undefined : GlobPattern.from(filter.pattern),
				exclusive: filter.exclusive
			};
		}
	}
}

export namespace NotebookRange {

	export function from(range: vscode.NotebookRange): ICellRange {
		return { start: range.start, end: range.end };
	}

	export function to(range: ICellRange): types.NotebookRange {
		return new types.NotebookRange(range.start, range.end);
	}
}

export namespace NotebookCellMetadata {

	export function to(data: notebooks.NotebookCellMetadata): types.NotebookCellMetadata {
		return new types.NotebookCellMetadata().with({
			...data,
			...{
				executionOrder: null,
				lastRunSuccess: null,
				runState: null,
				runStartTime: null,
				runStartTimeAdjustment: null,
				runEndTime: null
			}
		});
	}
}

export namespace NotebookDocumentMetadata {

	export function from(data: types.NotebookDocumentMetadata): notebooks.NotebookDocumentMetadata {
		return data;
	}

	export function to(data: notebooks.NotebookDocumentMetadata): types.NotebookDocumentMetadata {
		return new types.NotebookDocumentMetadata().with(data);
	}
}

export namespace NotebookCellPreviousExecutionResult {
	export function to(data: notebooks.NotebookCellMetadata): vscode.NotebookCellExecutionSummary {
		return {
			startTime: data.runStartTime,
			endTime: data.runEndTime,
			executionOrder: data.executionOrder,
			success: data.lastRunSuccess
		};
	}

	export function from(data: vscode.NotebookCellExecutionSummary): Partial<notebooks.NotebookCellMetadata> {
		return {
			lastRunSuccess: data.success,
			runStartTime: data.startTime,
			runEndTime: data.endTime,
			executionOrder: data.executionOrder
		};
	}
}

export namespace NotebookCellKind {
	export function from(data: vscode.NotebookCellKind): notebooks.CellKind {
		switch (data) {
			case types.NotebookCellKind.Markdown:
				return notebooks.CellKind.Markdown;
			case types.NotebookCellKind.Code:
			default:
				return notebooks.CellKind.Code;
		}
	}

	export function to(data: notebooks.CellKind): vscode.NotebookCellKind {
		switch (data) {
			case notebooks.CellKind.Markdown:
				return types.NotebookCellKind.Markdown;
			case notebooks.CellKind.Code:
			default:
				return types.NotebookCellKind.Code;
		}
	}
}

export namespace NotebookCellData {

	export function from(data: vscode.NotebookCellData): notebooks.ICellDto2 {
		return {
			cellKind: NotebookCellKind.from(data.kind),
			language: data.language,
			source: data.source,
			metadata: {
				...data.metadata,
				...NotebookCellPreviousExecutionResult.from(data.latestExecutionSummary ?? {})
			},
			outputs: data.outputs ? data.outputs.map(NotebookCellOutput.from) : []
		};
	}

	export function to(data: notebooks.ICellDto2): vscode.NotebookCellData {
		return new types.NotebookCellData(
			NotebookCellKind.to(data.cellKind),
			data.source,
			data.language,
			data.outputs ? data.outputs.map(NotebookCellOutput.to) : undefined,
			data.metadata ? NotebookCellMetadata.to(data.metadata) : undefined,
		);
	}
}

export namespace NotebookCellOutputItem {
	export function from(item: types.NotebookCellOutputItem): notebooks.IOutputItemDto {
		return {
			mime: item.mime,
			value: item.value,
			metadata: item.metadata
		};
	}

	export function to(item: notebooks.IOutputItemDto): types.NotebookCellOutputItem {
		return new types.NotebookCellOutputItem(item.mime, item.value, item.metadata);
	}
}

export namespace NotebookCellOutput {
	export function from(output: types.NotebookCellOutput): notebooks.IOutputDto {
		return {
			outputId: output.id,
			outputs: output.outputs.map(NotebookCellOutputItem.from),
			metadata: output.metadata
		};
	}

	export function to(output: notebooks.IOutputDto): vscode.NotebookCellOutput {
		const items = output.outputs.map(NotebookCellOutputItem.to);
		return new types.NotebookCellOutput(items, output.outputId, output.metadata);
	}
}


export namespace NotebookExclusiveDocumentPattern {
	export function from(pattern: { include: vscode.GlobPattern | undefined, exclude: vscode.GlobPattern | undefined }): { include: string | types.RelativePattern | undefined, exclude: string | types.RelativePattern | undefined };
	export function from(pattern: vscode.GlobPattern): string | types.RelativePattern;
	export function from(pattern: undefined): undefined;
	export function from(pattern: { include: vscode.GlobPattern | undefined | null, exclude: vscode.GlobPattern | undefined } | vscode.GlobPattern | undefined): string | types.RelativePattern | { include: string | types.RelativePattern | undefined, exclude: string | types.RelativePattern | undefined } | undefined;
	export function from(pattern: { include: vscode.GlobPattern | undefined | null, exclude: vscode.GlobPattern | undefined } | vscode.GlobPattern | undefined): string | types.RelativePattern | { include: string | types.RelativePattern | undefined, exclude: string | types.RelativePattern | undefined } | undefined {
		if (pattern === null || pattern === undefined) {
			return undefined;
		}

		if (pattern instanceof types.RelativePattern) {
			return pattern;
		}

		if (typeof pattern === 'string') {
			return pattern;
		}


		if (isRelativePattern(pattern)) {
			return new types.RelativePattern(pattern.base, pattern.pattern);
		}

		if (isExclusivePattern(pattern)) {
			return {
				include: GlobPattern.from(pattern.include) || undefined,
				exclude: GlobPattern.from(pattern.exclude) || undefined
			};
		}

		return undefined; // preserve `undefined`

	}

	export function to(pattern: string | types.RelativePattern | { include: string | types.RelativePattern, exclude: string | types.RelativePattern }): { include: vscode.GlobPattern, exclude: vscode.GlobPattern } | vscode.GlobPattern {
		if (typeof pattern === 'string') {
			return pattern;
		}

		if (isRelativePattern(pattern)) {
			return {
				base: pattern.base,
				pattern: pattern.pattern
			};
		}

		return {
			include: pattern.include,
			exclude: pattern.exclude
		};
	}

	function isExclusivePattern(obj: any): obj is { include: types.RelativePattern | undefined | null, exclude: types.RelativePattern | undefined | null } {
		const ep = obj as { include: vscode.GlobPattern, exclude: vscode.GlobPattern };
		const include = GlobPattern.from(ep.include);
		if (!(include && include instanceof types.RelativePattern || typeof include === 'string')) {
			return false;
		}

		const exclude = GlobPattern.from(ep.exclude);
		if (!(exclude && exclude instanceof types.RelativePattern || typeof exclude === 'string')) {
			return false;
		}

		return true;
	}

	function isRelativePattern(obj: any): obj is vscode.RelativePattern {
		const rp = obj as vscode.RelativePattern;
		return rp && typeof rp.base === 'string' && typeof rp.pattern === 'string';
	}
}

export namespace NotebookDecorationRenderOptions {
	export function from(options: vscode.NotebookDecorationRenderOptions): notebooks.INotebookDecorationRenderOptions {
		return {
			backgroundColor: <string | types.ThemeColor>options.backgroundColor,
			borderColor: <string | types.ThemeColor>options.borderColor,
			top: options.top ? ThemableDecorationAttachmentRenderOptions.from(options.top) : undefined
		};
	}
}

export namespace NotebookStatusBarItem {
	export function from(item: vscode.NotebookCellStatusBarItem, commandsConverter: CommandsConverter, disposables: DisposableStore): notebooks.INotebookCellStatusBarItem {
		const command = typeof item.command === 'string' ? { title: '', command: item.command } : item.command;
		return {
			alignment: item.alignment === types.NotebookCellStatusBarAlignment.Left ? notebooks.CellStatusbarAlignment.Left : notebooks.CellStatusbarAlignment.Right,
			command: commandsConverter.toInternal(command, disposables), // TODO@roblou
			text: item.text,
			tooltip: item.tooltip,
			accessibilityInformation: item.accessibilityInformation,
			priority: item.priority
		};
	}
}

export namespace NotebookDocumentContentOptions {
	export function from(options: vscode.NotebookDocumentContentOptions | undefined): notebooks.TransientOptions {
		return {
			transientOutputs: options?.transientOutputs ?? false,
			transientCellMetadata: {
				...options?.transientCellMetadata,
				executionOrder: true,
				runState: true,
				runStartTime: true,
				runStartTimeAdjustment: true,
				runEndTime: true,
				lastRunSuccess: true
			},
			transientDocumentMetadata: options?.transientDocumentMetadata ?? {}
		};
	}
}

export namespace NotebookKernelPreload {
	export function from(preload: vscode.NotebookKernelPreload): { uri: UriComponents; provides: string[] } {
		return {
			uri: preload.uri,
			// todo@connor4312: the conditional here can be removed after a migration period
			provides: typeof preload.provides === 'string'
				? [preload.provides]
				: preload.provides ?? []
		};
	}
	export function to(preload: { uri: UriComponents; provides: string[] }): vscode.NotebookKernelPreload {
		return new types.NotebookKernelPreload(URI.revive(preload.uri), preload.provides);
	}
}

export namespace TestMessage {
	export function from(message: vscode.TestMessage): ITestMessage {
		return {
			message: MarkdownString.fromStrict(message.message) || '',
			severity: message.severity,
			expectedOutput: message.expectedOutput,
			actualOutput: message.actualOutput,
			location: message.location ? location.from(message.location) as any : undefined,
		};
	}

	export function to(item: ITestMessage): vscode.TestMessage {
		const message = new types.TestMessage(typeof item.message === 'string' ? item.message : MarkdownString.to(item.message));
		message.severity = item.severity;
		message.actualOutput = item.actualOutput;
		message.expectedOutput = item.expectedOutput;
		return message;
	}
}

export namespace TestItem {
	export type Raw<T = unknown> = vscode.TestItem<T>;

	export function from(item: vscode.TestItem<unknown>): ITestItem {
		return {
			extId: item.id,
			label: item.label,
			uri: item.uri,
			range: Range.from(item.range) || null,
			debuggable: item.debuggable ?? false,
			description: item.description || null,
			runnable: item.runnable ?? true,
			error: item.error ? (MarkdownString.fromStrict(item.error) || null) : null,
		};
	}

	export function fromResultSnapshot(item: vscode.TestResultSnapshot): ITestItem {
		return {
			extId: item.id,
			label: item.label,
			uri: item.uri,
			range: Range.from(item.range) || null,
			debuggable: false,
			description: item.description || null,
			error: null,
			runnable: true,
		};
	}

	export function toPlain(item: ITestItem): Omit<vscode.TestItem<never>, 'children' | 'invalidate' | 'discoverChildren'> {
		return {
			id: item.extId,
			label: item.label,
			uri: URI.revive(item.uri),
			range: Range.to(item.range || undefined),
			addChild: () => undefined,
			dispose: () => undefined,
			status: types.TestItemStatus.Pending,
			data: undefined as never,
			debuggable: item.debuggable,
			description: item.description || undefined,
			runnable: item.runnable,
		};
	}

	export function to(item: ITestItem): types.TestItemImpl {
		const testItem = new types.TestItemImpl(item.extId, item.label, URI.revive(item.uri), undefined);
		testItem.range = Range.to(item.range || undefined);
		testItem.debuggable = item.debuggable;
		testItem.description = item.description || undefined;
		testItem.runnable = item.runnable;
		return testItem;
	}
}

export namespace TestResults {
	const convertTestResultItem = (item: SerializedTestResultItem, byInternalId: Map<string, SerializedTestResultItem>): vscode.TestResultSnapshot => ({
		...TestItem.toPlain(item.item),
		taskStates: item.tasks.map(t => ({
			state: t.state,
			duration: t.duration,
			messages: t.messages.map(TestMessage.to),
		})),
		children: item.children
			.map(c => byInternalId.get(c))
			.filter(isDefined)
			.map(c => convertTestResultItem(c, byInternalId)),
	});

	export function to(serialized: ISerializedTestResults): vscode.TestRunResult {
		const roots: SerializedTestResultItem[] = [];
		const byInternalId = new Map<string, SerializedTestResultItem>();
		for (const item of serialized.items) {
			byInternalId.set(item.item.extId, item);
			if (item.direct) {
				roots.push(item);
			}
		}

		return {
			completedAt: serialized.completedAt,
			results: roots.map(r => convertTestResultItem(r, byInternalId)),
		};
	}
}

export namespace CodeActionTriggerKind {

	export function to(value: modes.CodeActionTriggerType): types.CodeActionTriggerKind {
		switch (value) {
			case modes.CodeActionTriggerType.Invoke:
				return types.CodeActionTriggerKind.Invoke;

			case modes.CodeActionTriggerType.Auto:
				return types.CodeActionTriggerKind.Automatic;
		}
	}
}
