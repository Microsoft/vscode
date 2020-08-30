/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azure from 'azure-storage';
import * as mime from 'mime';
import * as minimist from 'minimist';
import { basename, join } from 'path';

const fileNames = [
	'fake.html',
	'host.js',
	'index.html',
	'main.js',
	'service-worker.js'
];

async function assertContainer(blobService: azure.BlobService, container: string): Promise<void> {
	await new Promise((c, e) => blobService.createContainerIfNotExists(container, { publicAccessLevel: 'blob' }, err => err ? e(err) : c()));
}

async function doesBlobExist(blobService: azure.BlobService, container: string, blobName: string): Promise<boolean | undefined> {
	const existsResult = await new Promise<azure.BlobService.BlobResult>((c, e) => blobService.doesBlobExist(container, blobName, (err, r) => err ? e(err) : c(r)));
	return existsResult.exists;
}

async function uploadBlob(blobService: azure.BlobService, container: string, blobName: string, file: string): Promise<void> {
	const blobOptions: azure.BlobService.CreateBlockBlobRequestOptions = {
		contentSettings: {
			contentType: mime.lookup(file),
			cacheControl: 'max-age=31536000, public'
		}
	};

	await new Promise((c, e) => blobService.createBlockBlobFromLocalFile(container, blobName, file, blobOptions, err => err ? e(err) : c()));
}

async function publish(commit: string, files: readonly string[]): Promise<void> {

	console.log('Publishing...');
	console.log('Commit:', commit);
	const storageAccount = process.env['AZURE_WEBVIEW_STORAGE_ACCOUNT']!;

	const blobService = azure.createBlobService(storageAccount, process.env['AZURE_WEBVIEW_STORAGE_ACCESS_KEY']!)
		.withFilter(new azure.ExponentialRetryPolicyFilter(20));

	await assertContainer(blobService, commit);

	for (const file of files) {
		const blobName = basename(file);
		const blobExists = await doesBlobExist(blobService, commit, blobName);
		if (blobExists) {
			console.log(`Blob ${commit}, ${blobName} already exists, not publishing again.`);
			continue;
		}
		console.log('Uploading blob to Azure storage...');
		await uploadBlob(blobService, commit, blobName, file);
	}

	console.log('Blobs successfully uploaded.');
}

function main(): void {
	const commit = process.env['BUILD_SOURCEVERSION'];

	if (!commit) {
		console.warn('Skipping publish due to missing BUILD_SOURCEVERSION');
		return;
	}

	const opts = minimist(process.argv.slice(2));
	const [directory] = opts._;

	const files = fileNames.map(fileName => join(directory, fileName));

	publish(commit, files).catch(err => {
		console.error(err);
		process.exit(1);
	});
}

if (process.argv.length < 3) {
	console.error('Usage: node publish.js <directory>');
	process.exit(-1);
}
main();
