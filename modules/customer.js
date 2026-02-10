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
    async syncTags(newTags = [], oldTags = [], tx = null) {
        const toIds = (tags) => tags.map(t => typeof t === 'object' ? t.tagId : t).filter(Boolean);
        const newIds = toIds(newTags);
        const oldIds = toIds(oldTags);
        const added = newIds.filter(t => !oldIds.includes(t));
        const removed = oldIds.filter(t => !newIds.includes(t));
        const execute = (op) => tx ? op(tx) : storageManager.runTransaction([StorageKeys.TAGS], 'readwrite', op);
        for (const tagName of added) await this._updateTagCount(tagName, 1, execute);
        for (const tagName of removed) await this._updateTagCount(tagName, -1, execute);
    }

    async _updateTagCount(tagName, delta, execute) {
        await execute(async (ctx) => {
            const existing = await ctx.get(StorageKeys.TAGS, tagName);
            if (existing) {
                await ctx.put(StorageKeys.TAGS, { 
                    ...existing, 
                    count: Math.max(0, (existing.count || 0) + delta),
                    updatedAt: new Date().toISOString()
                });
            } else if (delta > 0) {
                const color = this._resolveColor({ type: TagType.PERSONAL });
                await ctx.put(StorageKeys.TAGS, {
                    id: tagName, name: tagName, type: TagType.PERSONAL,
                    count: 1, color: color, updatedAt: new Date().toISOString()
                });
            }
        });
    }

    _resolveColor(data) {
        if (data.type === TagType.ANATOMY && data.regionId) {
            const region = BodyRegions[data.regionId] || { hue: 200 };
            const style = TissueStyles[data.tissueId] || { s: 80, l: 50 };
            return `hsl(${region.hue}, ${style.s}%, ${style.l}%)`;
        }
        return data.paletteColor || '#94a3b8';
    }

    async getAll() { return await storageManager.getAll(StorageKeys.TAGS); }
}
export const tagManager = new TagManager();

/**
 * 顧客管理器 (Singleton)
 *  整合生活脈絡、動態聯絡聚合與關鍵字，保留統計更新功能
 */
class CustomerManager {
    async create(data) {
        if (!data.name) throw new Error('VAL_001'); // 遵循 ErrorCodes 
        const customer = this._prepareCustomerObject(UUID(), data);
        await storageManager.put(StorageKeys.CUSTOMERS, customer);
        if (customer.tags.length > 0) await tagManager.syncTags(customer.tags, []);
        return customer;
    }

    async update(id, data) {
        return await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.TAGS], 'readwrite', async (tx) => {
            const current = await tx.get(StorageKeys.CUSTOMERS, id);
            if (!current) throw new Error('STR_004');
            
            if (data.tags) await tagManager.syncTags(data.tags, current.tags, tx);
            const updated = this._prepareCustomerObject(id, data, current);
            await tx.put(StorageKeys.CUSTOMERS, updated);
            return updated;
        });
    }

    // 核心重構：資料正規化處理
    _prepareCustomerObject(id, data, current = {}) {
        const cArray = (data.c || '').split(' ').filter(v => v.trim());
        return {
            ...current, id,
            name: data.name || current.name,
            phone: cArray[0] || current.phone || '', // 維護舊索引相容性
            c: data.c || current.c || '', 
            kw: data.kw || current.kw || '', // 手動關鍵字 (不含住處)
            tags: data.tags || current.tags || [], // 物件化結構 {tagId, remark}
            note: data.note || current.note || '',
            info: {
                ...(current.info || {}),
                address: data.address || current.info?.address || '',
                occupation: data.occupation || current.info?.occupation || '',
                interests: data.interests || current.info?.interests || ''
            },
            updatedAt: new Date().toISOString()
        };
    }

    // 就診統計更新方法 
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
        tx ? await op(tx) : await storageManager.runTransaction([StorageKeys.CUSTOMERS], 'readwrite', op);
    }

    // 自癒功能 
    async recalculateStats(customerId) {
        await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.RECORDS], 'readwrite', async (tx) => {
            const request = tx.objectStore(StorageKeys.RECORDS).index('customerId').getAll(customerId);
            const records = await new Promise((res) => request.onsuccess = () => res(request.result));
            const valid = records.filter(r => !r._deleted && r.status === 'Finalized');
            const customer = await tx.objectStore(StorageKeys.CUSTOMERS).get(customerId);
            if (customer) {
                await tx.objectStore(StorageKeys.CUSTOMERS).put({
                    ...customer,
                    visitCount: valid.length,
                    lastVisit: valid.length > 0 ? valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].updatedAt : null
                });
            }
        });
    }

    async get(id) { return await storageManager.get(StorageKeys.CUSTOMERS, id); }
    async delete(id) {
        return await storageManager.runTransaction([StorageKeys.CUSTOMERS, StorageKeys.TAGS], 'readwrite', async (tx) => {
            const current = await tx.get(StorageKeys.CUSTOMERS, id);
            if (current?.tags) await tagManager.syncTags([], current.tags, tx);
            await tx.delete(StorageKeys.CUSTOMERS, id);
        });
    }
}

export const customerManager = new CustomerManager();
