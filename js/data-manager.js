/**
 * ================================================================
 * Data Manager - 資料管理核心模組 (v3.0)
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
      { id: 'tag_m_01', name: '斜方肌', category: 'muscleGroup', relatedBodyParts: ['neck', 'left-shoulder', 'right-shoulder', 'upper-back'], usageCount: 0 },
      { id: 'tag_m_02', name: '提肩胛肌', category: 'muscleGroup', relatedBodyParts: ['neck', 'left-shoulder', 'right-shoulder'], usageCount: 0 },
      { id: 'tag_m_03', name: '胸大肌', category: 'muscleGroup', relatedBodyParts: ['chest', 'left-shoulder', 'right-shoulder'], usageCount: 0 },
      { id: 'tag_m_04', name: '三角肌', category: 'muscleGroup', relatedBodyParts: ['left-shoulder', 'right-shoulder', 'left-arm', 'right-arm'], usageCount: 0 },
      { id: 'tag_m_05', name: '豎脊肌', category: 'muscleGroup', relatedBodyParts: ['upper-back', 'lower-back'], usageCount: 0 },
      { id: 'tag_m_06', name: '腰方肌', category: 'muscleGroup', relatedBodyParts: ['lower-back'], usageCount: 0 },
      { id: 'tag_m_07', name: '梨狀肌', category: 'muscleGroup', relatedBodyParts: ['hip', 'lower-back'], usageCount: 0 },
      { id: 'tag_m_08', name: '股四頭肌', category: 'muscleGroup', relatedBodyParts: ['left-leg', 'right-leg', 'left-knee', 'right-knee'], usageCount: 0 },
      { id: 'tag_m_09', name: '腓腸肌', category: 'muscleGroup', relatedBodyParts: ['left-leg', 'right-leg', 'left-calf', 'right-calf'], usageCount: 0 },
      { id: 'tag_m_10', name: '髂腰肌', category: 'muscleGroup', relatedBodyParts: ['lower-back', 'hip', 'left-leg', 'right-leg'], usageCount: 0 }
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
      { id: 'act_01', bodyPart: 'neck', name: '頸部旋轉測試', description: '測試頸椎左右旋轉角度', order: 1 },
      { id: 'act_02', bodyPart: 'neck', name: '椎間孔擠壓測試', description: '測試神經根壓迫', order: 2 },
      { id: 'act_03', bodyPart: 'shoulder', name: 'Apley 抓背測試', description: '測試肩關節活動度', order: 1 },
      { id: 'act_04', bodyPart: 'shoulder', name: '空罐測試', description: '測試棘上肌肌力', order: 2 },
      { id: 'act_05', bodyPart: 'lower-back', name: '直腿抬高測試', description: '測試坐骨神經痛', order: 1 },
      { id: 'act_06', bodyPart: 'lower-back', name: 'Slump Test', description: '測試神經張力', order: 2 },
      { id: 'act_07', bodyPart: 'knee', name: '抽屜測試', description: '測試十字韌帶', order: 1 }
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
        },
        relatedMuscles: ['tag_m_01', 'tag_m_02'],
        relatedAssessments: ['act_01', 'act_02']
      },
      {
        id: 'tpl_default_02',
        name: '五十肩 (沾黏性肩關節囊炎)',
        symptomTag: '五十肩',
        relatedBodyParts: ['left-shoulder', 'right-shoulder'],
        textItems: {
          complaints: ['手臂無法高舉過頭', '夜間睡覺壓到肩膀會痛醒', '穿脫衣服困難（內旋受限）'],
          findings: ['主動/被動關節活動度皆受限', '外轉角度明顯不足', '結節間溝壓痛'],
          treatments: ['關節囊鬆動術', '深層橫向按摩 (DFM)', 'P.N.F 伸展', '干擾波電療'],
          recommendations: ['爬牆運動 (Wall Crawl)', '毛巾操 (內旋訓練)', '睡覺時患側墊枕頭', '持續復健勿中斷']
        },
        relatedMuscles: ['tag_m_03', 'tag_m_04'],
        relatedAssessments: ['act_03', 'act_04']
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
// 5. DataExportService - 資料匯出匯入服務
// ================================================================

class DataExportService {
  constructor() {
    this.storage = window.AppStorage;
  }

  exportAllData() {
    try {
      const data = {
        version: '3.1',
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

  exportAssessmentsToCSV() {
    try {
        const actions = this.storage.load('assessmentActions') || [];
        if (actions.length === 0) return { success: false, error: '無資料可匯出' };
        
        const headers = ['id', 'name', 'bodyPart', 'description'];
        const escapeCSV = (field) => {
            if (field === null || field === undefined) return '""'; 
            let stringValue = Array.isArray(field) ? field.join('|') : String(field);
            stringValue = stringValue.replace(/"/g, '""');
            return `"${stringValue}"`;
        };

        const rows = actions.map(a => 
            [escapeCSV(a.id), escapeCSV(a.name), escapeCSV(a.bodyPart), escapeCSV(a.description)].join(',')
        );
        const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
        return { success: true, csv: csvContent };
    } catch (e) { return { success: false, error: e.message }; }
  }

  /**
   * 匯入資料 (含回滾機制)
   * 防止匯入壞檔導致資料庫清空後無法復原
   */
  importData(jsonData, options = { source: 'local' }) {
    console.group('📦 執行安全匯入...');
    
    // 1. 建立快照
    const snapshot = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        snapshot[key] = localStorage.getItem(key);
      }
    } catch (e) { return { success: false, error: '備份失敗，取消匯入' }; }

    try {
      if (!jsonData.version) throw new Error('檔案格式錯誤');

      // [P0 關鍵防護] 檢查資料完整性
      // 如果匯入包中有顧客索引，但卻完全沒有詳細資料，視為「壞檔」或「傳輸不全」
      const hasIndex = jsonData.customerIndex && jsonData.customerIndex.length > 0;
      const hasDetails = jsonData.customerDetails && Object.keys(jsonData.customerDetails).length > 0;
      
      if (hasIndex && !hasDetails) {
          throw new Error('❌ 資料完整性檢查失敗：偵測到只有索引但無詳細資料，為防止資料遺失，已拒絕匯入。');
      }

      // 3. 清空並寫入
      localStorage.clear();
      const opts = { source: 'remote' }; // 防止 P2P 回音

      // 寫入設定類
      if (jsonData.tags) this.storage.save('tags', jsonData.tags, opts);
      if (jsonData.assessmentActions) this.storage.save('assessmentActions', jsonData.assessmentActions, opts);
      if (jsonData.serviceTemplates) this.storage.save('serviceTemplates', jsonData.serviceTemplates, opts);
      if (jsonData.appSettings) this.storage.save('appSettings', jsonData.appSettings, opts);
      
      // 寫入顧客資料
      if (jsonData.customerIndex) this.storage.save('customerIndex', jsonData.customerIndex, opts);
      if (jsonData.customerDetails) {
        Object.keys(jsonData.customerDetails).forEach(key => {
          this.storage.save(key, jsonData.customerDetails[key], opts);
        });
      }

      console.log('✅ 匯入成功');
      console.groupEnd();
      return { success: true };

    } catch (error) {
      console.error('❌ 匯入失敗，還原快照:', error);
      localStorage.clear();
      Object.keys(snapshot).forEach(key => localStorage.setItem(key, snapshot[key]));
      console.groupEnd();
      return { success: false, error: error.message };
    }
  }
/**
   *匯出特定模組設定 (CSV/JSON)
   * type: 'action' | 'muscle' | 'template'
   */
  exportConfig(type) {
      let data = [];
      let filename = '';
      
      if (type === 'action') {
          data = this.storage.load('assessmentActions') || [];
          filename = 'assessments.json';
      } else if (type === 'muscle') {
          data = this.storage.load('tags') || [];
          filename = 'muscle_tags.json';
      } else if (type === 'template') {
          data = this.storage.load('serviceTemplates') || [];
          filename = 'templates.json';
      }

      return { success: true, data: JSON.stringify(data, null, 2), filename };
  }

  /**
   * 匯入並取代特定模組設定
   */
  importConfig(type, jsonData) {
      try {
          if (!Array.isArray(jsonData)) throw new Error('格式錯誤：必須是陣列');
          
          let key = '';
          if (type === 'action') key = 'assessmentActions';
          else if (type === 'muscle') key = 'tags';
          else if (type === 'template') key = 'serviceTemplates';
          
          // 直接覆蓋 (Replace)
          this.storage.save(key, jsonData, { source: 'local' });
          return { success: true };
      } catch (e) {
          return { success: false, error: e.message };
      }
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