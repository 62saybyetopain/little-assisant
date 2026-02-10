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
                el('input', { type: 'text', value: item.tagId, className: 'search-bar', style: 'flex:1', onchange: (e) => { this.items[index].tagId = e.target.value; this._notify(); } }),
                el('span', {}, '【'),
                el('input', { type: 'text', value: item.remark, className: 'search-bar', style: 'flex:1.2', onchange: (e) => { this.items[index].remark = e.target.value; this._notify(); } }),
                el('span', {}, '】'),
                el('button', { className: 'icon-btn text-danger', onclick: () => { this.items.splice(index, 1); this.render(); this._notify(); } }, '×')
            ));
        });

        const suggestions = el('div', { className: 'tag-suggestions mt-3' },
            ...this.available.sort((a,b) => (b.count||0) - (a.count||0)).slice(0, 10).map(tag => el('span', {
                className: 'tag-chip suggestion',
                style: { backgroundColor: tag.color || '#94a3b8', cursor: 'pointer', margin: '0 4px 4px 0' },
                onclick: () => this._addTag(tag.name) // 點擊建議直接加入新行
            }, tag.name))
        );
        this.element.append(list, el('button', { className: 'btn-secondary w-100', onclick: () => { this.items.push({ tagId: '', remark: '' }); this.render(); } }, '+ 新增病史'), suggestions);
    }

    _addTag(name) { // 關鍵補完：供 BodyMap 呼叫 [cite: 9]
        if (!this.items.some(i => i.tagId === name)) {
            this.items.push({ tagId: name, remark: '' });
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
                { id: 'Head', label: '頭', d: 'M75,10 C75,0 125,0 125,10 C125,35 75,35 75,10 Z' },
                { id: 'Neck', label: '頸', d: 'M85,35 L115,35 L120,50 L80,50 Z' },
                { id: 'Chest', label: '胸', d: 'M70,50 L130,50 L125,100 L75,100 Z' },
                { id: 'Abdomen', label: '腹', d: 'M75,100 L125,100 L120,160 L80,160 Z' },
                // 上肢 (左)
                { id: 'Shoulder-L', label: '左肩', d: 'M130,50 L155,55 L150,75 L130,70 Z' },
                { id: 'Elbow-L', label: '左肘', d: 'M150,75 L165,115 L145,115 L135,75 Z' },
                { id: 'Wrist-L', label: '左腕', d: 'M145,115 L155,145 L135,145 L130,115 Z' },
                { id: 'Hand-L', label: '左手', d: 'M135,145 L145,175 L125,175 L120,145 Z' },
                // 上肢 (右)
                { id: 'Shoulder-R', label: '右肩', d: 'M70,50 L45,55 L50,75 L70,70 Z' },
                { id: 'Elbow-R', label: '右肘', d: 'M50,75 L35,115 L55,115 L65,75 Z' },
                { id: 'Wrist-R', label: '右腕', d: 'M55,115 L45,145 L65,145 L70,115 Z' },
                { id: 'Hand-R', label: '右手', d: 'M65,145 L55,175 L75,175 L80,145 Z' },
                // 下肢 (左)
                { id: 'Hip-L', label: '左髖', d: 'M100,160 L125,160 L130,195 L100,195 Z' },
                { id: 'Thigh-L', label: '左大腿', d: 'M100,195 L130,195 L125,260 L100,260 Z' },
                { id: 'Knee-L', label: '左膝', d: 'M100,260 L125,260 L120,285 L100,285 Z' },
                { id: 'Leg-L', label: '左小腿', d: 'M100,285 L120,285 L115,350 L100,350 Z' },
                { id: 'Foot-L', label: '左足', d: 'M100,350 L120,350 L125,375 L95,375 Z' },
                // 下肢 (右)
                { id: 'Hip-R', label: '右髖', d: 'M75,160 L100,160 L100,195 L70,195 Z' },
                { id: 'Thigh-R', label: '右大腿', d: 'M70,195 L100,195 L100,260 L75,260 Z' },
                { id: 'Knee-R', label: '右膝', d: 'M75,260 L100,260 L100,285 L80,285 Z' },
                { id: 'Leg-R', label: '右小腿', d: 'M80,285 L100,285 L100,350 L85,350 Z' },
                { id: 'Foot-R', label: '右足', d: 'M85,350 L100,350 L105,375 L75,375 Z' }
            ],
            BACK: [
                { id: 'Back-Upper', label: '上背', d: 'M70,50 L130,50 L125,110 L75,110 Z' },
                { id: 'Back-Lower', label: '下背', d: 'M75,110 L125,110 L120,160 L80,160 Z' },
                { id: 'Glutes', label: '臀部', d: 'M80,160 L120,160 L130,195 L70,195 Z' },
                { id: 'Hamstring-L', label: '左後大腿', d: 'M100,195 L130,195 L125,260 L100,260 Z' },
                { id: 'Hamstring-R', label: '右後大腿', d: 'M70,195 L100,195 L100,260 L75,260 Z' }
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
        svg.setAttribute("viewBox", "0 0 200 400");
        svg.setAttribute("class", "body-map-svg");
        
        BodyMap.PATHS[this.currentView].forEach(part => {
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", part.d);
            path.setAttribute("class", `body-part ${this.selectedParts.has(part.id) ? 'active' : ''}`);
            path.setAttribute("data-label", part.label); // 用於 CSS Tooltip
            
            if (!this.readOnly) {
                path.onclick = () => this._togglePart(part.id, path);
            }
            svg.appendChild(path);
        });
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
