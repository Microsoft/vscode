/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { registerDiffEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IDiffEditorContribution } from 'vs/editor/common/editorCommon';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { FloatingClickWidget } from 'vs/workbench/browser/codeeditor';
import { IDiffComputationResult } from 'vs/editor/common/services/editorWorkerService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';

const enum WidgetState {
	Hidden,
	HintWhitespace
}

class DiffEditorHelperContribution extends Disposable implements IDiffEditorContribution {

	public static readonly ID = 'editor.contrib.diffEditorHelper';

	private _helperWidget: FloatingClickWidget | null;
	private _helperWidgetListener: IDisposable | null;
	private _state: WidgetState;

	constructor(
		private readonly _diffEditor: IDiffEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		this._helperWidget = null;
		this._helperWidgetListener = null;
		this._state = WidgetState.Hidden;


		this._register(this._diffEditor.onDidUpdateDiff(() => {
			const diffComputationResult = this._diffEditor.getDiffComputationResult();
			this._setState(this._deduceState(diffComputationResult));

			if (diffComputationResult && diffComputationResult.quitEarly) {
				this._notificationService.prompt(
					Severity.Warning,
					nls.localize('hintTimeout', "The diff algorithm was stopped early (after {0} ms.)", this._diffEditor.maxComputationTime),
					[{
						label: nls.localize('removeTimeout', "Remove Limit"),
						run: () => {
							this._configurationService.updateValue('diffEditor.maxComputationTime', 0);
						}
					}],
					{}
				);
			}
		}));
	}

	private _deduceState(diffComputationResult: IDiffComputationResult | null): WidgetState {
		if (!diffComputationResult) {
			return WidgetState.Hidden;
		}
		if (this._diffEditor.ignoreTrimWhitespace && diffComputationResult.changes.length === 0 && !diffComputationResult.identical) {
			return WidgetState.HintWhitespace;
		}
		return WidgetState.Hidden;
	}

	private _setState(newState: WidgetState) {
		if (this._state === newState) {
			return;
		}

		this._state = newState;

		if (this._helperWidgetListener) {
			this._helperWidgetListener.dispose();
			this._helperWidgetListener = null;
		}
		if (this._helperWidget) {
			this._helperWidget.dispose();
			this._helperWidget = null;
		}

		if (this._state === WidgetState.HintWhitespace) {
			this._helperWidget = this._instantiationService.createInstance(FloatingClickWidget, this._diffEditor.getModifiedEditor(), nls.localize('hintWhitespace', "Show Whitespace Differences"), null);
			this._helperWidgetListener = this._helperWidget.onClick(() => this._onDidClickHelperWidget());
			this._helperWidget.render();
		}
	}

	private _onDidClickHelperWidget(): void {
		if (this._state === WidgetState.HintWhitespace) {
			this._configurationService.updateValue('diffEditor.ignoreTrimWhitespace', false);
		}
	}

	override dispose(): void {
		super.dispose();
	}
}

registerDiffEditorContribution(DiffEditorHelperContribution.ID, DiffEditorHelperContribution);
