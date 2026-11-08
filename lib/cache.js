/**
 * lib/cache.js — Caché en memoria con TTL y tope de entradas (FIFO).
 *
 * Se usa en el servidor para el lector (páginas ya extraídas) y para las
 * respuestas de GNews, de modo que todos los visitantes compartan la misma
 * respuesta y la cuota diaria (100 requests) rinda mucho más. En Vercel la
 * caché es por instancia de la función.
 */
function makeTtlCache(ttlMs, maxEntries, now = Date.now) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (now() - hit.ts > ttlMs) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      if (!store.has(key) && store.size >= maxEntries) {
        store.delete(store.keys().next().value);
      }
      store.set(key, { ts: now(), value });
    },
    get size() {
      return store.size;
    },
  };
}

module.exports = { makeTtlCache };
