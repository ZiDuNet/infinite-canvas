export type IndexedDbStoreUsage = { name: string; records: number; bytes: number };
export type IndexedDbDatabaseUsage = { name: string; version: number; bytes: number; stores: IndexedDbStoreUsage[] };
export type LocalStorageUsage = { usage: number; quota: number; contentBytes: number; databases: IndexedDbDatabaseUsage[] };

const DATABASE_NAME = "infinite-canvas";

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
    const [estimate, database] = await Promise.all([navigator.storage.estimate(), readDatabaseUsage(DATABASE_NAME)]);
    return { usage: estimate.usage!, quota: estimate.quota!, contentBytes: database.bytes, databases: [database] };
}

export async function clearLocalStorageStore(databaseName: string, storeName: string) {
    const database = await openDatabase(databaseName);
    if (!database.objectStoreNames.contains(storeName)) {
        database.close();
        return;
    }
    await clearObjectStores(database, [storeName]);
    database.close();
}

export async function clearAllLocalStorage(databaseName: string) {
    const database = await openDatabase(databaseName);
    await clearObjectStores(database, Array.from(database.objectStoreNames));
    database.close();
}

function openDatabase(name: string) {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

function clearObjectStores(database: IDBDatabase, storeNames: string[]) {
    if (!storeNames.length) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeNames, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("清空本地存储事务已中止"));
        storeNames.forEach((storeName) => transaction.objectStore(storeName).clear());
    });
}

function readDatabaseUsage(name: string) {
    return openDatabase(name).then((database) => {
        return new Promise<IndexedDbDatabaseUsage>((resolve, reject) => {
            const names = Array.from(database.objectStoreNames);
            if (!names.length) {
                database.close();
                resolve({ name, version: database.version, bytes: 0, stores: [] });
                return;
            }
            const transaction = database.transaction(names, "readonly");
            Promise.all(names.map((storeName) => readStoreUsage(transaction.objectStore(storeName))))
                .then((stores) => resolve({ name, version: database.version, bytes: stores.reduce((total, store) => total + store.bytes, 0), stores: stores.sort((a, b) => b.bytes - a.bytes) }))
                .catch(reject)
                .finally(() => database.close());
        });
    });
}

function readStoreUsage(store: IDBObjectStore) {
    return new Promise<IndexedDbStoreUsage>((resolve, reject) => {
        let records = 0;
        let bytes = 0;
        const request = store.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve({ name: store.name, records, bytes });
                return;
            }
            records += 1;
            bytes += valueBytes(cursor.value);
            cursor.continue();
        };
    });
}

function valueBytes(value: unknown) {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}
