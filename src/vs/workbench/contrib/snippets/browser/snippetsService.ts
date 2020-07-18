/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { combinedDisposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import * as resources from 'vs/base/common/resources';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { Position } from 'vs/editor/common/core/position';
import { LanguageId } from 'vs/editor/common/modes';
import { IModeService } from 'vs/editor/common/services/modeService';
import { setSnippetSuggestSupport } from 'vs/editor/contrib/suggest/suggest';
import { localize } from 'vs/nls';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { FileChangeType, IFileService } from 'vs/platform/files/common/files';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkspace, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ISnippetsService } from 'vs/workbench/contrib/snippets/browser/snippets.contribution';
import { Snippet, SnippetFile, SnippetSource } from 'vs/workbench/contrib/snippets/browser/snippetsFile';
import { ExtensionsRegistry, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { languagesExtPoint } from 'vs/workbench/services/mode/common/workbenchModeService';
import { SnippetCompletionProvider } from './snippetCompletionProvider';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';

namespace snippetExt {

	export interface ISnippetsExtensionPoint {
		language: string;
		path: string;
	}

	export interface IValidSnippetsExtensionPoint {
		language: string;
		location: URI;
	}

	export function toValidSnippet(extension: IExtensionPointUser<ISnippetsExtensionPoint[]>, snippet: ISnippetsExtensionPoint, modeService: IModeService): IValidSnippetsExtensionPoint | null {

		if (isFalsyOrWhitespace(snippet.path)) {
			extension.collector.error(localize(
				'invalid.path.0',
				"Expected string in `contributes.{0}.path`. Provided value: {1}",
				extension.description.name, String(snippet.path)
			));
			return null;
		}

		if (isFalsyOrWhitespace(snippet.language) && !snippet.path.endsWith('.code-snippets')) {
			extension.collector.error(localize(
				'invalid.language.0',
				"When omitting the language, the value of `contributes.{0}.path` must be a `.code-snippets`-file. Provided value: {1}",
				extension.description.name, String(snippet.path)
			));
			return null;
		}

		if (!isFalsyOrWhitespace(snippet.language) && !modeService.isRegisteredMode(snippet.language)) {
			extension.collector.error(localize(
				'invalid.language',
				"Unknown language in `contributes.{0}.language`. Provided value: {1}",
				extension.description.name, String(snippet.language)
			));
			return null;

		}

		const extensionLocation = extension.description.extensionLocation;
		const snippetLocation = resources.joinPath(extensionLocation, snippet.path);
		if (!resources.isEqualOrParent(snippetLocation, extensionLocation)) {
			extension.collector.error(localize(
				'invalid.path.1',
				"Expected `contributes.{0}.path` ({1}) to be included inside extension's folder ({2}). This might make the extension non-portable.",
				extension.description.name, snippetLocation.path, extensionLocation.path
			));
			return null;
		}

		return {
			language: snippet.language,
			location: snippetLocation
		};
	}

	export const snippetsContribution: IJSONSchema = {
		description: localize('vscode.extension.contributes.snippets', 'Contributes snippets.'),
		type: 'array',
		defaultSnippets: [{ body: [{ language: '', path: '' }] }],
		items: {
			type: 'object',
			defaultSnippets: [{ body: { language: '${1:id}', path: './snippets/${2:id}.json.' } }],
			properties: {
				language: {
					description: localize('vscode.extension.contributes.snippets-language', 'Language identifier for which this snippet is contributed to.'),
					type: 'string'
				},
				path: {
					description: localize('vscode.extension.contributes.snippets-path', 'Path of the snippets file. The path is relative to the extension folder and typically starts with \'./snippets/\'.'),
					type: 'string'
				}
			}
		}
	};

	export const point = ExtensionsRegistry.registerExtensionPoint<snippetExt.ISnippetsExtensionPoint[]>({
		extensionPoint: 'snippets',
		deps: [languagesExtPoint],
		jsonSchema: snippetExt.snippetsContribution
	});
}

function watch(service: IFileService, resource: URI, callback: (type: FileChangeType, resource: URI) => any): IDisposable {
	return combinedDisposable(
		service.watch(resource),
		service.onDidFilesChange(e => {
			for (const change of e.changes) {
				if (resources.isEqualOrParent(change.resource, resource)) {
					callback(change.type, change.resource);
				}
			}
		})
	);
}

class SnippetsService implements ISnippetsService {

	readonly _serviceBrand: undefined;

	private readonly _disposables = new DisposableStore();
	private readonly _pendingWork: Promise<any>[] = [];
	private readonly _files = new Map<string, SnippetFile>();

	constructor(
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IModeService private readonly _modeService: IModeService,
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@IExtensionResourceLoaderService private readonly _extensionResourceLoaderService: IExtensionResourceLoaderService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		this._pendingWork.push(Promise.resolve(lifecycleService.when(LifecyclePhase.Restored).then(() => {
			this._initExtensionSnippets();
			this._initUserSnippets();
			this._initWorkspaceSnippets();
		})));

		setSnippetSuggestSupport(new SnippetCompletionProvider(this._modeService, this));
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private _joinSnippets(): Promise<any> {
		const promises = this._pendingWork.slice(0);
		this._pendingWork.length = 0;
		return Promise.all(promises);
	}

	async getSnippetFiles(): Promise<Iterable<SnippetFile>> {
		await this._joinSnippets();
		return this._files.values();
	}

	getSnippets(languageId: LanguageId): Promise<Snippet[]> {
		return this._joinSnippets().then(() => {
			const result: Snippet[] = [];
			const promises: Promise<any>[] = [];

			const languageIdentifier = this._modeService.getLanguageIdentifier(languageId);
			if (languageIdentifier) {
				const langName = languageIdentifier.language;
				for (const file of this._files.values()) {
					promises.push(file.load()
						.then(file => file.select(langName, result))
						.catch(err => this._logService.error(err, file.location.toString()))
					);
				}
			}
			return Promise.all(promises).then(() => result);
		});
	}

	getSnippetsSync(languageId: LanguageId): Snippet[] {
		const result: Snippet[] = [];
		const languageIdentifier = this._modeService.getLanguageIdentifier(languageId);
		if (languageIdentifier) {
			const langName = languageIdentifier.language;
			for (const file of this._files.values()) {
				// kick off loading (which is a noop in case it's already loaded)
				// and optimistically collect snippets
				file.load().catch(err => { /*ignore*/ });
				file.select(langName, result);
			}
		}
		return result;
	}

	// --- loading, watching

	private _initExtensionSnippets(): void {
		snippetExt.point.setHandler(extensions => {

			for (let [key, value] of this._files) {
				if (value.source === SnippetSource.Extension) {
					this._files.delete(key);
				}
			}

			for (const extension of extensions) {
				for (const contribution of extension.value) {
					const validContribution = snippetExt.toValidSnippet(extension, contribution, this._modeService);
					if (!validContribution) {
						continue;
					}

					const resource = validContribution.location.toString();
					const file = this._files.get(resource);
					if (file) {
						if (file.defaultScopes) {
							file.defaultScopes.push(validContribution.language);
						} else {
							file.defaultScopes = [];
						}
					} else {
						const file = new SnippetFile(SnippetSource.Extension, validContribution.location, validContribution.language ? [validContribution.language] : undefined, extension.description, this._fileService, this._extensionResourceLoaderService);
						this._files.set(file.location.toString(), file);

						if (this._environmentService.isExtensionDevelopment) {
							file.load().then(file => {
								// warn about bad tabstop/variable usage
								if (file.data.some(snippet => snippet.isBogous)) {
									extension.collector.warn(localize(
										'badVariableUse',
										"One or more snippets from the extension '{0}' very likely confuse snippet-variables and snippet-placeholders (see https://code.visualstudio.com/docs/editor/userdefinedsnippets#_snippet-syntax for more details)",
										extension.description.name
									));
								}
							}, err => {
								// generic error
								extension.collector.warn(localize(
									'badFile',
									"The snippet file \"{0}\" could not be read.",
									file.location.toString()
								));
							});
						}

					}
				}
			}
		});
	}

	private _initWorkspaceSnippets(): void {
		// workspace stuff
		let disposables = new DisposableStore();
		let updateWorkspaceSnippets = () => {
			disposables.clear();
			this._pendingWork.push(this._initWorkspaceFolderSnippets(this._contextService.getWorkspace(), disposables));
		};
		this._disposables.add(disposables);
		this._disposables.add(this._contextService.onDidChangeWorkspaceFolders(updateWorkspaceSnippets));
		this._disposables.add(this._contextService.onDidChangeWorkbenchState(updateWorkspaceSnippets));
		updateWorkspaceSnippets();
	}

	private _initWorkspaceFolderSnippets(workspace: IWorkspace, bucket: DisposableStore): Promise<any> {
		let promises = workspace.folders.map(folder => {
			const snippetFolder = folder.toResource('.vscode');
			return this._fileService.exists(snippetFolder).then(value => {
				if (value) {
					this._initFolderSnippets(SnippetSource.Workspace, snippetFolder, bucket);
				} else {
					// watch
					bucket.add(this._fileService.onDidFilesChange(e => {
						if (e.contains(snippetFolder, FileChangeType.ADDED)) {
							this._initFolderSnippets(SnippetSource.Workspace, snippetFolder, bucket);
						}
					}));
				}
			});
		});
		return Promise.all(promises);
	}

	private _initUserSnippets(): Promise<any> {
		const userSnippetsFolder = this._environmentService.snippetsHome;
		return this._fileService.createFolder(userSnippetsFolder).then(() => this._initFolderSnippets(SnippetSource.User, userSnippetsFolder, this._disposables));
	}

	private _initFolderSnippets(source: SnippetSource, folder: URI, bucket: DisposableStore): Promise<any> {
		const disposables = new DisposableStore();
		const addFolderSnippets = (type?: FileChangeType) => {
			disposables.clear();

			if (type === FileChangeType.DELETED) {
				return Promise.resolve();
			}
			return this._fileService.resolve(folder).then(stat => {
				for (const entry of stat.children || []) {
					disposables.add(this._addSnippetFile(entry.resource, source));
				}
			}, err => {
				this._logService.error(`Failed snippets from folder '${folder.toString()}'`, err);
			});
		};

		bucket.add(watch(this._fileService, folder, addFolderSnippets));
		bucket.add(disposables);
		return addFolderSnippets();
	}

	private _addSnippetFile(uri: URI, source: SnippetSource): IDisposable {
		const ext = resources.extname(uri);
		const key = uri.toString();
		if (source === SnippetSource.User && ext === '.json') {
			const langName = resources.basename(uri).replace(/\.json/, '');
			this._files.set(key, new SnippetFile(source, uri, [langName], undefined, this._fileService, this._extensionResourceLoaderService));
		} else if (ext === '.code-snippets') {
			this._files.set(key, new SnippetFile(source, uri, undefined, undefined, this._fileService, this._extensionResourceLoaderService));
		}
		return {
			dispose: () => this._files.delete(key)
		};
	}
}

registerSingleton(ISnippetsService, SnippetsService, true);

export interface ISimpleModel {
	getLineContent(lineNumber: number): string;
}

export function getNonWhitespacePrefix(model: ISimpleModel, position: Position): string {
	/**
	 * Do not analyze more characters
	 */
	const MAX_PREFIX_LENGTH = 100;

	let line = model.getLineContent(position.lineNumber).substr(0, position.column - 1);

	let minChIndex = Math.max(0, line.length - MAX_PREFIX_LENGTH);
	for (let chIndex = line.length - 1; chIndex >= minChIndex; chIndex--) {
		let ch = line.charAt(chIndex);

		if (/\s/.test(ch)) {
			return line.substr(chIndex + 1);
		}
	}

	if (minChIndex === 0) {
		return line;
	}

	return '';
}
