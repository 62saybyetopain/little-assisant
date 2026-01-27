/**
 * src/ui/views.js
 * 頁面視圖邏輯
 * 
 * @description 包含 CustomerList, CustomerDetail, RecordEditor 三大核心視圖。
 * 實作 Virtual Scroll 與 髒檢查機制。
 */

import { el, Toast, TagSelector, BodyMap, Modal } from './components.js';
import { customerManager, tagManager } from '../modules/customer.js';
import { recordManager, draftManager } from '../modules/record.js';
import { searchEngine } from '../core/search.js';
import { storageManager } from '../core/db.js';
import { EventBus } from '../core/utils.js';
import { EventTypes, RecordStatus } from '../config.js';

// --- Base View ---
class BaseView {
    constructor() {
        this.root = el('div', { className: 'view-container' });
    }
    mount(parent) { parent.appendChild(this.root); }
    unmount() { this.root.remove(); }
    onLeave() { return true; } // Return false to prevent navigation
}

// --- Customer List View (Virtual Scroll) ---
export class CustomerListView extends BaseView {
    constructor(router) {
        super();
        this.router = router;
        this.items = [];
        this.draftSet = new Set(); //  Cache for draft existence
        this.rowHeight = 60; // px
        this.viewportHeight = 0;
        this.render();
    }

    async render() {
        //  0. Header with Sync Status
        const header = this._renderHeader();

        // 1. Search Bar
        const searchBar = el('input', {
            type: 'text',
            className: 'search-bar',
            placeholder: 'Search customers... (Name, Phone, Tag)',
            oninput: (e) => this._handleSearch(e.target.value)
        });

        // 2. List Container (Virtual Scroll Window)
        this.listContainer = el('div', { 
            className: 'virtual-list-container',
            onscroll: () => this._renderVisibleRows()
        });
        
        this.listSpacer = el('div', { className: 'virtual-list-spacer' }); // Holds the total height
        this.listContent = el('ul', { className: 'virtual-list-content' }); // Holds visible items

        this.listContainer.append(this.listSpacer, this.listContent);

        // 3. FAB (Add Button)
        //  絕對唯讀：無痕模式下隱藏新增入口
        if (!storageManager.isEphemeral) {
            const fab = el('button', {
                className: 'fab',
                onclick: () => this._showCreateModal()
            }, '+');
            this.root.append(header, searchBar, this.listContainer, fab);
        } else {
            this.root.append(header, searchBar, this.listContainer);
        }

        // Initial Load
        await this._loadData();
        
        // Observe resize for virtual scroll
        new ResizeObserver(() => {
            this.viewportHeight = this.listContainer.clientHeight;
            this._renderVisibleRows();
        }).observe(this.listContainer);
    }

    _renderHeader() {
        // Simple Sync Status Indicator
        // In a real app, this should react to SYNC:CONNECTED events
        import('../core/sync.js').then(({ syncGateway }) => {
            if (!this.statusEl) return;
            const peerId = syncGateway.peerManager ? syncGateway.peerManager.myId.slice(0, 4) : 'OFF';
            const conflictCount = syncGateway.getInbox().length;
            
            let statusText = `ID: ${peerId}`;
            if (conflictCount > 0) statusText += ` | ⚠️ ${conflictCount} Conflicts`;
            
            this.statusEl.textContent = statusText;
            this.statusEl.style.color = conflictCount > 0 ? 'var(--danger)' : 'var(--text-muted)';
            
            // Add Settings Button
            this.settingsBtn.onclick = () => this.router.navigate('settings');
        });

        this.statusEl = el('span', { style: { fontSize: '12px', marginRight: '10px' } }, 'Connecting...');
        this.settingsBtn = el('button', { className: 'btn-secondary', style: { padding: '4px 8px', fontSize: '12px' } }, '⚙️');

        return el('div', { 
            style: { 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '8px 16px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)'
            } 
        }, 
            el('b', {}, 'LocalFirst EMR'),
            el('div', {}, this.statusEl, this.settingsBtn)
        );
    }

    async _loadData() {
        //  Load Drafts in parallel to identify icons
        const [allDrafts, _] = await Promise.all([
            draftManager.getAll(),
            Promise.resolve() // Placeholder if needed
        ]);
        
        this.draftSet = new Set(allDrafts.map(d => d.relatedId));

        // 預設載入所有 (透過 SearchEngine 空字串)
        this.items = searchEngine.search('', { limit: 10000, sort: 'updated' });
        this._updateListHeight();
        this._renderVisibleRows();
    }

    _handleSearch(query) {
        //  搜尋結果擴充：允許更多結果以便滾動載入，Virtual Scroll 會處理 DOM 效能
        // 若資料量真的極大(>10萬)，searchEngine.search 內部應支援 cursor 分頁
        this.items = searchEngine.search(query, { limit: 500, sort: 'relevance' }); 
        
        this.listContainer.scrollTop = 0;
        this._updateListHeight();
        this._renderVisibleRows();
    }

    _updateListHeight() {
        this.listSpacer.style.height = `${this.items.length * this.rowHeight}px`;
    }

    _renderVisibleRows() {
        const scrollTop = this.listContainer.scrollTop;
        const startIndex = Math.floor(scrollTop / this.rowHeight);
        const endIndex = Math.min(
            this.items.length,
            Math.floor((scrollTop + this.viewportHeight) / this.rowHeight) + 5 // Buffer
        );

        this.listContent.innerHTML = '';
        this.listContent.style.transform = `translateY(${startIndex * this.rowHeight}px)`;

        for (let i = startIndex; i < endIndex; i++) {
            const item = this.items[i];
            const hasDraft = this.draftSet.has(item.id);

            const row = el('li', { 
                className: 'customer-item',
                style: { height: `${this.rowHeight}px` },
                onclick: () => this.router.navigate(`customer/${item.id}`)
            }, 
                el('div', { 
                    className: 'customer-name',
                    style: { display: 'flex', alignItems: 'center', gap: '8px' }
                }, 
                    item.n,
                    hasDraft ? el('span', { title: 'Unsaved Draft', style: { fontSize: '12px' } }, '📝') : null
                ),
                el('div', { className: 'customer-meta' }, `${item.p} | ${item.t ? item.t.join(', ') : ''}`)
            );
            this.listContent.appendChild(row);
        }
    }
    _showCreateModal() {
        const feedback = el('div', { style: { color: 'var(--warning)', fontSize: '12px', minHeight: '16px' } });
        
        const checkDuplicate = (term) => {
            if (!term || term.length < 3) return;
            const results = searchEngine.search(term, { limit: 1 });
            if (results.length > 0) {
                const match = results[0];
                if (match._isCold) {
                    feedback.textContent = `⚠️ Found in Archive: ${match.n} (Last: ${match.lastSeen || 'N/A'})`;
                } else {
                    feedback.textContent = `⚠️ Duplicate: ${match.n} (${match.p || ''})`;
                }
            } else {
                feedback.textContent = '';
            }
        };

        const nameInput = el('input', { 
            type: 'text', placeholder: 'Name *',
            onblur: (e) => checkDuplicate(e.target.value)
        });
        
        const phoneInput = el('input', { 
            type: 'tel', placeholder: 'Phone',
            onblur: (e) => {
                const val = e.target.value;
                if (val && !/^\d{3,10}$/.test(val)) { //  Phone Regex
                    feedback.textContent = '❌ Invalid Phone Format';
                    return;
                }
                checkDuplicate(val);
            }
        });
        
        new Modal('New Customer', el('div', {}, nameInput, phoneInput, feedback), async () => {
            if (!nameInput.value) return Toast.show('Name is required', 'error');
            // Allow creation even with warnings (Soft block), unless format error
            if (feedback.textContent.includes('Invalid')) return;

            try {
                const newCustomer = await customerManager.create({
                    name: nameInput.value,
                    phone: phoneInput.value
                });
                Toast.show('Customer created');
                this.router.navigate(`customer/${newCustomer.id}`);
            } catch (e) {
                Toast.show(e.message, 'error');
            }
        }).open();
    }
}

// --- Customer Detail View ---
export class CustomerDetailView extends BaseView {
    constructor(router, params) {
        super();
        this.router = router;
        this.customerId = params.id;
        this.render();
    }

    async render() {
        const customer = await customerManager.get(this.customerId);
        if (!customer) {
            this.root.innerHTML = 'Customer not found';
            return;
        }

        // Header
        const header = el('div', { className: 'detail-header' },
            el('h1', {}, customer.name),
            el('p', {}, `Phone: ${customer.phone}`),
            el('button', { 
                onclick: () => this.router.navigate(`record/new?customerId=${this.customerId}`) 
            }, 'New Record')
        );

        // Record History
        const historyContainer = el('div', { className: 'history-list' });
        const records = await recordManager.getByCustomer(this.customerId);

        //  Last Visit Summary & Clone
        if (records.length > 0) {
            const lastRecord = records[0]; // First is newest due to sorting
            const summary = el('div', { 
                className: 'summary-card',
                style: { margin: '16px', padding: '16px', background: '#e0f2fe', borderRadius: '8px' } 
            },
                el('h3', {}, 'Last Visit Summary'),
                el('p', {}, `Date: ${new Date(lastRecord.updatedAt).toLocaleDateString()}`),
                el('p', {}, `Notes: ${lastRecord.content?.notes || 'No notes'}`),
                el('button', {
                    className: 'btn-primary',
                    style: { marginTop: '8px', fontSize: '12px' },
                    onclick: () => this._cloneRecord(lastRecord)
                }, '⚡ Clone & Continue')
            );
            // Insert Summary after header
            this.root.append(header, summary, historyContainer);
        } else {
            this.root.append(header, historyContainer);
        }
        
    }

    async _cloneRecord(sourceRecord) {
        try {
            // 1. Create new record with copied content but new ID
            const newRecord = await recordManager.create(this.customerId, {
                content: { ...sourceRecord.content }, // Deep clone needed in real app
                tags: [...(sourceRecord.tags || [])]
            });
            // 2. Navigate to editor
            Toast.show('Record cloned from previous visit');
            this.router.navigate(`record/${newRecord.id}`);
        } catch (e) {
            Toast.show('Clone failed: ' + e.message, 'error');
        }
    }
}

// --- Record Editor View ---
export class RecordEditorView extends BaseView {
    constructor(router, params) {
        super();
        this.router = router;
        this.recordId = params.id === 'new' ? null : params.id;
        this.customerId = new URLSearchParams(window.location.hash.split('?')[1]).get('customerId');
        
        this.isDirty = false;
        this.data = {};
        this.autoSaveTimer = null;
        this.currentTab = 'tab-visual'; // Default to Visual for quick entry
        
        // 初始化實例屬性，避免 undefined
        this.bodyMap = null;
        this.tagSelector = null;
        this.assessmentContainer = null;

        this.render();
    }

    /**
     * 根據選取部位顯示評估建議
     */
    _updateAssessmentSuggestions(selectedParts) {
        if (!this.assessmentContainer) return;
        
        // 這裡可以考慮做成快取，避免每次都 import
        import('../config.js').then(({ AssessmentDatabase }) => {
            const suggestions = new Set();
            
            // 1. 遍歷選取部位，查找對應測試
            selectedParts.forEach(partId => {
                // 簡單的關鍵字匹配：若 partId 包含 "Shoulder"，則撈取 Shoulder 的測試
                Object.keys(AssessmentDatabase).forEach(regionKey => {
                    if (partId.includes(regionKey)) {
                        AssessmentDatabase[regionKey].forEach(test => suggestions.add(test));
                    }
                });
            });

            // 2. 渲染建議列表
            this.assessmentContainer.innerHTML = '';
            if (suggestions.size > 0) {
                this.assessmentContainer.style.display = 'block';
                this.assessmentContainer.appendChild(el('h5', { style: 'margin:0 0 5px 0; color:#0369a1;' }, '💡 建議評估項目 (點擊加入)'));
                
                const list = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } });
                suggestions.forEach(test => {
                    const chip = el('button', { 
                        className: 'btn-secondary',
                        style: { fontSize: '12px', padding: '4px 8px', background: 'white' },
                        onclick: () => this._addAssessmentResult(test)
                    }, test.name);
                    list.appendChild(chip);
                });
                this.assessmentContainer.appendChild(list);
            } else {
                this.assessmentContainer.style.display = 'none';
            }
        });
    }

    _addAssessmentResult(test) {
        // 自動填入 Assessment 欄位
        const currentText = this.data.soap?.a || '';
        const newEntry = `[${test.name}] (+) Positive -> 疑似 ${test.positive}`;
        
        if (!this.data.soap) this.data.soap = {};
        
        // 避免重複添加
        if (!currentText.includes(test.name)) {
            this.data.soap.a = currentText ? currentText + '\n' + newEntry : newEntry;
            
            // 更新 UI (若當前不在 A Tab，下次切換會自動顯示，但若在 A Tab 需手動更新 DOM)
            const textarea = this.root.querySelector('#tab-a textarea');
            if (textarea) textarea.value = this.data.soap.a;
            
            this._markDirty();
            Toast.show('Assessment added');
        }
    }

    async render() {
        // 1. Load Data
        if (this.recordId) {
            this.data = await recordManager.get(this.recordId);
        } else if (this.customerId) {
            // Check for existing draft
            const draft = await draftManager.get(this.customerId);
            if (draft) {
                this.data = { ...draft.data, customerId: this.customerId }; // Restore draft
                Toast.show('Draft restored');
            } else {
                this.data = await recordManager.create(this.customerId); // Create temp object
            }
            this.recordId = this.data.id;
        }

        if (!this.data) {
            this.root.innerHTML = 'Record load failed';
            return;
        }

        // Initialize Data Structures
        this.data.soap = this.data.soap || {};
        this.data.tags = this.data.tags || [];
        this.data.bodyParts = this.data.bodyParts || [];
        const allTags = await tagManager.getAll();

        // --- 1. UI: Header & Status ---
        const statusLabel = el('span', { className: 'status-badge' }, this.data.status || 'Draft');
        
        // --- 2. Components Initialization ---
        
        // 將元件實例存為 Class Property (this.tagSelector)
        this.tagSelector = new TagSelector(this.data.tags, allTags, (newTags) => {
            this.data.tags = newTags;
            this._markDirty();
        });

        // 將元件實例存為 Class Property (this.bodyMap)
        this.bodyMap = new BodyMap(this.data.bodyParts, (parts) => {
            this.data.bodyParts = parts;
            // 連動 TagSelector (新增部位標籤)
            parts.forEach(p => this.tagSelector._addTag(p));
            this._markDirty();
            // 使用 this. 呼叫內部方法
            this._updateAssessmentSuggestions(parts); 
        }, this.data.status === RecordStatus.FINALIZED);

        // --- 3. Tabbed Layout Construction ---
        
        // Tab Navigation
        const tabs = [
            { id: 'tab-visual', label: 'Visual (人體圖)' },
            { id: 'tab-s', label: 'S (主訴)' },
            { id: 'tab-o', label: 'O (客觀)' },
            { id: 'tab-a', label: 'A (評估)' },
            { id: 'tab-p', label: 'P (計畫)' }
        ];

        const navBar = el('div', { className: 'tab-nav' });
        tabs.forEach(t => {
            const btn = el('button', { 
                className: `tab-btn ${this.currentTab === t.id ? 'active' : ''}`,
                onclick: () => this._switchTab(t.id, contentContainer, navBar)
            }, t.label);
            navBar.appendChild(btn);
        });

        // Tab Content Container
        const contentContainer = el('div', { className: 'tab-content-wrapper' });

        // -- Tab 1: Visual (BodyMap + Tags) --
        const tabVisual = el('div', { id: 'tab-visual', className: 'tab-pane active' },
            el('h4', {}, '患處標記 & 標籤'),
            this.bodyMap.element, // 使用 this.bodyMap
            el('div', { style: { marginTop: '10px' } }, this.tagSelector.element) // 使用 this.tagSelector
        );

        // -- Tab 2: Subjective --
        const tabS = this._createTabPane('tab-s', 'Subjective (主訴)', 's', '病患描述、疼痛性質、發生機制...');
        
        // -- Tab 3: Objective --
        const tabO = this._createTabPane('tab-o', 'Objective (客觀檢查)', 'o', '觸診發現、腫脹、觀察姿態...');

        // -- Tab 4: Assessment (With Dynamic List) --
        const tabA = this._createTabPane('tab-a', 'Assessment (評估與測試)', 'a', '動作測試結果、特殊測試陽性反應...');
        
        // 評估建議區塊
        this.assessmentContainer = el('div', { 
            className: 'assessment-recommendations',
            style: { 
                marginTop: '10px', 
                padding: '10px', 
                background: '#f0f9ff', 
                borderRadius: '4px',
                border: '1px dashed #bae6fd',
                display: 'none' // Hidden by default
            } 
        });
        tabA.appendChild(this.assessmentContainer);

        // -- Tab 5: Plan --
        const tabP = this._createTabPane('tab-p', 'Plan (治療計畫)', 'p', '治療項目、回家運動、建議事項...');

        // 確保在 BodyMap 改變時更新建議 (雖然上面建構子已經綁定，但這段邏輯是為了確保初始化時正確渲染)
        // 由於我們上面已經在 new BodyMap 的 callback 裡寫了 updateAssessmentSuggestions，這裡只需執行初始化即可
        this._updateAssessmentSuggestions(this.data.bodyParts);

        contentContainer.append(tabVisual, tabS, tabO, tabA, tabP);

        // --- 4. Actions Footer ---
        const actions = el('div', { className: 'editor-actions' });
        if (this.data.status !== RecordStatus.FINALIZED) {
            actions.appendChild(el('button', {
                className: 'btn-secondary',
                // 使用 this.tagSelector 傳遞給模板模態框
                onclick: () => this._showTemplateModal(this.tagSelector)
            }, '📋 Template'));

            actions.appendChild(el('button', {
                className: 'btn-primary',
                onclick: () => this._handleFinalize() 
            }, 'Finalize'));
            
            actions.appendChild(el('button', {
                className: 'btn-secondary',
                onclick: () => this._save(RecordStatus.DRAFT)
            }, 'Save Draft'));
        }

        this.root.append(statusLabel, navBar, contentContainer, actions);
    }

    _createTabPane(id, title, soapKey, placeholder) {
        const textarea = el('textarea', {
            className: 'record-content soap-textarea', 
            placeholder: placeholder,
            value: this.data.soap?.[soapKey] || '',
            oninput: (e) => {
                if (!this.data.soap) this.data.soap = {};
                this.data.soap[soapKey] = e.target.value;
                this._markDirty();
            },
            disabled: this.data.status === RecordStatus.FINALIZED
        });

        const pane = el('div', { id: id, className: 'tab-pane' },
            el('h4', {}, title),
            textarea
        );
        
        if (id !== this.currentTab) pane.style.display = 'none';
        return pane;
    }

    _switchTab(tabId, container, navBar) {
        this.currentTab = tabId;
        
        // Update Buttons
        Array.from(navBar.children).forEach(btn => {
            btn.classList.toggle('active', btn.textContent.includes(this._getTabLabel(tabId)));
        });

        // Update Panes
        Array.from(container.children).forEach(pane => {
            pane.style.display = pane.id === tabId ? 'block' : 'none';
        });
    }

    _getTabLabel(id) {
        const map = { 'tab-visual': 'Visual', 'tab-s': 'S', 'tab-o': 'O', 'tab-a': 'A', 'tab-p': 'P' };
        return map[id];
    }

    _markDirty() {
        this.isDirty = true;
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            draftManager.save(this.recordId || this.customerId, this.data);
        }, 2000);
    }

    async _save(status, options = {}) {
        try {
            const payload = {
                content: this.data.content, // 保留舊內容相容
                tags: this.data.tags,
                soap: this.data.soap,
                bodyParts: this.data.bodyParts,
                painScale: this.data.painScale,
                ...options 
            };

            await recordManager.save(this.data.id, payload, status);
            
            this.isDirty = false;
            Toast.show(status === RecordStatus.FINALIZED ? 'Record Finalized' : 'Saved');
            this.router.back();
        } catch (e) {
            Toast.show(e.message, 'error');
        }
    }

    _handleFinalize() {
        const content = el('div', {}, 
            el('p', { style: { marginBottom: '15px' } }, '選擇版本更新策略：'),
            el('div', { style: { display: 'flex', gap: '10px', marginBottom: '15px' } },
                this._createRadio('NONE', '不變更', true),
                this._createRadio('MINOR', '小版本 (錯字)', false),
                this._createRadio('MAJOR', '大版本 (評估改變)', false)
            ),
            el('div', { id: 'reason-container', style: { display: 'none' } },
                el('textarea', { 
                    id: 'change-reason',
                    placeholder: '請輸入版本變更原因 (例如：重新評估後調整診斷)',
                    style: { width: '100%', height: '60px', padding: '8px' }
                })
            )
        );

        content.querySelectorAll('input[name="v-strategy"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const reasonBox = content.querySelector('#reason-container');
                if (e.target.value === 'MAJOR') {
                    reasonBox.style.display = 'block';
                    setTimeout(() => content.querySelector('#change-reason').focus(), 100);
                } else {
                    reasonBox.style.display = 'none';
                }
            });
        });

        new Modal('Finalize Record', content, () => {
            const strategy = content.querySelector('input[name="v-strategy"]:checked').value;
            const reason = content.querySelector('#change-reason').value;
            
            this._save(RecordStatus.FINALIZED, {
                versionStrategy: strategy,
                changeReason: reason
            });
        }).open();
    }

    _createRadio(value, label, checked) {
        const wrapper = el('label', { style: { display: 'flex', alignItems: 'center', cursor: 'pointer' } });
        const input = el('input', { 
            type: 'radio', 
            name: 'v-strategy', 
            value: value,
            checked: checked
        });
        wrapper.append(input, el('span', { style: { marginLeft: '4px' } }, label));
        return wrapper;
    }
    
    _showTemplateModal(tagSelector) {
        import('../config.js').then(({ DefaultTemplates }) => {
            const list = el('div', { className: 'template-list', style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
            
            DefaultTemplates.forEach(tpl => {
                const btn = el('button', {
                    className: 'btn-secondary',
                    style: { textAlign: 'left' },
                    onclick: () => {
                        this._applyTemplate(tpl, tagSelector);
                        modal.close(); // 注意：這裡的 modal 是閉包變數，需確保範疇正確，或改用實例
                    }
                }, 
                    el('div', { style: { fontWeight: 'bold' } }, tpl.title),
                    el('div', { style: { fontSize: '12px', color: '#666' } }, tpl.description || '')
                );
                list.appendChild(btn);
            });

            // 宣告 modal 變數以便 onclick 閉包使用
            const modal = new Modal('Select Template', list);
            modal.open();
        });
    }

    async _applyTemplate(template) {
        const { templateManager } = await import('../modules/record.js');
        
        const hasContent = (this.data.soap?.s || this.data.soap?.o || this.data.soap?.a || this.data.soap?.p);
        let strategy = 'Append';

        if (hasContent) {
            if (confirm(`Current record is not empty.\nClick OK to APPEND (Keep existing).\nClick Cancel to OVERRIDE (Replace all).`)) {
                strategy = 'Append';
            } else {
                strategy = 'Override';
            }
        }

        const mergedRecord = templateManager.merge(this.data, template, strategy);

        this.data.soap = mergedRecord.soap;
        this.data.tags = mergedRecord.tags;
        this.data.bodyParts = mergedRecord.bodyParts;
        this.data.painScale = mergedRecord.painScale;

        // 更新 UI
        ['s', 'o', 'a', 'p'].forEach(key => {
            const el = this.root.querySelector(`#tab-${key} textarea`);
            if (el) el.value = this.data.soap[key] || '';
        });

        if (this.tagSelector) {
            mergedRecord.tags.forEach(t => this.tagSelector._addTag(t));
        }

        if (this.bodyMap) {
            this.bodyMap.updateSelection(this.data.bodyParts);
        }

        this._markDirty();
        this._updateAssessmentSuggestions(this.data.bodyParts); 
        
        Toast.show(`Template "${template.title}" applied (${strategy}).`);
    }

    onLeave() {
        if (this.isDirty) {
            return confirm('You have unsaved changes. Leave anyway?');
        }
        return true;
    }
}
// --- Settings View ---
export class SettingsView extends BaseView {
    constructor(router) {
        super();
        this.router = router;
        this.render();
    }

    async render() {
        const { syncGateway } = await import('../core/sync.js');
        const { storageManager } = await import('../core/db.js');

        const container = el('div', { style: { padding: '20px', maxWidth: '600px', margin: '0 auto' } });
        
        // Header
        container.appendChild(el('h2', {}, 'System Settings'));

       // 1. Sync Status & Device Name
        const peerId = syncGateway.peerManager ? syncGateway.peerManager.myId : 'Unknown';
        const currentName = localStorage.getItem('device_name') || `Device-${peerId.slice(0, 4)}`;

        const syncSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: 'var(--surface)', borderRadius: '8px' } },
            el('h3', {}, 'P2P Synchronization'),
            
            //  Device Name Input
            el('div', { style: { marginBottom: '10px' } },
                el('label', { style: { display: 'block', fontSize: '12px', color: '#666' } }, 'Device Name'),
                el('div', { style: { display: 'flex', gap: '8px' } },
                    el('input', { 
                        type: 'text', 
                        value: currentName,
                        id: 'device-name-input',
                        style: { flex: 1, padding: '4px' },
                        placeholder: 'Enter device name'
                    }),
                    el('button', {
                        className: 'btn-primary',
                        style: { fontSize: '12px', padding: '4px 8px' },
                        onclick: () => {
                            const newName = document.getElementById('device-name-input').value.trim();
                            if (newName) {
                                localStorage.setItem('device_name', newName);
                                // 若 PeerManager 已啟動，更新其名稱
                                if (syncGateway.peerManager) {
                                    syncGateway.peerManager.deviceName = newName;
                                    syncGateway.peerManager.announce(); // 廣播新名稱
                                }
                                import('./components.js').then(({ Toast }) => Toast.show('Device name saved'));
                            }
                        }
                    }, 'Save')
                )
            ),

            el('p', {}, `My Peer ID: `),
            el('code', { style: { background: '#eee', padding: '4px' } }, peerId),
            el('div', { style: { marginTop: '10px' } }, 
                syncGateway.isSyncing 
                ? el('span', { style: { color: 'green' } }, '● Online (Broadcasting)') 
                : el('span', { style: { color: 'red' } }, '● Offline')
            )
        );

        // 2. Conflict Management (Inbox)
        const inbox = syncGateway.getInbox();
        const inboxSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: 'var(--surface)', borderRadius: '8px' } },
            el('h3', {}, `Conflict Inbox (${inbox.length})`),
            inbox.length === 0 ? el('p', { style: { color: '#888' } }, 'No conflicts pending.') : this._renderInboxList(inbox, syncGateway)
        );

        // 3. Danger Zone
        const dangerSection = el('div', { className: 'settings-section', style: { padding: '15px', border: '1px solid var(--danger)', borderRadius: '8px' } },
            el('h3', { style: { color: 'var(--danger)' } }, 'Danger Zone'),
            el('p', {}, 'Factory Reset will delete ALL local data (Customers, Records, Tags). This cannot be undone.'),
            el('button', { 
                className: 'btn-secondary',
                style: { borderColor: 'var(--danger)', color: 'var(--danger)' },
                onclick: () => this._handleFactoryReset()
            }, '🗑️ Factory Reset')
        );

        // Back Button
        const backBtn = el('button', { 
            className: 'btn-secondary', 
            style: { marginBottom: '20px' },
            onclick: () => this.router.back() 
        }, '← Back');

        this.root.append(backBtn, container);
        container.append(syncSection, inboxSection, dangerSection);
    }

    _renderInboxList(inbox, gateway) {
        const list = el('ul', { style: { listStyle: 'none', padding: 0 } });
        inbox.forEach(item => {
            const li = el('li', { style: { padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' } },
                el('div', {}, 
                    el('strong', {}, `Store: ${item.store}`),
                    el('div', { style: { fontSize: '12px' } }, `ID: ${item.id.slice(0,8)}... from Peer ${item.peerId.slice(0,4)}`)
                ),
                el('div', { style: { display: 'flex', gap: '5px' } },
                    el('button', { 
                        className: 'btn-primary',
                        style: { fontSize: '12px', padding: '2px 8px' },
                        onclick: async () => {
                            await gateway.approve(item.id);
                            Toast.show('Resolved (Approved)');
                            this.router.navigate('settings'); // Refresh
                        }
                    }, '✓'),
                    el('button', { 
                        className: 'btn-secondary',
                        style: { fontSize: '12px', padding: '2px 8px' },
                        onclick: () => {
                            gateway.reject(item.id);
                            Toast.show('Resolved (Rejected)');
                            this.router.navigate('settings'); // Refresh
                        }
                    }, '✗')
                )
            );
            list.appendChild(li);
        });
        return list;
    }

    async _handleFactoryReset() {
        if (confirm('CRITICAL WARNING: Are you sure you want to delete ALL data?')) {
            if (confirm('Final Confirmation: This action is irreversible.')) {
                try {
                    // Close connections
                    const { syncGateway } = await import('../core/sync.js');
                    syncGateway.stop();
                    
                    // Native IDB Delete
                    const req = indexedDB.deleteDatabase('LocalFirstDB');
                    req.onsuccess = () => {
                        alert('System Reset Complete. Reloading...');
                        window.location.reload();
                    };
                    req.onerror = () => alert('Reset Failed');
                    req.onblocked = () => alert('Reset Blocked: Please close other tabs.');
                } catch (e) {
                    alert('Error: ' + e.message);
                }
            }
        }
    }
}
// --- Draft List View ---
export class DraftListView extends BaseView {
    constructor(router) {
        super();
        this.router = router;
        this.render();
    }

    async render() {
        const { draftManager } = await import('../modules/record.js');
        const { customerManager } = await import('../modules/customer.js');
        
        // Header
        const header = el('div', { className: 'detail-header' },
            el('h2', {}, 'Unsaved Drafts'),
            el('button', { className: 'btn-secondary', onclick: () => this.router.back() }, '← Back')
        );

        const listContainer = el('div', { className: 'history-list' });
        
        // Fetch Data
        try {
            const drafts = await draftManager.getAll();
            
            if (drafts.length === 0) {
                listContainer.innerHTML = '<div style="padding:20px; color:#888; text-align:center;">No unsaved drafts found.</div>';
            } else {
                // Render List
                for (const draft of drafts) {
                    // Enrich with Customer Name
                    const customerId = draft.data.customerId || draft.relatedId;
                    const customer = await customerManager.get(customerId);
                    const customerName = customer ? customer.name : 'Unknown Customer';
                    const savedTime = new Date(draft.updatedAt).toLocaleString();
                    const snippet = draft.data.content && draft.data.content.notes 
                        ? draft.data.content.notes.substring(0, 50) + '...' 
                        : '(No content)';

                    const card = el('div', { 
                        className: 'record-card status-draft',
                        style: { cursor: 'pointer', borderLeftColor: 'var(--warning)', position: 'relative', transition: 'transform 0.2s' },
                        onclick: () => this._restoreDraft(draft)
                    },
                        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, 
                            el('strong', {}, customerName),
                            el('small', { style: { color: '#666' } }, savedTime)
                        ),
                        el('div', { style: { marginTop: '8px', color: '#444' } }, snippet),
                        el('div', { style: { marginTop: '4px', fontSize: '12px', color: '#888' } }, 
                            'Tags: ' + (draft.data.tags || []).join(', ')
                        )
                    );
                    
                    //  Swipe Left to Delete Logic
                    let startX = 0;
                    let currentX = 0;
                    const THRESHOLD = -80; // Swipe distance to trigger delete intent

                    card.addEventListener('touchstart', (e) => {
                        startX = e.touches[0].clientX;
                        card.style.transition = 'none'; // Disable transition for real-time tracking
                    }, { passive: true });

                    card.addEventListener('touchmove', (e) => {
                        currentX = e.touches[0].clientX;
                        const deltaX = Math.min(0, currentX - startX); // Only allow left swipe
                        card.style.transform = `translateX(${deltaX}px)`;
                    }, { passive: true });

                    card.addEventListener('touchend', () => {
                        const deltaX = currentX - startX;
                        card.style.transition = 'transform 0.2s'; // Re-enable transition
                        
                        if (deltaX < THRESHOLD) {
                            // Swipe Success -> Delete
                            card.style.transform = 'translateX(-100%)'; // Animate out
                            setTimeout(() => this._discardDraft(draft.relatedId), 200);
                        } else {
                            // Revert
                            card.style.transform = 'translateX(0)';
                        }
                    });

                    // Add Discard Button (Desktop fallback)
                    const discardBtn = el('button', {
                        className: 'btn-secondary',
                        style: { marginTop: '10px', fontSize: '12px', color: 'var(--danger)', borderColor: 'var(--danger)' },
                        onclick: (e) => {
                            e.stopPropagation(); // Prevent card click
                            this._discardDraft(draft.relatedId);
                        }
                    }, '🗑️ Discard');

                    card.appendChild(discardBtn);
                    listContainer.appendChild(card);
                }
            }
        } catch (e) {
            listContainer.innerHTML = `Error loading drafts: ${e.message}`;
        }

        this.root.append(header, listContainer);
    }

    _restoreDraft(draft) {
        // Navigate to Editor. 
        // If relatedId is customerId (new record), route is record/new?customerId=...
        // If relatedId is recordId (edit record), route is record/:id
        // We can infer logic from RecordEditorView handling.
        
        // 簡單判斷：若 draft.id 等於 customerId，通常表示是新病歷的草稿 (RecordEditorView 的邏輯)
        // 但最穩健的方式是直接帶入 ID，讓 Editor 判斷
        const customerId = draft.data.customerId;
        
        if (draft.relatedId === customerId) {
            // Draft for NEW record
            this.router.navigate(`record/new?customerId=${customerId}`);
        } else {
            // Draft for EXISTING record
            this.router.navigate(`record/${draft.relatedId}`);
        }
    }

    async _discardDraft(id) {
        if (confirm('Discard this draft? This cannot be undone.')) {
            const { draftManager } = await import('../modules/record.js');
            await draftManager.discard(id);
            // Reload view
            this.root.innerHTML = '';
            this.render();
        }
    }
}