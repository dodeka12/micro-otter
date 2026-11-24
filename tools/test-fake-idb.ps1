# test-fake-idb.ps1
# Verifies fake-indexeddb works by writing/reading a record.

$nodeScript = @"
import { indexedDB } from 'fake-indexeddb';

globalThis.indexedDB = indexedDB;

const req = indexedDB.open('fake-idb-smoke', 1);
req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });

req.onsuccess = () => {
  const db = req.result;
  const tx = db.transaction('items', 'readwrite');
  tx.objectStore('items').put({ id: 'one', value: 123 });
  tx.oncomplete = () => {
    const tx2 = db.transaction('items', 'readonly');
    tx2.objectStore('items').get('one').onsuccess = (ev) => {
      console.log('Fetched:', ev.target.result); // expect { id: 'one', value: 123 }
    };
  };
};
req.onerror = () => console.error('open failed', req.error);
"@

node --input-type=module -e $nodeScript
