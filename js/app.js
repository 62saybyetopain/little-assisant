/**
 * js/app.js - 系統啟動入口
 * 職責：按照正確順序初始化各大 Manager，並解決依賴注入 (DI)
 */
(function() {
  console.log('🚀 System Booting...');

  // 1. 檢查基礎環境
  if (!window.AppStorage) {
    console.error('❌ Critical: AppStorage not loaded.');
    return;
  }

  // 2. 初始化 CustomerManager (核心資料源)
  // 假設 CustomerManager 類別已經載入但尚未初始化
  if (typeof CustomerManager === 'undefined') {
    console.error('❌ Critical: CustomerManager class missing.');
    return;
  }
  
  // 建立唯一實例
  const customerManagerInstance = new CustomerManager();
  
  // 掛載到全域 (相容舊代碼 usage: window.AppCustomerManager)
  window.AppCustomerManager = customerManagerInstance;
  window.customerManager = customerManagerInstance; 

  // 3. 初始化 DataManager (並注入依賴)
  if (typeof DataManager === 'undefined') {
    console.error('❌ Critical: DataManager class missing.');
    return;
  }
  
  // 注入 customerManager 實例
  const dataManagerInstance = new DataManager(customerManagerInstance);
  
  // 掛載到全域
  window.appDataManager = dataManagerInstance;
  window.AppDataManager = dataManagerInstance;

  // 4. 建立便捷引用 (Shortcuts)
  // 讓 UI 頁面可以直接呼叫 window.AppRecordManager 而不用改程式碼
  window.AppTagManager = dataManagerInstance.tag;
  window.AppRecordManager = dataManagerInstance.record;
  window.AppAssessmentManager = dataManagerInstance.assessment;
  window.AppTemplateManager = dataManagerInstance.template;
  window.AppDataExportService = dataManagerInstance.exportService;

  console.log('✅ System Initialized Successfully (Dependency Injected)');
})();