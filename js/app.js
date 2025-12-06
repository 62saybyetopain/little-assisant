/**
 * js/app.js - 系統啟動入口
 * 職責：按照正確順序初始化各大 Manager，並解決依賴注入 (DI)
 * V3.0加入 DOMContentLoaded 事件監聽
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

    return true;
  }

  //等待 DOM Ready 再執行初始化與 UI 相關邏輯
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM Ready, Booting App...');
    
    const coreReady = initCore();
    
    if (coreReady) {
      console.log('✅ System Fully Initialized (Dependency Injected)');
      
      // 觸發全域事件，通知各個 UI 頁面 (如 customer-list.html) 可以開始渲染了
      document.dispatchEvent(new Event('app-ready'));
    } else {
      console.error('❌ System Initialization Failed');
      alert('系統核心初始化失敗，請檢查 Console 錯誤');
    }
  });

})();