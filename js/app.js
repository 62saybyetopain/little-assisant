/**
 * js/app.js - 系統啟動入口
 * 職責：按照正確順序初始化各大 Manager，並解決依賴注入 (DI)
 * V3.1加入 DOMContentLoaded 事件監聽
 */
(function() {
  // 核心初始化邏輯 (不涉及 UI 操作，僅建立實例與綁定)
  function initCore() {
    console.log('⚙️ Initializing Core Systems...');

    // 1. 檢查基礎環境
    if (!window.AppStorage) {
      console.error('❌ Critical: AppStorage not loaded.');
      return false;
    }

    // 2. 初始化 CustomerManager
    if (typeof CustomerManager === 'undefined') {
      console.error('❌ Critical: CustomerManager class missing.');
      return false;
    }
    
    // 建立唯一實例
    const customerManagerInstance = new CustomerManager();
    window.AppCustomerManager = customerManagerInstance;
    window.customerManager = customerManagerInstance; 

    // 3. 初始化 DataManager (並注入依賴)
    if (typeof DataManager === 'undefined') {
      console.error('❌ Critical: DataManager class missing.');
      return false;
    }
    
    // 注入 customerManager 實例
    const dataManagerInstance = new DataManager(customerManagerInstance);
    window.appDataManager = dataManagerInstance;
    window.AppDataManager = dataManagerInstance;

    // 4. 建立便捷引用 (Shortcuts)
    window.AppTagManager = dataManagerInstance.tag;
    window.AppRecordManager = dataManagerInstance.record;
    window.AppAssessmentManager = dataManagerInstance.assessment;
    window.AppTemplateManager = dataManagerInstance.template;
    window.AppDataExportService = dataManagerInstance.exportService;

    // 確保 settings.js 中的 P2P 功能可以正常運作
    if (typeof P2PSyncManager !== 'undefined') {
        window.AppSyncManager = new P2PSyncManager();
        console.log('✅ P2PSyncManager initialized');
    } else {
        console.warn('⚠️ P2PSyncManager class missing. P2P features disabled.');
    }

    // 將 ServiceRecordFlow 改為非必要依賴
    // 原因：settings.html 與 customer-list.html 不需要載入服務流程邏輯
    if (typeof ServiceRecordFlow === 'undefined') {
      console.warn('⚠️ Warning: ServiceRecordFlow class missing. Wizard features (Service Record) will be disabled.');
      // 移除 return false，讓系統繼續初始化 DataManager 等核心功能
    }
    
    //確保 XSS 防護函式存在 
    if (typeof escapeHtml === 'undefined' && typeof window.escapeHtml === 'undefined') {
        console.warn('⚠️ Warning: global escapeHtml function missing. Security check failed.');
        // 若為嚴格模式，此處應 return false
    }

    return true;
  }

  //等待 DOM Ready 再執行初始化與 UI 相關邏輯
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM Ready, Booting App...');
    
    const coreReady = initCore();
    
    if (coreReady) {
      console.log('✅ System Fully Initialized (Dependency Injected)');

      // 設定全域旗標，讓晚載入的腳本(Lazy Loaded Scripts)也能判斷系統狀態
      window.isAppReady = true;
      
      // 觸發全域事件，通知各個 UI 頁面 (如 customer-list.html) 可以開始渲染了
      document.dispatchEvent(new Event('app-ready'));
    //啟動背景垃圾回收 (Background GC)
      // 延遲 3 秒執行，避免拖慢首屏載入速度
      setTimeout(() => {
        if (typeof window.AppStorage.fixBrokenIndices === 'function') {
             const report = window.AppStorage.fixBrokenIndices();
             
             // 若有清理資料，須彈出通知告知使用者
             if (report && report.success && report.removedCount > 0) {
                const msg = `[系統通知] 偵測並自動修復了 ${report.removedCount} 筆異常索引資料。\n\n這些資料已安全移動至「回收桶」，請您前往確認。`;
                console.info(`[Auto-GC] ${msg.replace(/\n/g, '')}`);
                alert(msg); 
             }
          } else {
             console.warn('⚠️ Warning: AppStorage.fixBrokenIndices is missing. Auto-GC skipped.');
          }
      }, 3000);
    } else {
      console.error('❌ System Initialization Failed');
      alert('系統核心初始化失敗，請檢查 Console 錯誤');
    }
  });

})();