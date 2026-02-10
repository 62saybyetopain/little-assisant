/**
 * src/core/search.js
 * 搜尋引擎核心 (The Search Engine)
 * 
 * @description 負責管理全域搜尋索引、執行模糊查詢與權重排序。
 * 透過 Web Worker 非同步建立索引，並維護 window.__CustomerIndexMap。
 */

import { EventTypes, AnatomicalWeights, StorageKeys, APP_NAMESPACE } from '../config.js'; // Need Namespace
import { EventBus } from './utils.js';
import { storageManager } from './db.js'; // Access CacheManager

const INDEX_CACHE_KEY = 'customer_index';

class SearchEngine {
    constructor() {
        this.worker = null;
        this.isReady = false;
        this.searchIndex = []; // Hot Index
        this.coldIndex = [];   // Cold Index
        window.__CustomerIndexMap = new Map();
        
        // Debounce timer for cache writing
        this._saveTimeout = null;
    }

    async init() {
        if (this.worker) return this.initPromise;

        // Phase 1: 從快取載入 (極速啟動)
        this._loadFromCache();

        // Worker Setup
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        
        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'INDEX_BUILT') {
                this._updateIndex(payload.hot, payload.cold);
                this._finishInit(); 
            } else if (type === 'ERROR') {
                console.error('[SearchEngine] Worker Error:', payload);
                this._finishInit(); 
            }
        };

        // Incremental Update (增量更新)
        EventBus.on(EventTypes.DATA.CREATED, (e) => this._handleDataChange(e));
        EventBus.on(EventTypes.DATA.UPDATED, (e) => this._handleDataChange(e));
        EventBus.on(EventTypes.DATA.DELETED, (e) => this._handleDataDelete(e));

        // Trigger full build on start to ensure consistency
        this.rebuildIndex();
        
        return this.initPromise;
    }

    // 輔助方法：統一處理 Promise resolve
    _finishInit() {
        if (this._resolveInit) {
            this._resolveInit();
            this._resolveInit = null;
        }
    }

    rebuildIndex() {
        if (this.worker) this.worker.postMessage({ type: 'BUILD_INDEX' });
    }

    _loadFromCache() {
        const cached = storageManager.cache.get(INDEX_CACHE_KEY);
        if (cached) {
            this.searchIndex = cached.hot || [];
            this.coldIndex = cached.cold || [];
            this._refreshMap();
            this.isReady = true;
            console.log('[SearchEngine] Phase 1: Loaded from Cache');
        }
    }

    _updateIndex(hot, cold) {
        this.searchIndex = hot || [];
        this.coldIndex = cold || [];
        this._refreshMap();
        this.isReady = true;
        
        //  Persistence (Write back to LS)
        storageManager.cache.set(INDEX_CACHE_KEY, { hot: this.searchIndex, cold: this.coldIndex });
        console.log('[SearchEngine] Phase 2: Index Updated & Cached');
    }

    _refreshMap() {
        window.__CustomerIndexMap.clear();
        this.searchIndex.forEach(item => window.__CustomerIndexMap.set(item.id, item));
    }

    //  Incremental Logic: Update memory directly
    _handleDataChange({ store, data }) {
        if (store !== StorageKeys.CUSTOMERS) return;
        
        // Construct index entry (Simulate Worker Logic)
        const contacts = [data.phone, data.email, data.lineId].filter(Boolean).join(' ');
        const entry = {
            id: data.id,
            n: data.name || '',
            nn: data.info?.nickname || '',
            c: contacts,
            t: data.tags || [],
            u: data.updatedAt,
            lv: data.lastVisit,
            vc: data.visitCount || 0,
            ca: data.createdAt,
            s: (data.name || '') + ' ' + (data.info?.nickname || '') + ' ' + contacts + ' ' + (data.phone || '')
        };

        const idx = this.searchIndex.findIndex(i => i.id === data.id);
        if (idx >= 0) {
            this.searchIndex[idx] = entry;
        } else {
            this.searchIndex.push(entry);
        }
        
        window.__CustomerIndexMap.set(entry.id, entry);
        this._scheduleCacheSave();
    }

    _handleDataDelete({ store, id }) {
        if (store !== StorageKeys.CUSTOMERS) return;
        this.searchIndex = this.searchIndex.filter(i => i.id !== id);
        window.__CustomerIndexMap.delete(id);
        this._scheduleCacheSave();
    }

    _scheduleCacheSave() {
        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            storageManager.cache.set(INDEX_CACHE_KEY, { hot: this.searchIndex, cold: this.coldIndex });
        }, 2000); // Debounce 2s
    }

    /**
     * 執行搜尋 (支援進階過濾)
     * @param {string} query - 搜尋關鍵字
     * @param {Object} options - { 
     *   limit: 50, 
     *   sort: 'relevance' | 'updated' | 'visit',
     *   filters: { tags: [], date: { start, end } } 
     * }
     * @returns {Array} 搜尋結果
     */
    search(query, options = { limit: 50, sort: 'relevance' }) {
        if (!this.isReady) {
            console.warn('[SearchEngine] Index not ready yet.');
            return [];
        }

        const term = query.toLowerCase().trim();
        const filters = options.filters || {};
        const limit = options.limit || 50;

        // 1. 篩選與計分 (Filtering & Scoring)
        const results = this.searchIndex.reduce((acc, item) => {
            // A. 進階過濾器 (Hard Filters)
            
            // Tag Filter (AND Logic: 必須包含所有指定標籤)
            if (filters.tags && filters.tags.length > 0) {
                const itemTags = new Set(item.t || []);
                const hasAllTags = filters.tags.every(tag => itemTags.has(tag));
                if (!hasAllTags) return acc;
            }

            // Date Filter (Last Visit Range)
            if (filters.date) {
                const itemDate = item.lv ? new Date(item.lv).getTime() : 0;
                if (filters.date.start && itemDate < filters.date.start) return acc;
                if (filters.date.end && itemDate > filters.date.end) return acc;
            }

            // B. 關鍵字計分
            let score = 0;
            if (!term) {
                score = 1; 
            } else {
                score = this._calculateScore(item, term);
            }

            if (score > 0) {
                acc.push({ ...item, _score: score });
            }
            return acc;
        }, []);

        //  3. 混合搜尋策略 (Hybrid Search / Fallback)
        // 若熱索引結果少於 Limit，且有搜尋詞，嘗試搜尋冷索引
        if (results.length < limit && term) {
            const coldResults = this.coldIndex.filter(item => {
                return item.n.toLowerCase().includes(term) || item.c.includes(term);
            }).map(item => ({
                ...item,
                _isCold: true, // 標記為冷資料
                _score: 10 // 低分
            }));
            
            results.push(...coldResults);
        }

        // 2. 排序
        results.sort((a, b) => {
            if (options.sort === 'updated') return b.u.localeCompare(a.u);
            if (options.sort === 'visit') {
                const dateA = a.lv || '';
                const dateB = b.lv || '';
                return dateB.localeCompare(dateA);
            }
            if (b._score !== a._score) return b._score - a._score;
            return (b.u || '').localeCompare(a.u || '');
        });

        return results.slice(0, limit);
    }

    /**
     * 計算搜尋分數 (Logic)
     * 包含解剖學權重加權
     * @param {Object} item 
     * @param {string} term 
     * @returns {number} 分數 (0 為不匹配)
     */
    _calculateScore(item, term) {
        let score = 0;
        const name = item.n.toLowerCase();
        const phone = item.p.toLowerCase();

        // A. 精確匹配 (最高分)
        if (name === term || phone === term) return 100;

        // B. 開頭匹配 (次高分)
        if (name.startsWith(term) || phone.startsWith(term)) score += 50;

        // C. 包含匹配
        else if (item.s.toLowerCase().includes(term)) score += 20;

        // D. 標籤權重匹配 (Anatomical Weights)
        // 如果搜尋詞命中某個 Tag，且該 Tag 在解剖學權重表中，給予額外加分
        if (item.t && item.t.length > 0) {
            item.t.forEach(tag => {
                const tagLower = tag.toLowerCase();
                if (tagLower.includes(term)) {
                    score += 10; // 基礎標籤分
                    
                    // 檢查解剖學權重
                    // 注意：AnatomicalWeights Key 是 Case-Sensitive (e.g., 'Head')
                    // 這裡做簡單的 Mapping 嘗試
                    const weightKey = Object.keys(AnatomicalWeights).find(k => k.toLowerCase() === tagLower);
                    if (weightKey) {
                        score += AnatomicalWeights[weightKey] / 10; // 權重加分 (e.g., Head=100 -> +10)
                    }
                }
            });
        }

        return score;
    }

    /**
     * 取得孤兒資料報告 (透過 Worker)
     * @returns {Promise<Object>}
     */
    async checkIntegrity() {
        return new Promise((resolve) => {
            const handler = (e) => {
                if (e.data.type === 'INTEGRITY_CHECK_RESULT') {
                    this.worker.removeEventListener('message', handler);
                    resolve(e.data.payload);
                }
            };
            this.worker.addEventListener('message', handler);
            this.worker.postMessage({ type: 'CHECK_INTEGRITY' });
        });
    }
}

// 輸出單例
export const searchEngine = new SearchEngine();