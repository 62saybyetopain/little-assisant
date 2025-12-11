/**
 * ================================================================
 * Data Manager - 資料管理核心模組 (v3.1)
 * ================================================================
 * 職責：
 * 1. 統一管理 Tag, Record, Assessment 的 CRUD
 * 2. 提供資料初始化 (Seed Data)
 * 3. 透過依賴注入與 AppStorage 和 CustomerManager 對接
 * 加上快照備份 (Snapshot) 與錯誤回滾 (Rollback) 機制。
 */

const DATA_MANAGER_CONFIG = {
  enableDebugLog: true,
  keys: {
    muscleTags: 'tags', 
    assessmentActions: 'assessmentActions',
    tempRecord: 'tempServiceRecord',
    serviceTemplates: 'serviceTemplates'
  }
};

// ================================================================
// 1. TagManager - 標籤管理
// ================================================================

class TagManager {
  constructor() {
    if (!window.AppStorage) throw new Error('AppStorage not initialized');
    this.storage = window.AppStorage;
    this.key = DATA_MANAGER_CONFIG.keys.muscleTags;
    this.initDefaultTags();
  }

  initDefaultTags() {
    const existing = this.storage.load(this.key);
    if (existing && existing.length > 0) return;
    
    const defaultTags = [
      { id: 'tag_demo_01', name: '範例肌群 (請匯入資料包)', category: 'muscleGroup', relatedBodyParts: ['neck'], usageCount: 0, color: '#e9d5ff' }
    ];
    this.storage.save(this.key, defaultTags);
  }

  getAllMuscleTags() {
    const allTags = this.storage.load(this.key) || [];
    return {
      success: true,
      data: allTags.filter(t => t.category === 'muscleGroup')
    };
  }

  getTagsByCategory(category) {
    const allTags = this.storage.load(this.key) || [];
    return allTags.filter(t => t.category === category);
  }

  getTagById(tagId) {
    const allTags = this.storage.load(this.key) || [];
    return allTags.find(t => t.id === tagId);
  }

  getMuscleTagsByBodyParts(bodyParts) {
    const allTags = this.storage.load(this.key) || [];
    const relevant = allTags.filter(tag => 
      tag.category === 'muscleGroup' &&
      tag.relatedBodyParts && 
      tag.relatedBodyParts.some(part => bodyParts.includes(part))
    );
    
    return {
      success: true,
      data: relevant.sort((a, b) => b.usageCount - a.usageCount)
    };
  }

  addTag(category, tagData) {
    try {
      const allTags = this.storage.load(this.key) || [];
      if (!tagData.name) return { success: false, errors: ['標籤名稱為必填'] };
      if (allTags.some(t => t.name === tagData.name && t.category === category)) {
          return { success: false, errors: ['標籤名稱已存在'] };
      }

      const newTag = {
        id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        category: category,
        name: tagData.name,
        description: tagData.description || '',
        relatedBodyParts: tagData.relatedBodyParts || [],
        color: tagData.color || '#3b82f6',
        isCustom: true,
        isDefault: false,
        usageCount: 0,
        createdAt: new Date().toISOString()
      };

      allTags.push(newTag);
      this.storage.save(this.key, allTags);
      return { success: true, tag: newTag };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  updateTag(tagId, updates) {
    try {
      const allTags = this.storage.load(this.key) || [];
      const index = allTags.findIndex(t => t.id === tagId);
      
      if (index === -1) return { success: false, error: '標籤不存在' };

      if (updates.name && updates.name !== allTags[index].name) {
        if (allTags.some(t => t.name === updates.name && t.category === allTags[index].category && t.id !== tagId)) {
          return { success: false, errors: ['標籤名稱已存在'] };
        }
      }

      const updatedTag = { ...allTags[index], ...updates, updatedAt: new Date().toISOString() };
      allTags[index] = updatedTag;
      this.storage.save(this.key, allTags);
      return { success: true, tag: updatedTag };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  deleteTag(tagId) {
    try {
      const allTags = this.storage.load(this.key) || [];
      const tag = allTags.find(t => t.id === tagId);
      if (!tag) return { success: false, error: '標籤不存在' };

      const newTags = allTags.filter(t => t.id !== tagId);
      this.storage.save(this.key, newTags);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// ================================================================
// 2. AssessmentManager - 評估動作管理
// ================================================================

class AssessmentManager {
  constructor() {
    this.storage = window.AppStorage;
    this.key = DATA_MANAGER_CONFIG.keys.assessmentActions;
    this.initDefaultAssessments();
  }

  initDefaultAssessments() {
    const existing = this.storage.load(this.key);
    if (existing && existing.length > 0) return;

    const defaultActions = [
      { id: 'act_demo_01', bodyPart: 'neck', name: '範例評估動作', description: '這是一個範例，請從系統設定匯入完整資料包。', order: 1, relatedMuscles: ['tag_demo_01'] }
    ];

    this.storage.save(this.key, defaultActions);
  }

  getActionsByBodyPart(bodyPart) {
    const allActions = this.storage.load(this.key) || [];
    const normalizedPart = bodyPart.replace(/^(left|right)-/, '');
    return allActions.filter(action => {
          if (Array.isArray(action.bodyPart)) {
              return action.bodyPart.includes(normalizedPart) || action.bodyPart.includes(bodyPart);
          }
          return action.bodyPart === normalizedPart || action.bodyPart === bodyPart;
      }).sort((a, b) => a.order - b.order);
  }

  getAllActions() {
    return this.storage.load(this.key) || [];
  }
  
  getActionById(actionId) {
    const actions = this.getAllActions();
    return actions.find(a => a.id === actionId);
  }

  addAction(actionData) {
    try {
      const allActions = this.getAllActions();
      if (!actionData.name || !actionData.bodyPart) return { success: false, errors: ['名稱與部位為必填'] };

      const newAction = {
        id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        ...actionData,
        relatedMuscles: actionData.relatedMuscles || [],
        isCustom: true,
        isDefault: false,
        createdAt: new Date().toISOString()
      };

      allActions.push(newAction);
      this.storage.save(this.key, allActions);
      return { success: true, action: newAction };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  updateAction(actionId, updates) {
      try {
        const allActions = this.getAllActions();
        const index = allActions.findIndex(a => a.id === actionId);
        if (index === -1) return { success: false, error: '動作不存在' };
        
        const updatedAction = { ...allActions[index], ...updates };
        allActions[index] = updatedAction;
        this.storage.save(this.key, allActions);
        return { success: true, action: updatedAction };
      } catch (error) {
        return { success: false, error: error.message };
      }
  }

  deleteAction(actionId) {
    try {
      const allActions = this.getAllActions();
      const action = allActions.find(a => a.id === actionId);
      if (!action) return { success: false, error: '動作不存在' };
      
      const newActions = allActions.filter(a => a.id !== actionId);
      this.storage.save(this.key, newActions);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// ================================================================
// 3. RecordManager - 服務紀錄管理 (重構：依賴注入版)
// ================================================================

class RecordManager {
  /**
   * 建構子現在強制要求傳入 customerManager 實例
   * 移除所有 "等待/重試" 邏輯
   */
  constructor(customerManager) {
    this.storage = window.AppStorage;
    this.tempKey = DATA_MANAGER_CONFIG.keys.tempRecord;
    
    if (!customerManager) {
      console.error('❌ Critical: RecordManager requires a CustomerManager instance.');
    }
    this.customerManager = customerManager;
  }

  saveTempRecord(customerId, data) {
    const temp = { customerId, ...data, savedAt: new Date().toISOString() };
    this.storage.save(this.tempKey, temp);
    return Promise.resolve({ success: true });
  }

  loadTempRecord(customerId) {
    const temp = this.storage.load(this.tempKey);
    if (temp && temp.customerId === customerId) {
      return Promise.resolve(temp);
    }
    return Promise.resolve(null);
  }

  clearTempRecord(customerId) {
    this.storage.remove(this.tempKey);
    return Promise.resolve({ success: true });
  }

  getRecordById(customerId, recordId) {
    const records = this.getRecords(customerId);
    return records.find(r => r.id === recordId) || null;
  }

  getRecords(customerId) {
    // 直接使用注入的實例
    if (!this.customerManager) return [];
    
    try {
      const customer = this.customerManager.getCustomerById(customerId);
      if (!customer || !customer.serviceRecords) {
        return [];
      }
      return customer.serviceRecords.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
    } catch (error) {
      console.error('Get records error:', error);
      return [];
    }
  }

  calculateStats(customerId) {
    const records = this.getRecords(customerId);
    
    if (records.length === 0) {
      return { totalServices: 0, lastServiceDate: null, avgInterval: null, daysSinceLastService: null };
    }

    const lastRecord = records[0];
    const lastDate = new Date(lastRecord.date || lastRecord.createdAt);
    const today = new Date();
    const diffTime = Math.abs(today - lastDate);
    const daysSince = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let avgInterval = null;
    if (records.length > 1) {
      const recentRecords = records.slice(0, 5);
      let totalDaysDiff = 0;
      for (let i = 0; i < recentRecords.length - 1; i++) {
        const d1 = new Date(recentRecords[i].date || recentRecords[i].createdAt);
        const d2 = new Date(recentRecords[i+1].date || recentRecords[i+1].createdAt);
        totalDaysDiff += (d1 - d2) / (1000 * 60 * 60 * 24);
      }
      avgInterval = Math.round(totalDaysDiff / (recentRecords.length - 1));
    }

    return {
      totalServices: records.length,
      lastServiceDate: lastRecord.date || lastRecord.createdAt,
      daysSinceLastService: daysSince,
      avgInterval: avgInterval
    };
  }

  // --- 寫入方法 (已移除 Retry 機制，改為直接調用) ---

  async saveRecord(recordData) {
    try {
      if (!this.customerManager) throw new Error('CustomerManager not linked.');
      
      const customerId = recordData.customerId;
      const customer = this.customerManager.getCustomerById(customerId);

      if (!customer) return { success: false, error: '顧客不存在 (ID無效)' };
      if (!customer.serviceRecords) customer.serviceRecords = [];

      // 處理紀錄 (新增或更新)
      if (recordData.recordId) {
        const index = customer.serviceRecords.findIndex(r => r.id === recordData.recordId);
        if (index !== -1) {
          customer.serviceRecords[index] = { 
            ...customer.serviceRecords[index], 
            ...recordData, 
            updatedAt: new Date().toISOString() 
          };
        } else {
          const newRecord = { 
            ...recordData, 
            id: recordData.recordId, 
            isTempRecord: false, 
            createdAt: new Date().toISOString(), 
            updatedAt: new Date().toISOString() 
          };
          customer.serviceRecords.unshift(newRecord);
        }
      } else {
        const newRecord = { 
          id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, 
          ...recordData, 
          isTempRecord: false, 
          createdAt: new Date().toISOString(), 
          updatedAt: new Date().toISOString() 
        };
        customer.serviceRecords.unshift(newRecord);
      }

      // 寫回並通知
      const result = this.customerManager.updateCustomer(customerId, customer);
      
      if (result.success) {
        if (typeof this.customerManager.notifyRecordAdded === 'function') {
            this.customerManager.notifyRecordAdded(customerId);
        }
        return { success: true, recordId: recordData.recordId || customer.serviceRecords[0].id };
      } else {
        return { success: false, error: result.errors.join(',') };
      }

    } catch (error) {
      console.error('Save Record Failed:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteRecord(customerId, recordId) {
    try {
      if (!this.customerManager) throw new Error('CustomerManager not linked.');

      const customer = this.customerManager.getCustomerById(customerId);
      if (!customer || !customer.serviceRecords) {
        return { success: false, error: '找不到紀錄' };
      }

      const originalLength = customer.serviceRecords.length;
      customer.serviceRecords = customer.serviceRecords.filter(r => r.id !== recordId);

      if (customer.serviceRecords.length === originalLength) {
        return { success: false, error: '紀錄 ID 不存在' };
      }

      const result = this.customerManager.updateCustomer(customerId, customer);
      
      if (result.success) {
        return { success: true };
      } else {
        return { success: false, error: result.errors.join(',') };
      }
    } catch (error) {
      console.error('Delete record error:', error);
      return { success: false, error: error.message };
    }
  }
}

// ================================================================
// 4. TemplateManager - 模板管理
// ================================================================

class TemplateManager {
  constructor() {
    this.storage = window.AppStorage;
    this.key = DATA_MANAGER_CONFIG.keys.serviceTemplates;
    this.initDefaultTemplates();
  }

  initDefaultTemplates() {
    const existing = this.storage.load(this.key);
    if (existing && existing.length > 0) return;

    const defaultTemplates = [
      {
        id: 'tpl_default_01',
        name: '急性落枕處理',
        symptomTag: '落枕',
        relatedBodyParts: ['neck', 'upper-back'],
        textItems: {
          complaints: ['早晨起床頸部劇痛', '頭部無法向單側轉動', '肩頸肌肉僵硬'],
          findings: ['提肩胛肌明顯緊繃', '頸椎旋轉角度受限 (<45度)', '胸鎖乳突肌壓痛'],
          treatments: ['熱敷放鬆', '激痛點按壓 (Trigger Point)', '頸椎關節鬆動術', '貼紮支撐'],
          recommendations: ['更換合適高度枕頭', '避免長時間低頭滑手機', '每小時頸部伸展', '居家熱敷15分鐘']
        }
      }
    ];

    this.storage.save(this.key, defaultTemplates);
  }

  getAllTemplates() { return this.storage.load(this.key) || []; }
  getTemplateById(id) { return this.getAllTemplates().find(t => t.id === id); }

  findTemplatesByBodyPart(bodyPart) {
    const templates = this.getAllTemplates();
    const normalizedPart = bodyPart.replace(/^(left|right)-/, '');
    return templates.filter(t => 
      t.relatedBodyParts.some(part => part === bodyPart || part === normalizedPart)
    );
  }

  addTemplate(templateData) {
    try {
      if (!templateData.name) return { success: false, errors: ['模板名稱為必填'] };
      const templates = this.getAllTemplates();
      const newTemplate = {
        id: `tpl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: templateData.name,
        symptomTag: templateData.symptomTag || '',
        relatedBodyParts: templateData.relatedBodyParts || [],
        textItems: {
          complaints: this._parseList(templateData.content?.complaints),
          findings: this._parseList(templateData.content?.findings),
          treatments: this._parseList(templateData.content?.treatments),
          recommendations: this._parseList(templateData.content?.recommendations)
        },
        relatedMuscles: templateData.relatedMuscles || [],
        relatedAssessments: templateData.relatedAssessments || [],
        createdAt: new Date().toISOString()
      };
      templates.push(newTemplate);
      this.storage.save(this.key, templates);
      return { success: true, template: newTemplate };
    } catch (error) { return { success: false, error: error.message }; }
  }

  updateTemplate(id, updates) {
    try {
      const templates = this.getAllTemplates();
      const index = templates.findIndex(t => t.id === id);
      if (index === -1) return { success: false, error: '模板不存在' };

      let updatedTextItems = templates[index].textItems;
      if (updates.content) {
        updatedTextItems = {
          complaints: updates.content.complaints ? this._parseList(updates.content.complaints) : updatedTextItems.complaints,
          findings: updates.content.findings ? this._parseList(updates.content.findings) : updatedTextItems.findings,
          treatments: updates.content.treatments ? this._parseList(updates.content.treatments) : updatedTextItems.treatments,
          recommendations: updates.content.recommendations ? this._parseList(updates.content.recommendations) : updatedTextItems.recommendations,
        };
        delete updates.content;
      }

      templates[index] = { ...templates[index], ...updates, textItems: updatedTextItems, updatedAt: new Date().toISOString() };
      this.storage.save(this.key, templates);
      return { success: true, template: templates[index] };
    } catch (error) { return { success: false, error: error.message }; }
  }

  deleteTemplate(id) {
    const templates = this.getAllTemplates();
    const newTemplates = templates.filter(t => t.id !== id);
    if (templates.length === newTemplates.length) return { success: false, error: '模板不存在' };
    this.storage.save(this.key, newTemplates);
    return { success: true };
  }

  _parseList(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (typeof input === 'string') {
      return input.split('\n').map(item => item.trim()).filter(item => item.length > 0);
    }
    return [];
  }
}

// ================================================================
// 5. DataExportService - 資料匯出匯入服務 (v4.1 Unified CSV)
// ================================================================
class DataExportService {
  constructor() {
    this.storage = window.AppStorage;
    // 定義 12 個固定欄位
    this.CSV_HEADERS = [
      "DataType", "ID", "Name", "Category_Or_Symptom", "BodyParts", 
      "Description", "Tpl_Complaints", "Tpl_Findings", "Tpl_Treatments", 
      "Tpl_Recommendations", "Rel_MuscleIDs", "Rel_ActionIDs"
    ];
  }

  exportAllData() {
    try {
      const data = {
        version: '4.0',
        exportedAt: new Date().toISOString(),
        // 核心設定
        tags: this.storage.load('tags') || [],
        assessmentActions: this.storage.load('assessmentActions') || [],
        serviceTemplates: this.storage.load('serviceTemplates') || [], // 模板
        appSettings: this.storage.load('appSettings') || {},
        
        // 顧客資料
        customerIndex: this.storage.load('customerIndex') || [],
        customerDetails: {}
      };

      // [重要] 遍歷所有 customer_ 開頭的 key，確保詳細資料被打包
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('customer_')) {
           const detail = this.storage.load(key);
           if (detail) data.customerDetails[key] = detail;
        }
      }
      
      // 檢查完整性
      if (data.customerIndex.length > 0 && Object.keys(data.customerDetails).length === 0) {
          console.warn('Export Warning: Index exists but no details found.');
      }

      return { success: true, data: data };
    } catch (error) { return { success: false, error: error.message }; }
  }

  // ==========================================
  //顧客資料 JSON 專用邏輯 
  // ==========================================

  exportCustomerJSON() {
    try {
      // 匯出一個乾淨的陣列，不包含系統設定，只包含顧客與其病歷
      const index = this.storage.load('customerIndex') || [];
      // 讀取所有顧客詳細資料 (包含服務紀錄)
      const customers = index.map(idx => this.storage.load(`customer_${idx.id}`)).filter(Boolean);
      
      return { 
          success: true, 
          data: customers, // 直接給陣列，方便人類編輯 (如 VS Code)
          filename: `customers_full_${new Date().toISOString().slice(0,10)}.json` 
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 資料標準化 (Normalize)
   * 將「純陣列」或「舊版備份」轉換為系統標準的 { customerDetails: {...} } 格式
   * 這樣 analyzeImport 就可以通用，進行黃/藍/綠燈分析
   */
  normalizeImportData(rawData) {
      const standardFormat = {
          version: '4.0',
          customerDetails: {},
          customerIndex: [] // 分析時暫時不需要索引，但保持結構完整
      };

      let customersArray = [];

      // 判斷輸入格式
      if (Array.isArray(rawData)) {
          // 情境 1: 使用者匯入的是 [Customer, Customer, ...] (exportCustomerJSON 的產出)
          customersArray = rawData;
      } else if (rawData.customerDetails) {
          // 情境 2: 使用者匯入的是完整系統備份 (Backup JSON) - 已經是標準格式
          return rawData; 
      } else if (rawData.customers && Array.isArray(rawData.customers)) {
          // 情境 3: 舊版備份格式
          customersArray = rawData.customers;
      }

      // 轉換為標準 Map 結構 (customer_ID => Data)
      customersArray.forEach(c => {
          if (c && c.id) {
              standardFormat.customerDetails[`customer_${c.id}`] = c;
          }
      });

      return standardFormat;
  }

  // ==========================================
  // [核心] 智慧匯入邏輯 (Smart Merge)
  // ==========================================

  /**
   * 階段 1: 分析差異
   * 回傳: { new:[], newer:[], older:[], identical:[] }
   */
  analyzeImport(jsonData) {
    const analysis = {
        new: [],            // 本地沒有
        newer: [],          // 遠端較新 (建議更新)
        older: [],          // 遠端較舊 (衝突)
        identical: []       // 完全相同
    };

    if (!jsonData.customerDetails) return analysis;

    Object.keys(jsonData.customerDetails).forEach(key => {
        const remoteData = jsonData.customerDetails[key];
        const localData = this.storage.load(key);
        
        // 摘要物件 (供 UI 顯示)
        const summary = {
            id: remoteData.id,
            name: remoteData.name,
            updatedAt: remoteData.updatedAt
        };

        if (!localData) {
            analysis.new.push(summary);
        } else {
            // 比對內容 (排除 updatedAt 差異)
            const rContent = JSON.stringify({ ...remoteData, updatedAt: '' });
            const lContent = JSON.stringify({ ...localData, updatedAt: '' });

            if (rContent === lContent) {
                analysis.identical.push(summary);
            } else {
                const rTime = new Date(remoteData.updatedAt || 0).getTime();
                const lTime = new Date(localData.updatedAt || 0).getTime();
                
                if (rTime >= lTime) {
                    analysis.newer.push(summary);
                } else {
                    analysis.older.push(summary);
                }
            }
        }
    });
    
    return analysis;
  }

  /**
   * 階段 2: 執行匯入 (含備份與強制覆蓋邏輯)
   * @param {Object} selectionMap - { includeNew, includeNewer, includeOlder }
   * @param {Object} jsonData - 原始資料
   * @param {Object} options - { skipBackup: boolean }
   */
  executeSmartImport(selectionMap, jsonData, options = { skipBackup: false }) {
    console.group('🚀 執行智慧匯入...');
    let count = 0;
    let skipped = 0;
    const opts = { source: 'remote' };

    try {
      // 1. 寫入全域設定 (如果有) - 設定檔通常直接覆蓋
      if (jsonData.tags) this.storage.save('tags', jsonData.tags, opts);
      if (jsonData.assessmentActions) this.storage.save('assessmentActions', jsonData.assessmentActions, opts);
      if (jsonData.serviceTemplates) this.storage.save('serviceTemplates', jsonData.serviceTemplates, opts);
      if (jsonData.appSettings) this.storage.save('appSettings', jsonData.appSettings, opts);

      // 2. 處理顧客資料
      if (jsonData.customerDetails) {
        Object.keys(jsonData.customerDetails).forEach(key => {
          const remoteData = jsonData.customerDetails[key];
          const localData = this.storage.load(key);
          
          let shouldImport = false;
          let isConflict = false;

          if (!localData) {
              // 新增
              if (selectionMap.includeNew) shouldImport = true;
          } else {
              // 衝突比對
              const rContent = JSON.stringify({ ...remoteData, updatedAt: '' });
              const lContent = JSON.stringify({ ...localData, updatedAt: '' });
              
              if (rContent !== lContent) {
                  const rTime = new Date(remoteData.updatedAt || 0).getTime();
                  const lTime = new Date(localData.updatedAt || 0).getTime();
                  
                  if (rTime >= lTime) {
                      if (selectionMap.includeNewer) { shouldImport = true; isConflict = true; }
                  } else {
                      if (selectionMap.includeOlder) { shouldImport = true; isConflict = true; }
                  }
              }
          }

          if (shouldImport) {
              // [關鍵] 備份邏輯
              if (isConflict && !options.skipBackup) {
                  const backupResult = this.storage.moveToRecycleBin(remoteData.id); // 注意: 這裡 moveToRecycleBin 會移除原檔
                  
                  if (!backupResult.success) {
                      // 檢查是否為空間不足
                      if (backupResult.error && backupResult.error.includes('QuotaExceeded')) {
                          const err = new Error('儲存空間不足，備份失敗');
                          err.code = 'ERR_BACKUP_QUOTA';
                          throw err;
                      }
                      // 其他錯誤則忽略，繼續嘗試覆蓋
                      console.warn(`備份失敗 (${remoteData.name})，嘗試直接覆蓋...`, backupResult.error);
                  }
              } else if (isConflict && options.skipBackup) {
                  console.warn(`跳過備份，強制覆蓋: ${remoteData.name}`);

              }

              // 執行寫入
              this.storage.save(key, remoteData, opts);
              count++;
          } else {
              skipped++;
          }
        });
      }

      // 3. 重建索引
      this.rebuildIndexFromFiles();

      console.log(`匯入完成: ${count} 筆, 略過: ${skipped} 筆`);
      console.groupEnd();
      return { success: true, count, skipped };

    } catch (error) {
      console.error('匯入中斷:', error);
      console.groupEnd();
      throw error; // 拋出給 UI 層處理 (如顯示重試對話框)
    }
  }

  rebuildIndexFromFiles() {
      const newIndex = [];
      for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('customer_')) {
              try {
                  const c = JSON.parse(localStorage.getItem(key));
                  newIndex.push({
                      id: c.id,
                      name: c.name,
                      nickname: c.nickname,
                      phoneLastThree: c.phoneLastThree,
                      status: 'active',
                      updatedAt: c.updatedAt,
                      stats: { totalServices: c.serviceRecords ? c.serviceRecords.length : 0 }
                  });
              } catch(e) {}
          }
      }
      newIndex.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      this.storage.save('customerIndex', newIndex, { source: 'local' });
  }

  // ==========================================
  // 統一設定檔 CSV (Unified Config)
  // ==========================================
  
  exportUnifiedConfigCSV() {
    try {
      const rows = [];
      rows.push(["# DO_NOT_CHANGE_HEADER", ...this.CSV_HEADERS].join(','));

      const escape = (val) => {
        if (val === null || val === undefined) return '""';
        let str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      const tags = this.storage.load('tags') || [];
      tags.forEach(t => {
        rows.push([
          '""', '"TAG"', escape(t.id), escape(t.name),
          escape(t.category), escape(t.relatedBodyParts ? t.relatedBodyParts.join('|') : ''),
          escape(t.description || ''), '""','""','""','""','""','""'
        ].join(','));
      });

      const actions = this.storage.load('assessmentActions') || [];
      actions.forEach(a => {
        const bp = Array.isArray(a.bodyPart) ? a.bodyPart.join('|') : (a.bodyPart || '');
        rows.push([
          '""', '"ACTION"', escape(a.id), escape(a.name),
          escape(a.bodyPart), escape(bp), escape(a.description || ''),
          '""','""','""','""','""','""'
        ].join(','));
      });

      const templates = this.storage.load('serviceTemplates') || [];
      templates.forEach(t => {
        const ti = t.textItems || {};
        const toStr = (arr) => Array.isArray(arr) ? arr.join('|') : (arr || '');
        rows.push([
          '""', '"TEMPLATE"', escape(t.id), escape(t.name),
          escape(t.symptomTag || ''), escape(t.relatedBodyParts ? t.relatedBodyParts.join('|') : ''),
          '""', escape(toStr(ti.complaints)), escape(toStr(ti.findings)),
          escape(toStr(ti.treatments)), escape(toStr(ti.recommendations)),
          escape(t.relatedMuscles ? t.relatedMuscles.join('|') : ''),
          escape(t.relatedAssessments ? t.relatedAssessments.join('|') : '')
        ].join(','));
      });

      const csvContent = '\uFEFF' + rows.join('\n');
      return { success: true, csv: csvContent, filename: 'system_config_unified.csv' };
    } catch (e) { return { success: false, error: e.message }; }
  }

  importUnifiedConfigCSV(csvContent) {
    // 簡易版保護：設定檔直接覆蓋 (原子寫入)
    console.group('📥 執行統一設定匯入...');
    try {
      const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length < 2) throw new Error('檔案內容為空');

      const headers = this._parseCSVLine(lines[0]);
      if (!headers.includes('DataType')) throw new Error('CSV 格式錯誤');

      const parsedData = { tags: [], actions: [], templates: [] };
      
      for (let i = 1; i < lines.length; i++) {
        const cols = this._parseCSVLine(lines[i]);
        if (cols.length < 2) continue;
        const type = cols[1]; const id = cols[2]; const name = cols[3];
        if (!type || !id || !name) continue;

        const bodyParts = cols[5] ? cols[5].split('|').filter(x=>x) : [];

        if (type === 'TAG') {
            parsedData.tags.push({ id, name, category: cols[4]||'muscleGroup', relatedBodyParts: bodyParts, description: cols[6]||'', isCustom: true, usageCount: 0 });
        } else if (type === 'ACTION') {
            parsedData.actions.push({ id, name, bodyPart: bodyParts, description: cols[6]||'', isCustom: true });
        } else if (type === 'TEMPLATE') {
            const split = (s) => s ? s.split('|') : [];
            parsedData.templates.push({
                id, name, symptomTag: cols[4]||'', relatedBodyParts: bodyParts,
                textItems: { complaints: split(cols[7]), findings: split(cols[8]), treatments: split(cols[9]), recommendations: split(cols[10]) },
                relatedMuscles: cols[11]?cols[11].split('|'):[], relatedAssessments: cols[12]?cols[12].split('|'):[]
            });
        }
      }

      const opts = { source: 'local' };
      this.storage.save('tags', parsedData.tags, opts);
      this.storage.save('assessmentActions', parsedData.actions, opts);
      this.storage.save('serviceTemplates', parsedData.templates, opts);

      console.groupEnd();
      return { success: true, stats: parsedData };
    } catch (e) {
      console.groupEnd();
      return { success: false, error: e.message };
    }
  }

  _parseCSVLine(text) {
    const ret = [];
    let startValueIndex = 0;
    let quote = false;
    for (let i = 0; i < text.length; i++) {
        const cc = text[i];
        if (cc === '"') { quote = !quote; }
        else if (cc === ',' && !quote) {
            let val = text.substring(startValueIndex, i).trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/""/g, '"');
            ret.push(val);
            startValueIndex = i + 1;
        }
    }
    let val = text.substring(startValueIndex).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/""/g, '"');
    ret.push(val);
    return ret;
  }
}
  
// ================================================================
// DataManager 主入口 (等待依賴注入)
// ================================================================

class DataManager {
  /**
   * DataManager 現在是被動初始化的，必須由外部 (app.js) 傳入依賴
   */
  constructor(customerManager) {
    if (!window.AppStorage) {
      console.error('❌ AppStorage missing! DataManager cannot start.');
      return;
    }
    
    // 注入依賴
    this.tag = new TagManager();
    this.assessment = new AssessmentManager();
    this.template = new TemplateManager(); 
    this.exportService = new DataExportService();
    
    // 關鍵：將 customerManager 傳遞給 RecordManager
    this.record = new RecordManager(customerManager);

    console.log('✅ DataManager (v2.4 Refactored) initialized with DI');
  }
}