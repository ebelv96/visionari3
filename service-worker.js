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

  // La pagina HTML principale (navigazione diretta, es. apertura/refresh dell'app)
  // riceve un controllo extra: se la copia scaricata dalla rete risulta diversa da
  // quella già in cache, avvisiamo i tab aperti così possono ricaricarsi da soli
  // una volta sola, senza dover pulire manualmente la cache per vedere l'update.
  var isDocumentRequest = req.mode === 'navigate' || req.destination === 'document';

  event.respondWith(
    caches.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var resForCache = res.clone();
          var resForDiff = isDocumentRequest ? res.clone() : null;
          caches.open(CACHE_NAME).then(function(cache) {
            if (isDocumentRequest && cached) {
              // Confronta il testo vecchio (già in cache) col nuovo appena scaricato,
              // PRIMA di sovrascrivere la cache, per sapere se è davvero cambiato qualcosa.
              Promise.all([cached.clone().text(), resForDiff.text()]).then(function(pair){
                var changed = pair[0] !== pair[1];
                cache.put(req, resForCache);
                if (changed) {
                  self.clients.matchAll().then(function(clientsList){
                    clientsList.forEach(function(c){
                      c.postMessage({ type: 'VISIONARI_UPDATE_AVAILABLE' });
                    });
                  });
                }
              });
            } else {
              cache.put(req, resForCache);
            }
          });
        }
        return res;
      }).catch(function(){ return cached; });
      // Cache-first: se abbiamo una versione in cache la serviamo subito,
      // e aggiorniamo la cache in background per la prossima visita.
      return cached || networkFetch;
    })
  );
});
