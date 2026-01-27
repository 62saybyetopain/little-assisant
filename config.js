/**
 * src/config.js
 * 系統全域配置與常數定義
 * 
 * @description 定義系統核心字典，包含事件類型、儲存鍵值、狀態列舉與錯誤代碼。
 * 此檔案不包含任何邏輯，僅輸出唯讀常數。
 * @version v6.3
 */

export const CURRENT_SCHEMA_VERSION = "v6.3";
export const APP_NAMESPACE = "app_v6_3_"; // [Fix] 強制命名空間前綴

/**
 * 事件類型定義 (EventTypes)
 * 用於 EventBus 的事件名稱，格式為 CATEGORY:ACTION
 */
export const EventTypes = Object.freeze({
    // 資料層事件
    DATA: {
        CREATED: 'DATA:CREATED',
        UPDATED: 'DATA:UPDATED',
        DELETED: 'DATA:DELETED',
        LOADED:  'DATA:LOADED',
        ARCHIVED: 'DATA:ARCHIVED' // [Fix] 補上漏掉的事件
    },
    // 同步層事件
    SYNC: {
        CONNECTED:    'SYNC:CONNECTED',
        DISCONNECTED: 'SYNC:DISCONNECTED',
        RECEIVED:     'SYNC:RECEIVED', // 收到新資料
        REJECTED:     'SYNC:REJECTED', // 資料衝突或驗證失敗
        CONFLICT:     'SYNC:CONFLICT'  // 偵測到衝突
    },
    // 系統層事件
    SYSTEM: {
        READY:        'SYSTEM:READY',
        ERROR:        'SYSTEM:ERROR',
        WORKER_MSG:   'SYSTEM:WORKER_MSG', // 來自 Web Worker 的訊息
        QUOTA_WARN:   'SYSTEM:QUOTA_WARN',  // 儲存空間不足警告
        INTEGRITY_FAIL: 'SYSTEM:INTEGRITY_FAIL' // [Fix] 完整性檢查失敗
    },
    // UI 互動事件
    UI: {
        TOAST: 'UI:TOAST',
        MODAL: 'UI:MODAL'
    }
});
/**
 * 儲存庫名稱定義 (StorageKeys)
 * 對應 IndexedDB 的 ObjectStore 名稱
 */
export const StorageKeys = Object.freeze({
    CUSTOMERS: 'customers', // 顧客資料
    RECORDS:   'records',   // 正式病歷
    TAGS:      'tags',      // 標籤定義
    TEMPLATES: 'templates', // 病歷模板
    DRAFTS:    'drafts',    // 編輯中草稿
    ARCHIVED:  'archived',  // 冷資料/封存
    META:      'meta'       // 系統設定與同步狀態
});

/**
 * 病歷狀態列舉 (RecordStatus)
 * 嚴格的狀態機流轉定義
 */
export const RecordStatus = Object.freeze({
    DRAFT:      'Draft',      // 草稿：可隨意編輯，不進行完整驗證
    VALIDATING: 'Validating', // 驗證中：正在進行非同步檢查或規則運算
    FINALIZED:  'Finalized'   // 已定稿：唯讀，不可修改，僅能產生新版本
});

/**
 * 資料來源列舉 (DataSource)
 * 用於標記資料的來源權威性
 */
export const DataSource = Object.freeze({
    LOCAL:  'Local',  // 本機產生
    REMOTE: 'Remote'  // 來自 P2P 同步
});

/**
 * 錯誤代碼定義 (ErrorCodes)
 * 格式：CATEGORY_NUMBER
 */
export const ErrorCodes = Object.freeze({
    // 儲存層錯誤
    STR_001: 'STR_001', // IndexedDB 連線失敗
    STR_002: 'STR_002', // 交易 (Transaction) 失敗
    STR_003: 'STR_003', // 儲存空間不足 (QuotaExceeded)
    STR_004: 'STR_004', // 資料找不到 (NotFound)
    
    // 驗證層錯誤
    VAL_001: 'VAL_001', // 必填欄位缺失
    VAL_002: 'VAL_002', // 資料格式錯誤
    VAL_003: 'VAL_003', // 關聯完整性錯誤 (Referential Integrity)
    
    // 同步層錯誤
    SYN_001: 'SYN_001', // Peer 連線失敗
    SYN_002: 'SYN_002', // 協定版本不相容
    
    // 系統錯誤
    SYS_001: 'SYS_001'  // 未知錯誤
});

/**
 * 標籤系統核心設定 v2
 * 包含：標籤類型、解剖光譜、組織樣式、語意色票
 */

// 1. 標籤類型
export const TagType = Object.freeze({
    ANATOMY:  'ANATOMY',   // 解剖 (演算色)
    HISTORY:  'HISTORY',   // 病史 (固定色票 - 醫療/警示感)
    MOVEMENT: 'MOVEMENT',  // 動作 (固定色票 - 動態/校正感)
    PERSONAL: 'PERSONAL'   // 個人 (固定色票 - 人文/識別感)
});

// 2. 身體部位與色相 (Anatomy Hues)
// 維持全光譜，作為解剖標籤的基底
export const BodyRegions = Object.freeze({
    HEAD:     { id: 'HEAD',     hue: 0,   label: '頭' },
    NECK:     { id: 'NECK',     hue: 15,  label: '頸' },
    SHOULDER: { id: 'SHOULDER', hue: 35,  label: '肩' },
    ARM:      { id: 'ARM',      hue: 55,  label: '臂' }, // 微調區隔
    HAND:     { id: 'HAND',     hue: 75,  label: '手' },
    CHEST:    { id: 'CHEST',    hue: 170, label: '胸' },
    BACK:     { id: 'BACK',     hue: 200, label: '背' },
    WAIST:    { id: 'WAIST',    hue: 220, label: '腰' },
    ABDOMEN:  { id: 'ABDOMEN',  hue: 150, label: '腹' },
    HIP:      { id: 'HIP',      hue: 260, label: '臀' },
    THIGH:    { id: 'THIGH',    hue: 280, label: '大腿' },
    LEG:      { id: 'LEG',      hue: 300, label: '小腿' },
    FOOT:     { id: 'FOOT',     hue: 320, label: '足' },
    JOINT:    { id: 'JOINT',    hue: 0,   label: '關節/通用' }
});

// 3. 組織視覺樣式 (Tissue Styles)
// 設計重點：避免使用純灰 (Grey)，改用大地色或高亮色
export const TissueStyles = Object.freeze({
    // --- 肌肉 ---
    // 動作肌：鮮明、輕快
    MUSCLE_PHASIC: { s: 90,  l: 65, label: '肌肉 (動作/淺層)' },
    // 穩定肌：深沉、穩重 (高飽和低亮度)
    MUSCLE_TONIC:  { s: 100, l: 35, label: '肌肉 (穩定/深層)' },

    // --- 筋膜 (Fascia) ---
    // 避開灰階，使用極淡的青藍色 (Ice Blue)，代表包覆與流動
    FASCIA:        { s: 60,  l: 88, label: '筋膜' }, 

    // --- 韌帶 (Ligament) ---
    // 避開灰階，使用卡其/駝色 (Taupe/Beige)，代表纖維與連結
    LIGAMENT:      { s: 40,  l: 60, label: '韌帶' },

    // --- 神經 (Nerve) ---
    // 螢光黃/萊姆色，代表電訊號
    NERVE:         { s: 90, l: 50, label: '神經' }
});

// 4. 非解剖類專屬色票 (Category Palettes)
// 由 UI/UX 定義，互不干擾，且完全不使用灰色
export const TagPalettes = Object.freeze({
    // A. 病史 (HISTORY) - 醫療檔案風格
    // 關鍵詞：慢性、醫療、警示
    HISTORY: [
        { id: 'chronic', val: '#701a75', label: '紫羅蘭 (慢性病史)' }, // Muted Purple
        { id: 'medical', val: '#0e7490', label: '深青色 (醫療狀況)' }, // Clinical Cyan
        { id: 'alert',   val: '#be123c', label: '胭脂紅 (重要警示)' }  // Muted Red
    ],

    // B. 動作模式 (MOVEMENT) - 運動科學風格
    // 關鍵詞：動能、觀察、修正
    MOVEMENT: [
        { id: 'kinetic', val: '#ea580c', label: '活力橘 (動作障礙)' }, // Kinetic Orange
        { id: 'flow',    val: '#4f46e5', label: '靛藍色 (控制問題)' }, // Indigo
        { id: 'correct', val: '#16a34a', label: '信號綠 (代償模式)' }  // Signal Green
    ],

    // C. 個人標籤 (PERSONAL) - 人文生活風格
    // 關鍵詞：VIP、職業、心理
    PERSONAL: [
        { id: 'vip',     val: '#d97706', label: '琥珀金 (VIP/身分)' }, // Amber/Gold
        { id: 'social',  val: '#db2777', label: '洋紅色 (個性/溝通)' }, // Magenta
        { id: 'life',    val: '#854d0e', label: '青銅色 (職業/習慣)' }  // Bronze/Brown
    ]
});

/**
 * 解剖學權重表 (AnatomicalWeights)
 * 用於搜尋排序與 TagSelector 列表排序
 * 數值越高，排序越靠前
 */
export const AnatomicalWeights = Object.freeze({
    // --- 核心中軸與生命徵象 (最高權重) ---
    'Head': 100, '頭': 100,
    'Neck': 95,  '頸': 95,
    'Torso': 90, // 舊相容
    
    // --- 軀幹核心 (次高權重) ---
    'Chest': 85, '胸': 85,
    'Back': 85,  '背': 85,
    'Waist': 85, '腰': 85,
    'Abdomen': 85, '腹': 85,
    
    // --- 肢體根部與大關節 (中權重) ---
    'Shoulder': 80, '肩': 80,
    'Hip': 80,      '臀': 80,
    'Joint': 80,    '關節': 80,

    // --- 四肢段 (中低權重) ---
    'Arm': 70,   '臂': 70,
    'Leg': 70,   '大腿': 70, '小腿': 70, // 包含 Leg 舊相容

    // --- 末端 (低權重) ---
    'Hand': 60,  '手': 60,
    'Foot': 60,  '足': 60,

// --- 其他 ---
    'Skin': 40,
    'General': 10
});

/**
 * 動作評估資料庫 (Assessment Database)
 * 根據選取的部位 (Key) 自動篩選測試項目 (Values)
 */
export const AssessmentDatabase = Object.freeze({
    'Shoulder': [
        { id: 'Neer', name: 'Neer Impingement Test', positive: '夾擠症候群' },
        { id: 'Hawkins', name: 'Hawkins-Kennedy Test', positive: '夾擠症候群' },
        { id: 'DropArm', name: 'Drop Arm Test', positive: '旋轉肌袖撕裂' }
    ],
    'Knee': [
        { id: 'Lachman', name: 'Lachman Test', positive: 'ACL 損傷' },
        { id: 'McMurray', name: 'McMurray Test', positive: '半月板損傷' }
    ],
    // ... 其他部位可持續擴充
});

/**
 * 預設模板 (Default Templates) - 擴充版
 * 包含：SOAP 結構、人體圖快照、預設數值
 */
export const DefaultTemplates = [
    {
        id: 'tpl_001',
        title: '五十肩 (Frozen Shoulder) - 初評',
        description: '適用於沾黏性肩關節囊炎初期評估',
        // 全狀態快照
        bodyParts: ['Shoulder-R', 'Arm-Upper-R'], // 預設右肩
        tags: ['Frozen Shoulder', 'ROM Limited', 'Pain'],
        soap: {
            s: '主訴右肩活動角度受限，夜間疼痛加劇，無法側睡。',
            o: '右肩盂肱關節活動度顯著受限。',
            a: '右側沾黏性肩關節囊炎 (Adhesive Capsulitis)。',
            p: '1. 關節鬆動術 (Maitland G1-G2)\n2. 居家伸展運動指導'
        },
        painScale: 7,
        rom: { flexion: 90, abduction: 80, externalRotation: 10 }
    },
    {
        id: 'tpl_002',
        title: '落枕 (Acute Neck Pain)',
        description: '急性頸部肌肉拉傷/小面關節鎖定',
        bodyParts: ['Neck', 'Shoulder-L'],
        tags: ['Neck Pain', 'Muscle Spasm'],
        soap: {
            s: '今早起床後頸部左側劇痛，無法向左轉頭。',
            o: '左側提肩胛肌與上斜方肌張力高 (Hypertonicity)。',
            a: '急性頸部扭傷 (Acute Torticollis)。',
            p: '1. 熱敷與軟組織放鬆\n2. 輕度頸椎牽引'
        },
        painScale: 8
    }
];