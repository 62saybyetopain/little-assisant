/**
 * src/core/sync.js
 * 同步閘道 (The Connectivity Layer)
 * 
 * @description 負責 P2P 連線管理、資料清洗、衝突解決與隔離區管理。
 * 實現 Local-First 的 "Sync" 承諾，確保多裝置間的資料一致性。
 */

import { EventTypes, StorageKeys, DataSource, ErrorCodes } from '../config.js';
import { storageManager } from './db.js';
import { EventBus, SafeStringify, UUID, ErrorHandler } from './utils.js';
import { tagManager } from '../modules/customer.js';
import { draftManager } from '../modules/record.js'; // Import draftManager for Mirror check

/**
 * 同步模式列舉
 */
export const SyncMode = {
    MERGE: 'MERGE',   // 時間戳記合併 (預設)
    MIRROR: 'MIRROR', // 鏡像覆蓋 (Sender Wins)
    IMPORT: 'IMPORT'  // 檔案匯入 (三籃分析)
};

/**
 * 匯入管理器 (Importer)
 * 負責檔案解析、三籃分析與 Re-ID 策略
 */
class Importer {
    constructor() {
        this.reader = new FileReader();
    }

    /**
     * 讀取並解析 JSON 檔案
     * @param {File} file 
     * @returns {Promise<Object>}
     */
    async parseFile(file) {
        return new Promise((resolve, reject) => {
            this.reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    // 簡單驗證格式 (假設匯入格式為 { storeName: [items], ... })
                    if (!json || typeof json !== 'object') throw new Error('Invalid JSON format');
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            };
            this.reader.onerror = () => reject(new Error('File read failed'));
            this.reader.readAsText(file);
        });
    }

    /**
     * 三籃分析 (Three-Bucket Analysis)
     * @param {Object} importData - { customers: [], records: [], ... }
     * @returns {Promise<Object>} { new: [], update: [], conflict: [] }
     */
    async analyze(importData) {
        const buckets = { new: [], update: [], conflict: [] };
        
        // 遍歷所有 Store 的資料
        for (const [store, items] of Object.entries(importData)) {
            // 略過非標準 Store
            if (!Object.values(StorageKeys).includes(store)) continue;

            for (const item of items) {
                const local = await storageManager.get(store, item.id);
                const entry = { store, data: item, local };

                if (!local) {
                    buckets.new.push(entry);
                } else {
                    const localTime = new Date(local.updatedAt).getTime();
                    const remoteTime = new Date(item.updatedAt).getTime();
                    
                    if (remoteTime > localTime) {
                        buckets.update.push(entry);
                    } else if (localTime > remoteTime) {
                        // 本地較新，但在匯入情境下視為衝突 (因為檔案可能是舊備份)
                        // 若使用者想還原舊版，需人工確認
                        buckets.conflict.push(entry); 
                    } else {
                        // 時間相同或 Remote 較舊，通常忽略，但也可能歸類為 Conflict (Skip)
                        // 這裡簡化為忽略
                    }
                }
            }
        }
        return buckets;
    }

    /**
     * 執行 Re-ID 策略 (Keep Both)
     * 為衝突的顧客生成新 ID，並遞迴更新其關聯病歷的 FK
     * @param {Object} customerData 
     * @param {Array} allRecords - 匯入包中的所有病歷 (用於查找關聯)
     * @returns {Object} { customer: newCustomer, records: newRecords[] }
     */
    regenerateIdentity(customerData, allRecords = []) {
        const oldId = customerData.id;
        const newId = UUID();
        const now = new Date().toISOString();

        // 1. Deep Clone Customer & Assign New ID
        const newCustomer = JSON.parse(JSON.stringify(customerData));
        newCustomer.id = newId;
        newCustomer.name = `${newCustomer.name} (Copy)`; // 視覺區隔
        newCustomer.updatedAt = now;
        newCustomer.createdAt = now; // Reset creation time

        // 2. Find and Clone Related Records
        const newRelatedRecords = allRecords
            .filter(r => r.customerId === oldId)
            .map(r => {
                const newRecord = JSON.parse(JSON.stringify(r));
                newRecord.id = UUID(); // Record 也要新 ID
                newRecord.customerId = newId; // FK 更新
                newRecord.updatedAt = now;
                return newRecord;
            });

        return { customer: newCustomer, records: newRelatedRecords };
    }
}

// --- 1. Sanitizer (Logic: XSS Cleaning) ---
class Sanitizer {
    constructor() {
        this.parser = new DOMParser();
        this.allowedTags = ['b', 'i', 'u', 'em', 'strong', 'p', 'br', 'ul', 'li', 'span'];
        this.allowedAttrs = ['style', 'class'];
    }

    /**
     * 清洗資料物件 (Deep Clean)
     * @param {Object} data 
     * @returns {Object} Sanitized data
     */
    clean(data) {
        if (typeof data === 'string') return this._cleanString(data);
        if (typeof data === 'number' || typeof data === 'boolean' || data === null) return data;
        
        if (Array.isArray(data)) {
            return data.map(item => this.clean(item));
        }

        if (typeof data === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(data)) {
                // 防止原型鏈攻擊
                if (key === '__proto__' || key === 'constructor') continue;
                result[key] = this.clean(value);
            }
            return result;
        }

        return data;
    }

    _cleanString(str) {
        // 1. Parse HTML
        const doc = this.parser.parseFromString(str, 'text/html');
        const body = doc.body;

        // 2. Walk and strip
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
        const nodesToRemove = [];

        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!this.allowedTags.includes(node.tagName.toLowerCase())) {
                nodesToRemove.push(node);
            } else {
                // Strip attributes
                const attrs = Array.from(node.attributes);
                attrs.forEach(attr => {
                    if (!this.allowedAttrs.includes(attr.name)) {
                        node.removeAttribute(attr.name);
                    }
                    // Prevent javascript: protocol
                    if (attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:')) {
                        node.removeAttribute('href');
                    }
                });
            }
        }

        // Replace disallowed tags with their text content
        nodesToRemove.forEach(node => {
            const text = document.createTextNode(node.textContent);
            node.parentNode.replaceChild(text, node);
        });

        return body.innerHTML;
    }
}

const sanitizer = new Sanitizer();

// --- 2. Decision Engine (Logic: Conflict Resolution) ---
const ResolutionStrategy = {
    APPLY_REMOTE: 'APPLY_REMOTE',
    KEEP_LOCAL: 'KEEP_LOCAL',
    CONFLICT: 'CONFLICT', // 需要人工介入
    IGNORE: 'IGNORE'      // 資料相同或 Remote 較舊
};

class DecisionEngine {
    /**
     * 比較本地與遠端資料
     * @param {Object} localRecord 
     * @param {Object} remoteRecord 
     * @returns {string} ResolutionStrategy
     */
    compare(localRecord, remoteRecord) {
        if (!localRecord) return ResolutionStrategy.APPLY_REMOTE;

        const localTime = new Date(localRecord.updatedAt).getTime();
        const remoteTime = new Date(remoteRecord.updatedAt).getTime();

        // 1. 內容完全相同
        if (JSON.stringify(localRecord) === JSON.stringify(remoteRecord)) {
            return ResolutionStrategy.IGNORE;
        }

        // 2. Last-Write-Wins (LWW)
        // 容許 100ms 的時鐘偏差 (Clock Skew)
        const SKEW_TOLERANCE = 100;

        if (remoteTime > localTime + SKEW_TOLERANCE) {
            return ResolutionStrategy.APPLY_REMOTE;
        }

        if (localTime > remoteTime + SKEW_TOLERANCE) {
            return ResolutionStrategy.KEEP_LOCAL;
        }

        // 3. 時間極度接近但內容不同 -> 衝突
        return ResolutionStrategy.CONFLICT;
    }
}

const decisionEngine = new DecisionEngine();

// --- 3. Quarantine (Data: Inbox) ---
class Quarantine {
    constructor() {
        this.inbox = new Map(); // Key: UUID, Value: { store, data, peerId, strategy }
    }

    add(id, item) {
        this.inbox.set(id, item);
        EventBus.emit(EventTypes.SYNC.RECEIVED, { id, ...item });
    }

    get(id) {
        return this.inbox.get(id);
    }

    remove(id) {
        this.inbox.delete(id);
    }

    clear() {
        this.inbox.clear();
    }

    getAll() {
        return Array.from(this.inbox.entries()).map(([id, val]) => ({ id, ...val }));
    }
}

const quarantine = new Quarantine();

// --- 4. Peer Manager (Logic: WebRTC/Transport) ---
/**
 * 模擬 P2P 傳輸層
 * 在真實場景中，這裡會使用 RTCPeerConnection 與 Signaling Server。
 * 為了確保程式碼可執行 (No Stubbing)，這裡使用 BroadcastChannel 模擬區域網路內的 P2P。
 */
class PeerManager {
    constructor(gateway) {
        this.gateway = gateway;
        this.channel = new BroadcastChannel('local-first-sync-channel');
        this.peers = new Set();
        this.myId = UUID();
        
        // 自定義裝置名稱 (從 LocalStorage 讀取，預設為 ID 前4碼)
        this.deviceName = localStorage.getItem('device_name') || `Device-${this.myId.slice(0, 4)}`;
        
        // 單一連線鎖 (Connection Mutex)
        this.activePeer = null; 

        this._initListener();
    }

    _initListener() {
        this.channel.onmessage = (event) => {
            const { type, senderId, payload, timestamp, deviceName } = event.data;
            
            if (senderId === this.myId) return; // Ignore self

            switch (type) {
                case 'HELLO':
                    this._handleHello(senderId, timestamp, deviceName);
                    break;
                case 'HELLO_ACK':
                    this._handleHelloAck(senderId, timestamp, deviceName);
                    break;
                case 'REJECT':
                    if (senderId === this.activePeer) {
                        this._disconnectPeer(senderId, `Connection rejected: ${payload.reason}`);
                    }
                    break;
                case 'DATA_PUSH':
                    // 僅接收來自 Active Peer 的資料
                    if (this.activePeer === senderId) {
                        this.gateway.receive(payload.store, payload.data, senderId);
                    }
                    break;
            }
        };

        // Announce self (Broadcast)
        this.announce();
    }

    announce() {
        // 無痕模式阻擋 (Ephemeral Guard) - 入口端
        if (storageManager.isEphemeral) {
            console.warn('[PeerManager] Ephemeral mode active. Sync disabled.');
            return;
        }

        this.channel.postMessage({ 
            type: 'HELLO', 
            senderId: this.myId,
            timestamp: Date.now(),
            deviceName: this.deviceName
        });
    }

    _handleHello(peerId, remoteTime, remoteName) {
        // 1. 無痕模式檢查 (被動端)
        if (storageManager.isEphemeral) {
            this._sendReject(peerId, 'Target is in Incognito Mode');
            return;
        }

        // 2. 單一連線鎖檢查
        if (this.activePeer && this.activePeer !== peerId) {
            this._sendReject(peerId, 'Target is Busy (Another connection active)');
            return;
        }

        // 3. 時鐘偏差檢查 (Time Drift Check)
        if (!this._checkTimeDrift(remoteTime)) {
            this._sendReject(peerId, 'Time Drift too large (>60s). Check system clock.');
            return;
        }

        // 4. 接受連線並回覆 ACK
        this.activePeer = peerId;
        this.peers.add(peerId);
        
        // 回傳 ACK 以建立雙向確認
        this.channel.postMessage({
            type: 'HELLO_ACK',
            senderId: this.myId,
            timestamp: Date.now(),
            deviceName: this.deviceName
        });

        EventBus.emit(EventTypes.SYNC.CONNECTED, { peerId, deviceName: remoteName });
        import('./utils.js').then(({ Toast }) => Toast.show(`Connected to ${remoteName}`, 'success'));
    }

    _handleHelloAck(peerId, remoteTime, remoteName) {
        // 收到 ACK，確認對方已接受連線
        
        // 再次檢查時鐘 (雙向確認)
        if (!this._checkTimeDrift(remoteTime)) {
            this._disconnectPeer(peerId, 'Time Drift detected during ACK.');
            return;
        }

        if (!this.activePeer) {
            this.activePeer = peerId;
            this.peers.add(peerId);
            EventBus.emit(EventTypes.SYNC.CONNECTED, { peerId, deviceName: remoteName });
            import('./utils.js').then(({ Toast }) => Toast.show(`Connected to ${remoteName}`, 'success'));
        }
    }

    _checkTimeDrift(remoteTime) {
        const localTime = Date.now();
        const drift = Math.abs(localTime - remoteTime);
        // 容許 60 秒誤差
        return drift <= 60000;
    }

    _sendReject(targetPeerId, reason) {
        this.channel.postMessage({
            type: 'REJECT',
            senderId: this.myId,
            payload: { reason }
        });
    }

    _disconnectPeer(peerId, reason) {
        if (this.activePeer === peerId) {
            this.activePeer = null;
            this.peers.delete(peerId);
            EventBus.emit(EventTypes.SYNC.DISCONNECTED);
            if (reason) {
                import('./utils.js').then(({ Toast }) => Toast.show(reason, 'error'));
            }
        }
    }

    /**
     * 發送資料給 Active Peer
     */
    broadcast(store, data) {
        if (!this.activePeer) return;

        this.channel.postMessage({
            type: 'DATA_PUSH',
            senderId: this.myId,
            payload: { store, data }
        });
    }

    disconnect() {
        this.channel.close();
        this.peers.clear();
        this.activePeer = null;
        EventBus.emit(EventTypes.SYNC.DISCONNECTED);
    }
}

// --- 5. Sync Gateway (Facade) ---
class SyncGateway {
    constructor() {
        this.peerManager = null;
        this.importer = new Importer();
        this.isSyncing = false;
        this.mode = SyncMode.MERGE; // Default
        this.unsubscribes = [];
    }

    start() {
        if (this.isSyncing) return;

        this.peerManager = new PeerManager(this);
        this.isSyncing = true;

        const handleLocalChange = (event) => {
            if (event.source === DataSource.REMOTE) return;
            // 僅在 MERGE 模式下廣播變更
            if (this.mode === SyncMode.MERGE && event.store && event.data) {
                this.peerManager.broadcast(event.store, event.data);
            }
        };

        this.unsubscribes.push(EventBus.on(EventTypes.DATA.CREATED, handleLocalChange));
        this.unsubscribes.push(EventBus.on(EventTypes.DATA.UPDATED, handleLocalChange));
        this.unsubscribes.push(EventBus.on(EventTypes.DATA.DELETED, handleLocalChange));

        console.log('[SyncGateway] Started. Peer ID:', this.peerManager.myId);
    }

    stop() {
        if (this.peerManager) {
            this.peerManager.disconnect();
            this.peerManager = null;
        }
        this.unsubscribes.forEach(unsub => unsub());
        this.unsubscribes = [];
        this.isSyncing = false;
    }

    /**
     * 觸發檔案匯入流程
     * @param {File} file 
     * @returns {Promise<Object>} Analysis Buckets
     */
    async importFile(file) {
        this.mode = SyncMode.IMPORT;
        const data = await this.importer.parseFile(file);
        return await this.importer.analyze(data);
    }

    /**
     * 執行匯入決策 (Batch Execute)
     * @param {Array} decisions - [{ type: 'NEW'|'UPDATE'|'KEEP_BOTH', entry: {...} }]
     * @param {Object} rawData - 原始匯入資料 (用於 Re-ID 查找關聯)
     */
    async executeImport(decisions, rawData) {
        for (const decision of decisions) {
            const { type, entry } = decision;
            
            if (type === 'NEW' || type === 'UPDATE') {
                await this._applyRemote(entry.store, entry.data);
            } else if (type === 'KEEP_BOTH' && entry.store === StorageKeys.CUSTOMERS) {
                // 執行 Re-ID 策略
                const allRecords = rawData[StorageKeys.RECORDS] || [];
                const { customer, records } = this.importer.regenerateIdentity(entry.data, allRecords);
                
                // 寫入新顧客與新病歷
                await this._applyRemote(StorageKeys.CUSTOMERS, customer);
                for (const rec of records) {
                    await this._applyRemote(StorageKeys.RECORDS, rec);
                }
            }
        }
        this.mode = SyncMode.MERGE; // Reset mode
    }

    /**
     * 觸發鏡像同步 (Mirror Mode)
     * [Fix] 整合 StorageLock 與 UI Mask
     * @param {Object} payload - Full DB dump
     */
    async applyMirror(payload) {
        this.mode = SyncMode.MIRROR;
        
        // 1. Pre-flight Check: Drafts
        const drafts = await draftManager.getAll();
        if (drafts.length > 0) {
            throw new Error('Unsaved drafts detected. Mirror aborted.');
        }

        // [Fix] 傳輸鎖定與 UI 遮罩
        // 這裡使用 storageLock.acquire('p2p_sync') 確保寫入獨佔
        // 同時發送 UI 事件顯示遮罩
        import('./lock.js').then(({ storageLock }) => {
            storageLock.acquire(async () => {
                try {
                    // 顯示全螢幕遮罩
                    EventBus.emit(EventTypes.UI.MODAL, { 
                        type: 'LOADING', 
                        message: '🔄 Mirroring Data... Do not close window.' 
                    });

                    // 2. Clear Local DB
                    await storageManager.clearAll();

                    // 3. Bulk Write (Sender Wins)
                    for (const [store, items] of Object.entries(payload)) {
                        if (!Object.values(StorageKeys).includes(store)) continue;
                        
                        await storageManager.runTransaction([store], 'readwrite', async (tx) => {
                            for (const item of items) {
                                await tx.put(store, item);
                            }
                        });
                    }
                    
                    // 4. Reload
                    window.location.reload();

                } catch (error) {
                    ErrorHandler.handle(error, { context: 'Mirror Sync' });
                    // 隱藏遮罩 (透過發送關閉事件或 Reload)
                    EventBus.emit(EventTypes.UI.MODAL, { type: 'CLOSE' });
                }
            }, 30000); // 設定較長的 Timeout (30s) 給大量資料寫入
        });
    }

    async receive(storeName, rawData, peerId) {
        // ... (Receive logic remains largely same, but respects Mode)
        // 簡化：在 P2P Merge 模式下維持原邏輯
        if (this.mode !== SyncMode.MERGE) return;

        try {
            const data = sanitizer.clean(rawData);
            if (!data || !data.id) throw new Error('Invalid data structure');

            const localData = await storageManager.get(storeName, data.id);
            const strategy = decisionEngine.compare(localData, data);

            switch (strategy) {
                case ResolutionStrategy.APPLY_REMOTE:
                    await this._applyRemote(storeName, data);
                    break;
                case ResolutionStrategy.CONFLICT:
                    quarantine.add(data.id, { store: storeName, data, peerId, strategy });
                    EventBus.emit(EventTypes.SYNC.CONFLICT, { id: data.id, store: storeName });
                    break;
            }
        } catch (error) {
            ErrorHandler.handle(error, { context: 'SyncGateway.receive', peerId });
        }
    }

    /**
     * 寫入遠端資料
     * 包含 [Tag Guard] 防護邏輯
     */
    async _applyRemote(storeName, data) {
        // [Tag Guard] 標籤防護：本地存續優先
        // 若本地已有該標籤定義，則拒絕外部修改 (保持 UI 一致性)
        if (storeName === StorageKeys.TAGS) {
            const exists = await storageManager.get(StorageKeys.TAGS, data.id);
            if (exists) {
                console.warn(`[Sync] Tag Guard: Ignored remote update for tag "${data.name}"`);
                return; // 直接忽略
            }
        }

        const needsTagSync = (storeName === StorageKeys.CUSTOMERS || storeName === StorageKeys.RECORDS);
        const stores = [storeName];
        if (needsTagSync) stores.push(StorageKeys.TAGS);

        await storageManager.runTransaction(stores, 'readwrite', async (tx) => {
            if (needsTagSync) {
                const current = await tx.get(storeName, data.id);
                const oldTags = current ? (current.tags || []) : [];
                const newTags = data.tags || [];
                await tagManager.syncTags(newTags, oldTags, tx);
            }
            await tx.put(storeName, data);
        });

        EventBus.emit(EventTypes.DATA.UPDATED, { 
            store: storeName, 
            data: data, 
            source: DataSource.REMOTE 
        });
    }

    // ... (approve, reject, getInbox methods)
    async approve(id) {
        const item = quarantine.get(id);
        if (item) {
            await this._applyRemote(item.store, item.data);
            quarantine.remove(id);
        }
    }

    reject(id) {
        quarantine.remove(id);
    }

    getInbox() {
        return quarantine.getAll();
    }
}
export const syncGateway = new SyncGateway();