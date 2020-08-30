/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { readdirSync } from 'vs/base/node/pfs';
import { statSync, readFileSync } from 'fs';
import { join } from 'vs/base/common/path';

export function buildTelemetryMessage(appRoot: string, extensionsPath?: string): string {
	const mergedTelemetry = Object.create(null);
	// Simple function to merge the telemetry into one json object
	const mergeTelemetry = (contents: string, dirName: string) => {
		const telemetryData = JSON.parse(contents);
		mergedTelemetry[dirName] = telemetryData;
	};
	if (extensionsPath) {
		// Gets all the directories inside the extension directory
		const dirs = readdirSync(extensionsPath).filter(files => {
			// This handles case where broken symbolic links can cause statSync to throw and error
			try {
				return statSync(join(extensionsPath, files)).isDirectory();
			} catch {
				return false;
			}
		});
		const telemetryJsonFolders: string[] = [];
		dirs.forEach((dir) => {
			const files = readdirSync(join(extensionsPath, dir)).filter(file => file === 'telemetry.json');
			// We know it contains a telemetry.json file so we add it to the list of folders which have one
			if (files.length === 1) {
				telemetryJsonFolders.push(dir);
			}
		});
		telemetryJsonFolders.forEach((folder) => {
			const contents = readFileSync(join(extensionsPath, folder, 'telemetry.json')).toString();
			mergeTelemetry(contents, folder);
		});
	}
	let contents = readFileSync(join(appRoot, 'telemetry-core.json')).toString();
	mergeTelemetry(contents, 'vscode-core');
	contents = readFileSync(join(appRoot, 'telemetry-extensions.json')).toString();
	mergeTelemetry(contents, 'vscode-extensions');
	return JSON.stringify(mergedTelemetry, null, 4);
}
