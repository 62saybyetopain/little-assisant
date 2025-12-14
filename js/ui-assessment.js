/**
 * ui-assessment.js - 互動層模組 (v2.4)
 * 職責：
 * - 管理人體圖示互動（BodyDiagram）
 * - 智能篩選肌群標籤（MuscleTagSelector）
 * - 動態顯示評估動作（AssessmentSelector）
 * * 修正重點：
 * 1. 整合 AppDataManager.assessment
 * 2. 修正 getResults 資料結構
 * 3. 優化錯誤處理
 */

// ============================================
// 子模組 1: BodyDiagram - 人體圖示互動
// ============================================

class BodyDiagram {
  constructor(svgElementId) {
    this.svgElementId = svgElementId;
    this.svg = null;
    this.selectedParts = new Set();
    this.bodyParts = [];
    this.listModeHintShown = false;
  }

  init() {
    this.svg = document.getElementById(this.svgElementId);
    
    if (!this.svg) {
      console.error(`SVG element #${this.svgElementId} not found`);
      return false;
    }

    this.bodyParts = this.svg.querySelectorAll('.body-part');
    
    if (this.bodyParts.length === 0) {
      console.warn('No .body-part elements found in SVG');
      // 嘗試切換到列表模式
      this.showListModeHint();
      return false;
    }

    this.attachEventListeners();
    console.log(`BodyDiagram initialized with ${this.bodyParts.length} parts`);
    return true;
  }

  attachEventListeners() {
    this.bodyParts.forEach(part => {
      part.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePart(e.currentTarget);
      });

      part.setAttribute('tabindex', '0');
      part.setAttribute('role', 'button');
      
      part.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          this.togglePart(e.currentTarget);
        }
      });

      this.enhanceTouchTarget(part);
    });
  }

  togglePart(partElement) {
    if (!partElement || !partElement.dataset) return;
    const partName = partElement.dataset.part;
    if (!partName) return;

    // 記錄目前的選取狀態，以便傳遞給事件
    let isSelected = false;

    if (this.selectedParts.has(partName)) {
      this.selectedParts.delete(partName);
      partElement.classList.remove('selected');
      partElement.setAttribute('aria-pressed', 'false');
      isSelected = false;
    } else {
      this.selectedParts.add(partName);
      partElement.classList.add('selected');
      partElement.setAttribute('aria-pressed', 'true');
      isSelected = true;
    }

    // 傳遞變更的部位與狀態
    this.onSelectionChange(partName, isSelected);
  }

  enhanceTouchTarget(part) {
    if (!part) return false;
    const minSize = 48; 

    try {
      // 部分瀏覽器可能不支援 getBBox，需 try-catch
      if (typeof part.getBBox !== 'function') return false;
      
      const bbox = part.getBBox();
      if (!bbox || bbox.width <= 0 || bbox.height <= 0) return false;

      const widthDiff = Math.max(0, minSize - bbox.width);
      const heightDiff = Math.max(0, minSize - bbox.height);

      if (widthDiff > 0 || heightDiff > 0) {
        const padding = Math.max(widthDiff, heightDiff) / 2;
        part.style.strokeWidth = `${padding}px`;
        part.style.strokeOpacity = '0';
        part.style.pointerEvents = 'visiblePainted';
      }
      return true;
    } catch (error) {
      // getBBox 失敗不應阻斷流程
      console.warn('Touch target enhancement skipped:', error);
      return false;
    }
  }

  showListModeHint() {
    if (this.listModeHintShown) return;
    
    const container = this.findHintContainer();
    if (!container) return;

    // 檢查是否已存在
    if (document.getElementById('list-mode-hint')) return;

    const hintDiv = this.createHintElement();
    if (container.firstChild) {
      container.insertBefore(hintDiv, container.firstChild);
    } else {
      container.appendChild(hintDiv);
    }

    this.listModeHintShown = true;
  }

  findHintContainer() {
    if (this.svg && this.svg.parentElement) return this.svg.parentElement;
    return document.querySelector('.body-diagram-container') || document.body;
  }

  createHintElement() {
    const hintDiv = document.createElement('div');
    hintDiv.id = 'list-mode-hint';
    hintDiv.className = 'compatibility-hint';
    hintDiv.innerHTML = `
      <div class="hint-message">
        <span class="icon">⚠️</span>
        <span class="text">建議切換至列表模式以便操作</span>
        <button type="button" onclick="window.switchToListMode()" class="switch-mode-btn">切換模式</button>
      </div>
    `;
    return hintDiv;
  }

  getSelectedParts() {
    return Array.from(this.selectedParts);
  }

  clearSelection() {
    this.selectedParts.clear();
    this.bodyParts.forEach(part => {
      part.classList.remove('selected');
      part.setAttribute('aria-pressed', 'false');
    });
    this.onSelectionChange();
  }

  onSelectionChange(clickedPart = null, isSelected = false) {
    const event = new CustomEvent('bodyPartSelectionChanged', {
      detail: { 
        selectedParts: this.getSelectedParts(),
        source: this.svgElementId,
        clickedPart: clickedPart, // 剛被點擊的部位
        isSelected: isSelected    // 選取狀態 (true=選取, false=取消)
      }
    });
    if (this.svg) this.svg.dispatchEvent(event);
    document.dispatchEvent(event);
  }
}

// ============================================
// 子模組 2: MuscleTagSelector - 肌群標籤智能篩選
// ============================================

class MuscleTagSelector {
  constructor(containerElementId) {
    this.containerElementId = containerElementId;
    this.container = null;
    this.selectedBodyParts = [];
    this.selectedMuscleTags = new Set();
    this.allMuscleTags = [];
    this.isInitialized = false;
  }

  async init() {
    this.container = document.getElementById(this.containerElementId);
    if (!this.container) return false;

    try {
      // 載入所有肌群標籤 (改用 window.AppTagManager)
      if (window.AppTagManager) {
        const result = window.AppTagManager.getAllMuscleTags();
        this.allMuscleTags = result.success ? result.data : [];
      }
      
      document.addEventListener('bodyPartSelectionChanged', (e) => {
        this.updateForBodyParts(e.detail.selectedParts);
      });

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize MuscleTagSelector:', error);
      return false;
    }
  }

  updateForBodyParts(bodyParts) {
    this.selectedBodyParts = bodyParts;

    if (!bodyParts || bodyParts.length === 0) {
      this.container.style.display = 'none';
      // [Fix] 當沒有選取任何部位時，應清空所有肌群選擇 (防止髒資料)
      this.clearSelection(); 
      return;
    }

    // 呼叫 TagManager 的篩選邏輯
    let relevantTags = [];
    if (window.AppTagManager) {
      const result = window.AppTagManager.getMuscleTagsByBodyParts(bodyParts);
      relevantTags = result.success ? result.data : [];
    }

    // 自動移除「已選取」但「不再相關」的標籤 (對應 [P1] 取消部位後的殘留髒資料)
    // 取得新列表的所有 ID
    const relevantIds = new Set(relevantTags.map(t => t.id));
    
    // 檢查目前已選的標籤，若不在新列表中則移除
    let dirty = false;
    this.selectedMuscleTags.forEach(tagId => {
        if (!relevantIds.has(tagId)) {
            this.selectedMuscleTags.delete(tagId);
            dirty = true;
        }
    });

    if (dirty) {
        this.onTagsUpdate(); // 若有移除，發送更新事件
    }

    this.render(relevantTags);
    this.container.style.display = 'block';
    // 注意：render 內會重新綁定 class，所以視覺上會正確同步 this.selectedMuscleTags
  }

  render(tags) {
    const fragment = document.createDocumentFragment();

    if (tags.length === 0) {
      const hint = document.createElement('p');
      hint.className = 'muscle-tag-hint';
      hint.textContent = '此部位暫無相關肌群標籤';
      fragment.appendChild(hint);
    } else {
      tags.forEach(tag => {
        const button = this.createTagButton(tag);
        fragment.appendChild(button);
      });
    }

    // 預留新增按鈕位置 (階段四實作)
    // const addButton = this.createAddButton();
    // fragment.appendChild(addButton);

    this.container.innerHTML = '';
    this.container.appendChild(fragment);
  }

  createTagButton(tag) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'muscle-tag-btn';
    button.dataset.tagId = tag.id;
    button.textContent = tag.name;

    if (this.selectedMuscleTags.has(tag.id)) {
      button.classList.add('selected');
      button.setAttribute('aria-pressed', 'true');
    }

    button.addEventListener('click', () => {
      this.toggleTag(tag.id, button);
    });

    return button;
  }

  toggleTag(tagId, buttonElement) {
    if (this.selectedMuscleTags.has(tagId)) {
      this.selectedMuscleTags.delete(tagId);
      buttonElement.classList.remove('selected');
      buttonElement.setAttribute('aria-pressed', 'false');
    } else {
      this.selectedMuscleTags.add(tagId);
      buttonElement.classList.add('selected');
      buttonElement.setAttribute('aria-pressed', 'true');
    }
    this.onTagsUpdate();
  }

  getSelectedTags() {
    return Array.from(this.selectedMuscleTags);
  }

  clearSelection() {
    this.selectedMuscleTags.clear();
    const buttons = this.container.querySelectorAll('.muscle-tag-btn.selected');
    buttons.forEach(btn => btn.classList.remove('selected'));
    this.onTagsUpdate();
  }

  onTagsUpdate() {
    const event = new CustomEvent('muscleTagsUpdated', {
      detail: {
        selectedTags: this.getSelectedTags(),
        bodyParts: this.selectedBodyParts
      }
    });
    document.dispatchEvent(event);
  }
}

// ============================================
// 子模組 3: AssessmentSelector - 評估動作選擇
// ============================================

class AssessmentSelector {
  constructor(containerElementId) {
    this.containerElementId = containerElementId;
    this.container = null;
    this.selectedBodyParts = [];
    this.assessmentResults = new Map(); // key: actionId, value: "positive"|"negative"
    this.loadedActions = []; // 快取已載入的動作資料
    this.isInitialized = false;
  }

  async init() {
    this.container = document.getElementById(this.containerElementId);
    if (!this.container) return false;

    document.addEventListener('bodyPartSelectionChanged', async (e) => {
      await this.updateForBodyParts(e.detail.selectedParts);
    });

    this.isInitialized = true;
    return true;
  }

  async updateForBodyParts(bodyParts) {
    this.selectedBodyParts = bodyParts;

    if (!bodyParts || bodyParts.length === 0) {
      this.container.innerHTML = '<p class="hint">請先選擇主訴部位</p>';
      return;
    }

    try {
      const actions = await this.loadAssessmentActions(bodyParts);
      if (!this.loadedActions) this.loadedActions = [];
      const newActions = [...this.loadedActions, ...actions];

       // 去除重複 ID (Deduplication)
       const uniqueActions = [];
       const seenIds = new Set();
       for (const action of newActions) {
           if (!seenIds.has(action.id)) {
               seenIds.add(action.id);
               uniqueActions.push(action);
           }
      }
      this.loadedActions = uniqueActions; // 更新快取

      if (actions.length === 0) {
        this.container.innerHTML = '<p class="hint">此部位暫無預設評估動作</p>';
        return;
      }

      this.render(actions);

    } catch (error) {
      console.error('Failed to load assessment actions:', error);
      this.container.innerHTML = '<p class="error-hint">載入評估動作失敗</p>';
    }
  }

  /**
   * 載入評估動作 (✅ 關鍵修正：串接 AssessmentManager)
   */
  async loadAssessmentActions(bodyParts) {
    if (!window.AppAssessmentManager) {
      console.warn('AppAssessmentManager not ready');
      return [];
    }

    const allActions = new Set();
    
    // 針對每個選中的部位載入動作
    bodyParts.forEach(part => {
      const actions = window.AppAssessmentManager.getActionsByBodyPart(part);
      actions.forEach(action => allActions.add(action));
    });

    // 轉為陣列並去重 (Set 已處理物件參考去重，若為新物件需用 ID)
    const uniqueActions = Array.from(allActions);
    // 簡單去重 ID
    const seen = new Set();
    return uniqueActions.filter(a => {
      const duplicate = seen.has(a.id);
      seen.add(a.id);
      return !duplicate;
    }).sort((a, b) => a.order - b.order);
  }

  render(actions) {
    const fragment = document.createDocumentFragment();

    actions.forEach((action, index) => {
      const card = this.createActionCard(action, index);
      fragment.appendChild(card);
    });

    this.container.innerHTML = '';
    this.container.appendChild(fragment);
  }

  createActionCard(action, index) {
    const card = document.createElement('div');
    card.className = 'assessment-action-card';
    card.dataset.actionId = action.id;

    const currentResult = this.assessmentResults.get(action.id);

    // 使用 window.escapeHtml 防止 stored-XSS (對應 [P1] XSS 安全漏洞)
    // 假設 utils.js 或全局已定義 escapeHtml
    const safeName = window.escapeHtml ? window.escapeHtml(action.name) : action.name;
    const safeDesc = window.escapeHtml ? window.escapeHtml(action.description) : action.description;

    card.innerHTML = `
      <div class="action-header">
        <span class="action-number">${index + 1}</span>
        <h4 class="action-name">${safeName}</h4>
        ${action.description ? `<button class="info-btn" type="button" title="${safeDesc}">ℹ️</button>` : ''}
      </div>
      <div class="action-buttons">
        <button type="button" class="result-btn positive ${currentResult === 'positive' ? 'selected' : ''}">陽性 (+)</button>
        <button type="button" class="result-btn negative ${currentResult === 'negative' ? 'selected' : ''}">陰性 (−)</button>
      </div>
    `;

    const positiveBtn = card.querySelector('.positive');
    const negativeBtn = card.querySelector('.negative');
    const infoBtn = card.querySelector('.info-btn');

    positiveBtn.addEventListener('click', () => {
      this.selectResult(action.id, 'positive', positiveBtn, negativeBtn);
    });

    negativeBtn.addEventListener('click', () => {
      this.selectResult(action.id, 'negative', negativeBtn, positiveBtn);
    });

    if (infoBtn) {
      infoBtn.addEventListener('click', () => {
        alert(`評估動作：${action.name}\n\n${action.description}`);
      });
    }

    return card;
  }

  selectResult(actionId, result, selectedBtn, otherBtn) {
    if (this.assessmentResults.get(actionId) === result) {
      this.assessmentResults.delete(actionId);
      selectedBtn.classList.remove('selected');
    } else {
      this.assessmentResults.set(actionId, result);
      selectedBtn.classList.add('selected');
      otherBtn.classList.remove('selected');
    }
    this.onResultsUpdate();
  }

  /**
   * 取得評估結果 (✅ 修正：包含完整資訊)
   */
  getResults() {
    const results = [];

    this.assessmentResults.forEach((result, actionId) => {
      // 從快取中查找動作詳情
      const action = this.loadedActions.find(a => a.id === actionId) || { name: '未知動作', description: '' };

      results.push({
        actionId: actionId,
        actionName: action.name, // 冗餘儲存，方便顯示
        description: action.description,
        result: result,
        timestamp: new Date().toISOString()
      });
    });

    return results;
  }

  validateResults() {
    const results = this.getResults();
    return {
      isValid: true, // 評估非必填，始終有效
      count: results.length
    };
  }

  clearResults() {
    this.assessmentResults.clear();
    const buttons = this.container.querySelectorAll('.result-btn.selected');
    buttons.forEach(btn => btn.classList.remove('selected'));
    this.onResultsUpdate();
  }

  onResultsUpdate() {
    const event = new CustomEvent('assessmentResultsUpdated', {
      detail: {
        results: this.getResults(),
        validation: this.validateResults()
      }
    });
    document.dispatchEvent(event);
  }
}

// ============================================
// 主模組: UIAssessment - 整合三個子模組
// ============================================

class UIAssessment {
  constructor() {
    this.bodyDiagram = null;
    this.muscleTagSelector = null;
    this.assessmentSelector = null;
    this.isInitialized = false;
  }

  async init(config = {}) {
    const defaultConfig = {
      bodyDiagramId: 'body-diagram-front',
      muscleTagContainerId: 'muscle-tags-container',
      assessmentContainerId: 'assessment-container'
    };

    const finalConfig = { ...defaultConfig, ...config };

    try {
      this.bodyDiagram = new BodyDiagram(finalConfig.bodyDiagramId);
      const bodyDiagramOk = this.bodyDiagram.init();

      this.muscleTagSelector = new MuscleTagSelector(finalConfig.muscleTagContainerId);
      const muscleTagOk = await this.muscleTagSelector.init();

      this.assessmentSelector = new AssessmentSelector(finalConfig.assessmentContainerId);
      const assessmentOk = await this.assessmentSelector.init();

      this.isInitialized = bodyDiagramOk && muscleTagOk && assessmentOk;
      return this.isInitialized;

    } catch (error) {
      console.error('Failed to initialize UIAssessment:', error);
      return false;
    }
  }

  getAllSelections() {
    return {
      bodyParts: this.bodyDiagram?.getSelectedParts() || [],
      muscleTags: this.muscleTagSelector?.getSelectedTags() || [],
      assessmentResults: this.assessmentSelector?.getResults() || []
    };
  }
// 實作資料回填介面
  // 這是 service-record-flow.js 呼叫的關鍵方法，缺失會導致編輯白屏
  loadFromData(bodyParts = [], muscleTags = [], assessmentResults = []) {
      if (!this.isInitialized) return;

      // 1. 還原人體圖選取
      this.bodyDiagram.clearSelection(); // 先清空
      if (bodyParts && bodyParts.length > 0) {
          bodyParts.forEach(partId => {
             if (!partId) return;
             // [Fix] 使用 CSS.escape 防止選擇器因特殊字元崩潰，並限定在 SVG 內搜尋
             const safePartId = CSS.escape(partId);
             const part = this.bodyDiagram.svg.querySelector(`[data-part="${safePartId}"]`);
             if (part) this.bodyDiagram.togglePart(part);
          });
      }

      // 2. 還原肌群標籤
      if (this.muscleTagSelector) {
          // 先讓 Selector 根據部位渲染出來
          this.muscleTagSelector.updateForBodyParts(bodyParts);
          
          // 再勾選標籤
          setTimeout(() => {
              this.muscleTagSelector.clearSelection();
              muscleTags.forEach(tagId => {
                  const id = typeof tagId === 'object' ? tagId.id : tagId;
                  if (!id) return;
                  // [Fix] 安全轉義 tagId
                  const safeId = CSS.escape(id);
                  const btn = this.muscleTagSelector.container.querySelector(`button[data-tag-id="${safeId}"]`);
                  if (btn) this.muscleTagSelector.toggleTag(id, btn);
              });
          }, 0);
      }

      // 3. 還原評估結果
      if (this.assessmentSelector) {
          // 同樣，先讓 Selector 根據部位渲染動作列表
          this.assessmentSelector.updateForBodyParts(bodyParts).then(() => {
              this.assessmentSelector.clearResults();
              assessmentResults.forEach(res => {
                  const btnClass = res.result === 'positive' ? '.positive' : '.negative';
                  // [Fix] 安全轉義 actionId
                  const safeActionId = CSS.escape(res.actionId);
                  const card = this.assessmentSelector.container.querySelector(`.assessment-action-card[data-action-id="${safeActionId}"]`);
                  if (card) {
                      const btn = card.querySelector(btnClass);
                      const otherBtn = card.querySelector(btnClass === '.positive' ? '.negative' : '.positive');
                      if (btn) this.assessmentSelector.selectResult(res.actionId, res.result, btn, otherBtn);
                  }
              });
          });
      }
  }

  // 提供給模板使用的介面
  selectMuscleTag(tagId, isSelected) {
      if (!this.muscleTagSelector) return;
      if (!tagId) return;
      
      // [Fix] 安全轉義
      const safeId = CSS.escape(tagId);
      const btn = this.muscleTagSelector.container.querySelector(`button[data-tag-id="${safeId}"]`);
      if (btn) {
          // 檢查當前狀態，避免重複切換
          const currentSelected = this.muscleTagSelector.selectedMuscleTags.has(tagId);
          if (currentSelected !== isSelected) {
              this.muscleTagSelector.toggleTag(tagId, btn);
          }
      }
  }

  // 提供給模板使用的介面
  addAssessmentResult(actionId, result = 'positive') {
      if (!this.assessmentSelector) return;
      if (!actionId) return;

      // [Fix] 安全轉義
      const safeId = CSS.escape(actionId);
      const card = this.assessmentSelector.container.querySelector(`.assessment-action-card[data-action-id="${safeId}"]`);
      if (card) {
          const btnClass = result === 'positive' ? '.positive' : '.negative';
          const btn = card.querySelector(btnClass);
          const otherBtn = card.querySelector(result === 'positive' ? '.negative' : '.positive');
          if (btn) this.assessmentSelector.selectResult(actionId, result, btn, otherBtn);
      }
  }
  clearAll() {
    this.bodyDiagram?.clearSelection();
    this.muscleTagSelector?.clearSelection();
    this.assessmentSelector?.clearResults();
  }
}

// ============================================
// 全域輔助函式
// ============================================

window.switchToListMode = function() {
  document.querySelectorAll('.body-diagram-wrapper svg').forEach(svg => svg.style.display = 'none');
  const listSelector = document.getElementById('body-parts-list');
  if (listSelector) listSelector.style.display = 'block';
  
  const hint = document.getElementById('list-mode-hint');
  if (hint) hint.style.display = 'none';
};

window.dismissHint = function(hintId) {
  const hint = document.getElementById(hintId);
  if (hint) hint.style.display = 'none';
};

// 移除自動初始化，改由需要的頁面自行實例化
// 確保類別可被全域存取
window.UIAssessment = UIAssessment;