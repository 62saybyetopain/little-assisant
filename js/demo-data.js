/**
 * 示範資料生成器
 * 用於測試與展示系統功能
 * 版本: v1.1 (修正 Storage 引用問題)
 */

class DemoDataGenerator {
  constructor() {
    // ✅ 加入初始化檢查
    if (!window.customerManager) {
      console.error('❌ customerManager 未初始化');
      throw new Error('customerManager not initialized');
    }
    if (!window.AppStorage) {
      console.error('❌ AppStorage 未初始化');
      throw new Error('AppStorage not initialized');
    }
    
    this.customerManager = window.customerManager;
    this.storage = window.AppStorage;  // ✅ 修正：AppStorage
    
    console.log('✅ DemoDataGenerator 初始化成功');
  }

  /**
   * 生成示範顧客資料
   */
  generateDemoCustomers() {
    const demoCustomers = [
      {
        name: '王小明',
        nickname: '小明',
        phoneLastThree: '123',
        gender: 'male',
        age: 35,
        location: '台北市',
        occupation: '上班族',
        interests: ['運動', '旅遊'],
        healthTags: ['無特殊狀況'],
        personalityTags: ['健談型', '隨和型']
      },
      {
        name: '李美華',
        nickname: '美華',
        phoneLastThree: '456',
        gender: 'female',
        age: 28,
        location: '新北市',
        occupation: '學生',
        interests: ['閱讀', '音樂'],
        healthTags: ['孕婦'],
        personalityTags: ['謹慎型']
      },
      {
        name: '張大偉',
        nickname: '大偉',
        phoneLastThree: '789',
        gender: 'male',
        age: 45,
        location: '桃園市',
        occupation: '勞力工作',
        interests: ['園藝'],
        healthTags: ['高血壓'],
        personalityTags: ['安靜型']
      },
      {
        name: '陳小芬',
        nickname: '小芬',
        phoneLastThree: '321',
        gender: 'female',
        age: 52,
        location: '台中市',
        occupation: '退休人士',
        interests: ['烹飪', '旅遊'],
        healthTags: ['糖尿病', '骨質疏鬆'],
        personalityTags: ['隨和型']
      },
      {
        name: '林志豪',
        nickname: '阿豪',
        phoneLastThree: '654',
        gender: 'male',
        age: 30,
        location: '台南市',
        occupation: '自由業',
        interests: ['運動', '音樂'],
        healthTags: ['無特殊狀況'],
        personalityTags: ['急性子', '健談型']
      }
    ];

    console.log('🎭 開始生成示範資料...');

    let successCount = 0;
    let failCount = 0;

    demoCustomers.forEach((customerData, index) => {
      const result = this.customerManager.addCustomer(customerData);
      
      if (result.success) {
        successCount++;
        console.log(`✅ [${index + 1}/${demoCustomers.length}] ${customerData.name} 新增成功`);
      } else {
        failCount++;
        console.error(`❌ [${index + 1}/${demoCustomers.length}] ${customerData.name} 新增失敗:`, result.errors);
      }
    });

    console.log(`\n📊 生成結果: 成功 ${successCount} 筆, 失敗 ${failCount} 筆`);

    return {
      success: failCount === 0,
      successCount,
      failCount
    };
  }

  /**
   * 檢查是否已有資料
   */
  hasExistingData() {
    const customers = this.customerManager.getAllCustomers();
    return customers.length > 0;
  }

  /**
   * 清除所有資料(謹慎使用!)
   */
  clearAllData() {
    if (!confirm('⚠️ 確定要清除所有資料嗎?此操作無法復原!')) {
      return false;
    }

    try {
      this.storage.save('customers', []);
      console.log('✅ 所有顧客資料已清除');
      return true;
    } catch (error) {
      console.error('❌ 清除資料失敗:', error);
      return false;
    }
  }

  /**
   * 初始化示範資料(檢查後生成)
   */
  initDemoData() {
    if (this.hasExistingData()) {
      console.log('ℹ️ 已有現有資料,跳過示範資料生成');
      console.log('💡 如需重新生成,請先執行: demoDataGenerator.clearAllData()');
      return false;
    }

    console.log('📦 首次使用,生成示範資料...');
    const result = this.generateDemoCustomers();

    if (result.success) {
      console.log('✨ 示範資料生成完成!請重新整理頁面查看');
    }

    return result.success;
  }
}

// ✅ 延遲初始化，確保依賴已就緒
try {
  window.demoDataGenerator = new DemoDataGenerator();
  
  console.log(`
🎯 示範資料生成器已載入
    
可用指令:
  demoDataGenerator.initDemoData()     - 初始化示範資料(僅在無資料時)
  demoDataGenerator.generateDemoCustomers() - 強制生成示範資料
  demoDataGenerator.clearAllData()     - 清除所有資料
  demoDataGenerator.hasExistingData()  - 檢查是否有現有資料
`);
} catch (error) {
  console.error('❌ 示範資料生成器初始化失敗:', error.message);
}