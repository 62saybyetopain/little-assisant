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

    _addTag(name) { // 供 BodyMap 或建議按鈕呼叫
        if (!this.items.some(i => i.tagId === name)) {
            this.items.push({ tagId: name, remark: '' });
            this.render();
            this._notify();
        }
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
export class BodyMap {
    constructor(selectedParts = [], onChange, readOnly = false) {
        this.selectedParts = new Set(selectedParts);
        this.onChange = onChange;
        this.readOnly = readOnly;
        this.currentView = 'FRONT'; 
        this.element = this._renderContainer();
    }

    // 擴充全肢體路徑 (精確座標)
    static get PATHS() {
    return {
        FRONT: [
            // 中軸線
            { id: 'Head', label: '頭部', d: 'M100,5 C85,5 72,18 72,35 C72,52 85,62 100,62 C115,62 128,52 128,35 C128,18 115,5 100,5 Z' },
            { id: 'Neck', label: '頸部', d: 'M88,62 L112,62 C112,62 115,75 118,80 L82,80 C85,75 88,62 88,62 Z' },
            { id: 'Chest', label: '胸部', d: 'M70,80 L130,80 C135,110 132,130 128,140 L72,140 C68,130 65,110 70,80 Z' },
            { id: 'Abdomen', label: '腹部', d: 'M72,140 L128,140 C125,170 122,190 115,205 L85,205 C78,190 75,170 72,140 Z' },
            
            // 右上肢 (R)
            { id: 'Shoulder-R', label: '右肩', d: 'M70,82 C55,80 48,90 45,105 L60,115 C62,105 65,95 70,82 Z' },
            { id: 'Elbow-R', label: '右肘', d: 'M50,140 L35,140 C32,150 32,165 38,175 L52,175 C58,165 58,150 50,140 Z' },
            { id: 'Wrist-R', label: '右腕', d: 'M50,210 L38,210 C36,215 36,225 38,230 L50,230 C52,225 52,215 50,210 Z' },
            { id: 'Hand-R', label: '右手', d: 'M38,235 L50,235 L55,270 L33,270 Z' },
            
            // 左上肢 (L)
            { id: 'Shoulder-L', label: '左肩', d: 'M130,82 C145,80 152,90 155,105 L140,115 C138,105 135,95 130,82 Z' },
            { id: 'Elbow-L', label: '左肘', d: 'M150,140 L165,140 C168,150 168,165 162,175 L148,175 C142,165 142,150 150,140 Z' },
            { id: 'Wrist-L', label: '左腕', d: 'M150,210 L162,210 C164,215 164,225 162,230 L150,230 C148,225 148,215 150,210 Z' },
            { id: 'Hand-L', label: '左手', d: 'M162,235 L150,235 L145,270 L167,270 Z' },

            // 右下肢 (R)
            { id: 'Hip-R', label: '右髖', d: 'M85,205 L100,205 L100,240 L70,240 C75,220 80,210 85,205 Z' },
            { id: 'Thigh-R', label: '右大腿', d: 'M70,240 L100,240 L100,310 L75,310 Z' },
            { id: 'Knee-R', label: '右膝', d: 'M75,310 L100,310 L100,335 L80,335 Z' },
            { id: 'Leg-R', label: '右小腿', d: 'M80,335 L100,335 L100,385 L85,385 Z' },
            { id: 'Foot-R', label: '右足', d: 'M85,385 L100,385 L105,400 L75,400 Z' },

            // 左下肢 (L)
            { id: 'Hip-L', label: '左髖', d: 'M100,205 L115,205 C120,210 125,220 130,240 L100,240 L100,205 Z' },
            { id: 'Thigh-L', label: '左大腿', d: 'M100,240 L130,240 L125,310 L100,310 Z' },
            { id: 'Knee-L', label: '左膝', d: 'M100,310 L125,310 L120,335 L100,335 Z' },
            { id: 'Leg-L', label: '左小腿', d: 'M100,335 L120,335 L115,385 L100,385 Z' },
            { id: 'Foot-L', label: '左足', d: 'M100,385 L115,385 L125,400 L95,400 Z' }
        ],
        BACK: [
            { id: 'Back-Upper', label: '上背', d: 'M70,80 L130,80 C135,115 132,135 128,145 L72,145 C68,135 65,115 70,80 Z' },
            { id: 'Back-Lower', label: '下背', d: 'M72,145 L128,145 C125,180 122,200 115,215 L85,215 C78,200 75,180 72,145 Z' },
            { id: 'Glutes', label: '臀部', d: 'M85,215 L115,215 C130,225 135,260 115,275 L85,275 C65,260 70,225 85,215 Z' },
            { id: 'Hamstring-R', label: '右後大腿', d: 'M70,275 L100,275 L100,345 L75,345 Z' },
            { id: 'Hamstring-L', label: '左後大腿', d: 'M100,275 L130,275 L125,345 L100,345 Z' }
        ]
    };
}

    _renderContainer() {
        const container = el('div', { className: 'body-map-container' });
        const controls = el('div', { className: 'body-map-controls segmented-control' });
        
        const btnFront = el('button', { 
            className: 'segment-btn active', 
            onclick: (e) => this._switchView('FRONT', e.target) 
        }, '正面');
        
        const btnBack = el('button', { 
            className: 'segment-btn', 
            onclick: (e) => this._switchView('BACK', e.target) 
        }, '背面');
        
        controls.append(btnFront, btnBack);
        
        // 加入動畫包裝層
        this.svgWrapper = el('div', { 
            className: 'svg-wrapper transition-fade',
            style: { transition: 'opacity 0.2s ease-in-out' }
        });
        
        this._renderSVG();
        container.append(controls, this.svgWrapper);
        return container;
    }

    _switchView(view, targetBtn) {
        if (this.currentView === view) return;
        
        // 觸發淡出動畫
        this.svgWrapper.style.opacity = '0';
        
        setTimeout(() => {
            this.currentView = view;
            const parent = targetBtn.parentElement;
            parent.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            
            this._renderSVG();
            this.svgWrapper.style.opacity = '1';
        }, 200);
    }

    _renderSVG() {
    this.svgWrapper.innerHTML = '';
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    
    // 設定高寬比，確保在移動端不變形
    svg.setAttribute("viewBox", "0 0 200 410");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("class", "body-map-svg");

    // 透過 DocumentFragment 減少 DOM 操縱次數
    const fragment = document.createDocumentFragment();
    const currentPaths = BodyMap.PATHS[this.currentView] || [];

    currentPaths.forEach(part => {
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("d", part.d);
        
        // 狀態管理：直接從 Set 檢查選取狀態
        const isActive = this.selectedParts.has(part.id);
        path.setAttribute("class", `body-part ${isActive ? 'active' : ''}`);
        
        // Tooltip 數據
        path.setAttribute("data-label", part.label);

        if (!this.readOnly) {
            // 使用綁定的方法確保 Context 正確
            path.onclick = (e) => {
                e.preventDefault();
                this._togglePart(part.id, path);
            };
        }
        fragment.appendChild(path);
    });

    svg.appendChild(fragment);
    this.svgWrapper.appendChild(svg);
}

    _togglePart(partId, element) {
        if (this.selectedParts.has(partId)) {
            this.selectedParts.delete(partId);
            element.classList.remove('active');
        } else {
            this.selectedParts.add(partId);
            element.classList.add('active');
        }
        if (this.onChange) this.onChange(Array.from(this.selectedParts));
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
            style: {
                // 背景：從 0 到 norm 是綠色(或淺藍)背景區間，代表正常範圍參考
                background: `linear-gradient(to right, #e0f2fe 0%, #e0f2fe ${normPercentage}%, #f1f5f9 ${normPercentage}%, #f1f5f9 100%)`
            },
            oninput: (e) => {
                const newVal = parseInt(e.target.value);
                this.value = newVal;
                labelRow.querySelector('.rom-value').textContent = `${newVal}°`;
                if (this.onChange) this.onChange(newVal);
                
                // 動態更新數值顏色 (若低於 norm 太多顯示警告色)
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
