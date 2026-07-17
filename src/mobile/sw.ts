// App-shell cache only — never caches API/token traffic.
// Typed with minimal local declarations because this file compiles inside the DOM-lib
// tsconfig and lib.webworker cannot be mixed into the same program.
export {}

const CACHE = 'mc-shell-v1'

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  respondWith(response: Promise<Response> | Response): void
}

interface SwScope {
  location: Location
  addEventListener(type: 'install', listener: (e: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (e: FetchEvent) => void): void
}

const self_ = self as unknown as SwScope

self_.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])))
})

self_.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Never cache cross-origin requests.
  if (url.origin !== self_.location.origin) return
  e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request)))
})
