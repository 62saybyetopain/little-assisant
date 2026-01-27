/**
 * src/modules/customer.js
 * 顧客管理模組 (The Customer Domain)
 * 
 * @description 負責顧客資料的 CRUD、標籤管理以及與病歷的關聯維護。
* 支援 ACID 交易傳遞。
 */

// 確保引用新的 Config V2 物件 (BodyRegions, TissueStyles 等)
import { StorageKeys, EventTypes, ErrorCodes, BodyRegions, TissueStyles, TagPalettes, TagType } from '../config.js';
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
                // 自動建立標籤 (Implicit Creation via SyncTags)
                // 當從病歷介面直接輸入新標籤時觸發。
                // 由於缺乏詳細定義，此時只能給予預設類型與顏色。
                const defaultData = { name: tagName, type: TagType.PERSONAL };
                const color = this._resolveColor(defaultData);
                
                await ctx.put(StorageKeys.TAGS, {
                    id: id,
                    name: tagName,
                    type: TagType.PERSONAL, // 預設歸類
                    count: 1,
                    color: color,
                    updatedAt: new Date().toISOString()
                });
            }
        });
    }

    /**
     * 建立或更新標籤定義 (Explicit Creation)
     * 這是使用者在 UI 透過詳細表單建立標籤時呼叫的方法
     * @param {Object} tagData
     *  - name (string): 標籤名稱
     *  - type (string): TagType Enum
     *  - regionId (string, optional): 用於 ANATOMY
     *  - tissueId (string, optional): 用於 ANATOMY
     *  - paletteColor (string, optional): 用於 非解剖類，直接傳入 Hex Code
     */
    async saveTagDefinition(tagData) {
        // 1. 計算/決定最終顏色
        const color = this._resolveColor(tagData);

        // 2. 建構物件
        const tagRecord = {
            id: tagData.name, 
            name: tagData.name,
            type: tagData.type,
            
            // 解剖屬性
            region: tagData.regionId || null,
            tissue: tagData.tissueId || null,
            
            // 非解剖屬性 (直接存 Hex，因為是用戶選的)
            color: color, 
            
            // 系統屬性
            count: 0, // 初始計數，由 syncTags 維護
            updatedAt: new Date().toISOString()
        };

        // 3. 檢查是否存在以保留計數，否則視為新標籤
        const existing = await storageManager.get(StorageKeys.TAGS, tagRecord.id);
        if (existing) {
            tagRecord.count = existing.count || 0;
            tagRecord.createdAt = existing.createdAt || tagRecord.updatedAt;
        } else {
            tagRecord.createdAt = tagRecord.updatedAt;
        }

        // 4. 寫入
        await storageManager.put(StorageKeys.TAGS, tagRecord);
        return tagRecord;
    }

    /**
     * 顏色解析器 (Color Resolver)
     * 負責將標籤資料轉換為 CSS 顏色字串
     */
    _resolveColor(data) {
        // A. 解剖標籤：系統即時演算 (HSL)
        if (data.type === TagType.ANATOMY) {
            const region = BodyRegions[data.regionId] || BodyRegions.JOINT;
            const style = TissueStyles[data.tissueId] || { s: 80, l: 50 };
            
            return `hsl(${region.hue}, ${style.s}%, ${style.l}%)`;
        }
        
        // B. 其他標籤：直接使用前端傳來的選定色 (Hex)
        // 前端 UI 會根據 TagType 顯示對應的 TagPalettes 供用戶選擇
        if (data.paletteColor) {
            return data.paletteColor;
        }

        // C. 兜底邏輯 (Fallback)
        // 用於舊資料遷移或快速新增時的預設值
        return '#cbd5e1'; // 預設淺灰 (Slate-300)
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