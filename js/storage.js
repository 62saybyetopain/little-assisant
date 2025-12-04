/**
 * LocalStorage 封裝服務 (v2.0 重構版)
 * 支援分級儲存策略 (Index vs Detail) 與自動遷移
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
      const jsonString = JSON.stringify(data);
      localStorage.setItem(key, jsonString);

      if (options.source === 'local' && window.AppSyncManager) {
        window.AppSyncManager.broadcastUpdate(key, data);
      }

      return { success: true, mode: 'normal' };
    } catch (error) {
      // 容量不足處理
      if (error.name === 'QuotaExceededError') {
        return {
          success: false,
          error: 'QUOTA_EXCEEDED',
          message: '儲存空間不足，請封存或匯出舊資料'
        };
      }
      return {
        success: false,
        error: 'SAVE_FAILED',
        message: '儲存失敗:' + error.message
      };
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
      delete this.inMemoryData[key];
      return { success: true, mode: 'demo' };
    }

    try {
      localStorage.removeItem(key);

      // [P2P 修改點] 同步刪除操作 (傳送 null 代表刪除)
      if (options.source === 'local' && window.AppSyncManager) {
        window.AppSyncManager.broadcastUpdate(key, null);
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: '刪除失敗' };
    }
  }

  // ==========================================
  // 2. 分級儲存與遷移核心 (Tiered Storage Core)
  // ==========================================

  /**
   * 載入顧客索引 (輕量級列表)
   * 如果發現只有舊版資料，會自動執行遷移
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
        // 建立新索引
        const newIndex = oldData.map(c => ({
          id: c.id,
          name: c.name,
          nickname: c.nickname,
          phoneLastThree: c.phoneLastThree,
          status: 'active', // 預設為活躍
          updatedAt: c.updatedAt,
          // 快取少量統計資料以便列表顯示
          stats: { 
            totalServices: c.serviceRecords ? c.serviceRecords.length : 0 
          }
        }));

        // A. 儲存索引
        this.save(this.KEYS.CUSTOMER_INDEX, newIndex);
        
        // B. 將每位顧客的完整資料獨立儲存 (customer_{id})
        oldData.forEach(c => {
          this.saveCustomerDetail(c.id, c);
        });

        console.log('✅ 資料遷移完成！已啟用分級儲存。');
        console.groupEnd();
        return newIndex;

      } catch (err) {
        console.error('❌ 資料遷移失敗:', err);
        console.groupEnd();
        // 發生嚴重錯誤時回傳舊資料以避免當機
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
}

// 初始化全域實例
window.AppStorage = new StorageService();

// 向後相容
window.storage = window.AppStorage; 

console.log('✅ AppStorage (v2.5) 初始化成功 - P2P Sync Ready');
if (!window.AppStorage.isAvailable) {
  console.warn('⚠️ LocalStorage 不可用，系統運行於記憶體模式');
}