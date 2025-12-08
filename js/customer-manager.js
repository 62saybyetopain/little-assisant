/**
 * 顧客管理模組 (Customer Manager) - v3.0
 * 整合 StorageService 的分級儲存策略 (Index + Detail)
 * 改用 executeTransaction 確保寫入的一致性
 */

class CustomerManager {
  constructor() {
    // 1. 檢查依賴 (支援 AppStorage 新命名)
    if (!window.AppStorage) {
      console.error('❌ AppStorage 未初始化!');
      throw new Error('AppStorage service not initialized');
    }
    
    // 2. 引用全域儲存實例
    this.storage = window.AppStorage;
    
    console.log('✅ CustomerManager (v2.0) 初始化成功 - 分級儲存模式');
  }

  /**
   * 生成唯一 ID
   */
  generateId() {
    return 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 驗證顧客資料 (保留原邏輯)
   */
  validate(customerData) {
    const errors = [];

    // 必填欄位驗證
    if (!customerData.name || customerData.name.trim().length === 0) {
      errors.push('姓名不可為空');
    } else if (customerData.name.length > 50) {
      errors.push('姓名最多 50 字');
    }

    else if (customerData.nickname.length > 20) {
      errors.push('暱稱最多 20 字');
    }
    else if (customerData.phoneLastThree && !/^\d{3}$/.test(customerData.phoneLastThree)) {
      errors.push('電話後三碼必須為 3 位數字');
    }

    // 選填欄位驗證
    if (customerData.age !== null && customerData.age !== undefined && customerData.age !== '') {
      const age = parseInt(customerData.age);
      if (isNaN(age) || age < 0 || age > 120) {
        errors.push('年齡必須在 0-120 之間');
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors
    };
  }

  // ==========================================
  // 核心 CRUD (適配分級儲存)
  // ==========================================

  /**
   * 取得所有顧客 (僅索引，輕量快速)
   * 用於列表顯示
   */
  getAllCustomers() {
    try {
      // 改為讀取索引
      const index = this.storage.loadCustomerIndex()|| [];
      // 按更新時間倒序
      return index.sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
});
    } catch (error) {
      console.error('Get customer index error:', error);
      return [];
    }
  }

  /**
   * 根據 ID 取得完整顧客資料 (含服務紀錄)
   * 用於檔案頁面
   */
  getCustomerById(customerId) {
    try {
      // 直接讀取該顧客的獨立檔案
      const customer = this.storage.loadCustomerDetail(customerId);
      if (!customer) {
        console.warn(`Customer detail not found for ${customerId}`);
        return null;
      }
      return customer;
    } catch (error) {
      console.error('Get customer detail error:', error);
      return null;
    }
  }

  /**
   * 搜尋顧客 (基於索引)
   */
  searchCustomers(keyword) {
    if (!keyword || keyword.trim().length === 0) {
      return this.getAllCustomers();
    }

    const lowerKeyword = keyword.toLowerCase().trim();
    // 搜尋只需遍歷索引，無需載入所有詳細資料
    const index = this.getAllCustomers();

    return index.filter(customer => {
      const searchText = `${customer.name}${customer.nickname}${customer.phoneLastThree}`.toLowerCase();
      return searchText.includes(lowerKeyword);
    });
  }

  // 使用交易機制的新增方法
  addCustomer(customerData) {
    const validation = this.validate(customerData);
    if (!validation.isValid) return { success: false, errors: validation.errors };

    try {
      const newId = this.generateId();
      const now = new Date().toISOString();

      // 1. 準備詳細資料 (Detail)
      const newCustomer = {
        id: newId,
        name: customerData.name.trim(),
        nickname: customerData.nickname.trim(),
        phoneLastThree: customerData.phoneLastThree.trim(),
        gender: customerData.gender || null,
        age: customerData.age ? parseInt(customerData.age) : null,
        location: customerData.location?.trim() || null,
        occupation: customerData.occupation?.trim() || null,
        interests: customerData.interests || [],
        healthTags: customerData.healthTags || [],
        personalityTags: customerData.personalityTags || [],
        serviceRecords: [],
        createdAt: now,
        updatedAt: now
      };

      // 2. 準備更新後的索引 (Index)
      // 注意：必須先 load 出來，再 push 新資料
      const index = this.storage.loadCustomerIndex() || [];
      const newIndexEntry = {
        id: newId,
        name: newCustomer.name,
        nickname: newCustomer.nickname,
        phoneLastThree: newCustomer.phoneLastThree,
        status: 'active',
        updatedAt: now,
        stats: { totalServices: 0 }
      };
      
      const updatedIndex = [...index, newIndexEntry];

      // 3. [關鍵] 執行原子性交易 (Atomic Transaction)
      // 同時寫入 Detail 和 Index，任一失敗 (如容量不足) 則全部回滾
      const result = this.storage.executeTransaction([
        { type: 'save', key: `customer_${newId}`, value: newCustomer },
        { type: 'save', key: this.storage.KEYS.CUSTOMER_INDEX, value: updatedIndex }
      ]);

      if (result.success) {
        return { success: true, customer: newCustomer };
      } else {
        return { success: false, errors: [result.message || '儲存失敗'] };
      }

    } catch (error) {
      console.error('Add customer error:', error);
      return { success: false, errors: [error.message] };
    }
  }

  // [P0] 使用交易機制的更新方法
  updateCustomer(customerId, updatedData) {
    const validation = this.validate(updatedData);
    if (!validation.isValid) return { success: false, errors: validation.errors };

    try {
      const currentData = this.getCustomerById(customerId);
      if (!currentData) return { success: false, errors: ['找不到該顧客'] };

      // 1. 準備更新後的詳細資料
      const newData = {
        ...currentData,
        ...updatedData,
        // 確保關鍵欄位經過 trim 處理
        name: updatedData.name ? updatedData.name.trim() : currentData.name,
        nickname: updatedData.nickname ? updatedData.nickname.trim() : currentData.nickname,
        phoneLastThree: updatedData.phoneLastThree ? updatedData.phoneLastThree.trim() : currentData.phoneLastThree,
        updatedAt: new Date().toISOString()
      };

      // 2. 準備更新後的索引
      const index = this.storage.loadCustomerIndex() || [];
      const idx = index.findIndex(c => c.id === customerId);
      let updatedIndex = index;
      
      // 只有在索引內容變更時才更新索引物件
      if (idx !== -1) {
        updatedIndex = [...index]; // 複製陣列
        updatedIndex[idx] = {
          ...updatedIndex[idx],
          name: newData.name,
          nickname: newData.nickname,
          phoneLastThree: newData.phoneLastThree,
          updatedAt: newData.updatedAt
        };
      }

      // 3. [關鍵] 執行原子性交易
      const result = this.storage.executeTransaction([
        { type: 'save', key: `customer_${customerId}`, value: newData },
        { type: 'save', key: this.storage.KEYS.CUSTOMER_INDEX, value: updatedIndex }
      ]);

      if (result.success) {
        return { success: true, customer: newData };
      } else {
        return { success: false, errors: [result.message || '更新失敗'] };
      }
    } catch (error) {
      console.error('Update customer error:', error);
      return { success: false, errors: [error.message] };
    }
  }

  // [P0] 使用交易機制的刪除方法
  deleteCustomer(customerId) {
    try {
      // 1. 準備新的索引 (移除該顧客)
      const index = this.storage.loadCustomerIndex() || [];
      const newIndex = index.filter(c => c.id !== customerId);
      
      // 如果過濾後長度沒變，代表本來就不存在
      if (index.length === newIndex.length) {
        return { success: false, error: '找不到該顧客' };
      }

      // 2. [關鍵] 執行原子性交易
      // 同時刪除 Detail 檔並更新 Index
      const result = this.storage.executeTransaction([
        { type: 'remove', key: `customer_${customerId}` },
        { type: 'save', key: this.storage.KEYS.CUSTOMER_INDEX, value: newIndex }
      ]);

      if (result.success) {
        return { success: true };
      } else {
        return { success: false, error: result.message || '刪除失敗' };
      }

    } catch (error) {
      console.error('Delete customer error:', error);
      return { success: false, error: '刪除顧客失敗:' + error.message };
    }
  }

  /**
   * 計算顧客統計資料 (整合 RecordManager)
   * 階段三：整合 AppRecordManager
   */
  getCustomerStats(customerId) {
    // 如果 RecordManager 存在，優先使用它來計算真實數據
    if (window.AppRecordManager) {
      return window.AppRecordManager.calculateStats(customerId);
    }
    
    // 降級處理 (若無 RecordManager，嘗試從索引讀取快取)
    const index = this.storage.loadCustomerIndex();
    const entry = index.find(c => c.id === customerId);
    
    if (entry && entry.stats) {
      return {
        totalServices: entry.stats.totalServices || 0,
        // 其他欄位無資料時回傳 null
        avgInterval: null,
        lastServiceDate: null,
        daysSinceLastService: null
      };
    }

    // 預設值
    return {
      totalServices: 0,
      avgInterval: null,
      lastServiceDate: null,
      daysSinceLastService: null
    };
  }
  
  /**
   * 接收 RecordManager 的通知
   * 當服務紀錄新增時被呼叫
   */
  notifyRecordAdded(customerId) {
    // 更新索引中的統計數據
    try {
      const index = this.storage.loadCustomerIndex();
      const idx = index.findIndex(c => c.id === customerId);
      
      if (idx !== -1) {
        const currentCount = index[idx].stats?.totalServices || 0;
        index[idx].stats = {
          ...index[idx].stats,
          totalServices: currentCount + 1
        };
        index[idx].updatedAt = new Date().toISOString(); // 更新活動時間
        
        this.storage.saveCustomerIndex(index);
        console.log(`Updated stats for customer ${customerId} in index`);
      }
    } catch (e) {
      console.error('Failed to update index stats:', e);
    }
  }
}