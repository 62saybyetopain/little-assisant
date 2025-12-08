/**
 * LocalStorage 封裝服務 (v3.0)
 * 支援分級儲存策略 (Index vs Detail) 與自動遷移
 * 新增交易機制以及更新基礎存取方法
 */

class StorageService {
  constructor() {
    this.isAvailable = this.checkAvailability();
    this.demoMode = !this.isAvailable;
    this.inMemoryData = {};
    
    // 定義 Key 常數 (ARCH-v1.3 規範)
    this.KEYS = {
      CUSTOMER_INDEX: 'customerIndex',     // 輕量索引
      SETTINGS: 'appSettings',             // 系統設定
      LEGACY_CUSTOMERS: 'customers'        // 舊版資料 Key (用於遷移)
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
  // [P0] 核心交易機制 (Atomic Transaction)
  // 防止寫入 Index 成功但寫入 Detail 失敗導致的資料不一致
  // ==========================================
  executeTransaction(operations) {
    // operations 格式: [{ type: 'save'|'remove', key: '...', value: ... }, ...]
    console.group('🔒 執行原力交換...');
    
    // 1. 建立快照 (Snapshot) - 備份將被修改的 key
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
          // 直接操作 localStorage，不透過 this.save 以避免巢狀廣播
          localStorage.setItem(op.key, JSON.stringify(op.value));
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
      
      if (error.name === 'QuotaExceededError') {
        return { success: false, error: 'QUOTA_EXCEEDED', message: '儲存空間不足' };
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
      this.inMemoryData[key] = JSON.parse(JSON.stringify(data));
      return { success: true, mode: 'demo' };
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
    if (this.demoMode) { delete this.inMemoryData[key]; return { success: true }; }
    try {
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

      // 2. 清空現有資料 (全量同步前必須清空)
      localStorage.clear();

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
/**
   * 垃圾回收機制 (Vacuum / GC)
   * 用途：掃描並刪除沒有對應索引的「孤兒檔案」，釋放空間。
   * 觸發時機：App 啟動後背景執行、或使用者手動執行。
   */
  vacuum() {
    console.groupCollapsed('🧹 [System] 執行垃圾回收 (GC)...');
    try {
      // 1. 取得所有合法的 ID 清單
      const index = this.loadCustomerIndex() || [];
      const validIds = new Set(index.map(c => c.id));
      let removedCount = 0;
      let totalFreed = 0;

      // 2. 遍歷 localStorage 尋找孤兒
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        
        // 只檢查顧客檔案 (customer_ 開頭)
        if (key && key.startsWith('customer_')) {
          const id = key.replace('customer_', '');
          
          // 如果這個 ID 不在合法清單中，它就是孤兒 (Orphan)
          if (!validIds.has(id)) {
            const size = localStorage.getItem(key).length;
            console.warn(`🗑️ 發現殘留檔案: ${key} (${(size/1024).toFixed(2)} KB)，正在移除...`);
            
            localStorage.removeItem(key);
            removedCount++;
            totalFreed += size;
          }
        }
      }
      
      const freedKB = (totalFreed / 1024).toFixed(2);
      if (removedCount > 0) {
        console.log(`✅ 清理完成：共移除 ${removedCount} 個檔案，釋放 ${freedKB} KB 空間。`);
      } else {
        console.log('✨ 系統很乾淨，無需清理。');
      }
      
      console.groupEnd();
      return { success: true, removedCount, freedKB };

    } catch (e) {
      console.error('❌ 垃圾回收失敗:', e);
      console.groupEnd();
      return { success: false, error: e.message };
    }
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