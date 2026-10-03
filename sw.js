// Service worker: deixa o app abrir offline e mostra notificações.
const CACHE = 'liberte-tarefas-v16';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/google.js', 'js/sync.js', 'js/parser.js', 'js/event-map.js', 'js/config.js', 'js/notebook.js', 'js/projects.js', 'js/timeline.js', 'js/week.js', 'js/dashboard.js', 'js/recurrence.js', 'js/drag.js', 'js/templates.js', 'js/focus.js', 'js/ai-read.js', 'js/team.js', 'js/smart.js', 'equipe.html',
  'icons/icon-192-v2.png', 'icons/icon-512-v2.png', 'icons/favicon-64-v2.png', 'icons/apple-touch-icon-v2.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Compartilhar → Liberte (WhatsApp etc.): guarda texto e arquivos e abre o app para criar a tarefa.
const SHARE_CACHE = 'liberte-share';
async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open(SHARE_CACHE);
  const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size);
  const meta = {
    text: ['title', 'text', 'url'].map((k) => form.get(k)).filter(Boolean).join(' ').trim(),
    files: files.map((f, i) => ({ key: `share/file-${Date.now()}-${i}`, name: f.name, type: f.type })),
  };
  await Promise.all(files.map((f, i) => cache.put(meta.files[i].key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }))));
  const prev = await cache.match('share/meta').then((r) => (r ? r.json() : []));
  await cache.put('share/meta', new Response(JSON.stringify([...prev, meta])));
  return Response.redirect('./?shared=1', 303);
}

// Rede primeiro (sempre a versão mais nova); sem internet, usa o cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request).catch(() => Response.redirect('./', 303)));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(target);
    }),
  );
});
