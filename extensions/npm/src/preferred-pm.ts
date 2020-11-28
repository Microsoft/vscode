/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import findWorkspaceRoot = require('../node_modules/find-yarn-workspace-root');
import findUp = require('find-up');
import * as path from 'path';
import whichPM = require('which-pm');
import { Uri, workspace } from 'vscode';

async function pathExists(filePath: string) {
	try {
		await workspace.fs.stat(Uri.file(filePath));
	} catch {
		return false;
	}
	return true;
}

async function isPNPMPreferred(pkgPath: string) {
	if (await pathExists(path.join(pkgPath, 'pnpm-lock.yaml'))) {
		return true;
	}
	if (await pathExists(path.join(pkgPath, 'shrinkwrap.yaml'))) {
		return true;
	}
	if (await findUp('pnpm-lock.yaml', { cwd: pkgPath })) {
		return true;
	}

	return false;
}

async function isYarnPreferred(pkgPath: string) {
	if (await pathExists(path.join(pkgPath, 'yarn.lock'))) {
		return true;
	}

	try {
		if (typeof findWorkspaceRoot(pkgPath) === 'string') {
			return true;
		}
	} catch (err) { }

	return false;
}

const isNPMPreferred = (pkgPath: string) => {
	return pathExists(path.join(pkgPath, 'package-lock.json'));
};

export async function findPreferredPM(pkgPath: string): Promise<{ name: string, multiplePMDetected: boolean }> {
	const detectedPackageManagers: string[] = [];

	if (await isNPMPreferred(pkgPath)) {
		detectedPackageManagers.push('npm');
	}

	if (await isYarnPreferred(pkgPath)) {
		detectedPackageManagers.push('yarn');
	}

	if (await isPNPMPreferred(pkgPath)) {
		detectedPackageManagers.push('pnpm');
	}

	const pmUsedForInstallation: { name: string } | null = await whichPM(pkgPath);

	if (pmUsedForInstallation && !detectedPackageManagers.includes(pmUsedForInstallation.name)) {
		detectedPackageManagers.push(pmUsedForInstallation.name);
	}

	const multiplePMDetected = detectedPackageManagers.length > 1;

	return {
		name: detectedPackageManagers[0] || 'npm',
		multiplePMDetected
	};
}
