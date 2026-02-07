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

        // [數據隔離] 深度複製原始紀錄，確保合併過程不影響快照
        const result = JSON.parse(JSON.stringify(currentRecord));
        const newSoap = result.soap || { s: '', o: '', a: '', p: '' };
        const tplSoap = template.soap || {};
        
        ['s', 'o', 'a', 'p'].forEach(key => {
            const tplText = tplSoap[key] || '';
            const currText = newSoap[key] || '';
            
            if (!tplText) return; 

            if (strategy === 'Override' || !currText) {
                newSoap[key] = tplText;
            } else {
                newSoap[key] = currText + '\n' + tplText;
            }
        });

        const currentTags = new Set(result.tags || []);
        if (template.tags) {
            template.tags.forEach(t => currentTags.add(t));
        }

        const currentParts = new Set(result.bodyParts || []);
        if (template.bodyParts) {
            template.bodyParts.forEach(p => currentParts.add(p));
        }

        let painScale = result.painScale;
        if (template.painScale !== undefined) {
            if (painScale === undefined || painScale === null || strategy === 'Override') {
                painScale = template.painScale;
            }
        }

        return {
            ...result,
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
            version: 'V1.0',
            
            // SOAP 結構化資料
            soap: {
                s: initialData.soap?.s || '', 
                o: initialData.soap?.o || '', 
                a: initialData.soap?.a || '', 
                p: initialData.soap?.p || ''
            },
            
            // [Fix] 新增 ROM 與 Assessments 欄位
            rom: initialData.rom || {}, // { 'shoulder_flex': 120 }
            assessments: initialData.assessments || [], // [{ id: 'test_1', result: '+' }]
            
            bodyParts: initialData.bodyParts || [], 
            tags: initialData.tags || [],
            images: [],
            attachments: [],
            changeLog: [],
            
            // Legacy content fallback
            content: initialData.content || {},
            
            createdAt: now,
            updatedAt: now
        };

        await storageManager.put(StorageKeys.RECORDS, record);
        return record;
    }

    /**
     * 延伸上次紀錄 (Extend from Last Visit)
     * 產生中文摘要並填入新紀錄的 Objective 欄位
     */
    async extendFrom(lastRecord) {
        if (!lastRecord) throw new Error('No record to extend');

        // 1. 生成摘要文字
        const dateStr = new Date(lastRecord.updatedAt).toLocaleDateString();
        const tagsStr = (lastRecord.tags || []).join(', ');
        const partsStr = (lastRecord.bodyParts || []).join(', ');
        
        // 格式化 ROM 數據
        let romStr = '';
        if (lastRecord.rom) {
            romStr = Object.entries(lastRecord.rom)
                .map(([k, v]) => `${k}: ${v}°`)
                .join(', ');
        }

        const summary = `
[上次就診] ${dateStr}
--------------------------------
主訴: ${lastRecord.soap?.s || '無'}
部位: ${partsStr}
標籤: ${tagsStr}
ROM: ${romStr || '無'}
評估: ${lastRecord.soap?.a || '無'}
--------------------------------
`;

        // 2. 建立新紀錄 (帶入摘要至 O，並複製 Tags 與 BodyParts 以便延續追蹤)
        return await this.create(lastRecord.customerId, {
            soap: {
                s: '', // 主訴通常每次不同，留白
                o: summary, // 摘要填入 O
                a: '',
                p: lastRecord.soap?.p || '' // 計畫通常可延續
            },
            tags: [...(lastRecord.tags || [])],
            bodyParts: [...(lastRecord.bodyParts || [])],
            rom: { ...(lastRecord.rom || {}) } // 複製上次角度作為參考基準
        });
    }

    /**
     * 儲存/更新病歷 (ACID Transaction)
     */
    async save(id, changes, targetStatus = RecordStatus.DRAFT) {
        const stores = [
            StorageKeys.RECORDS, 
            StorageKeys.DRAFTS, 
            StorageKeys.CUSTOMERS,
            StorageKeys.TAGS
        ];

        return await storageManager.runTransaction(stores, 'readwrite', async (tx) => {
            const current = await tx.get(StorageKeys.RECORDS, id);
            if (!current) throw new Error(ErrorCodes.STR_004);
            
            RecordFSM.validateTransition(current.status, targetStatus);

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

            const { versionStrategy, changeReason, ...realChanges } = changes;
            
            const updated = { 
                ...current, 
                ...realChanges, 
                version: newVersion,
                changeLog: newChangeLog,
                status: targetStatus 
            };
            
            await tx.put(StorageKeys.RECORDS, updated);

            if (targetStatus === RecordStatus.FINALIZED) {
                await draftManager.discard(id, tx);
                await draftManager.discard(current.customerId, tx);
                await customerManager.updateVisitStats(current.customerId, updated.updatedAt, tx);
                
                if (updated.tags && updated.tags.length > 0) {
                    await tagManager.syncTags(updated.tags, current.tags || [], tx);
                }
            }

            return updated;
        });
    }

    _incrementVersion(currentVer, strategy) {
        const match = currentVer.match(/^V(\d+)\.(\d+)$/);
        if (!match) return currentVer;

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

    async archive(id) {
        const stores = [StorageKeys.RECORDS, StorageKeys.ARCHIVED];
        
        await storageManager.runTransaction(stores, 'readwrite', async (tx) => {
            const record = await tx.get(StorageKeys.RECORDS, id);
            if (!record) throw new Error(ErrorCodes.STR_004);

            await tx.put(StorageKeys.ARCHIVED, {
                ...record,
                archivedAt: new Date().toISOString(),
                originalStore: StorageKeys.RECORDS
            });

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