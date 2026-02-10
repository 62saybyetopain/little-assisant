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
    mount(parent) { 
        parent.appendChild(this.root); 
    }
    unmount() { 
        this.root.remove(); 
    }
    onLeave() {
        if (this.isDirty) {
            return confirm('You have unsaved changes. Leave anyway?');
        }
        return true;
    }
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
        const header = this._renderHeader();

        // 1. 頂部快速數據統計 (Quick Stats)
        this.statsContainer = el('div', { className: 'stats-grid-row' });
        
        // 2. 搜尋列與過濾分頁
        const searchBar = el('input', {
            type: 'text', className: 'search-bar',
            placeholder: '搜尋姓名、電話或標籤...',
            oninput: (e) => this._handleSearch(e.target.value)
        });

        this.filterTab = 'all'; // 預設分頁
        const tabContainer = el('div', { className: 'segmented-control list-filters' },
            el('button', { className: 'segment-btn active', onclick: (e) => this._switchTab('all', e.target) }, '全部'),
            el('button', { className: 'segment-btn', onclick: (e) => this._switchTab('draft', e.target) }, '草稿'),
            el('button', { className: 'segment-btn', onclick: (e) => this._switchTab('active', e.target) }, '追蹤中')
        );

        // 3. 虛擬列表容器
        this.listContainer = el('div', { 
            className: 'virtual-list-container',
            onscroll: () => this._renderVisibleRows()
        });
        this.listSpacer = el('div', { className: 'virtual-list-spacer' });
        this.listContent = el('ul', { className: 'virtual-list-content' });
        this.listContainer.append(this.listSpacer, this.listContent);

        // 4. FAB
        const fab = !storageManager.isEphemeral ? el('button', {
            className: 'fab', onclick: () => this._showCreateModal()
        }, '+') : null;

        this.root.append(header, this.statsContainer, el('div', { style: 'padding:0 16px' }, searchBar, tabContainer), this.listContainer);
        if (fab) this.root.append(fab);

        await this._loadData();
        new ResizeObserver(() => {
            this.viewportHeight = this.listContainer.clientHeight;
            this._renderVisibleRows();
        }).observe(this.listContainer);
    }

    async _loadData() {
        const [allDrafts, allItems] = await Promise.all([
            draftManager.getAll(),
            searchEngine.search('', { limit: 10000, sort: 'updated' })
        ]);
        
        this.draftSet = new Set(allDrafts.map(d => d.relatedId));
        this.rawItems = allItems;
        this._updateStats(allDrafts.length);
        this._applyFilter();
    }

    _updateStats(draftCount) {
        const todayStr = new Date().toISOString().split('T')[0];
        const todayVisits = this.rawItems.filter(i => i.lv && i.lv.startsWith(todayStr)).length;

        this.statsContainer.innerHTML = '';
        this.statsContainer.append(
            el('div', { className: 'stat-card' }, el('small', {}, '今日就診'), el('div', { className: 'val' }, todayVisits)),
            el('div', { className: 'stat-card' }, el('small', {}, '待定稿'), el('div', { className: 'val', style: 'color:var(--warning)' }, draftCount)),
            el('div', { className: 'stat-card' }, el('small', {}, '總病患'), el('div', { className: 'val' }, this.rawItems.length))
        );
    }

    _switchTab(tab, btn) {
        this.filterTab = tab;
        btn.parentElement.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._applyFilter();
    }

    _applyFilter() {
        const query = this.root.querySelector('.search-bar').value;
        let base = searchEngine.search(query, { limit: 10000, sort: 'relevance' });

        if (this.filterTab === 'draft') {
            base = base.filter(i => this.draftSet.has(i.id));
        } else if (this.filterTab === 'active') {
            base = base.filter(i => i.t && (i.t.includes('追蹤中') || i.t.includes('重要')));
        }

        this.items = base;
        this._updateListHeight();
        this._renderVisibleRows();
    }
    _renderHeader() {
        this.statusEl = el('span', { style: { fontSize: '12px', marginRight: '10px' } }, '正在連線...');
        this.settingsBtn = el('button', { className: 'icon-btn', style: { fontSize: '18px' } }, '⚙️');
        
        // 延遲載入同步狀態，避免阻塞 UI
        import('../core/sync.js').then(({ syncGateway }) => {
            if (!this.statusEl) return;
            const peerId = syncGateway.peerManager ? syncGateway.peerManager.myId.slice(0, 4) : 'OFF';
            this.statusEl.textContent = `ID: ${peerId}`;
            this.settingsBtn.onclick = () => this.router.navigate('settings');
        });

        return el('div', { className: 'nav-header sticky-top' }, 
            el('b', { className: 'nav-title' }, 'LocalFirst EMR'),
            el('div', { style: 'display:flex; align-items:center' }, this.statusEl, this.settingsBtn)
        );
    }

    _handleSearch(query) {
        this._applyFilter();
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

            //  長按偵測變數 (Closure scope)
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
        if (!customer) return this.root.innerHTML = 'Customer not found';

        const records = await recordManager.getByCustomer(this.customerId);
        
        // 1. 計算統計指標
        const totalVisits = records.length;
        const avgPain = records.length ? (records.reduce((sum, r) => sum + (r.painScale || 0), 0) / records.length).toFixed(1) : 'N/A';
        const lastDate = records.length ? new Date(records[0].updatedAt).toLocaleDateString() : '無記錄';

        // 2. 佈局組裝
        this.root.innerHTML = '';
        this.root.className = 'view-container bg-soft';

        const header = el('div', { className: 'nav-header sticky-top' },
            el('button', { className: 'icon-btn', onclick: () => this.router.back() }, '←'),
            el('div', { className: 'nav-title' }, customer.name),
            el('button', { className: 'icon-btn', onclick: () => this._editCustomer(customer) }, '✎')
        );

        const statsSection = el('div', { className: 'detail-stats-card' },
            el('div', { className: 'stat-item' }, el('label', {}, '總診次'), el('b', {}, totalVisits)),
            el('div', { className: 'stat-item' }, el('label', {}, '平均疼痛'), el('b', {}, avgPain)),
            el('div', { className: 'stat-item' }, el('label', {}, '上次就診'), el('b', {}, lastDate))
        );

        const actionArea = el('div', { style: 'padding:0 16px 16px' },
            el('button', { 
                className: 'btn-primary w-100 shadow-sm',
                onclick: () => this.router.navigate(`record/new?customerId=${this.customerId}`) 
            }, '＋ 新增診療病歷')
        );

        const historyList = el('div', { className: 'history-timeline' });
        records.forEach(rec => {
            const isFinal = rec.status === RecordStatus.FINALIZED;
            const card = el('div', { 
                className: `timeline-card ${isFinal ? 'border-success' : 'border-warning'}`,
                onclick: () => this.router.navigate(`record/${rec.id}`)
            },
                el('div', { className: 'card-header' },
                    el('span', { className: 'date' }, new Date(rec.updatedAt).toLocaleDateString()),
                    el('span', { className: `badge ${isFinal ? 'bg-success' : 'bg-warning'}` }, rec.status)
                ),
                el('div', { className: 'card-body' }, 
                    el('p', {}, rec.soap?.a || '無評估摘要'),
                    el('div', { className: 'card-tags' }, ...(rec.tags || []).slice(0, 3).map(t => el('small', {}, `#${t}`)))
                )
            );
            historyList.appendChild(card);
        });

        this.root.append(header, statsSection, actionArea, historyList);
    }

    _editCustomer(customer) {
    const containerId = 'edit-tag-selector-container';
    
    // 1. 構建多層次的表單結構 (優化間距與結構)
    const form = el('div', { className: 'rich-form' },
        // A. 基本身份與聯絡
        el('section', { className: 'form-section' },
            el('h4', { className: 'section-title' }, '基本身份'),
            el('div', { className: 'form-grid' },
                this._createInputField('姓名 *', 'text', 'edit-name', customer.name),
                this._createInputField('電話', 'tel', 'edit-phone', customer.phone)
            ),
            el('div', { className: 'form-grid mt-2' },
                this._createInputField('LINE ID', 'text', 'edit-line', customer.info?.lineId || ''),
                this._createInputField('電子郵件', 'email', 'edit-email', customer.info?.email || '')
            )
        ),

        // B. 生活脈絡 (職業與興趣)
        el('section', { className: 'form-section mt-4' },
            el('h4', { className: 'section-title' }, '生活脈絡'),
            el('div', { className: 'form-grid' },
                this._createInputField('職業 (如: 工程師, 廚師)', 'text', 'edit-job', customer.info?.occupation || ''),
                this._createInputField('運動/興趣 (如: 馬拉松, 鋼琴)', 'text', 'edit-hobby', customer.info?.interests || '')
            )
        ),

        // C. 臨床背景 (優化載入區塊)
        el('section', { className: 'form-section mt-4' },
            el('h4', { className: 'section-title' }, '臨床背景 (病史與標籤)'),
            // 加入 ID 導向的容器，並提供 loading 狀態
            el('div', { 
                id: containerId, 
                className: 'mt-2',
                style: 'min-height: 80px; display: flex; align-items: center; justify-content: center; color: var(--text-muted);' 
            }, '⏳ 正在載入標籤系統...')
        ),

        // D. 備註
        el('section', { className: 'form-section mt-4' },
            el('h4', { className: 'section-title' }, '備註事項'),
            el('textarea', { 
                id: 'edit-note', 
                className: 'soap-textarea', 
                placeholder: '其他需要注意的細節...',
                style: 'height: 80px;'
            }, customer.note || '')
        )
    );

    // 2. 彈出 Modal (先開啟彈窗，提升反應速度)
    let selectedTags = [...(customer.tags || [])];
    const modal = new Modal('編輯顧客檔案', form, async () => {
        const updatedData = {
            name: form.querySelector('#edit-name').value,
            phone: form.querySelector('#edit-phone').value,
            tags: selectedTags,
            note: form.querySelector('#edit-note').value,
            info: {
                lineId: form.querySelector('#edit-line').value,
                email: form.querySelector('#edit-email').value,
                occupation: form.querySelector('#edit-job').value,
                interests: form.querySelector('#edit-hobby').value
            }
        };

        if (!updatedData.name) return Toast.show('姓名為必填', 'error');

        try {
            await customerManager.update(customer.id, updatedData);
            Toast.show('檔案已更新');
            this.render(); 
        } catch (e) {
            Toast.show('更新失敗: ' + e.message, 'error');
        }
    });

    modal.open();

    // 3. 非同步初始化標籤選擇器 (優化錯誤處理與引用)
    // 注意：這裡只從 components.js 拿 TagSelector，數據則使用頂部 import 的 tagManager
    import('./components.js').then(async ({ TagSelector }) => {
        try {
            // 使用 views.js 頂部 import 的 tagManager 單例
            const allTags = await tagManager.getAll(); 
            const container = form.querySelector(`#${containerId}`);
            
            if (!container) return; // 防止快速關閉彈窗導致的容器遺失
            
            container.innerHTML = ''; // 清除 Loading 字樣
            container.style.display = 'block'; // 恢復正常佈局
            
            const tagSelector = new TagSelector(selectedTags, allTags, (newTags) => {
                selectedTags = newTags;
            });
            container.appendChild(tagSelector.element);
        } catch (e) {
            console.error('TagSelector載入失敗:', e);
            const container = form.querySelector(`#${containerId}`);
            if (container) container.textContent = '❌ 標籤系統加載失敗';
        }
    }).catch(err => {
        console.error('模組載入失敗:', err);
    });
}

    // 輔助函式：建立美觀的輸入框組
    _createInputField(label, type, id, value) {
        return el('div', { className: 'input-group' },
            el('label', { for: id, className: 'input-label' }, label),
            el('input', { 
                type: type, 
                id: id, 
                value: value, 
                className: 'search-bar', // 複用 search-bar 的樣式
                style: 'margin-top: 4px;'
            })
        );
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
        
        //  初始化實例屬性，避免 undefined
        this.bodyMap = null;
        this.tagSelector = null;
        this.assessmentContainer = null;

        this.render();
    }

    // 智慧建議強化：根據 Anatomy 標籤推薦測試
    _updateAssessmentSuggestions(selectedParts) {
        if (!this.assessmentContainer) return;
        import('../config.js').then(({ AssessmentDatabase, BodyRegions }) => {
            const suggestions = new Set();
            
            // 除了 BodyMap，也檢查已選取的 Tags
            const currentTags = this.data.tags || [];
            
            selectedParts.forEach(partId => {
                // 模糊比對部位 (例如 'Shoulder-R' 匹配 'Shoulder')
                const regionKey = Object.keys(AssessmentDatabase).find(k => partId.includes(k));
                if (regionKey) AssessmentDatabase[regionKey].forEach(t => suggestions.add(t));
            });

            // 針對 Anatomy 標籤進行額外推薦
            currentTags.forEach(tag => {
                const match = Object.keys(AssessmentDatabase).find(k => tag.includes(k));
                if (match) AssessmentDatabase[match].forEach(t => suggestions.add(t));
            });

            this.assessmentContainer.innerHTML = '';
            if (suggestions.size > 0) {
                this.assessmentContainer.style.display = 'block';
                const list = el('div', { className: 'suggestion-chips' });
                suggestions.forEach(test => {
                    list.appendChild(el('button', { 
                        className: 'chip-btn',
                        onclick: () => this._addAssessmentResult(test)
                    }, test.name));
                });
                this.assessmentContainer.append(el('h5', {}, '💡 建議評估項目'), list);
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
        // 1. 資料載入與初始化邏輯
        if (this.recordId) {
            this.data = await recordManager.get(this.recordId);
        } else if (this.customerId) {
            const draft = await draftManager.get(this.customerId);
            if (draft) {
                this.data = { ...draft.data, customerId: this.customerId };
                Toast.show('已恢復草稿內容');
            } else {
                this.data = await recordManager.create(this.customerId);
            }
            this.recordId = this.data.id;
        }

        if (!this.data) {
            this.root.innerHTML = '<div class="p-4">載入病歷失敗</div>';
            return;
        }

        // 確保核心數據結構完整
        this.data.soap = this.data.soap || { s: '', o: '', a: '', p: '' };
        this.data.tags = this.data.tags || [];
        this.data.bodyParts = this.data.bodyParts || [];
        this.data.rom = this.data.rom || {};
        
        const allTags = await tagManager.getAll();

        // --- UI 建構階段 ---

        // 必須在初始化 BodyMap 之前，先建立此容器實體
        // 這樣 BodyMap 觸發 _updateAssessmentSuggestions 時，this.assessmentContainer 才不是 null
        this.assessmentContainer = el('div', { className: 'assessment-suggestions-box', style: 'margin-bottom: 15px;' });

        // 1. 導航標頭
        const header = el('div', { className: 'nav-header' },
            el('button', { className: 'icon-btn', onclick: () => this.router.back() }, '←'),
            el('div', { className: 'nav-title' }, this.recordId ? '編輯病歷' : '新增病歷'),
            el('span', { className: `badge ${this.data.status === 'Finalized' ? 'bg-success' : 'bg-warning'}` }, this.data.status || 'Draft')
        );

        // 初始化互動組件
        this.tagSelector = new TagSelector(this.data.tags, allTags, (newTags) => {
            this.data.tags = newTags;
            this._markDirty();
        });

        this.bodyMap = new BodyMap(this.data.bodyParts, (parts) => {
            this.data.bodyParts = parts;
            // 每次 BodyMap 變更，同步更新標籤選取器並觸發評估建議
            if (this.tagSelector) {
                parts.forEach(p => this.tagSelector._addTag(p));
            }
            this._markDirty();
            this._updateAssessmentSuggestions(parts); 
        }, this.data.status === 'Finalized');

        // 2. 頁籤導航
        const tabs = [
            { id: 'tab-s', label: 'S (主訴)' },
            { id: 'tab-o', label: 'O (客觀)' },
            { id: 'tab-a', label: 'A (評估)' },
            { id: 'tab-p', label: 'P (計畫)' }
        ];

        const navBar = el('div', { className: 'tab-nav' });
        const contentContainer = el('div', { className: 'tab-content-wrapper' });

        // 3. 建立各分頁面板
        // Tab S
        const tabS = this._createTabPane('tab-s', 'Subjective (主訴)', 's', '請輸入病患主訴...');
        tabS.appendChild(el('div', { className: 'mt-3' }, el('h5', {}, '症狀標籤'), this.tagSelector.element));

        // Tab O (包含 BodyMap 與 ROM)
        const tabO = el('div', { id: 'tab-o', className: 'tab-pane', style: 'display:none' });
        tabO.append(
            el('h5', {}, '患處標記 (Body Map)'),
            this.bodyMap.element,
            el('h5', { className: 'mt-3' }, '活動度量測 (ROM)'),
            this._renderROMInputs(),
            el('h5', { className: 'mt-3' }, '檢查筆記'),
            el('textarea', {
                className: 'soap-textarea',
                value: this.data.soap.o,
                oninput: (e) => { this.data.soap.o = e.target.value; this._markDirty(); },
                disabled: this.data.status === 'Finalized'
            })
        );

        // Tab A (包含建議評估區塊)
        const tabA = this._createTabPane('tab-a', 'Assessment (評估)', 'a', '請輸入評估結果...');
        tabA.prepend(this.assessmentContainer); // 將預先建立好的容器插入 A 欄位頂部

        // Tab P
        const tabP = this._createTabPane('tab-p', 'Plan (計畫)', 'p', '請輸入後續計畫...');

        contentContainer.append(tabS, tabO, tabA, tabP);

        // 綁定頁籤切換事件
        tabs.forEach(t => {
            const btn = el('button', { 
                className: `tab-btn ${this.currentTab === t.id ? 'active' : ''}`,
                onclick: () => this._switchTab(t.id, contentContainer, navBar)
            }, t.label);
            navBar.appendChild(btn);
        });

        // 4. 底部操作列
        const actions = el('div', { className: 'editor-actions' });
        if (this.data.status !== 'Finalized') {
            actions.append(
                el('button', { className: 'btn-secondary', onclick: () => this._showTemplateModal() }, '📋 範本'),
                el('button', { className: 'btn-secondary', onclick: () => this._save('Draft') }, '儲存草稿'),
                el('button', { className: 'btn-primary', onclick: () => this._handleFinalize() }, '完成定稿')
            );
        }

        // 初始狀態設定
        this.root.innerHTML = '';
        this.root.append(header, navBar, contentContainer, actions);
        this._switchTab(this.currentTab, contentContainer, navBar);
        
        // 手動觸發一次初始建議更新，確保進入頁面時若已有標記則顯示建議
        this._updateAssessmentSuggestions(this.data.bodyParts);
    }

    //  ROM 輸入介面產生器
    _renderROMInputs() {
        const container = el('div', { className: 'rom-dynamic-list' });
        import('../config.js').then(({ StandardROM }) => {
            const selectedParts = this.data.bodyParts || [];
            if (selectedParts.length === 0) {
                container.innerHTML = '<p class="text-muted">請先在 Body Map 標記部位以顯示 ROM 項目</p>';
                return;
            }

            // 找出與選取部位相關的 ROM 項目
            const relevantROMs = StandardROM.filter(rom => 
                selectedParts.some(part => rom.id.includes(part.split('-')[0].toLowerCase()))
            );

            relevantROMs.forEach(romDef => {
                const sides = romDef.sideType === 'lr' ? ['L', 'R'] : (romDef.sideType === 'rot' ? ['Left', 'Right'] : ['']);
                
                sides.forEach(side => {
                    const fullId = side ? `${romDef.id}_${side.toLowerCase()}` : romDef.id;
                    const label = side ? `(${side}) ${romDef.label}` : romDef.label;
                    
                    const slider = new ROMSlider({
                        id: fullId,
                        label: label,
                        min: romDef.min,
                        max: romDef.max,
                        norm: romDef.norm,
                        value: this.data.rom?.[fullId] || 0,
                        onChange: (val) => {
                            if (!this.data.rom) this.data.rom = {};
                            this.data.rom[fullId] = val;
                            this._markDirty();
                        }
                    });
                    container.appendChild(slider.element);
                });
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
            // [防彈佈局] 處理虛擬鍵盤彈出時的視窗對齊
            onfocus: (e) => {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
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
        Array.from(navBar.children).forEach(btn => {
            btn.classList.toggle('active', btn.textContent.includes(this._getTabLabel(tabId)));
        });
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
                content: this.data.content,
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
                    placeholder: '請輸入版本變更原因',
                    style: { width: '100%', height: '60px', padding: '8px' }
                })
            )
        );
        content.querySelectorAll('input[name="v-strategy"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const reasonBox = content.querySelector('#reason-container');
                if (e.target.value === 'MAJOR') {
                    reasonBox.style.display = 'block';
                } else {
                    reasonBox.style.display = 'none';
                }
            });
        });
        new Modal('Finalize Record', content, () => {
            const strategy = content.querySelector('input[name="v-strategy"]:checked').value;
            const reason = content.querySelector('#change-reason').value;
            this._save(RecordStatus.FINALIZED, { versionStrategy: strategy, changeReason: reason });
        }).open();
    }

    _createRadio(value, label, checked) {
        const wrapper = el('label', { style: { display: 'flex', alignItems: 'center', cursor: 'pointer' } });
        const input = el('input', { type: 'radio', name: 'v-strategy', value: value, checked: checked });
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
                        modal.close();
                    }
                }, 
                    el('div', { style: { fontWeight: 'bold' } }, tpl.title),
                    el('div', { style: { fontSize: '12px', color: '#666' } }, tpl.description || '')
                );
                list.appendChild(btn);
            });
            const modal = new Modal('Select Template', list);
            modal.open();
        });
    }

    async _applyTemplate(template) {
        const { templateManager } = await import('../modules/record.js');
        const hasContent = (this.data.soap?.s || this.data.soap?.o || this.data.soap?.a || this.data.soap?.p);
        let strategy = 'Append';

        if (hasContent) {
            if (confirm(`目前紀錄已有內容。\n點擊「確定」進行疊加 (Append)。\n點擊「取消」進行覆蓋 (Override)。`)) {
                strategy = 'Append';
            } else {
                strategy = 'Override';
            }
        }

        // [備份機制] 套用前先存快照
        const backupId = `${this.recordId || this.customerId}_backup`;
        await draftManager.save(backupId, JSON.parse(JSON.stringify(this.data)));

        const mergedRecord = templateManager.merge(this.data, template, strategy);
        this.data.soap = mergedRecord.soap;
        this.data.tags = mergedRecord.tags;
        this.data.bodyParts = mergedRecord.bodyParts;
        this.data.rom = mergedRecord.rom;

        // 更新 UI 內容
        ['s', 'o', 'a', 'p'].forEach(key => {
            const textarea = this.root.querySelector(`#tab-${key} textarea`);
            if (textarea) textarea.value = this.data.soap[key] || '';
        });

        if (this.tagSelector) {
            this.tagSelector.selected = new Set(this.data.tags);
            this.tagSelector.render();
        }

        if (this.bodyMap) {
            this.bodyMap.updateSelection(this.data.bodyParts);
        }

        this._markDirty();
        this._updateAssessmentSuggestions(this.data.bodyParts); 
        
        // 顯示通知與撤銷入口
        import('./components.js').then(({ Toast, el }) => {
            Toast.show(`已套用模板: ${template.title}`, 'success');
            const undoBtn = el('button', {
                style: { marginLeft: '12px', color: '#fff', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px' },
                onclick: async (e) => {
                    e.preventDefault();
                    const backup = await draftManager.get(backupId);
                    if (backup) {
                        this.data = backup.data;
                        await this.render(); 
                        Toast.show('已還原至套用前狀態', 'info');
                    }
                }
            }, '撤銷');
            const lastToast = document.querySelector('.toast-container .toast:last-child');
            if (lastToast) lastToast.appendChild(undoBtn);
        });
    }

    /**
     * [輔助方法] 更新評估建議清單
     */
    _updateAssessmentSuggestions(bodyParts) {
        const suggestionContainer = this.root.querySelector('.assessment-suggestions');
        if (!suggestionContainer) return;

        suggestionContainer.innerHTML = '';
        
        const allSuggestions = (bodyParts || []).flatMap(partId => {
            const region = Object.keys(BodyRegions).find(r => BodyRegions[r].parts.includes(partId));
            return region ? (AssessmentDatabase[region] || []) : [];
        });

        [...new Set(allSuggestions)].forEach(s => {
            const badge = el('span', { 
                className: 'suggestion-badge',
                onclick: () => {
                    const aText = this.root.querySelector('#tab-a textarea');
                    if (aText) {
                        const separator = aText.value ? '\n' : '';
                        aText.value += `${separator}[建議測試] ${s}: `;
                        aText.dispatchEvent(new Event('input'));
                    }
                }
            }, s);
            suggestionContainer.appendChild(badge);
        });
    }

    onLeave() {
        if (this.isDirty) {
            return confirm('您有未儲存的變動，確定要離開嗎？');
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
            el('h2', { style: 'margin: 0; font-size: 18px;' }, 'System Settings')
        );

        // 1. System Management (CRUD Interfaces)
        const adminSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, 'System Management'),
            this._createMenuBtn('🏷️ Tag Management', () => this._openTagManager()),
            this._createMenuBtn('💪 Assessment Editor', () => this._openAssessmentEditor()),
            this._createMenuBtn('📋 Template Builder', () => this._openTemplateBuilder())
        );

        // 2. P2P Synchronization
        const peerId = syncGateway.peerManager ? syncGateway.peerManager.myId : 'OFFLINE';
        const currentName = localStorage.getItem('device_name') || `Device-${peerId.slice(0, 4)}`;

        const syncSection = el('div', { className: 'settings-section', style: { marginBottom: '20px', padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, 'P2P Synchronization'),
            
            // Device Name
            el('div', { style: { marginBottom: '15px' } },
                el('label', { style: { display: 'block', fontSize: '12px', color: '#666', marginBottom: '5px' } }, 'Device Name'),
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
                                Toast.show('Device name saved');
                            }
                        }
                    }, 'Save')
                )
            ),

            // Peer ID Display
            el('div', { style: { background: '#f1f5f9', padding: '10px', borderRadius: '6px', marginBottom: '15px' } },
                el('div', { style: { fontSize: '12px', color: '#64748b' } }, 'MY PEER ID (Share this):'),
                el('div', { style: { fontWeight: 'bold', fontFamily: 'monospace', fontSize: '16px', wordBreak: 'break-all' } }, peerId)
            ),

            // Scan / Connect
            el('div', { style: { display: 'flex', gap: '8px' } },
                el('button', { 
                    id: 'btn-scan',
                    className: 'btn-secondary',
                    style: { flex: 1, padding: '10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px', transition: 'all 0.3s' },
                    onclick: (e) => this._handleScan(e.target)
                }, '📡 Scan / Broadcast'),
            )
        );

        // 3. Data Management (Recycle Bin & Integrity)
        const dataSection = el('div', { className: 'settings-section', style: { padding: '15px', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' } },
            el('h3', { style: 'margin-top: 0; color: #333;' }, 'Data Management'),
            this._createMenuBtn('♻️ Recycle Bin (Restore Data)', () => this._showRecycleBin()),
            this._createMenuBtn('🛡️ Check Data Integrity (Fix Orphans)', () => this._handleIntegrityCheck()),
            
            el('button', { 
                className: 'btn-secondary',
                style: { width: '100%', padding: '12px', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', marginTop: '10px', background: 'white' },
                onclick: () => this._handleFactoryReset()
            }, '🗑️ Factory Reset (Clear All)')
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

    // 標籤管理：支援解剖類別與合併功能
    async _openTagManager() {
        const tags = await tagManager.getAll();
        const list = el('div', { className: 'manager-list' });
        
        const renderList = () => {
            list.innerHTML = '';
            tags.forEach(tag => {
                list.appendChild(el('div', { className: 'manager-item' },
                    el('span', { style: `color:${tag.color}; font-weight:bold` }, `[${tag.type || 'P'}] ${tag.name}`),
                    el('div', {},
                        el('button', { className: 'text-primary mr-2', onclick: () => this._handleTagMerge(tag, tags) }, '合併'),
                        el('button', { className: 'text-danger', onclick: () => this._handleTagDelete(tag) }, '刪除')
                    )
                ));
            });
        };

        const form = el('div', {},
            list,
            el('h4', { className: 'mt-3' }, '新增標籤'),
            el('input', { id: 'new-tag-name', placeholder: '名稱', className: 'w-100 p-2' }),
            el('select', { id: 'new-tag-type', className: 'w-100 p-2 mt-1' },
                el('option', { value: 'PERSONAL' }, '一般標籤'),
                el('option', { value: 'ANATOMY' }, '解剖標籤 (自動配色)')
            )
        );

        new Modal('標籤管理中心', form, async () => {
            const name = form.querySelector('#new-tag-name').value;
            const type = form.querySelector('#new-tag-type').value;
            if (name) {
                await tagManager.saveTagDefinition({ name, type });
                Toast.show('標籤已建立');
            }
        }).open();
        renderList();
    }

    // --- Feature: Assessment Editor CRUD ---
    // 動作評估編輯器：從 BodyRegions 動態讀取
    async _openAssessmentEditor() {
        const { BodyRegions, StorageKeys } = await import('../config.js');
        const meta = await storageManager.get(StorageKeys.META, 'custom_assessments');
        const assessments = meta ? meta.data : [];

        const form = el('div', {},
            el('select', { id: 'ast-region', className: 'w-100 p-2' },
                ...Object.values(BodyRegions).map(r => el('option', { value: r.label }, r.label))
            ),
            el('input', { id: 'ast-name', placeholder: '測試名稱 (如: Lachman Test)', className: 'w-100 p-2 mt-1' }),
            el('input', { id: 'ast-pos', placeholder: '陽性意義 (如: ACL 斷裂)', className: 'w-100 p-2 mt-1' })
        );

        new Modal('新增自訂評估', form, async () => {
            const name = form.querySelector('#ast-name').value;
            if (name) {
                assessments.push({
                    region: form.querySelector('#ast-region').value,
                    name: name,
                    positive: form.querySelector('#ast-pos').value
                });
                await storageManager.put(StorageKeys.META, { id: 'custom_assessments', data: assessments });
                Toast.show('評估項目已儲存');
            }
        }).open();
    }

    // 模板建構器：支援完整 SOAP 與 ROM
    async _openTemplateBuilder() {
        const form = el('div', { className: 'template-builder-form' },
            el('input', { id: 'tpl-title', placeholder: '模板名稱 (如: 五十肩初診)', className: 'w-100 p-2' }),
            el('textarea', { id: 'tpl-s', placeholder: 'S (主訴預設)', className: 'w-100 mt-1' }),
            el('textarea', { id: 'tpl-o', placeholder: 'O (客觀預設)', className: 'w-100 mt-1' }),
            el('textarea', { id: 'tpl-a', placeholder: 'A (評估預設)', className: 'w-100 mt-1' }),
            el('p', { className: 'mt-2 mb-0' }, '預設標籤 (逗號隔開):'),
            el('input', { id: 'tpl-tags', placeholder: 'FrozenShoulder, ROM受限', className: 'w-100 p-2' })
        );

        new Modal('進階模板編輯器', form, async () => {
            const title = form.querySelector('#tpl-title').value;
            if (!title) return;
            const payload = {
                id: 'tpl_' + Date.now(),
                title,
                soap: {
                    s: form.querySelector('#tpl-s').value,
                    o: form.querySelector('#tpl-o').value,
                    a: form.querySelector('#tpl-a').value,
                    p: ''
                },
                tags: form.querySelector('#tpl-tags').value.split(',').map(t => t.trim()).filter(Boolean)
            };
            await storageManager.put(StorageKeys.TEMPLATES, payload);
            Toast.show('模板建置完成');
        }).open();
    }

    // --- Feature: P2P Scan Feedback ---
    _handleScan(btn) {
        console.log('[Settings] Scan button clicked');
        import('../core/sync.js').then(({ syncGateway }) => {
            if (syncGateway.peerManager) {
                // Visual Feedback
                const originalText = btn.textContent;
                btn.textContent = '📡 Broadcasting...';
                btn.style.background = '#e0f2fe';
                btn.style.borderColor = '#3b82f6';
                
                syncGateway.peerManager.announce();
                console.log('[Settings] Announcement sent via PeerManager');
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '#f8fafc';
                    btn.style.borderColor = '#cbd5e1';
                    Toast.show('Scan signal sent. Waiting for peers...');
                }, 2000);
            } else {
                console.error('[Settings] SyncGateway not ready');
                Toast.show('Sync Gateway not ready', 'error');
            }
        });
    }

    // --- Feature: Recycle Bin (Fixed with _rawTx) ---
    async _showRecycleBin() {
        const { storageManager } = await import('../core/db.js');
        const { StorageKeys } = await import('../config.js');

        const deletedItems = [];
        const stores = [StorageKeys.CUSTOMERS, StorageKeys.RECORDS];

        await storageManager.runTransaction(stores, 'readonly', async (tx) => {
            for (const storeName of stores) {
                //  使用 _rawTx 存取底層 IDB 以獲取包含 _deleted 的資料
                if (tx._rawTx) {
                    const rawReq = tx._rawTx.objectStore(storeName).getAll();
                    const rawItems = await new Promise((resolve, reject) => {
                        rawReq.onsuccess = () => resolve(rawReq.result);
                        rawReq.onerror = () => reject(rawReq.error);
                    });
                    const deleted = rawItems.filter(item => item._deleted);
                    deleted.forEach(item => deletedItems.push({ ...item, _store: storeName }));
                }
            }
        });

        const list = el('div', { style: { maxHeight: '400px', overflowY: 'auto' } });
        
        if (deletedItems.length === 0) {
            list.innerHTML = '<div style="padding:20px; text-align:center; color:#888;">Recycle Bin is empty.</div>';
        } else {
            deletedItems.forEach(item => {
                const row = el('div', { 
                    style: { padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } 
                },
                    el('div', {}, 
                        el('div', { style: { fontWeight: 'bold' } }, item.name || (item.id ? item.id.slice(0, 8) : 'Unknown')),
                        el('div', { style: { fontSize: '12px', color: '#666' } }, `${item._store} | Deleted: ${new Date(item.updatedAt).toLocaleDateString()}`)
                    ),
                    el('div', { style: { display: 'flex', gap: '5px' } },
                        el('button', { 
                            style: { padding: '4px 8px', background: '#22c55e', color: 'white', borderRadius: '4px', fontSize: '12px' },
                            onclick: () => this._handleRestore(item)
                        }, 'Restore'),
                        el('button', { 
                            style: { padding: '4px 8px', background: '#ef4444', color: 'white', borderRadius: '4px', fontSize: '12px' },
                            onclick: () => this._handleHardDelete(item)
                        }, 'Del')
                    )
                );
                list.appendChild(row);
            });
        }

        new Modal('Recycle Bin', list).open();
    }

    async _handleRestore(item) {
        const { storageManager } = await import('../core/db.js');
        if (confirm(`Restore "${item.name || item.id}"?`)) {
            await storageManager.runTransaction([item._store], 'readwrite', async (tx) => {
                // 使用 db.js 新增的 restore 方法
                if (tx.restore) {
                    await tx.restore(item._store, item);
                }
            });
            Toast.show('Item restored');
            document.querySelector('.modal-overlay')?.remove();
            this._showRecycleBin();
        }
    }

    async _handleHardDelete(item) {
        const { storageManager } = await import('../core/db.js');
        if (confirm(`Permanently delete? This cannot be undone.`)) {
            await storageManager.runTransaction([item._store], 'readwrite', async (tx) => {
                // 使用 db.js 新增的 hardDelete 方法
                if (tx.hardDelete) {
                    await tx.hardDelete(item._store, item.id);
                }
            });
            Toast.show('Item permanently deleted');
            document.querySelector('.modal-overlay')?.remove();
            this._showRecycleBin();
        }
    }

    // --- Feature: Data Integrity Check (Ghost Data Cleaner) ---
    async _handleIntegrityCheck() {
        Toast.show('Scanning for orphans...', 'info');
        const report = await searchEngine.checkIntegrity();
        
        if (report.orphanCount === 0) {
            alert('✅ System Healthy. No ghost data found.');
        } else {
            const msg = `⚠️ Found ${report.orphanCount} orphan records (Ghost Data).\nIDs: ${report.orphanIds.join(', ')}\n\nClean them up?`;
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
                
                Toast.show(`Cleaned ${report.orphanCount} orphans.`, 'success');
                setTimeout(() => window.location.reload(), 1000);
            }
        }
    }

    async _handleFactoryReset() {
        if (confirm('CRITICAL WARNING: Are you sure you want to delete ALL data?')) {
            if (confirm('Final Confirmation: This action is irreversible.')) {
                try {
                    const { syncGateway } = await import('../core/sync.js');
                    syncGateway.stop();
                    
                    const req = indexedDB.deleteDatabase('LocalFirstDB');
                    
                    req.onsuccess = () => {
                        //  Clear LocalStorage to remove Ghost Index
                        localStorage.clear();
                        
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
