/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, SemanticTokenData } from './languageModes';
import * as ts from 'typescript';

export function getSemanticTokenLegend() {
	if (tokenTypes.length !== TokenType._) {
		console.warn('TokenType has added new entries.');
	}
	if (tokenModifiers.length !== TokenModifier._) {
		console.warn('TokenModifier has added new entries.');
	}
	return { types: tokenTypes, modifiers: tokenModifiers };
}

export function getSemanticTokens(jsLanguageService: ts.LanguageService, currentTextDocument: TextDocument, fileName: string): SemanticTokenData[] {
	//https://ts-ast-viewer.com/#code/AQ0g2CmAuwGbALzAJwG4BQZQGNwEMBnQ4AQQEYBmYAb2C22zgEtJwATJVTRxgcwD27AQAp8AGmAAjAJS0A9POB8+7NQ168oscAJz5wANXwAnLug2bsJmAFcTAO2XAA1MHyvgu-UdOeWbOw8ViAAvpagocBAA

	let resultTokens: SemanticTokenData[] = [];
	const collector = (node: ts.Node, typeIdx: number, modifierSet: number) => {
		resultTokens.push({ start: currentTextDocument.positionAt(node.getStart()), length: node.getWidth(), typeIdx, modifierSet });
	};
	collectTokens(jsLanguageService, fileName, { start: 0, length: currentTextDocument.getText().length }, collector);

	return resultTokens;
}

function collectTokens(jsLanguageService: ts.LanguageService, fileName: string, span: ts.TextSpan, collector: (node: ts.Node, tokenType: number, tokenModifier: number) => void) {

	const program = jsLanguageService.getProgram();
	if (program) {
		const typeChecker = program.getTypeChecker();

		function visit(node: ts.Node) {
			if (!node || !ts.textSpanIntersectsWith(span, node.pos, node.getFullWidth())) {
				return;
			}
			if (ts.isIdentifier(node)) {
				let symbol = typeChecker.getSymbolAtLocation(node);
				if (symbol) {
					if (symbol.flags & ts.SymbolFlags.Alias) {
						symbol = typeChecker.getAliasedSymbol(symbol);
					}
					let typeIdx = classifySymbol(symbol);
					if (typeIdx !== undefined) {
						let modifierSet = 0;
						if (node.parent) {
							const parentTypeIdx = tokenFromDeclarationMapping[node.parent.kind];
							if (parentTypeIdx === typeIdx && (<ts.NamedDeclaration>node.parent).name === node) {
								modifierSet = 1 << TokenModifier.declaration;
							}
						}
						const decl = symbol.valueDeclaration;
						const modifiers = decl ? ts.getCombinedModifierFlags(decl) : 0;
						const nodeFlags = decl ? ts.getCombinedNodeFlags(decl) : 0;
						if (modifiers & ts.ModifierFlags.Static) {
							modifierSet |= 1 << TokenModifier.static;
						}
						if (modifiers & ts.ModifierFlags.Async) {
							modifierSet |= 1 << TokenModifier.async;
						}
						if ((modifiers & ts.ModifierFlags.Readonly) || (nodeFlags & ts.NodeFlags.Const) || (symbol.getFlags() & ts.SymbolFlags.EnumMember)) {
							modifierSet |= 1 << TokenModifier.readonly;
						}
						collector(node, typeIdx, modifierSet);
					}
				}
			}

			ts.forEachChild(node, visit);
		}
		const sourceFile = program.getSourceFile(fileName);
		if (sourceFile) {
			visit(sourceFile);
		}
	}
}

function classifySymbol(symbol: ts.Symbol) {
	const flags = symbol.getFlags();
	if (flags & ts.SymbolFlags.Class) {
		return TokenType.class;
	} else if (flags & ts.SymbolFlags.Enum) {
		return TokenType.enum;
	} else if (flags & ts.SymbolFlags.TypeAlias) {
		return TokenType.type;
	} else if (flags & ts.SymbolFlags.Type) {
		if (flags & ts.SymbolFlags.Interface) {
			return TokenType.interface;
		} if (flags & ts.SymbolFlags.TypeParameter) {
			return TokenType.typeParameter;
		}
	}
	const decl = symbol.valueDeclaration || symbol.declarations && symbol.declarations[0];
	return decl && tokenFromDeclarationMapping[decl.kind];
}

export const enum TokenType {
	class, enum, interface, namespace, typeParameter, type, parameter, variable, property, function, method, _
}

export const enum TokenModifier {
	declaration, static, async, readonly, _
}

const tokenTypes: string[] = [];
tokenTypes[TokenType.class] = 'class';
tokenTypes[TokenType.enum] = 'enum';
tokenTypes[TokenType.interface] = 'interface';
tokenTypes[TokenType.namespace] = 'namespace';
tokenTypes[TokenType.typeParameter] = 'typeParameter';
tokenTypes[TokenType.type] = 'type';
tokenTypes[TokenType.parameter] = 'parameter';
tokenTypes[TokenType.variable] = 'variable';
tokenTypes[TokenType.property] = 'property';
tokenTypes[TokenType.function] = 'function';
tokenTypes[TokenType.method] = 'method';

const tokenModifiers: string[] = [];
tokenModifiers[TokenModifier.async] = 'async';
tokenModifiers[TokenModifier.declaration] = 'declaration';
tokenModifiers[TokenModifier.readonly] = 'readonly';
tokenModifiers[TokenModifier.static] = 'static';

const tokenFromDeclarationMapping: { [name: string]: TokenType } = {
	[ts.SyntaxKind.VariableDeclaration]: TokenType.variable,
	[ts.SyntaxKind.Parameter]: TokenType.parameter,
	[ts.SyntaxKind.PropertyDeclaration]: TokenType.property,
	[ts.SyntaxKind.ModuleDeclaration]: TokenType.namespace,
	[ts.SyntaxKind.EnumDeclaration]: TokenType.enum,
	[ts.SyntaxKind.EnumMember]: TokenType.property,
	[ts.SyntaxKind.ClassDeclaration]: TokenType.class,
	[ts.SyntaxKind.MethodDeclaration]: TokenType.method,
	[ts.SyntaxKind.FunctionDeclaration]: TokenType.function,
	[ts.SyntaxKind.MethodSignature]: TokenType.method,
	[ts.SyntaxKind.GetAccessor]: TokenType.property,
	[ts.SyntaxKind.PropertySignature]: TokenType.property,
	[ts.SyntaxKind.InterfaceDeclaration]: TokenType.interface,
	[ts.SyntaxKind.TypeAliasDeclaration]: TokenType.type,
	[ts.SyntaxKind.TypeParameter]: TokenType.typeParameter
};
