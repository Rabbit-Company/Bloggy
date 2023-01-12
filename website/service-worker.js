// This is the "Offline copy of pages" service worker

const CACHE = "pwa";

importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

self.addEventListener("message", (event) => {
	if (event.data && event.data.type === "SKIP_WAITING") {
		self.skipWaiting();
	}
});

workbox.routing.registerRoute(
  ({request, url}) => request.mode === 'navigate' && !url.pathname.startsWith('https://analytics'),
  new workbox.strategies.StaleWhileRevalidate({cacheName: CACHE})
);