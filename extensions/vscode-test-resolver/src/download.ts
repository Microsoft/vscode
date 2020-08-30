/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { parse as parseUrl } from 'url';

function ensureFolderExists(loc: string) {
	if (!fs.existsSync(loc)) {
		const parent = path.dirname(loc);
		if (parent) {
			ensureFolderExists(parent);
		}
		fs.mkdirSync(loc);
	}
}

function getDownloadUrl(updateUrl: string, commit: string, platform: string, quality: string): string {
	return `${updateUrl}/commit:${commit}/server-${platform}/${quality}`;
}

async function downloadVSCodeServerArchive(updateUrl: string, commit: string, quality: string, destDir: string): Promise<string> {
	ensureFolderExists(destDir);

	const platform = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin' : 'linux-x64';
	const downloadUrl = getDownloadUrl(updateUrl, commit, platform, quality);

	return new Promise((resolve, reject) => {
		console.log(`Downloading VS Code Server from: ${downloadUrl}`);
		const requestOptions: https.RequestOptions = parseUrl(downloadUrl);

		https.get(requestOptions, res => {
			if (res.statusCode !== 302) {
				reject('Failed to get VS Code server archive location');
			}
			const archiveUrl = res.headers.location;
			if (!archiveUrl) {
				reject('Failed to get VS Code server archive location');
				return;
			}

			const archiveRequestOptions: https.RequestOptions = parseUrl(archiveUrl);
			if (archiveUrl.endsWith('.zip')) {
				const archivePath = path.resolve(destDir, `vscode-server-${commit}.zip`);
				const outStream = fs.createWriteStream(archivePath);
				outStream.on('close', () => {
					resolve(archivePath);
				});
				https.get(archiveRequestOptions, res => {
					res.pipe(outStream);
				});
			} else {
				const zipPath = path.resolve(destDir, `vscode-server-${commit}.tgz`);
				const outStream = fs.createWriteStream(zipPath);
				https.get(archiveRequestOptions, res => {
					res.pipe(outStream);
				});
				outStream.on('close', () => {
					resolve(zipPath);
				});
			}
		});
	});
}

/**
 * Unzip a .zip or .tar.gz VS Code archive
 */
function unzipVSCodeServer(vscodeArchivePath: string, extractDir: string) {
	if (vscodeArchivePath.endsWith('.zip')) {
		const tempDir = fs.mkdtempSync('vscode-server');
		if (process.platform === 'win32') {
			cp.spawnSync('powershell.exe', [
				'-NoProfile',
				'-ExecutionPolicy', 'Bypass',
				'-NonInteractive',
				'-NoLogo',
				'-Command',
				`Microsoft.PowerShell.Archive\\Expand-Archive -Path "${vscodeArchivePath}" -DestinationPath "${tempDir}"`
			]);
		} else {
			cp.spawnSync('unzip', [vscodeArchivePath, '-d', `${tempDir}`]);
		}
		fs.renameSync(path.join(tempDir, process.platform === 'win32' ? 'vscode-server-win32-x64' : 'vscode-server-darwin'), extractDir);
	} else {
		// tar does not create extractDir by default
		if (!fs.existsSync(extractDir)) {
			fs.mkdirSync(extractDir);
		}
		cp.spawnSync('tar', ['-xzf', vscodeArchivePath, '-C', extractDir, '--strip-components', '1']);
	}
}

export async function downloadAndUnzipVSCodeServer(updateUrl: string, commit: string, quality: string = 'stable', destDir: string): Promise<string> {

	const extractDir = path.join(destDir, commit);
	if (fs.existsSync(extractDir)) {
		console.log(`Found ${extractDir}. Skipping download.`);
	} else {
		console.log(`Downloading VS Code Server ${quality} - ${commit} into ${extractDir}.`);
		try {
			const vscodeArchivePath = await downloadVSCodeServerArchive(updateUrl, commit, quality, destDir);
			if (fs.existsSync(vscodeArchivePath)) {
				unzipVSCodeServer(vscodeArchivePath, extractDir);
				// Remove archive
				fs.unlinkSync(vscodeArchivePath);
			}
		} catch (err) {
			throw Error(`Failed to download and unzip VS Code ${quality} - ${commit}`);
		}
	}
	return Promise.resolve(extractDir);
}
