/**
 * settings.js - 系統設定頁面控制器(v2.6 Rescue)
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
 * v2.6[新增] 處理 P2P 同步操作
 */

// 定義身體部位
const BODY_PARTS_DEF = [
  { id: 'head', name: '頭部' }, { id: 'neck', name: '頸部' },
  { id: 'left-shoulder', name: '左肩' }, { id: 'right-shoulder', name: '右肩' },
  { id: 'upper-back', name: '上背' }, { id: 'lower-back', name: '下背/腰' },
  { id: 'chest', name: '胸部' }, { id: 'abdomen', name: '腹部' },
  { id: 'hip', name: '臀部' }, { id: 'left-arm', name: '左手' },
  { id: 'right-arm', name: '右手' }, { id: 'left-leg', name: '左腿' },
  { id: 'right-leg', name: '右腿' }, { id: 'left-knee', name: '左膝' },
  { id: 'right-knee', name: '右膝' }, { id: 'left-ankle', name: '左腳踝' },
  { id: 'right-ankle', name: '右腳踝' }
];

// 定義色盤 (深色=穩定肌 / 淺色=活動肌)
// 順序：頭頸(紫) -> 肩(靛) -> 上背(青) -> 手(藍) -> 胸腹(綠) -> 腰(琥珀) -> 臀(玫瑰) -> 腿(棕) -> 腳(灰) -> 特殊
const COLORS_DEF = [
  '#7e22ce', '#e9d5ff', // 頭頸 (穩/活)
  '#3730a3', '#a5b4fc', // 肩部 (穩/活)
  '#0f766e', '#5eead4', // 上背 (穩/活)
  '#1d4ed8', '#93c5fd', // 手臂 (穩/活)
  '#15803d', '#86efac', // 胸腹 (穩/活)
  '#b45309', '#fcd34d', // 腰部 (穩/活)
  '#be123c', '#fda4af', // 臀部 (穩/活)
  '#78350f', '#d6d3d1', // 大腿 (穩/活)
  '#334155', '#94a3b8', // 小腿 (穩/活)
  '#000000', '#ef4444'  // 黑/紅
];

const SettingsApp = {
  state: {
    currentTab: 'assessment',
    assessmentList: [],
    muscleList: [],
    templateList: [],
    pendingDelete: null,
  },

  init() {
    console.log('🚀 SettingsApp initializing...');
    
    // 檢查依賴
    if (!window.AppDataManager) {
      console.error('❌ AppDataManager not found!');
      alert('系統核心未載入，請重新整理頁面。');
      return;
    }

    // 1. 初始化隱藏檔案輸入框 (for Import)
    this.createHiddenFileInput();

    // 2. 渲染複選框群組
    this.renderCheckboxes('muscle-bodyparts', 'muscle-part');
    this.renderCheckboxes('assessment-bodyparts-check', 'assessment-part');

    // 3. 渲染色盤
    this.renderColorPalette();

    // 4. 更新儲存空間資訊
    this.updateStorageInfo();

    // 5. 綁定搜尋輸入事件
    document.getElementById('assessment-search')?.addEventListener('input', (e) => this.renderAssessmentList(e.target.value));
    document.getElementById('muscle-search')?.addEventListener('input', (e) => this.renderMuscleList(e.target.value));
    document.getElementById('template-search')?.addEventListener('input', (e) => this.renderTemplateList(e.target.value));
    // 6. 預設顯示第一個分頁
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab') || 'assessment';
    this.switchTab('assessment');
  },

  // === 頁籤切換 ===
  switchTab(tabId) {
    // 切換按鈕狀態
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // 切換面板顯示 (搭配 CSS 的 display: none/block)
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
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
    const list = this.state.assessmentList.filter(item => 
      !keyword || item.name.toLowerCase().includes(keyword.toLowerCase())
    );
    
    const container = document.getElementById('assessment-list');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">無資料</div>';
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="list-item">
        <div class="item-content">
          <div class="item-title">
            ${this.escape(item.name)}
            <span class="badge">${this.getPartNames(item.bodyPart)}</span>
          </div>
          <div class="item-desc">${this.escape(item.description)}</div>
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

    const result = window.AppAssessmentManager.updateAction(id, { name, bodyPart: parts, description: desc });
    
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

    const result = window.AppAssessmentManager.addAction({
      name,
      bodyPart: parts, // 支援陣列
      description: desc
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
    const list = this.state.templateList.filter(item => 
      !keyword || 
      item.name.toLowerCase().includes(keyword.toLowerCase()) ||
      (item.symptomTag && item.symptomTag.toLowerCase().includes(keyword.toLowerCase()))
    );
    
    const container = document.getElementById('template-list');
    if (!container) return;

    if (list.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:#999;">無資料</div>';
      return;
    }

    container.innerHTML = list.map(item => `
      <div class="list-item">
        <div class="item-content">
          <div class="item-title">
            ${this.escape(item.name)}
            ${item.symptomTag ? `<span class="badge" style="background:#8b5cf6">症狀: ${this.escape(item.symptomTag)}</span>` : ''}
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
          <span style="margin-left:6px;">${this.escape(item.name)}</span>
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
    this.state.muscleList = Array.isArray(res) ? res : (res.data || []);
    this.renderMuscleList();
  },

  renderMuscleList(keyword = '') {
    const list = this.state.muscleList.filter(item => 
      !keyword || item.name.toLowerCase().includes(keyword.toLowerCase())
    );
    
    const container = document.getElementById('muscle-list');
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
            ${this.escape(item.name)}
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

    // 渲染並選中顏色
    const palette = document.getElementById('edit-color-palette');
    palette.innerHTML = COLORS_DEF.map(c => `
      <div class="color-option ${c === tag.color ? 'selected' : ''}" 
           style="background:${c}" 
           onclick="SettingsApp.selectEditColor('${c}', this)"></div>
    `).join('');
    document.getElementById('edit-muscle-color').value = tag.color;

    this.openModal('modal-edit-muscle');
  },

  selectEditColor(color, el) {
    document.getElementById('edit-muscle-color').value = color;
    document.querySelectorAll('#edit-color-palette .color-option').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');
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
    if (el) {
      el.innerHTML = BODY_PARTS_DEF.map(p => `
        <label class="checkbox-item">
          <input type="checkbox" name="${name}" value="${p.id}"> ${p.name}
        </label>
      `).join('');
    }
  },

  renderColorPalette() {
    const el = document.getElementById('color-palette');
    if (el) {
      el.innerHTML = COLORS_DEF.map(c => `
        <div class="color-option" style="background:${c}" onclick="SettingsApp.selectColor('${c}', this)"></div>
      `).join('');
    }
  },

  selectColor(color, el) {
    document.getElementById('muscle-color').value = color;
    document.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
    el.classList.add('selected');
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

  handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        const result = window.AppDataExportService.importData(json);
        if (result.success) {
          alert('還原成功，系統將重新整理。');
          location.reload();
        } else {
          alert('還原失敗: ' + result.error);
        }
      } catch (err) {
        alert('檔案格式錯誤');
      }
      e.target.value = ''; // 重置 input
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

  clearAllData() {
    if (confirm('【嚴重警告】\n此操作將永久刪除所有資料且無法復原！\n確定要清空嗎？')) {
      localStorage.clear();
      alert('資料已清空，系統將重新載入。');
      location.reload();
    }
  },

  // === Modal 控制 ===
  showAddAssessmentModal() {
    document.getElementById('form-add-assessment').reset();
    this.openModal('modal-add-assessment');
  },

  showAddMuscleTagModal() {
    document.getElementById('form-add-muscle').reset();
    // 預設選取第一個顏色
    const firstColor = document.querySelector('.color-option');
    if (firstColor) this.selectColor(COLORS_DEF[0], firstColor);
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
    document.getElementById(id).classList.add('show');
  },

  closeModal(id) {
    document.getElementById(id).classList.remove('show');
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

  escape(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }
};

// 3. 全域綁定與啟動
window.SettingsApp = SettingsApp;

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

window.copyId = () => {
  const el = document.getElementById('p2p-my-id');
  el.select();
  document.execCommand('copy');
  SettingsApp.showToast('ID 已複製', 'success');
};
window.connectToPeer = () => {
  const targetId = document.getElementById('p2p-target-id').value.trim();
  if (!targetId) return alert('請輸入對方 ID');
  window.AppSyncManager.connectTo(targetId);
};
window.pushSync = () => {
  window.AppSyncManager.pushFullSync();
};

document.addEventListener('DOMContentLoaded', () => {
  SettingsApp.init();
});