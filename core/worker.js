/**
 * src/core/worker.js
 * 背景算力核心 (The Number Cruncher)
 * 
 * @description 運行於 Web Worker 環境，負責繁重的資料處理任務：
 * 1. HotIndexBuilder: 遍歷 IDB 建立搜尋用的輕量索引。
 * 2. IntegrityChecker: 檢查資料結構完整性。
 * 
 * @note 此檔案不能存取 DOM (window, document)，且擁有獨立的 IDB 連線。
 */

const DB_NAME = 'LocalFirstDB';
const DB_VERSION = 63;

/**
 * 輕量級 IDB 讀取器 (Worker 專用)
 */
class RawDBReader {
    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getAll(storeName) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

const dbReader = new RawDBReader();

/**
 * 雙索引建構器 (Dual Index Builder)
 * 掃描 customers (Hot) 與 archived (Cold)
 */
async function buildHotIndex() {
    try {
        //  階段回報：開始讀取
        self.postMessage({ type: 'PROGRESS', payload: 10 });

        const [customers, archived] = await Promise.all([
            dbReader.getAll('customers'),
            dbReader.getAll('archived')
        ]);

        self.postMessage({ type: 'PROGRESS', payload: 50 });

        //  1. 建構系統熱索引 (System Hot Index)
        const activeCustomers = customers.filter(c => !c._deleted);
        const hotIndex = activeCustomers.map(c => {
            //  擴充欄位: nn (Nickname), c (Contacts), vc (VisitCount), ca (CreatedAt)
            const contacts = [c.phone, c.email, c.lineId].filter(Boolean).join(' ');
            return {
                id: c.id,
                n: c.name || '',
                nn: c.info?.nickname || '',
                c: contacts,
                t: c.tags || [],
                u: c.updatedAt || '',
                lv: c.lastVisit || '',
                vc: c.visitCount || 0,
                ca: c.createdAt || '',
                s: (c.name || '') + ' ' + (c.info?.nickname || '') + ' ' + contacts + ' ' + (c.phone || '')
            };
        });

        //  2. 建構封存冷索引 (Archived Cold Index)
        const coldIndex = archived.map(c => ({
            id: c.id, // Keep original ID for re-import logic
            n: c.name || '',
            c: [c.phone, c.email].filter(Boolean).join(' '), // Simplified contacts
            lastSeen: c.archivedAt || ''
        }));

        self.postMessage({ type: 'PROGRESS', payload: 90 });

        self.postMessage({
            type: 'INDEX_BUILT',
            payload: { hot: hotIndex, cold: coldIndex }
        });
    }
}

/**
 * 完整性檢查器 (IntegrityChecker)
 * 檢查是否有孤兒病歷 (Record 指向不存在的 Customer)
 */
async function checkIntegrity() {
    try {
        const [customers, records] = await Promise.all([
            dbReader.getAll('customers'),
            dbReader.getAll('records')
        ]);

        const customerIds = new Set(customers.map(c => c.id));
        const orphans = records.filter(r => !r._deleted && !customerIds.has(r.customerId));

        self.postMessage({
            type: 'INTEGRITY_CHECK_RESULT',
            payload: {
                orphanCount: orphans.length,
                orphanIds: orphans.map(r => r.id)
            }
        });
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            payload: `Integrity Check Failed: ${error.message}`
        });
    }
}

// 訊息分派器 (TaskDispatcher)
self.onmessage = async (e) => {
    const { type } = e.data;

    switch (type) {
        case 'BUILD_INDEX':
            await buildHotIndex();
            break;
        case 'CHECK_INTEGRITY':
            await checkIntegrity();
            break;
        default:
            console.warn('[Worker] Unknown message type:', type);
    }
};