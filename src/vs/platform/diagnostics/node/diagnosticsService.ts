/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as osLib from 'os';
import { virtualMachineHint } from 'vs/base/node/id';
import { IDiagnosticsService, IMachineInfo, WorkspaceStats, WorkspaceStatItem, PerformanceInfo, SystemInfo, IRemoteDiagnosticInfo, IRemoteDiagnosticError, isRemoteDiagnosticError, IWorkspaceInformation } from 'vs/platform/diagnostics/common/diagnostics';
import { exists, readFile } from 'fs';
import { join, basename } from 'vs/base/common/path';
import { parse, ParseError, getNodeType } from 'vs/base/common/json';
import { listProcesses } from 'vs/base/node/ps';
import { IProductService } from 'vs/platform/product/common/productService';
import { isWindows, isLinux } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { ProcessItem } from 'vs/base/common/processes';
import { IMainProcessInfo } from 'vs/platform/launch/common/launch';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Iterable } from 'vs/base/common/iterator';
import { Schemas } from 'vs/base/common/network';
import { ByteSize } from 'vs/platform/files/common/files';
import { IDirent, readdir } from 'vs/base/node/pfs';

export interface VersionInfo {
	vscodeVersion: string;
	os: string;
}

export interface ProcessInfo {
	cpu: number;
	memory: number;
	pid: number;
	name: string;
}

interface ConfigFilePatterns {
	tag: string;
	filePattern: RegExp;
	relativePathPattern?: RegExp;
}

export async function collectWorkspaceStats(folder: string, filter: string[]): Promise<WorkspaceStats> {
	const configFilePatterns: ConfigFilePatterns[] = [
		{ tag: 'grunt.js', filePattern: /^gruntfile\.js$/i },
		{ tag: 'gulp.js', filePattern: /^gulpfile\.js$/i },
		{ tag: 'tsconfig.json', filePattern: /^tsconfig\.json$/i },
		{ tag: 'package.json', filePattern: /^package\.json$/i },
		{ tag: 'jsconfig.json', filePattern: /^jsconfig\.json$/i },
		{ tag: 'tslint.json', filePattern: /^tslint\.json$/i },
		{ tag: 'eslint.json', filePattern: /^eslint\.json$/i },
		{ tag: 'tasks.json', filePattern: /^tasks\.json$/i },
		{ tag: 'launch.json', filePattern: /^launch\.json$/i },
		{ tag: 'settings.json', filePattern: /^settings\.json$/i },
		{ tag: 'webpack.config.js', filePattern: /^webpack\.config\.js$/i },
		{ tag: 'project.json', filePattern: /^project\.json$/i },
		{ tag: 'makefile', filePattern: /^makefile$/i },
		{ tag: 'sln', filePattern: /^.+\.sln$/i },
		{ tag: 'csproj', filePattern: /^.+\.csproj$/i },
		{ tag: 'cmake', filePattern: /^.+\.cmake$/i },
		{ tag: 'github-actions', filePattern: /^.+\.yml$/i, relativePathPattern: /^\.github(?:\/|\\)workflows$/i }
	];

	const fileTypes = new Map<string, number>();
	const configFiles = new Map<string, number>();

	const MAX_FILES = 20000;

	function collect(root: string, dir: string, filter: string[], token: { count: number, maxReached: boolean }): Promise<void> {
		const relativePath = dir.substring(root.length + 1);

		return new Promise(async resolve => {
			let files: IDirent[];
			try {
				files = await readdir(dir, { withFileTypes: true });
			} catch (error) {
				// Ignore folders that can't be read
				resolve();
				return;
			}

			if (token.count >= MAX_FILES) {
				token.count += files.length;
				token.maxReached = true;
				resolve();
				return;
			}

			let pending = files.length;
			if (pending === 0) {
				resolve();
				return;
			}

			let filesToRead = files;
			if (token.count + files.length > MAX_FILES) {
				token.maxReached = true;
				pending = MAX_FILES - token.count;
				filesToRead = files.slice(0, pending);
			}

			token.count += files.length;

			for (const file of filesToRead) {
				if (file.isDirectory()) {
					if (!filter.includes(file.name)) {
						await collect(root, join(dir, file.name), filter, token);
					}

					if (--pending === 0) {
						resolve();
						return;
					}
				} else {
					const index = file.name.lastIndexOf('.');
					if (index >= 0) {
						const fileType = file.name.substring(index + 1);
						if (fileType) {
							fileTypes.set(fileType, (fileTypes.get(fileType) ?? 0) + 1);
						}
					}

					for (const configFile of configFilePatterns) {
						if (configFile.relativePathPattern?.test(relativePath) !== false && configFile.filePattern.test(file.name)) {
							configFiles.set(configFile.tag, (configFiles.get(configFile.tag) ?? 0) + 1);
						}
					}

					if (--pending === 0) {
						resolve();
						return;
					}
				}
			}
		});
	}

	const token: { count: number, maxReached: boolean } = { count: 0, maxReached: false };

	await collect(folder, folder, filter, token);
	const launchConfigs = await collectLaunchConfigs(folder);
	return {
		configFiles: asSortedItems(configFiles),
		fileTypes: asSortedItems(fileTypes),
		fileCount: token.count,
		maxFilesReached: token.maxReached,
		launchConfigFiles: launchConfigs
	};
}

function asSortedItems(items: Map<string, number>): WorkspaceStatItem[] {
	return [
		...Iterable.map(items.entries(), ([name, count]) => ({ name: name, count: count }))
	].sort((a, b) => b.count - a.count);
}

export function getMachineInfo(): IMachineInfo {

	const machineInfo: IMachineInfo = {
		os: `${osLib.type()} ${osLib.arch()} ${osLib.release()}`,
		memory: `${(osLib.totalmem() / ByteSize.GB).toFixed(2)}GB (${(osLib.freemem() / ByteSize.GB).toFixed(2)}GB free)`,
		vmHint: `${Math.round((virtualMachineHint.value() * 100))}%`,
	};

	const cpus = osLib.cpus();
	if (cpus && cpus.length > 0) {
		machineInfo.cpus = `${cpus[0].model} (${cpus.length} x ${cpus[0].speed})`;
	}

	return machineInfo;
}

export function collectLaunchConfigs(folder: string): Promise<WorkspaceStatItem[]> {
	let launchConfigs = new Map<string, number>();

	let launchConfig = join(folder, '.vscode', 'launch.json');
	return new Promise((resolve, reject) => {
		exists(launchConfig, (doesExist) => {
			if (doesExist) {
				readFile(launchConfig, (err, contents) => {
					if (err) {
						return resolve([]);
					}

					const errors: ParseError[] = [];
					const json = parse(contents.toString(), errors);
					if (errors.length) {
						console.log(`Unable to parse ${launchConfig}`);
						return resolve([]);
					}

					if (getNodeType(json) === 'object' && json['configurations']) {
						for (const each of json['configurations']) {
							const type = each['type'];
							if (type) {
								if (launchConfigs.has(type)) {
									launchConfigs.set(type, launchConfigs.get(type)! + 1);
								} else {
									launchConfigs.set(type, 1);
								}
							}
						}
					}

					return resolve(asSortedItems(launchConfigs));
				});
			} else {
				return resolve([]);
			}
		});
	});
}

export class DiagnosticsService implements IDiagnosticsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IProductService private readonly productService: IProductService
	) { }

	private formatMachineInfo(info: IMachineInfo): string {
		const output: string[] = [];
		output.push(`OS Version:       ${info.os}`);
		output.push(`CPUs:             ${info.cpus}`);
		output.push(`Memory (System):  ${info.memory}`);
		output.push(`VM:               ${info.vmHint}`);

		return output.join('\n');
	}

	private formatEnvironment(info: IMainProcessInfo): string {
		const output: string[] = [];
		output.push(`Version:          ${this.productService.nameShort} ${this.productService.version} (${this.productService.commit || 'Commit unknown'}, ${this.productService.date || 'Date unknown'})`);
		output.push(`OS Version:       ${osLib.type()} ${osLib.arch()} ${osLib.release()}`);
		const cpus = osLib.cpus();
		if (cpus && cpus.length > 0) {
			output.push(`CPUs:             ${cpus[0].model} (${cpus.length} x ${cpus[0].speed})`);
		}
		output.push(`Memory (System):  ${(osLib.totalmem() / ByteSize.GB).toFixed(2)}GB (${(osLib.freemem() / ByteSize.GB).toFixed(2)}GB free)`);
		if (!isWindows) {
			output.push(`Load (avg):       ${osLib.loadavg().map(l => Math.round(l)).join(', ')}`); // only provided on Linux/macOS
		}
		output.push(`VM:               ${Math.round((virtualMachineHint.value() * 100))}%`);
		output.push(`Screen Reader:    ${info.screenReader ? 'yes' : 'no'}`);
		output.push(`Process Argv:     ${info.mainArguments.join(' ')}`);
		output.push(`GPU Status:       ${this.expandGPUFeatures(info.gpuFeatureStatus)}`);

		return output.join('\n');
	}

	public async getPerformanceInfo(info: IMainProcessInfo, remoteData: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<PerformanceInfo> {
		return Promise.all<ProcessItem, string>([listProcesses(info.mainPID), this.formatWorkspaceMetadata(info)]).then(async result => {
			let [rootProcess, workspaceInfo] = result;
			let processInfo = this.formatProcessList(info, rootProcess);

			remoteData.forEach(diagnostics => {
				if (isRemoteDiagnosticError(diagnostics)) {
					processInfo += `\n${diagnostics.errorMessage}`;
					workspaceInfo += `\n${diagnostics.errorMessage}`;
				} else {
					processInfo += `\n\nRemote: ${diagnostics.hostName}`;
					if (diagnostics.processes) {
						processInfo += `\n${this.formatProcessList(info, diagnostics.processes)}`;
					}

					if (diagnostics.workspaceMetadata) {
						workspaceInfo += `\n|  Remote: ${diagnostics.hostName}`;
						for (const folder of Object.keys(diagnostics.workspaceMetadata)) {
							const metadata = diagnostics.workspaceMetadata[folder];

							let countMessage = `${metadata.fileCount} files`;
							if (metadata.maxFilesReached) {
								countMessage = `more than ${countMessage}`;
							}

							workspaceInfo += `|    Folder (${folder}): ${countMessage}`;
							workspaceInfo += this.formatWorkspaceStats(metadata);
						}
					}
				}
			});

			return {
				processInfo,
				workspaceInfo
			};
		});
	}

	public async getSystemInfo(info: IMainProcessInfo, remoteData: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<SystemInfo> {
		const { memory, vmHint, os, cpus } = getMachineInfo();
		const systemInfo: SystemInfo = {
			os,
			memory,
			cpus,
			vmHint,
			processArgs: `${info.mainArguments.join(' ')}`,
			gpuStatus: info.gpuFeatureStatus,
			screenReader: `${info.screenReader ? 'yes' : 'no'}`,
			remoteData
		};

		if (!isWindows) {
			systemInfo.load = `${osLib.loadavg().map(l => Math.round(l)).join(', ')}`;
		}

		if (isLinux) {
			systemInfo.linuxEnv = {
				desktopSession: process.env['DESKTOP_SESSION'],
				xdgSessionDesktop: process.env['XDG_SESSION_DESKTOP'],
				xdgCurrentDesktop: process.env['XDG_CURRENT_DESKTOP'],
				xdgSessionType: process.env['XDG_SESSION_TYPE']
			};
		}

		return Promise.resolve(systemInfo);
	}

	public async getDiagnostics(info: IMainProcessInfo, remoteDiagnostics: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<string> {
		const output: string[] = [];
		return listProcesses(info.mainPID).then(async rootProcess => {

			// Environment Info
			output.push('');
			output.push(this.formatEnvironment(info));

			// Process List
			output.push('');
			output.push(this.formatProcessList(info, rootProcess));

			// Workspace Stats
			if (info.windows.some(window => window.folderURIs && window.folderURIs.length > 0 && !window.remoteAuthority)) {
				output.push('');
				output.push('Workspace Stats: ');
				output.push(await this.formatWorkspaceMetadata(info));
			}

			remoteDiagnostics.forEach(diagnostics => {
				if (isRemoteDiagnosticError(diagnostics)) {
					output.push(`\n${diagnostics.errorMessage}`);
				} else {
					output.push('\n\n');
					output.push(`Remote:           ${diagnostics.hostName}`);
					output.push(this.formatMachineInfo(diagnostics.machineInfo));

					if (diagnostics.processes) {
						output.push(this.formatProcessList(info, diagnostics.processes));
					}

					if (diagnostics.workspaceMetadata) {
						for (const folder of Object.keys(diagnostics.workspaceMetadata)) {
							const metadata = diagnostics.workspaceMetadata[folder];

							let countMessage = `${metadata.fileCount} files`;
							if (metadata.maxFilesReached) {
								countMessage = `more than ${countMessage}`;
							}

							output.push(`Folder (${folder}): ${countMessage}`);
							output.push(this.formatWorkspaceStats(metadata));
						}
					}
				}
			});

			output.push('');
			output.push('');

			return output.join('\n');
		});
	}

	private formatWorkspaceStats(workspaceStats: WorkspaceStats): string {
		const output: string[] = [];
		const lineLength = 60;
		let col = 0;

		const appendAndWrap = (name: string, count: number) => {
			const item = ` ${name}(${count})`;

			if (col + item.length > lineLength) {
				output.push(line);
				line = '|                 ';
				col = line.length;
			}
			else {
				col += item.length;
			}
			line += item;
		};

		// File Types
		let line = '|      File types:';
		const maxShown = 10;
		let max = workspaceStats.fileTypes.length > maxShown ? maxShown : workspaceStats.fileTypes.length;
		for (let i = 0; i < max; i++) {
			const item = workspaceStats.fileTypes[i];
			appendAndWrap(item.name, item.count);
		}
		output.push(line);

		// Conf Files
		if (workspaceStats.configFiles.length >= 0) {
			line = '|      Conf files:';
			col = 0;
			workspaceStats.configFiles.forEach((item) => {
				appendAndWrap(item.name, item.count);
			});
			output.push(line);
		}

		if (workspaceStats.launchConfigFiles.length > 0) {
			let line = '|      Launch Configs:';
			workspaceStats.launchConfigFiles.forEach(each => {
				const item = each.count > 1 ? ` ${each.name}(${each.count})` : ` ${each.name}`;
				line += item;
			});
			output.push(line);
		}
		return output.join('\n');
	}

	private expandGPUFeatures(gpuFeatures: any): string {
		const longestFeatureName = Math.max(...Object.keys(gpuFeatures).map(feature => feature.length));
		// Make columns aligned by adding spaces after feature name
		return Object.keys(gpuFeatures).map(feature => `${feature}:  ${' '.repeat(longestFeatureName - feature.length)}  ${gpuFeatures[feature]}`).join('\n                  ');
	}

	private formatWorkspaceMetadata(info: IMainProcessInfo): Promise<string> {
		const output: string[] = [];
		const workspaceStatPromises: Promise<void>[] = [];

		info.windows.forEach(window => {
			if (window.folderURIs.length === 0 || !!window.remoteAuthority) {
				return;
			}

			output.push(`|  Window (${window.title})`);

			window.folderURIs.forEach(uriComponents => {
				const folderUri = URI.revive(uriComponents);
				if (folderUri.scheme === Schemas.file) {
					const folder = folderUri.fsPath;
					workspaceStatPromises.push(collectWorkspaceStats(folder, ['node_modules', '.git']).then(stats => {
						let countMessage = `${stats.fileCount} files`;
						if (stats.maxFilesReached) {
							countMessage = `more than ${countMessage}`;
						}
						output.push(`|    Folder (${basename(folder)}): ${countMessage}`);
						output.push(this.formatWorkspaceStats(stats));

					}).catch(error => {
						output.push(`|      Error: Unable to collect workspace stats for folder ${folder} (${error.toString()})`);
					}));
				} else {
					output.push(`|    Folder (${folderUri.toString()}): Workspace stats not available.`);
				}
			});
		});

		return Promise.all(workspaceStatPromises)
			.then(_ => output.join('\n'))
			.catch(e => `Unable to collect workspace stats: ${e}`);
	}

	private formatProcessList(info: IMainProcessInfo, rootProcess: ProcessItem): string {
		const mapPidToWindowTitle = new Map<number, string>();
		info.windows.forEach(window => mapPidToWindowTitle.set(window.pid, window.title));

		const output: string[] = [];

		output.push('CPU %\tMem MB\t   PID\tProcess');

		if (rootProcess) {
			this.formatProcessItem(info.mainPID, mapPidToWindowTitle, output, rootProcess, 0);
		}

		return output.join('\n');
	}

	private formatProcessItem(mainPid: number, mapPidToWindowTitle: Map<number, string>, output: string[], item: ProcessItem, indent: number): void {
		const isRoot = (indent === 0);

		// Format name with indent
		let name: string;
		if (isRoot) {
			name = item.pid === mainPid ? `${this.productService.applicationName} main` : 'remote agent';
		} else {
			name = `${'  '.repeat(indent)} ${item.name}`;

			if (item.name === 'window') {
				name = `${name} (${mapPidToWindowTitle.get(item.pid)})`;
			}
		}

		const memory = process.platform === 'win32' ? item.mem : (osLib.totalmem() * (item.mem / 100));
		output.push(`${item.load.toFixed(0).padStart(5, ' ')}\t${(memory / ByteSize.MB).toFixed(0).padStart(6, ' ')}\t${item.pid.toFixed(0).padStart(6, ' ')}\t${name}`);

		// Recurse into children if any
		if (Array.isArray(item.children)) {
			item.children.forEach(child => this.formatProcessItem(mainPid, mapPidToWindowTitle, output, child, indent + 1));
		}
	}

	public async reportWorkspaceStats(workspace: IWorkspaceInformation): Promise<void> {
		for (const { uri } of workspace.folders) {
			const folderUri = URI.revive(uri);
			if (folderUri.scheme !== Schemas.file) {
				continue;
			}

			const folder = folderUri.fsPath;
			try {
				const stats = await collectWorkspaceStats(folder, ['node_modules', '.git']);
				type WorkspaceStatsClassification = {
					'workspace.id': { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					rendererSessionId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				};
				type WorkspaceStatsEvent = {
					'workspace.id': string | undefined;
					rendererSessionId: string;
				};
				this.telemetryService.publicLog2<WorkspaceStatsEvent, WorkspaceStatsClassification>('workspace.stats', {
					'workspace.id': workspace.telemetryId,
					rendererSessionId: workspace.rendererSessionId
				});
				type WorkspaceStatsFileClassification = {
					rendererSessionId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					type: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
					count: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
				};
				type WorkspaceStatsFileEvent = {
					rendererSessionId: string;
					type: string;
					count: number;
				};
				stats.fileTypes.forEach(e => {
					this.telemetryService.publicLog2<WorkspaceStatsFileEvent, WorkspaceStatsFileClassification>('workspace.stats.file', {
						rendererSessionId: workspace.rendererSessionId,
						type: e.name,
						count: e.count
					});
				});
				stats.launchConfigFiles.forEach(e => {
					this.telemetryService.publicLog2<WorkspaceStatsFileEvent, WorkspaceStatsFileClassification>('workspace.stats.launchConfigFile', {
						rendererSessionId: workspace.rendererSessionId,
						type: e.name,
						count: e.count
					});
				});
				stats.configFiles.forEach(e => {
					this.telemetryService.publicLog2<WorkspaceStatsFileEvent, WorkspaceStatsFileClassification>('workspace.stats.configFiles', {
						rendererSessionId: workspace.rendererSessionId,
						type: e.name,
						count: e.count
					});
				});
			} catch {
				// Report nothing if collecting metadata fails.
			}
		}
	}
}
