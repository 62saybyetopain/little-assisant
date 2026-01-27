/**
 * src/core/db.js
 * 儲存引擎核心 (The Storage Monolith)
 * 
 * @description 
 * 負責 IndexedDB 的底層操作，包含 Schema 管理、連線池、以及 ACID 交易控制。
 * 實作了 "Soft Delete" 與 "Ephemeral Gate" 安全機制。
 */

import { StorageKeys, EventTypes, ErrorCodes, APP_NAMESPACE, CURRENT_SCHEMA_VERSION } from '../config.js';
import { EventBus, ErrorHandler, UUID } from './utils.js';
import { storageLock } from './lock.js';

const DB_VERSION = 63; // v6.3

/**
 * [Layer 2] 快取管理器 (CacheManager)
 * 負責 LocalStorage 的命名空間隔離與存取
 */
class CacheManager {
    constructor() {
        this.prefix = APP_NAMESPACE;
    }

    _getKey(key) {
        return `${this.prefix}${key}`;
    }

    set(key, value) {
        try {
            const serialized = JSON.stringify(value);
            localStorage.setItem(this._getKey(key), serialized);
        } catch (e) {
            // LocalStorage Full Handling
            if (e.name === 'QuotaExceededError') {
                EventBus.emit(EventTypes.SYSTEM.QUOTA_WARN, { source: 'LocalStorage' });
                this.smartClear(); // 嘗試清理舊快取
            }
        }
    }

    get(key) {
        try {
            const item = localStorage.getItem(this._getKey(key));
            return item ? JSON.parse(item) : null;
        } catch (e) {
            return null;
        }
    }

    remove(key) {
        localStorage.removeItem(this._getKey(key));
    }

    /**
     * 智慧清除：僅清除本應用程式命名空間下的資料
     */
    smartClear() {
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(this.prefix)) {
                localStorage.removeItem(k);
            }
        });
    }
}

/**
 * 資料遷移管理器 (MigrationManager)
 * 實作「讀取時遷移 (Read-time Migration)」
 */
const MigrationManager = {
    /**
     * 檢查並遷移資料結構
     * @param {Object} data - 從 DB 讀出的原始資料
     * @param {string} storeName 
     * @returns {Object} 遷移後的資料
     */
    process(data, storeName) {
        if (!data) return data;

        // 若資料無 schema 版本標記，視為 legacy (v0)
        const dataVersion = data._schema || "0.0";

        if (dataVersion === CURRENT_SCHEMA_VERSION) {
            return data;
        }

        // 遷移邏輯 (範例：v6.2 -> v6.3)
        // 實際專案中這裡會有一系列的 if (version < '6.3') { upgrade... }
        let migrated = { ...data };

        // 範例：確保所有 Record 都有 tags 陣列
        if (storeName === StorageKeys.RECORDS) {
            if (!migrated.tags) migrated.tags = [];
            // 標記新版本
            migrated._schema = CURRENT_SCHEMA_VERSION;
        }

        // 非同步寫回 DB (背景更新，不阻塞回傳)
        // 注意：這裡不等待寫入完成
        if (migrated !== data) {
            storageManager.put(storeName, migrated).catch(err => {
                console.warn('[Migration] Background update failed:', err);
            });
        }

        return migrated;
    }
};

/**
 * IndexedDB 底層封裝 (Private)
 */
class IDBWrapper {
    constructor() {
        this.db = null;
        this.pendingOpen = null;
    }

    async open() {
        if (this.db) return this.db;
        if (this.pendingOpen) return this.pendingOpen;

        this.pendingOpen = new Promise((resolve, reject) => {
            const request = indexedDB.open('LocalFirstDB', DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                this._handleUpgrade(db, transaction);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.db.onversionchange = () => {
                    this.db.close();
                    this.db = null;
                    ErrorHandler.handle(new Error('Database version changed. Reloading...'), { type: 'VersionChange' });
                };
                resolve(this.db);
            };

            request.onerror = (event) => reject(new Error(`IDB Open Error: ${event.target.error}`));
        });

        try {
            return await this.pendingOpen;
        } finally {
            this.pendingOpen = null;
        }
    }

    _handleUpgrade(db, transaction) {
        const stores = [
            { name: StorageKeys.CUSTOMERS, indexes: ['updatedAt', 'name'] },
            { name: StorageKeys.RECORDS,   indexes: ['updatedAt', 'customerId', 'status'] },
            { name: StorageKeys.TAGS,      indexes: ['updatedAt'] },
            { name: StorageKeys.TEMPLATES, indexes: ['updatedAt'] },
            { name: StorageKeys.DRAFTS,    indexes: ['updatedAt', 'relatedId'] },
            { name: StorageKeys.ARCHIVED,  indexes: ['updatedAt', 'originalStore'] },
            { name: StorageKeys.META,      indexes: [] }
        ];

        stores.forEach(({ name, indexes }) => {
            let store;
            if (!db.objectStoreNames.contains(name)) {
                store = db.createObjectStore(name, { keyPath: 'id' });
            } else {
                store = transaction.objectStore(name);
            }
            indexes.forEach(idx => {
                if (!store.indexNames.contains(idx)) {
                    store.createIndex(idx, idx, { unique: false });
                }
            });
        });
    }
}

/**
 * 儲存管理器 (Facade)
 */
class StorageManager {
    constructor() {
        this.adapter = new IDBWrapper();
        this.cache = new CacheManager(); // [Fix] 整合 Layer 2
        this.isEphemeral = false; // 預設為持久化模式
    }

    async init() {
        try {
            await this.adapter.open();
            EventBus.emit(EventTypes.SYSTEM.READY, { source: 'StorageManager' });
        } catch (error) {
            ErrorHandler.handle(error, { code: ErrorCodes.STR_001 });
            throw error;
        }
    }

    /**
     * 設定無痕模式 (Ephemeral Gate)
     * @param {boolean} isEphemeral 
     */
    setEphemeralMode(isEphemeral) {
        this.isEphemeral = isEphemeral;
        if (isEphemeral) {
            console.warn('[StorageManager] Ephemeral Mode Activated. Writes are disabled.');
        }
    }

    /**
     * 執行原子交易 (ACID Core)
     * 整合 Cross-Tab Lock 防止競態條件
     * @param {string[]} storeNames - 涉及的 Store 列表
     * @param {string} mode - 'readonly' | 'readwrite'
     * @param {Function} callback - (txContext) => Promise<T>
     * @returns {Promise<T>}
     */
    async runTransaction(storeNames, mode, callback) {
        // 1. Ephemeral Gate Check
        if (mode === 'readwrite' && this.isEphemeral) {
            throw new Error('EPHEMERAL_MODE_RESTRICTION: Write operations are disabled in Incognito mode.');
        }

        // 2. Cross-Tab Lock Acquisition (Critical for Data Integrity)
        // 針對讀寫交易進行鎖定，唯讀交易可視情況跳過鎖定以提升效能，但為確保一致性，建議統一管理。
        // 這裡採用全面鎖定策略以確保 ACID。
        return storageLock.acquire(async () => {
            const db = await this.adapter.open();

            return new Promise((resolve, reject) => {
                // 3. Start Transaction
                const tx = db.transaction(storeNames, mode);
                
                // 4. Create Transaction Context (Proxy)
                // 這個 Context 提供與 StorageManager 類似的 API，但直接操作當前 tx
                const txContext = {
                    get: (store, id) => this._wrapRequest(tx.objectStore(store).get(id)),
                    getAll: (store) => this._wrapRequest(tx.objectStore(store).getAll()),
                    put: (store, data) => {
                        // Internal Put Logic (Validation/Timestamp)
                        if (!data.id) data.id = UUID();
                        const now = new Date().toISOString();

                        //  Schema Enforcement (Write-time)
                        // 1. 若資料無 _schema，自動標記為當前版本 (視為新資料)
                        // 2. 若資料有 _schema 但版本不符，拋出錯誤 (嚴格模式，要求先經由 MigrationManager 升級)
                        if (!data._schema) {
                            data._schema = CURRENT_SCHEMA_VERSION;
                        } else if (data._schema !== CURRENT_SCHEMA_VERSION) {
                            // 允許 system_meta 或特定 store 豁免，或嚴格執行
                            if (store !== StorageKeys.META) {
                                console.error(`[DB] Schema Mismatch: Expected ${CURRENT_SCHEMA_VERSION}, got ${data._schema}`);
                                throw new Error(`SCHEMA_VERSION_MISMATCH: Data version ${data._schema} is outdated.`);
                            }
                        }

                        const payload = { 
                            ...data, 
                            updatedAt: now, 
                            createdAt: data.createdAt || now, 
                            _deleted: false 
                        };
                        return this._wrapRequest(tx.objectStore(store).put(payload)).then(() => payload);
                    },

                    delete: (store, id) => {
                        // Soft Delete Logic inside TX
                        return this._wrapRequest(tx.objectStore(store).get(id)).then(existing => {
                            if (!existing) return;
                            const payload = { ...existing, updatedAt: new Date().toISOString(), _deleted: true };
                            return this._wrapRequest(tx.objectStore(store).put(payload));
                        });
                    },
                    query: (store, index, range) => this._wrapRequest(tx.objectStore(store).index(index).getAll(range))
                };

                // 5. Execute Callback
                let result;
                Promise.resolve(callback(txContext))
                    .then(res => {
                        result = res;
                        // Transaction commits automatically when microtasks empty
                    })
                    .catch(err => {
                        // Manually abort on logic error to ensure rollback
                        // Check if transaction is still active before aborting
                        if (tx.error === null) { 
                             tx.abort();
                        }
                        reject(err);
                    });

                tx.oncomplete = () => resolve(result);
                tx.onerror = (e) => reject(e.target.error);
                tx.onabort = () => reject(new Error('Transaction Aborted'));
            });
        });
    }

    _wrapRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // --- Legacy/Single Operation Wrappers (Forward to runTransaction) ---
    
    /**
     * 單筆寫入
     * @param {string} storeName 
     * @param {Object} data 
     * @param {Object} options - { source: 'Local' | 'Remote' }
     */
    async put(storeName, data, options = {}) {
        return this.runTransaction([storeName], 'readwrite', async (tx) => {
            return await tx.put(storeName, data);
        }).then(res => {
            // 根據 options.source 發送事件，支援回音消除
            EventBus.emit(
                res.createdAt === res.updatedAt ? EventTypes.DATA.CREATED : EventTypes.DATA.UPDATED, 
                { store: storeName, data: res, source: options.source }
            );
            return res;
        });
    }

    async get(storeName, id) {
        const res = await this.runTransaction([storeName], 'readonly', tx => tx.get(storeName, id));
        if (res && res._deleted) return null;
        
        // 讀取時遷移 (Read-time Migration)
        // 檢查版本並動態升級結構，確保 UI 層總是拿到最新 Schema
        return MigrationManager.process(res, storeName);
    }

    async getAll(storeName) {
        const res = await this.runTransaction([storeName], 'readonly', tx => tx.getAll(storeName));
        return res.filter(item => !item._deleted);
    }

    async delete(storeName, id, options = {}) {
        return this.runTransaction([storeName], 'readwrite', async (tx) => {
            await tx.delete(storeName, id);
        }).then(() => {
            EventBus.emit(EventTypes.DATA.DELETED, { store: storeName, id, source: options.source });
        });
    }

    async query(storeName, indexName, range) {
        const res = await this.runTransaction([storeName], 'readonly', tx => tx.query(storeName, indexName, range));
        return res.filter(item => !item._deleted);
    }

    /**
     * [New] 危險操作：清空所有資料庫 (用於 P2P 鏡像同步/工廠重置)
     * @returns {Promise<void>}
     */
    async clearAll() {
        const stores = [
            StorageKeys.CUSTOMERS, StorageKeys.RECORDS, StorageKeys.TAGS, 
            StorageKeys.TEMPLATES, StorageKeys.DRAFTS, StorageKeys.ARCHIVED, StorageKeys.META
        ];
        
        return this.runTransaction(stores, 'readwrite', async (tx) => {
            // 在同一交易中清空所有 Store
            await Promise.all(stores.map(store => {
                return this._wrapRequest(tx.objectStore(store).clear());
            }));
        });
    }
}
}
export const storageManager = new StorageManager();