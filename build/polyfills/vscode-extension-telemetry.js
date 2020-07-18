/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
Object.defineProperty(exports, "__esModule", { value: true });

let TelemetryReporter = (function () {
	function TelemetryReporter(extensionId, extensionVersion, key) {
	}
	TelemetryReporter.prototype.updateUserOptIn = function (key) {
	};
	TelemetryReporter.prototype.createAppInsightsClient = function (key) {
	};
	TelemetryReporter.prototype.getCommonProperties = function () {
	};
	TelemetryReporter.prototype.sendTelemetryEvent = function (eventName, properties, measurements) {
	};
	TelemetryReporter.prototype.dispose = function () {
	};
	TelemetryReporter.TELEMETRY_CONFIG_ID = 'telemetry';
	TelemetryReporter.TELEMETRY_CONFIG_ENABLED_ID = 'enableTelemetry';
	return TelemetryReporter;
}());
exports.default = TelemetryReporter;
