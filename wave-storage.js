/* Independent local experiments. Each advanced snapshot receives its own key. */
const WaveStorage = (() => {
  'use strict';
  let connection;
  function open() {
    if (!connection) connection = new Promise((resolve,reject) => {
      const request = indexedDB.open('lighttrace-wave-experiments',1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('experiments',{keyPath:'id'});
        store.createIndex('updated','updated');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return connection;
  }
  async function save(id, scene) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('experiments','readwrite');
      tx.objectStore('experiments').put({id,scene,updated:Date.now()});
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async function get(id) {
    const db = await open();
    return new Promise((resolve,reject) => {
      const req = db.transaction('experiments').objectStore('experiments').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function recent() {
    const db = await open();
    return new Promise((resolve,reject) => {
      const rows = [];
      const req = db.transaction('experiments').objectStore('experiments').index('updated').openCursor(null,'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || rows.length === 25) return resolve(rows);
        const {id,scene,updated} = cursor.value;
        rows.push({id,name:scene.name,updated});
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
  return {save,get,recent};
})();
