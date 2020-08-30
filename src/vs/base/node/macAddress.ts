/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec } from 'child_process';
import { isWindows } from 'vs/base/common/platform';

const cmdline = {
	windows: 'getmac.exe',
	unix: '/sbin/ifconfig -a || /sbin/ip link'
};

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
			exec(isWindows ? cmdline.windows : cmdline.unix, { timeout: 10000 }, (err, stdout, stdin) => {
				if (err) {
					return reject(`Unable to retrieve mac address (${err.toString()})`);
				} else {
					const regex = /(?:[a-f\d]{2}[:\-]){5}[a-f\d]{2}/gi;

					let match;
					while ((match = regex.exec(stdout)) !== null) {
						const macAddressCandidate = match[0];
						if (validateMacAddress(macAddressCandidate)) {
							return resolve(macAddressCandidate);
						}
					}

					return reject('Unable to retrieve mac address (unexpected format)');
				}
			});
		} catch (err) {
			reject(err);
		}
	});
}
