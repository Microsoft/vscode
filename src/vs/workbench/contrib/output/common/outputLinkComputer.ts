/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMirrorModel, IWorkerContext } from 'vs/editor/common/services/editorSimpleWorker';
import { ILink } from 'vs/editor/common/modes';
import { URI } from 'vs/base/common/uri';
import * as extpath from 'vs/base/common/extpath';
import * as resources from 'vs/base/common/resources';
import * as strings from 'vs/base/common/strings';
import { Range } from 'vs/editor/common/core/range';
import { isWindows } from 'vs/base/common/platform';
import { Schemas } from 'vs/base/common/network';
import { find } from 'vs/base/common/arrays';

export interface ICreateData {
	workspaceFolders: string[];
}

export interface IResourceCreator {
	toResource: (folderRelativePath: string) => URI | null;
}

export class OutputLinkComputer {
	private patterns = new Map<URI /* folder uri */, RegExp[]>();

	constructor(private ctx: IWorkerContext, createData: ICreateData) {
		this.computePatterns(createData);
	}

	private computePatterns(createData: ICreateData): void {

		// Produce patterns for each workspace root we are configured with
		// This means that we will be able to detect links for paths that
		// contain any of the workspace roots as segments.
		const workspaceFolders = createData.workspaceFolders
			.sort((resourceStrA, resourceStrB) => resourceStrB.length - resourceStrA.length) // longest paths first (for https://github.com/microsoft/vscode/issues/88121)
			.map(resourceStr => URI.parse(resourceStr));

		for (const workspaceFolder of workspaceFolders) {
			const patterns = OutputLinkComputer.createPatterns(workspaceFolder);
			this.patterns.set(workspaceFolder, patterns);
		}
	}

	private getModel(uri: string): IMirrorModel | undefined {
		const models = this.ctx.getMirrorModels();

		return find(models, model => model.uri.toString() === uri);
	}

	computeLinks(uri: string): ILink[] {
		const model = this.getModel(uri);
		if (!model) {
			return [];
		}

		const links: ILink[] = [];
		const lines = model.getValue().split(/\r\n|\r|\n/);

		// For each workspace root patterns
		for (const [folderUri, folderPatterns] of this.patterns) {
			const resourceCreator: IResourceCreator = {
				toResource: (folderRelativePath: string): URI | null => {
					if (typeof folderRelativePath === 'string') {
						return resources.joinPath(folderUri, folderRelativePath);
					}

					return null;
				}
			};

			for (let i = 0, len = lines.length; i < len; i++) {
				links.push(...OutputLinkComputer.detectLinks(lines[i], i + 1, folderPatterns, resourceCreator));
			}
		}

		return links;
	}

	static createPatterns(workspaceFolder: URI): RegExp[] {
		const patterns: RegExp[] = [];

		const workspaceFolderPath = workspaceFolder.scheme === Schemas.file ? workspaceFolder.fsPath : workspaceFolder.path;
		const workspaceFolderVariants = [workspaceFolderPath];
		if (isWindows && workspaceFolder.scheme === Schemas.file) {
			workspaceFolderVariants.push(extpath.toSlashes(workspaceFolderPath));
		}

		for (const workspaceFolderVariant of workspaceFolderVariants) {
			const validPathCharacterPattern = '[^\\s\\(\\):<>"]';
			const validPathCharacterOrSpacePattern = `(?:${validPathCharacterPattern}| ${validPathCharacterPattern})`;
			const pathPattern = `${validPathCharacterOrSpacePattern}+\\.${validPathCharacterPattern}+`;
			const strictPathPattern = `${validPathCharacterPattern}+`;

			// Example: /workspaces/express/server.js on line 8, column 13
			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern}) on line ((\\d+)(, column (\\d+))?)`, 'gi'));

			// Example: /workspaces/express/server.js:line 8, column 13
			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern}):line ((\\d+)(, column (\\d+))?)`, 'gi'));

			// Example: /workspaces/mankala/Features.ts(45): error
			// Example: /workspaces/mankala/Features.ts (45): error
			// Example: /workspaces/mankala/Features.ts(45,18): error
			// Example: /workspaces/mankala/Features.ts (45,18): error
			// Example: /workspaces/mankala/Features Special.ts (45,18): error
			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${pathPattern})(\\s?\\((\\d+)(,(\\d+))?)\\)`, 'gi'));

			// Example: at /workspaces/mankala/Game.ts
			// Example: at /workspaces/mankala/Game.ts:336
			// Example: at /workspaces/mankala/Game.ts:336:9
			patterns.push(new RegExp(strings.escapeRegExpCharacters(workspaceFolderVariant) + `(${strictPathPattern})(:(\\d+))?(:(\\d+))?`, 'gi'));
		}

		return patterns;
	}

	/**
	 * Detect links. Made static to allow for tests.
	 */
	static detectLinks(line: string, lineIndex: number, patterns: RegExp[], resourceCreator: IResourceCreator): ILink[] {
		const links: ILink[] = [];

		patterns.forEach(pattern => {
			pattern.lastIndex = 0; // the holy grail of software development

			let match: RegExpExecArray | null;
			let offset = 0;
			while ((match = pattern.exec(line)) !== null) {

				// Convert the relative path information to a resource that we can use in links
				const folderRelativePath = strings.rtrim(match[1], '.').replace(/\\/g, '/'); // remove trailing "." that likely indicate end of sentence
				let resourceString: string | undefined;
				try {
					const resource = resourceCreator.toResource(folderRelativePath);
					if (resource) {
						resourceString = resource.toString();
					}
				} catch (error) {
					continue; // we might find an invalid URI and then we dont want to loose all other links
				}

				// Append line/col information to URI if matching
				if (match[3]) {
					const lineNumber = match[3];

					if (match[5]) {
						const columnNumber = match[5];
						resourceString = strings.format('{0}#{1},{2}', resourceString, lineNumber, columnNumber);
					} else {
						resourceString = strings.format('{0}#{1}', resourceString, lineNumber);
					}
				}

				const fullMatch = strings.rtrim(match[0], '.'); // remove trailing "." that likely indicate end of sentence

				const index = line.indexOf(fullMatch, offset);
				offset += index + fullMatch.length;

				const linkRange = {
					startColumn: index + 1,
					startLineNumber: lineIndex,
					endColumn: index + 1 + fullMatch.length,
					endLineNumber: lineIndex
				};

				if (links.some(link => Range.areIntersectingOrTouching(link.range, linkRange))) {
					return; // Do not detect duplicate links
				}

				links.push({
					range: linkRange,
					url: resourceString
				});
			}
		});

		return links;
	}
}

export function create(ctx: IWorkerContext, createData: ICreateData): OutputLinkComputer {
	return new OutputLinkComputer(ctx, createData);
}
