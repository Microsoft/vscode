/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownIt, Token } from 'markdown-it';
import * as path from 'path';
import * as vscode from 'vscode';
import { MarkdownContributionProvider as MarkdownContributionProvider } from './markdownExtensions';
import { Slugifier } from './slugify';
import { SkinnyTextDocument } from './tableOfContentsProvider';
import { hash } from './util/hash';
import { isOfScheme, MarkdownFileExtensions, Schemes } from './util/links';

const UNICODE_NEWLINE_REGEX = /\u2028|\u2029/g;

interface MarkdownItConfig {
	readonly breaks: boolean;
	readonly linkify: boolean;
	readonly typographer: boolean;
}

class TokenCache {
	private cachedDocument?: {
		readonly uri: vscode.Uri;
		readonly version: number;
		readonly config: MarkdownItConfig;
	};
	private tokens?: Token[];

	public tryGetCached(document: SkinnyTextDocument, config: MarkdownItConfig): Token[] | undefined {
		if (this.cachedDocument
			&& this.cachedDocument.uri.toString() === document.uri.toString()
			&& this.cachedDocument.version === document.version
			&& this.cachedDocument.config.breaks === config.breaks
			&& this.cachedDocument.config.linkify === config.linkify
		) {
			return this.tokens;
		}
		return undefined;
	}

	public update(document: SkinnyTextDocument, config: MarkdownItConfig, tokens: Token[]) {
		this.cachedDocument = {
			uri: document.uri,
			version: document.version,
			config,
		};
		this.tokens = tokens;
	}

	public clean(): void {
		this.cachedDocument = undefined;
		this.tokens = undefined;
	}
}

export interface RenderOutput {
	html: string;
	containingImages: { src: string }[];
}

interface RenderEnv {
	containingImages: { src: string }[];
}

export class MarkdownEngine {
	private md?: Promise<MarkdownIt>;

	private currentDocument?: vscode.Uri;
	private _slugCount = new Map<string, number>();
	private _tokenCache = new TokenCache();

	public constructor(
		private readonly contributionProvider: MarkdownContributionProvider,
		private readonly slugifier: Slugifier,
	) {
		contributionProvider.onContributionsChanged(() => {
			// Markdown plugin contributions may have changed
			this.md = undefined;
		});
	}

	private async getEngine(config: MarkdownItConfig): Promise<MarkdownIt> {
		if (!this.md) {
			this.md = import('markdown-it').then(async markdownIt => {
				let md: MarkdownIt = markdownIt(await getMarkdownOptions(() => md));

				for (const plugin of this.contributionProvider.contributions.markdownItPlugins.values()) {
					try {
						md = (await plugin)(md);
					} catch {
						// noop
					}
				}

				const frontMatterPlugin = require('markdown-it-front-matter');
				// Extract rules from front matter plugin and apply at a lower precedence
				let fontMatterRule: any;
				frontMatterPlugin({
					block: {
						ruler: {
							before: (_id: any, _id2: any, rule: any) => { fontMatterRule = rule; }
						}
					}
				}, () => { /* noop */ });

				md.block.ruler.before('fence', 'front_matter', fontMatterRule, {
					alt: ['paragraph', 'reference', 'blockquote', 'list']
				});

				for (const renderName of ['paragraph_open', 'heading_open', 'image', 'code_block', 'fence', 'blockquote_open', 'list_item_open']) {
					this.addLineNumberRenderer(md, renderName);
				}

				this.addImageStabilizer(md);
				this.addFencedRenderer(md);
				this.addLinkNormalizer(md);
				this.addLinkValidator(md);
				this.addNamedHeaders(md);
				this.addLinkRenderer(md);
				return md;
			});
		}

		const md = await this.md!;
		md.set(config);
		return md;
	}

	private tokenizeDocument(
		document: SkinnyTextDocument,
		config: MarkdownItConfig,
		engine: MarkdownIt
	): Token[] {
		const cached = this._tokenCache.tryGetCached(document, config);
		if (cached) {
			return cached;
		}

		this.currentDocument = document.uri;

		const tokens = this.tokenizeString(document.getText(), engine);
		this._tokenCache.update(document, config, tokens);
		return tokens;
	}

	private tokenizeString(text: string, engine: MarkdownIt) {
		this._slugCount = new Map<string, number>();

		return engine.parse(text.replace(UNICODE_NEWLINE_REGEX, ''), {});
	}

	public async render(input: SkinnyTextDocument | string): Promise<RenderOutput> {
		const config = this.getConfig(typeof input === 'string' ? undefined : input.uri);
		const engine = await this.getEngine(config);

		const tokens = typeof input === 'string'
			? this.tokenizeString(input, engine)
			: this.tokenizeDocument(input, config, engine);

		const env: RenderEnv = {
			containingImages: []
		};

		const html = engine.renderer.render(tokens, {
			...(engine as any).options,
			...config
		}, env);

		return {
			html,
			containingImages: env.containingImages
		};
	}

	public async parse(document: SkinnyTextDocument): Promise<Token[]> {
		const config = this.getConfig(document.uri);
		const engine = await this.getEngine(config);
		return this.tokenizeDocument(document, config, engine);
	}

	public cleanCache(): void {
		this._tokenCache.clean();
	}

	private getConfig(resource?: vscode.Uri): MarkdownItConfig {
		const config = vscode.workspace.getConfiguration('markdown', resource);
		return {
			breaks: config.get<boolean>('preview.breaks', false),
			linkify: config.get<boolean>('preview.linkify', true),
			typographer: config.get<boolean>('preview.typographer', false)
		};
	}

	private addLineNumberRenderer(md: any, ruleName: string): void {
		const original = md.renderer.rules[ruleName];
		md.renderer.rules[ruleName] = (tokens: any, idx: number, options: any, env: any, self: any) => {
			const token = tokens[idx];
			if (token.map && token.map.length) {
				token.attrSet('data-line', token.map[0]);
				token.attrJoin('class', 'code-line');
			}

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options, env, self);
			}
		};
	}

	private addImageStabilizer(md: any): void {
		const original = md.renderer.rules.image;
		md.renderer.rules.image = (tokens: any, idx: number, options: any, env: RenderEnv, self: any) => {
			const token = tokens[idx];
			token.attrJoin('class', 'loading');

			const src = token.attrGet('src');
			if (src) {
				env.containingImages?.push({ src });
				const imgHash = hash(src);
				token.attrSet('id', `image-hash-${imgHash}`);
			}

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options, env, self);
			}
		};
	}

	private addFencedRenderer(md: any): void {
		const original = md.renderer.rules['fenced'];
		md.renderer.rules['fenced'] = (tokens: any, idx: number, options: any, env: any, self: any) => {
			const token = tokens[idx];
			if (token.map && token.map.length) {
				token.attrJoin('class', 'hljs');
			}

			return original(tokens, idx, options, env, self);
		};
	}

	private addLinkNormalizer(md: any): void {
		const normalizeLink = md.normalizeLink;
		md.normalizeLink = (link: string) => {
			try {
				// Normalize VS Code schemes to target the current version
				if (isOfScheme(Schemes.vscode, link) || isOfScheme(Schemes['vscode-insiders'], link)) {
					return normalizeLink(vscode.Uri.parse(link).with({ scheme: vscode.env.uriScheme }).toString());
				}

				// Support file:// links
				if (isOfScheme(Schemes.file, link)) {
					// Ensure link is relative by prepending `/` so that it uses the <base> element URI
					// when resolving the absolute URL
					return normalizeLink('/' + link.replace(/^file:/, 'file'));
				}

				// If original link doesn't look like a url with a scheme, assume it must be a link to a file in workspace
				if (!/^[a-z\-]+:/i.test(link)) {
					// Use a fake scheme for parsing
					let uri = vscode.Uri.parse('markdown-link:' + link);

					// Relative paths should be resolved correctly inside the preview but we need to
					// handle absolute paths specially (for images) to resolve them relative to the workspace root
					if (uri.path[0] === '/') {
						const root = vscode.workspace.getWorkspaceFolder(this.currentDocument!);
						if (root) {
							const fileUri = vscode.Uri.joinPath(root.uri, uri.fsPath).with({
								fragment: uri.fragment,
								query: uri.query,
							});

							// Ensure fileUri is relative by prepending `/` so that it uses the <base> element URI
							// when resolving the absolute URL
							uri = vscode.Uri.parse('markdown-link:' + '/' + fileUri.toString(true).replace(/^\S+?:/, fileUri.scheme));
						}
					}

					const extname = path.extname(uri.fsPath);

					if (uri.fragment && (extname === '' || MarkdownFileExtensions.includes(extname))) {
						uri = uri.with({
							fragment: this.slugifier.fromHeading(uri.fragment).value
						});
					}
					return normalizeLink(uri.toString(true).replace(/^markdown-link:/, ''));
				}
			} catch (e) {
				// noop
			}
			return normalizeLink(link);
		};
	}

	private addLinkValidator(md: any): void {
		const validateLink = md.validateLink;
		md.validateLink = (link: string) => {
			return validateLink(link)
				|| isOfScheme(Schemes.vscode, link)
				|| isOfScheme(Schemes['vscode-insiders'], link)
				|| /^data:image\/.*?;/.test(link);
		};
	}

	private addNamedHeaders(md: any): void {
		const original = md.renderer.rules.heading_open;
		md.renderer.rules.heading_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
			const title = tokens[idx + 1].children.reduce((acc: string, t: any) => acc + t.content, '');
			let slug = this.slugifier.fromHeading(title);

			if (this._slugCount.has(slug.value)) {
				const count = this._slugCount.get(slug.value)!;
				this._slugCount.set(slug.value, count + 1);
				slug = this.slugifier.fromHeading(slug.value + '-' + (count + 1));
			} else {
				this._slugCount.set(slug.value, 0);
			}

			tokens[idx].attrs = tokens[idx].attrs || [];
			tokens[idx].attrs.push(['id', slug.value]);

			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options, env, self);
			}
		};
	}

	private addLinkRenderer(md: any): void {
		const old_render = md.renderer.rules.link_open || ((tokens: any, idx: number, options: any, _env: any, self: any) => {
			return self.renderToken(tokens, idx, options);
		});

		md.renderer.rules.link_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
			const token = tokens[idx];
			const hrefIndex = token.attrIndex('href');
			if (hrefIndex >= 0) {
				const href = token.attrs[hrefIndex][1];
				token.attrPush(['data-href', href]);
			}
			return old_render(tokens, idx, options, env, self);
		};
	}
}

async function getMarkdownOptions(md: () => MarkdownIt) {
	const hljs = await import('highlight.js');
	return {
		html: true,
		highlight: (str: string, lang?: string) => {
			lang = normalizeHighlightLang(lang);
			if (lang && hljs.getLanguage(lang)) {
				try {
					return `<div>${hljs.highlight(lang, str, true).value}</div>`;
				}
				catch (error) { }
			}
			return `<code><div>${md().utils.escapeHtml(str)}</div></code>`;
		}
	};
}

function normalizeHighlightLang(lang: string | undefined) {
	switch (lang && lang.toLowerCase()) {
		case 'tsx':
		case 'typescriptreact':
			// Workaround for highlight not supporting tsx: https://github.com/isagalaev/highlight.js/issues/1155
			return 'jsx';

		case 'json5':
		case 'jsonc':
			return 'json';

		case 'c#':
		case 'csharp':
			return 'cs';

		default:
			return lang;
	}
}
