/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Disposable } from 'vs/base/common/lifecycle';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IUserDataSyncStoreService, IUserData, IUserDataSyncLogService, IUserDataManifest } from 'vs/platform/userDataSync/common/userDataSync';
import { localize } from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { PlatformToString, isWeb, Platform, platform } from 'vs/base/common/platform';
import { escapeRegExpCharacters } from 'vs/base/common/strings';
import { Event, Emitter } from 'vs/base/common/event';

interface IMachineData {
	id: string;
	name: string;
	disabled?: boolean;
}

interface IMachinesData {
	version: number;
	machines: IMachineData[];
}

export type IUserDataSyncMachine = Readonly<IMachineData> & { readonly isCurrent: boolean };

export const IUserDataSyncMachinesService = createDecorator<IUserDataSyncMachinesService>('IUserDataSyncMachinesService');
export interface IUserDataSyncMachinesService {
	_serviceBrand: any;

	readonly onDidChange: Event<void>;

	getMachines(manifest?: IUserDataManifest): Promise<IUserDataSyncMachine[]>;

	addCurrentMachine(manifest?: IUserDataManifest): Promise<void>;
	removeCurrentMachine(manifest?: IUserDataManifest): Promise<void>;
	renameMachine(machineId: string, name: string): Promise<void>;
	setEnablement(machineId: string, enabled: boolean): Promise<void>;
}

const currentMachineNameKey = 'sync.currentMachineName';

export class UserDataSyncMachinesService extends Disposable implements IUserDataSyncMachinesService {

	private static readonly VERSION = 1;
	private static readonly RESOURCE = 'machines';

	_serviceBrand: any;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly currentMachineIdPromise: Promise<string>;
	private userData: IUserData | null = null;

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataSyncStoreService private readonly userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this.currentMachineIdPromise = getServiceMachineId(environmentService, fileService, storageService);
	}

	async getMachines(manifest?: IUserDataManifest): Promise<IUserDataSyncMachine[]> {
		const currentMachineId = await this.currentMachineIdPromise;
		const machineData = await this.readMachinesData(manifest);
		return machineData.machines.map<IUserDataSyncMachine>(machine => ({ ...machine, ...{ isCurrent: machine.id === currentMachineId } }));
	}

	async addCurrentMachine(manifest?: IUserDataManifest): Promise<void> {
		const currentMachineId = await this.currentMachineIdPromise;
		const machineData = await this.readMachinesData(manifest);
		if (!machineData.machines.some(({ id }) => id === currentMachineId)) {
			machineData.machines.push({ id: currentMachineId, name: this.computeCurrentMachineName(machineData.machines) });
			await this.writeMachinesData(machineData);
		}
	}

	async removeCurrentMachine(manifest?: IUserDataManifest): Promise<void> {
		const currentMachineId = await this.currentMachineIdPromise;
		const machineData = await this.readMachinesData(manifest);
		const updatedMachines = machineData.machines.filter(({ id }) => id !== currentMachineId);
		if (updatedMachines.length !== machineData.machines.length) {
			machineData.machines = updatedMachines;
			await this.writeMachinesData(machineData);
		}
	}

	async renameMachine(machineId: string, name: string, manifest?: IUserDataManifest): Promise<void> {
		const currentMachineId = await this.currentMachineIdPromise;
		const machineData = await this.readMachinesData(manifest);
		const machine = machineData.machines.find(({ id }) => id === machineId);
		if (machine) {
			machine.name = name;
			await this.writeMachinesData(machineData);
			if (machineData.machines.some(({ id }) => id === currentMachineId)) {
				this.storageService.store(currentMachineNameKey, name, StorageScope.GLOBAL, StorageTarget.MACHINE);
			}
		}
	}

	async setEnablement(machineId: string, enabled: boolean): Promise<void> {
		const machineData = await this.readMachinesData();
		const machine = machineData.machines.find(({ id }) => id === machineId);
		if (machine) {
			machine.disabled = enabled ? undefined : true;
			await this.writeMachinesData(machineData);
		}
	}

	private computeCurrentMachineName(machines: IMachineData[]): string {
		const previousName = this.storageService.get(currentMachineNameKey, StorageScope.GLOBAL);
		if (previousName) {
			return previousName;
		}

		const namePrefix = `${this.productService.nameLong} (${PlatformToString(isWeb ? Platform.Web : platform)})`;
		const nameRegEx = new RegExp(`${escapeRegExpCharacters(namePrefix)}\\s#(\\d+)`);
		let nameIndex = 0;
		for (const machine of machines) {
			const matches = nameRegEx.exec(machine.name);
			const index = matches ? parseInt(matches[1]) : 0;
			nameIndex = index > nameIndex ? index : nameIndex;
		}
		return `${namePrefix} #${nameIndex + 1}`;
	}

	private async readMachinesData(manifest?: IUserDataManifest): Promise<IMachinesData> {
		this.userData = await this.readUserData(manifest);
		const machinesData = this.parse(this.userData);
		if (machinesData.version !== UserDataSyncMachinesService.VERSION) {
			throw new Error(localize('error incompatible', "Cannot read machines data as the current version is incompatible. Please update {0} and try again.", this.productService.nameLong));
		}
		return machinesData;
	}

	private async writeMachinesData(machinesData: IMachinesData): Promise<void> {
		const content = JSON.stringify(machinesData);
		const ref = await this.userDataSyncStoreService.write(UserDataSyncMachinesService.RESOURCE, content, this.userData?.ref || null);
		this.userData = { ref, content };
		this._onDidChange.fire();
	}

	private async readUserData(manifest?: IUserDataManifest): Promise<IUserData> {
		if (this.userData) {

			const latestRef = manifest && manifest.latest ? manifest.latest[UserDataSyncMachinesService.RESOURCE] : undefined;

			// Last time synced resource and latest resource on server are same
			if (this.userData.ref === latestRef) {
				return this.userData;
			}

			// There is no resource on server and last time it was synced with no resource
			if (latestRef === undefined && this.userData.content === null) {
				return this.userData;
			}
		}

		return this.userDataSyncStoreService.read(UserDataSyncMachinesService.RESOURCE, this.userData);
	}

	private parse(userData: IUserData): IMachinesData {
		if (userData.content !== null) {
			try {
				return JSON.parse(userData.content);
			} catch (e) {
				this.logService.error(e);
			}
		}
		return {
			version: UserDataSyncMachinesService.VERSION,
			machines: []
		};
	}
}
