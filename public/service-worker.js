const CACHE_NAME = 'gym-capacity-v2'
const ASSETS_TO_PRECACHE = [
  '/manifest.webmanifest',
  '/favicon.ico',
]

function offlineResponse() {
  return new Response(
    `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0ea5a4" />
    <title>Keine Verbindung</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, system-ui, sans-serif;
        background: rgba(248, 250, 252, 0.95);
        color: #0f172a;
        backdrop-filter: blur(8px);
      }
      .card {
        width: min(100%, 28rem);
        margin: 1.5rem;
        padding: 2rem;
        border: 1px solid #e2e8f0;
        border-radius: 1.25rem;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.12);
        text-align: center;
      }
      .icon {
        width: 3rem;
        height: 3rem;
        margin: 0 auto 1rem;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        background: rgba(14, 165, 164, 0.12);
        color: #0f766e;
        font-size: 1.5rem;
        line-height: 1;
      }
      h1 { margin: 0 0 0.75rem; font-size: 1.75rem; line-height: 1.1; }
      p { margin: 0 0 1rem; color: #475569; line-height: 1.5; }
      .actions { margin-top: 1rem; display: flex; justify-content: center; }
      .btn {
        -webkit-appearance: none;
        appearance: none;
        border: 0;
        padding: 0.65rem 1.1rem;
        border-radius: 0.75rem;
        background: linear-gradient(180deg,#06b6d4,#0ea5a4);
        color: white;
        font-weight: 600;
        box-shadow: 0 8px 20px rgba(14,165,164,0.12);
        cursor: pointer;
        font-size: 1rem;
      }
      .btn:active { transform: translateY(1px); }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="icon">🦆</div>
      <h1>Keine Verbindung</h1>
      <p>Die App benötigt Live-Daten. Bitte stelle eine Internetverbindung her.</p>
      <div class="actions">
        <button id="reload" class="btn">Neu laden</button>
      </div>
    </main>
    <script>
      (function(){
        const reload = document.getElementById('reload')
        if (reload) reload.addEventListener('click', function(){
          try { location.reload() } catch(e) { location.href = '/' }
        })
      })()
    </script>
  </body>
</html>`,
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => offlineResponse())
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  )
})
