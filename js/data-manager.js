/**
 * ================================================================
 * Data Manager - 資料管理核心模組 (v2.3)
 * ================================================================
 * 職責：
 * 1. 統一管理 Tag, Record, Assessment 的 CRUD
 * 2. 提供資料初始化 (Seed Data)
 * 3. 與 AppStorage 和 AppCustomerManager 對接
 * * 全域實例：window.appDataManager
 */

const DATA_MANAGER_CONFIG = {
  enableDebugLog: true,
  keys: {
    muscleTags: 'tags', 
    assessmentActions: 'assessmentActions',
    tempRecord: 'tempServiceRecord'
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
      
      if (!tagData.name) {
        return { success: false, errors: ['標籤名稱為必填'] };
      }
      
      // 檢查重複
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
      
      if (index === -1) {
        return { success: false, error: '標籤不存在' };
      }

      if (updates.name && updates.name !== allTags[index].name) {
        if (allTags.some(t => t.name === updates.name && t.category === allTags[index].category && t.id !== tagId)) {
          return { success: false, errors: ['標籤名稱已存在'] };
        }
      }

      const updatedTag = {
        ...allTags[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };

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
      //if (!tag.isCustom) return { success: false, error: '預設標籤不可刪除' };

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
    
    // ✅ 支援多部位匹配 (如果動作關聯多個部位)
    return allActions
      .filter(action => {
          if (Array.isArray(action.bodyPart)) {
              return action.bodyPart.includes(normalizedPart) || action.bodyPart.includes(bodyPart);
          }
          return action.bodyPart === normalizedPart || action.bodyPart === bodyPart;
      })
      .sort((a, b) => a.order - b.order);
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
      
      if (!actionData.name || !actionData.bodyPart) {
        return { success: false, errors: ['名稱與部位為必填'] };
      }

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
// 3. RecordManager - 服務紀錄管理
// ================================================================

class RecordManager {
  constructor() {
    this.storage = window.AppStorage;
    this.tempKey = DATA_MANAGER_CONFIG.keys.tempRecord;
  }

  saveTempRecord(customerId, data) {
    const temp = {
      customerId,
      ...data,
      savedAt: new Date().toISOString()
    };
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
    try {
      const customer = window.AppCustomerManager.getCustomerById(customerId);
      
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
      return {
        totalServices: 0,
        lastServiceDate: null,
        avgInterval: null,
        daysSinceLastService: null
      };
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

  saveRecord(recordData) {
    try {
      if (!window.AppCustomerManager) {
        throw new Error('AppCustomerManager not initialized');
      }

      const customerId = recordData.customerId;
      const customer = window.AppCustomerManager.getCustomerById(customerId);

      if (!customer) {
        return Promise.resolve({ success: false, error: '顧客不存在' });
      }

      if (!customer.serviceRecords) customer.serviceRecords = [];

      if (recordData.recordId) {
        const index = customer.serviceRecords.findIndex(r => r.id === recordData.recordId);
        
        if (index !== -1) {
          customer.serviceRecords[index] = {
            ...customer.serviceRecords[index],
            ...recordData,
            updatedAt: new Date().toISOString()
          };
        } else {
          console.warn('Record ID provided but not found, creating new.');
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

      const result = window.AppCustomerManager.updateCustomer(customerId, customer);
      
      if (result.success) {
        if (window.AppCustomerManager.notifyRecordAdded) {
            window.AppCustomerManager.notifyRecordAdded(customerId);
        }
        return Promise.resolve({ 
          success: true, 
          recordId: recordData.recordId || customer.serviceRecords[0].id 
        });
      } else {
        return Promise.resolve({ success: false, error: result.errors.join(',') });
      }

    } catch (error) {
      console.error('Save record error:', error);
      return Promise.resolve({ success: false, error: error.message });
    }
  }

  deleteRecord(customerId, recordId) {
    try {
      if (!window.AppCustomerManager) {
        throw new Error('AppCustomerManager not initialized');
      }

      const customer = window.AppCustomerManager.getCustomerById(customerId);
      if (!customer || !customer.serviceRecords) {
        return Promise.resolve({ success: false, error: '找不到紀錄' });
      }

      const originalLength = customer.serviceRecords.length;
      customer.serviceRecords = customer.serviceRecords.filter(r => r.id !== recordId);

      if (customer.serviceRecords.length === originalLength) {
        return Promise.resolve({ success: false, error: '紀錄 ID 不存在' });
      }

      const result = window.AppCustomerManager.updateCustomer(customerId, customer);
      
      if (result.success) {
        return Promise.resolve({ success: true });
      } else {
        return Promise.resolve({ success: false, error: result.errors.join(',') });
      }
    } catch (error) {
      console.error('Delete record error:', error);
      return Promise.resolve({ success: false, error: error.message });
    }
  }
}
// ================================================================
// 4. TemplateManager - 模板管理 (P2 升級版 v2.4)
// ================================================================

class TemplateManager {
  constructor() {
    this.storage = window.AppStorage;
    this.key = DATA_MANAGER_CONFIG.keys.serviceTemplates || 'serviceTemplates'; // 確保有 key
    this.initDefaultTemplates();
  }

  // 初始化預設模板 (展示用)
  initDefaultTemplates() {
    const existing = this.storage.load(this.key);
    if (existing && existing.length > 0) return;

    const defaultTemplates = [
      {
        id: 'tpl_default_01',
        name: '急性落枕處理',
        symptomTag: '落枕', // 用於寫入 healthTags
        relatedBodyParts: ['neck', 'upper-back'], // 觸發部位
        // 文字選項 (供 UI 產生 Checkbox 使用)
        textItems: {
          complaints: ['早晨起床頸部劇痛', '頭部無法向單側轉動', '肩頸肌肉僵硬'],
          findings: ['提肩胛肌明顯緊繃', '頸椎旋轉角度受限 (<45度)', '胸鎖乳突肌壓痛'],
          treatments: ['熱敷放鬆', '激痛點按壓 (Trigger Point)', '頸椎關節鬆動術', '貼紮支撐'],
          recommendations: ['更換合適高度枕頭', '避免長時間低頭滑手機', '每小時頸部伸展', '居家熱敷15分鐘']
        },
        // 關聯資料 ID (對應現有 TagManager 和 AssessmentManager 的預設 ID)
        relatedMuscles: ['tag_m_01', 'tag_m_02'], // 斜方肌, 提肩胛肌
        relatedAssessments: ['act_01', 'act_02']   // 頸部旋轉, 椎間孔擠壓
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
        relatedMuscles: ['tag_m_03', 'tag_m_04'], // 胸大肌, 三角肌
        relatedAssessments: ['act_03', 'act_04']   // Apley 抓背, 空罐測試
      }
    ];

    this.storage.save(this.key, defaultTemplates);
  }

  getAllTemplates() {
    return this.storage.load(this.key) || [];
  }

  getTemplateById(id) {
    const templates = this.getAllTemplates();
    return templates.find(t => t.id === id);
  }

  // 根據部位尋找適合的模板 (被動觸發用)
  findTemplatesByBodyPart(bodyPart) {
    const templates = this.getAllTemplates();
    // 簡單匹配：只要模板的關聯部位包含傳入的部位 (移除左右側前綴後比對更廣泛，或精確比對)
    const normalizedPart = bodyPart.replace(/^(left|right)-/, '');
    
    return templates.filter(t => 
      t.relatedBodyParts.some(part => 
        part === bodyPart || part === normalizedPart
      )
    );
  }

  /**
   * 新增模板
   * @param {Object} templateData 
   * 注意：傳入的 content 欄位若是字串 (來自 textarea)，會自動轉為陣列
   */
  addTemplate(templateData) {
    try {
      if (!templateData.name) return { success: false, errors: ['模板名稱為必填'] };

      const templates = this.getAllTemplates();
      
      const newTemplate = {
        id: `tpl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: templateData.name,
        symptomTag: templateData.symptomTag || '',
        relatedBodyParts: templateData.relatedBodyParts || [],
        
        // 處理多維度文字選項
        textItems: {
          complaints: this._parseList(templateData.content?.complaints),
          findings: this._parseList(templateData.content?.findings),
          treatments: this._parseList(templateData.content?.treatments),
          recommendations: this._parseList(templateData.content?.recommendations)
        },

        // 關聯 ID
        relatedMuscles: templateData.relatedMuscles || [],
        relatedAssessments: templateData.relatedAssessments || [],
        
        createdAt: new Date().toISOString()
      };

      templates.push(newTemplate);
      this.storage.save(this.key, templates);
      return { success: true, template: newTemplate };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  updateTemplate(id, updates) {
    try {
      const templates = this.getAllTemplates();
      const index = templates.findIndex(t => t.id === id);
      if (index === -1) return { success: false, error: '模板不存在' };

      // 如果有更新 content 內容，需重新 parse
      let updatedTextItems = templates[index].textItems;
      if (updates.content) {
        updatedTextItems = {
          complaints: updates.content.complaints ? this._parseList(updates.content.complaints) : updatedTextItems.complaints,
          findings: updates.content.findings ? this._parseList(updates.content.findings) : updatedTextItems.findings,
          treatments: updates.content.treatments ? this._parseList(updates.content.treatments) : updatedTextItems.treatments,
          recommendations: updates.content.recommendations ? this._parseList(updates.content.recommendations) : updatedTextItems.recommendations,
        };
        delete updates.content; // 移除原始 content，避免覆蓋
      }

      templates[index] = {
        ...templates[index],
        ...updates,
        textItems: updatedTextItems,
        updatedAt: new Date().toISOString()
      };

      this.storage.save(this.key, templates);
      return { success: true, template: templates[index] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  deleteTemplate(id) {
    const templates = this.getAllTemplates();
    const newTemplates = templates.filter(t => t.id !== id);
    if (templates.length === newTemplates.length) return { success: false, error: '模板不存在' };
    
    this.storage.save(this.key, newTemplates);
    return { success: true };
  }

  // 內部工具：將字串或陣列轉為陣列，並過濾空值
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
// 5. DataExportService - 資料匯出匯入服務 (Phase 5)
// ================================================================

class DataExportService {
  constructor() {
    this.storage = window.AppStorage;
  }

  exportAllData() {
    try {
      const data = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        customers: this.storage.load('customers') || [],
        customerIndex: this.storage.load('customerIndex') || [],
        tags: this.storage.load('tags') || [],
        assessmentActions: this.storage.load('assessmentActions') || [],
        appSettings: this.storage.load('appSettings') || {},
        customerDetails: {}
      };

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('customer_') && key !== 'customerIndex') {
           const detail = this.storage.load(key);
           if (detail) {
             data.customerDetails[key] = detail;
           }
        }
      }

      return { success: true, data: data };
    } catch (error) {
      console.error('Export failed:', error);
      return { success: false, error: error.message };
    }
  }
exportAssessmentsToCSV() {
      try {
          const actions = this.storage.load('assessmentActions') || [];
          if (actions.length === 0) return { success: false, error: '無資料可匯出' };
          
          const headers = ['id', 'name', 'bodyPart', 'description'];
          const rows = actions.map(a => 
              [a.id, `"${a.name}"`, a.bodyPart, `"${(a.description||'').replace(/"/g, '""')}"`].join(',')
          );
          
          return { success: true, csv: [headers.join(','), ...rows].join('\n') };
      } catch (e) {
          return { success: false, error: e.message };
      }
  }
  importData(jsonData) {
    try {
      if (!jsonData.version || (!jsonData.customerIndex && !jsonData.customers)) {
        return { success: false, error: '無效的備份檔案格式' };
      }

      localStorage.clear();

      if (jsonData.tags) this.storage.save('tags', jsonData.tags);
      if (jsonData.assessmentActions) this.storage.save('assessmentActions', jsonData.assessmentActions);
      if (jsonData.customerIndex) this.storage.save('customerIndex', jsonData.customerIndex);
      if (jsonData.appSettings) this.storage.save('appSettings', jsonData.appSettings);
      
      if (jsonData.customerDetails) {
        Object.keys(jsonData.customerDetails).forEach(key => {
          this.storage.save(key, jsonData.customerDetails[key]);
        });
      }

      if (jsonData.customers && !jsonData.customerIndex) {
         console.warn('Importing legacy data...');
         this.storage.save('customers', jsonData.customers);
      }

      return { success: true };
    } catch (error) {
      console.error('Import failed:', error);
      return { success: false, error: error.message };
    }
  }
}

// ================================================================
// DataManager 主入口
// ================================================================

class DataManager {
  constructor() {
    if (!window.AppStorage) {
      console.error('❌ AppStorage missing! DataManager cannot start.');
      return;
    }

    this.tag = new TagManager();
    this.assessment = new AssessmentManager();
    this.record = new RecordManager();
    this.template = new TemplateManager(); 
    this.exportService = new DataExportService();
    
    console.log('✅ DataManager (v2.3) initialized with TemplateManager');
  }
}

window.appDataManager = new DataManager();
window.AppDataManager = window.appDataManager;
window.AppTagManager = window.appDataManager.tag;
window.AppRecordManager = window.appDataManager.record;
window.AppAssessmentManager = window.appDataManager.assessment;
window.AppTemplateManager = window.appDataManager.template; 
window.AppDataExportService = window.appDataManager.exportService;