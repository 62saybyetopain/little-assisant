/**
 * 表單驗證模組 (Form Validator)
 * 提供即時表單驗證與錯誤提示
 * 版本: v1.0
 */

class FormValidator {
  constructor(formId, rules) {
    this.form = document.getElementById(formId);
    this.rules = rules;
    this.errors = {};
    
    if (!this.form) {
      console.error(`Form with id "${formId}" not found`);
      return;
    }
    
    this.init();
  }

  /**
   * 初始化表單驗證
   */
  init() {
    // 為每個欄位綁定驗證事件
    Object.keys(this.rules).forEach(fieldName => {
      const field = this.form.querySelector(`[name="${fieldName}"]`);
      
      if (field) {
        // blur 事件驗證
        field.addEventListener('blur', () => {
          this.validateField(fieldName, field.value);
        });
        
        // input 事件清除錯誤(使用者開始修正時)
        field.addEventListener('input', () => {
          if (this.errors[fieldName]) {
            this.clearFieldError(fieldName);
          }
        });
      }
    });

    // 表單提交驗證
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.validateAll()) {
        this.onSubmit();
      }
    });
  }

  /**
   * 驗證單一欄位
   */
  validateField(fieldName, value) {
    const rules = this.rules[fieldName];
    
    // 必填驗證
    if (rules.required && !value.trim()) {
      this.setFieldError(fieldName, rules.requiredMessage || '此欄位為必填');
      return false;
    }

    // 如果欄位為空且非必填,跳過其他驗證
    if (!value.trim() && !rules.required) {
      this.clearFieldError(fieldName);
      return true;
    }

    // 長度驗證
    if (rules.minLength && value.length < rules.minLength) {
      this.setFieldError(fieldName, `最少需要 ${rules.minLength} 個字`);
      return false;
    }

    if (rules.maxLength && value.length > rules.maxLength) {
      this.setFieldError(fieldName, `最多 ${rules.maxLength} 個字`);
      return false;
    }

    // 格式驗證
    if (rules.pattern && !rules.pattern.test(value)) {
      this.setFieldError(fieldName, rules.patternMessage || '格式不正確');
      return false;
    }

    // 自訂驗證
    if (rules.custom && !rules.custom(value)) {
      this.setFieldError(fieldName, rules.customMessage || '驗證失敗');
      return false;
    }

    this.clearFieldError(fieldName);
    return true;
  }

  /**
   * 設定欄位錯誤
   */
  setFieldError(fieldName, message) {
    this.errors[fieldName] = message;
    
    const field = this.form.querySelector(`[name="${fieldName}"]`);
    const fieldGroup = field.closest('.field-group');
    
    if (fieldGroup) {
      const errorDiv = fieldGroup.querySelector('.error-message');
      
      field.classList.add('invalid');
      
      if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
      }
    }
  }

  /**
   * 清除欄位錯誤
   */
  clearFieldError(fieldName) {
    delete this.errors[fieldName];
    
    const field = this.form.querySelector(`[name="${fieldName}"]`);
    const fieldGroup = field.closest('.field-group');
    
    if (fieldGroup) {
      const errorDiv = fieldGroup.querySelector('.error-message');
      
      field.classList.remove('invalid');
      
      if (errorDiv) {
        errorDiv.style.display = 'none';
      }
    }
  }

  /**
   * 驗證所有欄位
   */
  validateAll() {
    let isValid = true;
    
    Object.keys(this.rules).forEach(fieldName => {
      const field = this.form.querySelector(`[name="${fieldName}"]`);
      if (field && !this.validateField(fieldName, field.value)) {
        isValid = false;
      }
    });
    
    return isValid;
  }

  /**
   * 取得表單資料
   */
getFormData() {
  const formData = {};
  
  Object.keys(this.rules).forEach(fieldName => {
    const field = this.form.querySelector(`[name="${fieldName}"]`);
    if (field) {
      if (field.type === 'checkbox') {
        formData[fieldName] = field.checked;
      } else {
        // ✅ 修復：安全地處理可能的 null/undefined
        const value = field.value;
        formData[fieldName] = (value !== null && value !== undefined) ? value.trim() : '';
      }
    } else {
      // ✅ 新增：記錄缺少的欄位
      console.warn(`⚠️ 欄位 "${fieldName}" 在表單中不存在`);
    }
  });
  
  return formData;
}

  /**
   * 重置表單
   */
  reset() {
    this.form.reset();
    this.errors = {};
    
    // 清除所有錯誤提示
    Object.keys(this.rules).forEach(fieldName => {
      this.clearFieldError(fieldName);
    });
  }

  /**
   * 表單提交回調(由子類別覆寫)
   */
  onSubmit() {
    console.log('Form submitted:', this.getFormData());
  }
}

/**
 * 防抖函數(用於搜尋輸入)
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 導出到全域
window.FormValidator = FormValidator;
window.debounce = debounce;