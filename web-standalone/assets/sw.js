importScripts('https://storage.googleapis.com/workbox-cdn/releases/4.3.1/workbox-sw.js');

workbox.setConfig({
  debug: false
});

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(self.clients.claim());
});

workbox.routing.registerRoute(
	/\.js$/,
	new workbox.strategies.StaleWhileRevalidate()
);
workbox.routing.registerRoute(
	/\.css$/,
	new workbox.strategies.StaleWhileRevalidate()
);
workbox.routing.registerRoute(
	/\.svg$/,
	new workbox.strategies.StaleWhileRevalidate()
);
