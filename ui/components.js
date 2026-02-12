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
        if (!Array.isArray(selectedParts)) {
            console.warn('[BodyMap] selectedParts should be an array');
            selectedParts = [];
        }
        if (typeof onChange !== 'function') {
            onChange = () => {};
        }

        this.selectedParts = new Set(selectedParts);
        this.onChange = onChange;
        this.readOnly = !!readOnly;
        this.currentView = 'FRONT';
        
        this.symptomMode = options.symptomMode || 'pain';
        this.symptomData = options.symptomData instanceof Map 
            ? options.symptomData 
            : new Map(Object.entries(options.symptomData || {}));

        this._renderDebounceTimer = null;

        try {
            this.element = this._renderContainer();
        } catch (error) {
            console.error('[BodyMap] Failed:', error);
            this.element = this._renderFallback();
        }
    }

    _renderFallback() {
        return el('div', {
            className: 'body-map-container error',
            style: 'padding:40px; text-align:center;'
        }, '⚠️ 人體圖載入失敗');
    }

    static get SYMPTOM_COLORS() {
        return {
            pain: '#EF4444',
            numbness: '#F59E0B',
            weakness: '#8B5CF6',
            radiation: '#10B981',
            active: '#3B82F6'
        };
    }

    setSymptomMode(mode) {
        if (BodyMap.SYMPTOM_COLORS[mode]) {
            this.symptomMode = mode;
            this._renderSVGDebounced();
        }
    }

    setSymptomData(dataMap) {
        this.symptomData = dataMap instanceof Map 
            ? dataMap 
            : new Map(Object.entries(dataMap || {}));
        this._renderSVGDebounced();
    }

    _renderSVGDebounced() {
        clearTimeout(this._renderDebounceTimer);
        this._renderDebounceTimer = setTimeout(() => this._renderSVG(), 16);
    }

    _renderContainer() {
        const container = el('div', { className: 'body-map-container' });
        
        const controlBar = el('div', { className: 'body-map-control-bar' },
            el('div', { className: 'body-map-controls segmented-control' },
                this._createSegmentButton('FRONT', '正面', true),
                this._createSegmentButton('BACK', '背面', false)
            ),
            !this.readOnly ? el('button', { 
                className: 'btn-clear-selection', 
                onclick: () => this._clearSelection() 
            }, '🗑️ 清除選取') : null
        );

        this.svgWrapper = el('div', { className: 'svg-wrapper transition-fade' });
        this.tooltip = el('div', { className: 'body-map-tooltip' });

        this._renderSVG();
        
        const children = [controlBar, this.svgWrapper, this.tooltip].filter(Boolean);
        container.append(...children);
        return container;
    }

    _createSegmentButton(view, label, isActive) {
        return el('button', { 
            className: `segment-btn ${isActive ? 'active' : ''}`,
            onclick: (e) => this._switchView(view, e.target) 
        }, label);
    }

    _switchView(view, btn) {
        if (this.currentView === view) return;
        
        this.currentView = view;
        
        const buttons = btn.parentElement.querySelectorAll('.segment-btn');
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        this.svgWrapper.style.opacity = '0';
        setTimeout(() => {
            this._renderSVG();
            this.svgWrapper.style.opacity = '1';
        }, 150);
    }

    _clearSelection() {
        if (this.selectedParts.size === 0) return;
        
        this.selectedParts.clear();
        this._renderSVG();
        
        if (typeof this.onChange === 'function') {
            this.onChange([]);
        }
    }

    /**
     * 專業級人體輪廓 - 流暢的曲線設計
     */
    static get SILHOUETTE() {
        return {
            FRONT: `
                M100,20 
                C88,20 78,28 78,38 
                C78,48 88,56 100,56 
                C112,56 122,48 122,38 
                C122,28 112,20 100,20 
                Z
                M92,56 
                C92,56 90,58 90,62 
                L88,70 
                C85,70 82,72 80,75 
                L75,85 
                C72,90 70,96 68,102 
                L65,115 
                C64,122 64,129 65,136 
                L68,155 
                C70,165 72,175 74,185 
                L76,200 
                C77,208 78,216 78,224 
                L78,260 
                C78,280 78,300 78,320 
                L78,360 
                C78,372 76,384 74,396 
                L72,420 
                C71,428 70,436 70,444 
                L70,460 
                L82,460 
                L82,444 
                C82,436 83,428 84,420 
                L86,396 
                C88,384 90,372 90,360 
                L90,320 
                C90,300 90,280 90,260 
                L90,224 
                C90,216 91,208 92,200 
                L94,185 
                C96,175 98,165 100,155 
                L100,200 
                L100,260 
                L100,320 
                L100,360 
                L100,396 
                L100,420 
                L100,444 
                L100,460 
                L118,460 
                L118,444 
                C118,436 117,428 116,420 
                L114,396 
                C112,384 110,372 110,360 
                L110,320 
                C110,300 110,280 110,260 
                L110,224 
                C110,216 109,208 108,200 
                L106,185 
                C104,175 102,165 100,155 
                L103,136 
                C104,129 104,122 103,115 
                L100,102 
                C98,96 96,90 93,85 
                L88,75 
                C86,72 83,70 80,70 
                L78,62 
                C78,58 76,56 76,56 
                Z
            `,
            BACK: `
                M100,20 
                C88,20 78,28 78,38 
                C78,48 88,56 100,56 
                C112,56 122,48 122,38 
                C122,28 112,20 100,20 
                Z
                M92,56 
                L90,70 
                L85,85 
                C82,92 80,100 78,108 
                L75,125 
                L72,145 
                L70,165 
                L68,185 
                L66,205 
                L65,225 
                L78,225 
                L78,260 
                L78,320 
                L78,360 
                L78,396 
                L76,420 
                L74,444 
                L72,460 
                L82,460 
                L84,444 
                L86,420 
                L88,396 
                L90,360 
                L90,320 
                L90,260 
                L90,225 
                L100,225 
                L100,260 
                L100,320 
                L100,360 
                L100,396 
                L100,420 
                L100,444 
                L100,460 
                L118,460 
                L116,444 
                L114,420 
                L112,396 
                L110,360 
                L110,320 
                L110,260 
                L110,225 
                L122,225 
                L121,205 
                L120,185 
                L118,165 
                L116,145 
                L114,125 
                L112,108 
                C110,100 108,92 105,85 
                L100,70 
                L98,56 
                Z
            `
        };
    }

    /**
     * 專業級解剖分區 - 關節用圓圈，區域沿外緣
     */
    static get PATHS() {
        return {
            FRONT: [
                // === 頭頸部 ===
                {
                    id: 'Head',
                    label: '頭部',
                    d: 'M100,20 C88,20 78,28 78,38 C78,48 88,56 100,56 C112,56 122,48 122,38 C122,28 112,20 100,20 Z',
                    type: 'region',
                    region: 'head'
                },
                {
                    id: 'Neck',
                    label: '頸部',
                    d: 'M92,56 L108,56 L110,70 L90,70 Z',
                    type: 'region',
                    region: 'neck'
                },

                // === 軀幹 ===
                {
                    id: 'Chest',
                    label: '胸部',
                    d: 'M80,75 L120,75 L118,115 L82,115 Z',
                    type: 'region',
                    region: 'trunk'
                },
                {
                    id: 'Abdomen',
                    label: '腹部',
                    d: 'M82,115 L118,115 L116,165 L84,165 Z',
                    type: 'region',
                    region: 'trunk'
                },
                {
                    id: 'Pelvis',
                    label: '骨盆',
                    d: 'M84,165 L116,165 L114,200 L86,200 Z',
                    type: 'region',
                    region: 'trunk'
                },

                // === 右上肢 ===
                {
                    id: 'Shoulder-R',
                    label: '右肩',
                    d: 'M68,85 C68,85 60,85 55,90 C50,95 48,102 48,108 L62,115 L75,85 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Shoulder-Joint-R',
                    label: '右肩關節',
                    d: 'M65,100 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Upper-Arm-R',
                    label: '右上臂',
                    d: 'M62,115 L48,108 L44,155 L58,155 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Elbow-R',
                    label: '右肘',
                    d: 'M51,160 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Forearm-R',
                    label: '右前臂',
                    d: 'M58,155 L44,155 L42,215 L56,215 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Wrist-R',
                    label: '右腕',
                    d: 'M49,220 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Hand-R',
                    label: '右手',
                    d: 'M56,215 L42,215 L40,245 L54,245 Z',
                    type: 'region',
                    region: 'upper-limb'
                },

                // === 左上肢 ===
                {
                    id: 'Shoulder-L',
                    label: '左肩',
                    d: 'M132,85 C132,85 140,85 145,90 C150,95 152,102 152,108 L138,115 L125,85 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Shoulder-Joint-L',
                    label: '左肩關節',
                    d: 'M135,100 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Upper-Arm-L',
                    label: '左上臂',
                    d: 'M138,115 L152,108 L156,155 L142,155 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Elbow-L',
                    label: '左肘',
                    d: 'M149,160 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Forearm-L',
                    label: '左前臂',
                    d: 'M142,155 L156,155 L158,215 L144,215 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Wrist-L',
                    label: '左腕',
                    d: 'M151,220 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'upper-limb'
                },
                {
                    id: 'Hand-L',
                    label: '左手',
                    d: 'M144,215 L158,215 L160,245 L146,245 Z',
                    type: 'region',
                    region: 'upper-limb'
                },

                // === 右下肢 ===
                {
                    id: 'Hip-R',
                    label: '右髖',
                    d: 'M86,200 L100,200 L100,235 L80,235 C82,220 84,208 86,200 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Hip-Joint-R',
                    label: '右髖關節',
                    d: 'M88,215 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Thigh-R',
                    label: '右大腿',
                    d: 'M80,235 L100,235 L100,330 L82,330 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Knee-R',
                    label: '右膝',
                    d: 'M91,335 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Leg-R',
                    label: '右小腿',
                    d: 'M82,330 L100,330 L100,410 L84,410 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Ankle-R',
                    label: '右踝',
                    d: 'M91,415 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Foot-R',
                    label: '右足',
                    d: 'M84,410 L100,410 L102,445 L80,445 Z',
                    type: 'region',
                    region: 'lower-limb'
                },

                // === 左下肢 ===
                {
                    id: 'Hip-L',
                    label: '左髖',
                    d: 'M100,200 L114,200 C116,208 118,220 120,235 L100,235 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Hip-Joint-L',
                    label: '左髖關節',
                    d: 'M112,215 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Thigh-L',
                    label: '左大腿',
                    d: 'M100,235 L120,235 L118,330 L100,330 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Knee-L',
                    label: '左膝',
                    d: 'M109,335 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Leg-L',
                    label: '左小腿',
                    d: 'M100,330 L118,330 L116,410 L100,410 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Ankle-L',
                    label: '左踝',
                    d: 'M109,415 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
                    type: 'joint',
                    region: 'lower-limb'
                },
                {
                    id: 'Foot-L',
                    label: '左足',
                    d: 'M100,410 L116,410 L120,445 L98,445 Z',
                    type: 'region',
                    region: 'lower-limb'
                }
            ],

            BACK: [
                // === 頭頸部 ===
                {
                    id: 'Head-Back',
                    label: '後頭部',
                    d: 'M100,20 C88,20 78,28 78,38 C78,48 88,56 100,56 C112,56 122,48 122,38 C122,28 112,20 100,20 Z',
                    type: 'region',
                    region: 'head'
                },
                {
                    id: 'Neck-Back',
                    label: '後頸',
                    d: 'M92,56 L108,56 L110,70 L90,70 Z',
                    type: 'region',
                    region: 'neck'
                },

                // === 脊柱 ===
                {
                    id: 'Cervical-Spine',
                    label: '頸椎',
                    d: 'M96,70 L104,70 L103,90 L97,90 Z',
                    type: 'spine',
                    region: 'spine'
                },
                {
                    id: 'Upper-Thoracic-Spine',
                    label: '上胸椎',
                    d: 'M97,90 L103,90 L102,125 L98,125 Z',
                    type: 'spine',
                    region: 'spine'
                },
                {
                    id: 'Lower-Thoracic-Spine',
                    label: '下胸椎',
                    d: 'M98,125 L102,125 L101,165 L99,165 Z',
                    type: 'spine',
                    region: 'spine'
                },
                {
                    id: 'Lumbar-Spine',
                    label: '腰椎',
                    d: 'M99,165 L101,165 L100,195 L100,195 Z',
                    type: 'spine',
                    region: 'spine'
                },
                {
                    id: 'Sacrum',
                    label: '薦椎',
                    d: 'M100,195 L100,195 L99,215 L101,215 Z',
                    type: 'spine',
                    region: 'spine'
                },

                // === 肩胛區 ===
                {
                    id: 'Scapula-R',
                    label: '右肩胛',
                    d: 'M68,85 L80,75 L85,115 L70,125 C65,110 65,95 68,85 Z',
                    type: 'region',
                    region: 'back'
                },
                {
                    id: 'Scapula-L',
                    label: '左肩胛',
                    d: 'M132,85 L120,75 L115,115 L130,125 C135,110 135,95 132,85 Z',
                    type: 'region',
                    region: 'back'
                },

                // === 背部區域 ===
                {
                    id: 'Upper-Back-R',
                    label: '右上背',
                    d: 'M80,75 L96,70 L97,125 L85,115 Z',
                    type: 'region',
                    region: 'back'
                },
                {
                    id: 'Upper-Back-L',
                    label: '左上背',
                    d: 'M120,75 L104,70 L103,125 L115,115 Z',
                    type: 'region',
                    region: 'back'
                },
                {
                    id: 'Lower-Back-R',
                    label: '右下背',
                    d: 'M85,115 L97,125 L99,195 L84,165 Z',
                    type: 'region',
                    region: 'back'
                },
                {
                    id: 'Lower-Back-L',
                    label: '左下背',
                    d: 'M115,115 L103,125 L101,195 L116,165 Z',
                    type: 'region',
                    region: 'back'
                },

                // === 臀部 ===
                {
                    id: 'Glute-R',
                    label: '右臀',
                    d: 'M84,165 L100,195 L100,225 L78,225 C80,210 82,185 84,165 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Glute-L',
                    label: '左臀',
                    d: 'M116,165 L100,195 L100,225 L122,225 C120,210 118,185 116,165 Z',
                    type: 'region',
                    region: 'lower-limb'
                },

                // === 右上肢後側 ===
                {
                    id: 'Triceps-R',
                    label: '右三頭肌',
                    d: 'M70,125 L62,115 L48,108 L44,155 L58,155 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Post-Forearm-R',
                    label: '右後前臂',
                    d: 'M58,155 L44,155 L42,215 L56,215 Z',
                    type: 'region',
                    region: 'upper-limb'
                },

                // === 左上肢後側 ===
                {
                    id: 'Triceps-L',
                    label: '左三頭肌',
                    d: 'M130,125 L138,115 L152,108 L156,155 L142,155 Z',
                    type: 'region',
                    region: 'upper-limb'
                },
                {
                    id: 'Post-Forearm-L',
                    label: '左後前臂',
                    d: 'M142,155 L156,155 L158,215 L144,215 Z',
                    type: 'region',
                    region: 'upper-limb'
                },

                // === 右下肢後側 ===
                {
                    id: 'Hamstring-R',
                    label: '右後大腿',
                    d: 'M78,225 L100,225 L100,330 L82,330 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Calf-R',
                    label: '右小腿肚',
                    d: 'M82,330 L100,330 L100,410 L84,410 Z',
                    type: 'region',
                    region: 'lower-limb'
                },

                // === 左下肢後側 ===
                {
                    id: 'Hamstring-L',
                    label: '左後大腿',
                    d: 'M100,225 L122,225 L118,330 L100,330 Z',
                    type: 'region',
                    region: 'lower-limb'
                },
                {
                    id: 'Calf-L',
                    label: '左小腿肚',
                    d: 'M100,330 L118,330 L116,410 L100,410 Z',
                    type: 'region',
                    region: 'lower-limb'
                }
            ]
        };
    }

    _renderSVG() {
        if (!this.svgWrapper) return;

        this.svgWrapper.innerHTML = '';
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        
        svg.setAttribute("viewBox", "0 0 200 480");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.setAttribute("class", "body-map-svg");

        const fragment = document.createDocumentFragment();

        // 1. 底層輪廓（淡灰色，僅作為背景）
        const silhouettePath = BodyMap.SILHOUETTE[this.currentView];
        if (silhouettePath) {
            const silhouette = document.createElementNS(svgNS, "path");
            silhouette.setAttribute("d", silhouettePath);
            silhouette.setAttribute("class", "body-silhouette");
            silhouette.setAttribute("fill", "#F8FAFC");
            silhouette.setAttribute("stroke", "#E2E8F0");
            silhouette.setAttribute("stroke-width", "1");
            fragment.appendChild(silhouette);
        }

        // 2. 解剖分區和關節
        const currentPaths = BodyMap.PATHS[this.currentView] || [];
        currentPaths.forEach(part => {
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", part.d);
            path.setAttribute("data-id", part.id);
            path.setAttribute("data-type", part.type);
            path.setAttribute("data-region", part.region);
            
            // 設置基礎樣式類
            if (part.type === 'joint') {
                path.setAttribute("class", "body-joint");
            } else if (part.type === 'spine') {
                path.setAttribute("class", "body-spine");
            } else {
                path.setAttribute("class", "body-part");
            }
            
            const isActive = this.selectedParts.has(part.id);
            if (isActive) {
                path.classList.add('active');
                
                // 症狀屬性
                const symptoms = this.symptomData.get(part.id) || [];
                if (symptoms.length > 0) {
                    path.setAttribute("data-symptom", symptoms[0]);
                }
            }

            if (this.readOnly) {
                path.setAttribute("readonly", "true");
            } else {
                path.onclick = (e) => {
                    e.stopPropagation();
                    this._togglePart(part.id, path);
                };
                
                path.onmouseenter = (e) => {
                    this._showTooltip(e, part.label, part.id);
                };
                
                path.onmousemove = (e) => {
                    this._updateTooltip(e);
                };
                
                path.onmouseleave = () => {
                    this._hideTooltip();
                };
                
                path.ontouchstart = (e) => {
                    e.preventDefault();
                    this._togglePart(part.id, path);
                };
            }
            
            fragment.appendChild(path);
        });

        svg.appendChild(fragment);
        this.svgWrapper.appendChild(svg);
    }

    _togglePart(partId, pathElement) {
        if (this.readOnly || !partId) return;

        try {
            if (this.selectedParts.has(partId)) {
                this.selectedParts.delete(partId);
                pathElement.classList.remove('active');
                pathElement.removeAttribute('data-symptom');
            } else {
                this.selectedParts.add(partId);
                pathElement.classList.add('active');
                
                const symptoms = this.symptomData.get(partId) || [];
                if (symptoms.length > 0) {
                    pathElement.setAttribute("data-symptom", symptoms[0]);
                }
            }
            
            if (typeof this.onChange === 'function') {
                this.onChange(Array.from(this.selectedParts));
            }
        } catch (error) {
            console.error('[BodyMap] Toggle failed:', error);
        }
    }

    _showTooltip(event, label, partId) {
        if (!this.tooltip) return;

        const symptoms = this.symptomData.get(partId) || [];
        const symptomText = symptoms.length > 0 
            ? ` (${symptoms.map(s => s.toUpperCase()).join(', ')})` 
            : '';
        
        this.tooltip.textContent = label + symptomText;
        this.tooltip.style.opacity = '1';
        this._updateTooltip(event);
    }

    _updateTooltip(event) {
        if (!this.tooltip || !this.svgWrapper) return;

        const rect = this.svgWrapper.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = (y - 35) + 'px';
    }

    _hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
        }
    }

    updateSelection(parts) {
        if (!Array.isArray(parts)) return;
        this.selectedParts = new Set(parts);
        this._renderSVGDebounced();
    }

    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.selectedParts.clear();
        this.onChange = null;
        clearTimeout(this._renderDebounceTimer);
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
