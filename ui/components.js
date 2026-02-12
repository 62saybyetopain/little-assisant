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
        
        // 圖片路徑配置（可以自定義）
        this.imagePaths = options.imagePaths || {
            FRONT: '/assets/body-front.png',  // 正面圖片路徑
            BACK: '/assets/body-back.png'     // 背面圖片路徑
        };
        
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
            pain: 'rgba(239, 68, 68, 0.6)',      // 紅色半透明
            numbness: 'rgba(245, 158, 11, 0.6)', // 橙色半透明
            weakness: 'rgba(139, 92, 246, 0.6)', // 紫色半透明
            radiation: 'rgba(16, 185, 129, 0.6)',// 綠色半透明
            active: 'rgba(59, 130, 246, 0.5)'    // 藍色半透明
        };
    }

    static get SYMPTOM_STROKES() {
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
            this._renderOverlayDebounced();
        }
    }

    setSymptomData(dataMap) {
        this.symptomData = dataMap instanceof Map 
            ? dataMap 
            : new Map(Object.entries(dataMap || {}));
        this._renderOverlayDebounced();
    }

    _renderOverlayDebounced() {
        clearTimeout(this._renderDebounceTimer);
        this._renderDebounceTimer = setTimeout(() => this._renderOverlay(), 16);
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

        // 圖片容器（使用相對定位）
        this.imageContainer = el('div', { 
            className: 'body-map-image-container',
            style: 'position: relative; width: 100%; max-width: 400px; margin: 0 auto;'
        });

        // 底圖
        this.bodyImage = el('img', {
            className: 'body-map-image',
            src: this.imagePaths[this.currentView],
            alt: '人體圖',
            style: 'width: 100%; height: auto; display: block;'
        });

        // SVG 疊加層（透明，用於交互）
        this.svgOverlay = el('div', { 
            className: 'body-map-overlay',
            style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;'
        });

        // Tooltip
        this.tooltip = el('div', { className: 'body-map-tooltip' });

        this.imageContainer.append(this.bodyImage, this.svgOverlay);
        
        // 等圖片載入完成後渲染 SVG
        this.bodyImage.onload = () => {
            this._renderOverlay();
        };

        const children = [controlBar, this.imageContainer, this.tooltip].filter(Boolean);
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
        
        // 切換圖片
        this.imageContainer.style.opacity = '0';
        setTimeout(() => {
            this.bodyImage.src = this.imagePaths[this.currentView];
            this.bodyImage.onload = () => {
                this._renderOverlay();
                this.imageContainer.style.opacity = '1';
            };
        }, 150);
    }

    _clearSelection() {
        if (this.selectedParts.size === 0) return;
        
        this.selectedParts.clear();
        this._renderOverlay();
        
        if (typeof this.onChange === 'function') {
            this.onChange([]);
        }
    }

    /**
     * 熱區定義 - 坐標基於 400x600 的標準圖片
     * 每個區域定義：{id, label, type, coords}
     * coords: 百分比坐標 [x%, y%, width%, height%] 或多邊形點陣列
     */
    static get HOTSPOTS() {
        return {
            FRONT: [
                // === 頭頸部 ===
                {
                    id: 'Head',
                    label: '頭部',
                    type: 'circle',
                    coords: [50, 8, 8],  // [centerX%, centerY%, radius%]
                    region: 'head'
                },
                {
                    id: 'Neck',
                    label: '頸部',
                    type: 'rect',
                    coords: [42, 14, 16, 6],  // [x%, y%, width%, height%]
                    region: 'neck'
                },

                // === 軀幹 ===
                {
                    id: 'Chest',
                    label: '胸部',
                    type: 'rect',
                    coords: [35, 20, 30, 15],
                    region: 'trunk'
                },
                {
                    id: 'Abdomen',
                    label: '腹部',
                    type: 'rect',
                    coords: [38, 35, 24, 15],
                    region: 'trunk'
                },
                {
                    id: 'Pelvis',
                    label: '骨盆',
                    type: 'rect',
                    coords: [40, 50, 20, 10],
                    region: 'trunk'
                },

                // === 右上肢 ===
                {
                    id: 'Shoulder-R',
                    label: '右肩',
                    type: 'circle',
                    coords: [25, 22, 5],
                    region: 'upper-limb'
                },
                {
                    id: 'Upper-Arm-R',
                    label: '右上臂',
                    type: 'rect',
                    coords: [18, 25, 10, 15],
                    region: 'upper-limb'
                },
                {
                    id: 'Elbow-R',
                    label: '右肘',
                    type: 'circle',
                    coords: [23, 42, 4],
                    region: 'upper-limb'
                },
                {
                    id: 'Forearm-R',
                    label: '右前臂',
                    type: 'rect',
                    coords: [19, 45, 9, 15],
                    region: 'upper-limb'
                },
                {
                    id: 'Wrist-R',
                    label: '右腕',
                    type: 'circle',
                    coords: [23, 62, 3],
                    region: 'upper-limb'
                },
                {
                    id: 'Hand-R',
                    label: '右手',
                    type: 'rect',
                    coords: [20, 64, 8, 8],
                    region: 'upper-limb'
                },

                // === 左上肢 ===
                {
                    id: 'Shoulder-L',
                    label: '左肩',
                    type: 'circle',
                    coords: [75, 22, 5],
                    region: 'upper-limb'
                },
                {
                    id: 'Upper-Arm-L',
                    label: '左上臂',
                    type: 'rect',
                    coords: [72, 25, 10, 15],
                    region: 'upper-limb'
                },
                {
                    id: 'Elbow-L',
                    label: '左肘',
                    type: 'circle',
                    coords: [77, 42, 4],
                    region: 'upper-limb'
                },
                {
                    id: 'Forearm-L',
                    label: '左前臂',
                    type: 'rect',
                    coords: [72, 45, 9, 15],
                    region: 'upper-limb'
                },
                {
                    id: 'Wrist-L',
                    label: '左腕',
                    type: 'circle',
                    coords: [77, 62, 3],
                    region: 'upper-limb'
                },
                {
                    id: 'Hand-L',
                    label: '左手',
                    type: 'rect',
                    coords: [72, 64, 8, 8],
                    region: 'upper-limb'
                },

                // === 右下肢 ===
                {
                    id: 'Hip-R',
                    label: '右髖',
                    type: 'circle',
                    coords: [42, 58, 4],
                    region: 'lower-limb'
                },
                {
                    id: 'Thigh-R',
                    label: '右大腿',
                    type: 'rect',
                    coords: [38, 60, 10, 18],
                    region: 'lower-limb'
                },
                {
                    id: 'Knee-R',
                    label: '右膝',
                    type: 'circle',
                    coords: [43, 80, 4],
                    region: 'lower-limb'
                },
                {
                    id: 'Leg-R',
                    label: '右小腿',
                    type: 'rect',
                    coords: [39, 82, 9, 15],
                    region: 'lower-limb'
                },
                {
                    id: 'Ankle-R',
                    label: '右踝',
                    type: 'circle',
                    coords: [43, 98, 3],
                    region: 'lower-limb'
                },

                // === 左下肢 ===
                {
                    id: 'Hip-L',
                    label: '左髖',
                    type: 'circle',
                    coords: [58, 58, 4],
                    region: 'lower-limb'
                },
                {
                    id: 'Thigh-L',
                    label: '左大腿',
                    type: 'rect',
                    coords: [52, 60, 10, 18],
                    region: 'lower-limb'
                },
                {
                    id: 'Knee-L',
                    label: '左膝',
                    type: 'circle',
                    coords: [57, 80, 4],
                    region: 'lower-limb'
                },
                {
                    id: 'Leg-L',
                    label: '左小腿',
                    type: 'rect',
                    coords: [52, 82, 9, 15],
                    region: 'lower-limb'
                },
                {
                    id: 'Ankle-L',
                    label: '左踝',
                    type: 'circle',
                    coords: [57, 98, 3],
                    region: 'lower-limb'
                }
            ],

            BACK: [
                // === 頭頸部 ===
                {
                    id: 'Head-Back',
                    label: '後頭部',
                    type: 'circle',
                    coords: [50, 8, 8],
                    region: 'head'
                },
                {
                    id: 'Neck-Back',
                    label: '後頸',
                    type: 'rect',
                    coords: [42, 14, 16, 6],
                    region: 'neck'
                },

                // === 脊柱 ===
                {
                    id: 'Cervical-Spine',
                    label: '頸椎',
                    type: 'rect',
                    coords: [47, 18, 6, 5],
                    region: 'spine'
                },
                {
                    id: 'Upper-Thoracic',
                    label: '上胸椎',
                    type: 'rect',
                    coords: [47, 23, 6, 8],
                    region: 'spine'
                },
                {
                    id: 'Lower-Thoracic',
                    label: '下胸椎',
                    type: 'rect',
                    coords: [47, 31, 6, 10],
                    region: 'spine'
                },
                {
                    id: 'Lumbar',
                    label: '腰椎',
                    type: 'rect',
                    coords: [47, 41, 6, 8],
                    region: 'spine'
                },
                {
                    id: 'Sacrum',
                    label: '薦椎',
                    type: 'rect',
                    coords: [47, 49, 6, 6],
                    region: 'spine'
                },

                // === 肩胛區 ===
                {
                    id: 'Scapula-R',
                    label: '右肩胛',
                    type: 'polygon',
                    coords: [[25, 20], [35, 20], [38, 32], [28, 35]],
                    region: 'back'
                },
                {
                    id: 'Scapula-L',
                    label: '左肩胛',
                    type: 'polygon',
                    coords: [[75, 20], [65, 20], [62, 32], [72, 35]],
                    region: 'back'
                },

                // === 背部 ===
                {
                    id: 'Upper-Back-R',
                    label: '右上背',
                    type: 'rect',
                    coords: [35, 22, 12, 15],
                    region: 'back'
                },
                {
                    id: 'Upper-Back-L',
                    label: '左上背',
                    type: 'rect',
                    coords: [53, 22, 12, 15],
                    region: 'back'
                },
                {
                    id: 'Lower-Back-R',
                    label: '右下背',
                    type: 'rect',
                    coords: [38, 37, 9, 12],
                    region: 'back'
                },
                {
                    id: 'Lower-Back-L',
                    label: '左下背',
                    type: 'rect',
                    coords: [53, 37, 9, 12],
                    region: 'back'
                },

                // === 臀部 ===
                {
                    id: 'Glute-R',
                    label: '右臀',
                    type: 'rect',
                    coords: [38, 50, 10, 10],
                    region: 'lower-limb'
                },
                {
                    id: 'Glute-L',
                    label: '左臀',
                    type: 'rect',
                    coords: [52, 50, 10, 10],
                    region: 'lower-limb'
                },

                // === 下肢後側 ===
                {
                    id: 'Hamstring-R',
                    label: '右後大腿',
                    type: 'rect',
                    coords: [38, 60, 10, 18],
                    region: 'lower-limb'
                },
                {
                    id: 'Hamstring-L',
                    label: '左後大腿',
                    type: 'rect',
                    coords: [52, 60, 10, 18],
                    region: 'lower-limb'
                },
                {
                    id: 'Calf-R',
                    label: '右小腿肚',
                    type: 'rect',
                    coords: [39, 82, 9, 15],
                    region: 'lower-limb'
                },
                {
                    id: 'Calf-L',
                    label: '左小腿肚',
                    type: 'rect',
                    coords: [52, 82, 9, 15],
                    region: 'lower-limb'
                }
            ]
        };
    }

    _renderOverlay() {
        if (!this.svgOverlay) return;

        this.svgOverlay.innerHTML = '';
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        
        // SVG 完全覆蓋圖片
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.setAttribute("preserveAspectRatio", "none");
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';

        const fragment = document.createDocumentFragment();
        const currentHotspots = BodyMap.HOTSPOTS[this.currentView] || [];

        currentHotspots.forEach(spot => {
            let shape;
            
            if (spot.type === 'circle') {
                shape = document.createElementNS(svgNS, "circle");
                shape.setAttribute("cx", spot.coords[0]);
                shape.setAttribute("cy", spot.coords[1]);
                shape.setAttribute("r", spot.coords[2]);
            } else if (spot.type === 'rect') {
                shape = document.createElementNS(svgNS, "rect");
                shape.setAttribute("x", spot.coords[0]);
                shape.setAttribute("y", spot.coords[1]);
                shape.setAttribute("width", spot.coords[2]);
                shape.setAttribute("height", spot.coords[3]);
            } else if (spot.type === 'polygon') {
                shape = document.createElementNS(svgNS, "polygon");
                const points = spot.coords.map(p => p.join(',')).join(' ');
                shape.setAttribute("points", points);
            }

            if (shape) {
                shape.setAttribute("data-id", spot.id);
                shape.setAttribute("data-region", spot.region);
                shape.setAttribute("class", spot.region === 'spine' ? 'body-hotspot spine' : 'body-hotspot');

                const isActive = this.selectedParts.has(spot.id);
                if (isActive) {
                    shape.classList.add('active');
                    
                    // 設置症狀顏色
                    const symptoms = this.symptomData.get(spot.id) || [];
                    const colorKey = symptoms[0] || this.symptomMode;
                    const fillColor = BodyMap.SYMPTOM_COLORS[colorKey] || BodyMap.SYMPTOM_COLORS.active;
                    const strokeColor = BodyMap.SYMPTOM_STROKES[colorKey] || BodyMap.SYMPTOM_STROKES.active;
                    
                    shape.setAttribute("fill", fillColor);
                    shape.setAttribute("stroke", strokeColor);
                } else {
                    shape.setAttribute("fill", "transparent");
                    shape.setAttribute("stroke", "transparent");
                }

                if (this.readOnly) {
                    shape.setAttribute("readonly", "true");
                } else {
                    shape.onclick = (e) => {
                        e.stopPropagation();
                        this._togglePart(spot.id, shape);
                    };
                    
                    shape.onmouseenter = (e) => {
                        if (!isActive) {
                            shape.setAttribute("fill", "rgba(203, 213, 225, 0.3)");
                            shape.setAttribute("stroke", "#94A3B8");
                        }
                        this._showTooltip(e, spot.label, spot.id);
                    };
                    
                    shape.onmousemove = (e) => {
                        this._updateTooltip(e);
                    };
                    
                    shape.onmouseleave = () => {
                        if (!isActive) {
                            shape.setAttribute("fill", "transparent");
                            shape.setAttribute("stroke", "transparent");
                        }
                        this._hideTooltip();
                    };
                    
                    shape.ontouchstart = (e) => {
                        e.preventDefault();
                        this._togglePart(spot.id, shape);
                    };
                }
                
                fragment.appendChild(shape);
            }
        });

        svg.appendChild(fragment);
        this.svgOverlay.appendChild(svg);
    }

    _togglePart(partId, shapeElement) {
        if (this.readOnly || !partId) return;

        try {
            if (this.selectedParts.has(partId)) {
                this.selectedParts.delete(partId);
            } else {
                this.selectedParts.add(partId);
            }
            
            this._renderOverlay();
            
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
        if (!this.tooltip || !this.imageContainer) return;

        const rect = this.imageContainer.getBoundingClientRect();
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
        this._renderOverlayDebounced();
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
