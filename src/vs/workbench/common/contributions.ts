/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService, IConstructorSignature0, ServicesAccessor, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { runWhenIdle, IdleDeadline } from 'vs/base/common/async';

/**
 * A workbench contribution that will be loaded when the workbench starts and disposed when the workbench shuts down.
 */
export interface IWorkbenchContribution {
	// Marker Interface
}

export namespace Extensions {
	export const Workbench = 'workbench.contributions.kind';
}

type IWorkbenchContributionSignature<Service extends BrandedService[]> = new (...services: Service) => IWorkbenchContribution;

export interface IWorkbenchContributionsRegistry {

	/**
	 * Registers a workbench contribution to the platform that will be loaded when the workbench starts and disposed when
	 * the workbench shuts down.
	 *
	 * @param phase the lifecycle phase when to instantiate the contribution.
	 */
	registerWorkbenchContribution<Services extends BrandedService[]>(contribution: IWorkbenchContributionSignature<Services>, phase: LifecyclePhase): void;

	/**
	 * Starts the registry by providing the required services.
	 */
	start(accessor: ServicesAccessor): void;
}

class WorkbenchContributionsRegistry implements IWorkbenchContributionsRegistry {

	private instantiationService: IInstantiationService | undefined;
	private lifecycleService: ILifecycleService | undefined;

	private readonly toBeInstantiated = new Map<LifecyclePhase, IConstructorSignature0<IWorkbenchContribution>[]>();

	registerWorkbenchContribution(ctor: IConstructorSignature0<IWorkbenchContribution>, phase: LifecyclePhase = LifecyclePhase.Starting): void {

		// Instantiate directly if we are already matching the provided phase
		if (this.instantiationService && this.lifecycleService && this.lifecycleService.phase >= phase) {
			this.instantiationService.createInstance(ctor);
		}

		// Otherwise keep contributions by lifecycle phase
		else {
			let toBeInstantiated = this.toBeInstantiated.get(phase);
			if (!toBeInstantiated) {
				toBeInstantiated = [];
				this.toBeInstantiated.set(phase, toBeInstantiated);
			}

			toBeInstantiated.push(ctor as IConstructorSignature0<IWorkbenchContribution>);
		}
	}

	start(accessor: ServicesAccessor): void {
		const instantiationService = this.instantiationService = accessor.get(IInstantiationService);
		const lifecycleService = this.lifecycleService = accessor.get(ILifecycleService);

		[LifecyclePhase.Starting, LifecyclePhase.Ready, LifecyclePhase.Restored, LifecyclePhase.Eventually].forEach(phase => {
			this.instantiateByPhase(instantiationService, lifecycleService, phase);
		});
	}

	private instantiateByPhase(instantiationService: IInstantiationService, lifecycleService: ILifecycleService, phase: LifecyclePhase): void {

		// Instantiate contributions directly when phase is already reached
		if (lifecycleService.phase >= phase) {
			this.doInstantiateByPhase(instantiationService, phase);
		}

		// Otherwise wait for phase to be reached
		else {
			lifecycleService.when(phase).then(() => this.doInstantiateByPhase(instantiationService, phase));
		}
	}

	private doInstantiateByPhase(instantiationService: IInstantiationService, phase: LifecyclePhase): void {
		const toBeInstantiated = this.toBeInstantiated.get(phase);
		if (toBeInstantiated) {
			this.toBeInstantiated.delete(phase);
			if (phase !== LifecyclePhase.Eventually) {
				// instantiate everything synchronously and blocking
				for (const ctor of toBeInstantiated) {
					this.safeCreateInstance(instantiationService, ctor); // catch error so that other contributions are still considered
				}
			} else {
				// for the Eventually-phase we instantiate contributions
				// only when idle. this might take a few idle-busy-cycles
				// but will finish within the timeouts
				let forcedTimeout = 3000;
				let i = 0;
				let instantiateSome = (idle: IdleDeadline) => {
					while (i < toBeInstantiated.length) {
						const ctor = toBeInstantiated[i++];
						this.safeCreateInstance(instantiationService, ctor); // catch error so that other contributions are still considered
						if (idle.timeRemaining() < 1) {
							// time is up -> reschedule
							runWhenIdle(instantiateSome, forcedTimeout);
							break;
						}
					}
				};
				runWhenIdle(instantiateSome, forcedTimeout);
			}
		}
	}

	private safeCreateInstance(instantiationService: IInstantiationService, ctor: IConstructorSignature0<IWorkbenchContribution>): void {
		try {
			instantiationService.createInstance(ctor);
		} catch (error) {
			console.error(`Unable to instantiate workbench contribution ${ctor.name}.`, error);
		}
	}
}

Registry.add(Extensions.Workbench, new WorkbenchContributionsRegistry());
