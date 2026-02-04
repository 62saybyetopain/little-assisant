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

// 4. 通用標籤色票 (Tag Palettes)
// 提供三組風格迥異的色系，供病史、動作、個人標籤自由選用
// 設計原則：高對比度、不與解剖標籤混淆、純粹顏色描述
export const TagPalettes = Object.freeze({
    // 第一組：暖色/大地色系 (Warm/Earth Tones)
    SET_A: [
        { id: 'amber',      val: '#d97706', label: '琥珀金' },
        { id: 'terracotta', val: '#9a3412', label: '陶土紅' },
        { id: 'bronze',     val: '#854d0e', label: '青銅褐' }
    ],

    // 第二組：冷色/專業色系 (Cool/Professional Tones)
    SET_B: [
        { id: 'teal',       val: '#0f766e', label: '松石綠' },
        { id: 'indigo',     val: '#4338ca', label: '靛青藍' },
        { id: 'slate',      val: '#334155', label: '板岩灰' }
    ],

    // 第三組：鮮明/寶石色系 (Vibrant/Jewel Tones)
    SET_C: [
        { id: 'magenta',    val: '#be185d', label: '洋紅色' },
        { id: 'violet',     val: '#7c3aed', label: '紫羅蘭' },
        { id: 'emerald',    val: '#047857', label: '寶石綠' }
    ]
});

/**
 * 標準 ROM 定義 (Standard Range of Motion)
 * 增加 sideType 屬性以區分：
 * - 'none': 不分左右 (如軀幹前屈)
 * - 'lr': 分左右側 (如肩屈曲)
 * - 'rot': 分左旋/右旋 (如頸椎旋轉)
 */
export const StandardROM = Object.freeze([
  // --- 頸椎 (Cervical Spine) ---
  { id: 'neck_flex',      label: '頸椎前屈', sideType: 'none', min: 0, max: 50,  norm: 45 },
  { id: 'neck_ext',       label: '頸椎後伸', sideType: 'none', min: 0, max: 70,  norm: 45 },
  { id: 'neck_side_flex', label: '頸椎側屈', sideType: 'lr',   min: 0, max: 45,  norm: 45 },
  { id: 'neck_rot',       label: '頸椎旋轉', sideType: 'rot',  min: 0, max: 90,  norm: 80 },

  // --- 胸腰椎 (Thoracolumbar Spine) ---
  { id: 'trunk_flex',      label: '軀幹前屈', sideType: 'none', min: 0, max: 80,  norm: 60 },
  { id: 'trunk_ext',       label: '軀幹後伸', sideType: 'none', min: 0, max: 30,  norm: 25 },
  { id: 'trunk_side_flex', label: '軀幹側屈', sideType: 'lr',   min: 0, max: 35,  norm: 35 },
  { id: 'trunk_rot',       label: '軀幹旋轉', sideType: 'rot',  min: 0, max: 45,  norm: 45 },

  // --- 肩關節 (Shoulder) ---
  { id: 'shoulder_flex',  label: '肩屈曲',     sideType: 'lr', min: 0, max: 180, norm: 180 },
  { id: 'shoulder_ext',   label: '肩後伸',     sideType: 'lr', min: 0, max: 60,  norm: 50 },
  { id: 'shoulder_abd',   label: '肩外展',     sideType: 'lr', min: 0, max: 180, norm: 180 },
  { id: 'shoulder_er',    label: '肩外旋',     sideType: 'lr', min: 0, max: 90,  norm: 90 },
  { id: 'shoulder_ir',    label: '肩內旋',     sideType: 'lr', min: 0, max: 90,  norm: 70 },
  { id: 'shoulder_h_abd', label: '肩水平外展', sideType: 'lr', min: 0, max: 45,  norm: 45 },
  { id: 'shoulder_h_add', label: '肩水平內收', sideType: 'lr', min: 0, max: 135, norm: 130 },

  // --- 肘與前臂 (Elbow & Forearm) ---
  { id: 'elbow_flex',  label: '肘屈曲',   sideType: 'lr', min: 0, max: 150, norm: 145 },
  { id: 'elbow_ext',   label: '肘伸展',   sideType: 'lr', min: -10, max: 0, norm: 0 },
  { id: 'forearm_pro', label: '前臂旋前', sideType: 'lr', min: 0, max: 80,  norm: 80 },
  { id: 'forearm_sup', label: '前臂旋後', sideType: 'lr', min: 0, max: 80,  norm: 80 },

  // --- 腕關節 (Wrist) ---
  { id: 'wrist_flex', label: '腕屈曲', sideType: 'lr', min: 0, max: 80,  norm: 80 },
  { id: 'wrist_ext',  label: '腕伸展', sideType: 'lr', min: 0, max: 70,  norm: 70 },
  { id: 'wrist_rd',   label: '橈側偏', sideType: 'lr', min: 0, max: 20,  norm: 20 },
  { id: 'wrist_ud',   label: '尺側偏', sideType: 'lr', min: 0, max: 30,  norm: 30 },

  // --- 髖關節 (Hip Joint) ---
  { id: 'hip_flex', label: '髖屈曲', sideType: 'lr', min: 0, max: 125, norm: 120 },
  { id: 'hip_ext',  label: '髖後伸', sideType: 'lr', min: 0, max: 30,  norm: 20 },
  { id: 'hip_abd',  label: '髖外展', sideType: 'lr', min: 0, max: 45,  norm: 45 },
  { id: 'hip_add',  label: '髖內收', sideType: 'lr', min: 0, max: 30,  norm: 25 },
  { id: 'hip_er',   label: '髖外旋', sideType: 'lr', min: 0, max: 50,  norm: 45 },
  { id: 'hip_ir',   label: '髖內旋', sideType: 'lr', min: 0, max: 45,  norm: 35 },

  // --- 膝關節 (Knee Joint) ---
  { id: 'knee_flex', label: '膝屈曲', sideType: 'lr', min: 0, max: 150, norm: 135 },
  { id: 'knee_ext',  label: '膝伸展', sideType: 'lr', min: -10, max: 0, norm: 0 },

  // --- 踝關節與足部 (Ankle & Foot) ---
  { id: 'ankle_df',  label: '踝背屈', sideType: 'lr', min: 0, max: 20,  norm: 20 },
  { id: 'ankle_pf',  label: '踝蹠屈', sideType: 'lr', min: 0, max: 50,  norm: 45 },
  { id: 'ankle_inv', label: '足內翻', sideType: 'lr', min: 0, max: 35,  norm: 35 },
  { id: 'ankle_eve', label: '足外翻', sideType: 'lr', min: 0, max: 20,  norm: 15 }
]);

/**
 * 解剖學權重表 (AnatomicalWeights)
 * 用於搜尋排序與 TagSelector 列表排序
 */
export const AnatomicalWeights = Object.freeze({
    'Head': 100, '頭': 100,
    'Neck': 95,  '頸': 95,
    'Chest': 85, '胸': 85,
    'Back': 85,  '背': 85,
    'Waist': 85, '腰': 85,
    'Abdomen': 85, '腹': 85,
    'Shoulder': 80, '肩': 80,
    'Hip': 80,      '臀': 80,
    'Joint': 80,    '關節': 80,
    'Arm': 70,   '臂': 70,
    'Leg': 70,   '大腿': 70, '小腿': 70,
    'Hand': 60,  '手': 60,
    'Foot': 60,  '足': 60,
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