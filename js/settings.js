/**
 * settings.js - 系統設定頁面控制器(v4.3)
 * 職責：
 * 1. 管理設定頁面的標籤頁切換與 UI 狀態
 * 2. 串接 AppDataManager 進行 CRUD (評估動作、肌群標籤)
 * 3. 執行系統級操作 (資料匯出/匯入/清空)
 * (v2.0 Fix)修正說明：
 * 1. 移除手動 localStorage 操作，全面改用 DataManager/ExportService
 * 2. 修正 Undefined 'this.storage' 錯誤
 * 3. 統一使用 AppStorage 計算容量
 * (v2.3 Final Fix)
 * 修正重點：
 * 1. 支援複選部位 (Checkbox Group)
 * 2. 實作 CSV 匯出功能
 * 3. 實作 25 色色盤選擇器
 * 4. 對接新版 HTML 結構
 * (v2.4.1 Fix)
 * 修正重點：
 * 修正模板 Modal 中「系統關聯」讀取肌群標籤資料結構錯誤的問題 (.data vs Array)
 * v2.6處理 P2P 同步操作
 * v2.7身體部位分類改良
 * V3.0加入 Lazy Check (惰性檢查) 與 Guard Clause (防衛語句)防止因為 DOM 元素缺失導致 JS 執行中斷
 * 「決策視窗」的渲染與「備份失敗重試」的邏輯，並補齊顧客 CSV 的相關功能
 */

// 定義身體部位
const BODY_PARTS_DEF = [
  { id: 'head', name: '頭部' }, 
  { id: 'neck', name: '左頸' },{ id: 'neck', name: '右頸' },
  { id: 'left-shoulder', name: '左肩' }, { id: 'right-shoulder', name: '右肩' },
  { id: 'upper-back', name: '上背' }, { id: 'lower-back', name: '下背/腰' },
  { id: 'left-chest', name: '左胸' }, { id: 'right-chest', name: '右胸' }, 
  { id: 'left-abdomen', name: '左腹部' },{ id: 'right-abdomen', name: '右腹' },
  { id: 'left-hip', name: '左臀' }, { id: 'left-hip', name: '右臀' },
  { id: 'left-arm', name: '左手' },{ id: 'right-arm', name: '右手' }, 
  { id: 'left-leg', name: '左大腿' },{ id: 'right-leg', name: '右大腿' },
  { id: 'left-knee', name: '左膝' },{ id: 'right-knee', name: '右膝' },
  { id: 'left-calf', name: '左小腿' },{ id: 'right-calf', name: '右小腿' },
  { id: 'left-ankle', name: '左腳踝' },{ id: 'right-ankle', name: '右腳踝' },
  { id: 'left-foot', name: '左足底' },{ id: 'right-foot', name: '右足底' }
  
];
const SIMPLIFIED_BODY_PARTS = [
    { id: 'head', name: '頭部' },
    { id: 'neck', name: '頸部' },
    { id: 'shoulder', name: '肩部' },      
    { id: 'upper-back', name: '上背' },
    { id: 'chest', name: '胸部' },         
    { id: 'arm', name: '手臂' },           
    { id: 'abdomen', name: '腹部' },
    { id: 'lower-back', name: '腰部/下背' },
    { id: 'hip', name: '髖/臀部' },
    { id: 'leg', name: '大腿' },           
    { id: 'knee', name: '膝' },          
    { id: 'calf', name: '小腿' },
    { id: 'ankle', name: '踝' },         
    { id: 'foot', name: '足部' }          
];
const BODY_PART_ORDER = [
  'head',        // 頭
  'neck',        // 頸
  'shoulder',    // 肩
  'upper-back',  // 上背
  'chest',       // 胸
  'arm',         // 手
  'abdomen',     // 腹
  'lower-back',  // 腰/下背
  'hip',         // 髖/臀
  'leg',         // 大腿
  'knee',        // 膝
  'calf',        // 小腿
  'ankle',       // 踝
  'foot'         // 足部
];
function sortTagsByBodyPart(tags) {
  return tags.sort((a, b) => {
    // 取出兩個標籤的第一個關聯部位
    const getPart = (tag) => {
        const parts = tag.relatedBodyParts;
        if (!parts || parts.length === 0) return '';
        // 取第一個部位，並移除 left-/right- 前綴以進行通用比對
        return parts[0].replace(/^(left|right)-/, '');
    };

    const partA = getPart(a);
    const partB = getPart(b);

    let indexA = BODY_PART_ORDER.indexOf(partA);
    let indexB = BODY_PART_ORDER.indexOf(partB);

    // 如果部位不在清單中 (例如 'unknown')，排在最後面
    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;

    // 1. 先比對部位順序
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    // 2. 如果部位相同，則依名稱筆畫/字母排序
    return a.name.localeCompare(b.name);
  });
}
const COLOR_DEF_MAP = [
  { hex: '#7e22ce', family: 'purple', type: 'stabilizer', name: '頭頸 (穩定肌)' },
  { hex: '#e9d5ff', family: 'purple', type: 'phasic', name: '頭頸 (相位肌)' },
  { hex: '#3730a3', family: 'indigo', type: 'stabilizer', name: '肩部 (穩定肌)' },
  { hex: '#a5b4fc', family: 'indigo', type: 'phasic', name: '肩部 (相位肌)' },
  { hex: '#0f766e', family: 'teal', type: 'stabilizer', name: '上背 (穩定肌)' },
  { hex: '#5eead4', family: 'teal', type: 'phasic', name: '上背 (相位肌)' },
  { hex: '#1d4ed8', family: 'blue', type: 'stabilizer', name: '手臂 (穩定肌)' },
  { hex: '#93c5fd', family: 'blue', type: 'phasic', name: '手臂 (相位肌)' },
  { hex: '#15803d', family: 'green', type: 'stabilizer', name: '胸腹 (穩定肌)' },
  { hex: '#86efac', family: 'green', type: 'phasic', name: '胸腹 (相位肌)' },
  { hex: '#b45309', family: 'amber', type: 'stabilizer', name: '腰部 (穩定肌)' },
  { hex: '#fcd34d', family: 'amber', type: 'phasic', name: '腰部 (相位肌)' },
  { hex: '#be123c', family: 'rose', type: 'stabilizer', name: '臀部 (穩定肌)' },
  { hex: '#fda4af', family: 'rose', type: 'phasic', name: '臀部 (相位肌)' },
  { hex: '#78350f', family: 'stone', type: 'stabilizer', name: '大腿 (穩定肌)' },
  { hex: '#d6d3d1', family: 'stone', type: 'phasic', name: '大腿 (相位肌)' },
  { hex: '#334155', family: 'slate', type: 'stabilizer', name: '小腿 (穩定肌)' },
  { hex: '#94a3b8', family: 'slate', type: 'phasic', name: '小腿 (相位肌)' },
  { hex: '#0891b2', family: 'cyan', type: 'stabilizer', name: '踝部 (穩定肌)' },
  { hex: '#67e8f9', family: 'cyan', type: 'phasic', name: '踝部 (相位肌)' },
  { hex: '#c2410c', family: 'orange', type: 'stabilizer', name: '足部 (穩定肌)' },
  { hex: '#fdba74', family: 'orange', type: 'phasic', name: '足部 (相位肌)' }, 

  // --- 特殊組織色系 ---
  { hex: '#eab308', family: 'nerve', type: 'nerve', name: '神經 (Nerve)' },       // 鮮明黃色
  { hex: '#6b7280', family: 'ligament', type: 'ligament', name: '韌帶 (Ligament)' }, // 中性灰色
  { hex: '#ec4899', family: 'fascia', type: 'fascia', name: '筋膜 (Fascia)' },     // 亮粉紅色 (區隔紅色系)
  { hex: '#000000', family: 'other', type: 'other', name: '特殊/其他' },
];

const COLOR_OPTIONS = COLOR_DEF_MAP.map(c => ({ color: c.hex, hint: c.name }));
const COLORS_DEF = COLOR_DEF_MAP.map(c => c.hex);

const BODY_COLOR_MAP = {
  'head': 'purple', 'neck': 'purple',
  'shoulder': 'indigo',
  'upper-back': 'teal',
  'chest': 'green', 'abdomen': 'green',
  'arm': 'blue',
  'lower-back': 'amber',
  'hip': 'rose',
  'leg': 'stone', 'knee': 'stone',
  'calf': 'slate', 
  'ankle': 'cyan', 
  'foot': 'orange' 
};

const SettingsApp = {
  state: {
    currentTab: 'assessment',
    assessmentList: [],
    muscleList: [],
    templateList: [],
    pendingDelete: null,
    isInitialized: false, //防止重複初始化
  },

  init() {
 //幽靈元素防護：如果當前頁面不是設定頁 (沒有 .settings-main 容器)，直接退出
   if (!document.querySelector('.settings-main')) return;
    console.log('🚀 SettingsApp initializing (Defensive Mode)...');
    
    // 檢查依賴
    if (!window.AppDataManager) {
      console.error('❌ AppDataManager not found!');
      // 改為非侵入式提示，避免在非設定頁面引用此腳本時彈窗
      console.warn('系統核心未載入，SettingsApp 功能受限');
      return;
    }

    // 1. 初始化隱藏檔案輸入框 (for Import)
    this.createHiddenFileInput();
    this.createUnifiedImportInput();
    this.createCustomerJSONInput(); //初始化顧客 JSON 輸入框

    // 2. 渲染複選框群組 (加入防禦)
    this.renderCheckboxes('muscle-bodyparts', 'muscle-part');
    this.renderCheckboxes('assessment-bodyparts-check', 'assessment-part');

    // 3. 渲染色盤
    this.renderColorPalette();

    // 4. 更新儲存空間資訊
    this.updateStorageInfo();

    // 5. 綁定搜尋輸入事件 (使用 Optional Chaining 防止報錯)
    document.getElementById('assessment-search')?.addEventListener('input', (e) => this.renderAssessmentList(e.target.value));
    document.getElementById('muscle-search')?.addEventListener('input', (e) => this.renderMuscleList(e.target.value));
    document.getElementById('template-search')?.addEventListener('input', (e) => this.renderTemplateList(e.target.value));

    // 6. 預設顯示第一個分頁
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab') || 'assessment';
    this.switchTab(tab);
  },

  // === 頁籤切換 ===
  switchTab(tabId) {
    // 切換按鈕狀態
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // 切換面板顯示 (加入防禦檢查)
    document.querySelectorAll('.tab-panel').forEach(panel => {
      if (panel) {
        panel.classList.toggle('active', panel.id === `panel-${tabId}`);
      }
    });

    this.state.currentTab = tabId;

    // 根據分頁載入資料
    if (tabId === 'assessment') this.loadAssessmentList();
    if (tabId === 'muscle') this.loadMuscleList();
    if (tabId === 'template') this.loadTemplateList();
    if (tabId === 'bodypart') this.renderBodyPartList();
    if (tabId === 'system') this.updateStorageInfo();
    
    if (tabId === 'sync') {
        if (window.AppSyncManager) {
            window.AppSyncManager.init();
        } else {
            console.warn('AppSyncManager not loaded');
        }
    }
  },

  // === 評估動作功能 ===
  loadAssessmentList() {
    this.state.assessmentList = window.AppAssessmentManager.getAllActions();
    this.renderAssessmentList();
  },

  renderAssessmentList(keyword = '') {
    // 防止 list 為 null
    const list = (this.state.assessmentList || []).filter(item => 
      !keyword || item.name.toLowerCase().includes(keyword.toLowerCase())
    );
    
    const container = document.getElementById('assessment-list');
    // Lazy Check: 如果找不到容器就停止渲染，避免崩潰
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">無資料</div>';
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="list-item">
        <div class="item-content">
          <div class="item-title">
            ${window.escapeHtml(item.name)}
            <span class="badge">${this.getPartNames(item.bodyPart)}</span>
          </div>
          <div class="item-desc">${window.escapeHtml(item.description)}</div>
        </div>
        <div class="item-actions">
          ${!item.isDefault ? `
            <button class="btn-icon" onclick="SettingsApp.showEditAssessmentModal('${item.id}')" title="編輯">✏️</button>
            <button class="btn-icon" onclick="SettingsApp.confirmDelete('assessment', '${item.id}')" title="刪除">🗑️</button>
          ` : '<span style="font-size:12px;color:#999">🔒</span>'}
        </div>
      </div>
    `).join('');
  },

  // === 編輯評估動作邏輯 ===
  showEditAssessmentModal(id) {
    const action = window.AppAssessmentManager.getActionById(id);
    if (!action) return alert('找不到資料');

    document.getElementById('edit-assessment-id').value = action.id;
    document.getElementById('edit-assessment-name').value = action.name;
    document.getElementById('edit-assessment-description').value = action.description || '';
    
    // 渲染複選框並勾選
    this.renderCheckboxes('edit-assessment-bodyparts-check', 'edit-assessment-part');
    const parts = Array.isArray(action.bodyPart) ? action.bodyPart : [action.bodyPart];
    document.querySelectorAll('input[name="edit-assessment-part"]').forEach(cb => {
        cb.checked = parts.includes(cb.value);
    });
    
    // 渲染並勾選關聯肌群
    const muscleTags = window.AppTagManager.getTagsByCategory('muscleGroup');
    const displayTags = Array.isArray(muscleTags) ? muscleTags : (muscleTags.data || []);
    this.renderRelatedCheckboxes('edit-assessment-rel-muscles', 'edit-assessment-muscle', displayTags);
    this.setCheckedValues('edit-assessment-muscle', action.relatedMuscles);

    this.openModal('modal-edit-assessment');
  },

  updateAssessment(e) {
    e.preventDefault();
    const id = document.getElementById('edit-assessment-id').value;
    const name = document.getElementById('edit-assessment-name').value.trim();
    const parts = Array.from(document.querySelectorAll('input[name="edit-assessment-part"]:checked')).map(cb => cb.value);
    const desc = document.getElementById('edit-assessment-description').value.trim();

    if (!name) return alert('請輸入動作名稱');
    if (parts.length === 0) return alert('請至少選擇一個部位');

    const relatedMuscles = this.getCheckedValues('edit-assessment-muscle');
    const result = window.AppAssessmentManager.updateAction(id, { name, bodyPart: parts, description: desc, relatedMuscles });
    
    if (result.success) {
      this.closeModal('modal-edit-assessment');
      this.loadAssessmentList();
      this.showToast('更新成功', 'success');
    } else {
      alert('更新失敗: ' + result.error);
    }
  },

  saveAssessment(e) {
    e.preventDefault();
    const name = document.getElementById('assessment-name').value.trim();
    // 獲取複選框的值
    const parts = Array.from(document.querySelectorAll('input[name="assessment-part"]:checked')).map(cb => cb.value);
    const desc = document.getElementById('assessment-description').value.trim();

    if (!name) return alert('請輸入動作名稱');
    if (parts.length === 0) return alert('請至少選擇一個部位');
    
    const relatedMuscles = this.getCheckedValues('assessment-muscle'); // 收集肌群 ID
    const result = window.AppAssessmentManager.addAction({
      name,
      bodyPart: parts, // 支援陣列
      description: desc
      relatedMuscles: relatedMuscles // 傳入 DataManager
    });

    if (result.success) {
      this.closeModal('modal-add-assessment');
      this.loadAssessmentList();
      alert('新增成功');
    } else {
      alert('新增失敗: ' + result.errors);
    }
  },

  exportAssessments() {
    const result = window.AppDataExportService.exportAssessmentsToCSV();
    if (result.success) {
      this.downloadFile(result.csv, 'assessments.csv', 'text/csv');
    } else {
      alert('匯出失敗: ' + result.error);
    }
  },
// === 常用模板功能 ===
  loadTemplateList() {
    this.state.templateList = window.AppTemplateManager.getAllTemplates();
    this.renderTemplateList();
  },

  renderTemplateList(keyword = '') {
    const list = (this.state.templateList || []).filter(item => 
      !keyword || 
      item.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (item.symptomTag && item.symptomTag.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    const container = document.getElementById('template-list');
    
    // [P1] Lazy Check: 如果找不到容器就停止渲染，避免崩潰
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">無資料</div>';
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="list-item">
        <div class="item-content">
          <div class="item-title">
            ${window.escapeHtml(item.name)}
            ${item.symptomTag ? `<span class="badge" style="background:#8b5cf6">症狀: ${window.escapeHtml(item.symptomTag)}</span>` : ''}
          </div>
          <div class="item-desc">觸發部位: ${this.getPartNames(item.relatedBodyParts)}</div>
        </div>
        <div class="item-actions">
           <button class="btn-icon" onclick="SettingsApp.showEditTemplateModal('${item.id}')" title="編輯">✏️</button>
           <button class="btn-icon" onclick="SettingsApp.confirmDelete('template', '${item.id}')" title="刪除">🗑️</button>
        </div>
      </div>
    `).join('');
  },

  // --- 新增模板 Modal ---
  showAddTemplateModal() {
    document.getElementById('form-add-template').reset();
    
    // 1. 渲染觸發部位 (靜態定義)
    this.renderCheckboxes('tpl-bodyparts', 'tpl-part');
    
    // 2. 渲染關聯資料 (動態撈取)
    // 相容直接回傳陣列或包含 .data 的物件
    const muscleTags = window.AppTagManager.getTagsByCategory('muscleGroup');
    const displayTags = Array.isArray(muscleTags) ? muscleTags : (muscleTags.data || []);

    this.renderRelatedCheckboxes('tpl-rel-muscles', 'tpl-muscle', displayTags);
    this.renderRelatedCheckboxes('tpl-rel-assessments', 'tpl-assessment', window.AppAssessmentManager.getAllActions());

    this.openModal('modal-add-template');
  },

  saveTemplate(e) {
    e.preventDefault();
    
    // 收集基本資料
    const name = document.getElementById('tpl-name').value.trim();
    const symptomTag = document.getElementById('tpl-symptom').value.trim();
    const bodyParts = this.getCheckedValues('tpl-part');
    
    // 收集文字內容 (直接傳字串，DataManager 會處理切割)
    const content = {
        complaints: document.getElementById('tpl-complaints').value,
        findings: document.getElementById('tpl-findings').value,
        treatments: document.getElementById('tpl-treatments').value,
        recommendations: document.getElementById('tpl-recommendations').value
    };

    // 收集關聯 ID
    const relatedMuscles = this.getCheckedValues('tpl-muscle');
    const relatedAssessments = this.getCheckedValues('tpl-assessment');

    if (!name) return alert('請輸入模板名稱');
    if (bodyParts.length === 0) return alert('請至少選擇一個觸發部位');

    const result = window.AppTemplateManager.addTemplate({
        name,
        symptomTag,
        relatedBodyParts: bodyParts,
        content,
        relatedMuscles,
        relatedAssessments
    });

    if (result.success) {
        this.closeModal('modal-add-template');
        this.loadTemplateList();
        this.showToast('模板新增成功', 'success');
    } else {
        alert('新增失敗: ' + result.error);
    }
  },

  // --- 編輯模板 Modal ---
  showEditTemplateModal(id) {
    const tpl = window.AppTemplateManager.getTemplateById(id);
    if (!tpl) return alert('找不到模板資料');

    document.getElementById('edit-tpl-id').value = tpl.id;
    document.getElementById('edit-tpl-name').value = tpl.name;
    document.getElementById('edit-tpl-symptom').value = tpl.symptomTag || '';

    // 1. 渲染並勾選觸發部位
    this.renderCheckboxes('edit-tpl-bodyparts', 'edit-tpl-part');
    this.setCheckedValues('edit-tpl-part', tpl.relatedBodyParts);

    // 2. 填入文字內容 (將陣列轉回換行字串顯示)
    const toText = (arr) => Array.isArray(arr) ? arr.join('\n') : (arr || '');
    document.getElementById('edit-tpl-complaints').value = toText(tpl.textItems?.complaints);
    document.getElementById('edit-tpl-findings').value = toText(tpl.textItems?.findings);
    document.getElementById('edit-tpl-treatments').value = toText(tpl.textItems?.treatments);
    document.getElementById('edit-tpl-recommendations').value = toText(tpl.textItems?.recommendations);

    // 3. 渲染並勾選關聯資料
    // 肌群
    // 相容直接回傳陣列或包含 .data 的物件
    const muscleTags = window.AppTagManager.getTagsByCategory('muscleGroup');
    const muscles = Array.isArray(muscleTags) ? muscleTags : (muscleTags.data || []);
    
    this.renderRelatedCheckboxes('edit-tpl-rel-muscles', 'edit-tpl-muscle', muscles);
    this.setCheckedValues('edit-tpl-muscle', tpl.relatedMuscles);

    // 評估
    const assessments = window.AppAssessmentManager.getAllActions();
    this.renderRelatedCheckboxes('edit-tpl-rel-assessments', 'edit-tpl-assessment', assessments);
    this.setCheckedValues('edit-tpl-assessment', tpl.relatedAssessments);

    this.openModal('modal-edit-template');
  },

  updateTemplate(e) {
    e.preventDefault();
    const id = document.getElementById('edit-tpl-id').value;
    
    const updates = {
        name: document.getElementById('edit-tpl-name').value.trim(),
        symptomTag: document.getElementById('edit-tpl-symptom').value.trim(),
        relatedBodyParts: this.getCheckedValues('edit-tpl-part'),
        content: {
            complaints: document.getElementById('edit-tpl-complaints').value,
            findings: document.getElementById('edit-tpl-findings').value,
            treatments: document.getElementById('edit-tpl-treatments').value,
            recommendations: document.getElementById('edit-tpl-recommendations').value
        },
        relatedMuscles: this.getCheckedValues('edit-tpl-muscle'),
        relatedAssessments: this.getCheckedValues('edit-tpl-assessment')
    };

    if (!updates.name) return alert('請輸入模板名稱');
    if (updates.relatedBodyParts.length === 0) return alert('請至少選擇一個觸發部位');

    const result = window.AppTemplateManager.updateTemplate(id, updates);

    if (result.success) {
        this.closeModal('modal-edit-template');
        this.loadTemplateList();
        this.showToast('模板更新成功', 'success');
    } else {
        alert('更新失敗: ' + result.error);
    }
  },

  // --- 模板輔助函式 ---
  // 渲染動態關聯資料的複選框 (肌群/評估)
  renderRelatedCheckboxes(containerId, name, dataList) {
    const el = document.getElementById(containerId);
    if (!el) return;
    
    if (dataList.length === 0) {
        el.innerHTML = '<span style="color:#999;font-size:12px;">無可用資料，請先至對應分頁新增。</span>';
        return;
    }

    el.innerHTML = dataList.map(item => `
        <label class="checkbox-item" style="display:flex; align-items:center; margin-bottom:4px;">
          <input type="checkbox" name="${name}" value="${item.id}"> 
          <span style="margin-left:6px;">${window.escapeHtml(item.name)}</span>
        </label>
    `).join('');
  },

  getCheckedValues(name) {
      return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);
  },

  setCheckedValues(name, values) {
      if (!values) return;
      const arr = Array.isArray(values) ? values : [values];
      document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
          cb.checked = arr.includes(cb.value);
      });
  },
  // === 肌群標籤功能 ===
  loadMuscleList() {
    const res = window.AppTagManager.getTagsByCategory('muscleGroup');
    let list = Array.isArray(res) ? res : (res.data || []);
    this.state.muscleList = sortTagsByBodyPart(list);
    this.renderMuscleList();
  },

  renderMuscleList(keyword = '') {
    const list = (this.state.muscleList || []).filter(item => 
      !keyword || item.name.toLowerCase().includes(keyword.toLowerCase())
    );
    
    const container = document.getElementById('muscle-list');
    
    // [P1] Lazy Check: 如果找不到容器就停止渲染，避免崩潰
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">無資料</div>';
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="list-item">
        <div class="item-content">
          <div class="item-title">
            <span class="tag-color-dot" style="background:${item.color || '#3b82f6'}"></span>
            ${window.escapeHtml(item.name)}
          </div>
          <div class="item-desc">部位: ${this.getPartNames(item.relatedBodyParts)}</div>
        </div>
        <div class="item-actions">
           ${!item.isDefault ? `
             <button class="btn-icon" onclick="SettingsApp.showEditMuscleTagModal('${item.id}')" title="編輯">✏️</button>
             <button class="btn-icon" onclick="SettingsApp.confirmDelete('muscle', '${item.id}')" title="刪除">🗑️</button>
           ` : '<span style="font-size:12px;color:#999">🔒</span>'}
        </div>
      </div>
    `).join('');
  },

  // === 編輯肌群標籤邏輯 ===
  showEditMuscleTagModal(id) {
    const tag = window.AppTagManager.getTagById(id);
    if (!tag) return alert('找不到資料');

    document.getElementById('edit-muscle-id').value = tag.id;
    document.getElementById('edit-muscle-name').value = tag.name;
    
    // 渲染複選框並勾選
    this.renderCheckboxes('edit-muscle-bodyparts', 'edit-muscle-part');
    const parts = tag.relatedBodyParts || [];
    document.querySelectorAll('input[name="edit-muscle-part"]').forEach(cb => {
        cb.checked = parts.includes(cb.value);
    });

    // 1. 定義 Hex 驗證正則 (支援 #RGB 與 #RRGGBB)
    const hexRegex = /^#([0-9A-F]{3}){1,2}$/i;
    
    // 2. 驗證並決定使用的顏色 (Fallback 機制)
    let safeColor = tag.color;
    if (!safeColor || !hexRegex.test(safeColor)) {
        console.warn(`⚠️ 偵測到無效色碼: "${tag.color}"，已自動重置為預設值。`);
        safeColor = COLORS_DEF[0] || '#000000'; // Fallback 到第一個定義色或黑色
    }

    // 3. 安全查找定義 (使用 Optional Chaining)
    const colorDef = COLOR_DEF_MAP.find(c => c.hex === safeColor);
    const type = colorDef?.type || 'other'; // 如果找不到定義，歸類為 other

    // 4. 勾選對應的 Radio
    const radio = document.querySelector(`input[name="edit-muscle-type"][value="${type}"]`);
    if (radio) radio.checked = true;

    // 渲染並選中顏色
    const palette = document.getElementById('edit-color-palette');
    palette.innerHTML = COLOR_OPTIONS.map(opt => `
      <div class="color-option ${opt.color === tag.color ? 'selected' : ''}" 
           style="background:${opt.color}" 
           title="${opt.hint}"
           onclick="SettingsApp.selectEditColor('${opt.color}', this)"></div>
    `).join('');

    document.getElementById('edit-muscle-color').value = safeColor;
    const textEl = document.getElementById('edit-selected-color-name');
    if (textEl) {
        // 安全存取 .name 屬性
        textEl.textContent = colorDef?.name || '自訂/未知顏色';
        textEl.style.color = safeColor;
    }

    this.openModal('modal-edit-muscle');
  },

  selectEditColor(color, el) {
    document.getElementById('edit-muscle-color').value = color;
    document.querySelectorAll('#edit-color-palette .color-option').forEach(d => d.classList.remove('selected'));
    if (el) el.classList.add('selected');

    // [Fix] 使用 Optional Chaining 防禦
    const def = COLOR_DEF_MAP.find(c => c.hex === color);
    const textEl = document.getElementById('edit-selected-color-name');
    if (textEl) {
        textEl.textContent = def?.name || '自訂顏色';
        // 只有在顏色有效時才設定 style，避免污染 DOM
        if (/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
            textEl.style.color = color;
        }
    }
  },

  updateMuscleTag(e) {
    e.preventDefault();
    const id = document.getElementById('edit-muscle-id').value;
    const name = document.getElementById('edit-muscle-name').value.trim();
    const parts = Array.from(document.querySelectorAll('input[name="edit-muscle-part"]:checked')).map(cb => cb.value);
    const color = document.getElementById('edit-muscle-color').value;

    if (!name) return alert('請輸入標籤名稱');
    if (parts.length === 0) return alert('請至少選擇一個關聯部位');

    const result = window.AppTagManager.updateTag(id, { name, relatedBodyParts: parts, color });

    if (result.success) {
      this.closeModal('modal-edit-muscle');
      this.loadMuscleList();
      this.showToast('更新成功', 'success');
    } else {
      alert('更新失敗: ' + result.errors);
    }
  },

  saveMuscleTag(e) {
    e.preventDefault();
    const name = document.getElementById('muscle-name').value.trim();
    const parts = Array.from(document.querySelectorAll('input[name="muscle-part"]:checked')).map(cb => cb.value);
    const color = document.getElementById('muscle-color').value;

    if (!name) return alert('請輸入標籤名稱');
    if (parts.length === 0) return alert('請至少選擇一個關聯部位');

    // 呼叫 DataManager.addTag
    const result = window.AppTagManager.addTag('muscleGroup', { 
        name, 
        relatedBodyParts: parts, 
        color 
    });

    if (result.success) {
      this.closeModal('modal-add-muscle');
      this.loadMuscleList();
      alert('新增成功');
    } else {
      alert('新增失敗: ' + (result.errors || result.error));
    }
  },

  // === 輔助功能：複選框與色盤 ===
  renderCheckboxes(containerId, name) {
    const el = document.getElementById(containerId);
    // [P1] 如果找不到容器直接跳過，不報錯
    if (!el) return;

    // 判斷是新增還是編輯模式 (根據 name)
    const mode = name === 'muscle-part' ? "'add'" : (name === 'edit-muscle-part' ? "'edit'" : "null");
    const eventHandler = (mode !== "null" && containerId.includes('muscle')) ? `onchange="autoSelectColor(${mode})"` : "";

    // 加上 escape 確保一致性
    el.innerHTML = SIMPLIFIED_BODY_PARTS.map(p => `
      <label class="checkbox-item">
        <input type="checkbox" name="${name}" value="${p.id}" ${eventHandler}> ${window.escapeHtml(p.name)}
      </label>
    `).join('');
  },

  renderColorPalette() {
    const el = document.getElementById('color-palette');
    if (el) {
      el.innerHTML = COLOR_OPTIONS.map(opt => `
        <div class="color-option" 
             style="background:${opt.color}" 
             title="${opt.hint}" 
             onclick="SettingsApp.selectColor('${opt.color}', this)">
        </div>
      `).join('');
    }
  },

  selectColor(color, el) {
    document.getElementById('muscle-color').value = color;
    document.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
    if (el) el.classList.add('selected');
    
    // [Fix] 使用 Optional Chaining 防禦
    const def = COLOR_DEF_MAP.find(c => c.hex === color);
    const textEl = document.getElementById('add-selected-color-name');
    if (textEl) {
        textEl.textContent = def?.name || '自訂顏色';
        // 只有在顏色有效時才設定 style
        if (/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
            textEl.style.color = color;
        }
    }
  },

  renderBodyPartList() {
    const container = document.getElementById('bodypart-list');
    if (container) {
      container.innerHTML = BODY_PARTS_DEF.map(p => `
        <div class="list-item">
          <div class="item-content">
            <div class="item-title">${p.name}</div>
            <div class="item-desc">ID: ${p.id}</div>
          </div>
        </div>
      `).join('');
    }
  },

  getPartNames(ids) {
    if (!ids) return '';
    const arr = Array.isArray(ids) ? ids : [ids];
    return arr.map(id => {
      const part = BODY_PARTS_DEF.find(p => p.id === id);
      return part ? part.name : id;
    }).join(', ');
  },

  // === 系統操作 ===
  updateStorageInfo() {
    if (!window.AppStorage) return;
    const usage = window.AppStorage.getStorageUsage();
    const bar = document.getElementById('storage-progress');
    const text = document.getElementById('storage-text');
    
    if (bar && text) {
      bar.style.width = usage.percentage + '%';
      text.textContent = `${usage.usedMB} MB / ${usage.maxMB} MB (${usage.percentage}%)`;
    }
  },

  exportAllData() {
    const result = window.AppDataExportService.exportAllData();
    if (result.success) {
      const fileName = `osteopathy-backup-${new Date().toISOString().slice(0,10)}.json`;
      this.downloadFile(JSON.stringify(result.data, null, 2), fileName, 'application/json');
    } else {
      alert('匯出失敗: ' + result.error);
    }
  },

  importData() {
    document.getElementById('import-file-input').click();
  },
// === 一設定檔匯出/匯入 ===
  
  exportUnifiedConfig() {
    const result = window.AppDataExportService.exportUnifiedConfigCSV();
    if (result.success) {
      this.downloadFile(result.csv, result.filename, 'text/csv');
    } else {
      alert('匯出失敗: ' + result.error);
    }
  },

  importUnifiedConfig() {
    const input = document.getElementById('unified-import-input');
    if (input) input.click();
  },

  handleUnifiedImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      const csv = ev.target.result;
      // 呼叫 DataManager 中的 importUnifiedConfigCSV
      const result = window.AppDataExportService.importUnifiedConfigCSV(csv);
      
      if (result.success) {
        alert(`匯入成功！\n已更新：\n肌群標籤: ${result.stats.tags.length} 筆\n評估動作: ${result.stats.actions.length} 筆\n服務模板: ${result.stats.templates.length} 筆`);
        location.reload(); // 重新整理頁面以套用變更
      } else {
        alert('匯入失敗: ' + result.error);
      }
      e.target.value = ''; // 重置 input
    };
    reader.readAsText(file);
  },
  // ==========================================
  // [核心] 資料匯出與匯入流程 (JSON / CSV / P2P)
  // ==========================================

  // --- 1. 完整備份 (JSON) ---
  
  exportAllData() {
    const result = window.AppDataExportService.exportAllData();
    if (result.success) {
      const fileName = `osteopathy-backup-${new Date().toISOString().slice(0,10)}.json`;
      this.downloadFile(JSON.stringify(result.data, null, 2), fileName, 'application/json');
    } else {
      alert('匯出失敗: ' + result.error);
    }
  },

  importData() {
    document.getElementById('import-file-input').click();
  },

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        // [修改] 改為呼叫分析介面，而非直接匯入
        if (window.AppDataExportService.analyzeImport) {
            const analysis = window.AppDataExportService.analyzeImport(json);
            this.showImportDecisionModal(analysis, json); // 顯示決策視窗
        } else {
            // 相容舊版 (若 DataManager 未更新)
            const result = window.AppDataExportService.importData(json);
            if (result.success) { alert('還原成功'); location.reload(); }
        }
      } catch (err) {
        alert('檔案解析失敗: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  },

  createHiddenFileInput() {
    if (!document.getElementById('import-file-input')) {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'import-file-input';
      input.style.display = 'none';
      input.accept = '.json';
      input.onchange = (e) => this.handleFileImport(e);
      document.body.appendChild(input);
    }
  },
 // ==========================================
  //  顧客資料管理
  // ==========================================

  createCustomerJSONInput() {
    if (!document.getElementById('customer-import-json')) {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'customer-import-json';
      input.style.display = 'none';
      input.accept = '.json';
      input.onchange = (e) => this.handleCustomerJSONImport(e);
      document.body.appendChild(input);
    }
  },

  exportCustomerJSON() {
    // 檢查 DataManager 是否支援
    if (window.AppDataExportService && window.AppDataExportService.exportCustomerJSON) {
        const result = window.AppDataExportService.exportCustomerJSON();
        if (result.success) {
            // 匯出完整 JSON 陣列
            this.downloadFile(JSON.stringify(result.data, null, 2), result.filename, 'application/json');
        } else {
            alert('匯出失敗: ' + result.error);
        }
    } else {
        alert('核心尚未更新 (缺少 exportCustomerJSON)');
    }
  },

  importCustomerJSON() {
    const input = document.getElementById('customer-import-json');
    if (input) input.click();
  },

  handleCustomerJSONImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const json = JSON.parse(ev.target.result);
            if (window.AppDataExportService && window.AppDataExportService.analyzeImport) {
                // 1. 標準化資料 (將陣列轉為標準匯入格式)
                const normalized = window.AppDataExportService.normalizeImportData(json);
                // 2. 執行分析
                const analysis = window.AppDataExportService.analyzeImport(normalized);
                // 3. 顯示決策視窗
                this.showImportDecisionModal(analysis, normalized);
            } else {
                alert('核心尚未更新，無法執行分析匯入');
            }
        } catch (err) {
            alert('JSON 解析失敗: ' + err.message);
        }
        e.target.value = ''; // 重置
    };
    reader.readAsText(file);
  },
  
  // --- 3. 智慧決策視窗 (Smart Merge UI) ---

  /**
   * 顯示匯入決策視窗
   * @param {Object} analysis - { new:[], newer:[], older:[], identical:[] }
   * @param {Object} sourceData - 原始匯入資料 (用於傳遞給執行函式)
   */
  showImportDecisionModal(analysis, sourceData) {
    // 暫存資料供執行時使用
    this.state.pendingImportData = sourceData;

    const modal = document.getElementById('modal-import-decision');
    if (!modal) {
        // 若 HTML 未更新，降級為傳統 Confirm
        if (confirm(`分析完成：\n新增 ${analysis.new.length} 筆\n更新 ${analysis.newer.length} 筆\n衝突(舊蓋新) ${analysis.older.length} 筆\n\n確定要匯入嗎？`)) {
            this.handleImportConfirm(); // 嘗試執行
        }
        return;
    }

    // 輔助渲染函式
    const renderSection = (sectionId, items, isChecked = true) => {
        const section = document.getElementById(sectionId);
        const list = section.querySelector('.diff-list') || section.querySelector('.data-list') || document.createElement('div');
        if (!list.className) list.className = 'diff-list'; // 確保樣式
        
        // 如果該區塊原本沒有 list 容器，插入一個
        if (!section.querySelector('.diff-list')) section.appendChild(list);

        if (items.length === 0) {
            section.style.display = 'none';
            // 清空 Checkbox 防止誤判
            const cb = section.querySelector('input[type="checkbox"]');
            if(cb) cb.checked = false;
        } else {
            section.style.display = 'block';
            const cb = section.querySelector('input[type="checkbox"]');
            if(cb) cb.checked = isChecked;

            // 渲染列表 (最多顯示 5 筆摘要)
            const previewItems = items.slice(0, 5);
            list.innerHTML = previewItems.map(item => `
                <div class="diff-item" style="font-size:13px; padding:4px 0; border-bottom:1px solid #eee;">
                    <span style="font-weight:bold;">${window.escapeHtml(item.name)}</span>
                    <span style="color:#666; margin-left:8px;">(${item.id})</span>
                    ${item.updatedAt ? `<div style="font-size:11px; color:#999;">更新: ${new Date(item.updatedAt).toLocaleString()}</div>` : ''}
                </div>
            `).join('');
            
            if (items.length > 5) {
                list.innerHTML += `<div style="text-align:center; font-size:12px; color:#666; padding:5px;">... 還有 ${items.length - 5} 筆</div>`;
            }
        }
    };

    // 渲染三個區塊
    renderSection('import-section-new', analysis.new, true);      // 綠燈：預設勾選
    renderSection('import-section-update', analysis.newer, true); // 藍燈：預設勾選
    renderSection('import-section-conflict', analysis.older, false); // 黃燈：預設不勾選 (保護)

    // 如果全部都沒資料 (只有 identical)
    if (analysis.new.length === 0 && analysis.newer.length === 0 && analysis.older.length === 0) {
        alert('比對完成：資料內容完全一致，無需匯入。');
        return;
    }

    this.openModal('modal-import-decision');
  },

  /**
   * 執行匯入 (含重試邏輯)
   */
  handleImportConfirm() {
    const sourceData = this.state.pendingImportData;
    if (!sourceData) return;

    // 收集使用者勾選的區塊
    const selectionMap = {
        includeNew: document.querySelector('#import-section-new input[type="checkbox"]')?.checked || false,
        includeNewer: document.querySelector('#import-section-update input[type="checkbox"]')?.checked || false,
        includeOlder: document.querySelector('#import-section-conflict input[type="checkbox"]')?.checked || false
    };

    if (!selectionMap.includeNew && !selectionMap.includeNewer && !selectionMap.includeOlder) {
        alert('未選擇任何資料，取消匯入。');
        this.closeModal('modal-import-decision');
        return;
    }

    // 執行邏輯 (含 Retry)
    try {
        if(window.showLoading) window.showLoading('匯入中 (正在備份舊資料)...');
        
        // 第一次嘗試：標準模式 (skipBackup: false)
        const result = window.AppDataManager.executeSmartImport(selectionMap, sourceData, { skipBackup: false });
        
        this.handleImportSuccess(result);

    } catch (error) {
        if(window.hideLoading) window.hideLoading();

        // 捕捉容量不足錯誤 (ERR_BACKUP_QUOTA)
        if (error.code === 'ERR_BACKUP_QUOTA' || error.message.includes('QuotaExceeded')) {
            const confirmForce = confirm(
                '⚠️ 儲存空間嚴重不足，無法建立安全備份！\n\n' +
                '系統無法將舊資料移入回收桶。\n' +
                '您希望「跳過備份」並強制覆蓋現有資料嗎？\n\n' +
                '(注意：此操作無法復原，被覆蓋的資料將永久遺失)'
            );

            if (confirmForce) {
                try {
                    if(window.showLoading) window.showLoading('強制匯入中...');
                    // 第二次嘗試：強制模式
                    const result = window.AppDataManager.executeSmartImport(selectionMap, sourceData, { skipBackup: true });
                    this.handleImportSuccess(result);
                } catch (forceError) {
                    if(window.hideLoading) window.hideLoading();
                    alert('強制匯入仍然失敗: ' + forceError.message);
                }
            }
        } else {
            alert('匯入發生錯誤: ' + error.message);
        }
    }
  },

  handleImportSuccess(result) {
      if(window.hideLoading) window.hideLoading();
      this.closeModal('modal-import-decision');
      this.state.pendingImportData = null; // 清理記憶體
      
      let msg = `匯入完成！\n成功寫入: ${result.count} 筆`;
      if (result.skipped > 0) msg += `\n略過: ${result.skipped} 筆`;
      alert(msg);
      location.reload();
  },
  clearAllData() {
    if (confirm('【嚴重警告】\n此操作將永久刪除所有資料且無法復原！\n確定要清空嗎？')) {
      localStorage.clear();
      alert('資料已清空，系統將重新載入。');
      location.reload();
    }
  },
  cleanOrphans() {
    if (!window.AppStorage) return;
    
    if (confirm('此操作將掃描系統內部，並刪除「無效的殘留檔案」以釋放空間。\n(不會影響正常的顧客資料)\n\n確定要執行嗎？')) {
        const result = window.AppStorage.vacuum();
        if (result.success) {
            if (result.removedCount > 0) {
                alert(`掃描完成！\n共清除了 ${result.removedCount} 個殘留檔案，釋放了 ${result.freedKB} KB 空間。`);
                this.updateStorageInfo(); // 立即更新空間顯示條
            } else {
                alert('掃描完成。系統很健康，沒有發現殘留檔案。');
            }
        } else {
            alert('清理失敗: ' + result.error);
        }
    }
  },
  // === Modal 控制 ===
  showAddAssessmentModal() {
    document.getElementById('form-add-assessment').reset();
    // 渲染肌群選項
    const muscleTags = window.AppTagManager.getTagsByCategory('muscleGroup');
    const displayTags = Array.isArray(muscleTags) ? muscleTags : (muscleTags.data || []);
    this.renderRelatedCheckboxes('assessment-rel-muscles', 'assessment-muscle', displayTags);

    this.openModal('modal-add-assessment');
  },

  showAddMuscleTagModal() {
    document.getElementById('form-add-muscle').reset();
    // 預設選取第一個顏色
    const firstColor = document.querySelector('.color-option');
    if (firstColor) this.selectColor(COLORS_DEF[0], firstColor);
    
    // [修正] 更新 Radio Group HTML 包含新選項 (針對 新增表單)
    const radioGroup = document.querySelector('#form-add-muscle .radio-group');
    if (radioGroup) {
        radioGroup.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:10px;">
                <label><input type="radio" name="muscle-type" value="stabilizer" onchange="autoSelectColor('add')"> 穩定肌</label>
                <label><input type="radio" name="muscle-type" value="phasic" onchange="autoSelectColor('add')"> 相位肌</label>
                <label><input type="radio" name="muscle-type" value="nerve" onchange="autoSelectColor('add')"> 神經</label>
                <label><input type="radio" name="muscle-type" value="ligament" onchange="autoSelectColor('add')"> 韌帶</label>
                <label><input type="radio" name="muscle-type" value="fascia" onchange="autoSelectColor('add')"> 筋膜</label>
                <label><input type="radio" name="muscle-type" value="other" onchange="autoSelectColor('add')" checked> 其他</label>
            </div>
        `;
    }

    this.openModal('modal-add-muscle');
  },

  confirmDelete(type, id) {
    this.state.pendingDelete = { type, id };
    this.openModal('modal-confirm-delete');
  },

  executeDelete() {
    const { type, id } = this.state.pendingDelete;
    if (!type || !id) return;

    let result = { success: false };
    if (type === 'assessment') result = window.AppAssessmentManager.deleteAction(id);
    if (type === 'muscle') result = window.AppTagManager.deleteTag(id);
    if (type === 'template') result = window.AppTemplateManager.deleteTemplate(id);

    if (result.success) {
      this.closeModal('modal-confirm-delete');
      // 重新載入當前列表
      if (type === 'assessment') this.loadAssessmentList();
      if (type === 'muscle') this.loadMuscleList();
      if (type === 'template') this.loadTemplateList();
      this.showToast('刪除成功', 'success');
    } else {
      alert('刪除失敗: ' + result.error);
    }
  },

  openModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.add('show');
    } else {
      console.warn(`Modal #${id} not found, cannot open.`);
    }
  },

  closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
      modal.classList.remove('show');
    }
  },

  // === 工具函式 ===
  downloadFile(content, fileName, mimeType) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  },

};

// 全域綁定與啟動
window.SettingsApp = SettingsApp;

// 更新裝置名稱 (前綴)
window.updateDeviceName = () => {
  const name = document.getElementById('p2p-device-name').value.trim();
  const result = window.AppSyncManager.setDeviceName(name);
  if (result.success) {
    SettingsApp.showToast(`ID 已更新為: ${result.newId}`, 'success');
    // 清空輸入框，讓使用者專注於下方的完整 ID
    // document.getElementById('p2p-device-name').value = ''; // 選擇性：不清空可能體驗較好
  } else {
    alert(result.error);
  }
};

// 複製完整 ID
window.copyFullId = () => {
  const idText = document.getElementById('p2p-full-id').textContent;
  if (idText && idText !== '載入中...') {
      navigator.clipboard.writeText(idText).then(() => {
          SettingsApp.showToast('完整 ID 已複製', 'success');
      }).catch(() => {
          alert('複製失敗，請手動複製');
      });
  }
};

// 自動選色邏輯 (全域函式，供 HTML onchange 呼叫)
window.autoSelectColor = (mode) => {
  // mode: 'add' or 'edit'
  
  // 1. 取得目前選中的屬性
  const typeName = mode === 'add' ? 'muscle-type' : 'edit-muscle-type';
  const type = document.querySelector(`input[name="${typeName}"]:checked`)?.value || 'other';

  // 特殊組織優先判斷 (無視部位)
  const specialTypes = ['nerve', 'ligament', 'fascia'];
  if (specialTypes.includes(type)) {
      const targetColor = COLOR_DEF_MAP.find(c => c.type === type);
      if (targetColor) {
          applyColorSelection(mode, targetColor.hex);
      }
      return;
  }

  // 2. 取得目前選中的部位 (取第一個)
  const partName = mode === 'add' ? 'muscle-part' : 'edit-muscle-part';
  const checkedParts = Array.from(document.querySelectorAll(`input[name="${partName}"]:checked`)).map(cb => cb.value);
  const mainPart = checkedParts.length > 0 ? checkedParts[0] : null;

  if (!mainPart) return;

  // 3. 查表找色系
  const family = BODY_COLOR_MAP[mainPart] || 'other';

  // 4. 根據 色系 + 屬性 找到對應的顏色定義
  let targetColor = COLOR_DEF_MAP.find(c => c.family === family && c.type === type);
  if (!targetColor && type !== 'other') {
      targetColor = COLOR_DEF_MAP.find(c => c.family === family);
  }

  if (targetColor) {
      applyColorSelection(mode, targetColor.hex);
  }
};

// 內部輔助函式：執行 UI 選色更新
function applyColorSelection(mode, hexColor) {
    const paletteId = mode === 'add' ? 'color-palette' : 'edit-color-palette';
    const paletteItem = document.querySelector(`#${paletteId} .color-option[style*="${hexColor}"]`);
    
    if (paletteItem) {
        if (mode === 'add') {
            SettingsApp.selectColor(hexColor, paletteItem);
        } else {
            SettingsApp.selectEditColor(hexColor, paletteItem);
        }
    }
}

// 綁定 HTML onclick 會用到的函式到 window
window.switchTab = (id) => SettingsApp.switchTab(id);
window.showAddAssessmentModal = () => SettingsApp.showAddAssessmentModal();
window.showAddMuscleTagModal = () => SettingsApp.showAddMuscleTagModal();
window.saveAssessment = (e) => SettingsApp.saveAssessment(e);
window.saveMuscleTag = (e) => SettingsApp.saveMuscleTag(e);
window.exportAssessments = () => SettingsApp.exportAssessments();
window.exportAllData = () => SettingsApp.exportAllData();
window.importData = () => SettingsApp.importData();
window.clearAllData = () => SettingsApp.clearAllData();
window.closeModal = (id) => SettingsApp.closeModal(id);
window.confirmDelete = () => SettingsApp.executeDelete();
window.goBack = () => window.location.href = 'customer-list.html';
window.showEditAssessmentModal = (id) => SettingsApp.showEditAssessmentModal(id);
window.updateAssessment = (e) => SettingsApp.updateAssessment(e);
window.showEditMuscleTagModal = (id) => SettingsApp.showEditMuscleTagModal(id);
window.updateMuscleTag = (e) => SettingsApp.updateMuscleTag(e);
window.showAddTemplateModal = () => SettingsApp.showAddTemplateModal();
window.saveTemplate = (e) => SettingsApp.saveTemplate(e);
window.showEditTemplateModal = (id) => SettingsApp.showEditTemplateModal(id);
window.updateTemplate = (e) => SettingsApp.updateTemplate(e);
window.cleanOrphans = () => SettingsApp.cleanOrphans();

//綁定統一匯出入接口
window.exportUnifiedConfig = () => SettingsApp.exportUnifiedConfig();
window.importUnifiedConfig = () => SettingsApp.importUnifiedConfig();
window.exportCustomerJSON = () => SettingsApp.exportCustomerJSON();
window.importCustomerJSON = () => SettingsApp.importCustomerJSON();
// 綁定決策視窗的確認按鈕
window.confirmImportDecision = () => SettingsApp.handleImportConfirm();

window.connectToPeer = () => {
  const targetId = document.getElementById('p2p-target-id').value.trim();
  if (!targetId) return alert('請輸入對方 ID');
  window.AppSyncManager.connectTo(targetId);
};
window.pushSync = () => {
  window.AppSyncManager.pushFullSync();
};

document.addEventListener('DOMContentLoaded', () => {
  const bootSettings = () => {
    // 防止重複執行
    if (SettingsApp.state.isInitialized) return;
    
    console.log('🚀 Booting SettingsApp via app-ready/flag...');
    SettingsApp.init();
    SettingsApp.state.isInitialized = true;
  };

  // 檢查 app.js 是否已經完成初始化
  if (window.isAppReady) {
    // 如果系統已經準備好 (Settings 載入較慢)，直接執行
    bootSettings();
  } else {
    // 如果系統還沒好 (Settings 載入較快)，監聽 app-ready 事件
    document.addEventListener('app-ready', bootSettings);
  }
});
