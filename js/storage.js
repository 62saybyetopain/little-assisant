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

  save(key, data) {
    if (this.demoMode) {
      this.inMemoryData[key] = JSON.parse(JSON.stringify(data));
      return { success: true, mode: 'demo' };
    }

    try {
      const jsonString = JSON.stringify(data);
      localStorage.setItem(key, jsonString);
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

  remove(key) {
    if (this.demoMode) {
      delete this.inMemoryData[key];
      return { success: true, mode: 'demo' };
    }

    try {
      localStorage.removeItem(key);
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
  saveCustomerIndex(indexData) {
    return this.save(this.KEYS.CUSTOMER_INDEX, indexData);
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
  saveCustomerDetail(customerId, data) {
    const key = `customer_${customerId}`;
    return this.save(key, data);
  }

  // ==========================================
  // 3. 工具與監控方法
  // ==========================================

  getStorageUsage() {
    if (this.demoMode) return { percentage: 0, warning: false, critical: false };

    let totalBytes = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        // 簡單估算：字元數 * 2 bytes
        totalBytes += (key.length + localStorage[key].length) * 2;
      }
    }
    
    const usedMB = (totalBytes / 1024 / 1024).toFixed(2);
    const maxMB = 5; // 一般瀏覽器限制
    const percentage = Math.min(100, ((totalBytes / (maxMB * 1024 * 1024)) * 100).toFixed(0));
    
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
        message: `儲存空間嚴重不足 (${usage.percentage}%)，請立即匯出備份！`,
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

  exportAllData() {
    // 匯出邏輯需適配新的分級結構：索引 + 所有獨立顧客檔
    const index = this.loadCustomerIndex() || [];
    const customers = index.map(idx => this.loadCustomerDetail(idx.id)).filter(Boolean);
    
    const data = {
      version: '2.0', // 升級版本號
      exportDate: new Date().toISOString(),
      customers: customers, // 匯出時組裝回完整陣列
      serviceRecords: this.load('serviceRecords') || [], // 舊版相容
      tags: this.load('tags') || [],
      assessmentActions: this.load('assessmentActions') || [],
      appSettings: this.load('appSettings') || {}
    };
    
    return JSON.stringify(data, null, 2);
  }
}

// 初始化全域實例 (使用新規範)
window.AppStorage = new StorageService();

// ⚠️ 向後相容：讓舊程式碼 (window.storage) 繼續運作
window.storage = window.AppStorage; 

// 偵錯訊息
console.log('✅ AppStorage (v2.0) 初始化成功 - 支援分級儲存與自動遷移');
if (!window.AppStorage.isAvailable) {
  console.warn('⚠️ LocalStorage 不可用，系統運行於記憶體模式');
}