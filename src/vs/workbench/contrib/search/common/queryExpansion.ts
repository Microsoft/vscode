/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import * as strings from 'vs/base/common/strings';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Registry } from 'vs/platform/registry/common/platform';
import { ISearchTokenRegistry, SearchExtensions } from 'vs/workbench/services/search/common/searchTokenRegistry';
import { ISearchConfiguration } from 'vs/workbench/services/search/common/search';

type ExpandableTokens = { [token: string]: string[] };

export class QueryExpansion {
	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService) {
	}

	/**
	 * Takes search pattern segments, i.e. parts from the include pattern, and expands queries like @open into
	 * their searchable segments.
	 */
	expandQuerySegments(segments: string[]): Promise<string[]> {
		if (!segments.some(segment => strings.startsWith(segment, '@'))) {
			return Promise.resolve(segments);
		}

		const expanders = this.createExpanders();
		const expanded = segments
			.map(getTokenAndQuery)
			.filter(tuple => !!tuple && expanders.has(tuple[0]))
			.map(tuple => {
				const [start, query] = <[string, string]>tuple;
				const expander = <IQueryExpansion>expanders.get(start);
				return expander.expand(query).then(expansion => new Expansion(query, expansion));
			});

		const result = segments.slice();

		return Promise.all(expanded)
			.then(expansions => {
				expansions.forEach(e => {
					const queryIndex = segments.indexOf(e.query);
					result.splice(queryIndex, 1, ...<string[]>e.expansion);
				});
			})
			.then(() => {
				if (!!result.length) {
					return result;
				}

				// No expanded result. Original segments only consists of tokens,
				// so we return the original values to avoid an empty
				// include/exclude pattern.
				return segments.slice();
			});
	}

	private createExpanders(): Map<string, IQueryExpansion> {
		const result = new Map<string, IQueryExpansion>();

		const searchTokenRegistry = Registry.as<ISearchTokenRegistry>(SearchExtensions.SearchTokens);
		searchTokenRegistry.getTokens()
			.map(t => {
				const x = new CommandQueryExpansion(t.token, t.command, this.commandService);
				return x;
			})
			.forEach(t => result.set(t.token, t));

		const searchConfig = this.configurationService.getValue<ISearchConfiguration>();
		ConfigQueryExpansion.create(searchConfig, result)
			.forEach(e => result.set(e.token, e));

		return result;
	}
}

class Expansion {
	constructor(
		public readonly query: string,
		public readonly expansion: string[] | undefined) { }
}

interface IQueryExpansion {
	/**
	 * The query that can be expanded.
	 *
	 * Must start with an '@'
	 */
	token: string;

	/**
	 * Expands a search query segment into components, e.g. expands '@git(modified)' into all modified files.
	 */
	expand(segment: string): Promise<string[] | undefined>;
}

class CommandQueryExpansion implements IQueryExpansion {
	constructor(
		private readonly commandToken: string,
		private readonly command: string,
		private readonly commandService: ICommandService) {
	}

	get token(): string {
		return this.commandToken;
	}

	expand(segment: string): Promise<string[] | undefined> {
		if (!strings.startsWith(segment, this.token)) {
			return Promise.resolve(undefined);
		}

		const parameters = splitParametersFromQuery(segment);
		return this.commandService.executeCommand<string[] | undefined>(this.command, ...parameters || []);
	}
}

/**
 * Support for configurable expansion of search tokens via configuration.
 */
class ConfigQueryExpansion implements IQueryExpansion {
	constructor(
		private readonly configToken: string,
		private readonly expansions: string[],
		private readonly coreExpanders: Map<string, IQueryExpansion>) {
	}

	get token(): string {
		return this.configToken;
	}

	expand(segment: string): Promise<string[] | undefined> {
		if (!strings.startsWith(segment, this.token)) {
			return Promise.resolve(undefined);
		}

		const expanded = this.expansions.map(x => {
			const [token, query] = getTokenAndQuery(x) || [undefined, undefined];
			if (!token) {
				return Promise.resolve([x]); // Normal path or pattern
			}

			if (!this.coreExpanders.has(token)) {
				throw new Error('Cannot find token: ' + token);
			}

			return this.coreExpanders.get(token)!.expand(query!);
		});

		return Promise.all(expanded).then(maybeExpansions => {
			const expansions = maybeExpansions.filter(arr => arr !== undefined);
			if (expansions.length < 1) {
				return undefined;
			}

			return arrays.flatten(<string[][]>expansions);
		});
	}

	static create(searchConfig: ISearchConfiguration, coreExpanders: Map<string, IQueryExpansion>): IQueryExpansion[] {
		if (!searchConfig.search.expandableTokens) {
			return [];
		}

		const commandExpanders = new Map<string, IQueryExpansion>();
		Array.from(coreExpanders.keys()).forEach(t => commandExpanders.set(t, coreExpanders.get(t)));
		const tokens = ConfigQueryExpansion.resolveConfigTokens(
			searchConfig.search.expandableTokens,
			Array.from(commandExpanders.keys()));

		return Object.keys(tokens).map(t => new ConfigQueryExpansion(t, tokens[t], commandExpanders));
	}

	/**
	 * Resolves internal references between configured tokens.
	 *
	 * Example:
	 *   {
	 *     '@a': ['foo', 'foobar'],
	 *     '@b': ['bar', @a],
	 *   }
	 * Resolves into:
	 *   {
	 *     '@a': ['foo', 'foobar'],
	 *     '@b': ['bar', 'foo', 'foobar']
	 *   }
	 */
	static resolveConfigTokens(tokens: ExpandableTokens, coreExpanderTokens: string[]): ExpandableTokens {
		const resolved: ExpandableTokens = {};
		Object.keys(tokens).forEach(t => {
			tokens[t].forEach((expansion, i, arr) => {
				const [token, query] = getTokenAndQuery(expansion) || [undefined, undefined];
				if (!token || !query) {
					return;
				}

				if (coreExpanderTokens.indexOf(token) !== -1) {
					return;
				}

				// We (should) have a reference to a previously defined token
				if (!resolved[expansion]) {
					throw new Error('Could not find any reference to token ' + expansion);
				}

				arr.splice(i, 1, ...resolved[expansion]);
			});

			resolved[t] = tokens[t];
		});

		return resolved;
	}
}

/**
 * Turns a segment like '@git(modified)' into ['@git', '@git(modified)']
 */
function getTokenAndQuery(segment: string): [string, string] | undefined {
	if (!strings.startsWith(segment, '@')) {
		return undefined;
	}

	// WIP(discuss): Current format is @token(param), but the general pattern in vscode
	// is @token:param, e.g. @category:themes
	const parameterStart = segment.indexOf('(');
	if (parameterStart === -1) {
		return [segment, segment];
	}

	return [segment.substr(0, parameterStart), segment];
}

function splitParametersFromQuery(expandableQuery: string): string[] {
	const matches = expandableQuery.match(/@\w+\((.*)\)/);
	if (!matches) {
		return [];
	}

	// WIP(discuss): You can give more than one parameter using @token(param1; param2).
	// It would be nicer to use @token(param1, param2), but the comma is used as the
	// normal separator.
	return matches[1].split(';').map(p => p.trim());
}
