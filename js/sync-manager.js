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
    if (this.peer) return; // 避免重複初始化
    if (typeof Peer === 'undefined') {
      console.error('❌ PeerJS 尚未載入，無法啟動同步功能');
      return;
    }

    // 產生隨機 ID (前綴 client_ 方便識別)
    const randomId = 'client_' + Math.random().toString(36).substr(2, 5);
    
    this.peer = new Peer(randomId);

    this.peer.on('open', (id) => {
      this.myId = id;
      console.log('📡 [P2P] 本機 ID 已建立:', id);
      this.updateUIStatus('ready', id);
    });

    // 被動連線：當別人連我時
    this.peer.on('connection', (conn) => {
      console.log('📡 [P2P] 收到連線請求...');
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('❌ [P2P] 錯誤:', err);
      this.updateUIStatus('error', err.type);
      alert(`連線錯誤: ${err.type}`);
    });
  }

  // 2. 主動連線到目標 ID
  connectTo(remoteId) {
    if (!this.peer) this.init();
    if (!remoteId) return;

    console.log('📡 [P2P] 嘗試連線到:', remoteId);
    
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
    if (confirm('收到遠端設備的全量資料同步請求，是否覆蓋本機資料？\n(此操作無法復原)')) {
      try {
        // 檢查匯入服務是否存在
        if (window.AppDataExportService && window.AppDataExportService.importData) {
            const result = window.AppDataExportService.importData(jsonData, { source: 'remote' });            
            if (result.success) {
                alert('同步成功！頁面將重新整理。');
                location.reload();
            } else {
                alert('匯入失敗: ' + (result.error || result.message));
            }
        } else {
            console.warn('⚠️ 未找到 AppDataExportService，請確認匯入功能已實作');
            alert('系統尚未實作自動匯入功能，請檢查 console');
        }
      } catch (e) {
        console.error('匯入過程發生錯誤:', e);
        alert('匯入失敗，資料格式可能不符');
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
    const elId = document.getElementById('p2p-my-id');
    
    // 如果不在設定頁面，可能找不到元素，直接返回不報錯
    if (!elStatus) return;

    if (status === 'ready') {
      elStatus.textContent = '等待連線 (在線)';
      elStatus.className = 'status-badge ready';
      if(elId) elId.value = detail;
    } else if (status === 'connected') {
      elStatus.textContent = `已連線至: ${detail}`;
      elStatus.className = 'status-badge connected';
    } else if (status === 'disconnected') {
      elStatus.textContent = '連線中斷';
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
console.log('✅ SyncManager (v1.0) 模組已載入');