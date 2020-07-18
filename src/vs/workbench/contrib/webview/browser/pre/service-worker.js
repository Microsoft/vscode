/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference lib="webworker" />

const VERSION = 1;

const rootPath = self.location.pathname.replace(/\/service-worker.js$/, '');

/**
 * Root path for resources
 */
const resourceRoot = rootPath + '/vscode-resource';

const resolveTimeout = 30000;

/**
 * @template T
 * @typedef {{
 *     resolve: (x: T) => void,
 *     promise: Promise<T>
 * }} RequestStoreEntry
 */

/**
 * @template T
 */
class RequestStore {
	constructor() {
		/** @type {Map<string, RequestStoreEntry<T>>} */
		this.map = new Map();
	}

	/**
	 * @param {string} webviewId
	 * @param {string} path
	 * @return {Promise<T> | undefined}
	 */
	get(webviewId, path) {
		const entry = this.map.get(this._key(webviewId, path));
		return entry && entry.promise;
	}

	/**
	 * @param {string} webviewId
	 * @param {string} path
	 * @returns {Promise<T>}
	 */
	create(webviewId, path) {
		const existing = this.get(webviewId, path);
		if (existing) {
			return existing;
		}
		let resolve;
		const promise = new Promise(r => resolve = r);
		const entry = { resolve, promise };
		const key = this._key(webviewId, path);
		this.map.set(key, entry);

		const dispose = () => {
			clearTimeout(timeout);
			const existingEntry = this.map.get(key);
			if (existingEntry === entry) {
				return this.map.delete(key);
			}
		};
		const timeout = setTimeout(dispose, resolveTimeout);
		return promise;
	}

	/**
	 * @param {string} webviewId
	 * @param {string} path
	 * @param {T} result
	 * @return {boolean}
	 */
	resolve(webviewId, path, result) {
		const entry = this.map.get(this._key(webviewId, path));
		if (!entry) {
			return false;
		}
		entry.resolve(result);
		return true;
	}

	/**
	 * @param {string} webviewId
	 * @param {string} path
	 * @return {string}
	 */
	_key(webviewId, path) {
		return `${webviewId}@@@${path}`;
	}
}

/**
 * Map of requested paths to responses.
 *
 * @type {RequestStore<{ body: any, mime: string } | undefined>}
 */
const resourceRequestStore = new RequestStore();

/**
 * Map of requested localhost origins to optional redirects.
 *
 * @type {RequestStore<string | undefined>}
 */
const localhostRequestStore = new RequestStore();

const notFound = () =>
	new Response('Not Found', { status: 404, });

self.addEventListener('message', async (event) => {
	switch (event.data.channel) {
		case 'version':
			{
				self.clients.get(event.source.id).then(client => {
					if (client) {
						client.postMessage({
							channel: 'version',
							version: VERSION
						});
					}
				});
				return;
			}
		case 'did-load-resource':
			{
				const webviewId = getWebviewIdForClient(event.source);
				const data = event.data.data;
				const response = data.status === 200
					? { body: data.data, mime: data.mime }
					: undefined;

				if (!resourceRequestStore.resolve(webviewId, data.path, response)) {
					console.log('Could not resolve unknown resource', data.path);
				}
				return;
			}

		case 'did-load-localhost':
			{
				const webviewId = getWebviewIdForClient(event.source);
				const data = event.data.data;
				if (!localhostRequestStore.resolve(webviewId, data.origin, data.location)) {
					console.log('Could not resolve unknown localhost', data.origin);
				}
				return;
			}
	}

	console.log('Unknown message');
});

self.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);

	// See if it's a resource request
	if (requestUrl.origin === self.origin && requestUrl.pathname.startsWith(resourceRoot + '/')) {
		return event.respondWith(processResourceRequest(event, requestUrl));
	}

	// See if it's a localhost request
	if (requestUrl.origin !== self.origin && requestUrl.host.match(/^localhost:(\d+)$/)) {
		return event.respondWith(processLocalhostRequest(event, requestUrl));
	}
});

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim()); // Become available to all pages
});

async function processResourceRequest(event, requestUrl) {
	const client = await self.clients.get(event.clientId);
	if (!client) {
		console.log('Could not find inner client for request');
		return notFound();
	}

	const webviewId = getWebviewIdForClient(client);
	const resourcePath = requestUrl.pathname.startsWith(resourceRoot + '/') ? requestUrl.pathname.slice(resourceRoot.length) :  requestUrl.pathname;

	function resolveResourceEntry(entry) {
		if (!entry) {
			return notFound();
		}
		return new Response(entry.body, {
			status: 200,
			headers: { 'Content-Type': entry.mime }
		});
	}

	const parentClient = await getOuterIframeClient(webviewId);
	if (!parentClient) {
		console.log('Could not find parent client for request');
		return notFound();
	}

	// Check if we've already resolved this request
	const existing = resourceRequestStore.get(webviewId, resourcePath);
	if (existing) {
		return existing.then(resolveResourceEntry);
	}

	parentClient.postMessage({
		channel: 'load-resource',
		path: resourcePath
	});

	return resourceRequestStore.create(webviewId, resourcePath)
		.then(resolveResourceEntry);
}

/**
 * @param {*} event
 * @param {URL} requestUrl
 */
async function processLocalhostRequest(event, requestUrl) {
	const client = await self.clients.get(event.clientId);
	if (!client) {
		// This is expected when requesting resources on other localhost ports
		// that are not spawned by vs code
		return undefined;
	}
	const webviewId = getWebviewIdForClient(client);
	const origin = requestUrl.origin;

	const resolveRedirect = redirectOrigin => {
		if (!redirectOrigin) {
			return fetch(event.request);
		}
		const location = event.request.url.replace(new RegExp(`^${requestUrl.origin}(/|$)`), `${redirectOrigin}$1`);
		return new Response(null, {
			status: 302,
			headers: {
				Location: location
			}
		});
	};

	const parentClient = await getOuterIframeClient(webviewId);
	if (!parentClient) {
		console.log('Could not find parent client for request');
		return notFound();
	}

	// Check if we've already resolved this request
	const existing = localhostRequestStore.get(webviewId, origin);
	if (existing) {
		return existing.then(resolveRedirect);
	}

	parentClient.postMessage({
		channel: 'load-localhost',
		origin: origin
	});

	return localhostRequestStore.create(webviewId, origin)
		.then(resolveRedirect);
}

function getWebviewIdForClient(client) {
	const requesterClientUrl = new URL(client.url);
	return requesterClientUrl.search.match(/\bid=([a-z0-9-]+)/i)[1];
}

async function getOuterIframeClient(webviewId) {
	const allClients = await self.clients.matchAll({ includeUncontrolled: true });
	return allClients.find(client => {
		const clientUrl = new URL(client.url);
		return (clientUrl.pathname === `${rootPath}/` || clientUrl.pathname === `${rootPath}/index.html`) && clientUrl.search.match(new RegExp('\\bid=' + webviewId));
	});
}
