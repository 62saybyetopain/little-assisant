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
import { EventTypes, RecordStatus, StandardROM } from '../config.js';

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
        this.draftSet = new Set(); // Cache for draft existence
        this.rowHeight = 60; // px
        this.viewportHeight = 0;
        this.render();
    }

    async render() {
        // 0. Header with Sync Status
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
        // 絕對唯讀：無痕模式下隱藏新增入口
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
        // Load Drafts in parallel to identify icons
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
        // 搜尋結果擴充：允許更多結果以便滾動載入，Virtual Scroll 會處理 DOM 效能
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

            // 長按偵測變數 (Closure scope)
            let pressTimer = null;
            let isLongPress = false;

            const row = el('li', { 
                className: 'customer-item',
                style: { height: `${this.rowHeight}px` },
                
                // 1. 一般點擊 (Click / Tap) -> 導航
                onclick: (e) => {
                    // 如果剛剛觸發了長按，則忽略這次的 Click 事件
                    if (isLongPress) {
                        isLongPress = false; // Reset
                        return;
                    }
                    this.router.navigate(`customer/${item.id}`);
                },

                // 2. 桌機右鍵 (Right Click) -> 選單
                oncontextmenu: (e) => {
                    e.preventDefault(); // 阻止瀏覽器預設選單
                    this._showActionSheet(item);
                },

                // 3. 手機長按模擬 (Touch Long Press)
                ontouchstart: (e) => {
                    isLongPress = false; // Reset flag
                    pressTimer = setTimeout(() => {
                        isLongPress = true; // 標記為長按，阻止 onclick
                        if (navigator.vibrate) navigator.vibrate(50); // 震動回饋 (Haptic)
                        this._showActionSheet(item);
                    }, 600); // 長按 600ms 觸發
                },
                
                // 手指移動 (Scroll) -> 取消長按
                ontouchmove: () => {
                    clearTimeout(pressTimer);
                },

                // 手指放開 -> 清除計時器
                ontouchend: () => {
                    clearTimeout(pressTimer);
                }
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

    /**
     * [New] 呼叫共用元件 ActionSheet
     */
    _showActionSheet(item) {
        import('./components.js').then(({ ActionSheet, Toast }) => {
            ActionSheet.show([
                { 
                    label: `Detail: ${item.n}`, 
                    handler: () => this.router.navigate(`customer/${item.id}`) 
                },
                { 
                    label: 'Delete Customer', 
                    danger: true, // 紅色樣式
                    handler: () => this._handleDeleteCustomer(item.id, item.n) 
                }
            ]);
        });
    }

    /**
     * [New] 刪除顧客處理邏輯
     */
    async _handleDeleteCustomer(id, name) {
        if (confirm(`Delete customer "${name}"? This cannot be undone.`)) {
            try {
                await customerManager.delete(id);
                // 刪除後需手動觸發搜尋更新，或依賴 EventBus 監聽自動重整
                // 這裡簡單呼叫搜尋刷新
                this._handleSearch(document.querySelector('.search-bar')?.value || '');
                import('./components.js').then(({ Toast }) => Toast.show('Customer deleted'));
            } catch (e) {
                import('./components.js').then(({ Toast }) => Toast.show(e.message, 'error'));
            }
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
                if (val && !/^\d{3,10}$/.test(val)) { // Phone Regex
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

        // 1. 導航標頭 (Navigation Header)
        const header = el('div', { 
            className: 'nav-header',
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px', background: '#fff', borderBottom: '1px solid #eee' }
        },
            el('div', { className: 'nav-left' }, 
                el('button', { 
                    style: { fontSize: '20px', padding: '5px 10px', cursor: 'pointer' },
                    onclick: () => this.router.back() 
                }, '← Back')
            ),
            el('div', { className: 'nav-title', style: { fontWeight: 'bold', fontSize: '18px' } }, customer.name),
            el('div', { className: 'nav-right' },
                el('button', { 
                    style: { fontSize: '20px', padding: '5px' },
                    onclick: () => this._editCustomer(customer)
                }, '✎')
            )
        );

        // 2. 顧客資訊卡片
        const infoCard = el('div', { style: { padding: '15px', background: '#f8fafc', borderBottom: '1px solid #eee' } },
            el('p', { style: { margin: '0 0 5px 0', color: '#64748b' } }, `Phone: ${customer.phone || 'N/A'}`),
            el('div', { style: { display: 'flex', gap: '5px', flexWrap: 'wrap' } }, 
                ...(customer.tags || []).map(t => el('span', { 
                    style: { background: '#e2e8f0', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' } 
                }, t))
            ),
            el('button', { 
                className: 'btn-primary', 
                style: { width: '100%', marginTop: '15px', padding: '10px', background: '#3b82f6', color: 'white', borderRadius: '8px' },
                onclick: () => this.router.navigate(`record/new?customerId=${this.customerId}`) 
            }, '＋ New Record')
        );

        // 3. 歷史紀錄容器
        const historyContainer = el('div', { className: 'history-list', style: { flex: 1, overflowY: 'auto', padding: '15px' } });
        const records = await recordManager.getByCustomer(this.customerId);

        // 4. 上次就診摘要 (如果有紀錄)
        if (records.length > 0) {
            const lastRecord = records[0]; 
            const summary = el('div', { 
                className: 'summary-card',
                style: { marginBottom: '20px', padding: '15px', background: '#e0f2fe', borderRadius: '8px', border: '1px solid #bae6fd' } 
            },
                el('h3', { style: { margin: '0 0 10px 0', fontSize: '16px', color: '#0369a1' } }, 'Last Visit Summary'),
                el('p', { style: { margin: '5px 0', fontSize: '14px' } }, `Date: ${new Date(lastRecord.updatedAt).toLocaleDateString()}`),
                el('p', { style: { margin: '5px 0', fontSize: '14px' } }, `S/O: ${lastRecord.soap?.s || ''} ${lastRecord.soap?.o || ''}`),
                el('button', {
                    className: 'btn-primary',
                    style: { marginTop: '8px', fontSize: '12px', padding: '5px 10px', background: '#0284c7', color: 'white', borderRadius: '4px' },
                    onclick: () => this._cloneRecord(lastRecord)
                }, '⚡ Clone & Continue')
            );
            historyContainer.appendChild(summary);
        }

        // 5. 渲染列表項目
        records.forEach(rec => {
            const item = el('div', { 
                style: { padding: '15px', background: 'white', marginBottom: '10px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'pointer' },
                onclick: () => this.router.navigate(`record/${rec.id}`)
            },
                el('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '5px' } },
                    el('span', { style: { fontWeight: 'bold' } }, new Date(rec.updatedAt).toLocaleDateString()),
                    el('span', { style: { fontSize: '12px', padding: '2px 6px', borderRadius: '4px', background: '#f1f5f9' } }, rec.status)
                ),
                el('div', { style: { fontSize: '14px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, 
                    rec.soap?.a || rec.soap?.s || '(No content)'
                )
            );
            historyContainer.appendChild(item);
        });

        // 6. 組合頁面 (清除舊內容並重新掛載)
        this.root.style.display = 'flex';
        this.root.style.flexDirection = 'column';
        this.root.style.height = '100vh';
        this.root.innerHTML = ''; 
        this.root.append(header, infoCard, historyContainer);
    }

    _editCustomer(customer) {
        const nameInput = el('input', { type: 'text', value: customer.name, style: 'width: 100%; margin-bottom: 10px; padding: 8px;' });
        const phoneInput = el('input', { type: 'tel', value: customer.phone, style: 'width: 100%; margin-bottom: 10px; padding: 8px;' });
        
        new Modal('Edit Customer', el('div', {}, nameInput, phoneInput), async () => {
            await customerManager.update(customer.id, {
                name: nameInput.value,
                phone: phoneInput.value
            });
            this.render(); // Re-render to show changes
            Toast.show('Customer updated');
        }).open();
    }

    async _cloneRecord(sourceRecord) {
        try {
            const newRecord = await recordManager.create(this.customerId, {
                content: { ...sourceRecord.content },
                tags: [...(sourceRecord.tags || [])]
            });
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
            const draft = await draftManager.get(this.customerId);
            if (draft) {
                this.data = { ...draft.data, customerId: this.customerId };
                Toast.show('Draft restored');
            } else {
                this.data = await recordManager.create(this.customerId);
            }
            this.recordId = this.data.id;
        }

        if (!this.data) {
            this.root.innerHTML = 'Record load failed';
            return;
        }

        // Initialize Data
        this.data.soap = this.data.soap || {};
        this.data.tags = this.data.tags || [];
        this.data.bodyParts = this.data.bodyParts || [];
        this.data.rom = this.data.rom || {}; // 初始化 ROM 資料
        const allTags = await tagManager.getAll();

        // --- UI Construction ---

        // 1. Navigation Header (Back Button)
        const header = el('div', { 
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 15px', background: '#fff', borderBottom: '1px solid #eee' }
        },
            el('button', { onclick: () => this.router.back(), style: 'font-size: 18px;' }, '←'),
            el('div', { style: { fontWeight: 'bold' } }, this.recordId ? 'Edit Record' : 'New Record'),
            el('span', { className: 'status-badge' }, this.data.status || 'Draft')
        );

        // 2. Components Initialization
        this.tagSelector = new TagSelector(this.data.tags, allTags, (newTags) => {
            this.data.tags = newTags;
            this._markDirty();
        });

        this.bodyMap = new BodyMap(this.data.bodyParts, (parts) => {
            this.data.bodyParts = parts;
            parts.forEach(p => this.tagSelector._addTag(p));
            this._markDirty();
            this._updateAssessmentSuggestions(parts); 
        }, this.data.status === RecordStatus.FINALIZED);

        // 3. Tab Navigation (S, O, A, P)
        // 移除獨立 Visual Tab，整合至 O
        const tabs = [
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

        // 4. Tab Content
        const contentContainer = el('div', { className: 'tab-content-wrapper' });

        // -- Tab S: Subjective + Tags --
        const tabS = this._createTabPane('tab-s', 'Subjective (主訴)', 's', '病患描述、疼痛性質...');
        tabS.appendChild(el('div', { style: { marginTop: '15px' } }, 
            el('h5', { style: 'margin: 0 0 5px 0; color: #666;' }, '症狀標籤'),
            this.tagSelector.element
        ));

        // -- Tab O: Objective + BodyMap + ROM --
        const tabO = el('div', { id: 'tab-o', className: 'tab-pane', style: { display: 'none' } });
        
        // O-1: Body Map
        tabO.appendChild(el('h5', { style: 'margin: 0 0 5px 0; color: #666;' }, '患處標記 (Body Map)'));
        tabO.appendChild(this.bodyMap.element);

        // O-2: ROM Inputs (Range of Motion)
        tabO.appendChild(el('h5', { style: 'margin: 15px 0 5px 0; color: #666;' }, '活動度量測 (ROM)'));
        tabO.appendChild(this._renderROMInputs());

        // O-3: Text Notes
        tabO.appendChild(el('h5', { style: 'margin: 15px 0 5px 0; color: #666;' }, '觸診與觀察筆記'));
        const textO = el('textarea', {
            className: 'record-content soap-textarea',
            value: this.data.soap?.o || '',
            oninput: (e) => { 
                this.data.soap.o = e.target.value; 
                this._markDirty(); 
            },
            disabled: this.data.status === RecordStatus.FINALIZED
        });
        tabO.appendChild(textO);

        // -- Tab A: Assessment --
        const tabA = this._createTabPane('tab-a', 'Assessment (評估)', 'a', '診斷結果、測試反應...');
        tabA.prepend(this.assessmentContainer); // 建議列表放最上面

        // -- Tab P: Plan --
        const tabP = this._createTabPane('tab-p', 'Plan (計畫)', 'p', '治療項目、回家運動...');

        contentContainer.append(tabS, tabO, tabA, tabP);

        // 5. Actions Footer
        const actions = el('div', { className: 'editor-actions' });
        if (this.data.status !== RecordStatus.FINALIZED) {
            actions.appendChild(el('button', {
                className: 'btn-secondary',
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

        // 初始化 Tab 狀態
        this._switchTab(this.currentTab, contentContainer, navBar);
        this._updateAssessmentSuggestions(this.data.bodyParts);

        this.root.innerHTML = '';
        this.root.append(header, navBar, contentContainer, actions);
    }

    /**
     * ROM 輸入介面產生器 (動態版本)
     * 依據 StandardROM 配置自動區分左右側與旋轉方向
     */
    _renderROMInputs() {
        // 使用 CSS Grid 雙欄佈局
        const container = el('div', { 
            style: { 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr', 
                gap: '12px',
                padding: '4px'
            } 
        });
        
        // 遍歷 config.js 中定義的所有標準動作
        StandardROM.forEach(action => {
            let variants = [];

            // 依據 sideType 決定生成的欄位數量與標籤
            if (action.sideType === 'lr') {
                // 區分左右側
                variants = [
                    { id: `${action.id}_l`, label: `左-${action.label}` },
                    { id: `${action.id}_r`, label: `右-${action.label}` }
                ];
            } else if (action.sideType === 'rot') {
                // 區分左旋與右旋
                variants = [
                    { id: `${action.id}_l`, label: `${action.label}(左旋)` },
                    { id: `${action.id}_r`, label: `${action.label}(右旋)` }
                ];
            } else {
                // 單一動作 (如軀幹前屈)
                variants = [{ id: action.id, label: action.label }];
            }

            // 渲染每一個變體滑桿
            variants.forEach(v => {
                const val = this.data.rom[v.id] || 0;
                
                // 頂部標籤與數值顯示 (包含正常值參考)
                const labelEl = el('div', { 
                    style: 'font-size: 12px; display: flex; justify-content: space-between; margin-bottom: 4px;' 
                }, 
                    el('span', { style: 'color: #475569;' }, v.label),
                    el('div', {}, 
                        el('span', { className: 'rom-val', style: 'font-weight: bold; color: #2563eb;' }, `${val}°`),
                        el('span', { style: 'color: #94a3b8; font-size: 10px; margin-left: 4px;' }, `(目標:${action.norm}°)`)
                    )
                );
                
                // 滑桿本體
                const slider = el('input', { 
                    type: 'range', 
                    min: action.min, 
                    max: action.max, 
                    value: val,
                    step: 1,
                    style: { width: '100%', cursor: 'pointer' },
                    oninput: (e) => {
                        const newVal = parseInt(e.target.value);
                        labelEl.querySelector('.rom-val').textContent = `${newVal}°`;
                        this.data.rom[v.id] = newVal;
                        this._markDirty();
                    }
                });

                // 卡片容器
                const wrapper = el('div', { 
                    className: 'rom-slider-card',
                    style: { 
                        background: '#fff', 
                        padding: '10px', 
                        borderRadius: '8px', 
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    } 
                }, labelEl, slider);

                container.appendChild(wrapper);
            });
        });

        return container;
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

        const container = el('div', { style: { padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '80px' } });
        
        // Header
        const header = el('div', { 
            className: 'nav-header',
            style: { display: 'flex', alignItems: 'center', padding: '15px', background: '#fff', borderBottom: '1px solid #eee', position: 'sticky', top: 0, zIndex: 10 } 
        },
            el('button', { onclick: () => this.router.back(), style: 'font-size: 20px; margin-right: 15px; cursor: pointer;' }, '←'),
            el('h2', { style: 'margin: 0; font-size: 18px;' }, '系統設定 (Settings)')
        );

        // 1. System Management (CRUD Interfaces)
        const adminSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, '系統管理'),
            this._createMenuBtn('🏷️ 標籤管理', () => this._openTagManager()),
            this._createMenuBtn('💪 動作評估編輯', () => this._openAssessmentEditor()),
            this._createMenuBtn('📋 模板建立', () => this._openTemplateBuilder())
        );

        // 2. P2P Synchronization
        const peerId = syncGateway.peerManager ? syncGateway.peerManager.myId : 'OFFLINE';
        const currentName = localStorage.getItem('device_name') || `Device-${peerId.slice(0, 4)}`;

        const syncSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, 'P2P 同步設定'),
            
            // Device Name
            el('div', { style: { marginBottom: '15px' } },
                el('label', { style: { display: 'block', fontSize: '12px', color: '#666', marginBottom: '5px' } }, '裝置名稱'),
                el('div', { style: { display: 'flex', gap: '8px' } },
                    el('input', { 
                        type: 'text', value: currentName, id: 'device-name-input',
                        style: { flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }
                    }),
                    el('button', {
                        className: 'btn-primary',
                        style: { padding: '8px 12px', background: '#3b82f6', color: 'white', borderRadius: '4px' },
                        onclick: () => {
                            const newName = document.getElementById('device-name-input').value.trim();
                            if (newName) {
                                localStorage.setItem('device_name', newName);
                                if (syncGateway.peerManager) {
                                    syncGateway.peerManager.deviceName = newName;
                                    syncGateway.peerManager.announce();
                                }
                                Toast.show('裝置名稱已儲存');
                            }
                        }
                    }, '儲存')
                )
            ),

            // Peer ID Display
            el('div', { style: { background: '#f1f5f9', padding: '10px', borderRadius: '6px', marginBottom: '15px' } },
                el('div', { style: { fontSize: '12px', color: '#64748b' } }, '我的 ID (請分享給對方):'),
                el('div', { style: { fontWeight: 'bold', fontFamily: 'monospace', fontSize: '16px', wordBreak: 'break-all' } }, peerId)
            ),

            // Sync Mode Selection
            el('div', { style: { marginBottom: '15px' } },
                el('label', { style: { display: 'block', fontSize: '12px', color: '#666', marginBottom: '5px' } }, '同步模式'),
                el('div', { style: { display: 'flex', gap: '15px' } },
                    el('label', { style: { display: 'flex', alignItems: 'center', cursor: 'pointer' } },
                        el('input', { type: 'radio', name: 'sync-mode', value: 'MERGE', checked: true, style: 'margin-right: 5px;' }),
                        '合併模式 (雙向)'
                    ),
                    el('label', { style: { display: 'flex', alignItems: 'center', cursor: 'pointer' } },
                        el('input', { type: 'radio', name: 'sync-mode', value: 'MIRROR', style: 'margin-right: 5px;' }),
                        '鏡像模式 (單向覆蓋)'
                    )
                )
            ),

            // Connection Methods
            el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                // Method 1: Broadcast
                el('button', { 
                    id: 'btn-scan',
                    className: 'btn-secondary',
                    style: { padding: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', transition: 'all 0.3s' },
                    onclick: (e) => this._handleScan(e.target)
                }, '📡 區域廣播掃描 (Scan)'),
                
                // Method 2: Direct Connect
                el('div', { style: { display: 'flex', gap: '8px' } },
                    el('input', { id: 'target-peer-id', placeholder: '輸入對方 ID 連線...', style: 'flex: 1; padding: 8px; border: 1px solid #ddd; borderRadius: 4px;' }),
                    el('button', { 
                        className: 'btn-primary',
                        style: { padding: '8px 12px', background: '#3b82f6', color: 'white', borderRadius: '4px' },
                        onclick: () => {
                            const target = document.getElementById('target-peer-id').value.trim();
                            if (target) {
                                // 這裡假設 PeerManager 有 connect 方法，若無則需實作
                                // 目前僅示意 UI
                                Toast.show(`嘗試連線至: ${target}`);
                            }
                        }
                    }, '連線')
                )
            )
        );

        // 3. Data Management (Recycle Bin & Integrity)
        const dataSection = el('div', { className: 'settings-section', style: { padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, '資料管理'),
            this._createMenuBtn('♻️ 回收桶 (還原資料)', () => this._showRecycleBin()),
            this._createMenuBtn('🛡️ 檢查資料完整性 (清除幽靈檔案)', () => this._handleIntegrityCheck()),
            
            el('button', { 
                className: 'btn-secondary',
                style: { width: '100%', padding: '12px', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', marginTop: '10px', background: 'white' },
                onclick: () => this._handleFactoryReset()
            }, '🗑️ 原廠重置 (清空所有資料)')
        );

        this.root.innerHTML = '';
        this.root.append(header, container);
        container.append(adminSection, syncSection, dataSection);
    }

    _createMenuBtn(label, handler) {
        return el('button', {
            style: { 
                width: '100%', textAlign: 'left', padding: '12px 0', 
                borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between',
                background: 'none', cursor: 'pointer', fontSize: '16px'
            },
            onclick: handler
        }, label, el('span', { style: { color: '#ccc' } }, '›'));
    }

    // --- Feature: Tag Manager CRUD ---
    async _openTagManager() {
        const tags = await tagManager.getAll();
        const list = el('div', { style: { maxHeight: '300px', overflowY: 'auto', marginBottom: '10px' } });
        
        const renderList = () => {
            list.innerHTML = '';
            tags.forEach(tag => {
                list.appendChild(el('div', { style: { padding: '8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' } },
                    el('span', { style: { color: tag.color, fontWeight: 'bold' } }, tag.name),
                    el('button', { 
                        style: { color: 'red', fontSize: '12px' },
                        onclick: async () => {
                            if(confirm(`確定刪除標籤 "${tag.name}"?`)) {
                                await tagManager.delete(tag.id);
                                tags.splice(tags.indexOf(tag), 1);
                                renderList();
                            }
                        }
                    }, '刪除')
                ));
            });
        };
        renderList();

        const input = el('input', { type: 'text', placeholder: '新標籤名稱', style: 'width: 100%; padding: 8px; margin-bottom: 5px;' });
        const typeSelect = el('select', { style: 'width: 100%; padding: 8px; margin-bottom: 10px;' },
            el('option', { value: 'PERSONAL' }, '個人 (Personal)'),
            el('option', { value: 'HISTORY' }, '病史 (History)'),
            el('option', { value: 'MOVEMENT' }, '動作 (Movement)')
        );

        new Modal('標籤管理', el('div', {}, list, input, typeSelect), async () => {
            if (input.value) {
                await tagManager.saveTagDefinition({
                    name: input.value,
                    type: typeSelect.value,
                    paletteColor: '#3b82f6' 
                });
                Toast.show('標籤已建立');
            }
        }).open();
    }

    // --- Feature: Assessment Editor CRUD ---
    async _openAssessmentEditor() {
        const { StorageKeys } = await import('../config.js');
        const { storageManager } = await import('../core/db.js');

        const meta = await storageManager.get(StorageKeys.META, 'custom_assessments');
        const customAssessments = meta ? meta.data : [];

        const list = el('div', { style: { maxHeight: '250px', overflowY: 'auto', marginBottom: '15px', border: '1px solid #eee', borderRadius: '4px' } });
        
        const renderList = () => {
            list.innerHTML = '';
            if (customAssessments.length === 0) {
                list.innerHTML = '<div style="padding:10px; color:#999; text-align:center;">尚無自訂評估項目</div>';
            }
            customAssessments.forEach((item, index) => {
                list.appendChild(el('div', { style: { padding: '8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                    el('div', {}, 
                        el('div', { style: { fontWeight: 'bold' } }, item.name),
                        el('div', { style: { fontSize: '12px', color: '#666' } }, `${item.region} | +: ${item.positive}`)
                    ),
                    el('button', { 
                        style: { color: 'red', fontSize: '12px' },
                        onclick: async () => {
                            if(confirm(`確定刪除 "${item.name}"?`)) {
                                customAssessments.splice(index, 1);
                                await storageManager.put(StorageKeys.META, { id: 'custom_assessments', data: customAssessments });
                                renderList();
                            }
                        }
                    }, '刪除')
                ));
            });
        };
        renderList();

        const regionSelect = el('select', { style: 'width: 100%; padding: 8px; margin-bottom: 5px;' },
            el('option', { value: 'Shoulder' }, '肩部 (Shoulder)'),
            el('option', { value: 'Knee' }, '膝部 (Knee)'),
            el('option', { value: 'Spine' }, '脊椎 (Spine)'),
            el('option', { value: 'Hip' }, '髖部 (Hip)')
        );
        const nameInput = el('input', { type: 'text', placeholder: '測試名稱 (例: Empty Can)', style: 'width: 100%; padding: 8px; margin-bottom: 5px;' });
        const positiveInput = el('input', { type: 'text', placeholder: '陽性反應 (例: 棘上肌撕裂)', style: 'width: 100%; padding: 8px; margin-bottom: 5px;' });

        new Modal('動作評估編輯', el('div', {}, list, el('hr'), el('h4', {style:'margin:5px 0'}, '新增項目'), regionSelect, nameInput, positiveInput), async () => {
            if (nameInput.value && positiveInput.value) {
                customAssessments.push({
                    id: 'cust_' + Date.now(),
                    region: regionSelect.value,
                    name: nameInput.value,
                    positive: positiveInput.value
                });
                await storageManager.put(StorageKeys.META, { id: 'custom_assessments', data: customAssessments });
                Toast.show('評估項目已儲存');
            }
        }).open();
    }

    // --- Feature: Template Builder CRUD ---
    async _openTemplateBuilder() {
        const titleInput = el('input', { type: 'text', placeholder: '模板標題', style: 'width: 100%; margin-bottom: 10px; padding: 8px;' });
        const sInput = el('textarea', { placeholder: '主訴 (S)', style: 'width: 100%; height: 60px; margin-bottom: 5px;' });
        const oInput = el('textarea', { placeholder: '客觀 (O)', style: 'width: 100%; height: 60px; margin-bottom: 5px;' });
        
        new Modal('新增模板', el('div', {}, titleInput, sInput, oInput), async () => {
            if (!titleInput.value) return;
            const { storageManager } = await import('../core/db.js');
            const { StorageKeys } = await import('../config.js');
            
            await storageManager.put(StorageKeys.TEMPLATES, {
                id: 'tpl_' + Date.now(),
                title: titleInput.value,
                soap: { s: sInput.value, o: oInput.value, a: '', p: '' },
                tags: [],
                bodyParts: []
            });
            Toast.show('模板已儲存');
        }).open();
    }

    // --- Feature: P2P Scan Feedback ---
    _handleScan(btn) {
        console.log('[Settings] Scan button clicked');
        import('../core/sync.js').then(({ syncGateway }) => {
            if (syncGateway.peerManager) {
                const originalText = btn.textContent;
                btn.textContent = '📡 廣播中...';
                btn.style.background = '#e0f2fe';
                btn.style.borderColor = '#3b82f6';
                
                syncGateway.peerManager.announce();
                console.log('[Settings] Announcement sent via PeerManager');
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '#f8fafc';
                    btn.style.borderColor = '#cbd5e1';
                    Toast.show('掃描訊號已發送，等待回應...');
                }, 2000);
            } else {
                console.error('[Settings] SyncGateway not ready');
                Toast.show('同步閘道尚未就緒', 'error');
            }
        });
    }

    // --- Feature: Recycle Bin (Batch Operation) ---
    async _showRecycleBin() {
        const { storageManager } = await import('../core/db.js');
        const { StorageKeys } = await import('../config.js');

        const deletedItems = [];
        const stores = [StorageKeys.CUSTOMERS, StorageKeys.RECORDS];

        await storageManager.runTransaction(stores, 'readonly', async (tx) => {
            for (const storeName of stores) {
                if (tx._rawTx) {
                    const rawReq = tx._rawTx.objectStore(storeName).getAll();
                    const rawItems = await new Promise((resolve, reject) => {
                        rawReq.onsuccess = () => resolve(rawReq.result);
                        rawReq.onerror = () => reject(rawReq.error);
                    });
                    const deleted = rawItems.filter(item => item._deleted);
                    deleted.forEach(item => deletedItems.push({ ...item, _store: storeName, _selected: false }));
                }
            }
        });

        const list = el('div', { style: { maxHeight: '400px', overflowY: 'auto' } });
        
        if (deletedItems.length === 0) {
            list.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">回收桶是空的</div>';
        } else {
            // Header Row
            list.appendChild(el('div', { style: { padding: '10px', borderBottom: '2px solid #eee', fontWeight: 'bold', display: 'flex' } },
                el('div', { style: { width: '30px' } }, '選'),
                el('div', { style: { flex: 1 } }, '項目名稱'),
                el('div', { style: { width: '80px' } }, '刪除日期')
            ));

            deletedItems.forEach(item => {
                const checkbox = el('input', { type: 'checkbox', style: 'margin: 0;' });
                checkbox.onchange = (e) => { item._selected = e.target.checked; };

                const row = el('div', { 
                    style: { padding: '10px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center' } 
                },
                    el('div', { style: { width: '30px' } }, checkbox),
                    el('div', { style: { flex: 1 } }, 
                        el('div', { style: { fontWeight: 'bold' } }, item.name || (item.id ? item.id.slice(0, 8) : 'Unknown')),
                        el('div', { style: { fontSize: '12px', color: '#666' } }, item._store)
                    ),
                    el('div', { style: { width: '80px', fontSize: '12px', color: '#666' } }, new Date(item.updatedAt).toLocaleDateString())
                );
                list.appendChild(row);
            });
        }

        // Batch Actions
        const batchActions = el('div', { style: { display: 'flex', gap: '10px', marginTop: '15px', paddingTop: '10px', borderTop: '1px solid #eee' } },
            el('button', { 
                className: 'btn-primary',
                style: { flex: 1, background: '#22c55e' },
                onclick: async () => {
                    const selected = deletedItems.filter(i => i._selected);
                    if (selected.length === 0) return Toast.show('請先勾選項目');
                    if (confirm(`確定還原 ${selected.length} 個項目?`)) {
                        await this._batchRestore(selected);
                        document.querySelector('.modal-overlay')?.remove();
                        this._showRecycleBin();
                    }
                }
            }, '還原選取'),
            el('button', { 
                className: 'btn-secondary',
                style: { flex: 1, color: '#ef4444', borderColor: '#ef4444' },
                onclick: async () => {
                    const selected = deletedItems.filter(i => i._selected);
                    if (selected.length === 0) return Toast.show('請先勾選項目');
                    if (confirm(`確定永久刪除 ${selected.length} 個項目? 此動作無法復原!`)) {
                        await this._batchHardDelete(selected);
                        document.querySelector('.modal-overlay')?.remove();
                        this._showRecycleBin();
                    }
                }
            }, '永久刪除')
        );

        new Modal('回收桶', el('div', {}, list, batchActions)).open();
    }

    async _batchRestore(items) {
        const { storageManager } = await import('../core/db.js');
        await storageManager.runTransaction(items.map(i => i._store), 'readwrite', async (tx) => {
            for (const item of items) {
                if (tx.restore) await tx.restore(item._store, item);
            }
        });
        Toast.show(`${items.length} 個項目已還原`);
    }

    async _batchHardDelete(items) {
        const { storageManager } = await import('../core/db.js');
        await storageManager.runTransaction(items.map(i => i._store), 'readwrite', async (tx) => {
            for (const item of items) {
                if (tx.hardDelete) await tx.hardDelete(item._store, item.id);
            }
        });
        Toast.show(`${items.length} 個項目已永久刪除`);
    }

    // --- Feature: Data Integrity Check (Ghost Data Cleaner) ---
    async _handleIntegrityCheck() {
        Toast.show('掃描幽靈檔案中...', 'info');
        const report = await searchEngine.checkIntegrity();
        
        if (report.orphanCount === 0) {
            alert('✅ 系統健康，無幽靈檔案。');
        } else {
            const msg = `⚠️ 發現 ${report.orphanCount} 個孤兒紀錄 (幽靈檔案)。\nIDs: ${report.orphanIds.join(', ')}\n\n是否立即清除?`;
            if (confirm(msg)) {
                const { storageManager } = await import('../core/db.js');
                const { StorageKeys } = await import('../config.js');
                
                await storageManager.runTransaction([StorageKeys.RECORDS], 'readwrite', async (tx) => {
                    for (const id of report.orphanIds) {
                        if (tx.hardDelete) {
                            await tx.hardDelete(StorageKeys.RECORDS, id);
                        } else {
                            await tx.delete(StorageKeys.RECORDS, id);
                        }
                    }
                });
                
                Toast.show(`已清除 ${report.orphanCount} 個孤兒紀錄。`, 'success');
                setTimeout(() => window.location.reload(), 1000);
            }
        }
    }

    async _handleFactoryReset() {
        if (confirm('嚴重警告: 您確定要刪除所有資料嗎?')) {
            if (confirm('最終確認: 此動作無法復原!')) {
                try {
                    const { syncGateway } = await import('../core/sync.js');
                    syncGateway.stop();
                    
                    const req = indexedDB.deleteDatabase('LocalFirstDB');
                    
                    req.onsuccess = () => {
                        localStorage.clear();
                        alert('系統重置完成，即將重新載入...');
                        window.location.reload();
                    };
                    req.onerror = () => alert('重置失敗');
                    req.onblocked = () => alert('重置被阻擋: 請關閉其他分頁。');
                } catch (e) {
                    alert('錯誤: ' + e.message);
                }
            }
        }
    }
}// --- Draft List View ---
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
                    
                    // Swipe Left to Delete Logic
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