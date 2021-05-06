/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { networkInterfaces } from 'os';

const invalidMacAddresses = new Set([
	'00:00:00:00:00:00',
	'ff:ff:ff:ff:ff:ff',
	'ac:de:48:00:11:22'
]);

function validateMacAddress(candidate: string): boolean {
	const tempCandidate = candidate.replace(/\-/g, ':').toLowerCase();
	return !invalidMacAddresses.has(tempCandidate);
}

export function getMac(): Promise<string> {
	return new Promise(async (resolve, reject) => {
		const timeout = setTimeout(() => reject('Unable to retrieve mac address (timeout after 10s)'), 10000);

		try {
			resolve(await doGetMac());
		} catch (error) {
			reject(error);
		} finally {
			clearTimeout(timeout);
		}
	});
}

function doGetMac(): Promise<string> {
	return new Promise((resolve, reject) => {
		try {
			const ifaces = networkInterfaces();
			for (let name in ifaces) {
				const networkInterface = ifaces[name];
				if (networkInterface) {
					for (const { mac } of networkInterface) {
						if (validateMacAddress(mac)) {
							return resolve(mac);
						}
					}
				}
			}

			reject('Unable to retrieve mac address (unexpected format)');
		} catch (err) {
			reject(err);
		}
	});
}
