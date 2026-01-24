/**
 * src/modules/record.js
 * 病歷管理模組 (The Record Domain)
 * 
 * @description 包含病歷的 CRUD、狀態機流轉 (FSM)、草稿管理與模板合併邏輯。
 * 嚴格執行 Copy-on-Write 與 ACID 交易。
 */

import { StorageKeys, RecordStatus, EventTypes, ErrorCodes, DefaultTemplates } from '../config.js';
import { storageManager } from '../core/db.js';
import { EventBus, UUID } from '../core/utils.js';
import { customerManager, tagManager } from './customer.js';

/**
 * 模板管理器
 */
class TemplateManager {
    /**
     * 執行模板合併邏輯
     * @param {Object} currentRecord - 當前編輯中的病歷物件
     * @param {Object} template - 模板物件 (包含 soap, tags, bodyParts...)
     * @param {string} strategy - 'Append' | 'Override'
     */
    merge(currentRecord, template, strategy = 'Append') {
        if (!template) throw new Error('Template is null');

        // 1. SOAP Text Merge (Data Structure Alignment)
        // 確保針對 s, o, a, p 四個欄位分別處理，符合 DB Schema
        const newSoap = { ...currentRecord.soap };
        const tplSoap = template.soap || {};
        
        ['s', 'o', 'a', 'p'].forEach(key => {
            const tplText = tplSoap[key] || '';
            const currText = newSoap[key] || '';
            
            if (!tplText) return; // 模板無該欄位內容，跳過

            if (strategy === 'Override' || !currText) {
                newSoap[key] = tplText;
            } else {
                // Append mode: 自動換行疊加
                newSoap[key] = currText + '\n' + tplText;
            }
        });

        // 2. Tags Merge (Union Set)
        const currentTags = new Set(currentRecord.tags || []);
        if (template.tags) {
            template.tags.forEach(t => currentTags.add(t));
        }

        // 3. Body Parts Merge (Union Set)
        const currentParts = new Set(currentRecord.bodyParts || []);
        if (template.bodyParts) {
            template.bodyParts.forEach(p => currentParts.add(p));
        }

        // 4. Numeric Values (Override Logic)
        let painScale = currentRecord.painScale;
        if (template.painScale !== undefined) {
            if (painScale === undefined || painScale === null || strategy === 'Override') {
                painScale = template.painScale;
            }
        }

        return {
            ...currentRecord,
            soap: newSoap,
            tags: Array.from(currentTags),
            bodyParts: Array.from(currentParts),
            painScale: painScale
        };
    }

    async get(id) {
        return await storageManager.get(StorageKeys.TEMPLATES, id);
    }
}

export const templateManager = new TemplateManager();

/**
 * 草稿管理器
 */
class DraftManager {
    async save(relatedId, data) {
        const draft = {
            id: relatedId,
            relatedId,
            data,
            updatedAt: new Date().toISOString()
        };
        await storageManager.put(StorageKeys.DRAFTS, draft);
    }

    async get(relatedId) {
        return await storageManager.get(StorageKeys.DRAFTS, relatedId);
    }

    async getAll() {
        return await storageManager.getAll(StorageKeys.DRAFTS);
    }

    async discard(relatedId, tx = null) {
        if (tx) {
            await tx.delete(StorageKeys.DRAFTS, relatedId);
        } else {
            await storageManager.delete(StorageKeys.DRAFTS, relatedId);
        }
    }
}

export const draftManager = new DraftManager();

/**
 * 病歷狀態機
 */
const RecordFSM = {
    validateTransition(currentStatus, nextStatus) {
        if (currentStatus === nextStatus) return true;

        const validTransitions = {
            [RecordStatus.DRAFT]: [RecordStatus.VALIDATING, RecordStatus.FINALIZED],
            [RecordStatus.VALIDATING]: [RecordStatus.DRAFT, RecordStatus.FINALIZED],
            [RecordStatus.FINALIZED]: [] 
        };

        if (!validTransitions[currentStatus] || !validTransitions[currentStatus].includes(nextStatus)) {
            throw new Error(`Invalid State Transition: ${currentStatus} -> ${nextStatus}`);
        }
        return true;
    }
};

/**
 * 病歷管理器 (Facade)
 */
class RecordManager {
    async create(customerId, initialData = {}) {
        const now = new Date().toISOString();
        const record = {
            id: UUID(),
            customerId,
            status: RecordStatus.DRAFT,
            version: 'V1.0', // [Fix] 初始版本號
            
            // [Fix] SOAP 結構化資料
            soap: {
                s: initialData.soap?.s || '', // Subjective (主訴)
                o: initialData.soap?.o || '', // Objective (客觀檢查)
                a: initialData.soap?.a || '', // Assessment (評估)
                p: initialData.soap?.p || ''  // Plan (計畫)
            },
            
            // [Fix] 人體圖選取狀態持久化
            bodyParts: initialData.bodyParts || [], 
            
            tags: initialData.tags || [],
            images: [],
            attachments: [],
            
            changeLog: [], // [Fix] 變更歷程
            
            // Legacy content fallback
            content: initialData.content || {},
            
            createdAt: now,
            updatedAt: now
        };

        await storageManager.put(StorageKeys.RECORDS, record);
        return record;
    }

    /**
     * 儲存/更新病歷 (ACID Transaction)
     * @param {string} id 
     * @param {Object} changes - 包含內容與版本策略 { soap, tags, versionStrategy, changeReason }
     * @param {string} targetStatus 
     */
    async save(id, changes, targetStatus = RecordStatus.DRAFT) {
        // 1. 準備交易涉及的 Stores
        const stores = [
            StorageKeys.RECORDS, 
            StorageKeys.DRAFTS, 
            StorageKeys.CUSTOMERS,
            StorageKeys.TAGS
        ];

        // 2. 執行原子交易
        return await storageManager.runTransaction(stores, 'readwrite', async (tx) => {
            // A. 讀取與驗證
            const current = await tx.get(StorageKeys.RECORDS, id);
            if (!current) throw new Error(ErrorCodes.STR_004);
            
            // Draft 狀態下允許自由編輯，Finalized 狀態下禁止編輯 (需走 Revision)
            if (current.status === RecordStatus.FINALIZED && targetStatus === RecordStatus.FINALIZED) {
               // 這裡是防止已定稿的被覆蓋，除非是 Revision (Revision 也是新的一筆 Draft)
               // 但若是在 Draft -> Finalized 的過程中，則是合法的
            }
            
            RecordFSM.validateTransition(current.status, targetStatus);

            // B. 版本號計算 (僅在定稿時處理)
            let newVersion = current.version || 'V1.0';
            let newChangeLog = current.changeLog || [];

            if (targetStatus === RecordStatus.FINALIZED && changes.versionStrategy) {
                newVersion = this._incrementVersion(newVersion, changes.versionStrategy);
                if (changes.versionStrategy !== 'NONE' && changes.changeReason) {
                    newChangeLog.push({
                        version: newVersion,
                        reason: changes.changeReason,
                        timestamp: new Date().toISOString()
                    });
                }
            }

            // C. 建構更新物件
            // 剔除 auxiliary fields (strategy, reason)
            const { versionStrategy, changeReason, ...realChanges } = changes;
            
            const updated = { 
                ...current, 
                ...realChanges, 
                version: newVersion,
                changeLog: newChangeLog,
                status: targetStatus 
            };
            
            await tx.put(StorageKeys.RECORDS, updated);

            // D. 若定稿 (Finalized) 的連動操作
            if (targetStatus === RecordStatus.FINALIZED) {
                // 刪除草稿 (Atomic)
                await draftManager.discard(id, tx);
                await draftManager.discard(current.customerId, tx);

                // 更新顧客統計 (Atomic)
                await customerManager.updateVisitStats(current.customerId, updated.updatedAt, tx);
                
                // 同步標籤 (Atomic)
                if (updated.tags && updated.tags.length > 0) {
                    await tagManager.syncTags(updated.tags, current.tags || [], tx);
                }
            }

            return updated;
        });
    }

    /**
     * 版本號遞增邏輯
     * @param {string} currentVer "V1.0"
     * @param {string} strategy "MAJOR" | "MINOR" | "NONE"
     */
    _incrementVersion(currentVer, strategy) {
        // Regex parse "V{major}.{minor}"
        const match = currentVer.match(/^V(\d+)\.(\d+)$/);
        if (!match) return currentVer; // Fallback

        let major = parseInt(match[1], 10);
        let minor = parseInt(match[2], 10);

        if (strategy === 'MAJOR') {
            major++;
            minor = 0;
        } else if (strategy === 'MINOR') {
            minor++;
        }

        return `V${major}.${minor}`;
    }

    async createRevision(originalRecordId) {
        const original = await storageManager.get(StorageKeys.RECORDS, originalRecordId);
        if (!original) throw new Error(ErrorCodes.STR_004);

        const revision = {
            id: UUID(),
            customerId: original.customerId,
            status: RecordStatus.DRAFT,
            content: { ...original.content },
            tags: [...(original.tags || [])],
            originId: originalRecordId,
            isRevision: true
        };

        await storageManager.put(StorageKeys.RECORDS, revision);
        return revision;
    }

    /**
     * 封存病歷 (Cold Storage)
     * 原子操作：寫入 Archived -> 刪除 Records
     */
    async archive(id) {
        const stores = [StorageKeys.RECORDS, StorageKeys.ARCHIVED];
        
        await storageManager.runTransaction(stores, 'readwrite', async (tx) => {
            const record = await tx.get(StorageKeys.RECORDS, id);
            if (!record) throw new Error(ErrorCodes.STR_004);

            // 1. 寫入 Archived Store
            await tx.put(StorageKeys.ARCHIVED, {
                ...record,
                archivedAt: new Date().toISOString(),
                originalStore: StorageKeys.RECORDS
            });

            // 2. 從 Records Store 刪除 (Soft Delete)
            await tx.delete(StorageKeys.RECORDS, id);
        });

        EventBus.emit(EventTypes.DATA.ARCHIVED, { id, store: StorageKeys.RECORDS });
    }

    async getByCustomer(customerId) {
        const records = await storageManager.query(StorageKeys.RECORDS, 'customerId', IDBKeyRange.only(customerId));
        return records.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    async get(id) {
        return await storageManager.get(StorageKeys.RECORDS, id);
    }
}

export const recordManager = new RecordManager();