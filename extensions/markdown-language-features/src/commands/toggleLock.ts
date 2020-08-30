/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command } from '../commandManager';
import { MarkdownPreviewManager } from '../features/previewManager';

export class ToggleLockCommand implements Command {
	public readonly id = 'markdown.preview.toggleLock';

	public constructor(
		private readonly previewManager: MarkdownPreviewManager
	) { }

	public execute() {
		this.previewManager.toggleLock();
	}
}
