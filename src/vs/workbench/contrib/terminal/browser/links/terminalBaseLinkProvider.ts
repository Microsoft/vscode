/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILinkProvider, ILink } from 'xterm';
import { TerminalLink } from 'vs/workbench/contrib/terminal/browser/links/terminalLink';

export abstract class TerminalBaseLinkProvider implements ILinkProvider {
	private _activeLinks: TerminalLink[] | undefined;

	async provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): Promise<void> {
		this._activeLinks?.forEach(l => l.dispose);
		this._activeLinks = await this._provideLinks(bufferLineNumber);
		callback(this._activeLinks);
	}

	protected abstract _provideLinks(bufferLineNumber: number): Promise<TerminalLink[]> | TerminalLink[];
}
