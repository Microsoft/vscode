/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import { basename, dirname, join } from 'path';
import * as vscode from 'vscode';
import { coalesce, flatten } from '../utils/arrays';

function mapChildren<R>(node: jsonc.Node | undefined, f: (x: jsonc.Node) => R): R[] {
	return node && node.type === 'array' && node.children
		? node.children.map(f)
		: [];
}

class TsconfigLinkProvider implements vscode.DocumentLinkProvider {

	public provideDocumentLinks(
		document: vscode.TextDocument,
		_token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.DocumentLink[]> {
		const root = jsonc.parseTree(document.getText());
		if (!root) {
			return null;
		}

		return coalesce([
			this.getExtendsLink(document, root),
			...this.getFilesLinks(document, root),
			...this.getReferencesLinks(document, root)
		]);
	}

	private getExtendsLink(document: vscode.TextDocument, root: jsonc.Node): vscode.DocumentLink | undefined {
		const extendsNode = jsonc.findNodeAtLocation(root, ['extends']);
		if (!this.isPathValue(extendsNode)) {
			return undefined;
		}

		if (extendsNode.value.startsWith('.')) {
			return new vscode.DocumentLink(
				this.getRange(document, extendsNode),
				vscode.Uri.file(join(dirname(document.uri.fsPath), extendsNode.value + (extendsNode.value.endsWith('.json') ? '' : '.json')))
			);
		}

		const workspaceFolderPath = vscode.workspace.getWorkspaceFolder(document.uri)!.uri.fsPath;
		return new vscode.DocumentLink(
			this.getRange(document, extendsNode),
			vscode.Uri.file(join(workspaceFolderPath, 'node_modules', extendsNode.value + (extendsNode.value.endsWith('.json') ? '' : '.json')))
		);
	}

	private getFilesLinks(document: vscode.TextDocument, root: jsonc.Node) {
		return mapChildren(
			jsonc.findNodeAtLocation(root, ['files']),
			child => this.pathNodeToLink(document, child));
	}

	private getReferencesLinks(document: vscode.TextDocument, root: jsonc.Node) {
		return mapChildren(
			jsonc.findNodeAtLocation(root, ['references']),
			child => {
				const pathNode = jsonc.findNodeAtLocation(child, ['path']);
				if (!this.isPathValue(pathNode)) {
					return undefined;
				}

				return new vscode.DocumentLink(this.getRange(document, pathNode),
					basename(pathNode.value).endsWith('.json')
						? this.getFileTarget(document, pathNode)
						: this.getFolderTarget(document, pathNode));
			});
	}

	private pathNodeToLink(
		document: vscode.TextDocument,
		node: jsonc.Node | undefined
	): vscode.DocumentLink | undefined {
		return this.isPathValue(node)
			? new vscode.DocumentLink(this.getRange(document, node), this.getFileTarget(document, node))
			: undefined;
	}

	private isPathValue(extendsNode: jsonc.Node | undefined): extendsNode is jsonc.Node {
		return extendsNode
			&& extendsNode.type === 'string'
			&& extendsNode.value
			&& !(extendsNode.value as string).includes('*'); // don't treat globs as links.
	}

	private getFileTarget(document: vscode.TextDocument, node: jsonc.Node): vscode.Uri {
		return vscode.Uri.file(join(dirname(document.uri.fsPath), node!.value));
	}

	private getFolderTarget(document: vscode.TextDocument, node: jsonc.Node): vscode.Uri {
		return vscode.Uri.file(join(dirname(document.uri.fsPath), node!.value, 'tsconfig.json'));
	}

	private getRange(document: vscode.TextDocument, node: jsonc.Node) {
		const offset = node!.offset;
		const start = document.positionAt(offset + 1);
		const end = document.positionAt(offset + (node!.length - 1));
		return new vscode.Range(start, end);
	}
}

export function register() {
	const patterns: vscode.GlobPattern[] = [
		'**/[jt]sconfig.json',
		'**/[jt]sconfig.*.json',
	];

	const languages = ['json', 'jsonc'];

	const selector: vscode.DocumentSelector = flatten(
		languages.map(language =>
			patterns.map((pattern): vscode.DocumentFilter => ({ language, pattern }))));

	return vscode.languages.registerDocumentLinkProvider(selector, new TsconfigLinkProvider());
}
