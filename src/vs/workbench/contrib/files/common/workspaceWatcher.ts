/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, Disposable, dispose } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IFilesConfiguration, IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { ResourceMap } from 'vs/base/common/map';
import { onUnexpectedError } from 'vs/base/common/errors';
import { INotificationService, Severity, NeverShowAgainScope } from 'vs/platform/notification/common/notification';
import { localize } from 'vs/nls';
import { FileService } from 'vs/platform/files/common/fileService';
import { IOpenerService } from 'vs/platform/opener/common/opener';

export class WorkspaceWatcher extends Disposable {

	private readonly watches = new ResourceMap<IDisposable>();

	constructor(
		@IFileService private readonly fileService: FileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super();

		this.registerListeners();

		this.refresh();
	}

	private registerListeners(): void {
		this._register(this.contextService.onDidChangeWorkspaceFolders(e => this.onDidChangeWorkspaceFolders(e)));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.onDidChangeWorkbenchState()));
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onDidChangeConfiguration(e)));
		this._register(this.fileService.onError(error => this.onError(error)));
	}

	private onDidChangeWorkspaceFolders(e: IWorkspaceFoldersChangeEvent): void {

		// Removed workspace: Unwatch
		for (const removed of e.removed) {
			this.unwatchWorkspace(removed.uri);
		}

		// Added workspace: Watch
		for (const added of e.added) {
			this.watchWorkspace(added.uri);
		}
	}

	private onDidChangeWorkbenchState(): void {
		this.refresh();
	}

	private onDidChangeConfiguration(e: IConfigurationChangeEvent): void {
		if (e.affectsConfiguration('files.watcherExclude')) {
			this.refresh();
		}
	}

	private onError(error: Error): void {
		const msg = error.toString();

		// Forward to unexpected error handler
		onUnexpectedError(msg);

		// Detect if we run < .NET Framework 4.5
		if (msg.indexOf('System.MissingMethodException') >= 0) {
			this.notificationService.prompt(
				Severity.Warning,
				localize('netVersionError', "The Microsoft .NET Framework 4.5 is required. Please follow the link to install it."),
				[{
					label: localize('installNet', "Download .NET Framework 4.5"),
					run: () => this.openerService.open(URI.parse('https://go.microsoft.com/fwlink/?LinkId=786533'))
				}],
				{
					sticky: true,
					neverShowAgain: { id: 'ignoreNetVersionError', isSecondary: true, scope: NeverShowAgainScope.WORKSPACE }
				}
			);
		}

		// Detect if we run into ENOSPC issues
		if (msg.indexOf('ENOSPC') >= 0) {
			this.notificationService.prompt(
				Severity.Warning,
				localize('enospcError', "Unable to watch for file changes in this large workspace folder. Please follow the instructions link to resolve this issue."),
				[{
					label: localize('learnMore', "Instructions"),
					run: () => this.openerService.open(URI.parse('https://go.microsoft.com/fwlink/?linkid=867693'))
				}],
				{
					sticky: true,
					neverShowAgain: { id: 'ignoreEnospcError', isSecondary: true, scope: NeverShowAgainScope.WORKSPACE }
				}
			);
		}
	}

	private watchWorkspace(resource: URI) {

		// Compute the watcher exclude rules from configuration
		const excludes: string[] = [];
		const config = this.configurationService.getValue<IFilesConfiguration>({ resource });
		if (config.files?.watcherExclude) {
			for (const key in config.files.watcherExclude) {
				if (config.files.watcherExclude[key] === true) {
					excludes.push(key);
				}
			}
		}

		// Watch workspace
		const disposable = this.fileService.watch(resource, { recursive: true, excludes });
		this.watches.set(resource, disposable);
	}

	private unwatchWorkspace(resource: URI) {
		if (this.watches.has(resource)) {
			dispose(this.watches.get(resource));
			this.watches.delete(resource);
		}
	}

	private refresh(): void {

		// Unwatch all first
		this.unwatchWorkspaces();

		// Watch each workspace folder
		for (const folder of this.contextService.getWorkspace().folders) {
			this.watchWorkspace(folder.uri);
		}
	}

	private unwatchWorkspaces() {
		this.watches.forEach(disposable => dispose(disposable));
		this.watches.clear();
	}

	override dispose(): void {
		super.dispose();

		this.unwatchWorkspaces();
	}
}
