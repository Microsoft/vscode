/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ts from 'typescript';
import { PackageDocument } from './packageDocumentHelper';
import { ExtensionLinter } from './extensionLinter';

export function activate(context: vscode.ExtensionContext) {
	const registration = vscode.languages.registerDocumentLinkProvider({ language: 'typescript', pattern: '**/vscode.d.ts' }, _linkProvider);
	context.subscriptions.push(registration);

	//package.json suggestions
	context.subscriptions.push(registerPackageDocumentCompletions());

	context.subscriptions.push(new ExtensionLinter());
}

const _linkProvider = new class implements vscode.DocumentLinkProvider {

	private _cachedResult: { key: string; links: vscode.DocumentLink[] } | undefined;
	private _linkPattern = /[^!]\[.*?\]\(#(.*?)\)/g;

	async provideDocumentLinks(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
		const key = `${document.uri.toString()}@${document.version}`;
		if (!this._cachedResult || this._cachedResult.key !== key) {
			const links = await this._computeDocumentLinks(document);
			this._cachedResult = { key, links };
		}
		return this._cachedResult.links;
	}

	private async _computeDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {

		const results: vscode.DocumentLink[] = [];
		const text = document.getText();
		const lookUp = await ast.createNamedNodeLookUp(text);

		this._linkPattern.lastIndex = 0;
		let match: RegExpMatchArray | null = null;
		while ((match = this._linkPattern.exec(text))) {

			const offset = lookUp(match[1]);
			if (offset === -1) {
				console.warn(`Could not find symbol for link ${match[1]}`);
				continue;
			}

			const targetPos = document.positionAt(offset);
			const linkEnd = document.positionAt(this._linkPattern.lastIndex - 1);
			const linkStart = linkEnd.translate({ characterDelta: -(1 + match[1].length) });

			results.push(new vscode.DocumentLink(
				new vscode.Range(linkStart, linkEnd),
				document.uri.with({ fragment: `${1 + targetPos.line}` })));
		}

		return results;
	}
};

namespace ast {

	export interface NamedNodeLookUp {
		(dottedName: string): number;
	}

	export async function createNamedNodeLookUp(str: string): Promise<NamedNodeLookUp> {

		const ts = await import('typescript');

		const sourceFile = ts.createSourceFile('fake.d.ts', str, ts.ScriptTarget.Latest);

		const identifiers: string[] = [];
		const spans: number[] = [];

		ts.forEachChild(sourceFile, function visit(node: ts.Node) {
			const declIdent = (<ts.NamedDeclaration>node).name;
			if (declIdent && declIdent.kind === ts.SyntaxKind.Identifier) {
				identifiers.push((<ts.Identifier>declIdent).text);
				spans.push(node.pos, node.end);
			}
			ts.forEachChild(node, visit);
		});

		return function (dottedName: string): number {
			let start = -1;
			let end = Number.MAX_VALUE;

			for (let name of dottedName.split('.')) {
				let idx: number = -1;
				while ((idx = identifiers.indexOf(name, idx + 1)) >= 0) {
					let myStart = spans[2 * idx];
					let myEnd = spans[2 * idx + 1];
					if (myStart >= start && myEnd <= end) {
						start = myStart;
						end = myEnd;
						break;
					}
				}
				if (idx < 0) {
					return -1;
				}
			}
			return start;
		};
	}
}

function registerPackageDocumentCompletions(): vscode.Disposable {
	return vscode.languages.registerCompletionItemProvider({ language: 'json', pattern: '**/package.json' }, {
		provideCompletionItems(document, position, token) {
			return new PackageDocument(document).provideCompletionItems(position, token);
		}
	});
}
