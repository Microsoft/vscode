/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import * as azure from 'azure-storage';
import * as mime from 'mime';
import { CosmosClient } from '@azure/cosmos';

interface Asset {
	platform: string;
	type: string;
	url: string;
	mooncakeUrl?: string;
	hash: string;
	sha256hash: string;
	size: number;
	supportsFastUpdate?: boolean;
}

if (process.argv.length !== 6) {
	console.error('Usage: node createAsset.js PLATFORM TYPE NAME FILE');
	process.exit(-1);
}

function hashStream(hashName: string, stream: Readable): Promise<string> {
	return new Promise<string>((c, e) => {
		const shasum = crypto.createHash(hashName);

		stream
			.on('data', shasum.update.bind(shasum))
			.on('error', e)
			.on('close', () => c(shasum.digest('hex')));
	});
}

async function doesAssetExist(blobService: azure.BlobService, quality: string, blobName: string): Promise<boolean | undefined> {
	const existsResult = await new Promise<azure.BlobService.BlobResult>((c, e) => blobService.doesBlobExist(quality, blobName, (err, r) => err ? e(err) : c(r)));
	return existsResult.exists;
}

async function uploadBlob(blobService: azure.BlobService, quality: string, blobName: string, filePath: string, fileName: string): Promise<void> {
	const blobOptions: azure.BlobService.CreateBlockBlobRequestOptions = {
		contentSettings: {
			contentType: mime.lookup(filePath),
			contentDisposition: `attachment; filename="${fileName}"`,
			cacheControl: 'max-age=31536000, public'
		}
	};

	await new Promise((c, e) => blobService.createBlockBlobFromLocalFile(quality, blobName, filePath, blobOptions, err => err ? e(err) : c()));
}

function getEnv(name: string): string {
	const result = process.env[name];

	if (typeof result === 'undefined') {
		throw new Error('Missing env: ' + name);
	}

	return result;
}

async function main(): Promise<void> {
	const [, , platform, type, fileName, filePath] = process.argv;
	const quality = getEnv('VSCODE_QUALITY');
	const commit = getEnv('BUILD_SOURCEVERSION');

	console.log('Creating asset...');

	const stat = await new Promise<fs.Stats>((c, e) => fs.stat(filePath, (err, stat) => err ? e(err) : c(stat)));
	const size = stat.size;

	console.log('Size:', size);

	const stream = fs.createReadStream(filePath);
	const [sha1hash, sha256hash] = await Promise.all([hashStream('sha1', stream), hashStream('sha256', stream)]);

	console.log('SHA1:', sha1hash);
	console.log('SHA256:', sha256hash);

	const blobName = commit + '/' + fileName;
	const storageAccount = process.env['AZURE_STORAGE_ACCOUNT_2']!;

	const blobService = azure.createBlobService(storageAccount, process.env['AZURE_STORAGE_ACCESS_KEY_2']!)
		.withFilter(new azure.ExponentialRetryPolicyFilter(20));

	const blobExists = await doesAssetExist(blobService, quality, blobName);

	if (blobExists) {
		console.log(`Blob ${quality}, ${blobName} already exists, not publishing again.`);
		return;
	}

	console.log('Uploading blobs to Azure storage...');

	await uploadBlob(blobService, quality, blobName, filePath, fileName);

	console.log('Blobs successfully uploaded.');

	const asset: Asset = {
		platform,
		type,
		url: `${process.env['AZURE_CDN_URL']}/${quality}/${blobName}`,
		hash: sha1hash,
		sha256hash,
		size
	};

	// Remove this if we ever need to rollback fast updates for windows
	if (/win32/.test(platform)) {
		asset.supportsFastUpdate = true;
	}

	console.log('Asset:', JSON.stringify(asset, null, '  '));

	const client = new CosmosClient({ endpoint: process.env['AZURE_DOCUMENTDB_ENDPOINT']!, key: process.env['AZURE_DOCUMENTDB_MASTERKEY'] });
	const scripts = client.database('builds').container(quality).scripts;
	await scripts.storedProcedure('createAsset').execute('', [commit, asset, true]);
}

main().then(() => {
	console.log('Asset successfully created');
	process.exit(0);
}, err => {
	console.error(err);
	process.exit(1);
});
