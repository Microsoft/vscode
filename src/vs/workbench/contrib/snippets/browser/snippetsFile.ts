/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as jsonParse, getNodeType } from 'vs/base/common/json';
import { forEach } from 'vs/base/common/collections';
import { localize } from 'vs/nls';
import { extname, basename } from 'vs/base/common/path';
import { SnippetParser, Variable, Placeholder, Text } from 'vs/editor/contrib/snippet/snippetParser';
import { KnownSnippetVariableNames } from 'vs/editor/contrib/snippet/snippetVariables';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IdleValue } from 'vs/base/common/async';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';

class SnippetBodyInsights {

	readonly codeSnippet: string;
	readonly isBogous: boolean;
	readonly needsClipboard: boolean;

	constructor(body: string) {

		// init with defaults
		this.isBogous = false;
		this.needsClipboard = false;
		this.codeSnippet = body;

		// check snippet...
		const textmateSnippet = new SnippetParser().parse(body, false);

		let placeholders = new Map<string, number>();
		let placeholderMax = 0;
		for (const placeholder of textmateSnippet.placeholders) {
			placeholderMax = Math.max(placeholderMax, placeholder.index);
		}

		let stack = [...textmateSnippet.children];
		while (stack.length > 0) {
			const marker = stack.shift()!;
			if (marker instanceof Variable) {

				if (marker.children.length === 0 && !KnownSnippetVariableNames[marker.name]) {
					// a 'variable' without a default value and not being one of our supported
					// variables is automatically turned into a placeholder. This is to restore
					// a bug we had before. So `${foo}` becomes `${N:foo}`
					const index = placeholders.has(marker.name) ? placeholders.get(marker.name)! : ++placeholderMax;
					placeholders.set(marker.name, index);

					const synthetic = new Placeholder(index).appendChild(new Text(marker.name));
					textmateSnippet.replace(marker, [synthetic]);
					this.isBogous = true;
				}

				if (marker.name === 'CLIPBOARD') {
					this.needsClipboard = true;
				}

			} else {
				// recurse
				stack.push(...marker.children);
			}
		}

		if (this.isBogous) {
			this.codeSnippet = textmateSnippet.toTextmateString();
		}

	}
}

export class Snippet {

	private readonly _bodyInsights: IdleValue<SnippetBodyInsights>;

	readonly prefixLow: string;

	constructor(
		readonly scopes: string[],
		readonly name: string,
		readonly prefix: string,
		readonly description: string,
		readonly body: string,
		readonly source: string,
		readonly snippetSource: SnippetSource,
	) {
		//
		this.prefixLow = prefix ? prefix.toLowerCase() : prefix;
		this._bodyInsights = new IdleValue(() => new SnippetBodyInsights(this.body));
	}

	get codeSnippet(): string {
		return this._bodyInsights.value.codeSnippet;
	}

	get isBogous(): boolean {
		return this._bodyInsights.value.isBogous;
	}

	get needsClipboard(): boolean {
		return this._bodyInsights.value.needsClipboard;
	}

	static compare(a: Snippet, b: Snippet): number {
		if (a.snippetSource < b.snippetSource) {
			return -1;
		} else if (a.snippetSource > b.snippetSource) {
			return 1;
		} else if (a.name > b.name) {
			return 1;
		} else if (a.name < b.name) {
			return -1;
		} else {
			return 0;
		}
	}
}


interface JsonSerializedSnippet {
	body: string;
	scope: string;
	prefix: string | string[];
	description: string;
}

function isJsonSerializedSnippet(thing: any): thing is JsonSerializedSnippet {
	return Boolean((<JsonSerializedSnippet>thing).body) && Boolean((<JsonSerializedSnippet>thing).prefix);
}

interface JsonSerializedSnippets {
	[name: string]: JsonSerializedSnippet | { [name: string]: JsonSerializedSnippet };
}

export const enum SnippetSource {
	User = 1,
	Workspace = 2,
	Extension = 3,
}

export class SnippetFile {

	readonly data: Snippet[] = [];
	readonly isGlobalSnippets: boolean;
	readonly isUserSnippets: boolean;

	private _loadPromise?: Promise<this>;

	constructor(
		readonly source: SnippetSource,
		readonly location: URI,
		public defaultScopes: string[] | undefined,
		private readonly _extension: IExtensionDescription | undefined,
		private readonly _fileService: IFileService,
		private readonly _extensionResourceLoaderService: IExtensionResourceLoaderService
	) {
		this.isGlobalSnippets = extname(location.path) === '.code-snippets';
		this.isUserSnippets = !this._extension;
	}

	select(selector: string, bucket: Snippet[]): void {
		if (this.isGlobalSnippets || !this.isUserSnippets) {
			this._scopeSelect(selector, bucket);
		} else {
			this._filepathSelect(selector, bucket);
		}
	}

	private _filepathSelect(selector: string, bucket: Snippet[]): void {
		// for `fooLang.json` files all snippets are accepted
		if (selector + '.json' === basename(this.location.path)) {
			bucket.push(...this.data);
		}
	}

	private _scopeSelect(selector: string, bucket: Snippet[]): void {
		// for `my.code-snippets` files we need to look at each snippet
		for (const snippet of this.data) {
			const len = snippet.scopes.length;
			if (len === 0) {
				// always accept
				bucket.push(snippet);

			} else {
				for (let i = 0; i < len; i++) {
					// match
					if (snippet.scopes[i] === selector) {
						bucket.push(snippet);
						break; // match only once!
					}
				}
			}
		}

		let idx = selector.lastIndexOf('.');
		if (idx >= 0) {
			this._scopeSelect(selector.substring(0, idx), bucket);
		}
	}

	private async _load(): Promise<string> {
		if (this._extension) {
			return this._extensionResourceLoaderService.readExtensionResource(this.location);
		} else {
			const content = await this._fileService.readFile(this.location);
			return content.value.toString();
		}
	}

	load(): Promise<this> {
		if (!this._loadPromise) {
			this._loadPromise = Promise.resolve(this._load()).then(content => {
				const data = <JsonSerializedSnippets>jsonParse(content);
				if (getNodeType(data) === 'object') {
					forEach(data, entry => {
						const { key: name, value: scopeOrTemplate } = entry;
						if (isJsonSerializedSnippet(scopeOrTemplate)) {
							this._parseSnippet(name, scopeOrTemplate, this.data);
						} else {
							forEach(scopeOrTemplate, entry => {
								const { key: name, value: template } = entry;
								this._parseSnippet(name, template, this.data);
							});
						}
					});
				}
				return this;
			});
		}
		return this._loadPromise;
	}

	reset(): void {
		this._loadPromise = undefined;
		this.data.length = 0;
	}

	private _parseSnippet(name: string, snippet: JsonSerializedSnippet, bucket: Snippet[]): void {

		let { prefix, body, description } = snippet;

		if (Array.isArray(body)) {
			body = body.join('\n');
		}

		if (Array.isArray(description)) {
			description = description.join('\n');
		}

		if ((typeof prefix !== 'string' && !Array.isArray(prefix)) || typeof body !== 'string') {
			return;
		}

		let scopes: string[];
		if (this.defaultScopes) {
			scopes = this.defaultScopes;
		} else if (typeof snippet.scope === 'string') {
			scopes = snippet.scope.split(',').map(s => s.trim()).filter(s => !isFalsyOrWhitespace(s));
		} else {
			scopes = [];
		}

		let source: string;
		if (this._extension) {
			// extension snippet -> show the name of the extension
			source = this._extension.displayName || this._extension.name;

		} else if (this.source === SnippetSource.Workspace) {
			// workspace -> only *.code-snippets files
			source = localize('source.workspaceSnippetGlobal', "Workspace Snippet");
		} else {
			// user -> global (*.code-snippets) and language snippets
			if (this.isGlobalSnippets) {
				source = localize('source.userSnippetGlobal', "Global User Snippet");
			} else {
				source = localize('source.userSnippet', "User Snippet");
			}
		}

		let prefixes = Array.isArray(prefix) ? prefix : [prefix];
		prefixes.forEach(p => {
			bucket.push(new Snippet(
				scopes,
				name,
				p,
				description,
				body,
				source,
				this.source
			));
		});
	}
}
