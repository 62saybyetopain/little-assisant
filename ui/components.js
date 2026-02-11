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
        // 防禦性編程：參數驗證
        if (!Array.isArray(selectedParts)) {
            console.warn('[BodyMap] selectedParts 必須是數組，已自動修正為空數組');
            selectedParts = [];
        }
        if (typeof onChange !== 'function') {
            console.warn('[BodyMap] onChange 必須是函數，已設置為空函數');
            onChange = () => {};
        }

        this.selectedParts = new Set(selectedParts);
        this.onChange = onChange;
        this.readOnly = !!readOnly; // 強制轉為布爾值
        this.currentView = 'FRONT'; 
        
        // 症狀模式與數據初始化
        this.symptomMode = options.symptomMode || 'pain';
        this.symptomData = options.symptomData instanceof Map 
            ? options.symptomData 
            : new Map(Object.entries(options.symptomData || {}));

        // 性能優化：防抖渲染
        this._renderDebounced = this._debounce(() => this._renderSVG(), 16);

        try {
            this.element = this._renderContainer();
        } catch (error) {
            console.error('[BodyMap] 初始化失敗:', error);
            this.element = this._renderFallback();
        }
    }

    // 防禦性工具：防抖函數
    _debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 降級方案：渲染失敗時顯示
    _renderFallback() {
        return el('div', {
            className: 'body-map-fallback',
            style: 'padding:20px; text-align:center; background:#f5f5f5; border-radius:8px;'
        }, 
            el('p', {}, '⚠️ 無法載入人體圖'),
            el('small', {}, '請重新整理頁面或聯繫支援')
        );
    }

    static get SYMPTOM_COLORS() {
        return {
            pain: '#EF4444',
            numbness: '#F59E0B',
            weakness: '#8B5CF6',
            radiation: '#10B981',
            active: '#4C84FF'
        };
    }

    // 公開 API
    setSymptomMode(mode) {
        if (BodyMap.SYMPTOM_COLORS[mode]) {
            this.symptomMode = mode;
            this._renderDebounced();
        }
    }

    setSymptomData(dataMap) {
        this.symptomData = dataMap instanceof Map 
            ? dataMap 
            : new Map(Object.entries(dataMap || {}));
        this._renderDebounced();
    }

    _renderContainer() {
        const container = el('div', { 
            className: 'body-map-container',
            style: `
                position: relative;
                width: 100%;
                max-width: 420px;
                margin: 0 auto;
                background: var(--surface, #fff);
                border-radius: 12px;
                padding: 16px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            `
        });
        
        const controlBar = el('div', { 
            className: 'body-map-control-bar', 
            style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;' 
        },
            el('div', { 
                className: 'segmented-control', 
                style: 'display:flex; gap:4px; background:var(--bg-muted, #f0f0f0); padding:4px; border-radius:8px;' 
            },
                this._createSegmentButton('FRONT', '正面', true),
                this._createSegmentButton('BACK', '背面', false)
            ),
            !this.readOnly ? el('button', { 
                className: 'btn-secondary', 
                style: 'padding:6px 12px; font-size:13px;',
                onclick: () => this._clearSelection() 
            }, '🗑️ 清除') : null
        );

        this.svgWrapper = el('div', { 
            className: 'svg-wrapper', 
            style: `
                position: relative;
                width: 100%;
                max-height: 500px;
                overflow: hidden;
                touch-action: manipulation;
                transition: opacity 0.2s ease;
            `
        });
        
        this.tooltip = el('div', { 
            className: 'body-map-tooltip', 
            style: `
                position: absolute;
                background: rgba(0,0,0,0.9);
                color: #fff;
                padding: 6px 10px;
                border-radius: 6px;
                pointer-events: none;
                opacity: 0;
                z-index: 1000;
                font-size: 12px;
                white-space: nowrap;
                transition: opacity 0.15s;
                transform: translateX(-50%);
            `
        });

        this._renderSVG();
        
        // 移除 null 子元素
        const children = [controlBar, this.svgWrapper, this.tooltip].filter(Boolean);
        container.append(...children);
        return container;
    }

    _createSegmentButton(view, label, isActive) {
        return el('button', { 
            className: `segment-btn ${isActive ? 'active' : ''}`,
            style: `
                padding: 6px 16px;
                border: none;
                background: ${isActive ? 'var(--primary, #4C84FF)' : 'transparent'};
                color: ${isActive ? '#fff' : 'var(--text, #333)'};
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
            `,
            onclick: (e) => this._switchView(view, e.target) 
        }, label);
    }

    _switchView(view, btn) {
        if (this.currentView === view) return;
        
        this.currentView = view;
        
        // 更新按鈕狀態
        const buttons = btn.parentElement.querySelectorAll('.segment-btn');
        buttons.forEach(b => {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.color = 'var(--text, #333)';
        });
        btn.classList.add('active');
        btn.style.background = 'var(--primary, #4C84FF)';
        btn.style.color = '#fff';
        
        // 淡出動畫
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
        this.onChange([]);
    }

    /**
     * 重新設計的輪廓路徑 - 優化比例和連續性
     */
    static get SILHOUETTE() {
    return {
        FRONT: `
            M100,15 C85,15 75,25 75,40 C75,55 85,65 100,65 C115,65 125,55 125,40 C125,25 115,15 100,15 Z
            M90,65 L110,65 L115,85 L85,85 Z
            M85,85 L115,85 L118,145 L82,145 Z
            M82,145 L118,145 L115,215 L85,215 Z
        `,
        BACK: `
            M100,15 C85,15 75,25 75,40 C75,55 85,65 100,65 C115,65 125,55 125,40 C125,25 115,15 100,15 Z
            M90,65 L110,65 L115,85 L85,85 Z
            M85,85 L115,85 L118,145 L82,145 Z
            M82,145 L118,145 L115,215 L85,215 Z
        `
    };
}

    /**
     * 重新設計的解剖路徑 - 優化點擊熱區
     */
    static get PATHS() {
        return {
            FRONT: [
                // 頭頸部
                { 
                    id: 'Head', 
                    label: '頭部', 
                    d: 'M100,15 C85,15 75,25 75,40 C75,55 85,65 100,65 C115,65 125,55 125,40 C125,25 115,15 100,15 Z',
                    region: 'central'
                },
                { 
                    id: 'Neck', 
                    label: '頸部', 
                    d: 'M90,65 L110,65 C112,75 115,80 120,85 L80,85 C85,80 88,75 90,65 Z',
                    region: 'central'
                },
                
                // 軀幹
                { 
                    id: 'Chest', 
                    label: '胸部', 
                    d: 'M75,85 L125,85 C128,110 127,130 125,145 L75,145 C73,130 72,110 75,85 Z',
                    region: 'central'
                },
                { 
                    id: 'Abdomen', 
                    label: '腹部', 
                    d: 'M75,145 L125,145 C123,175 121,200 118,220 L82,220 C79,200 77,175 75,145 Z',
                    region: 'central'
                },
                
                // 右上肢
                { 
                    id: 'Shoulder-R', 
                    label: '右肩', 
                    d: 'M75,85 C60,83 50,92 45,108 L60,118 C62,105 67,93 75,85 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Upper-Arm-R', 
                    label: '右上臂', 
                    d: 'M60,118 L45,108 C42,125 40,142 40,158 L54,158 C56,142 58,128 60,118 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Elbow-R', 
                    label: '右肘', 
                    d: 'M54,158 L40,158 C38,168 38,180 41,190 L55,190 C57,180 57,168 54,158 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Forearm-R', 
                    label: '右前臂', 
                    d: 'M55,190 L41,190 C39,205 38,220 38,232 L52,232 C53,220 54,205 55,190 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Wrist-R', 
                    label: '右腕', 
                    d: 'M52,232 L38,232 C37,238 37,245 38,251 L52,251 C53,245 53,238 52,232 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Hand-R', 
                    label: '右手', 
                    d: 'M38,251 L52,251 L54,285 L34,285 Z',
                    region: 'upper-limb'
                },
                
                // 左上肢（鏡像對稱）
                { 
                    id: 'Shoulder-L', 
                    label: '左肩', 
                    d: 'M125,85 C140,83 150,92 155,108 L140,118 C138,105 133,93 125,85 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Upper-Arm-L', 
                    label: '左上臂', 
                    d: 'M140,118 L155,108 C158,125 160,142 160,158 L146,158 C144,142 142,128 140,118 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Elbow-L', 
                    label: '左肘', 
                    d: 'M146,158 L160,158 C162,168 162,180 159,190 L145,190 C143,180 143,168 146,158 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Forearm-L', 
                    label: '左前臂', 
                    d: 'M145,190 L159,190 C161,205 162,220 162,232 L148,232 C147,220 146,205 145,190 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Wrist-L', 
                    label: '左腕', 
                    d: 'M148,232 L162,232 C163,238 163,245 162,251 L148,251 C147,245 147,238 148,232 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Hand-L', 
                    label: '左手', 
                    d: 'M162,251 L148,251 L146,285 L166,285 Z',
                    region: 'upper-limb'
                },
                
                // 右下肢
                { 
                    id: 'Hip-R', 
                    label: '右髖', 
                    d: 'M82,220 L100,220 L100,255 L72,255 C75,240 78,228 82,220 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Thigh-R', 
                    label: '右大腿', 
                    d: 'M72,255 L100,255 L100,345 L78,345 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Knee-R', 
                    label: '右膝', 
                    d: 'M78,345 L100,345 L100,370 L80,370 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Leg-R', 
                    label: '右小腿', 
                    d: 'M80,370 L100,370 L100,425 L84,425 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Ankle-R', 
                    label: '右踝', 
                    d: 'M84,425 L100,425 L100,438 L86,438 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Foot-R', 
                    label: '右足', 
                    d: 'M86,438 L100,438 L104,460 L80,460 Z',
                    region: 'lower-limb'
                },
                
                // 左下肢（鏡像對稱）
                { 
                    id: 'Hip-L', 
                    label: '左髖', 
                    d: 'M100,220 L118,220 C122,228 125,240 128,255 L100,255 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Thigh-L', 
                    label: '左大腿', 
                    d: 'M100,255 L128,255 L122,345 L100,345 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Knee-L', 
                    label: '左膝', 
                    d: 'M100,345 L122,345 L120,370 L100,370 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Leg-L', 
                    label: '左小腿', 
                    d: 'M100,370 L120,370 L116,425 L100,425 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Ankle-L', 
                    label: '左踝', 
                    d: 'M100,425 L116,425 L114,438 L100,438 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Foot-L', 
                    label: '左足', 
                    d: 'M100,438 L114,438 L120,460 L96,460 Z',
                    region: 'lower-limb'
                }
            ],
            
            BACK: [
                // 頭頸部
                { 
                    id: 'Head-Back', 
                    label: '後頭部', 
                    d: 'M100,15 C85,15 75,25 75,40 C75,55 85,65 100,65 C115,65 125,55 125,40 C125,25 115,15 100,15 Z',
                    region: 'central'
                },
                { 
                    id: 'Cervical', 
                    label: '頸椎', 
                    d: 'M95,65 L105,65 L108,85 L92,85 Z',
                    region: 'spine'
                },
                
                // 脊椎分段
                { 
                    id: 'Upper-Thoracic', 
                    label: '上胸椎', 
                    d: 'M92,85 L108,85 L106,115 L94,115 Z',
                    region: 'spine'
                },
                { 
                    id: 'Mid-Thoracic', 
                    label: '中胸椎', 
                    d: 'M94,115 L106,115 L104,145 L96,145 Z',
                    region: 'spine'
                },
                { 
                    id: 'Lumbar', 
                    label: '腰椎', 
                    d: 'M96,145 L104,145 L102,180 L98,180 Z',
                    region: 'spine'
                },
                { 
                    id: 'Sacrum', 
                    label: '薦椎', 
                    d: 'M98,180 L102,180 L101,205 L99,205 Z',
                    region: 'spine'
                },
                
                // 肩胛區
                { 
                    id: 'Scapula-R', 
                    label: '右肩胛', 
                    d: 'M75,85 C60,83 50,92 45,108 L60,118 L72,108 L75,85 Z',
                    region: 'back'
                },
                { 
                    id: 'Scapula-L', 
                    label: '左肩胛', 
                    d: 'M125,85 C140,83 150,92 155,108 L140,118 L128,108 L125,85 Z',
                    region: 'back'
                },
                
                // 上背區
                { 
                    id: 'Upper-Back-R', 
                    label: '右上背', 
                    d: 'M75,85 L92,85 L94,115 L75,130 Z',
                    region: 'back'
                },
                { 
                    id: 'Upper-Back-L', 
                    label: '左上背', 
                    d: 'M125,85 L108,85 L106,115 L125,130 Z',
                    region: 'back'
                },
                
                // 下背區
                { 
                    id: 'Lower-Back-R', 
                    label: '右下背', 
                    d: 'M75,130 L94,115 L96,145 L82,160 Z',
                    region: 'back'
                },
                { 
                    id: 'Lower-Back-L', 
                    label: '左下背', 
                    d: 'M125,130 L106,115 L104,145 L118,160 Z',
                    region: 'back'
                },
                
                // 臀部
                { 
                    id: 'Glute-R', 
                    label: '右臀', 
                    d: 'M82,160 L100,160 L100,205 L72,205 C74,185 77,170 82,160 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Glute-L', 
                    label: '左臀', 
                    d: 'M100,160 L118,160 C123,170 126,185 128,205 L100,205 Z',
                    region: 'lower-limb'
                },
                
                // 上肢後側
                { 
                    id: 'Triceps-R', 
                    label: '右三頭肌', 
                    d: 'M60,118 L45,108 C42,125 40,142 40,158 L54,158 C56,142 58,128 60,118 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Posterior-Forearm-R', 
                    label: '右後前臂', 
                    d: 'M55,190 L41,190 C39,205 38,220 38,232 L52,232 C53,220 54,205 55,190 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Triceps-L', 
                    label: '左三頭肌', 
                    d: 'M140,118 L155,108 C158,125 160,142 160,158 L146,158 C144,142 142,128 140,118 Z',
                    region: 'upper-limb'
                },
                { 
                    id: 'Posterior-Forearm-L', 
                    label: '左後前臂', 
                    d: 'M145,190 L159,190 C161,205 162,220 162,232 L148,232 C147,220 146,205 145,190 Z',
                    region: 'upper-limb'
                },
                
                // 下肢後側
                { 
                    id: 'Hamstring-R', 
                    label: '右後大腿', 
                    d: 'M72,205 L100,205 L100,345 L78,345 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Calf-R', 
                    label: '右小腿肚', 
                    d: 'M80,370 L100,370 L100,425 L84,425 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Hamstring-L', 
                    label: '左後大腿', 
                    d: 'M100,205 L128,205 L122,345 L100,345 Z',
                    region: 'lower-limb'
                },
                { 
                    id: 'Calf-L', 
                    label: '左小腿肚', 
                    d: 'M100,370 L120,370 L116,425 L100,425 Z',
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
        
        // 優化後的 viewBox - 調整為合理比例
        svg.setAttribute("viewBox", "0 0 200 460");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.maxHeight = '480px';
        svg.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.06))';

        const fragment = document.createDocumentFragment();

        // 1. 底層輪廓
        const silhouettePath = BodyMap.SILHOUETTE[this.currentView];
        if (silhouettePath) {
            const silhouette = document.createElementNS(svgNS, "path");
            silhouette.setAttribute("d", silhouettePath);
            silhouette.setAttribute("fill", "#F8FAFC");
            silhouette.setAttribute("stroke", "#CBD5E1");
            silhouette.setAttribute("stroke-width", "1");
            fragment.appendChild(silhouette);
        }

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
                path.style.transition = 'all 0.2s ease';
                
                // 增強點擊熱區
                path.setAttribute("stroke-width", isActive ? "2" : "1.5");
                path.style.pointerEvents = 'visiblePainted';
                
                // 事件綁定 - 添加防禦性處理
                path.onclick = (e) => {
                    e.stopPropagation();
                    this._togglePart(part.id, path, e);
                };
                
                path.onmouseenter = (e) => {
                    if (!isActive) {
                        path.setAttribute("fill", this._lightenColor(path.getAttribute("fill")));
                        path.setAttribute("stroke-width", "2");
                    }
                    this._showTooltip(e, part.label, part.id);
                };
                
                path.onmousemove = (e) => this._updateTooltip(e);
                
                path.onmouseleave = () => {
                    if (!isActive) {
                        this._applyPartStyle(path, part.id, false);
                    }
                    this._hideTooltip();
                };
                
                // 觸控設備支援
                path.ontouchstart = (e) => {
                    e.preventDefault();
                    this._togglePart(part.id, path, e);
                };
            }
            fragment.appendChild(path);
        });

        svg.appendChild(fragment);
        this.svgWrapper.appendChild(svg);
    }

    _applyPartStyle(element, partId, isActive) {
        if (!element) return;

        if (isActive) {
            const symptoms = this.symptomData.get(partId) || [];
            const colorKey = symptoms[0] || this.symptomMode;
            const color = BodyMap.SYMPTOM_COLORS[colorKey] || BodyMap.SYMPTOM_COLORS.active;
            
            element.setAttribute("fill", color);
            element.setAttribute("stroke", this._darkenColor(color));
            element.setAttribute("stroke-width", "2");
            element.style.opacity = "0.9";
        } else {
            element.setAttribute("fill", "#E2E8F0");
            element.setAttribute("stroke", "#94A3B8");
            element.setAttribute("stroke-width", "1");
            element.style.opacity = "1";
        }
    }

    _togglePart(partId, pathElement, event) {
        if (this.readOnly || !partId) return;

        try {
            if (this.selectedParts.has(partId)) {
                this.selectedParts.delete(partId);
            } else {
                this.selectedParts.add(partId);
            }
            
            this._applyPartStyle(pathElement, partId, this.selectedParts.has(partId));
            
            // 安全調用 onChange
            if (typeof this.onChange === 'function') {
                this.onChange(Array.from(this.selectedParts));
            }
        } catch (error) {
            console.error('[BodyMap] 切換部位失敗:', error);
            Toast?.show('操作失敗，請重試', 'error');
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
        if (!this.tooltip) return;

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

    // 色彩工具函數
    _darkenColor(hex, amount = 20) {
        if (!hex || typeof hex !== 'string') return '#000000';
        
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, (num >> 16) - amount);
        const g = Math.max(0, ((num >> 8) & 0x00FF) - amount);
        const b = Math.max(0, (num & 0x0000FF) - amount);
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    _lightenColor(hex, amount = 30) {
        if (!hex || typeof hex !== 'string') return '#FFFFFF';
        
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, (num >> 16) + amount);
        const g = Math.min(255, ((num >> 8) & 0x00FF) + amount);
        const b = Math.min(255, (num & 0x0000FF) + amount);
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    // 公開 API：手動更新選取狀態
    updateSelection(parts) {
        if (!Array.isArray(parts)) {
            console.warn('[BodyMap] updateSelection 參數必須是數組');
            return;
        }
        
        this.selectedParts = new Set(parts);
        this._renderDebounced();
    }

    // 公開 API：銷毀組件
    destroy() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.selectedParts.clear();
        this.onChange = null;
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
