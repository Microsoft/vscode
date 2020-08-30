/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Helpers for converting FROM vscode types TO ts types
 */

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import * as PConst from '../protocol.const';
import { ITypeScriptServiceClient } from '../typescriptService';

export namespace Range {
	export const fromTextSpan = (span: Proto.TextSpan): vscode.Range =>
		fromLocations(span.start, span.end);

	export const toTextSpan = (range: vscode.Range): Proto.TextSpan => ({
		start: Position.toLocation(range.start),
		end: Position.toLocation(range.end)
	});

	export const fromLocations = (start: Proto.Location, end: Proto.Location): vscode.Range =>
		new vscode.Range(
			Math.max(0, start.line - 1), Math.max(start.offset - 1, 0),
			Math.max(0, end.line - 1), Math.max(0, end.offset - 1));

	export const toFileRangeRequestArgs = (file: string, range: vscode.Range): Proto.FileRangeRequestArgs => ({
		file,
		startLine: range.start.line + 1,
		startOffset: range.start.character + 1,
		endLine: range.end.line + 1,
		endOffset: range.end.character + 1
	});

	export const toFormattingRequestArgs = (file: string, range: vscode.Range): Proto.FormatRequestArgs => ({
		file,
		line: range.start.line + 1,
		offset: range.start.character + 1,
		endLine: range.end.line + 1,
		endOffset: range.end.character + 1
	});
}

export namespace Position {
	export const fromLocation = (tslocation: Proto.Location): vscode.Position =>
		new vscode.Position(tslocation.line - 1, tslocation.offset - 1);

	export const toLocation = (vsPosition: vscode.Position): Proto.Location => ({
		line: vsPosition.line + 1,
		offset: vsPosition.character + 1,
	});

	export const toFileLocationRequestArgs = (file: string, position: vscode.Position): Proto.FileLocationRequestArgs => ({
		file,
		line: position.line + 1,
		offset: position.character + 1,
	});
}

export namespace Location {
	export const fromTextSpan = (resource: vscode.Uri, tsTextSpan: Proto.TextSpan): vscode.Location =>
		new vscode.Location(resource, Range.fromTextSpan(tsTextSpan));
}

export namespace TextEdit {
	export const fromCodeEdit = (edit: Proto.CodeEdit): vscode.TextEdit =>
		new vscode.TextEdit(
			Range.fromTextSpan(edit),
			edit.newText);
}

export namespace WorkspaceEdit {
	export function fromFileCodeEdits(
		client: ITypeScriptServiceClient,
		edits: Iterable<Proto.FileCodeEdits>
	): vscode.WorkspaceEdit {
		return withFileCodeEdits(new vscode.WorkspaceEdit(), client, edits);
	}

	export function withFileCodeEdits(
		workspaceEdit: vscode.WorkspaceEdit,
		client: ITypeScriptServiceClient,
		edits: Iterable<Proto.FileCodeEdits>
	): vscode.WorkspaceEdit {
		for (const edit of edits) {
			const resource = client.toResource(edit.fileName);
			for (const textChange of edit.textChanges) {
				workspaceEdit.replace(resource,
					Range.fromTextSpan(textChange),
					textChange.newText);
			}
		}

		return workspaceEdit;
	}
}

export namespace SymbolKind {
	export function fromProtocolScriptElementKind(kind: Proto.ScriptElementKind) {
		switch (kind) {
			case PConst.Kind.module: return vscode.SymbolKind.Module;
			case PConst.Kind.class: return vscode.SymbolKind.Class;
			case PConst.Kind.enum: return vscode.SymbolKind.Enum;
			case PConst.Kind.enumMember: return vscode.SymbolKind.EnumMember;
			case PConst.Kind.interface: return vscode.SymbolKind.Interface;
			case PConst.Kind.indexSignature: return vscode.SymbolKind.Method;
			case PConst.Kind.callSignature: return vscode.SymbolKind.Method;
			case PConst.Kind.method: return vscode.SymbolKind.Method;
			case PConst.Kind.memberVariable: return vscode.SymbolKind.Property;
			case PConst.Kind.memberGetAccessor: return vscode.SymbolKind.Property;
			case PConst.Kind.memberSetAccessor: return vscode.SymbolKind.Property;
			case PConst.Kind.variable: return vscode.SymbolKind.Variable;
			case PConst.Kind.let: return vscode.SymbolKind.Variable;
			case PConst.Kind.const: return vscode.SymbolKind.Variable;
			case PConst.Kind.localVariable: return vscode.SymbolKind.Variable;
			case PConst.Kind.alias: return vscode.SymbolKind.Variable;
			case PConst.Kind.function: return vscode.SymbolKind.Function;
			case PConst.Kind.localFunction: return vscode.SymbolKind.Function;
			case PConst.Kind.constructSignature: return vscode.SymbolKind.Constructor;
			case PConst.Kind.constructorImplementation: return vscode.SymbolKind.Constructor;
			case PConst.Kind.typeParameter: return vscode.SymbolKind.TypeParameter;
			case PConst.Kind.string: return vscode.SymbolKind.String;
			default: return vscode.SymbolKind.Variable;
		}
	}
}
