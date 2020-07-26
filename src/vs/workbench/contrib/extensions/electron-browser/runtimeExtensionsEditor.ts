/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/runtimeExtensionsEditor';
import * as nls from 'vs/nls';
import * as os from 'os';
import { IProductService } from 'vs/platform/product/common/productService';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionsWorkbenchService, IExtension } from 'vs/workbench/contrib/extensions/common/extensions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionService, IExtensionsStatus, IExtensionHostProfile } from 'vs/workbench/services/extensions/common/extensions';
import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { append, $, addClass, toggleClass, Dimension, clearNode } from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { writeFile } from 'vs/base/node/pfs';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { memoize } from 'vs/base/common/decorators';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { Event } from 'vs/base/common/event';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { RuntimeExtensionsInput } from 'vs/workbench/contrib/extensions/electron-browser/runtimeExtensionsInput';
import { IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { randomPort } from 'vs/base/node/ports';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILabelService } from 'vs/platform/label/common/label';
import { renderCodicons } from 'vs/base/common/codicons';
import { escape } from 'vs/base/common/strings';
import { ExtensionIdentifier, ExtensionType, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';
import { SlowExtensionAction } from 'vs/workbench/contrib/extensions/electron-browser/extensionsSlowActions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { domEvent } from 'vs/base/browser/event';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';

export const IExtensionHostProfileService = createDecorator<IExtensionHostProfileService>('extensionHostProfileService');
export const CONTEXT_PROFILE_SESSION_STATE = new RawContextKey<string>('profileSessionState', 'none');
export const CONTEXT_EXTENSION_HOST_PROFILE_RECORDED = new RawContextKey<boolean>('extensionHostProfileRecorded', false);

export enum ProfileSessionState {
	None = 0,
	Starting = 1,
	Running = 2,
	Stopping = 3
}

export interface IExtensionHostProfileService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<void>;
	readonly onDidChangeLastProfile: Event<void>;

	readonly state: ProfileSessionState;
	readonly lastProfile: IExtensionHostProfile | null;

	startProfiling(): void;
	stopProfiling(): void;

	getUnresponsiveProfile(extensionId: ExtensionIdentifier): IExtensionHostProfile | undefined;
	setUnresponsiveProfile(extensionId: ExtensionIdentifier, profile: IExtensionHostProfile): void;
}

interface IExtensionProfileInformation {
	/**
	 * segment when the extension was running.
	 * 2*i = segment start time
	 * 2*i+1 = segment end time
	 */
	segments: number[];
	/**
	 * total time when the extension was running.
	 * (sum of all segment lengths).
	 */
	totalTime: number;
}

interface IRuntimeExtension {
	originalIndex: number;
	description: IExtensionDescription;
	marketplaceInfo: IExtension;
	status: IExtensionsStatus;
	profileInfo?: IExtensionProfileInformation;
	unresponsiveProfile?: IExtensionHostProfile;
}

export class RuntimeExtensionsEditor extends BaseEditor {

	public static readonly ID: string = 'workbench.editor.runtimeExtensions';

	private _list: WorkbenchList<IRuntimeExtension> | null;
	private _profileInfo: IExtensionHostProfile | null;

	private _elements: IRuntimeExtension[] | null;
	private _extensionsDescriptions: IExtensionDescription[];
	private _updateSoon: RunOnceScheduler;
	private _profileSessionState: IContextKey<string>;
	private _extensionsHostRecorded: IContextKey<boolean>;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionsWorkbenchService private readonly _extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
		@IStorageService storageService: IStorageService,
		@ILabelService private readonly _labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IProductService private readonly _productService: IProductService
	) {
		super(RuntimeExtensionsEditor.ID, telemetryService, themeService, storageService);

		this._list = null;
		this._profileInfo = this._extensionHostProfileService.lastProfile;
		this._register(this._extensionHostProfileService.onDidChangeLastProfile(() => {
			this._profileInfo = this._extensionHostProfileService.lastProfile;
			this._extensionsHostRecorded.set(!!this._profileInfo);
			this._updateExtensions();
		}));
		this._register(this._extensionHostProfileService.onDidChangeState(() => {
			const state = this._extensionHostProfileService.state;
			this._profileSessionState.set(ProfileSessionState[state].toLowerCase());
		}));

		this._elements = null;

		this._extensionsDescriptions = [];
		this._updateExtensions();

		this._profileSessionState = CONTEXT_PROFILE_SESSION_STATE.bindTo(contextKeyService);
		this._extensionsHostRecorded = CONTEXT_EXTENSION_HOST_PROFILE_RECORDED.bindTo(contextKeyService);

		this._updateSoon = this._register(new RunOnceScheduler(() => this._updateExtensions(), 200));

		this._extensionService.getExtensions().then((extensions) => {
			// We only deal with extensions with source code!
			this._extensionsDescriptions = extensions.filter((extension) => {
				return Boolean(extension.main) || Boolean(extension.browser);
			});
			this._updateExtensions();
		});
		this._register(this._extensionService.onDidChangeExtensionsStatus(() => this._updateSoon.schedule()));
	}

	private async _updateExtensions(): Promise<void> {
		this._elements = await this._resolveExtensions();
		if (this._list) {
			this._list.splice(0, this._list.length, this._elements);
		}
	}

	private async _resolveExtensions(): Promise<IRuntimeExtension[]> {
		let marketplaceMap: { [id: string]: IExtension; } = Object.create(null);
		const marketPlaceExtensions = await this._extensionsWorkbenchService.queryLocal();
		for (let extension of marketPlaceExtensions) {
			marketplaceMap[ExtensionIdentifier.toKey(extension.identifier.id)] = extension;
		}

		let statusMap = this._extensionService.getExtensionsStatus();

		// group profile segments by extension
		let segments: { [id: string]: number[]; } = Object.create(null);

		if (this._profileInfo) {
			let currentStartTime = this._profileInfo.startTime;
			for (let i = 0, len = this._profileInfo.deltas.length; i < len; i++) {
				const id = this._profileInfo.ids[i];
				const delta = this._profileInfo.deltas[i];

				let extensionSegments = segments[ExtensionIdentifier.toKey(id)];
				if (!extensionSegments) {
					extensionSegments = [];
					segments[ExtensionIdentifier.toKey(id)] = extensionSegments;
				}

				extensionSegments.push(currentStartTime);
				currentStartTime = currentStartTime + delta;
				extensionSegments.push(currentStartTime);
			}
		}

		let result: IRuntimeExtension[] = [];
		for (let i = 0, len = this._extensionsDescriptions.length; i < len; i++) {
			const extensionDescription = this._extensionsDescriptions[i];

			let profileInfo: IExtensionProfileInformation | null = null;
			if (this._profileInfo) {
				let extensionSegments = segments[ExtensionIdentifier.toKey(extensionDescription.identifier)] || [];
				let extensionTotalTime = 0;
				for (let j = 0, lenJ = extensionSegments.length / 2; j < lenJ; j++) {
					const startTime = extensionSegments[2 * j];
					const endTime = extensionSegments[2 * j + 1];
					extensionTotalTime += (endTime - startTime);
				}
				profileInfo = {
					segments: extensionSegments,
					totalTime: extensionTotalTime
				};
			}

			result[i] = {
				originalIndex: i,
				description: extensionDescription,
				marketplaceInfo: marketplaceMap[ExtensionIdentifier.toKey(extensionDescription.identifier)],
				status: statusMap[extensionDescription.identifier.value],
				profileInfo: profileInfo || undefined,
				unresponsiveProfile: this._extensionHostProfileService.getUnresponsiveProfile(extensionDescription.identifier)
			};
		}

		result = result.filter(element => element.status.activationTimes);

		// bubble up extensions that have caused slowness
		result = result.sort((a, b) => {
			if (a.unresponsiveProfile === this._profileInfo && !b.unresponsiveProfile) {
				return -1;
			} else if (!a.unresponsiveProfile && b.unresponsiveProfile === this._profileInfo) {
				return 1;
			}
			return a.originalIndex - b.originalIndex;
		});

		return result;
	}

	protected createEditor(parent: HTMLElement): void {
		addClass(parent, 'runtime-extensions-editor');

		const TEMPLATE_ID = 'runtimeExtensionElementTemplate';

		const delegate = new class implements IListVirtualDelegate<IRuntimeExtension>{
			getHeight(element: IRuntimeExtension): number {
				return 62;
			}
			getTemplateId(element: IRuntimeExtension): string {
				return TEMPLATE_ID;
			}
		};

		interface IRuntimeExtensionTemplateData {
			root: HTMLElement;
			element: HTMLElement;
			icon: HTMLImageElement;
			name: HTMLElement;
			version: HTMLElement;
			msgContainer: HTMLElement;
			actionbar: ActionBar;
			activationTime: HTMLElement;
			profileTime: HTMLElement;
			disposables: IDisposable[];
			elementDisposables: IDisposable[];
		}

		const renderer: IListRenderer<IRuntimeExtension, IRuntimeExtensionTemplateData> = {
			templateId: TEMPLATE_ID,
			renderTemplate: (root: HTMLElement): IRuntimeExtensionTemplateData => {
				const element = append(root, $('.extension'));
				const iconContainer = append(element, $('.icon-container'));
				const icon = append(iconContainer, $<HTMLImageElement>('img.icon'));

				const desc = append(element, $('div.desc'));
				const headerContainer = append(desc, $('.header-container'));
				const header = append(headerContainer, $('.header'));
				const name = append(header, $('div.name'));
				const version = append(header, $('span.version'));

				const msgContainer = append(desc, $('div.msg'));

				const actionbar = new ActionBar(desc, { animated: false });
				actionbar.onDidRun(({ error }) => error && this._notificationService.error(error));


				const timeContainer = append(element, $('.time'));
				const activationTime = append(timeContainer, $('div.activation-time'));
				const profileTime = append(timeContainer, $('div.profile-time'));

				const disposables = [actionbar];

				return {
					root,
					element,
					icon,
					name,
					version,
					actionbar,
					activationTime,
					profileTime,
					msgContainer,
					disposables,
					elementDisposables: [],
				};
			},

			renderElement: (element: IRuntimeExtension, index: number, data: IRuntimeExtensionTemplateData): void => {

				data.elementDisposables = dispose(data.elementDisposables);

				toggleClass(data.root, 'odd', index % 2 === 1);

				const onError = Event.once(domEvent(data.icon, 'error'));
				onError(() => data.icon.src = element.marketplaceInfo.iconUrlFallback, null, data.elementDisposables);
				data.icon.src = element.marketplaceInfo.iconUrl;

				if (!data.icon.complete) {
					data.icon.style.visibility = 'hidden';
					data.icon.onload = () => data.icon.style.visibility = 'inherit';
				} else {
					data.icon.style.visibility = 'inherit';
				}
				data.name.textContent = element.marketplaceInfo.displayName;
				data.version.textContent = element.description.version;

				const activationTimes = element.status.activationTimes!;
				let syncTime = activationTimes.codeLoadingTime + activationTimes.activateCallTime;
				data.activationTime.textContent = activationTimes.activationReason.startup ? `Startup Activation: ${syncTime}ms` : `Activation: ${syncTime}ms`;

				data.actionbar.clear();
				if (element.unresponsiveProfile) {
					data.actionbar.push(this._instantiationService.createInstance(SlowExtensionAction, element.description, element.unresponsiveProfile), { icon: true, label: true });
				}
				if (isNonEmptyArray(element.status.runtimeErrors)) {
					data.actionbar.push(new ReportExtensionIssueAction(element, this._openerService, this._clipboardService, this._productService), { icon: true, label: true });
				}

				let title: string;
				const activationId = activationTimes.activationReason.extensionId.value;
				const activationEvent = activationTimes.activationReason.activationEvent;
				if (activationEvent === '*') {
					title = nls.localize('starActivation', "Activated by {0} on start-up", activationId);
				} else if (/^workspaceContains:/.test(activationEvent)) {
					let fileNameOrGlob = activationEvent.substr('workspaceContains:'.length);
					if (fileNameOrGlob.indexOf('*') >= 0 || fileNameOrGlob.indexOf('?') >= 0) {
						title = nls.localize({
							key: 'workspaceContainsGlobActivation',
							comment: [
								'{0} will be a glob pattern'
							]
						}, "Activated by {1} because a file matching {1} exists in your workspace", fileNameOrGlob, activationId);
					} else {
						title = nls.localize({
							key: 'workspaceContainsFileActivation',
							comment: [
								'{0} will be a file name'
							]
						}, "Activated by {1} because file {0} exists in your workspace", fileNameOrGlob, activationId);
					}
				} else if (/^workspaceContainsTimeout:/.test(activationEvent)) {
					const glob = activationEvent.substr('workspaceContainsTimeout:'.length);
					title = nls.localize({
						key: 'workspaceContainsTimeout',
						comment: [
							'{0} will be a glob pattern'
						]
					}, "Activated by {1} because searching for {0} took too long", glob, activationId);
				} else if (activationEvent === 'onStartupFinished') {
					title = nls.localize({
						key: 'startupFinishedActivation',
						comment: [
							'This refers to an extension. {0} will be an activation event.'
						]
					}, "Activated by {0} after start-up finished", activationId);
				} else if (/^onLanguage:/.test(activationEvent)) {
					let language = activationEvent.substr('onLanguage:'.length);
					title = nls.localize('languageActivation', "Activated by {1} because you opened a {0} file", language, activationId);
				} else {
					title = nls.localize({
						key: 'workspaceGenericActivation',
						comment: [
							'The {0} placeholder will be an activation event, like e.g. \'language:typescript\', \'debug\', etc.'
						]
					}, "Activated by {1} on {0}", activationEvent, activationId);
				}
				data.activationTime.title = title;

				clearNode(data.msgContainer);

				if (this._extensionHostProfileService.getUnresponsiveProfile(element.description.identifier)) {
					const el = $('span');
					el.innerHTML = renderCodicons(escape(` $(alert) Unresponsive`));
					el.title = nls.localize('unresponsive.title', "Extension has caused the extension host to freeze.");
					data.msgContainer.appendChild(el);
				}

				if (isNonEmptyArray(element.status.runtimeErrors)) {
					const el = $('span');
					el.innerHTML = renderCodicons(escape(`$(bug) ${nls.localize('errors', "{0} uncaught errors", element.status.runtimeErrors.length)}`));
					data.msgContainer.appendChild(el);
				}

				if (element.status.messages && element.status.messages.length > 0) {
					const el = $('span');
					el.innerHTML = renderCodicons(escape(`$(alert) ${element.status.messages[0].message}`));
					data.msgContainer.appendChild(el);
				}

				if (element.description.extensionLocation.scheme !== 'file') {
					const el = $('span');
					el.innerHTML = renderCodicons(escape(`$(remote) ${element.description.extensionLocation.authority}`));
					data.msgContainer.appendChild(el);

					const hostLabel = this._labelService.getHostLabel(REMOTE_HOST_SCHEME, this._environmentService.configuration.remoteAuthority);
					if (hostLabel) {
						el.innerHTML = renderCodicons(escape(`$(remote) ${hostLabel}`));
					}
				}

				if (this._profileInfo && element.profileInfo) {
					data.profileTime.textContent = `Profile: ${(element.profileInfo.totalTime / 1000).toFixed(2)}ms`;
				} else {
					data.profileTime.textContent = '';
				}

			},

			disposeTemplate: (data: IRuntimeExtensionTemplateData): void => {
				data.disposables = dispose(data.disposables);
			}
		};

		this._list = <WorkbenchList<IRuntimeExtension>>this._instantiationService.createInstance(WorkbenchList,
			'RuntimeExtensions',
			parent, delegate, [renderer], {
			multipleSelectionSupport: false,
			setRowLineHeight: false,
			horizontalScrolling: false,
			overrideStyles: {
				listBackground: editorBackground
			},
			accessibilityProvider: new RuntimeExtensionsEditorAccessibilityProvider()
		});

		this._list.splice(0, this._list.length, this._elements || undefined);

		this._list.onContextMenu((e) => {
			if (!e.element) {
				return;
			}

			const actions: IAction[] = [];

			actions.push(new ReportExtensionIssueAction(e.element, this._openerService, this._clipboardService, this._productService));
			actions.push(new Separator());

			actions.push(new Action('runtimeExtensionsEditor.action.disableWorkspace', nls.localize('disable workspace', "Disable (Workspace)"), undefined, true, () => this._extensionsWorkbenchService.setEnablement(e.element!.marketplaceInfo, EnablementState.DisabledWorkspace)));
			actions.push(new Action('runtimeExtensionsEditor.action.disable', nls.localize('disable', "Disable"), undefined, true, () => this._extensionsWorkbenchService.setEnablement(e.element!.marketplaceInfo, EnablementState.DisabledGlobally)));
			actions.push(new Separator());

			const state = this._extensionHostProfileService.state;
			if (state === ProfileSessionState.Running) {
				actions.push(this._instantiationService.createInstance(StopExtensionHostProfileAction, StopExtensionHostProfileAction.ID, StopExtensionHostProfileAction.LABEL));
			} else {
				actions.push(this._instantiationService.createInstance(StartExtensionHostProfileAction, StartExtensionHostProfileAction.ID, StartExtensionHostProfileAction.LABEL));
			}
			actions.push(this.saveExtensionHostProfileAction);

			this._contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions
			});
		});
	}

	@memoize
	private get saveExtensionHostProfileAction(): IAction {
		return this._instantiationService.createInstance(SaveExtensionHostProfileAction, SaveExtensionHostProfileAction.ID, SaveExtensionHostProfileAction.LABEL);
	}

	public layout(dimension: Dimension): void {
		if (this._list) {
			this._list.layout(dimension.height);
		}
	}
}

export class ShowRuntimeExtensionsAction extends Action {
	static readonly ID = 'workbench.action.showRuntimeExtensions';
	static readonly LABEL = nls.localize('showRuntimeExtensions', "Show Running Extensions");

	constructor(
		id: string, label: string,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super(id, label);
	}

	public async run(e?: any): Promise<any> {
		await this._editorService.openEditor(RuntimeExtensionsInput.instance, { revealIfOpened: true });
	}
}

export class ReportExtensionIssueAction extends Action {

	private static readonly _id = 'workbench.extensions.action.reportExtensionIssue';
	private static readonly _label = nls.localize('reportExtensionIssue', "Report Issue");

	private readonly _url: string;

	constructor(
		extension: {
			description: IExtensionDescription;
			marketplaceInfo: IExtension;
			status?: IExtensionsStatus;
			unresponsiveProfile?: IExtensionHostProfile
		},
		@IOpenerService private readonly openerService: IOpenerService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IProductService private readonly productService: IProductService
	) {
		super(ReportExtensionIssueAction._id, ReportExtensionIssueAction._label, 'extension-action report-issue');
		this.enabled = extension.marketplaceInfo
			&& extension.marketplaceInfo.type === ExtensionType.User
			&& !!extension.description.repository && !!extension.description.repository.url;

		this._url = this._generateNewIssueUrl(extension);
	}

	async run(): Promise<void> {
		this.openerService.open(URI.parse(this._url));
	}

	private _generateNewIssueUrl(extension: {
		description: IExtensionDescription;
		marketplaceInfo: IExtension;
		status?: IExtensionsStatus;
		unresponsiveProfile?: IExtensionHostProfile
	}): string {
		let baseUrl = extension.marketplaceInfo && extension.marketplaceInfo.type === ExtensionType.User && extension.description.repository ? extension.description.repository.url : undefined;
		if (!!baseUrl) {
			baseUrl = `${baseUrl.indexOf('.git') !== -1 ? baseUrl.substr(0, baseUrl.length - 4) : baseUrl}/issues/new/`;
		} else {
			baseUrl = this.productService.reportIssueUrl!;
		}

		let reason = 'Bug';
		let title = 'Extension issue';
		let message = ':warning: We have written the needed data into your clipboard. Please paste! :warning:';
		this.clipboardService.writeText('```json \n' + JSON.stringify(extension.status, null, '\t') + '\n```');

		const osVersion = `${os.type()} ${os.arch()} ${os.release()}`;
		const queryStringPrefix = baseUrl.indexOf('?') === -1 ? '?' : '&';
		const body = encodeURIComponent(
			`- Issue Type: \`${reason}\`
- Extension Name: \`${extension.description.name}\`
- Extension Version: \`${extension.description.version}\`
- OS Version: \`${osVersion}\`
- VSCode version: \`${this.productService.version}\`\n\n${message}`
		);

		return `${baseUrl}${queryStringPrefix}body=${body}&title=${encodeURIComponent(title)}`;
	}
}

export class DebugExtensionHostAction extends Action {
	static readonly ID = 'workbench.extensions.action.debugExtensionHost';
	static readonly LABEL = nls.localize('debugExtensionHost', "Start Debugging Extension Host");
	static readonly CSS_CLASS = 'debug-extension-host';

	constructor(
		@IDebugService private readonly _debugService: IDebugService,
		@IElectronService private readonly _electronService: IElectronService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IProductService private readonly productService: IProductService
	) {
		super(DebugExtensionHostAction.ID, DebugExtensionHostAction.LABEL, DebugExtensionHostAction.CSS_CLASS);
	}

	async run(): Promise<any> {

		const inspectPort = await this._extensionService.getInspectPort(false);
		if (!inspectPort) {
			const res = await this._dialogService.confirm({
				type: 'info',
				message: nls.localize('restart1', "Profile Extensions"),
				detail: nls.localize('restart2', "In order to profile extensions a restart is required. Do you want to restart '{0}' now?", this.productService.nameLong),
				primaryButton: nls.localize('restart3', "Restart"),
				secondaryButton: nls.localize('cancel', "Cancel")
			});
			if (res.confirmed) {
				await this._electronService.relaunch({ addArgs: [`--inspect-extensions=${randomPort()}`] });
			}

			return;
		}

		return this._debugService.startDebugging(undefined, {
			type: 'node',
			name: nls.localize('debugExtensionHost.launch.name', "Attach Extension Host"),
			request: 'attach',
			port: inspectPort
		});
	}
}

export class StartExtensionHostProfileAction extends Action {
	static readonly ID = 'workbench.extensions.action.extensionHostProfile';
	static readonly LABEL = nls.localize('extensionHostProfileStart', "Start Extension Host Profile");

	constructor(
		id: string = StartExtensionHostProfileAction.ID, label: string = StartExtensionHostProfileAction.LABEL,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(id, label);
	}

	run(): Promise<any> {
		this._extensionHostProfileService.startProfiling();
		return Promise.resolve();
	}
}

export class StopExtensionHostProfileAction extends Action {
	static readonly ID = 'workbench.extensions.action.stopExtensionHostProfile';
	static readonly LABEL = nls.localize('stopExtensionHostProfileStart', "Stop Extension Host Profile");

	constructor(
		id: string = StartExtensionHostProfileAction.ID, label: string = StartExtensionHostProfileAction.LABEL,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(id, label);
	}

	run(): Promise<any> {
		this._extensionHostProfileService.stopProfiling();
		return Promise.resolve();
	}
}

export class SaveExtensionHostProfileAction extends Action {

	static readonly LABEL = nls.localize('saveExtensionHostProfile', "Save Extension Host Profile");
	static readonly ID = 'workbench.extensions.action.saveExtensionHostProfile';

	constructor(
		id: string = SaveExtensionHostProfileAction.ID, label: string = SaveExtensionHostProfileAction.LABEL,
		@IElectronService private readonly _electronService: IElectronService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(id, label, undefined, false);
		this._extensionHostProfileService.onDidChangeLastProfile(() => {
			this.enabled = (this._extensionHostProfileService.lastProfile !== null);
		});
	}

	run(): Promise<any> {
		return Promise.resolve(this._asyncRun());
	}

	private async _asyncRun(): Promise<any> {
		let picked = await this._electronService.showSaveDialog({
			title: 'Save Extension Host Profile',
			buttonLabel: 'Save',
			defaultPath: `CPU-${new Date().toISOString().replace(/[\-:]/g, '')}.cpuprofile`,
			filters: [{
				name: 'CPU Profiles',
				extensions: ['cpuprofile', 'txt']
			}]
		});

		if (!picked || !picked.filePath || picked.canceled) {
			return;
		}

		const profileInfo = this._extensionHostProfileService.lastProfile;
		let dataToWrite: object = profileInfo ? profileInfo.data : {};

		let savePath = picked.filePath;

		if (this._environmentService.isBuilt) {
			const profiler = await import('v8-inspect-profiler');
			// when running from a not-development-build we remove
			// absolute filenames because we don't want to reveal anything
			// about users. We also append the `.txt` suffix to make it
			// easier to attach these files to GH issues

			let tmp = profiler.rewriteAbsolutePaths({ profile: dataToWrite as any }, 'piiRemoved');
			dataToWrite = tmp.profile;

			savePath = savePath + '.txt';
		}

		return writeFile(savePath, JSON.stringify(profileInfo ? profileInfo.data : {}, null, '\t'));
	}
}

class RuntimeExtensionsEditorAccessibilityProvider implements IListAccessibilityProvider<IRuntimeExtension> {
	getWidgetAriaLabel(): string {
		return nls.localize('runtimeExtensions', "Runtime Extensions");
	}

	getAriaLabel(element: IRuntimeExtension): string | null {
		return element.description.name;
	}
}
