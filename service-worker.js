// Service Worker di Visionari 3.0
// Obiettivo: far aprire l'app istantaneamente (anche offline) mettendo in cache
// solo la "shell" statica (index.html, icone, manifest). I dati veri (prenotazioni,
// note, ecc.) restano sempre gestiti dalla logica JS di loadAllData()/localStorage
// dentro index.html, quindi qui NON tocchiamo le chiamate verso Google Sheets/Apps Script.

const CACHE_NAME = 'visionari3-shell-v1';
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_FILES);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;

  // Interveniamo SOLO su richieste GET dello stesso dominio (la shell statica).
  // Tutto il resto (Google Sheets, Apps Script, ecc, che sono cross-origin) passa
  // dritto in rete come sempre: qui non dobbiamo cambiare come vengono letti i dati.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  var isDocumentRequest = req.mode === 'navigate' || req.destination === 'document';

  if (isDocumentRequest) {
    // Network-first SOLO per la pagina principale: prova sempre la rete per prima,
    // così ogni apertura mostra automaticamente l'ultima versione pubblicata, senza
    // bisogno di pulire la cache a mano. Se sei offline, usa l'ultima copia in cache.
    event.respondWith(
      fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); });
        }
        return res;
      }).catch(function(){ return caches.match(req); })
    );
    return;
  }

  // Icone e manifest cambiano raramente: qui manteniamo cache-first per velocità.
  event.respondWith(
    caches.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var resClone = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, resClone); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});
