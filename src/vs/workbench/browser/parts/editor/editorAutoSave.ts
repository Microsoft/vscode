/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Disposable, DisposableStore, IDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { IFilesConfigurationService, AutoSaveMode, IAutoSaveConfiguration } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { SaveReason, IEditorIdentifier, IEditorInput, GroupIdentifier, ISaveOptions } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { ILogService } from 'vs/platform/log/common/log';

export class EditorAutoSave extends Disposable implements IWorkbenchContribution {

	// Auto save: after delay
	private autoSaveAfterDelay: number | undefined;
	private readonly pendingAutoSavesAfterDelay = new Map<IWorkingCopy, IDisposable>();

	// Auto save: focus change & window change
	private lastActiveEditor: IEditorInput | undefined = undefined;
	private lastActiveGroupId: GroupIdentifier | undefined = undefined;
	private lastActiveEditorControlDisposable = this._register(new DisposableStore());

	constructor(
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IHostService private readonly hostService: IHostService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Figure out initial auto save config
		this.onAutoSaveConfigurationChange(filesConfigurationService.getAutoSaveConfiguration(), false);

		// Fill in initial dirty working copies
		for (const dirtyWorkingCopy of this.workingCopyService.dirtyWorkingCopies) {
			this.onDidRegister(dirtyWorkingCopy);
		}

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.hostService.onDidChangeFocus(focused => this.onWindowFocusChange(focused)));
		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));
		this._register(this.filesConfigurationService.onAutoSaveConfigurationChange(config => this.onAutoSaveConfigurationChange(config, true)));

		// Working Copy events
		this._register(this.workingCopyService.onDidRegister(workingCopy => this.onDidRegister(workingCopy)));
		this._register(this.workingCopyService.onDidUnregister(workingCopy => this.onDidUnregister(workingCopy)));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.onDidChangeDirty(workingCopy)));
		this._register(this.workingCopyService.onDidChangeContent(workingCopy => this.onDidChangeContent(workingCopy)));
	}

	private onWindowFocusChange(focused: boolean): void {
		if (!focused) {
			this.maybeTriggerAutoSave(SaveReason.WINDOW_CHANGE);
		}
	}

	private onDidActiveEditorChange(): void {

		// Treat editor change like a focus change for our last active editor if any
		if (this.lastActiveEditor && typeof this.lastActiveGroupId === 'number') {
			this.maybeTriggerAutoSave(SaveReason.FOCUS_CHANGE, { groupId: this.lastActiveGroupId, editor: this.lastActiveEditor });
		}

		// Remember as last active
		const activeGroup = this.editorGroupService.activeGroup;
		const activeEditor = this.lastActiveEditor = withNullAsUndefined(activeGroup.activeEditor);
		this.lastActiveGroupId = activeGroup.id;

		// Dispose previous active control listeners
		this.lastActiveEditorControlDisposable.clear();

		// Listen to focus changes on control for auto save
		const activeEditorPane = this.editorService.activeEditorPane;
		if (activeEditor && activeEditorPane) {
			this.lastActiveEditorControlDisposable.add(activeEditorPane.onDidBlur(() => {
				this.maybeTriggerAutoSave(SaveReason.FOCUS_CHANGE, { groupId: activeGroup.id, editor: activeEditor });
			}));
		}
	}

	private maybeTriggerAutoSave(reason: SaveReason, editorIdentifier?: IEditorIdentifier): void {
		if (editorIdentifier && (editorIdentifier.editor.isReadonly() || editorIdentifier.editor.isUntitled())) {
			return; // no auto save for readonly or untitled editors
		}

		// Determine if we need to save all. In case of a window focus change we also save if 
		// auto save mode is configured to be ON_FOCUS_CHANGE (editor focus change)
		const mode = this.filesConfigurationService.getAutoSaveMode();
		if (
			(reason === SaveReason.WINDOW_CHANGE && (mode === AutoSaveMode.ON_FOCUS_CHANGE || mode === AutoSaveMode.ON_WINDOW_CHANGE)) ||
			(reason === SaveReason.FOCUS_CHANGE && mode === AutoSaveMode.ON_FOCUS_CHANGE)
		) {
			this.logService.trace(`[editor auto save] triggering auto save with reason ${reason}`);

			if (editorIdentifier) {
				this.editorService.save(editorIdentifier, { reason });
			} else {
				this.saveAllDirty({ reason });
			}
		}
	}

	private onAutoSaveConfigurationChange(config: IAutoSaveConfiguration, fromEvent: boolean): void {

		// Update auto save after delay config
		this.autoSaveAfterDelay = (typeof config.autoSaveDelay === 'number') && config.autoSaveDelay > 0 ? config.autoSaveDelay : undefined;

		// Trigger a save-all when auto save is enabled
		if (fromEvent) {
			let reason: SaveReason | undefined = undefined;
			switch (this.filesConfigurationService.getAutoSaveMode()) {
				case AutoSaveMode.ON_FOCUS_CHANGE:
					reason = SaveReason.FOCUS_CHANGE;
					break;
				case AutoSaveMode.ON_WINDOW_CHANGE:
					reason = SaveReason.WINDOW_CHANGE;
					break;
				case AutoSaveMode.AFTER_SHORT_DELAY:
				case AutoSaveMode.AFTER_LONG_DELAY:
					reason = SaveReason.AUTO;
					break;
			}

			if (reason) {
				this.saveAllDirty({ reason });
			}
		}
	}

	private saveAllDirty(options?: ISaveOptions): void {
		for (const workingCopy of this.workingCopyService.dirtyWorkingCopies) {
			if (!(workingCopy.capabilities & WorkingCopyCapabilities.Untitled)) {
				workingCopy.save(options);
			}
		}
	}

	private onDidRegister(workingCopy: IWorkingCopy): void {
		if (workingCopy.isDirty()) {
			this.scheduleAutoSave(workingCopy);
		}
	}

	private onDidUnregister(workingCopy: IWorkingCopy): void {
		this.discardAutoSave(workingCopy);
	}

	private onDidChangeDirty(workingCopy: IWorkingCopy): void {
		if (workingCopy.isDirty()) {
			this.scheduleAutoSave(workingCopy);
		} else {
			this.discardAutoSave(workingCopy);
		}
	}

	private onDidChangeContent(workingCopy: IWorkingCopy): void {
		if (workingCopy.isDirty()) {
			// this listener will make sure that the auto save is
			// pushed out for as long as the user is still changing
			// the content of the working copy.
			this.scheduleAutoSave(workingCopy);
		}
	}

	private scheduleAutoSave(workingCopy: IWorkingCopy): void {
		if (typeof this.autoSaveAfterDelay !== 'number') {
			return; // auto save after delay must be enabled
		}

		if (workingCopy.capabilities & WorkingCopyCapabilities.Untitled) {
			return; // we never auto save untitled working copies
		}

		// Clear any running auto save operation
		this.discardAutoSave(workingCopy);

		this.logService.trace(`[editor auto save] scheduling auto save after ${this.autoSaveAfterDelay}ms`, workingCopy.resource.toString(true), workingCopy.typeId);

		// Schedule new auto save
		const handle = setTimeout(() => {

			// Clear disposable
			this.pendingAutoSavesAfterDelay.delete(workingCopy);

			// Save if dirty
			if (workingCopy.isDirty()) {
				this.logService.trace(`[editor auto save] running auto save`, workingCopy.resource.toString(true), workingCopy.typeId);

				workingCopy.save({ reason: SaveReason.AUTO });
			}
		}, this.autoSaveAfterDelay);

		// Keep in map for disposal as needed
		this.pendingAutoSavesAfterDelay.set(workingCopy, toDisposable(() => {
			this.logService.trace(`[editor auto save] clearing pending auto save`, workingCopy.resource.toString(true), workingCopy.typeId);

			clearTimeout(handle);
		}));
	}

	private discardAutoSave(workingCopy: IWorkingCopy): void {
		dispose(this.pendingAutoSavesAfterDelay.get(workingCopy));
		this.pendingAutoSavesAfterDelay.delete(workingCopy);
	}
}
