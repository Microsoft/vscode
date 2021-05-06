/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/processExplorer';
import 'vs/base/browser/ui/codicons/codiconStyles'; // make sure codicon css is loaded
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { NativeHostService } from 'vs/platform/native/electron-sandbox/nativeHostService';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { localize } from 'vs/nls';
import { ProcessExplorerStyles, ProcessExplorerData, ProcessExplorerWindowConfiguration } from 'vs/platform/issue/common/issue';
import { applyZoom, zoomIn, zoomOut } from 'vs/platform/windows/electron-sandbox/window';
import { IContextMenuItem } from 'vs/base/parts/contextmenu/common/contextmenu';
import { popup } from 'vs/base/parts/contextmenu/electron-sandbox/contextmenu';
import { ProcessItem } from 'vs/base/common/processes';
import { append, $ } from 'vs/base/browser/dom';
import { isRemoteDiagnosticError, IRemoteDiagnosticError } from 'vs/platform/diagnostics/common/diagnostics';
import { ElectronIPCMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { ByteSize } from 'vs/platform/files/common/files';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IDataSource, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { DataTree } from 'vs/base/browser/ui/tree/dataTree';

const DEBUG_FLAGS_PATTERN = /\s--(inspect|debug)(-brk|port)?=(\d+)?/;
const DEBUG_PORT_PATTERN = /\s--(inspect|debug)-port=(\d+)/;

class ProcessListDelegate implements IListVirtualDelegate<MachineProcessInformation | ProcessItem | IRemoteDiagnosticError> {
	getHeight(element: MachineProcessInformation | ProcessItem | IRemoteDiagnosticError) {
		return 22;
	}

	getTemplateId(element: ProcessInformation | MachineProcessInformation | ProcessItem | IRemoteDiagnosticError) {
		if (isProcessItem(element)) {
			return 'process';
		}

		if (isMachineProcessInformation(element)) {
			return 'machine';
		}

		if (isRemoteDiagnosticError(element)) {
			return 'error';
		}

		if (isProcessInformation(element)) {
			return 'header';
		}

		return '';
	}
}

interface IProcessItemTemplateData extends IProcessRowTemplateData {
	CPU: HTMLElement;
	memory: HTMLElement;
	PID: HTMLElement;
}

interface IProcessRowTemplateData {
	name: HTMLElement;
}

class ProcessTreeDataSource implements IDataSource<ProcessTree, ProcessInformation | MachineProcessInformation | ProcessItem | IRemoteDiagnosticError>  {
	hasChildren(element: ProcessTree | ProcessInformation | MachineProcessInformation | ProcessItem | IRemoteDiagnosticError): boolean {
		if (isRemoteDiagnosticError(element)) {
			return false;
		}

		if (isProcessItem(element)) {
			return !!element.children?.length;
		} else {
			return true;
		}
	}

	getChildren(element: ProcessTree | ProcessInformation | MachineProcessInformation | ProcessItem | IRemoteDiagnosticError) {
		if (isProcessItem(element)) {
			return element.children ? element.children : [];
		}

		if (isRemoteDiagnosticError(element)) {
			return [];
		}

		if (isProcessInformation(element)) {
			// If there are multiple process roots, return these, otherwise go directly to the root process
			if (element.processRoots.length > 1) {
				return element.processRoots;
			} else {
				return [element.processRoots[0].rootProcess];
			}
		}

		if (isMachineProcessInformation(element)) {
			return [element.rootProcess];
		}

		return [element.processes];
	}
}

class ProcessHeaderTreeRenderer implements ITreeRenderer<ProcessInformation, void, IProcessItemTemplateData> {
	templateId: string = 'header';
	renderTemplate(container: HTMLElement): IProcessItemTemplateData {
		const data = Object.create(null);
		const row = append(container, $('.row'));
		data.name = append(row, $('.nameLabel'));
		data.CPU = append(row, $('.cpu'));
		data.memory = append(row, $('.memory'));
		data.PID = append(row, $('.pid'));
		return data;
	}
	renderElement(node: ITreeNode<ProcessInformation, void>, index: number, templateData: IProcessItemTemplateData, height: number | undefined): void {
		templateData.name.textContent = localize('name', "Process Name");
		templateData.CPU.textContent = localize('cpu', "CPU %");
		templateData.PID.textContent = localize('pid', "PID");
		templateData.memory.textContent = localize('memory', "Memory (MB)");

	}
	disposeTemplate(templateData: any): void {
		// Nothing to do
	}
}

class MachineRenderer implements ITreeRenderer<MachineProcessInformation, void, IProcessRowTemplateData> {
	templateId: string = 'machine';
	renderTemplate(container: HTMLElement): IProcessRowTemplateData {
		const data = Object.create(null);
		const row = append(container, $('.row'));
		data.name = append(row, $('.nameLabel'));
		return data;
	}
	renderElement(node: ITreeNode<MachineProcessInformation, void>, index: number, templateData: IProcessRowTemplateData, height: number | undefined): void {
		templateData.name.textContent = node.element.name;
	}
	disposeTemplate(templateData: IProcessRowTemplateData): void {
		// Nothing to do
	}
}

class ErrorRenderer implements ITreeRenderer<IRemoteDiagnosticError, void, IProcessRowTemplateData> {
	templateId: string = 'error';
	renderTemplate(container: HTMLElement): IProcessRowTemplateData {
		const data = Object.create(null);
		const row = append(container, $('.row'));
		data.name = append(row, $('.nameLabel'));
		return data;
	}
	renderElement(node: ITreeNode<IRemoteDiagnosticError, void>, index: number, templateData: IProcessRowTemplateData, height: number | undefined): void {
		templateData.name.textContent = node.element.errorMessage;
	}
	disposeTemplate(templateData: IProcessRowTemplateData): void {
		// Nothing to do
	}
}


class ProcessRenderer implements ITreeRenderer<ProcessItem, void, IProcessItemTemplateData> {
	constructor(private platform: string, private totalMem: number, private mapPidToWindowTitle: Map<number, string>) { }

	templateId: string = 'process';
	renderTemplate(container: HTMLElement): IProcessItemTemplateData {
		const data = <IProcessItemTemplateData>Object.create(null);
		const row = append(container, $('.row'));

		data.name = append(row, $('.nameLabel'));
		data.CPU = append(row, $('.cpu'));
		data.memory = append(row, $('.memory'));
		data.PID = append(row, $('.pid'));

		return data;
	}
	renderElement(node: ITreeNode<ProcessItem, void>, index: number, templateData: IProcessItemTemplateData, height: number | undefined): void {
		const { element } = node;

		let name = element.name;
		if (name === 'window') {
			const windowTitle = this.mapPidToWindowTitle.get(element.pid);
			name = windowTitle !== undefined ? `${name} (${this.mapPidToWindowTitle.get(element.pid)})` : name;
		}

		templateData.name.textContent = name;
		templateData.name.title = element.cmd;

		templateData.CPU.textContent = element.load.toFixed(0);
		templateData.PID.textContent = element.pid.toFixed(0);

		const memory = this.platform === 'win32' ? element.mem : (this.totalMem * (element.mem / 100));
		templateData.memory.textContent = (memory / ByteSize.MB).toFixed(0);
	}

	disposeTemplate(templateData: IProcessItemTemplateData): void {
		// Nothing to do
	}
}

interface MachineProcessInformation {
	name: string;
	rootProcess: ProcessItem | IRemoteDiagnosticError
}

interface ProcessInformation {
	processRoots: MachineProcessInformation[];
}

interface ProcessTree {
	processes: ProcessInformation;
}

function isMachineProcessInformation(item: any): item is MachineProcessInformation {
	return !!item.name && !!item.rootProcess;
}

function isProcessInformation(item: any): item is ProcessInformation {
	return !!item.processRoots;
}

function isProcessItem(item: any): item is ProcessItem {
	return !!item.pid;
}

class ProcessExplorer {
	private lastRequestTime: number;

	private mapPidToWindowTitle = new Map<number, string>();

	private nativeHostService: INativeHostService;

	private tree: DataTree<any, ProcessTree | MachineProcessInformation | ProcessItem | ProcessInformation | IRemoteDiagnosticError, any> | undefined;

	constructor(windowId: number, private data: ProcessExplorerData) {
		const mainProcessService = new ElectronIPCMainProcessService(windowId);
		this.nativeHostService = new NativeHostService(windowId, mainProcessService) as INativeHostService;

		this.applyStyles(data.styles);
		this.setEventHandlers(data);

		// Map window process pids to titles, annotate process names with this when rendering to distinguish between them
		ipcRenderer.on('vscode:windowsInfoResponse', (event: unknown, windows: any[]) => {
			this.mapPidToWindowTitle = new Map<number, string>();
			windows.forEach(window => this.mapPidToWindowTitle.set(window.pid, window.title));
		});

		ipcRenderer.on('vscode:listProcessesResponse', async (event: unknown, processRoots: MachineProcessInformation[]) => {
			processRoots.forEach((info, index) => {
				if (isProcessItem(info.rootProcess)) {
					info.rootProcess.name = index === 0 ? `${this.data.applicationName} main` : 'remote agent';
				}
			});

			if (!this.tree) {
				await this.createProcessTree(processRoots);
			} else {
				this.tree.setInput({ processes: { processRoots } });
			}

			this.requestProcessList(0);
		});

		this.lastRequestTime = Date.now();
		ipcRenderer.send('vscode:windowsInfoRequest');
		ipcRenderer.send('vscode:listProcesses');


	}

	private setEventHandlers(data: ProcessExplorerData): void {
		document.onkeydown = (e: KeyboardEvent) => {
			const cmdOrCtrlKey = data.platform === 'darwin' ? e.metaKey : e.ctrlKey;

			// Cmd/Ctrl + w closes issue window
			if (cmdOrCtrlKey && e.keyCode === 87) {
				e.stopPropagation();
				e.preventDefault();

				ipcRenderer.send('vscode:closeProcessExplorer');
			}

			// Cmd/Ctrl + zooms in
			if (cmdOrCtrlKey && e.keyCode === 187) {
				zoomIn();
			}

			// Cmd/Ctrl - zooms out
			if (cmdOrCtrlKey && e.keyCode === 189) {
				zoomOut();
			}
		};
	}

	private async createProcessTree(processRoots: MachineProcessInformation[]): Promise<void> {
		const container = document.getElementById('process-list');
		if (!container) {
			return;
		}

		const { totalmem } = await this.nativeHostService.getOSStatistics();

		const renderers = [
			new ProcessRenderer(this.data.platform, totalmem, this.mapPidToWindowTitle),
			new ProcessHeaderTreeRenderer(),
			new MachineRenderer(),
			new ErrorRenderer()
		];

		this.tree = new DataTree('processExplorer',
			container,
			new ProcessListDelegate(),
			renderers,
			new ProcessTreeDataSource(),
			{
				identityProvider:
				{
					getId: (element: ProcessTree | ProcessItem | MachineProcessInformation | ProcessInformation | IRemoteDiagnosticError) => {
						if (isProcessItem(element)) {
							return element.pid.toString();
						}

						if (isRemoteDiagnosticError(element)) {
							return element.hostName;
						}

						if (isProcessInformation(element)) {
							return 'processes';
						}

						if (isMachineProcessInformation(element)) {
							return element.name;
						}

						return 'header';
					}
				}
			});

		this.tree.setInput({ processes: { processRoots } });
		this.tree.layout(window.innerHeight, window.innerWidth);
		this.tree.onContextMenu(e => {
			if (isProcessItem(e.element)) {
				this.showContextMenu(e.element, true);
			}
		});
	}

	private isDebuggable(cmd: string): boolean {
		const matches = DEBUG_FLAGS_PATTERN.exec(cmd);
		return (matches && matches.length >= 2) || cmd.indexOf('node ') >= 0 || cmd.indexOf('node.exe') >= 0;
	}

	private attachTo(item: ProcessItem) {
		const config: any = {
			type: 'node',
			request: 'attach',
			name: `process ${item.pid}`
		};

		let matches = DEBUG_FLAGS_PATTERN.exec(item.cmd);
		if (matches && matches.length >= 2) {
			// attach via port
			if (matches.length === 4 && matches[3]) {
				config.port = parseInt(matches[3]);
			}
			config.protocol = matches[1] === 'debug' ? 'legacy' : 'inspector';
		} else {
			// no port -> try to attach via pid (send SIGUSR1)
			config.processId = String(item.pid);
		}

		// a debug-port=n or inspect-port=n overrides the port
		matches = DEBUG_PORT_PATTERN.exec(item.cmd);
		if (matches && matches.length === 3) {
			// override port
			config.port = parseInt(matches[2]);
		}

		ipcRenderer.send('vscode:workbenchCommand', { id: 'debug.startFromConfig', from: 'processExplorer', args: [config] });
	}

	private applyStyles(styles: ProcessExplorerStyles): void {
		const styleTag = document.createElement('style');
		const content: string[] = [];

		if (styles.hoverBackground) {
			content.push(`.monaco-list-row:hover  { background-color: ${styles.hoverBackground}; }`);
		}

		if (styles.hoverForeground) {
			content.push(`.monaco-list-row:hover { color: ${styles.hoverForeground}; }`);
		}

		styleTag.textContent = content.join('\n');
		if (document.head) {
			document.head.appendChild(styleTag);
		}
		if (styles.color) {
			document.body.style.color = styles.color;
		}
	}

	private showContextMenu(item: ProcessItem, isLocal: boolean) {
		const items: IContextMenuItem[] = [];
		const pid = Number(item.pid);

		if (isLocal) {
			items.push({
				label: localize('killProcess', "Kill Process"),
				click: () => {
					this.nativeHostService.killProcess(pid, 'SIGTERM');
				}
			});

			items.push({
				label: localize('forceKillProcess', "Force Kill Process"),
				click: () => {
					this.nativeHostService.killProcess(pid, 'SIGKILL');
				}
			});

			items.push({
				type: 'separator'
			});
		}

		items.push({
			label: localize('copy', "Copy"),
			click: () => {
				const row = document.getElementById(pid.toString());
				if (row) {
					this.nativeHostService.writeClipboardText(row.innerText);
				}
			}
		});

		items.push({
			label: localize('copyAll', "Copy All"),
			click: () => {
				const processList = document.getElementById('process-list');
				if (processList) {
					this.nativeHostService.writeClipboardText(processList.innerText);
				}
			}
		});

		if (item && isLocal && this.isDebuggable(item.cmd)) {
			items.push({
				type: 'separator'
			});

			items.push({
				label: localize('debug', "Debug"),
				click: () => {
					this.attachTo(item);
				}
			});
		}

		popup(items);
	}

	private requestProcessList(totalWaitTime: number): void {
		setTimeout(() => {
			const nextRequestTime = Date.now();
			const waited = totalWaitTime + nextRequestTime - this.lastRequestTime;
			this.lastRequestTime = nextRequestTime;

			// Wait at least a second between requests.
			if (waited > 1000) {
				ipcRenderer.send('vscode:windowsInfoRequest');
				ipcRenderer.send('vscode:listProcesses');
			} else {
				this.requestProcessList(waited);
			}
		}, 200);
	}
}

export function startup(configuration: ProcessExplorerWindowConfiguration): void {
	const platformClass = configuration.data.platform === 'win32' ? 'windows' : configuration.data.platform === 'linux' ? 'linux' : 'mac';
	document.body.classList.add(platformClass); // used by our fonts
	applyZoom(configuration.data.zoomLevel);

	new ProcessExplorer(configuration.windowId, configuration.data);
}
