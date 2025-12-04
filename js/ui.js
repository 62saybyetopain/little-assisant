/**
 * UI 組件模組
 */

// Toast
const Toast = {
  container: null,
  
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  
  show(message, type = 'info', duration = 3000) {
    this.init();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ'
    };
    
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
    `;
    
    this.container.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);
    
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

window.showToast = (message, type, duration) => Toast.show(message, type, duration);

// Loading
const Loading = {
  overlay: null,
  count: 0,
  
  show(message = '載入中...') {
    this.count++;
    
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'loading-overlay';
      this.overlay.className = 'loading-overlay';
      this.overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-message">${message}</div>
      `;
      document.body.appendChild(this.overlay);
      document.body.style.overflow = 'hidden';
    }
    
    setTimeout(() => this.overlay.classList.add('loading-show'), 10);
  },
  
  hide() {
    this.count = Math.max(0, this.count - 1);
    
    if (this.count === 0 && this.overlay) {
      this.overlay.classList.remove('loading-show');
      
      setTimeout(() => {
        if (this.overlay && this.count === 0) {
          this.overlay.remove();
          this.overlay = null;
          document.body.style.overflow = '';
        }
      }, 300);
    }
  }
};

window.showLoading = (message) => Loading.show(message);
window.hideLoading = () => Loading.hide();

// Modal
class Modal {
  constructor(options = {}) {
    this.options = {
      title: options.title || '提示',
      content: options.content || '',
      buttons: options.buttons || [
        {
          text: '確認',
          class: 'btn-primary',
          onClick: () => this.close()
        }
      ],
      closeOnOverlay: options.closeOnOverlay !== false,
      ...options
    };
    
    this.overlay = null;
    this.modal = null;
  }
  
  show() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    
    this.modal = document.createElement('div');
    this.modal.className = 'modal';
    this.modal.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">${this.options.title}</h3>
        <button class="modal-close" aria-label="關閉">✕</button>
      </div>
      <div class="modal-body">
        ${this.options.content}
      </div>
      <div class="modal-footer">
        ${this.renderButtons()}
      </div>
    `;
    
    this.overlay.appendChild(this.modal);
    document.body.appendChild(this.overlay);
    document.body.style.overflow = 'hidden';
    
    this.bindEvents();
    
    setTimeout(() => {
      this.overlay.classList.add('modal-show');
    }, 10);
  }
  
  renderButtons() {
    return this.options.buttons.map((btn, index) => `
      <button 
        class="btn ${btn.class || 'btn-secondary'}" 
        data-button-index="${index}">
        ${btn.text}
      </button>
    `).join('');
  }
  
  bindEvents() {
    const closeBtn = this.modal.querySelector('.modal-close');
    closeBtn.addEventListener('click', () => this.close());
    
    if (this.options.closeOnOverlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });
    }
    
    const buttons = this.modal.querySelectorAll('[data-button-index]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.buttonIndex);
        const buttonConfig = this.options.buttons[index];
        
        if (buttonConfig.onClick) {
          buttonConfig.onClick(this);
        }
      });
    });
    
    this.escHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    document.addEventListener('keydown', this.escHandler);
  }
  
  close() {
    if (!this.overlay) return;
    
    this.overlay.classList.remove('modal-show');
    
    setTimeout(() => {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
        this.modal = null;
        document.body.style.overflow = '';
        document.removeEventListener('keydown', this.escHandler);
      }
    }, 300);
  }
}

window.showModal = (options) => {
  const modal = new Modal(options);
  modal.show();
  return modal;
};

window.showConfirm = (message, onConfirm, onCancel) => {
  return showModal({
    title: '確認',
    content: `<p>${message}</p>`,
    buttons: [
      {
        text: '取消',
        class: 'btn-secondary',
        onClick: (modal) => {
          if (onCancel) onCancel();
          modal.close();
        }
      },
      {
        text: '確認',
        class: 'btn-primary',
        onClick: (modal) => {
          if (onConfirm) onConfirm();
          modal.close();
        }
      }
    ]
  });
};
// ✅ 改善：提供更詳細的錯誤訊息
window.addEventListener('error', (e) => {
  // 記錄完整錯誤
  console.error('🔴 全域錯誤:');
  console.error('  訊息:', e.message);
  console.error('  檔案:', e.filename);
  console.error('  位置:', e.lineno + ':' + e.colno);
  console.error('  錯誤物件:', e.error);
  
  // 在開發環境顯示詳細訊息
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    showToast(`錯誤: ${e.message} (${e.filename}:${e.lineno})`, 'error', 8000);
  } else {
    showToast('系統發生錯誤', 'error', 5000);
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('🔴 未處理的 Promise 拒絕:', e.reason);
  
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    showToast(`Promise 錯誤: ${e.reason}`, 'error', 8000);
  } else {
    showToast('資料載入失敗', 'error', 5000);
  }
});