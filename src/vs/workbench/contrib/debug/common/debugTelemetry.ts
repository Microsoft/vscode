/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDebugModel, IDebugSession, AdapterEndEvent, IBreakpoint } from 'vs/workbench/contrib/debug/common/debug';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Debugger } from 'vs/workbench/contrib/debug/common/debugger';

export class DebugTelemetry {

	constructor(
		private readonly model: IDebugModel,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) { }

	logDebugSessionStart(dbgr: Debugger, launchJsonExists: boolean): Promise<void> {
		const extension = dbgr.getMainExtensionDescriptor();
		/* __GDPR__
			"debugSessionStart" : {
				"type": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"breakpointCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"exceptionBreakpoints": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"watchExpressionsCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"extensionName": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"isBuiltin": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true},
				"launchJsonExists": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		return this.telemetryService.publicLog('debugSessionStart', {
			type: dbgr.type,
			breakpointCount: this.model.getBreakpoints().length,
			exceptionBreakpoints: this.model.getExceptionBreakpoints(),
			watchExpressionsCount: this.model.getWatchExpressions().length,
			extensionName: extension.identifier.value,
			isBuiltin: extension.isBuiltin,
			launchJsonExists
		});
	}

	logDebugSessionStop(session: IDebugSession, adapterExitEvent: AdapterEndEvent): Promise<any> {

		const breakpoints = this.model.getBreakpoints();

		/* __GDPR__
			"debugSessionStop" : {
				"type" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"success": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"sessionLengthInSeconds": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"breakpointCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"watchExpressionsCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		return this.telemetryService.publicLog('debugSessionStop', {
			type: session && session.configuration.type,
			success: adapterExitEvent.emittedStopped || breakpoints.length === 0,
			sessionLengthInSeconds: adapterExitEvent.sessionLengthInSeconds,
			breakpointCount: breakpoints.length,
			watchExpressionsCount: this.model.getWatchExpressions().length
		});
	}

	logDebugAddBreakpoint(breakpoint: IBreakpoint, context: string): Promise<any> {
		/* __GDPR__
			"debugAddBreakpoint" : {
				"context": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"hasCondition": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"hasHitCondition": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"hasLogMessage": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/

		return this.telemetryService.publicLog('debugAddBreakpoint', {
			context: context,
			hasCondition: !!breakpoint.condition,
			hasHitCondition: !!breakpoint.hitCondition,
			hasLogMessage: !!breakpoint.logMessage
		});
	}
}
