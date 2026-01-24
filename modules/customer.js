/**
 * src/modules/customer.js
 * 顧客管理模組 (The Customer Domain)
 * 
 * @description 負責顧客資料的 CRUD、標籤管理以及與病歷的關聯維護。
 * 支援 ACID 交易傳遞。
 */

import { StorageKeys, EventTypes, ErrorCodes, TagColorMap, AnatomyConfig } from '../config.js';
import { storageManager } from '../core/db.js';
import { EventBus, UUID } from '../core/utils.js';

/**
 * 標籤管理器 (Internal Helper)
 */
class TagManager {
    /**
     * 更新標籤使用計數
     * @param {string[]} newTags 
     * @param {string[]} oldTags 
     * @param {Object} [tx] - Optional transaction context
     */
    async syncTags(newTags = [], oldTags = [], tx = null) {
        const added = newTags.filter(t => !oldTags.includes(t));
        const removed = oldTags.filter(t => !newTags.includes(t));

        // Helper: Use provided TX or start a new one
        const execute = (op) => tx ? op(tx) : storageManager.runTransaction([StorageKeys.TAGS], 'readwrite', op);

        for (const tagName of added) {
            await this._updateTagCount(tagName, 1, execute);
        }

        for (const tagName of removed) {
            await this._updateTagCount(tagName, -1, execute);
        }
    }

    async _updateTagCount(tagName, delta, execute) {
        await execute(async (ctx) => {
            // 假設 ID 就是 tagName
            const id = tagName;
            const existing = await ctx.get(StorageKeys.TAGS, id);

            if (existing) {
                const newCount = (existing.count || 0) + delta;
                await ctx.put(StorageKeys.TAGS, { 
                    ...existing, 
                    count: Math.max(0, newCount) 
                });
            } else if (delta > 0) {
                await ctx.put(StorageKeys.TAGS, {
                    id: id,
                    name: tagName,
                    count: 1,
                    // [Fix] 使用增強版顏色判定邏輯 (Hybrid Strategy)
                    color: this._determineColor(tagName)
                });
            }
        });
    }

    /**
     * 標籤顏色判定邏輯 (Hybrid Strategy)
     * 優先順序：設定檔 > 症狀 > 解剖性質 > 部位 > 雜湊
     * 設計目的：提升 UI 語意識別度，讓同部位/同性質肌群呈現協調色系
     */
    _determineColor(tagName) {
        // 1. 設定檔精確定義優先 (Config Exact Match)
        if (TagColorMap[tagName]) return TagColorMap[tagName];

        const lower = tagName.toLowerCase();

        // 2. 症狀與緊急性 (Symptoms - Red/Alert Spectrum)
        // 這些標籤需要最搶眼，故優先處理
        if (lower.match(/(pain|ache|emergency|痛|酸|麻|急|發炎)/)) {
            return 'hsl(0, 90%, 60%)'; // Bright Red
        }

        // 3. 方位與側邊 (Direction - Neutral Blue/Grey)
        // 用於輔助標示，顏色不宜過重，避免搶走解剖標籤的焦點
        if (lower.match(/^(left|right|upper|lower|左|右|上|下)$/)) {
            return 'hsl(210, 50%, 70%)'; // Soft Blue
        }

        // 4. 解剖肌群與部位邏輯 (Anatomy & Muscles)
        // 依賴 config.js 定義的 AnatomyConfig 靜態知識庫
        const { Regions, MuscleDatabase, Nature } = AnatomyConfig;

        // 4A. 查表：是否為已知肌群 (Muscle Database Lookup)
        // 核心邏輯：依據肌群名稱模糊匹配，取得部位色相與 PHASIC/TONIC 性質
        const knownMuscle = Object.keys(MuscleDatabase).find(m => lower.includes(m.toLowerCase()));
        
        if (knownMuscle) {
            const info = MuscleDatabase[knownMuscle];
            // 取得部位基礎色相 (若未定義則預設 0/紅色)
            const baseHue = Regions[info.region] || 0;
            // 取得肌群性質樣式 (若未定義則使用預設值)
            // PHASIC: 亮色, TONIC: 深色
            const style = Nature[info.type] || { s: 80, l: 50 };
            
            return `hsl(${baseHue}, ${style.s}%, ${style.l}%)`;
        }

        // 4B. 關鍵字：是否包含部位名稱 (Region Keyword Lookup)
        // 若不在詳細肌群庫中，但標籤包含 "肩膀"，則沿用肩部的色相
        const regionKey = Object.keys(Regions).find(r => lower.includes(r.toLowerCase()));
        if (regionKey) {
            const hue = Regions[regionKey];
            // 使用高飽和度中等亮度，確保可讀性並與特定肌群區隔
            return `hsl(${hue}, 85%, 45%)`;
        }

        // 5. 雜湊兜底 (Fallback Hash)
        // 若完全無法識別，則使用雜湊演算法確保固定顏色
        return this._generateHashColor(tagName);
    }

    _generateHashColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 70%, 45%)`;
    }

    async getAll() {
        return await storageManager.getAll(StorageKeys.TAGS);
    }

    /**
     * [Fix] 標籤刪除策略
     * @param {string} tagId 
     * @param {string} strategy 'SOFT' | 'HARD'
     * @returns {Promise<Object>} result
     */
    async delete(tagId, strategy = 'SOFT') {
        return await storageManager.runTransaction([StorageKeys.TAGS, StorageKeys.RECORDS], 'readwrite', async (tx) => {
            const tag = await tx.get(StorageKeys.TAGS, tagId);
            if (!tag) throw new Error('Tag not found');

            // 1. 引用檢查 (Reference Check)
            // 由於 IDB 沒有 JOIN，需掃描 Records (這在大量資料下可能慢，但刪除操作頻率低)
            // 優化：若 Tag 物件本身維護 count，可直接信賴 count (前提是 syncTags 邏輯嚴謹)
            const refCount = tag.count || 0;

            if (refCount > 0) {
                if (strategy === 'HARD') {
                    throw new Error(`Cannot hard delete tag "${tag.name}" because it is used by ${refCount} records. Please use Soft Delete (Archive).`);
                }
                
                // Soft Delete: 標記為 inactive，保留資料但隱藏於選單
                const updated = { ...tag, status: 'inactive', updatedAt: new Date().toISOString() };
                await tx.put(StorageKeys.TAGS, updated);
                return { status: 'soft_deleted', msg: 'Tag archived' };
            } else {
                // Hard Delete: 無人引用，物理刪除
                await tx.delete(StorageKeys.TAGS, tagId);
                return { status: 'hard_deleted', msg: 'Tag removed permanently' };
            }
        });
    }
}

export const tagManager = new TagManager();

/**
 * 顧客管理器 (Singleton)
 */
class CustomerManager {
    async create(data) {
        if (!data.name) throw new Error(ErrorCodes.VAL_001);
        
        if (data.phone) {
            const duplicates = await this.findByPhone(data.phone);
            if (duplicates.length > 0) {
                console.warn('[CustomerManager] Potential duplicate phone number');
            }
        }

        const customer = {
            id: UUID(),
            name: data.name,
            phone: data.phone || '',
            tags: data.tags || [],
            note: data.note || '',
            info: data.info || {},
            lastVisit: null,
            visitCount: 0
        };

        await storageManager.put(StorageKeys.CUSTOMERS, customer);

        if (customer.tags.length > 0) {
            await tagManager.syncTags(customer.tags, []);
        }

        return customer;
    }

    async update(id, data) {
        // 這裡使用 runTransaction 確保更新與標籤同步的原子性
        return await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.TAGS], 'readwrite', async (tx) => {
            const current = await tx.get(StorageKeys.CUSTOMERS, id);
            if (!current) throw new Error(ErrorCodes.STR_004);

            if (data.tags) {
                await tagManager.syncTags(data.tags, current.tags, tx);
            }

            const updated = { ...current, ...data };
            await tx.put(StorageKeys.CUSTOMERS, updated);
            return updated;
        });
    }

    async delete(id) {
        return await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.TAGS], 'readwrite', async (tx) => {
            const current = await tx.get(StorageKeys.CUSTOMERS, id);
            if (current && current.tags) {
                await tagManager.syncTags([], current.tags, tx);
            }
            await tx.delete(StorageKeys.CUSTOMERS, id);
        });
    }

    async get(id) {
        return await storageManager.get(StorageKeys.CUSTOMERS, id);
    }

    async findByPhone(phone) {
        const all = await storageManager.getAll(StorageKeys.CUSTOMERS);
        return all.filter(c => c.phone === phone);
    }

    /**
     * 更新就診統計 (支援 Transaction)
     * @param {string} id 
     * @param {string} visitDate 
     * @param {Object} [tx] 
     */
    async updateVisitStats(id, visitDate, tx = null) {
        const op = async (ctx) => {
            const customer = await ctx.get(StorageKeys.CUSTOMERS, id);
            if (!customer) return;
            await ctx.put(StorageKeys.CUSTOMERS, {
                ...customer,
                lastVisit: visitDate,
                visitCount: (customer.visitCount || 0) + 1
            });
        };

        if (tx) {
            await op(tx);
        } else {
            await storageManager.runTransaction([StorageKeys.CUSTOMERS], 'readwrite', op);
        }
    }

    /**
     *  資料自癒：重新計算顧客統計數據
     * 當發現列表顯示次數與實際紀錄不符時呼叫
     * @param {string} customerId 
     */
    async recalculateStats(customerId) {
        await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.RECORDS], 'readwrite', async (tx) => {
            // 1. 獲取所有非刪除的病歷
            const index = tx.objectStore(StorageKeys.RECORDS).index('customerId');
            const request = index.getAll(customerId);
            
            const records = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            const validRecords = records.filter(r => !r._deleted && r.status === 'Finalized');
            
            // 2. 計算正確數值
            const count = validRecords.length;
            const lastVisit = count > 0 
                ? validRecords.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].updatedAt 
                : null;

            // 3. 更新顧客資料
            const customer = await tx.objectStore(StorageKeys.CUSTOMERS).get(customerId);
            if (customer) {
                const updated = { ...customer, visitCount: count, lastVisit: lastVisit };
                await tx.objectStore(StorageKeys.CUSTOMERS).put(updated);
                console.log(`[Self-Healing] Customer ${customerId} stats updated: ${count} visits.`);
            }
        });
    }
}

export const customerManager = new CustomerManager();