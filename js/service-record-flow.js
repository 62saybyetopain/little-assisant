/**
 * service-record-flow.js - 流程控制層
 * 版本：v2.1
 * 職責：
 * - 控制服務紀錄的五步驟流程
 * - 管理資料暫存與驗證
 * - 對接 UI 層與 Data 層
 * - 處理模板自動觸發與套用
 */

const SERVICE_RECORD_STEPS = {
  CHIEF_COMPLAINT: {
    stepNumber: 1,
    stepKey: 'chiefComplaint',
    title: '主訴',
    description: '描述客戶主要的症狀或問題',
    requiredFields: [] 
  },
  SYMPTOMS: {
    stepNumber: 2,
    stepKey: 'symptoms',
    title: '症狀評估',
    description: '詳細記錄症狀、肌群標籤與評估',
    requiredFields: [] 
  },
  ASSESSMENT: {
    stepNumber: 3,
    stepKey: 'assessment',
    title: '評估結果',
    description: '整理評估結果與初步診斷',
    requiredFields: [] 
  },
  TREATMENT: {
    stepNumber: 4,
    stepKey: 'treatment',
    title: '處理方案',
    description: '建議治療方案與處理方式',
    requiredFields: [] 
  },
  FEEDBACK: {
    stepNumber: 5,
    stepKey: 'feedback',
    title: '客戶反饋',
    description: '記錄客戶反應與後續建議',
    requiredFields: [] 
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

// [P2] 模板相關暫存
    this.currentTemplateCandidates = [];
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
        console.log('Loaded from draft');
        this.tempRecord = savedDraft;
      } else if (this.recordId) {
        const existingRecord = window.appDataManager.record.getRecordById(customerId, recordId);
        if (existingRecord) {
          console.log('Loaded from existing record for edit');
          this.tempRecord = JSON.parse(JSON.stringify(existingRecord));
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
      
      await this.goToStep(1);

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
      // 處理下一步
      if (e.target.classList.contains('btn-next-step')) {
        this.handleNextStep();
      } 
      // 處理上一步
      else if (e.target.classList.contains('btn-prev-step')) {
        this.handlePrevStep();
      } 
      // 處理儲存 (支援新增的每頁按鈕)
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

  async goToStep(stepNumber) {
    if (this.isLocked) return false;
    if (stepNumber < 1 || stepNumber > 5) return false;

    await this.collectStepData(this.currentStep);
    await this.saveTempRecord();

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
    switch (stepNumber) {
      case 1: 
        this.initializeChiefComplaintUI();
        break;
      case 2: 
        // 症狀評估 UI 由 UIAssessment 自動管理
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

    const complaint = this.tempRecord.steps.chiefComplaint.complaint || '';
    const complaintInput = container.querySelector('textarea[name="complaint"]');
    if (complaintInput) {
      complaintInput.value = complaint;
      complaintInput.addEventListener('change', () => {
        this.tempRecord.steps.chiefComplaint.complaint = complaintInput.value;
      });
    }
  }

  initializeAssessmentUI() {
    const container = this.stepContainers.get(3);
    if (!container) return;

    const summary = this.generateAssessmentSummary();
    const summaryContainer = container.querySelector('#assessment-summary-content');
    if (summaryContainer) {
      summaryContainer.innerHTML = summary;
    } else {
        const summaryClassContainer = container.querySelector('.assessment-summary-content');
        if (summaryClassContainer) summaryClassContainer.innerHTML = summary;
    }
    
    const findingsInput = container.querySelector('textarea[name="findings"]');
    if (findingsInput) {
      findingsInput.value = this.tempRecord.steps.assessment.findings || '';
    }
  }

  initializeTreatmentUI() {
    const container = this.stepContainers.get(4);
    if (!container) return;

    const treatmentInput = container.querySelector('textarea[name="treatment-plan"]');
    if (treatmentInput) {
      // [Auto-fill] 如果處理計畫是空的，自動帶入主訴部位作為建議開頭
      if (!this.tempRecord.steps.treatment.treatmentPlan) {
          const bodyParts = this.tempRecord.steps.chiefComplaint.bodyParts || [];
          if (bodyParts.length > 0) {
              const partNames = bodyParts.map(id => {
                  const map = {
                      'neck': '頸部', 'left-shoulder': '左肩', 'right-shoulder': '右肩',
                      'upper-back': '上背', 'lower-back': '下背/腰', 'chest': '胸部',
                      'left-arm': '左手', 'right-arm': '右手', 'left-leg': '左腿', 'right-leg': '右腿'
                  };
                  return map[id] || id;
              });
              treatmentInput.value = `針對 ${partNames.join('、')} 進行放鬆與調整。\n`;
              this.tempRecord.steps.treatment.treatmentPlan = treatmentInput.value;
          }
      } else {
          treatmentInput.value = this.tempRecord.steps.treatment.treatmentPlan;
      }
    }
    
    const recommendInput = container.querySelector('textarea[name="recommendations"]');
    if (recommendInput) {
      recommendInput.value = this.tempRecord.steps.treatment.recommendations || '';
    }
  }

  initializeFeedbackUI() {
    const container = this.stepContainers.get(5);
    if (!container) return;

    const feedbackInput = container.querySelector('textarea[name="feedback"]');
    if (feedbackInput) {
      feedbackInput.value = this.tempRecord.steps.feedback.clientFeedback || '';
    }
    
    const nextStepInput = container.querySelector('textarea[name="next-steps"]');
    if (nextStepInput) {
      nextStepInput.value = this.tempRecord.steps.feedback.nextSteps || '';
    }
  }

  async validateCurrentStep() {
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

    try {
      this.isLocked = true;
      await this.collectStepData(5);

      const result = await window.appDataManager.record.saveRecord(this.tempRecord);

      if (result.success) {
        window.showAlert('服務紀錄已成功保存', 'success');
        await this.clearTempRecord();
        this.dispatchRecordSaved(result.recordId);
      } else {
        window.showAlert(`保存失敗：${result.error}`, 'error');
      }

      this.isLocked = false;

    } catch (error) {
      console.error('Failed to save record:', error);
      window.showAlert('保存過程中發生錯誤', 'error');
      this.isLocked = false;
    }
  }

  onBodyPartSelectionChanged(detail) {
    this.tempRecord.steps.symptoms.bodyParts = detail.selectedParts || [];
    this.tempRecord.steps.chiefComplaint.bodyParts = detail.selectedParts || [];
    this.markStepDirty(2);
    // [P2] 模板觸發邏輯：如果是新選取的部位 (clickedPart) 且是選取狀態
    // 假設 UI 層在 detail 中提供了 clickedPart 和 isSelected
    // 如果沒有 clickedPart，則不觸發，避免載入舊紀錄時瘋狂彈窗
    const triggerPart = detail.clickedPart; 
    
    if (triggerPart && detail.isSelected && window.AppTemplateManager) {
        this.checkAndShowTemplates(triggerPart);
    }
  }
// [P2] 檢查並顯示模板 Modal
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

  // [P2] 渲染模板 Modal 內容
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
                <input type="checkbox" checked value="${this._escape(text)}"> ${this._escape(text)}
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
                <input type="checkbox" checked value="${item.id}" data-type="struct"> ${this._escape(item.name)}
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

  // [P2] 執行模板套用
  handleTemplateApply() {
      // 1. 收集文字內容並追加到對應欄位
      const appendText = (containerId, targetTextareaName) => {
          const checked = Array.from(document.querySelectorAll(`#${containerId} input:checked`))
              .map(cb => cb.value);
          if (checked.length === 0) return;

          const textarea = document.querySelector(`textarea[name="${targetTextareaName}"]`);
          if (textarea) {
              const currentVal = textarea.value.trim();
              const newVal = checked.join('、'); // 或用 \n 換行
              textarea.value = currentVal ? `${currentVal}\n${newVal}` : newVal;
              // 手動觸發 change 事件以更新 tempRecord
              textarea.dispatchEvent(new Event('change')); 
          }
      };

      appendText('tpl-check-complaints', 'complaint'); // Step 1
      appendText('tpl-check-findings', 'findings');     // Step 3
      appendText('tpl-check-treatments', 'treatment-plan'); // Step 4
      appendText('tpl-check-recommendations', 'recommendations'); // Step 4

      // 2. 套用結構資料 (肌群 & 評估)
      // 呼叫 UIAssessment 的介面來更新 UI
      if (window.appUIAssessment) {
          const checkedMuscles = Array.from(document.querySelectorAll('#tpl-check-muscles input:checked')).map(cb => cb.value);
          const checkedActions = Array.from(document.querySelectorAll('#tpl-check-assessments input:checked')).map(cb => cb.value);

          checkedMuscles.forEach(id => {
              if (window.appUIAssessment.selectMuscleTag) {
                  window.appUIAssessment.selectMuscleTag(id, true);
              }
          });

          checkedActions.forEach(id => {
              if (window.appUIAssessment.addAssessmentResult) {
                  window.appUIAssessment.addAssessmentResult(id);
              }
          });
      }

      // 3. 關閉 Modal
      window.closeModal('modal-template-selector');
      window.showAlert('模板已套用', 'success');
      
      // 4. 強制收集一次當前步驟資料確保同步
      this.collectStepData(this.currentStep);
  }

  _escape(str) {
      if (!str) return '';
      return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  onMuscleTagsUpdated(detail) {
    this.tempRecord.steps.symptoms.muscleTags = detail.selectedTags || [];
    this.markStepDirty(2);
  }

  onAssessmentResultsUpdated(detail) {
    this.tempRecord.steps.symptoms.assessmentResults = detail.results || [];
    this.markStepDirty(2);
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

    return `
      <div class="assessment-summary-content">
        <h4>評估結果摘要</h4>
        
        <div class="summary-section">
          <h5>受影響部位 (${symptoms.bodyParts?.length || 0})</h5>
          <p>${symptoms.bodyParts?.length > 0 ? symptoms.bodyParts.join('、') : '無'}</p>
        </div>

        <div class="summary-section">
          <h5>相關肌群 (${symptoms.muscleTags?.length || 0})</h5>
          <p>${symptoms.muscleTags?.length > 0 ? '已選擇 ' + symptoms.muscleTags.length + ' 個肌群' : '無'}</p>
        </div>

        <div class="summary-section">
          <h5>陽性發現 (${positiveResults.length})</h5>
          <ul>
            ${positiveResults.length > 0 ? positiveResults.map(r => `<li>${r.actionName || r.actionId}</li>`).join('') : '<li>無</li>'}
          </ul>
        </div>

        <div class="summary-section">
          <h5>陰性發現 (${negativeResults.length})</h5>
          <ul>
            ${negativeResults.length > 0 ? negativeResults.map(r => `<li>${r.actionName || r.actionId}</li>`).join('') : '<li>無</li>'}
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