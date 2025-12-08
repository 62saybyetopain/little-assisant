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
    const conn = this.peer.connect(remoteId);
    this.setupConnection(conn);
  }

  // 3. 設定連線監聽
  setupConnection(conn) {
    this.conn = conn;

    conn.on('open', () => {
      this.isConnected = true;
      console.log('✅ [P2P] 連線成功!');
      this.updateUIStatus('connected', conn.peer);
      
      // 連線建立後，發送握手確認
      this.send({ type: this.MSG_TYPES.HANDSHAKE, message: 'Connected' });
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
    console.log('📥 [P2P] 收到資料:', payload.type);

    switch (payload.type) {
      case this.MSG_TYPES.HANDSHAKE:
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

  // 處理全量匯入
  handleFullSyncImport(jsonData) {
    if (confirm('收到遠端同步請求，確定要覆蓋本機資料嗎？')) {
      if (window.AppDataExportService) {
        const result = window.AppDataExportService.importData(jsonData, { source: 'remote' });
        if (result.success) {
          alert('同步成功！');
          location.reload();
        } else {
          alert('同步失敗: ' + result.error);
        }
      }
    }
  }

  // 處理單筆更新
  handleSingleUpdate(payload) {
    // 收到單筆更新 (例如新增了一個顧客)
    const { key, data } = payload;
    
    // 關鍵：呼叫 AppStorage.save 時標記 source: 'remote' 
    // 這需要在 Step 3 修改 storage.js 才能生效，避免無限迴圈
    if (window.AppStorage) {
        window.AppStorage.save(key, data, { source: 'remote' });
        
        // 顯示輕提示 (Optional)
        this.showToast(`已同步更新: ${key}`);
        
        // 發送事件通知 UI 更新
        document.dispatchEvent(new CustomEvent('dataSynced', { detail: { key } }));
    }
  }

  // 觸發全量同步 (將本機資料推送到對方)
  pushFullSync() {
    if (!this.isConnected) return alert('尚未連線，無法推送資料');
    
    // 使用 storage.js 提供的 exportAllData
    const exportDataJson = window.AppStorage.exportAllData();
    const exportData = JSON.parse(exportDataJson); // 轉回物件發送

    this.send({
      type: this.MSG_TYPES.FULL_SYNC,
      data: exportData
    });
    alert('已發送全量資料，請在對方設備確認。');
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