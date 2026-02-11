/**
 * src/ui/components.js
 * 共用 UI 元件庫
 * 
 * @description 提供 Modal, Toast, TagSelector, BodyMap 等基礎互動元件。
 * [PATCH-v6.3.1] 重構 TagSelector 支援標籤分群渲染（解剖 vs 診斷），優化醫療紀錄結構。
 */

import { EventTypes, AnatomicalWeights, TagType } from '../config.js';
import { BodyRegions, TissueStyles } from '../config.js';
import { EventBus } from '../core/utils.js';

// --- DOM Helper ---
export const el = (tag, props = {}, ...children) => {
    const element = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
        if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key === 'className') {
            element.className = value;
        } else {
            element.setAttribute(key, value);
        }
    });
    children.forEach(child => {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });
    return element;
};

// --- Toast Notification ---
export class Toast {
    static show(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container') || this._createContainer();
        const toast = el('div', { className: `toast toast-${type}` }, message);
        
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    static _createContainer() {
        const div = el('div', { id: 'toast-container', className: 'toast-container' });
        document.body.appendChild(div);
        return div;
    }
}

// --- Modal ---
export class Modal {
    constructor(title, contentElement, onConfirm = null) {
        this.overlay = el('div', { className: 'modal-overlay' });
        this.container = el('div', { className: 'modal-container' });
        
        const header = el('div', { className: 'modal-header' }, 
            el('h3', {}, title),
            el('button', { className: 'close-btn', onclick: () => this.close() }, '×')
        );

        const body = el('div', { className: 'modal-body' }, contentElement);
        
        const footer = el('div', { className: 'modal-footer' },
            el('button', { className: 'btn-secondary', onclick: () => this.close() }, '取消'),
            el('button', { className: 'btn-primary', onclick: () => {
                if (onConfirm) onConfirm();
                this.close();
            }}, '確定')
        );

        this.container.append(header, body, footer);
        this.overlay.appendChild(this.container);
    }

    open() {
        document.body.appendChild(this.overlay);
    }

    close() {
        this.overlay.remove();
    }
}

// --- Tag Selector ---

export class TagSelector {
    constructor(selectedTags = [], availableTags = [], onChange) {
        this.items = selectedTags.map(t => typeof t === 'string' ? { tagId: t, remark: '' } : t);
        this.available = availableTags;
        this.onChange = onChange;
        this.element = el('div', { className: 'tag-selector' });
        this.render();
    }

    render() {
        this.element.innerHTML = '';
        const list = el('div', { className: 'history-list-rows' });
        this.items.forEach((item, index) => {
            list.appendChild(el('div', { className: 'history-edit-row', style: 'display:flex; gap:8px; margin-bottom:12px; align-items:center' },
                el('input', { type: 'text', value: item.tagId, className: 'search-bar', style: 'flex:1; font-weight:bold', onchange: (e) => { this.items[index].tagId = e.target.value; this._notify(); } }),
                el('span', { style: 'color:var(--text-muted)' }, '【'),
                el('input', { type: 'text', value: item.remark, className: 'search-bar', style: 'flex:1.2; border-bottom:1px dashed var(--border)', onchange: (e) => { this.items[index].remark = e.target.value; this._notify(); } }),
                el('span', { style: 'color:var(--text-muted)' }, '】'),
                el('button', { className: 'icon-btn text-danger', onclick: () => { this.items.splice(index, 1); this.render(); this._notify(); } }, '×')
            ));
        });

        const suggestions = el('div', { className: 'tag-suggestions mt-3' },
            ...this.available.filter(t => t.name !== '好聊').sort((a,b) => (b.count||0)-(a.count||0)).slice(0, 10).map(tag => el('span', {
                className: 'tag-chip suggestion',
                style: { backgroundColor: tag.color || '#94a3b8', cursor: 'pointer', margin: '0 4px 4px 0' },
                onclick: () => this._addTag(tag.name)
            }, tag.name))
        );

        this.element.append(list, el('button', { className: 'btn-secondary w-100', style: 'margin-top:8px; border:2px dashed var(--border)', onclick: () => { this.items.push({ tagId: '', remark: '' }); this.render(); } }, '+ 新增病史標籤'), suggestions);
    }
_getAnatomyStyle(tagName) {
    import('../config.js').then(({ BodyRegions }) => {
        const region = Object.values(BodyRegions).find(r => tagName.includes(r.label));
        return region ? `hsl(${region.hue}, 70%, 90%)` : 'var(--bg-muted)';
    });
}

    _addTag(name) { // 供 BodyMap 或建議按鈕呼叫
        if (!this.items.some(i => i.tagId === name)) {
            this.items.push({ tagId: name, remark: '' });
            this.render();
            this._notify();
        }
    }
/**
 * [生產級重構] TagSelector 標籤列渲染器
 * 整合：行動端長按、震動回饋 (Haptic)、標籤類型自動配色 
 */
_renderTagRow({ item, index, def }) {
    // 1. [防禦性狀態] 初始化觸控計時器與狀態鎖 
    let pressTimer = null;
    let isLongPress = false;
    const isReadOnly = this.readOnly || (typeof storageManager !== 'undefined' && storageManager.isEphemeral);

    // 2. [視覺邏輯] 根據標籤類型 (ANATOMY) 與部位 hue 值計算背景色 
    let rowStyle = 'display:flex; gap:8px; margin-bottom:12px; align-items:center; padding:8px; border-radius:8px; transition:all 0.2s;';
    if (def?.type === 'ANATOMY') {
        // 從 config.js 的 BodyRegions 匹配 hue 值 (此處需確保 BodyRegions 已載入)
        const hue = def.hue || 200; // 預設藍色系
        rowStyle += `background: hsla(${hue}, 70%, 95%, 1); border: 1px solid hsla(${hue}, 70%, 80%, 1);`;
    } else {
        rowStyle += 'background: var(--surface); border: 1px solid var(--border);';
    }

    const row = el('div', { 
        className: 'history-edit-row',
        style: rowStyle,
        
        // 3. [行動端長按引擎] 實作震動回饋與 Action Sheet 觸發 
        ontouchstart: (e) => {
            if (isReadOnly) return;
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                // [防禦性檢查] 僅在支援的設備執行震動 
                if (navigator.vibrate) navigator.vibrate(50); 
                this._showTagActionSheet(item, index); 
            }, 600); // 長按 600ms 觸發規範 
        },
        
        // 4. [防禦性取消] 處理捲動或手指移開時的誤觸 
        ontouchmove: () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        },
        
        ontouchend: (e) => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            // 若觸發了長按，則阻止後續的 Click 事件以免彈出鍵盤
            if (isLongPress) {
                e.preventDefault();
            }
        }
    },
        el('input', { 
            type: 'text', value: item.tagId, className: 'tag-id-input',
            style: 'flex:1; font-weight:bold; border:none; background:transparent;',
            disabled: isReadOnly,
            onchange: (e) => { this.items[index].tagId = e.target.value; this._notify(); }
        }),
        el('span', { style: 'color:var(--text-muted)' }, '【'),
        el('input', { 
            type: 'text', value: item.remark, className: 'tag-remark-input',
            placeholder: '備註...',
            style: 'flex:1.2; border:none; background:transparent; border-bottom:1px dashed var(--border);',
            disabled: isReadOnly,
            onchange: (e) => { this.items[index].remark = e.target.value; this._notify(); }
        }),
        el('span', { style: 'color:var(--text-muted)' }, '】'),
        // 桌機版保留刪除按鈕，行動端可透過長按選單操作
        el('button', { 
            className: 'icon-btn text-danger', 
            style: isReadOnly ? 'display:none' : '',
            onclick: () => { this.items.splice(index, 1); this.render(); this._notify(); } 
        }, '×')
    );

    return row;
}

/**
 * [行動端選單] 實作 Action Sheet 聯動 
 */
_showTagActionSheet(item, index) {
    import('./components.js').then(({ ActionSheet }) => {
        ActionSheet.show([
            { label: `標籤內容：${item.tagId || '(空白)'}`, handler: () => {} },
            { 
                label: '🗑️ 刪除此標籤', 
                danger: true, 
                handler: () => {
                    this.items.splice(index, 1);
                    this.render();
                    this._notify();
                }
            }
        ]);
    });
}
    /**
     * [新增] 供 BodyMap 取消選取時同步移除標籤
     * @param {string} name - 部位標籤名稱
     */
    _removeTag(name) {
        const index = this.items.findIndex(i => i.tagId === name);
        if (index !== -1) {
            // 僅移除該項而不影響其他標籤，隨後重新渲染介面
            this.items.splice(index, 1);
            this.render();
            this._notify();
        }
    }

    _notify() { this.onChange(this.items.filter(i => i.tagId.trim())); }
}

// --- Body Map (SVG) with Anatomical Segmentation ---
/**
 * BodyMap Enhanced - 完整功能版
 * 復原：響應式設計、進階選取邏輯、公開 API 接口
 */
export class BodyMap {
    constructor(selectedParts = [], onChange, readOnly = false, options = {}) {
        this.selectedParts = new Set(selectedParts);
        this.onChange = onChange;
        this.readOnly = readOnly;
        this.currentView = 'FRONT'; 
        
        // 症狀模式與數據初始化
        this.symptomMode = options.symptomMode || 'pain';
        this.symptomData = options.symptomData instanceof Map 
            ? options.symptomData 
            : new Map(Object.entries(options.symptomData || {}));

        this.element = this._renderContainer();
    }

    static get SYMPTOM_COLORS() {
        return {
            pain: '#EF4444',       // 紅色 - 痛點
            numbness: '#F59E0B',   // 橙色 - 麻
            weakness: '#8B5CF6',   // 紫色 - 無力
            radiation: '#10B981',  // 綠色 - 放射痛
            active: '#4C84FF'      // 預設選取藍
        };
    }

    // 公開 API：動態設定症狀模式
    setSymptomMode(mode) {
        if (BodyMap.SYMPTOM_COLORS[mode]) {
            this.symptomMode = mode;
            this._renderSVG();
        }
    }

    // 公開 API：動態更新症狀數據
    setSymptomData(dataMap) {
        this.symptomData = dataMap instanceof Map 
            ? dataMap 
            : new Map(Object.entries(dataMap));
        this._renderSVG();
    }

    _renderContainer() {
        // 響應式容器設計
        const container = el('div', { 
            className: 'body-map-container',
            style: 'position:relative; width:100%; max-width:500px; margin:auto; background:var(--surface); border-radius:12px; padding:16px;' 
        });
        
        const controlBar = el('div', { className: 'body-map-control-bar', style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;' },
            el('div', { className: 'segmented-control', style: 'display:flex; gap:4px; background:var(--bg-muted); padding:4px; border-radius:8px;' },
                el('button', { className: 'segment-btn active', onclick: (e) => this._switchView('FRONT', e.target) }, '正面'),
                el('button', { className: 'segment-btn', onclick: (e) => this._switchView('BACK', e.target) }, '背面')
            ),
            el('button', { className: 'btn-secondary', onclick: () => this._clearSelection() }, '🗑️ 清除選取')
        );

        this.svgWrapper = el('div', { 
            className: 'svg-wrapper transition-fade', 
            style: 'position:relative; width:100%; touch-action:manipulation;' 
        });
        
        this.tooltip = el('div', { 
            className: 'body-map-tooltip', 
            style: 'position:absolute; background:rgba(0,0,0,0.85); color:#fff; padding:8px 12px; border-radius:6px; pointer-events:none; opacity:0; z-index:1000; font-size:13px; transition:opacity 0.15s;' 
        });

        this._renderSVG();
        container.append(controlBar, this.svgWrapper, this.tooltip);
        return container;
    }

static get SILHOUETTE() {
        return {
            FRONT: 'M100,5 C85,5 72,18 72,35 C72,52 85,62 100,62 L88,62 C85,75 82,80 70,80 C55,80 48,90 45,105 L35,140 C32,150 32,165 38,175 L38,210 C36,215 36,225 38,230 L33,270 L33,270 L70,240 L70,310 L75,335 L85,385 L75,400 L95,400 L100,385 L100,335 L100,310 L100,240 L100,205 L85,205 C78,190 75,170 72,140 C68,130 65,110 70,80 L88,62 L112,62 C115,75 118,80 130,80 C135,110 132,130 128,140 C125,170 122,190 115,205 L100,205 L100,240 L100,310 L100,335 L100,385 L105,400 L125,400 L115,385 L120,335 L125,310 L130,240 L167,270 L162,230 C164,225 164,215 162,210 L162,175 C168,165 168,150 165,140 L155,105 C152,90 145,80 130,80 C132,130 128,140 72,140 L128,140 C128,52 115,5 100,5 Z',
            BACK: 'M100,5 C85,5 72,18 72,35 C72,52 85,62 100,62 L88,62 C85,75 82,80 70,80 C65,115 68,135 72,145 C75,180 78,200 85,215 C70,225 65,260 85,275 L70,275 L75,345 L85,385 L75,400 L95,400 L100,385 L100,345 L100,275 L85,275 L85,215 L100,205 L115,215 C130,225 135,260 115,275 L100,275 L100,345 L100,385 L105,400 L125,400 L115,385 L125,345 L130,275 L115,275 L115,215 C122,200 125,180 128,145 C132,135 135,115 130,80 C118,80 115,75 112,62 C128,52 128,18 115,5 C100,5 100,5 100,5 Z'
        };
    }
static get PATHS() {
        return {
            FRONT: [
                // === 中軸結構 ===
                { 
                    id: 'Head', 
                    label: '頭部', 
                    d: 'M100,10 C82,10 68,24 68,42 C68,60 82,74 100,74 C118,74 132,60 132,42 C132,24 118,10 100,10 Z',
                    region: 'central'
                },
                { 
                    id: 'Neck', 
                    label: '頸部', 
                    d: 'M86,74 L114,74 C114,74 117,90 120,96 L80,96 C83,90 86,74 86,74 Z',
                    region: 'central'
                },
                { 
                    id: 'Chest', 
                    label: '胸部', 
                    d: 'M68,96 L132,96 C137,130 134,154 130,168 L70,168 C66,154 63,130 68,96 Z',
                    region: 'central'
                },
                { 
                    id: 'Abdomen', 
                    label: '腹部', 
                    d: 'M70,168 L130,168 C127,206 124,232 117,252 L83,252 C76,232 73,206 70,168 Z',
                    region: 'central'
                },
                
                // === 右上肢 (R) ===
                { 
                    id: 'Shoulder-R', 
                    label: '右肩', 
                    d: 'M68,98 C50,96 42,108 38,126 L56,138 C58,126 62,114 68,98 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Upper-Arm-R', 
                    label: '右上臂', 
                    d: 'M56,138 L38,126 C35,142 32,158 32,174 L48,174 C52,158 54,146 56,138 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Elbow-R', 
                    label: '右肘', 
                    d: 'M48,174 L32,174 C30,184 30,198 34,210 L50,210 C54,198 54,184 48,174 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Forearm-R', 
                    label: '右前臂', 
                    d: 'M50,210 L34,210 C32,228 30,246 30,258 L46,258 C48,246 50,228 50,210 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Wrist-R', 
                    label: '右腕', 
                    d: 'M46,258 L30,258 C28,264 28,272 30,278 L46,278 C48,272 48,264 46,258 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Hand-R', 
                    label: '右手', 
                    d: 'M30,278 L46,278 L50,324 L26,324 Z',
                    region: 'upper-limb'
                },
                
                // === 左上肢 (L) ===
                { 
                    id: 'Shoulder-L', 
                    label: '左肩', 
                    d: 'M132,98 C150,96 158,108 162,126 L144,138 C142,126 138,114 132,98 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Upper-Arm-L', 
                    label: '左上臂', 
                    d: 'M144,138 L162,126 C165,142 168,158 168,174 L152,174 C148,158 146,146 144,138 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Elbow-L', 
                    label: '左肘', 
                    d: 'M152,174 L168,174 C170,184 170,198 166,210 L150,210 C146,198 146,184 152,174 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Forearm-L', 
                    label: '左前臂', 
                    d: 'M150,210 L166,210 C168,228 170,246 170,258 L154,258 C152,246 150,228 150,210 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Wrist-L', 
                    label: '左腕', 
                    d: 'M154,258 L170,258 C172,264 172,272 170,278 L154,278 C152,272 152,264 154,258 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Hand-L', 
                    label: '左手', 
                    d: 'M170,278 L154,278 L150,324 L174,324 Z',
                    region: 'upper-limb'
                },
                
                // === 右下肢 (R) ===
                { 
                    id: 'Hip-R', 
                    label: '右髖', 
                    d: 'M83,252 L100,252 L100,294 L66,294 C71,272 77,260 83,252 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Thigh-R', 
                    label: '右大腿', 
                    d: 'M66,294 L100,294 L100,396 L72,396 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Knee-R', 
                    label: '右膝', 
                    d: 'M72,396 L100,396 L100,426 L76,426 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Leg-R', 
                    label: '右小腿', 
                    d: 'M76,426 L100,426 L100,494 L82,494 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Ankle-R', 
                    label: '右踝', 
                    d: 'M82,494 L100,494 L100,510 L84,510 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Foot-R', 
                    label: '右足', 
                    d: 'M84,510 L100,510 L106,540 L74,540 Z',
                    region: 'lower-limb'
                },
                
                // === 左下肢 (L) ===
                { 
                    id: 'Hip-L', 
                    label: '左髖', 
                    d: 'M100,252 L117,252 C123,260 129,272 134,294 L100,294 L100,252 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Thigh-L', 
                    label: '左大腿', 
                    d: 'M100,294 L134,294 L128,396 L100,396 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Knee-L', 
                    label: '左膝', 
                    d: 'M100,396 L128,396 L124,426 L100,426 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Leg-L', 
                    label: '左小腿', 
                    d: 'M100,426 L124,426 L118,494 L100,494 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Ankle-L', 
                    label: '左踝', 
                    d: 'M100,494 L118,494 L116,510 L100,510 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Foot-L', 
                    label: '左足', 
                    d: 'M100,510 L116,510 L126,540 L94,540 Z',
                    region: 'lower-limb'
                }
            ],
            
            BACK: [
                // === 中軸結構 (背面) ===
                { 
                    id: 'Head-Back', 
                    label: '後頭部', 
                    d: 'M100,10 C82,10 68,24 68,42 C68,60 82,74 100,74 C118,74 132,60 132,42 C132,24 118,10 100,10 Z',
                    region: 'central'
                },
                { 
                    id: 'Cervical', 
                    label: '頸椎', 
                    d: 'M86,74 L114,74 C114,74 117,90 120,96 L80,96 C83,90 86,74 86,74 Z',
                    region: 'spine'
                },
                { 
                    id: 'Upper-Thoracic', 
                    label: '上胸椎', 
                    d: 'M80,96 L120,96 C122,116 120,134 118,148 L82,148 C80,134 78,116 80,96 Z',
                    region: 'spine'
                },
                { 
                    id: 'Mid-Thoracic', 
                    label: '中胸椎', 
                    d: 'M82,148 L118,148 C116,168 114,186 112,200 L88,200 C86,186 84,168 82,148 Z',
                    region: 'spine'
                },
                { 
                    id: 'Lumbar', 
                    label: '腰椎', 
                    d: 'M88,200 L112,200 C110,222 108,242 105,256 L95,256 C92,242 90,222 88,200 Z',
                    region: 'spine'
                },
                { 
                    id: 'Sacrum', 
                    label: '薦椎', 
                    d: 'M95,256 L105,256 C106,268 106,280 105,290 L95,290 C94,280 94,268 95,256 Z',
                    region: 'spine'
                },
                
                // === 肩胛區域 ===
                { 
                    id: 'Scapula-R', 
                    label: '右肩胛', 
                    d: 'M68,98 C50,96 42,108 38,126 L56,138 C58,126 62,114 68,98 L82,112 L70,140 L56,138 Z',
                    region: 'back'
                },
                { 
                    id: 'Scapula-L', 
                    label: '左肩胛', 
                    d: 'M132,98 C150,96 158,108 162,126 L144,138 C142,126 138,114 132,98 L118,112 L130,140 L144,138 Z',
                    region: 'back'
                },
                
                // === 上背區 ===
                { 
                    id: 'Upper-Back-R', 
                    label: '右上背', 
                    d: 'M68,96 L80,96 L82,148 L70,168 C66,154 63,130 68,96 Z',
                    region: 'back'
                },
                { 
                    id: 'Upper-Back-L', 
                    label: '左上背', 
                    d: 'M132,96 L120,96 L118,148 L130,168 C134,154 137,130 132,96 Z',
                    region: 'back'
                },
                
                // === 下背區 ===
                { 
                    id: 'Lower-Back-R', 
                    label: '右下背', 
                    d: 'M70,168 L82,148 L88,200 L83,252 C76,232 73,206 70,168 Z',
                    region: 'back'
                },
                { 
                    id: 'Lower-Back-L', 
                    label: '左下背', 
                    d: 'M130,168 L118,148 L112,200 L117,252 C124,232 127,206 130,168 Z',
                    region: 'back'
                },
                
                // === 臀部 ===
                { 
                    id: 'Glute-R', 
                    label: '右臀', 
                    d: 'M83,252 L100,252 L100,294 L66,294 C62,280 65,265 75,256 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Glute-L', 
                    label: '左臀', 
                    d: 'M100,252 L117,252 C125,256 128,265 134,280 L134,294 L100,294 Z',
                    region: 'lower-limb'
                },
                
                // === 右上肢後側 ===
                { 
                    id: 'Triceps-R', 
                    label: '右三頭肌', 
                    d: 'M56,138 L38,126 C35,142 32,158 32,174 L48,174 C52,158 54,146 56,138 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Posterior-Forearm-R', 
                    label: '右後前臂', 
                    d: 'M50,210 L34,210 C32,228 30,246 30,258 L46,258 C48,246 50,228 50,210 Z',
                    region: 'upper-limb'
                },
                
                // === 左上肢後側 ===
                { 
                    id: 'Triceps-L', 
                    label: '左三頭肌', 
                    d: 'M144,138 L162,126 C165,142 168,158 168,174 L152,174 C148,158 146,146 144,138 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Posterior-Forearm-L', 
                    label: '左後前臂', 
                    d: 'M150,210 L166,210 C168,228 170,246 170,258 L154,258 C152,246 150,228 150,210 Z',
                    region: 'upper-limb'
                },
                
                // === 右下肢後側 ===
                { 
                    id: 'Hamstring-R', 
                    label: '右後大腿', 
                    d: 'M66,294 L100,294 L100,396 L72,396 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Calf-R', 
                    label: '右小腿肚', 
                    d: 'M76,426 L100,426 L100,494 L82,494 Z',
                    region: 'lower-limb'
                },
                
                // === 左下肢後側 ===
                { 
                    id: 'Hamstring-L', 
                    label: '左後大腿', 
                    d: 'M100,294 L134,294 L128,396 L100,396 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Calf-L', 
                    label: '左小腿肚', 
                    d: 'M100,426 L124,426 L118,494 L100,494 Z',
                    region: 'lower-limb'
                }
            ]
        };
    }
    _renderSVG() {
        this.svgWrapper.innerHTML = '';
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        
        // 響應式 viewBox 與比例優化
        svg.setAttribute("viewBox", "0 0 200 600");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.08))';

        const fragment = document.createDocumentFragment();

        // 1. 底層輪廓
        const silhouette = document.createElementNS(svgNS, "path");
        silhouette.setAttribute("d", BodyMap.SILHOUETTE[this.currentView]);
        silhouette.setAttribute("fill", "#F3F6F9");
        silhouette.setAttribute("stroke", "#C7D0D9");
        fragment.appendChild(silhouette);

        // 2. 解剖分區繪製
        const currentPaths = BodyMap.PATHS[this.currentView] || [];
        currentPaths.forEach(part => {
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", part.d);
            path.setAttribute("data-id", part.id);
            
            const isActive = this.selectedParts.has(part.id);
            this._applyPartStyle(path, part.id, isActive);

            if (!this.readOnly) {
                path.style.cursor = 'pointer';
                path.onclick = (e) => this._togglePart(part.id, path, e); // 支援 Shift/Alt
                path.onmouseenter = (e) => this._showTooltip(e, part.label, part.id);
                path.onmousemove = (e) => this._updateTooltip(e);
                path.onmouseleave = () => this._hideTooltip();
            }
            fragment.appendChild(path);
        });

        svg.appendChild(fragment);
        this.svgWrapper.appendChild(svg);
    }

    _applyPartStyle(element, partId, isActive) {
        if (isActive) {
            // 症狀配色邏輯
            const symptoms = this.symptomData.get(partId) || [];
            const colorKey = symptoms[0] || this.symptomMode;
            const color = BodyMap.SYMPTOM_COLORS[colorKey] || BodyMap.SYMPTOM_COLORS.active;
            
            element.setAttribute("fill", color);
            element.setAttribute("stroke", this._darkenColor(color));
            element.setAttribute("stroke-width", "1.5");
        } else {
            element.setAttribute("fill", "#E9EEF3");
            element.setAttribute("stroke", "#B8C4D1");
            element.setAttribute("stroke-width", "1");
        }
    }

    _togglePart(partId, element, event) {
        event.preventDefault();
        
        // 復原 Alt (單選) / Shift 或一般點擊 (多選) 邏輯
        if (event.altKey) {
            this.selectedParts.clear();
            this.selectedParts.add(partId);
        } else {
            if (this.selectedParts.has(partId)) {
                this.selectedParts.delete(partId);
            } else {
                this.selectedParts.add(partId);
            }
        }

        // 局部樣式更新
        const allPaths = this.svgWrapper.querySelectorAll('path[data-id]');
        allPaths.forEach(p => {
            const id = p.getAttribute('data-id');
            this._applyPartStyle(p, id, this.selectedParts.has(id));
        });

        if (this.onChange) this.onChange(Array.from(this.selectedParts));
    }

    // 支援症狀顯示的 Tooltip
    _showTooltip(e, label, partId) {
        const symptoms = this.symptomData.get(partId) || [];
        const symptomText = symptoms.length > 0 ? ` (${symptoms.join(', ')})` : '';
        this.tooltip.textContent = label + symptomText;
        this.tooltip.style.opacity = '1';
        this._updateTooltip(e);
    }

    _updateTooltip(e) {
        const rect = this.svgWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.tooltip.style.transform = `translate(${x + 12}px, ${y - 12}px)`;
    }

    _hideTooltip() { this.tooltip.style.opacity = '0'; }

    _clearSelection() {
        this.selectedParts.clear();
        this._renderSVG();
        if (this.onChange) this.onChange([]);
    }

    _switchView(view, targetBtn) {
        this.svgWrapper.style.opacity = '0';
        setTimeout(() => {
            this.currentView = view;
            const btns = targetBtn.parentElement.querySelectorAll('.segment-btn');
            btns.forEach(b => b.classList.toggle('active', b === targetBtn));
            this._renderSVG();
            this.svgWrapper.style.opacity = '1';
        }, 150);
    }

    _darkenColor(hex) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, ((num >> 16) & 0xFF) - 30);
        const g = Math.max(0, ((num >> 8) & 0xFF) - 30);
        const b = Math.max(0, (num & 0xFF) - 30);
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    updateSelection(newParts) {
        this.selectedParts = new Set(newParts || []);
        this._renderSVG();
    }
}

export class ROMSlider {
    /**
     * @param {Object} config - { id, label, min, max, norm, value, onChange }
     */
    constructor({ id, label, min = 0, max = 180, norm = 150, value = 0, onChange }) {
        this.id = id;
        this.label = label;
        this.min = min;
        this.max = max;
        this.norm = norm;
        this.value = value;
        this.onChange = onChange;
        this.readOnly = readOnly;
        this.element = this._render();
    }

    _render() {
        const percentage = ((this.value - this.min) / (this.max - this.min)) * 100;
        const normPercentage = ((this.norm - this.min) / (this.max - this.min)) * 100;

        const labelRow = el('div', { className: 'rom-label-row' },
            el('span', { className: 'rom-name' }, this.label),
            el('span', { className: 'rom-value' }, `${this.value}°`)
        );

        // 建立帶有「健康區間」背景的 Slider
        const slider = el('input', {
        type: 'range',
        className: 'rom-input',
        min: this.min,
        max: this.max,
        value: this.value,
        // [防禦修正] 根據 readOnly 狀態鎖定 UI 互動 
        disabled: this.readOnly, 
        style: {
            background: `linear-gradient(to right, #e0f2fe 0%, #e0f2fe ${normPercentage}%, #f1f5f9 ${normPercentage}%, #f1f5f9 100%)`,
            // [防禦修正] 增加視覺回饋，提示當前為不可編輯狀態 
            cursor: this.readOnly ? 'not-allowed' : 'pointer',
            opacity: this.readOnly ? '0.6' : '1',
            filter: this.readOnly ? 'grayscale(1)' : 'none'
        },
        oninput: (e) => {
            // [防禦修正] 二次攔截：防止透過移除 disabled 屬性進行非法操作 
            if (this.readOnly) return; 

            const newVal = parseInt(e.target.value);
            this.value = newVal;
            labelRow.querySelector('.rom-value').textContent = `${newVal}°`;
            if (this.onChange) this.onChange(newVal);
            
            const valEl = labelRow.querySelector('.rom-value');
            valEl.style.color = newVal < (this.norm * 0.7) ? 'var(--danger)' : 'var(--primary)';
        }
    });

        const container = el('div', { className: 'rom-item-container' }, labelRow, slider);
        
        // 標記正常值刻度 (Normal Indicator)
        const indicator = el('div', { 
            className: 'rom-norm-mark',
            style: { left: `${normPercentage}%` },
            title: `正常值: ${this.norm}°`
        });
        
        const trackWrapper = el('div', { style: 'position:relative' }, slider, indicator);
        container.innerHTML = '';
        container.append(labelRow, trackWrapper);
        
        return container;
    }
}
// --- Action Sheet (Mobile) ---
export class ActionSheet {
    static show(options = []) {
        const overlay = el('div', { className: 'modal-overlay' });
        const sheet = el('div', { 
            className: 'action-sheet',
            style: {
                position: 'fixed', bottom: '0', left: '0', width: '100%',
                background: 'var(--surface)', borderTopLeftRadius: '16px', borderTopRightRadius: '16px',
                padding: '20px', animation: 'slideUp 0.3s'
            }
        });

        options.forEach(opt => {
            const btn = el('button', { 
                className: `btn-secondary ${opt.danger ? 'text-danger' : ''}`,
                style: { width: '100%', marginBottom: '10px', padding: '12px' },
                onclick: () => {
                    opt.handler();
                    overlay.remove();
                }
            }, opt.label);
            sheet.appendChild(btn);
        });

        const cancel = el('button', { 
            className: 'btn-secondary', style: { width: '100%', padding: '12px' },
            onclick: () => overlay.remove() 
        }, 'Cancel');
        
        sheet.appendChild(cancel);
        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    }
}
