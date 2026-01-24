/**
 * src/ui/components.js
 * 共用 UI 元件庫
 * 
 * @description 提供 Modal, Toast, TagSelector, BodyMap 等基礎互動元件。
 * 不依賴具體業務邏輯，僅透過 Props 或 EventBus 溝通。
 */

import { EventTypes, AnatomicalWeights } from '../config.js';
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
        
        // Animation entry
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
            el('button', { className: 'btn-secondary', onclick: () => this.close() }, 'Cancel'),
            el('button', { className: 'btn-primary', onclick: () => {
                if (onConfirm) onConfirm();
                this.close();
            }}, 'Confirm')
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
        this.onChange = onChange;
        //  應用智慧排序策略 (Weight > Count > Length)
        // 確保可用標籤在初始化時即完成排序，提升選取效率
        this.available = this._sortTags(availableTags);
        this.element = this._render();
    }

    /**
     * 標籤智慧排序 (Smart Sort)
     * 策略：
     * 1. 解剖學權重 (Anatomical Weight) - 頭頸核心優先
     * 2. 使用頻率 (Usage Count) - 常用優先
     * 3. 字串長度 (Length) - 短詞優先 (通常為核心概念)
     */
    _sortTags(tags) {
        // 複製陣列以避免副作用
        return [...tags].sort((a, b) => {
            // Helper: 計算權重分數
            const getWeight = (tagName) => {
                // 1. 精確匹配
                if (AnatomicalWeights[tagName]) return AnatomicalWeights[tagName];
                
                // 2. 模糊匹配 (關鍵字包含)
                // 取匹配到的最高權重 (例如 "左肩" 匹配 "肩" -> 80)
                let maxW = 0;
                Object.keys(AnatomicalWeights).forEach(key => {
                    if (tagName.includes(key)) {
                        maxW = Math.max(maxW, AnatomicalWeights[key]);
                    }
                });
                return maxW;
            };

            const weightA = getWeight(a.name);
            const weightB = getWeight(b.name);

            //  規則 0: 自訂標籤優先 (Custom Tags First)
            // 若權重為 0 (表示不在解剖權重表中)，視為使用者自訂標籤，給予最高排序優先權
            // 讓治療師自創的特殊標籤 (如 "VIP", "常客") 不會被淹沒在解剖標籤海中
            const isCustomA = weightA === 0;
            const isCustomB = weightB === 0;

            if (isCustomA && !isCustomB) return -1; // A 前 B 後
            if (!isCustomA && isCustomB) return 1;  // B 前 A 後

            // 規則 1: 解剖權重高者排前 (Weight Desc)
            if (weightA !== weightB) {
                return weightB - weightA;
            }

            // 規則 2: 使用次數多者排前 (Count Desc) - 需處理 undefined
            const countA = a.count || 0;
            const countB = b.count || 0;
            if (countA !== countB) {
                return countB - countA;
            }

            // 規則 3: 字串短者排前 (Length Asc) - Tie-breaker
            return a.name.length - b.name.length;
        });
    }

    _render() {
        const container = el('div', { className: 'tag-selector' });
        
        // Selected Tags Area
        this.selectedContainer = el('div', { className: 'selected-tags' });
        this._renderSelected();

        // Input / Dropdown
        const input = el('input', { 
            type: 'text', 
            placeholder: 'Add tag... (Enter to add)',
            onkeydown: (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this._addTag(e.target.value);
                    e.target.value = '';
                }
            }
        });

        // Suggestions Area
        // 使用已排序的 this.available 進行渲染
        const suggestions = el('div', { className: 'tag-suggestions' });
        
        // 效能優化：僅顯示前 30 個建議，避免 DOM 過大造成卡頓 (Local-First UX Optimization)
        this.available.slice(0, 30).forEach(tag => {
            // 過濾掉已選取的標籤，避免重複顯示
            if (this.selected.has(tag.name)) return;

            const chip = el('span', { 
                className: 'tag-chip suggestion',
                // 使用 TagManager 傳入的顏色 (混合策略結果)，若無則使用預設灰
                style: { backgroundColor: tag.color || '#ddd' },
                title: `Count: ${tag.count || 0}`, // Tooltip 顯示使用頻率
                onclick: () => {
                    this._addTag(tag.name);
                    chip.remove(); // 點擊後從建議列表移除 (Visual feedback)
                }
            }, tag.name);
            suggestions.appendChild(chip);
        });

        container.append(this.selectedContainer, input, suggestions);
        return container;
    }

    _renderSelected() {
        this.selectedContainer.innerHTML = '';
        this.selected.forEach(tagName => {
            // 嘗試從 available 中找到對應的顏色資訊
            // 若為新輸入的標籤，暫時使用預設色 (#64748b Slate-500)，待存檔後由 TagManager 更新
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
            this.selectedContainer.appendChild(chip);
        });
    }

    _addTag(name) {
        const cleanName = name.trim();
        if (cleanName && !this.selected.has(cleanName)) {
            this.selected.add(cleanName);
            this._renderSelected();
            this.onChange(Array.from(this.selected));
        }
    }

    _removeTag(name) {
        this.selected.delete(name);
        this._renderSelected();
        this.onChange(Array.from(this.selected));
    }
}
// --- Body Map (SVG) with Anatomical Segmentation ---
export class BodyMap {
    constructor(selectedParts = [], onChange, readOnly = false) {
        this.selectedParts = new Set(selectedParts);
        this.onChange = onChange;
        this.readOnly = readOnly;
        this.currentView = 'FRONT'; // FRONT | BACK
        this.element = this._renderContainer();
    }

    /**
     * SVG 路徑資料庫
     * 對應 AnatomicalWeights 定義的部位
     * 座標系統：0 0 200 400
     */
    static get PATHS() {
        return {
            FRONT: [
                // 中軸
                { id: 'Head', label: '頭', d: 'M75,10 C75,0 125,0 125,10 C125,35 75,35 75,10 Z' },
                { id: 'Neck', label: '頸', d: 'M85,35 L115,35 L120,50 L80,50 Z' },
                { id: 'Chest', label: '胸', d: 'M70,50 L130,50 L125,100 L75,100 Z' },
                { id: 'Abdomen', label: '腹', d: 'M75,100 L125,100 L120,160 L80,160 Z' },
                
                // 上肢 (左/右)
                { id: 'Shoulder-L', label: '左肩', d: 'M130,50 L155,55 L150,75 L130,70 Z' },
                { id: 'Arm-Upper-L', label: '左上臂', d: 'M155,55 L170,100 L155,105 L150,75 Z' },
                { id: 'Arm-Lower-L', label: '左前臂', d: 'M170,100 L180,140 L165,145 L155,105 Z' },
                { id: 'Hand-L', label: '左手', d: 'M180,140 L190,160 L175,165 L165,145 Z' },

                { id: 'Shoulder-R', label: '右肩', d: 'M70,50 L45,55 L50,75 L70,70 Z' },
                { id: 'Arm-Upper-R', label: '右上臂', d: 'M45,55 L30,100 L45,105 L50,75 Z' },
                { id: 'Arm-Lower-R', label: '右前臂', d: 'M30,100 L20,140 L35,145 L45,105 Z' },
                { id: 'Hand-R', label: '右手', d: 'M20,140 L10,160 L25,165 L35,145 Z' },

                // 下肢 (左/右) - 包含 Hip
                { id: 'Hip', label: '骨盆', d: 'M80,160 L120,160 L130,190 L70,190 Z' },
                { id: 'Leg-Upper-L', label: '左大腿', d: 'M100,190 L130,190 L125,260 L105,260 Z' },
                { id: 'Leg-Lower-L', label: '左小腿', d: 'M105,260 L125,260 L120,330 L100,330 Z' },
                { id: 'Foot-L', label: '左足', d: 'M100,330 L120,330 L125,350 L95,350 Z' },

                { id: 'Leg-Upper-R', label: '右大腿', d: 'M100,190 L70,190 L75,260 L95,260 Z' },
                { id: 'Leg-Lower-R', label: '右小腿', d: 'M95,260 L75,260 L80,330 L100,330 Z' },
                { id: 'Foot-R', label: '右足', d: 'M100,330 L80,330 L75,350 L105,350 Z' }
            ],
            BACK: [
                // 背面特有部位
                { id: 'Head-Back', label: '後腦', d: 'M75,10 C75,0 125,0 125,10 C125,35 75,35 75,10 Z', style: 'fill:#ddd' },
                { id: 'Neck-Back', label: '後頸', d: 'M85,35 L115,35 L120,50 L80,50 Z' },
                { id: 'Back-Upper', label: '上背', d: 'M70,50 L130,50 L125,110 L75,110 Z' }, // Traps/Rhomboids
                { id: 'Back-Lower', label: '下背', d: 'M75,110 L125,110 L120,160 L80,160 Z' }, // Lumbar
                
                // 後側上肢
                { id: 'Shoulder-Back-L', label: '左後肩', d: 'M130,50 L155,55 L150,75 L130,70 Z' },
                { id: 'Arm-Back-Upper-L', label: '左上臂後', d: 'M155,55 L170,100 L155,105 L150,75 Z' }, // Triceps
                { id: 'Arm-Back-Lower-L', label: '左前臂後', d: 'M170,100 L180,140 L165,145 L155,105 Z' },
                { id: 'Hand-Back-L', label: '左手背', d: 'M180,140 L190,160 L175,165 L165,145 Z' },

                { id: 'Shoulder-Back-R', label: '右後肩', d: 'M70,50 L45,55 L50,75 L70,70 Z' },
                { id: 'Arm-Back-Upper-R', label: '右上臂後', d: 'M45,55 L30,100 L45,105 L50,75 Z' },
                { id: 'Arm-Back-Lower-R', label: '右前臂後', d: 'M30,100 L20,140 L35,145 L45,105 Z' },
                { id: 'Hand-Back-R', label: '右手背', d: 'M20,140 L10,160 L25,165 L35,145 Z' },

                // 後側下肢
                { id: 'Glutes', label: '臀部', d: 'M80,160 L120,160 L130,190 L70,190 Z' },
                { id: 'Leg-Back-Upper-L', label: '左腿後', d: 'M100,190 L130,190 L125,260 L105,260 Z' }, // Hamstrings
                { id: 'Leg-Back-Lower-L', label: '左小腿後', d: 'M105,260 L125,260 L120,330 L100,330 Z' }, // Calves
                { id: 'Foot-Back-L', label: '左足跟', d: 'M100,330 L120,330 L125,350 L95,350 Z' },

                { id: 'Leg-Back-Upper-R', label: '右腿後', d: 'M100,190 L70,190 L75,260 L95,260 Z' },
                { id: 'Leg-Back-Lower-R', label: '右小腿後', d: 'M95,260 L75,260 L80,330 L100,330 Z' },
                { id: 'Foot-Back-R', label: '右足跟', d: 'M100,330 L80,330 L75,350 L105,350 Z' }
            ]
        };
    }

    _renderContainer() {
        const container = el('div', { className: 'body-map-container' });
        
        // 1. Controls (Segmented Control)
        const controls = el('div', { className: 'body-map-controls segmented-control' });
        const btnFront = el('button', { 
            className: 'segment-btn active', 
            onclick: () => this._switchView('FRONT', btnFront, btnBack) 
        }, '正面 (Front)');
        const btnBack = el('button', { 
            className: 'segment-btn', 
            onclick: () => this._switchView('BACK', btnFront, btnBack) 
        }, '背面 (Back)');
        
        controls.append(btnFront, btnBack);

        // 2. SVG Container
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
        
        // 根據當前視圖 (正面/背面) 取得路徑資料
        const paths = BodyMap.PATHS[this.currentView];
        
        paths.forEach(part => {
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", part.d);
            path.setAttribute("id", part.id);
            path.setAttribute("vector-effect", "non-scaling-stroke");
            
            // 檢查該部位是否在選取集合中
            const isActive = this.selectedParts.has(part.id);
            path.setAttribute("class", `body-part ${isActive ? 'active' : ''}`);
            
            if (part.style) path.setAttribute("style", part.style);

            if (!this.readOnly) {
                path.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._togglePart(part.id, path);
                });
                
                const title = document.createElementNS(svgNS, "title");
                title.textContent = part.label;
                path.appendChild(title);
            }
            svg.appendChild(path);
        });

        this.svgContainer.appendChild(svg);
    }

    _togglePart(partId, element) {
        if (this.selectedParts.has(partId)) {
            this.selectedParts.delete(partId);
            element.classList.remove('active'); // 即時反饋
        } else {
            this.selectedParts.add(partId);
            element.classList.add('active'); // 即時反饋
        }
        if (this.onChange) {
            this.onChange(Array.from(this.selectedParts));
        }
    }

    /**
     *  公開方法：外部強制更新選取狀態
     * 用於模板套用或資料重置時，同步更新 UI 顯示
     * @param {Array} newParts - 新的部位 ID 陣列
     */
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