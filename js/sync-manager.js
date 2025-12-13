/**
 * js/sync-manager.js
 * P2P 同步管理器 - 負責設備間的資料傳輸
 * 依賴: PeerJS, window.AppStorage
 */
class SyncManager {
  constructor() {
    this.peer = null;       // 本機 Peer 物件
    this.conn = null;       // 與對方的連線物件
    this.myId = null;       // 本機 ID
    this.isConnected = false;
    
    // 定義 storageKey，避免 init() 存取 localStorage 時使用 "undefined" 字串
    // 確保 ID 能正確持久化儲存
    this.storageKey = 'p2p_device_id'; 
    
    // 清理舊版 Bug 產生的垃圾資料 (對應 [P1] 修復殘留髒資料問題)
    // 檢查是否存在因變數未定義而產生的 "undefined" 鍵值，若有則移除
    if (typeof localStorage !== 'undefined' && localStorage.getItem('undefined')) {
        localStorage.removeItem('undefined');
        console.info('🧹 [SyncManager] 已自動清理舊版殘留的髒資料 (undefined key)');
    }
    
    // 定義訊息類型
    this.MSG_TYPES = {
      HANDSHAKE: 'HANDSHAKE', // 握手確認
      FULL_SYNC: 'FULL_SYNC', // 全量同步 (匯入備份)
      UPDATE: 'UPDATE'        // 單筆更新
    };
  }

  // 1. 初始化 Peer (通常在進入設定頁或應用啟動時呼叫)
  init() {
    if (typeof Peer === 'undefined') return console.error('PeerJS missing');

    // 1. 讀取 ID，若無則生成預設 (user_xxxx)
    let savedId = localStorage.getItem(this.storageKey);
    if (!savedId) {
      savedId = this.generateIdWithPrefix('user'); // 預設前綴 user
      localStorage.setItem(this.storageKey, savedId);
    }
    
    this.startPeer(savedId);
  }

  // [修改] 生成帶前綴的 ID (排除混淆字元)
  generateIdWithPrefix(prefix) {
    // 1. 清理前綴：只保留英數字，將空白轉為底線，轉小寫
    const cleanPrefix = prefix.trim().replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    
    // 2. 生成後綴 (4碼，排除 l, 1, o, 0)
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; 
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // 結果範例: taipei_9a2b
    return `${cleanPrefix}_${suffix}`;
  }

  // [修改] 設定裝置名稱 (前綴)
  setDeviceName(name) {
    if (!name || name.length < 2) return { success: false, error: '名稱太短 (至少2字)' };
    
    // 生成包含隨機後綴的新 ID，確保不重複
    const newId = this.generateIdWithPrefix(name);

    localStorage.setItem(this.storageKey, newId);
    
    // 重啟連線
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.init(); 
    return { success: true, newId: newId };
  }
   startPeer(id) {
    this.peer = new Peer(id);

    this.peer.on('open', (id) => {
      this.myId = id;
      console.log('📡 [P2P] ID:', id);
      this.updateUIStatus('ready', id);
    });

    this.peer.on('connection', (conn) => {
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('P2P Error:', err);
      if (err.type === 'unavailable-id') {
          // 極低機率發生，若發生則自動重試一次
          localStorage.removeItem(this.storageKey);
          this.init();
      } else {
          this.updateUIStatus('error', err.type);
      }
    });
  }
  // 主動連線到目標 ID
  connectTo(remoteId) {
    if (!this.peer) return;
    
    // UI 提示：開始連線
    if (window.showToast) window.showToast('正在嘗試連線...', 'info');

    const conn = this.peer.connect(remoteId);
    
    // [新增] 設定連線逾時計時器 (10秒)
    const timeoutTimer = setTimeout(() => {
        // 如果 10 秒後尚未標記為已連線
        if (!this.isConnected) {
            console.warn('⚠️ [P2P] Connection timed out (10s)');
            conn.close(); // 強制關閉嘗試中的連線
            
            // 更新 UI 為錯誤狀態
            this.updateUIStatus('error', '連線逾時');
            if (window.showToast) window.showToast('連線逾時 (10秒)，請檢查網路或 ID 是否正確', 'error');
        }
    }, 10000);

    // 當連線成功開啟時，清除計時器
    conn.on('open', () => {
        clearTimeout(timeoutTimer);
    });
    
    // 當發生錯誤時，也要清除計時器 (避免重複報錯)
    conn.on('error', () => {
        clearTimeout(timeoutTimer);
    });

    this.setupConnection(conn);
  }

  // 3. 設定連線監聽
  setupConnection(conn) {
    this.conn = conn;

    conn.on('open', () => {
      this.isConnected = true;
      console.log('✅ [P2P] 連線成功!');
      this.updateUIStatus('connected', conn.peer);
      
      //連線建立後，發送握手確認 (含本機時間戳記)
      this.send({ 
          type: this.MSG_TYPES.HANDSHAKE, 
          message: 'Connected',
          timestamp: Date.now() 
      });
    });

    conn.on('data', (data) => {
      this.handleIncomingData(data);
    });

    conn.on('close', () => {
      this.isConnected = false;
      this.conn = null;
      console.log('⚠️ [P2P] 連線中斷');
      this.updateUIStatus('disconnected');
    });
  }

  // 4. 發送資料
  send(payload) {
    if (this.isConnected && this.conn) {
      this.conn.send(payload);
    }
  }

  // 5. 處理接收到的資料
  handleIncomingData(payload) {
    if (!payload || !payload.type) return;

    console.log('📥 [P2P] 收到資料:', payload.type);

    switch (payload.type) {
      case this.MSG_TYPES.HANDSHAKE:
        // 時間同步檢查
        if (payload.timestamp) {
            const timeDiff = Math.abs(Date.now() - payload.timestamp);
            
            // 若誤差超過 60 秒
            if (timeDiff > 60000) { 
                const diffSec = Math.round(timeDiff / 1000);
                const msg = `⚠️ 警告：雙方設備時間相差約 ${diffSec} 秒，可能導致同步判斷錯誤`;
                
                console.warn(`[Sync] Time drift detected: ${diffSec}s`);
                
                // 改用非侵入式 Toast 提示 (顯示 10秒)
                if (typeof window.showToast === 'function') {
                    window.showToast(msg, 'warning', 10000);
                }
                // 移除 alert 與 conn.close()，允許連線繼續
            }
        }
        
        console.log('🤝 握手成功');
        break;

      case this.MSG_TYPES.FULL_SYNC:
        this.handleFullSyncImport(payload.data);
        break;

      case this.MSG_TYPES.UPDATE:
        this.handleSingleUpdate(payload);
        break;
    }
  }

  // 處理全量匯入：改走智慧分析流程
  handleFullSyncImport(jsonData) {
    // 檢查依賴是否存在
    if (!window.AppDataExportService || !window.SettingsApp) {
      console.warn('Sync received but UI modules missing.');
      //明確引導使用者前往設定頁面，避免同步請求被靜默忽略
      alert('🔔 收到來自對方的「全量同步」請求！\n\n目前的頁面無法處理此操作。\n請前往「系統設定 > 設備同步」頁面以檢視並接收資料。');
      return;
    }

    try {
      console.log('🔄 P2P 接收到資料，開始分析...');
      
      // 1. 呼叫 DataManager 進行分析 (不寫入)
      // 需要先標準化資料 (確保格式正確)
      let normalizedData = jsonData;
      if (window.AppDataExportService.normalizeImportData) {
          normalizedData = window.AppDataExportService.normalizeImportData(jsonData);
      }
      
      const analysis = window.AppDataExportService.analyzeImport(normalizedData);

      // 2. 判斷是否有變動
      const hasChanges = analysis.new.length > 0 || analysis.newer.length > 0 || analysis.older.length > 0;

      if (!hasChanges) {
          window.SettingsApp.showToast('同步完成：資料已是最新，無需更新', 'success');
          return;
      }

      // 3. 呼叫 SettingsApp 顯示決策視窗 (交由人類決定)
      // 注意：這裡我們直接打開設定頁的 Modal，如果使用者當前不在設定頁，可能需要跳轉或處理
      if (window.SettingsApp.showImportDecisionModal) {
          // 如果當前不是設定頁，可以考慮跳轉，或者假設使用者正在操作同步介面
          // 這裡直接呼叫，前提是 settings.js 已載入且 DOM 存在
          window.SettingsApp.showImportDecisionModal(analysis, normalizedData);
      } else {
          alert('UI 介面尚未就緒，無法顯示決策視窗');
      }

    } catch (err) {
      console.error('Sync Analysis Failed:', err);
      if (window.showToast) window.showToast(`同步分析失敗: ${err.message}`, 'error');
    }
  }

  // 處理單筆更新
  handleSingleUpdate(payload) {
    const { key, data } = payload;
    
    // 安全性過濾：禁止遠端覆蓋本機的系統關鍵 ID 與設定
    const PROTECTED_KEYS = ['p2p_device_id', 'p2p_device_name', '__storage_test__'];
    if (PROTECTED_KEYS.includes(key)) {
        console.warn(`[Sync] Blocked write to protected key: ${key}`);
        return;
    }

    if (window.AppStorage) {
        window.AppStorage.save(key, data, { source: 'remote' });
        this.showToast(`已同步更新: ${key}`);
        document.dispatchEvent(new CustomEvent('dataSynced', { detail: { key } }));
    }
  }

  // 觸發全量同步 (將本機資料推送到對方)
  pushFullSync() {
    if (!this.isConnected) {
    if (window.showToast) window.showToast('尚未連線，無法推送資料', 'warning');
    return;
}
    
    // 使用 storage.js 提供的 exportAllData
    const exportDataJson = window.AppStorage.exportAllData();
    const exportData = JSON.parse(exportDataJson); // 轉回物件發送

    this.send({
      type: this.MSG_TYPES.FULL_SYNC,
      data: exportData
    });
    if (window.showToast) window.showToast('已發送全量資料，請在對方設備確認', 'success');
  }

  // 廣播單筆更新 (供 storage.js 呼叫)
  broadcastUpdate(key, data) {
    if (this.isConnected) {
      this.send({
        type: this.MSG_TYPES.UPDATE,
        key: key,
        data: data
      });
    }
  }

  // UI 狀態更新輔助函式
  updateUIStatus(status, detail) {
    const elStatus = document.getElementById('p2p-status');
    // 注意：ID 顯示現在分為兩個地方：設定輸入框 和 完整ID顯示區
    const elFullId = document.getElementById('p2p-full-id');
    const elNameInput = document.getElementById('p2p-device-name'); 
    
    // 如果不在設定頁面，可能找不到元素，直接返回
    if (!elStatus) return;

    if (status === 'ready') {
      if (elFullId) elFullId.textContent = detail;
      // 嘗試從完整 ID 解析出前綴填入輸入框，方便使用者修改
      if (elNameInput && !elNameInput.value) {
          const parts = detail.split('_');
          if (parts.length > 1) {
              // 去掉最後一段隨機碼，剩下的就是前綴
              elNameInput.value = parts.slice(0, -1).join('_');
          }
      }
    }

    if (status === 'connected') {
        elStatus.textContent = `已連線至: ${detail}`;
        elStatus.className = 'status-badge connected';
    } else if (status === 'disconnected') {
        elStatus.textContent = '未連線';
        elStatus.className = 'status-badge disconnected';
    } else if (status === 'error') {
        elStatus.textContent = '連線錯誤';
        elStatus.className = 'status-badge error';
    }
  }

  // 簡單 Toast 提示
  showToast(msg) {
    // 如果專案有全域 Toast 函式則使用，否則 fallback 到 console
    if (window.showToast) {
        window.showToast(msg, 'info');
    } else {
        console.log(`[Sync] ${msg}`);
    }
  }
}

// 初始化全域實例
window.AppSyncManager = new SyncManager();