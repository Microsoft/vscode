/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IDisposable } from 'vs/base/common/lifecycle';
import { LinkedList } from 'vs/base/common/linkedList';
import { parse } from 'vs/base/common/marshalling';
import { Schemas } from 'vs/base/common/network';
import { normalizePath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IOpener, IOpenerService, IValidator, IExternalUriResolver, OpenOptions, ResolveExternalUriOptions, IResolvedExternalUri, IExternalOpener, matchesScheme } from 'vs/platform/opener/common/opener';
import { EditorOpenContext } from 'vs/platform/editor/common/editor';
import { ResourceMap } from 'vs/base/common/map';


class CommandOpener implements IOpener {

	constructor(@ICommandService private readonly _commandService: ICommandService) { }

	async open(target: URI | string) {
		if (!matchesScheme(target, Schemas.command)) {
			return false;
		}
		// run command or bail out if command isn't known
		if (typeof target === 'string') {
			target = URI.parse(target);
		}
		// execute as command
		let args: any = [];
		try {
			args = parse(decodeURIComponent(target.query));
		} catch {
			// ignore and retry
			try {
				args = parse(target.query);
			} catch {
				// ignore error
			}
		}
		if (!Array.isArray(args)) {
			args = [args];
		}
		await this._commandService.executeCommand(target.path, ...args);
		return true;
	}
}

class EditorOpener implements IOpener {

	constructor(@ICodeEditorService private readonly _editorService: ICodeEditorService) { }

	async open(target: URI | string, options: OpenOptions) {
		if (typeof target === 'string') {
			target = URI.parse(target);
		}
		let selection: { startLineNumber: number; startColumn: number; } | undefined = undefined;
		const match = /^L?(\d+)(?:,(\d+))?/.exec(target.fragment);
		if (match) {
			// support file:///some/file.js#73,84
			// support file:///some/file.js#L73
			selection = {
				startLineNumber: parseInt(match[1]),
				startColumn: match[2] ? parseInt(match[2]) : 1
			};
			// remove fragment
			target = target.with({ fragment: '' });
		}

		if (target.scheme === Schemas.file) {
			target = normalizePath(target); // workaround for non-normalized paths (https://github.com/microsoft/vscode/issues/12954)
		}

		await this._editorService.openCodeEditor(
			{
				resource: target,
				options: {
					selection,
					context: options?.fromUserGesture ? EditorOpenContext.USER : EditorOpenContext.API,
					...options?.editorOptions
				}
			},
			this._editorService.getFocusedCodeEditor(),
			options?.openToSide
		);

		return true;
	}
}

export class OpenerService implements IOpenerService {

	declare readonly _serviceBrand: undefined;

	private readonly _openers = new LinkedList<IOpener>();
	private readonly _validators = new LinkedList<IValidator>();
	private readonly _resolvers = new LinkedList<IExternalUriResolver>();
	private readonly _resolvedUriTargets = new ResourceMap<URI>(uri => uri.with({ path: null, fragment: null, query: null }).toString());

	private _externalOpener: IExternalOpener;

	constructor(
		@ICodeEditorService editorService: ICodeEditorService,
		@ICommandService commandService: ICommandService,
	) {
		// Default external opener is going through window.open()
		this._externalOpener = {
			openExternal: href => {
				// ensure to open HTTP/HTTPS links into new windows
				// to not trigger a navigation. Any other link is
				// safe to be set as HREF to prevent a blank window
				// from opening.
				if (matchesScheme(href, Schemas.http) || matchesScheme(href, Schemas.https)) {
					dom.windowOpenNoOpener(href);
				} else {
					window.location.href = href;
				}
				return Promise.resolve(true);
			}
		};

		// Default opener: maito, http(s), command, and catch-all-editors
		this._openers.push({
			open: async (target: URI | string, options?: OpenOptions) => {
				if (options?.openExternal || matchesScheme(target, Schemas.mailto) || matchesScheme(target, Schemas.http) || matchesScheme(target, Schemas.https)) {
					// open externally
					await this._doOpenExternal(target, options);
					return true;
				}
				return false;
			}
		});
		this._openers.push(new CommandOpener(commandService));
		this._openers.push(new EditorOpener(editorService));
	}

	registerOpener(opener: IOpener): IDisposable {
		const remove = this._openers.unshift(opener);
		return { dispose: remove };
	}

	registerValidator(validator: IValidator): IDisposable {
		const remove = this._validators.push(validator);
		return { dispose: remove };
	}

	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable {
		const remove = this._resolvers.push(resolver);
		return { dispose: remove };
	}

	setExternalOpener(externalOpener: IExternalOpener): void {
		this._externalOpener = externalOpener;
	}

	async open(target: URI | string, options?: OpenOptions): Promise<boolean> {
		// check with contributed validators
		const targetURI = typeof target === 'string' ? URI.parse(target) : target;
		// validate against the original URI that this URI resolves to, if one exists
		const validationTarget = this._resolvedUriTargets.get(targetURI) ?? target;
		for (const validator of this._validators) {
			if (!(await validator.shouldOpen(validationTarget))) {
				return false;
			}
		}

		// check with contributed openers
		for (const opener of this._openers) {
			const handled = await opener.open(target, options);
			if (handled) {
				return true;
			}
		}

		return false;
	}

	async resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri> {
		for (const resolver of this._resolvers) {
			const result = await resolver.resolveExternalUri(resource, options);
			if (result) {
				this._resolvedUriTargets.set(result.resolved, resource);
				return result;
			}
		}

		return { resolved: resource, dispose: () => { } };
	}

	private async _doOpenExternal(resource: URI | string, options: OpenOptions | undefined): Promise<boolean> {

		//todo@jrieken IExternalUriResolver should support `uri: URI | string`
		const uri = typeof resource === 'string' ? URI.parse(resource) : resource;
		const { resolved } = await this.resolveExternalUri(uri, options);

		if (typeof resource === 'string' && uri.toString() === resolved.toString()) {
			// open the url-string AS IS
			return this._externalOpener.openExternal(resource);
		} else {
			// open URI using the toString(noEncode)+encodeURI-trick
			return this._externalOpener.openExternal(encodeURI(resolved.toString(true)));
		}
	}

	dispose() {
		this._validators.clear();
	}
}
