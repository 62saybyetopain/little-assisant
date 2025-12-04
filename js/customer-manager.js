/**
 * 顧客管理模組 (Customer Manager) - v2.0 重構版
 * 整合 StorageService 的分級儲存策略 (Index + Detail)
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
    else if (!/^\d{3}$/.test(customerData.phoneLastThree)) {
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
      const index = this.storage.loadCustomerIndex();
      // 按更新時間倒序
      return index.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
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

  /**
   * 新增顧客
   * 必須同時寫入：1. 詳細資料檔  2. 更新索引列表
   */
  addCustomer(customerData) {
    const validation = this.validate(customerData);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors };
    }

    try {
      const newId = this.generateId();
      const now = new Date().toISOString();

      // 1. 準備完整資料物件
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
        serviceRecords: [], // 初始無紀錄
        createdAt: now,
        updatedAt: now
      };

      // 2. 儲存詳細資料 (customer_{id})
      const saveDetail = this.storage.saveCustomerDetail(newId, newCustomer);
      if (!saveDetail.success) return saveDetail;

      // 3. 更新索引
      const index = this.storage.loadCustomerIndex();
      index.push({
        id: newId,
        name: newCustomer.name,
        nickname: newCustomer.nickname,
        phoneLastThree: newCustomer.phoneLastThree,
        status: 'active',
        updatedAt: now,
        // 索引中包含輕量統計
        stats: { totalServices: 0 }
      });
      
      this.storage.saveCustomerIndex(index);

      return { success: true, customer: newCustomer };

    } catch (error) {
      console.error('Add customer error:', error);
      return { success: false, errors: ['新增顧客失敗:' + error.message] };
    }
  }

  /**
   * 更新顧客
   * 同時更新詳細資料與索引
   */
  updateCustomer(customerId, updatedData) {
    const validation = this.validate(updatedData);
    if (!validation.isValid) {
      return { success: false, errors: validation.errors };
    }

    try {
      // 1. 載入現有詳細資料
      const currentData = this.getCustomerById(customerId);
      if (!currentData) return { success: false, errors: ['找不到該顧客'] };

      // 2. 合併資料
      const newData = {
        ...currentData,
        ...updatedData,
        name: updatedData.name.trim(),
        nickname: updatedData.nickname.trim(),
        phoneLastThree: updatedData.phoneLastThree.trim(),
        gender: updatedData.gender || currentData.gender,
        age: updatedData.age ? parseInt(updatedData.age) : currentData.age,
        location: updatedData.location?.trim() || currentData.location,
        occupation: updatedData.occupation?.trim() || currentData.occupation,
        interests: updatedData.interests || currentData.interests,
        healthTags: updatedData.healthTags || currentData.healthTags,
        personalityTags: updatedData.personalityTags || currentData.personalityTags,
        updatedAt: new Date().toISOString()
      };

      // 3. 儲存詳細資料
      const saveDetail = this.storage.saveCustomerDetail(customerId, newData);
      if (!saveDetail.success) return saveDetail;

      // 4. 更新索引 (如果關鍵欄位變更)
      const index = this.storage.loadCustomerIndex();
      const idx = index.findIndex(c => c.id === customerId);
      
      if (idx !== -1) {
        index[idx] = {
          ...index[idx],
          name: newData.name,
          nickname: newData.nickname,
          phoneLastThree: newData.phoneLastThree,
          updatedAt: newData.updatedAt
        };
        this.storage.saveCustomerIndex(index);
      }

      return { success: true, customer: newData };

    } catch (error) {
      console.error('Update customer error:', error);
      return { success: false, errors: ['更新顧客失敗:' + error.message] };
    }
  }

  /**
   * 刪除顧客
   */
  deleteCustomer(customerId) {
    try {
      // 1. 刪除詳細資料檔
      this.storage.remove(`customer_${customerId}`);

      // 2. 從索引移除
      const index = this.storage.loadCustomerIndex();
      const newIndex = index.filter(c => c.id !== customerId);
      
      // 如果長度沒變，代表索引中找不到
      if (index.length === newIndex.length) {
        return { success: false, error: '找不到該顧客' };
      }

      const saveIndex = this.storage.saveCustomerIndex(newIndex);
      
      if (saveIndex.success) {
        return { success: true };
      } else {
        return { success: false, error: '刪除索引失敗' };
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

// 初始化全域實例 (使用新規範)
window.AppCustomerManager = new CustomerManager();

// 向後相容 (階段二代碼使用)
window.customerManager = window.AppCustomerManager;