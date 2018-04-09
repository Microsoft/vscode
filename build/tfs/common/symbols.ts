/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as request from 'request';
import { createReadStream, createWriteStream, unlink, mkdir } from 'fs';
import * as github from 'github-releases';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const BASE_URL = 'https://rink.hockeyapp.net/api/2/';
const HOCKEY_APP_TOKEN_HEADER = 'X-HockeyAppToken';

export interface IVersions {
	app_versions: IVersion[];
}

export interface IVersion {
	id: number;
	version: string;
}

export interface IApplicationAccessor {
	accessToken: string;
	appId: string;
}

export interface IVersionAccessor extends IApplicationAccessor {
	id: string;
}

enum Platform {
	WIN_32 = 'win32-ia32',
	WIN_64 = 'win32-x64',
	LINUX_32 = 'linux-ia32',
	LINUX_64 = 'linux-x64',
	MAC_OS = 'darwin-x64'
}

function symbolsZipName(platform: Platform, electronVersion: string, insiders: boolean): string {
	return `${insiders ? 'insiders' : 'stable'}-symbols-v${electronVersion}-${platform}.zip`;
}

const SEED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
async function tmpFile(name: string): Promise<string> {
	let res = '';
	for (let i = 0; i < 8; i++) {
		res += SEED.charAt(Math.floor(Math.random() * SEED.length));
	}

	const tmpParent = join(tmpdir(), res);

	await promisify(mkdir)(tmpParent);

	return join(tmpParent, name);
}

async function getVersions(accessor: IApplicationAccessor): Promise<IVersions> {
	return await asyncRequest<IVersions>({
		url: `${BASE_URL}/apps/${accessor.appId}/app_versions`,
		method: 'GET',
		headers: {
			[HOCKEY_APP_TOKEN_HEADER]: accessor.accessToken
		}
	});
}

async function createVersion(accessor: IApplicationAccessor, version: string): Promise<IVersion> {
	return await asyncRequest<IVersion>({
		url: `${BASE_URL}/apps/${accessor.appId}/app_versions/new`,
		method: 'POST',
		headers: {
			[HOCKEY_APP_TOKEN_HEADER]: accessor.accessToken
		},
		formData: {
			bundle_version: version
		}
	});
}

async function updateVersion(accessor: IVersionAccessor, symbolsPath: string) {
	return await asyncRequest<IVersions>({
		url: `${BASE_URL}/apps/${accessor.appId}/app_versions/${accessor.id}`,
		method: 'PUT',
		headers: {
			[HOCKEY_APP_TOKEN_HEADER]: accessor.accessToken
		},
		formData: {
			dsym: createReadStream(symbolsPath)
		}
	});
}

async function asyncRequest<T>(options: request.UrlOptions & request.CoreOptions): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request(options, (error, response, body) => {
			if (error) {
				reject(error);
			} else {
				resolve(JSON.parse(body));
			}
		});
	});
}

async function downloadAsset(repository, assetName: string, targetPath: string, electronVersion: string) {
	return new Promise((resolve, reject) => {
		repository.getReleases({ tag_name: `v${electronVersion}` }, (err, releases) => {
			if (err) {
				reject(err);
			} else {
				const asset = releases[0].assets.filter(asset => asset.name === assetName)[0];
				if (!asset) {
					reject(new Error(`Asset with name ${assetName} not found`));
				} else {
					repository.downloadAsset(asset, (err, reader) => {
						if (err) {
							reject(err);
						} else {
							const writer = createWriteStream(targetPath);
							writer.on('error', reject);
							writer.on('close', resolve);
							reader.on('error', reject);

							reader.pipe(writer);
						}
					});
				}
			}
		});
	});
}

interface IOptions {
	platform: Platform;
	versions: { code: string; insiders: boolean; electron: string; };
	access: { hockeyAppToken: string; hockeyAppId: string; githubToken: string };
}

async function ensureVersionAndSymbols(options: IOptions) {

	// Check version does not exist
	console.log(`HockeyApp: checking for existing version ${options.versions.code} (${options.platform})`);
	const versions = await getVersions({ accessToken: options.access.hockeyAppToken, appId: options.access.hockeyAppId });
	if (versions.app_versions.some(v => v.version === options.versions.code)) {
		console.log(`Returning without uploading symbols because version ${options.versions.code} (${options.platform}) was already found`);
		return;
	}

	// Download symbols for platform and electron version
	const symbolsName = symbolsZipName(options.platform, options.versions.electron, options.versions.insiders);
	const symbolsPath = await tmpFile('symbols.zip');
	console.log(`HockeyApp: downloading symbols ${symbolsName} for electron ${options.versions.electron} (${options.platform}) into ${symbolsPath}`);
	await downloadAsset(new github({ repo: 'Microsoft/vscode-electron-prebuilt', token: options.access.githubToken }), symbolsName, symbolsPath, options.versions.electron);

	// Create version
	console.log(`HockeyApp: creating new version ${options.versions.code} (${options.platform})`);
	const version = await createVersion({ accessToken: options.access.hockeyAppToken, appId: options.access.hockeyAppId }, options.versions.code);

	// Upload symbols
	console.log(`HockeyApp: uploading symbols for version ${options.versions.code} (${options.platform})`);
	await updateVersion({ id: String(version.id), accessToken: options.access.hockeyAppToken, appId: options.access.hockeyAppId }, symbolsPath);

	// Cleanup
	await promisify(unlink)(symbolsPath);
}

// Environment
const pakage = require('../../../package.json');
const codeVersion = pakage.version;
const insiders = process.env['VSCODE_QUALITY'] !== 'stable';
const githubToken = process.env['VSCODE_MIXIN_PASSWORD']; // TODO@Joao we should rename this to GITHUB_TOKEN
const hockeyAppToken = process.env['VSCODE_HOCKEYAPP_TOKEN'];

let hockeyAppId: string;
let platform: Platform;
const is64 = process.env['VSCODE_ARCH'] === 'x64';
if (process.platform === 'darwin') {
	platform = Platform.MAC_OS;
	hockeyAppId = process.env['VSCODE_HOCKEYAPP_ID_MACOS'];
} else if (process.platform === 'win32') {
	platform = is64 ? Platform.WIN_64 : Platform.WIN_32;
	hockeyAppId = is64 ? process.env['VSCODE_HOCKEYAPP_ID_WIN64'] : process.env['VSCODE_HOCKEYAPP_ID_WIN32'];
} else {
	platform = is64 ? Platform.LINUX_64 : Platform.LINUX_32;
	hockeyAppId = is64 ? process.env['VSCODE_HOCKEYAPP_ID_LINUX64'] : process.env['VSCODE_HOCKEYAPP_ID_LINUX32'];
}

// Create version and upload symbols in HockeyApp
ensureVersionAndSymbols({
	platform,
	versions: {
		code: '1.10.0-insiders', // TODO@Ben use codeVersion
		insiders,
		electron: '1.7.12' // TODO@Ben get from environment (.yarnrc?)
	},
	access: {
		githubToken,
		hockeyAppToken,
		hockeyAppId
	}
}).then(() => {
	console.log('HockeyApp: done');
}, error => {
	console.error(`HockeyApp: error (${error})`);
});