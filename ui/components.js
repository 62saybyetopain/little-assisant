/**
 * src/ui/components.js
 * 共用 UI 元件庫
 * 
 * @description 提供 Modal, Toast, TagSelector, BodyMap 等基礎互動元件。
 * [PATCH-v6.3.1] 重構 TagSelector 支援標籤分群渲染（解剖 vs 診斷），優化醫療紀錄結構。
 */

import { EventTypes, AnatomicalWeights, TagType } from '../config.js';
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
        this.selected = new Set(selectedTags);
        this.available = availableTags;
        this.onChange = onChange;
        this.element = el('div', { className: 'tag-selector' });
        this.render();
    }

    /**
     * [PATCH-v6.3.1] 支援分群渲染邏輯
     */
    render() {
        this.element.innerHTML = '';
        
        // 1. 已選取標籤顯示區
        const selectedContainer = el('div', { className: 'selected-tags' });
        this.selected.forEach(tagName => {
            const tagData = this.available.find(t => t.name === tagName) || { color: '#64748b' };
            const chip = el('span', { 
                className: 'tag-chip',
                style: { backgroundColor: tagData.color }
            }, 
                tagName,
                el('span', { 
                    className: 'tag-remove', 
                    onclick: () => this._removeTag(tagName) 
                }, ' ×')
            );
            selectedContainer.appendChild(chip);
        });

        // 2. 輸入與搜尋區
        const input = el('input', { 
            type: 'text', 
            placeholder: '新增或搜尋標籤... (Enter 加入)',
            onkeydown: (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this._addTag(e.target.value);
                    e.target.value = '';
                }
            }
        });

        // 3. [PATCH] 智慧建議分群 (解剖部位 vs 診斷標籤)
        const anatomyList = el('div', { className: 'tag-group-list' });
        const personalList = el('div', { className: 'tag-group-list' });

        const sorted = this._sortTags(this.available);
        
        sorted.slice(0, 40).forEach(tag => {
            if (this.selected.has(tag.name)) return;

            const chip = el('span', { 
                className: 'tag-chip suggestion',
                style: { backgroundColor: tag.color || '#cbd5e1' },
                onclick: () => this._addTag(tag.name)
            }, tag.name);

            if (tag.type === TagType.ANATOMY) {
                anatomyList.appendChild(chip);
            } else {
                personalList.appendChild(chip);
            }
        });

        const suggestionsArea = el('div', { className: 'tag-suggestions' },
            el('div', { className: 'tag-group' }, el('h6', {}, '解剖部位標記'), anatomyList),
            el('div', { className: 'tag-group' }, el('h6', {}, '常用診斷與標籤'), personalList)
        );

        this.element.append(selectedContainer, input, suggestionsArea);
    }

    _sortTags(tags) {
        return [...tags].sort((a, b) => {
            const getW = (tagName) => AnatomicalWeights[tagName] || 0;
            const weightA = getW(a.name);
            const weightB = getW(b.name);

            if (weightA !== weightB) return weightB - weightA;
            if ((a.count || 0) !== (b.count || 0)) return (b.count || 0) - (a.count || 0);
            return a.name.length - b.name.length;
        });
    }

    _addTag(name) {
        const cleanName = name.trim();
        if (cleanName && !this.selected.has(cleanName)) {
            this.selected.add(cleanName);
            this.render();
            this.onChange(Array.from(this.selected));
        }
    }

    _removeTag(name) {
        this.selected.delete(name);
        this.render();
        this.onChange(Array.from(this.selected));
    }
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

    static get PATHS() {
        return {
            FRONT: [
                { id: 'Head', label: '頭', d: 'M75,10 C75,0 125,0 125,10 C125,35 75,35 75,10 Z' },
                { id: 'Neck', label: '頸', d: 'M85,35 L115,35 L120,50 L80,50 Z' },
                { id: 'Chest', label: '胸', d: 'M70,50 L130,50 L125,100 L75,100 Z' },
                { id: 'Abdomen', label: '腹', d: 'M75,100 L125,100 L120,160 L80,160 Z' },
                { id: 'Shoulder-L', label: '左肩', d: 'M130,50 L155,55 L150,75 L130,70 Z' },
                { id: 'Shoulder-R', label: '右肩', d: 'M70,50 L45,55 L50,75 L70,70 Z' },
                { id: 'Hip', label: '骨盆', d: 'M80,160 L120,160 L130,190 L70,190 Z' }
            ],
            BACK: [
                { id: 'Back-Upper', label: '上背', d: 'M70,50 L130,50 L125,110 L75,110 Z' },
                { id: 'Back-Lower', label: '下背', d: 'M75,110 L125,110 L120,160 L80,160 Z' },
                { id: 'Glutes', label: '臀部', d: 'M80,160 L120,160 L130,190 L70,190 Z' }
            ]
        };
    }

    _renderContainer() {
        const container = el('div', { className: 'body-map-container' });
        const controls = el('div', { className: 'body-map-controls segmented-control' });
        const btnFront = el('button', { 
            className: 'segment-btn active', 
            onclick: () => this._switchView('FRONT', btnFront, btnBack) 
        }, '正面');
        const btnBack = el('button', { 
            className: 'segment-btn', 
            onclick: () => this._switchView('BACK', btnFront, btnBack) 
        }, '背面');
        
        controls.append(btnFront, btnBack);
        this.svgContainer = el('div', { className: 'svg-wrapper' });
        this._renderSVG();
        container.append(controls, this.svgContainer);
        return container;
    }

    _switchView(view, activeBtn, inactiveBtn) {
        this.currentView = view;
        activeBtn.classList.add('active');
        inactiveBtn.classList.remove('active');
        this._renderSVG();
    }

    _renderSVG() {
        this.svgContainer.innerHTML = '';
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("viewBox", "0 0 200 400");
        svg.setAttribute("class", "body-map-svg");
        
        BodyMap.PATHS[this.currentView].forEach(part => {
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", part.d);
            path.setAttribute("class", `body-part ${this.selectedParts.has(part.id) ? 'active' : ''}`);
            
            if (!this.readOnly) {
                path.onclick = () => this._togglePart(part.id, path);
            }
            svg.appendChild(path);
        });
        this.svgContainer.appendChild(svg);
    }

    _togglePart(partId, element) {
        if (this.selectedParts.has(partId)) {
            this.selectedParts.delete(partId);
            element.classList.remove('active');
        } else {
            this.selectedParts.add(partId);
            element.classList.add('active');
        }
        if (this.onChange) {
            this.onChange(Array.from(this.selectedParts));
        }
    }

    updateSelection(newParts) {
        this.selectedParts = new Set(newParts || []);
        // 重新渲染 SVG 以反映新的 active class 狀態
        this._renderSVG();
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
