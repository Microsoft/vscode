/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';

export const SearchExtensions = {
	SearchTokens: 'base.contributions.searchTokens'
};

export interface ISearchTokenRegistry {
	getTokens(): ISearchTokenCommand[];
	registerToken(token: ISearchTokenCommand): void;
	registerTokens(tokens: ISearchTokenCommand[]): void;
	deregisterToken(token: ISearchTokenCommand): void;
	deregisterTokens(tokens: ISearchTokenCommand[]): void;
}

export interface ISearchTokenCommand {
	token: string;
	command: string;
}

Registry.add(SearchExtensions.SearchTokens, new class implements ISearchTokenRegistry {
	private tokens: ISearchTokenCommand[] = [];

	getTokens(): ISearchTokenCommand[] {
		return this.tokens;
	}

	registerToken(token: ISearchTokenCommand): void {
		this.tokens.push(token);
	}

	registerTokens(tokens: ISearchTokenCommand[]): void {
		this.tokens.push(...tokens);
	}

	deregisterToken(token: ISearchTokenCommand): void {
		this.tokens = this.tokens.filter(t => t.token !== token.token);
	}

	deregisterTokens(tokens: ISearchTokenCommand[]): void {
		tokens.forEach(t => this.deregisterToken(t));
	}
});
