/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as url from 'url';
import * as azure from 'azure-storage';
import * as mime from 'mime';
import { CosmosClient } from '@azure/cosmos';

function log(...args: any[]) {
	console.log(...[`[${new Date().toISOString()}]`, ...args]);
}

function error(...args: any[]) {
	console.error(...[`[${new Date().toISOString()}]`, ...args]);
}

if (process.argv.length < 3) {
	error('Usage: node sync-mooncake.js <quality>');
	process.exit(-1);
}

interface Build {
	assets: Asset[];
}

interface Asset {
	platform: string;
	type: string;
	url: string;
	mooncakeUrl: string;
	hash: string;
	sha256hash: string;
	size: number;
	supportsFastUpdate?: boolean;
}

async function sync(commit: string, quality: string): Promise<void> {
	log(`Synchronizing Mooncake assets for ${quality}, ${commit}...`);

	const client = new CosmosClient({ endpoint: process.env['AZURE_DOCUMENTDB_ENDPOINT']!, key: process.env['AZURE_DOCUMENTDB_MASTERKEY'] });
	const container = client.database('builds').container(quality);

	const query = `SELECT TOP 1 * FROM c WHERE c.id = "${commit}"`;
	const res = await container.items.query<Build>(query, {}).fetchAll();

	if (res.resources.length !== 1) {
		throw new Error(`No builds found for ${commit}`);
	}

	const build = res.resources[0];

	log(`Found build for ${commit}, with ${build.assets.length} assets`);

	const storageAccount = process.env['AZURE_STORAGE_ACCOUNT_2']!;

	const blobService = azure.createBlobService(storageAccount, process.env['AZURE_STORAGE_ACCESS_KEY_2']!)
		.withFilter(new azure.ExponentialRetryPolicyFilter(20));

	const mooncakeBlobService = azure.createBlobService(storageAccount, process.env['MOONCAKE_STORAGE_ACCESS_KEY']!, `${storageAccount}.blob.core.chinacloudapi.cn`)
		.withFilter(new azure.ExponentialRetryPolicyFilter(20));

	// mooncake is fussy and far away, this is needed!
	blobService.defaultClientRequestTimeoutInMs = 10 * 60 * 1000;
	mooncakeBlobService.defaultClientRequestTimeoutInMs = 10 * 60 * 1000;

	for (const asset of build.assets) {
		try {
			const blobPath = url.parse(asset.url).path;

			if (!blobPath) {
				throw new Error(`Failed to parse URL: ${asset.url}`);
			}

			const blobName = blobPath.replace(/^\/\w+\//, '');

			log(`Found ${blobName}`);

			if (asset.mooncakeUrl) {
				log(`  Already in Mooncake ✔️`);
				continue;
			}

			const readStream = blobService.createReadStream(quality, blobName, undefined!);
			const blobOptions: azure.BlobService.CreateBlockBlobRequestOptions = {
				contentSettings: {
					contentType: mime.lookup(blobPath),
					cacheControl: 'max-age=31536000, public'
				}
			};

			const writeStream = mooncakeBlobService.createWriteStreamToBlockBlob(quality, blobName, blobOptions, undefined);

			log(`  Uploading to Mooncake...`);
			await new Promise((c, e) => readStream.pipe(writeStream).on('finish', c).on('error', e));

			log(`  Updating build in DB...`);
			const mooncakeUrl = `${process.env['MOONCAKE_CDN_URL']}${blobPath}`;
			await container.scripts.storedProcedure('setAssetMooncakeUrl')
				.execute('', [commit, asset.platform, asset.type, mooncakeUrl]);

			log(`  Done ✔️`);
		} catch (err) {
			error(err);
		}
	}

	log(`All done ✔️`);
}

function main(): void {
	const commit = process.env['BUILD_SOURCEVERSION'];

	if (!commit) {
		error('Skipping publish due to missing BUILD_SOURCEVERSION');
		return;
	}

	const quality = process.argv[2];

	sync(commit, quality).catch(err => {
		error(err);
		process.exit(1);
	});
}

main();
