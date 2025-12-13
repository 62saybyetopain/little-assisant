/**
 * LocalStorage 封裝服務 (v4.2)
 * 支援分級儲存策略 (Index vs Detail) 與自動遷移
 * 新增交易機制以及更新基礎存取方法
 */
// [V4.1新增] 安全序列化函式：防止循環引用導致 JSON.stringify 崩潰 (作為底層防呆機制)
const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'; // 發現循環引用，標記並跳過，防止崩潰
      }
      seen.add(value);
    }
    return value;
  });
};

class StorageService {
  constructor() {
    this.isAvailable = this.checkAvailability();
    this.demoMode = !this.isAvailable;
    this.inMemoryData = {};
    
    // 定義 Key 常數 (ARCH-v1.3 規範)
    this.KEYS = {
      CUSTOMER_INDEX: 'customerIndex',     // 輕量索引
      SETTINGS: 'appSettings',             // 系統設定
      LEGACY_CUSTOMERS: 'customers',       // 舊版資料 Key (用於遷移)
      RECYCLE_BIN: 'recycleBinIndex'       // [新增] 回收桶索引
    };
}
  checkAvailability() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      console.error('LocalStorage not available:', e);
      return false;
    }
  }
  // ==========================================
  // 核心交易機制 (Atomic Transaction)
  // 防止寫入 Index 成功但寫入 Detail 失敗導致的資料不一致
  // ==========================================
  executeTransaction(operations) {
    // operations 格式: [{ type: 'save'|'remove', key: '...', value: ... }, ...]
    console.group('🔒 執行原力交換...');
    
    // 1. 檢查是否為受限模式 (Demo Mode / Incognito)
    if (this.demoMode) {
        const msg = '⚠️ 系統處於「無痕模式」或「儲存空間受限」狀態。\n\n為了防止資料遺失，系統已暫停所有編輯與新增功能。\n請關閉無痕模式或允許儲存權限後重試。';
        console.warn(msg);
        alert(msg); // 強制彈窗提醒
        console.groupEnd();
        return { success: false, error: 'STORAGE_DISABLED', message: '無痕模式下禁止寫入資料' };
    }

    // 2. 建立快照 (Snapshot) 
    const backup = {};
    const keysToModify = operations.map(op => op.key);
    
    try {
      keysToModify.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) backup[key] = val;
      });
    } catch (e) {
      console.error('交易初始化失敗 (備份階段):', e);
      console.groupEnd();
      return { success: false, error: 'TRANS_INIT_FAILED' };
    }

    // 2. 執行操作
    try {
      operations.forEach(op => {
        if (op.type === 'save') {
          try {
            // 使用 safeStringify 防止循環引用導致整個交易崩潰
            localStorage.setItem(op.key, safeStringify(op.value));
          } catch (e) {
            // 捕捉 QuotaExceededError 或其他底層寫入錯誤
            throw new Error(`寫入失敗 (${op.key}): ${e.message}`);
          }
        } else if (op.type === 'remove') {
          localStorage.removeItem(op.key);
        }
      });

      // 3. 交易成功：發送 P2P 廣播
      if (window.AppSyncManager) {
        operations.forEach(op => {
          const val = op.type === 'save' ? op.value : null;
          // 注意：交易通常由本地觸發，所以 source 預設為 local
          window.AppSyncManager.broadcastUpdate(op.key, val);
        });
      }

      console.log('✅ 交易提交成功');
      console.groupEnd();
      return { success: true };

    } catch (error) {
      // 4. [P0] 發生錯誤 (如 QuotaExceeded)，執行回滾 (Rollback)
      console.warn('⚠️ 交易失敗，正在進行時光回溯...', error);
      
      try {
        // 還原備份
        keysToModify.forEach(key => {
          if (backup.hasOwnProperty(key)) {
            localStorage.setItem(key, backup[key]);
          } else {
            localStorage.removeItem(key);
          }
        });
        console.log('↩️ 回溯完成，資料庫一致性已保護');
      } catch (rollbackError) {
        console.error('❌ 災難性錯誤：回溯失敗', rollbackError);
        alert('系統發生嚴重錯誤，請重新整理頁面');
      }

      console.groupEnd();
      
      if (error.name === 'QuotaExceededError' || error.message.includes('QuotaExceeded')) {
        //統一錯誤代碼字串，與 DataManager 的判斷邏輯 (includes('QuotaExceeded')) 保持一致
        return { success: false, error: 'QuotaExceededError', message: '儲存空間不足，交易已取消' };
      }
      return { success: false, error: 'TRANS_FAILED', message: error.message };
    }
  }

  // ==========================================
  // 1. 通用基礎方法 (Base Methods)
  // ==========================================
/**
   * 儲存資料
   * @param {string} key 鍵
   * @param {Object} data 資料
   * @param {Object} options { source: 'local' | 'remote' }
   */
  save(key, data, options = { source: 'local' }) {
    if (this.demoMode) {
        console.warn('儲存失敗：系統處於無痕模式');
        return { success: false, error: 'STORAGE_DISABLED', message: '無痕模式無法儲存資料' };
    }

    try {
      // [P0] P2P 迴圈防護：如果是遠端來的資料，只寫入不廣播
      const jsonString = JSON.stringify(data);
      localStorage.setItem(key, jsonString);

      if (options.source === 'local' && window.AppSyncManager) {
        window.AppSyncManager.broadcastUpdate(key, data);
      }

      return { success: true, mode: 'normal' };
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        return { success: false, error: 'QUOTA_EXCEEDED', message: '儲存空間不足' };
      }
      return { success: false, error: 'SAVE_FAILED', message: error.message };
    }
  }

  load(key) {
    if (this.demoMode) {
      return this.inMemoryData[key] || null;
    }

    try {
      const jsonString = localStorage.getItem(key);
      if (!jsonString) return null;
      return JSON.parse(jsonString);
    } catch (error) {
      console.error(`Failed to load ${key}:`, error);
      return null;
    }
  }

  remove(key, options = { source: 'local' }) {
    if (this.demoMode) { 
        return { success: false, error: 'STORAGE_DISABLED', message: '無痕模式無法刪除資料' }; 
    }
      localStorage.removeItem(key);
      if (options.source === 'local' && window.AppSyncManager) {
        window.AppSyncManager.broadcastUpdate(key, null);
      }
      return { success: true };
    } catch (error) { return { success: false }; }
  }

  // ==========================================
  // 2. 分級儲存與遷移核心 (Tiered Storage Core)
  // ==========================================

  /**
   * 載入顧客索引 (輕量級列表)
   * 如果發現只有舊版資料，會自動執行遷移
   * 加入 Rollback 機制，防止空間不足導致資料損毀
   */
  loadCustomerIndex() {
    // 1. 優先讀取新版索引
    const index = this.load(this.KEYS.CUSTOMER_INDEX);
    if (index) return index;

    // 2. 若無索引，檢查是否存在舊版資料並進行遷移 (Migration Strategy)
    const oldData = this.load(this.KEYS.LEGACY_CUSTOMERS);
    if (oldData && Array.isArray(oldData) && oldData.length > 0) {
      console.group('📦 系統升級：正在遷移資料結構...');
      console.log(`發現 ${oldData.length} 筆舊版資料，開始拆分儲存...`);
      
      try {
        // 建立新索引物件
        const newIndex = oldData.map(c => ({
          id: c.id,
          name: c.name,
          nickname: c.nickname,
          phoneLastThree: c.phoneLastThree,
          status: 'active',
          updatedAt: c.updatedAt,
          stats: { 
            totalServices: c.serviceRecords ? c.serviceRecords.length : 0 
          }
        }));

        // A. 嘗試儲存索引
        this.save(this.KEYS.CUSTOMER_INDEX, newIndex);
        
        // B. 將每位顧客的完整資料獨立儲存
        // 這裡可能會因為空間不足而拋出 QuotaExceededError
        oldData.forEach(c => {
          this.saveCustomerDetail(c.id, c);
        });

        console.log('✅ 資料遷移完成！');
        console.groupEnd();
        
        // 遷移成功，回傳新結構
        return newIndex;

      } catch (err) {
        console.error('❌ 資料遷移失敗 (已觸發時光回溯):', err);
        
        //執行回滾 (Rollback)
        this.remove(this.KEYS.CUSTOMER_INDEX);
        
        // 2. 盡可能清理剛剛寫入的殘留檔案，釋放空間
        try {
            oldData.forEach(c => this.remove(`customer_${c.id}`));
            console.log('↩️ 已清除殘留的遷移檔案');
        } catch (cleanupErr) {
            console.warn('⚠️ 清理殘留檔案時發生次要錯誤:', cleanupErr);
        }

        console.groupEnd();
        
        // 回傳帶有錯誤狀態的舊資料，讓 UI 可以顯示（但不影響系統核心運作）
        // 建議在 UI 層偵測到 'migration_failed' 時顯示警告
        return oldData.map(c => ({ ...c, status: 'migration_failed' }));
      }
    }

    return [];
  }

  /**
   * 儲存顧客索引
   */
  saveCustomerIndex(indexData, options) {
    return this.save(this.KEYS.CUSTOMER_INDEX, indexData, options);
  }

  /**
   * 載入單一顧客詳細資料 (包含服務紀錄)
   * @param {string} customerId 
   */
  loadCustomerDetail(customerId) {
    const key = `customer_${customerId}`;
    return this.load(key);
  }

  /**
   * 儲存單一顧客詳細資料
   * @param {string} customerId 
   * @param {Object} data 完整資料物件
   */
  saveCustomerDetail(customerId, data, options) {
    const key = `customer_${customerId}`;
    return this.save(key, data, options);
  }
  // ==========================================
  // 3. 匯出與匯入 
  // ==========================================

  exportAllData() {
    // [修改] 取得索引與詳細資料
    const index = this.loadCustomerIndex() || [];
    const customers = index.map(idx => this.loadCustomerDetail(idx.id)).filter(Boolean);
    
    const data = {
      version: '2.5', // [修改] 版本號升級，代表支援 P2P 結構
      exportDate: new Date().toISOString(),
      customerIndex: index, // [新增] 明確匯出索引，加速匯入
      customers: customers,
      
      // [保持] 保留您原本的欄位
      serviceRecords: this.load('serviceRecords') || [], 
      tags: this.load('tags') || [],
      assessmentActions: this.load('assessmentActions') || [],
      appSettings: this.load('appSettings') || {}
    };
    
    return JSON.stringify(data, null, 2);
  }

  /**
   * [新增] 匯入所有資料 (用於 P2P 全量同步或備份還原)
   * @param {Object} data 從 exportAllData 產出的物件
   */
  importAllData(data) {
    console.group('📦 開始執行全量匯入...');
    try {
      // 1. 驗證資料格式
      if (!data || !data.customerIndex) {
        throw new Error('無效的資料格式：缺少索引 (customerIndex)');
      }

      // 2. 清空現有資料 (支援 Demo Mode)
      if (this.demoMode) {
          this.inMemoryData = {};
      } else {
          localStorage.clear();
      }

      // 3. [關鍵] 設定 source: 'remote' 以避免匯入時觸發 P2P 廣播 loop
      const opts = { source: 'remote' };

      // 4. 寫入全域設定
      if (data.appSettings) this.save(this.KEYS.SETTINGS, data.appSettings, opts);
      if (data.serviceRecords) this.save('serviceRecords', data.serviceRecords, opts);
      if (data.tags) this.save('tags', data.tags, opts);
      if (data.assessmentActions) this.save('assessmentActions', data.assessmentActions, opts);
      
      // 5. 寫入顧客索引
      this.save(this.KEYS.CUSTOMER_INDEX, data.customerIndex, opts);

      // 6. 寫入個別顧客檔案
      if (Array.isArray(data.customers)) {
        data.customers.forEach(c => {
          if (c && c.id) {
            this.save(`customer_${c.id}`, c, opts);
          }
        });
      }

      console.log(`✅ 匯入完成：${data.customers.length} 筆顧客資料`);
      console.groupEnd();
      return { success: true };

    } catch (err) {
      console.error('❌ 匯入失敗:', err);
      console.groupEnd();
      return { success: false, message: err.message };
    }
  }

  // ==========================================
  // 4. 工具與監控方法 
  // ==========================================

  getStorageUsage() {
    if (this.demoMode) return { percentage: 0, warning: false, critical: false };

    let totalBytes = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        totalBytes += (key.length + localStorage[key].length) * 2;
      }
    }
    
    const usedMB = (totalBytes / 1024 / 1024).toFixed(2);
    // const maxMB = 5; 
    const percentage = Math.min(100, ((totalBytes / (5 * 1024 * 1024)) * 100).toFixed(0));
    
    return {
      usedMB: parseFloat(usedMB),
      percentage: parseInt(percentage),
      maxMB: 5,
      warning: percentage > 80,
      critical: percentage > 90
    };
  }

  checkStorageWarning() {
    const usage = this.getStorageUsage();
    if (usage.critical) {
      return {
        level: 'critical',
        message: `儲存空間嚴重不足 (${usage.percentage}%)，需要立即匯出備份！`,
        action: 'archive'
      };
    }
    if (usage.warning) {
      return {
        level: 'warning',
        message: `儲存空間即將額滿 (${usage.percentage}%)`,
        action: 'backup'
      };
    }
    return null;
  }
  
  // ==========================================
  // 5. 回收桶與系統診斷機制 (Unified Maintenance)
  // ==========================================

  /**
   * 將顧客移入回收桶 (邏輯刪除)
   * @param {string} customerId 
   */
  moveToRecycleBin(customerId) {
    try {
      const index = this.loadCustomerIndex() || [];
      const customerData = this.loadCustomerDetail(customerId);
      const recycleBin = this.load(this.KEYS.RECYCLE_BIN) || [];
      const now = new Date().toISOString();

      const operations = [];

      // 1. 如果檔案存在，將其更名為 trash_{id} 以便備份
      if (customerData) {
        operations.push({ type: 'save', key: `trash_${customerId}`, value: customerData });
        operations.push({ type: 'remove', key: `customer_${customerId}` });
      }

      // 2. 從正式索引移除
      const newIndex = index.filter(c => c.id !== customerId);
      operations.push({ type: 'save', key: this.KEYS.CUSTOMER_INDEX, value: newIndex });

      // 3. 加入回收桶索引
      const indexEntry = index.find(c => c.id === customerId);
      const name = customerData?.name || indexEntry?.name || '未知顧客';

      recycleBin.unshift({
        id: customerId,
        name: name,
        deletedAt: now,
        reason: 'user_delete',
        hasFile: !!customerData
      });
      operations.push({ type: 'save', key: this.KEYS.RECYCLE_BIN, value: recycleBin });

      return this.executeTransaction(operations);

    } catch (e) {
      console.error('Move to recycle bin failed:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * 從回收桶還原
   */
  restoreFromRecycleBin(customerId) {
    try {
      const recycleBin = this.load(this.KEYS.RECYCLE_BIN) || [];
      const trashKey = `trash_${customerId}`;
      const trashData = this.load(trashKey);
      
      if (!trashData) {
        return { success: false, error: '還原失敗：備份檔案已遺失' };
      }

      const index = this.loadCustomerIndex() || [];
      const operations = [];

      // 1. 恢復實體檔案 trash_{id} -> customer_{id}
      operations.push({ type: 'save', key: `customer_${customerId}`, value: trashData });
      operations.push({ type: 'remove', key: trashKey });

      // 2. 重建索引項目
      const restoredEntry = {
        id: trashData.id,
        name: trashData.name,
        nickname: trashData.nickname || '',
        phoneLastThree: trashData.phoneLastThree || '',
        status: 'active',
        updatedAt: new Date().toISOString(),
        stats: { totalServices: trashData.serviceRecords ? trashData.serviceRecords.length : 0 }
      };
      
      const newIndex = [restoredEntry, ...index];
      operations.push({ type: 'save', key: this.KEYS.CUSTOMER_INDEX, value: newIndex });

      // 3. 從回收桶索引移除
      const newRecycleBin = recycleBin.filter(item => item.id !== customerId);
      operations.push({ type: 'save', key: this.KEYS.RECYCLE_BIN, value: newRecycleBin });

      return this.executeTransaction(operations);

    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 清空回收桶
   */
  emptyRecycleBin() {
    try {
      const recycleBin = this.load(this.KEYS.RECYCLE_BIN) || [];
      if (recycleBin.length === 0) return { success: true };

      const operations = [];
      recycleBin.forEach(item => {
        if (item.hasFile) {
          operations.push({ type: 'remove', key: `trash_${item.id}` });
        }
      });
      operations.push({ type: 'remove', key: this.KEYS.RECYCLE_BIN });

      return this.executeTransaction(operations);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 系統診斷與修復 (Unified Fix & Vacuum)
   * 包含：
   * 1. 修復壞掉的索引連結 (Broken Links)
   * 2. 安全回收無主的孤兒檔案 (Orphans) -> 取代舊的 Vacuum
   * 3. 清理真正的系統垃圾 (Temp files)
   */
  fixBrokenIndices() {
    // 記憶體模式下無需執行診斷 (資料不持久化，且無法遍歷 localStorage)
    if (this.demoMode) {
        return { success: true, stats: { fixedLinks:0, recoveredOrphans:0, cleanedTrash:0 } };
    }

    console.group('🔧 執行系統全域診斷...');
    try {
      const index = this.loadCustomerIndex() || [];
      const recycleBin = this.load(this.KEYS.RECYCLE_BIN) || [];
      const operations = [];
      const now = new Date().toISOString();
      let stats = { fixedLinks: 0, recoveredOrphans: 0, cleanedTrash: 0 };

      // === 步驟 1：修復無效索引 (Broken Links) ===
      const validIndex = [];
      index.forEach(entry => {
        const fileKey = `customer_${entry.id}`;
        if (localStorage.getItem(fileKey) === null) {
          console.warn(`⚠️ 發現無效連結: ${entry.name}，標記為檔案遺失。`);
          if (!recycleBin.some(r => r.id === entry.id)) {
            recycleBin.unshift({
              id: entry.id, name: entry.name, deletedAt: now,
              reason: 'missing_file', hasFile: false 
            });
          }
          stats.fixedLinks++;
        } else {
          validIndex.push(entry);
        }
      });

      // === 步驟 2：安全回收孤兒檔案 (Safe Vacuum) ===
      const validIds = new Set(validIndex.map(c => c.id));
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        
        // 針對顧客檔案執行安全回收
        if (key && key.startsWith('customer_')) {
          const id = key.replace('customer_', '');
          if (!validIds.has(id)) {
            console.warn(`👻 發現走失檔案: ${key}，正在移入回收桶...`);
            
            // 讀取內容以獲取名稱
            let orphanName = '迷路小羊';
            let orphanData = null;
            try {
              orphanData = JSON.parse(localStorage.getItem(key));
              if (orphanData?.name) orphanName = orphanData.name;
            } catch(e) {}

            // 移入回收桶 (更名)
            if (orphanData) {
              operations.push({ type: 'save', key: `trash_${id}`, value: orphanData });
              operations.push({ type: 'remove', key: key });
            } else {
              operations.push({ type: 'remove', key: key }); // 壞檔直接刪
            }

            if (!recycleBin.some(r => r.id === id)) {
              recycleBin.unshift({
                id: id, name: orphanName, deletedAt: now,
                reason: 'orphan_recovered', hasFile: !!orphanData
              });
            }
            stats.recoveredOrphans++;
          }
        }

        // === 步驟 3：清理過期的暫存檔 (True Vacuum) ===
        // 例如暫存的服務紀錄，若超過30天則刪除
        if (key === 'tempServiceRecord') {
           try {
             const temp = JSON.parse(localStorage.getItem(key));
             const savedTime = new Date(temp.savedAt).getTime();
             const oneDay = 30 * 24 * 60 * 60 * 1000;
             if (Date.now() - savedTime > oneDay) {
                 operations.push({ type: 'remove', key: key });
                 stats.cleanedTrash++;
                 console.log('🧹 清除過期暫存檔');
             }
           } catch(e) {
               operations.push({ type: 'remove', key: key }); // 格式錯誤直接刪
           }
        }
      }

      // 執行變更
      if (stats.fixedLinks > 0 || stats.recoveredOrphans > 0 || stats.cleanedTrash > 0) {
        operations.push({ type: 'save', key: this.KEYS.CUSTOMER_INDEX, value: validIndex });
        operations.push({ type: 'save', key: this.KEYS.RECYCLE_BIN, value: recycleBin });
        
        this.executeTransaction(operations);
        console.log(`✅ 診斷完成: 修復連結 ${stats.fixedLinks}, 回收孤兒 ${stats.recoveredOrphans}, 清理垃圾 ${stats.cleanedTrash}`);
        console.groupEnd();
        return { success: true, stats };
      }

      console.log('✨ 系統健康，無需修復。');
      console.groupEnd();
      return { success: true, stats: { fixedLinks:0, recoveredOrphans:0, cleanedTrash:0 } };

    } catch (e) {
      console.error('診斷失敗:', e);
      console.groupEnd();
      return { success: false, error: e.message };
    }
  }

  /**
   * 取得回收桶內容
   */
  getRecycleBin() {
    return this.load(this.KEYS.RECYCLE_BIN) || [];
  }
}

// 初始化全域實例
window.AppStorage = new StorageService();

// 向後相容
window.storage = window.AppStorage; 

console.log('✅ AppStorage (v2.5) 初始化成功 - P2P Sync Ready');
if (!window.AppStorage.isAvailable) {
  console.warn('⚠️ LocalStorage 不可用，系統運行於記憶體模式');
}