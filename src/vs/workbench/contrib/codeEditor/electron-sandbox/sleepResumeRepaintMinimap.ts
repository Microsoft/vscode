/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { Disposable } from 'vs/base/common/lifecycle';

class SleepResumeRepaintMinimap extends Disposable implements IWorkbenchContribution {

	constructor(
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IElectronService electronService: IElectronService
	) {
		super();

		this._register(electronService.onOSResume(() => {
			codeEditorService.listCodeEditors().forEach(editor => editor.render(true));
		}));
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SleepResumeRepaintMinimap, LifecyclePhase.Eventually);
