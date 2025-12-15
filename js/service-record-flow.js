/**
 * service-record-flow.js - 流程控制層
 * 版本：v2.11
 * 職責：
 * - 控制服務紀錄的五步驟流程
 * - 管理資料暫存與驗證
 * - 對接 UI 層與 Data 層
 * - 處置模板自動觸發與套用
 * V2.2修正：UI閃爍、儲存鎖死問題、未存檔攔截
 * V2.3 XSS
 */

const SERVICE_RECORD_STEPS = {
  CHIEF_COMPLAINT: {
    stepNumber: 1,
    stepKey: 'chiefComplaint',
    title: '主訴',
    description: '描述客戶主要的症狀或問題',
    // [FormValidator] 定義驗證規則
    validationRules: {
      complaint: { required: false, requiredMessage: '主訴內容不可為空' }
    }
  },
  SYMPTOMS: {
    stepNumber: 2,
    stepKey: 'symptoms',
    title: '症狀評估',
    description: '詳細記錄症狀、肌群標籤與評估',
    validationRules: {} // Step 2 為複雜 UI，不使用 FormValidator
  },
  ASSESSMENT: {
    stepNumber: 3,
    stepKey: 'assessment',
    title: '評估結果',
    description: '整理評估結果與初步診斷',
    validationRules: {
      findings: { required: false, requiredMessage: '請輸入初步診斷與發現' }
    }
  },
  TREATMENT: {
    stepNumber: 4,
    stepKey: 'treatment',
    title: '處置方案',
    description: '建議處置方案',
    validationRules: {
      'treatment-plan': { required: false, requiredMessage: '請輸入處置計畫' }
    }
  },
  FEEDBACK: {
    stepNumber: 5,
    stepKey: 'feedback',
    title: '客戶反饋',
    description: '記錄客戶反應與後續建議',
    validationRules: {} // 反饋為選填
  }
};

class ServiceRecordFlow {
  constructor() {
    this.currentStep = 1;
    this.tempRecord = {};
    this.customerId = null;
    this.recordId = null;
    this.isLocked = false; 
    this.stepContainers = new Map();
    this.stepValidators = new Map(); 

// 模板相關暫存
    this.currentTemplateCandidates = [];
// 未存檔狀態追蹤
    this.hasUnsavedChanges = false;

  }

  async init(customerId, recordId = null) {
    if (!customerId) {
      console.error('customerId is required');
      return false;
    }

    try {
      this.customerId = customerId;
      this.recordId = recordId;

      const savedDraft = await this.loadTempRecord();
      
      if (savedDraft && savedDraft.recordId === this.recordId) {
        console.log('Loaded from draft (Safe Merge Mode)');
        
        //安全合併機制：防止舊草稿缺欄位導致崩潰
        const emptyRecord = this.createEmptyRecord();
        
        // 1. 先用空紀錄當底
        // 2. 覆蓋舊草稿的屬性
        // 3. 特別處置 steps 物件，確保每一大步都有預設結構
        this.tempRecord = {
            ...emptyRecord,
            ...savedDraft,
            steps: {
                chiefComplaint: { ...emptyRecord.steps.chiefComplaint, ...(savedDraft.steps?.chiefComplaint || {}) },
                symptoms: { ...emptyRecord.steps.symptoms, ...(savedDraft.steps?.symptoms || {}) },
                assessment: { ...emptyRecord.steps.assessment, ...(savedDraft.steps?.assessment || {}) },
                treatment: { ...emptyRecord.steps.treatment, ...(savedDraft.steps?.treatment || {}) },
                feedback: { ...emptyRecord.steps.feedback, ...(savedDraft.steps?.feedback || {}) }
            }
        };
      } else if (this.recordId) {
        const existingRecord = window.appDataManager.record.getRecordById(customerId, recordId);
        if (existingRecord) {
          console.log('Loaded from existing record for edit');
          this.tempRecord = JSON.parse(JSON.stringify(existingRecord));
          
          // 顯式補上 recordId，讓 DataManager.saveRecord() 能識別這是「更新」而非「新增」
          this.tempRecord.recordId = existingRecord.id;
          
        } else {
          console.warn('Record ID provided but not found, creating new.');
          this.recordId = this.generateRecordId();
          this.tempRecord = this.createEmptyRecord();
        }
      } else {
        console.log('Creating new record');
        this.recordId = this.generateRecordId();
        this.tempRecord = this.createEmptyRecord();
      }

      this.cacheStepContainers();
      this.attachUIEventListeners();
      this.initializeNavigation();
      
      // 監聽所有輸入變更，標記為未存檔
      this.attachDirtyMonitor();
      
      //初始化時傳入 true，避免從空的 DOM 收集資料導致覆蓋已載入的紀錄
      await this.goToStep(1, true)

      return true;

    } catch (error) {
      console.error('Failed to initialize ServiceRecordFlow:', error);
      return false;
    }
  }

  createEmptyRecord() {
    return {
      recordId: this.recordId,
      customerId: this.customerId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: {
        chiefComplaint: { bodyParts: [], muscleTags: [] },
        symptoms: { bodyParts: [], muscleTags: [], assessmentResults: [] },
        assessment: {},
        treatment: { bodyParts: [], muscleTags: [] },
        feedback: {}
      }
    };
  }

// 監聽輸入變更
  attachDirtyMonitor() {
    document.querySelectorAll('input, textarea, select').forEach(el => {
       if (el.dataset.dirtyMonitored) return;
        el.addEventListener('input', () => {
            this.hasUnsavedChanges = true;
        });
        el.dataset.dirtyMonitored = 'true';
    });
  }

  // 處置返回按鈕
  handleBackNavigation() {
    if (this.hasUnsavedChanges) {
        if (confirm('您有尚未儲存的變更，確定要離開嗎？\n(離開後未儲存的內容可能會遺失)')) {
            window.location.href = `customer-profile.html?id=${this.customerId}`;
        }
    } else {
        window.location.href = `customer-profile.html?id=${this.customerId}`;
    }
  }

  cacheStepContainers() {
    Object.values(SERVICE_RECORD_STEPS).forEach(step => {
      const container = document.querySelector(`[data-step="${step.stepNumber}"]`);
      if (container) {
        this.stepContainers.set(step.stepNumber, container);
      }
    });
  }

  attachUIEventListeners() {
    // 監聽部位選擇變更
    document.addEventListener('bodyPartSelectionChanged', (e) => {
      this.onBodyPartSelectionChanged(e.detail);
    });

    document.addEventListener('muscleTagsUpdated', (e) => {
      this.onMuscleTagsUpdated(e.detail);
    });

    document.addEventListener('assessmentResultsUpdated', (e) => {
      this.onAssessmentResultsUpdated(e.detail);
    });

    // [P2] 模板 Modal 相關事件
    const btnApplyTemplate = document.getElementById('btn-apply-template');
    if (btnApplyTemplate) {
        btnApplyTemplate.addEventListener('click', () => this.handleTemplateApply());
    }

    const tplSelect = document.getElementById('tpl-select');
    if (tplSelect) {
        tplSelect.addEventListener('change', (e) => this.handleTemplateSelectChange(e.target.value));
    }

    document.addEventListener('click', (e) => {
      // 處置下一步
      if (e.target.classList.contains('btn-next-step')) {
        this.handleNextStep();
      } 
      // 處置上一步
      else if (e.target.classList.contains('btn-prev-step')) {
        this.handlePrevStep();
      } 
      // 處置儲存 (支援新增的每頁按鈕)
      else if (e.target.classList.contains('btn-save-record')) {
        this.handleSaveRecord();
      } 
      // [修正] 步驟指示器點擊邏輯
      else {
        // 使用 closest 尋找是否點擊了 indicator 及其子元素
        const stepIndicator = e.target.closest('.step-indicator');
        
        if (stepIndicator) {
          const step = parseInt(stepIndicator.dataset.step);
          
          // 邏輯：只允許點擊不同於當前的步驟，且不處於鎖定狀態
          if (step && step !== this.currentStep && !this.isLocked) {
             console.log('Navigating to step:', step); // Debug 用
             this.goToStep(step);
          }
        }
      }
    });
  }

  initializeNavigation() {
    const navContainer = document.querySelector('.step-navigation');
    if (!navContainer) return;

    const stepsHtml = Object.values(SERVICE_RECORD_STEPS)
      .map(step => `
        <div class="step-indicator" data-step="${step.stepNumber}">
          <div class="step-number">${step.stepNumber}</div>
          <div class="step-title">${step.title}</div>
          <div class="step-status"></div>
        </div>
      `)
      .join('');

    navContainer.innerHTML = stepsHtml;

    const buttonContainer = document.querySelector('.step-buttons');
    if (buttonContainer) {
      buttonContainer.innerHTML = `
        <button type="button" class="btn btn-prev-step" id="btn-prev-step" disabled>← 上一步</button>
        <span class="step-progress"><span id="current-step">1</span>/5</span>
        <button type="button" class="btn btn-next-step" id="btn-next-step">下一步 →</button>
      `;
    }

    const saveContainer = document.querySelector('.action-buttons');
    if (saveContainer) {
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn btn-save-record btn-primary';
      saveBtn.textContent = '完成記錄';
      saveBtn.id = 'btn-save-record';
      saveContainer.appendChild(saveBtn);
    }
  }

  async goToStep(stepNumber, skipCollection = false) {
    if (this.isLocked) return false;
    if (stepNumber < 1 || stepNumber > 5) return false;

    // 只有在非跳過模式下，才從 DOM 收集資料
    if (!skipCollection) {
        await this.collectStepData(this.currentStep);
        await this.saveTempRecord();
    }

    try {
      this.isLocked = true;

      this.stepContainers.forEach(container => {
        container.style.display = 'none';
      });

      const targetContainer = this.stepContainers.get(stepNumber);
      if (targetContainer) {
        targetContainer.style.display = 'block';
      }

      this.currentStep = stepNumber;
      this.updateNavigationUI();
      await this.initializeStepUI(stepNumber);

      this.isLocked = false;
      return true;

    } catch (error) {
      console.error('Failed to go to step:', error);
      this.isLocked = false;
      return false;
    }
  }

  async initializeStepUI(stepNumber) {
    // [FormValidator] 初始化該步驟的驗證器
    this.initStepValidator(stepNumber);

    switch (stepNumber) {
      case 1: 
        this.initializeChiefComplaintUI();
        break;
      case 2: 
        if (window.appUIAssessment && this.tempRecord.steps.symptoms) {
             const sym = this.tempRecord.steps.symptoms;
             // 確保載入 部位、肌群、評估結果
             window.appUIAssessment.loadFromData(sym.bodyParts || [], sym.muscleTags || [], sym.assessmentResults || []);
        }
        break;
      case 3: 
        this.initializeAssessmentUI();
        break;
      case 4: 
        this.initializeTreatmentUI();
        break;
      case 5: 
        this.initializeFeedbackUI();
        break;
    }
  }

  initializeChiefComplaintUI() {
    const container = this.stepContainers.get(1);
    if (!container) return;

    // 還原主訴內容
    const cInput = container.querySelector('textarea[name="complaint"]');
    if (cInput) {
        // 從 tempRecord 還原資料，若無則為空字串
        cInput.value = this.tempRecord.steps.chiefComplaint.complaint || '';
    }
  }

  // [FormValidator] 初始化驗證器實例
  initStepValidator(stepNumber) {
    if (this.stepValidators.has(stepNumber)) return; // 已初始化過

    const stepConfig = Object.values(SERVICE_RECORD_STEPS).find(s => s.stepNumber === stepNumber);
    if (!stepConfig || !stepConfig.validationRules || Object.keys(stepConfig.validationRules).length === 0) return;

    // 尋找容器 ID (HTML 中需對應設置 id="step-form-X")
    const formId = `step-form-${stepNumber}`;
    const formEl = document.getElementById(formId);

    if (formEl && window.FormValidator) {
      const validator = new FormValidator(formId, stepConfig.validationRules);
      this.stepValidators.set(stepNumber, validator);
      console.log(`Validator initialized for step ${stepNumber}`);
    }
  }

  initializeAssessmentUI() {
    const container = this.stepContainers.get(3);
    if (!container) return;
    
    // 更新摘要
    const sContainer = container.querySelector('#assessment-summary-content') || container.querySelector('.assessment-summary-content');
    if (sContainer) sContainer.innerHTML = this.generateAssessmentSummary();
    
    // 渲染觸診肌群 Chips (依賴 Step 2 的選擇)
    this.renderPalpationChips();

    // 綁定輸入框
    const fInput = container.querySelector('textarea[name="findings"]');
    if (fInput) fInput.value = this.tempRecord.steps.assessment.findings || '';
  }
    // 以下觸診相關方法
  renderPalpationChips() {
    const container = document.getElementById('palpation-chips-container');
    if (!container) return;

    // 取得 Step 2 選中的肌群
    const selectedTags = this.tempRecord.steps.symptoms.muscleTags || [];
    
    if (selectedTags.length === 0) {
        container.innerHTML = '<span style="color:#999; font-size:12px;">Step 2 尚未選擇相關肌群</span>';
        return;
    }

    container.innerHTML = selectedTags.map(tag => {
        // 從 ID 找名稱 (兼容 tag 為物件或 ID 字串)
        const rawTagName = typeof tag === 'string' ? this.getTagNameById(tag) : tag.name;
        const tagId = typeof tag === 'string' ? tag : tag.id;
        
        // XSS 防護：轉義顯示名稱
        const safeTagName = window.escapeHtml(rawTagName);
        const safeTagId = window.escapeHtml(tagId);
        
        // 改用 dataset 傳遞參數，防止因名稱含單引號導致 onclick 語法崩潰
        return `
            <div class="palpation-chip" 
                 data-id="${safeTagId}"
                 data-name="${safeTagName}"
                 onclick="window.appServiceRecordFlow.openPalpationModal(this.dataset.id, this.dataset.name)"
                 style="background: white; border: 1px solid #cbd5e1; border-radius: 16px; padding: 6px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;">
                <span style="width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; display: inline-block;"></span>
                ${safeTagName}
            </div>
        `;
    }).join('');
  }

  getTagNameById(id) {
     if (window.AppTagManager) {
         const tag = window.AppTagManager.getTagById(id);
         return tag ? tag.name : id;
     }
     return id;
  }

  openPalpationModal(muscleId = '', muscleName = '') {
      const modal = document.getElementById('modal-palpation-details');
      if (!modal) return;

      // 重置表單
      document.getElementById('palpation-target-muscle').value = muscleName; 
      document.getElementById('palpation-modal-title').textContent = muscleName ? `標記狀態：${muscleName}` : '自訂觸診紀錄';
      document.getElementById('palpation-note').value = '';
      
      // 重置側別 (預設左側)
      document.querySelectorAll('input[name="palpation-side"]').forEach(r => r.checked = (r.value === '左側'));
      
      // 重置 Checkbox
      document.querySelectorAll('input[name="palpation-status"]').forEach(c => c.checked = false);

      if (!muscleName) {
           document.getElementById('palpation-note').placeholder = "請輸入部位與狀態...";
      } else {
           document.getElementById('palpation-note').placeholder = "例如：傳導痛至手臂...";
      }

      window.openModal('modal-palpation-details');
  }

  savePalpationDetails() {
      const muscleName = document.getElementById('palpation-target-muscle').value;
      const side = document.querySelector('input[name="palpation-side"]:checked').value;
      const statuses = Array.from(document.querySelectorAll('input[name="palpation-status"]:checked')).map(cb => cb.value);
      const note = document.getElementById('palpation-note').value.trim();

      // 格式化文字： "上斜方肌 (左側): 高張, 壓痛. 備註: xxx"
      let text = muscleName ? `${muscleName}` : '';
      if (muscleName) text += ` (${side})`;
      
      const details = [];
      if (statuses.length > 0) details.push(statuses.join(', '));
      if (note) details.push(note); 

      if (details.length > 0) {
          text += `: ${details.join('. ')}`;
      } else if (!muscleName && note) {
          text = note; // 純備註模式
      }

      // 寫入 Textarea
      const textarea = document.querySelector('textarea[name="findings"]');
      if (textarea && text) {
          const currentVal = textarea.value.trim();
          textarea.value = currentVal ? `${currentVal}\n${text}` : text;
          
          // 觸發 dirty check 讓系統知道資料變更了
          textarea.dispatchEvent(new Event('input'));
          this.hasUnsavedChanges = true;
      }

      window.closeModal('modal-palpation-details');
  }
  initializeTreatmentUI() {
    const container = this.stepContainers.get(4);
    if (!container) return;
    
    const tInput = container.querySelector('textarea[name="treatment-plan"]');
    if (tInput) {
      // 自動填入邏輯 (Auto-fill)
      if (!this.tempRecord.steps.treatment.treatmentPlan && this.tempRecord.steps.chiefComplaint.bodyParts?.length > 0) {
         const parts = this.tempRecord.steps.chiefComplaint.bodyParts.join('、');
         tInput.value = `針對 ${parts} 進行處置。\n`;
         this.tempRecord.steps.treatment.treatmentPlan = tInput.value;
      } else {
         tInput.value = this.tempRecord.steps.treatment.treatmentPlan || '';
      }
    }
    
    const rInput = container.querySelector('textarea[name="recommendations"]');
    if (rInput) rInput.value = this.tempRecord.steps.treatment.recommendations || '';
  }

  initializeFeedbackUI() {
    const container = this.stepContainers.get(5);
    if (!container) return;
    
    const fbInput = container.querySelector('textarea[name="feedback"]');
    if (fbInput) fbInput.value = this.tempRecord.steps.feedback.clientFeedback || '';
    
    const nsInput = container.querySelector('textarea[name="next-steps"]');
    if (nsInput) nsInput.value = this.tempRecord.steps.feedback.nextSteps || '';
  }
  async validateCurrentStep() {
    // 1. 如果該步驟有設定 Validator，優先使用 Validator 檢查
    const validator = this.stepValidators.get(this.currentStep);
    if (validator) {
      const isValid = validator.validateAll();
      if (!isValid) {
        // FormValidator 會自動顯示紅框與錯誤訊息，這裡只需中斷流程
        if(window.showToast) window.showToast('請檢查必填欄位', 'warning');
        return false;
      }
    }

    // 2. Step 2 (Body Diagram) 特殊檢查
    if (this.currentStep === 2) {
        if (window.appUIAssessment) {
            const selections = window.appUIAssessment.getAllSelections();
            if (selections.bodyParts.length === 0) {
                if(window.showToast) window.showToast('請至少標記一個部位', 'warning');
                return false;
            }
        }
    }
    return true; 
  }
  async collectStepData(stepNumber) {
    switch (stepNumber) {
      case 1:
        const complaintInput = document.querySelector('textarea[name="complaint"]');
        if (complaintInput) {
          this.tempRecord.steps.chiefComplaint.complaint = complaintInput.value.trim();
        }
        break;

      case 2:
        if (window.appUIAssessment?.isInitialized) {
          const selections = window.appUIAssessment.getAllSelections();
          this.tempRecord.steps.symptoms = {
            ...this.tempRecord.steps.symptoms,
            bodyParts: selections.bodyParts,
            muscleTags: selections.muscleTags,
            assessmentResults: selections.assessmentResults,
            timestamp: new Date().toISOString()
          };
          // [Auto-fill Sync] 強制同步 Body Parts 到主訴資料
          this.tempRecord.steps.chiefComplaint.bodyParts = selections.bodyParts;
        }
        break;

      case 3:
        const findingsInput = document.querySelector('textarea[name="findings"]');
        if (findingsInput) {
          this.tempRecord.steps.assessment.findings = findingsInput.value.trim();
        }
        break;

      case 4:
        const treatmentInput = document.querySelector('textarea[name="treatment-plan"]');
        if (treatmentInput) {
          this.tempRecord.steps.treatment.treatmentPlan = treatmentInput.value.trim();
        }
        const recommendInput = document.querySelector('textarea[name="recommendations"]');
        if (recommendInput) {
          this.tempRecord.steps.treatment.recommendations = recommendInput.value.trim();
        }
        break;

      case 5:
        const feedbackInput = document.querySelector('textarea[name="feedback"]');
        if (feedbackInput) {
          this.tempRecord.steps.feedback.clientFeedback = feedbackInput.value.trim();
        }
        const nextStepsInput = document.querySelector('textarea[name="next-steps"]');
        if (nextStepsInput) {
          this.tempRecord.steps.feedback.nextSteps = nextStepsInput.value.trim();
        }
        break;
    }
  }

  
  showStepValidationError(stepNumber) {
  }

  updateNavigationUI() {
    document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
      const stepNum = index + 1;
      if (stepNum === this.currentStep) {
        indicator.classList.add('active');
      } else if (stepNum < this.currentStep) {
        indicator.classList.add('completed');
        indicator.classList.remove('active');
      } else {
        indicator.classList.remove('active', 'completed');
      }
    });

    const progressElement = document.querySelector('#current-step');
    if (progressElement) progressElement.textContent = this.currentStep;

    const prevBtn = document.querySelector('#btn-prev-step');
    const nextBtn = document.querySelector('#btn-next-step');

    if (prevBtn) prevBtn.disabled = this.currentStep === 1;

    if (nextBtn) {
      nextBtn.style.display = this.currentStep === 5 ? 'none' : 'inline-block';
    }
    
    const saveBtn = document.querySelector('#btn-save-record');
    if (saveBtn) {
        saveBtn.style.display = 'inline-block';
        // 可以選擇性地更改文字，例如最後一步叫「完成」，其他叫「暫存」
        saveBtn.textContent = this.currentStep === 5 ? '完成記錄' : '儲存紀錄';
    }
  }

  async handleNextStep() {
    if (this.isLocked) return;
    await this.collectStepData(this.currentStep);
    await this.goToStep(this.currentStep + 1);
  }

  async handlePrevStep() {
    if (this.isLocked || this.currentStep === 1) return;
    await this.goToStep(this.currentStep - 1);
  }

  async handleSaveRecord() {
    if (this.isLocked) return;

    if(window.showLoading) window.showLoading('儲存中...');

    try {
      this.isLocked = true;
      
      // 強制收集當前最後一步的數據
      await this.collectStepData(this.currentStep);

      if (!window.appDataManager || !window.appDataManager.record) {
          throw new Error('資料庫未連線');
      }

      const result = await window.appDataManager.record.saveRecord(this.tempRecord);

      if (result.success) {
        // 儲存成功，重置髒檢查狀態
        this.hasUnsavedChanges = false;
        await this.clearTempRecord();
        if(window.hideLoading) window.hideLoading();
        this.dispatchRecordSaved(result.recordId);
      } else {
        throw new Error(result.error);
      }

    } catch (error) {
      console.error('Save failed:', error);
      if(window.hideLoading) window.hideLoading();
      if(window.showAlert) window.showAlert(`保存失敗：${error.message}`, 'error');
      else alert(`保存失敗：${error.message}`);
    } finally {
      this.isLocked = false;
    }
  }

  onBodyPartSelectionChanged(detail) {
    this.tempRecord.steps.symptoms.bodyParts = detail.selectedParts || [];
    this.tempRecord.steps.chiefComplaint.bodyParts = detail.selectedParts || [];
    
    // 當部位變更時，強制 UI 重新載入資料，以顯示對應的肌群標籤
    if (window.appUIAssessment && typeof window.appUIAssessment.loadFromData === 'function') {
        window.appUIAssessment.loadFromData(
            this.tempRecord.steps.symptoms.bodyParts,
            this.tempRecord.steps.symptoms.muscleTags || [],
            this.tempRecord.steps.symptoms.assessmentResults || []
        );
    }

    this.markStepDirty(2);
    this.hasUnsavedChanges = true;
  }
// 檢查並顯示模板 Modal
  async checkAndShowTemplates(bodyPartId) {
    const templates = window.AppTemplateManager.findTemplatesByBodyPart(bodyPartId);
    
    if (templates && templates.length > 0) {
        console.log(`Found ${templates.length} templates for ${bodyPartId}`);
        this.currentTemplateCandidates = templates;
        
        // 渲染 Modal 內容
        this.renderTemplateModal(templates[0]);
        
        // 顯示 Modal
        window.openModal('modal-template-selector');
    }
  }

  // 渲染模板 Modal 內容
  renderTemplateModal(template) {
    if (!template) return;

    // 1. 設定標題與下拉選單
    document.getElementById('tpl-modal-title').textContent = `發現適用模板：${template.name}`;
    
    const selectContainer = document.getElementById('tpl-select-container');
    const select = document.getElementById('tpl-select');
    
    if (this.currentTemplateCandidates.length > 1) {
        selectContainer.style.display = 'block';
        select.innerHTML = this.currentTemplateCandidates.map(t => 
            `<option value="${t.id}" ${t.id === template.id ? 'selected' : ''}>${t.name}</option>`
        ).join('');
    } else {
        selectContainer.style.display = 'none';
        select.innerHTML = '';
    }

    // 2. 渲染文字選項 (預設全選)
    const renderChecks = (containerId, items) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        
        // items 可能已經是陣列(P2 v2.4 DataManager) 或字串
        const arr = Array.isArray(items) ? items : (items ? [items] : []);
        
        if (arr.length === 0) {
            el.innerHTML = '<span style="color:#999; font-size:12px;">無內容</span>';
            return;
        }

        el.innerHTML = arr.map((text, idx) => `
            <label class="checkbox-item">
                <input type="checkbox" checked value="${window.escapeHtml(text)}"> ${window.escapeHtml(text)}
            </label>
        `).join('');
    };

    renderChecks('tpl-check-complaints', template.textItems?.complaints);
    renderChecks('tpl-check-findings', template.textItems?.findings);
    renderChecks('tpl-check-treatments', template.textItems?.treatments);
    renderChecks('tpl-check-recommendations', template.textItems?.recommendations);

    // 3. 渲染結構選項 (肌群/動作)
    const renderStructChecks = (containerId, ids, manager) => {
        const el = document.getElementById(containerId);
        if (!el) return;
        
        const arr = Array.isArray(ids) ? ids : [];
        if (arr.length === 0) {
            el.innerHTML = '<span style="color:#999; font-size:12px;">無關聯資料</span>';
            return;
        }

        // 透過 Manager 取得名稱
        // 假設 TagManager.getTagById 和 AssessmentManager.getActionById 存在
        const items = arr.map(id => {
            let name = id;
            if (manager && manager.getTagById) {
                const tag = manager.getTagById(id);
                if (tag) name = tag.name;
            } else if (manager && manager.getActionById) {
                const act = manager.getActionById(id);
                if (act) name = act.name;
            }
            return { id, name };
        });

        el.innerHTML = items.map(item => `
            <label class="checkbox-item">
                <input type="checkbox" checked value="${item.id}" data-type="struct"> ${window.escapeHtml(item.name)}
            </label>
        `).join('');
    };

    renderStructChecks('tpl-check-muscles', template.relatedMuscles, window.AppTagManager);
    renderStructChecks('tpl-check-assessments', template.relatedAssessments, window.AppAssessmentManager);
  }

  handleTemplateSelectChange(templateId) {
      const template = this.currentTemplateCandidates.find(t => t.id === templateId);
      if (template) {
          this.renderTemplateModal(template);
      }
  }

  // 執行模板套用
  handleTemplateApply() {
      // 1. 收集文字內容並追加到對應欄位
      const appendText = (containerId, targetTextareaName) => {
          const checked = Array.from(document.querySelectorAll(`#${containerId} input:checked`))
              .map(cb => cb.value);
          if (checked.length === 0) return;

          const textarea = document.querySelector(`textarea[name="${targetTextareaName}"]`);
          if (textarea) {
              const currentVal = textarea.value.trim();
              const newVal = checked.join('、'); 
              textarea.value = currentVal ? `${currentVal}\n${newVal}` : newVal;
              
              // 同時觸發 input 事件，確保髒檢查 (Dirty Monitor) 能偵測到變更
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
      };

      appendText('tpl-check-complaints', 'complaint'); // Step 1
      appendText('tpl-check-findings', 'findings');     // Step 3
      appendText('tpl-check-treatments', 'treatment-plan'); // Step 4
      appendText('tpl-check-recommendations', 'recommendations'); // Step 4

      // 2. 套用結構資料 (肌群 & 評估)
      // 呼叫 UIAssessment 的介面來更新 UI
      if (window.appUIAssessment) {
    // A. 勾選相關肌群 (保留)
    const checkedMuscles = Array.from(document.querySelectorAll('#tpl-check-muscles input:checked')).map(cb => cb.value);
    checkedMuscles.forEach(id => {
        if (window.appUIAssessment.selectMuscleTag) {
            window.appUIAssessment.selectMuscleTag(id, true);
        }
    });

    // 補上評估項目 (Assessments) 的套用邏輯
    const checkedAssessments = Array.from(document.querySelectorAll('#tpl-check-assessments input:checked')).map(cb => cb.value);
    checkedAssessments.forEach(id => {
        // 假設 UIAssessment 提供 addAssessmentResult 或類似方法
        // 將模板中的評估項目預設為 'positive' (陽性) 加入列表
        if (window.appUIAssessment.addAssessmentResult) {
            window.appUIAssessment.addAssessmentResult(id, 'positive', ''); 
        } else {
            console.warn('UIAssessment missing addAssessmentResult method');
        }
    });

      // 3. 關閉 Modal
      window.closeModal('modal-template-selector');
      if(window.showAlert) window.showAlert('模板已套用', 'success');
  
      this.hasUnsavedChanges = true;
      
      // 模板可能跨步驟寫入 DOM，必須強制同步所有受影響步驟的資料到 tempRecord
      this.collectStepData(1); // 同步主訴
      if (window.appUIAssessment) this.collectStepData(2); // 同步肌群與評估狀態
      this.collectStepData(3); // 同步評估發現
      this.collectStepData(4); // 同步處置計畫
  }
}
  onMuscleTagsUpdated(detail) {
    this.tempRecord.steps.symptoms.muscleTags = detail.selectedTags || [];
    this.markStepDirty(2);
    this.hasUnsavedChanges = true;
  }

  onAssessmentResultsUpdated(detail) {
    this.tempRecord.steps.symptoms.assessmentResults = detail.results || [];
    this.markStepDirty(2);
    this.hasUnsavedChanges = true;
  }

  markStepDirty(stepNumber) {
    const indicator = document.querySelector(`[data-step="${stepNumber}"] .step-status`);
    if (indicator) {
      indicator.classList.add('dirty');
      indicator.textContent = '●';
    }

    this.tempRecord.updatedAt = new Date().toISOString();
  }

  generateAssessmentSummary() {
    const symptoms = this.tempRecord.steps.symptoms;

    if (!symptoms.assessmentResults || symptoms.assessmentResults.length === 0) {
      return '<p class="hint">（暫無評估資料）</p>';
    }

    const positiveResults = symptoms.assessmentResults.filter(r => r.result === 'positive');
    const negativeResults = symptoms.assessmentResults.filter(r => r.result === 'negative');

    // 輔助函式：取得安全顯示名稱 (同時修復 XSS 與 名稱未知問題)
    const getSafeName = (r) => {
        let name = r.actionName;
        // 若無名稱，嘗試從 Manager 查找
        if (!name && window.AppAssessmentManager) {
            const act = window.AppAssessmentManager.getActionById(r.actionId);
            if (act) name = act.name;
        }
        // 回退顯示 ID，並進行 HTML 跳脫處理 (XSS Fix)
        return window.escapeHtml(name || r.actionId || '未知項目');
    };

    // 使用 getSafeName 渲染列表
    return `
      <div class="assessment-summary-content">
        [cite_start]<h4>評估結果摘要 [cite: 5, 9]</h4>
        
        <div class="summary-section">
          <h5>受影響部位 (${symptoms.bodyParts?.length || 0})</h5>
          <p>${symptoms.bodyParts?.length > 0 ? window.escapeHtml(symptoms.bodyParts.join('、')) : '無'}</p>
        </div>

        <div class="summary-section">
          <h5>相關肌群 (${symptoms.muscleTags?.length || 0})</h5>
          <p>${symptoms.muscleTags?.length > 0 ? '已選擇 ' + symptoms.muscleTags.length + ' 個肌群' : '無'}</p>
        </div>

        <div class="summary-section">
          <h5>陽性發現 (${positiveResults.length})</h5>
          <ul>
            ${positiveResults.length > 0 ? positiveResults.map(r => `<li>${getSafeName(r)}</li>`).join('') : '<li>無</li>'}
          </ul>
        </div>

        <div class="summary-section">
          <h5>陰性發現 (${negativeResults.length})</h5>
          <ul>
            ${negativeResults.length > 0 ? negativeResults.map(r => `<li>${getSafeName(r)}</li>`).join('') : '<li>無</li>'}
          </ul>
        </div>
      </div>
    `;
  }

  async saveTempRecord() {
    this.tempRecord.updatedAt = new Date().toISOString();
    await window.appDataManager.record.saveTempRecord(this.customerId, this.tempRecord);
  }

  async loadTempRecord() {
    return await window.appDataManager.record.loadTempRecord(this.customerId);
  }

  async clearTempRecord() {
    await window.appDataManager.record.clearTempRecord(this.customerId);
    this.tempRecord = {};
  }

  generateRecordId() {
    return `rec_${this.customerId}_${Date.now()}`;
  }

  dispatchRecordSaved(recordId) {
    const event = new CustomEvent('serviceRecordSaved', {
      detail: { recordId, customerId: this.customerId }
    });
    document.dispatchEvent(event);
  }
}

window.AppServiceRecordFlow = new ServiceRecordFlow();
window.appServiceRecordFlow = window.AppServiceRecordFlow;