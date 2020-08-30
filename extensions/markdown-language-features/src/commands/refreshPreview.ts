/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command } from '../commandManager';
import { MarkdownPreviewManager } from '../features/previewManager';
import { MarkdownEngine } from '../markdownEngine';

export class RefreshPreviewCommand implements Command {
	public readonly id = 'markdown.preview.refresh';

	public constructor(
		private readonly webviewManager: MarkdownPreviewManager,
		private readonly engine: MarkdownEngine
	) { }

	public execute() {
		this.engine.cleanCache();
		this.webviewManager.refresh();
	}
}
