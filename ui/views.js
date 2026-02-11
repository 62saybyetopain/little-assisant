/**
 * src/ui/views.js
 * 頁面視圖邏輯
 * 
 * @description 包含 CustomerList, CustomerDetail, RecordEditor 三大核心視圖。
 * 實作 Virtual Scroll 與 髒檢查機制。
 */

import { el, Toast, TagSelector, BodyMap, Modal, ROMSlider } from './components.js';
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
            el('button', { className: 'segment-btn', onclick: (e) => this._switchTab(RecordStatus.DRAFT.toLowerCase(), e.target) }, '草稿'),
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
        const query = this.root.querySelector('.search-bar')?.value || '';
        const [allDrafts, allItems] = await Promise.all([
            draftManager.getAll(),
            searchEngine.search(query, { limit: 10000, sort: 'updated' })
        ]);
        
        this.draftSet = new Set(allDrafts.map(d => d.relatedId));
        this.rawItems = allItems;
        this._updateStats(allDrafts.length);
        await this._applyFilter(); // 確保 filter 內部非同步完成
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

    async _applyFilter() {
        const query = this.root.querySelector('.search-bar')?.value || '';
        
        try {
            // 確保真正獲取到搜尋結果陣列
            let base = await searchEngine.search(query, { limit: 10000, sort: 'relevance' });

            if (this.filterTab === RecordStatus.DRAFT.toLowerCase()) {
                base = base.filter(i => this.draftSet.has(i.id));
            } else if (this.filterTab === 'active') {
                base = base.filter(i => i.t && (i.t.includes('追蹤中') || i.t.includes('重要')));
            }

            this.items = base;
            this._updateListHeight();
            this._renderVisibleRows();
        } catch (error) {
            console.error('Filter Error:', error);
            import('./components.js').then(({ Toast }) => Toast.show('搜尋過濾發生錯誤', 'error'));
        }
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
     * 呼叫共用元件 ActionSheet
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
     * 刪除顧客處理邏輯
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
    const feedback = el('div', { 
        style: { color: 'var(--warning)', fontSize: '12px', minHeight: '16px', marginTop: '8px' } 
    });
    
    //  原始查重邏輯：檢查姓名或電話是否已存在於索引中
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

    // 套用 search-bar 樣式以對齊系統視覺，並保留 blur 查重
    const nameInput = el('input', { 
        type: 'text', placeholder: 'Name *',
        className: 'search-bar',
        onblur: (e) => checkDuplicate(e.target.value)
    });
    
    const phoneInput = el('input', { 
        type: 'tel', placeholder: 'Phone',
        className: 'search-bar',
        style: { marginTop: '12px' },
        onblur: (e) => {
            const val = e.target.value;
            //  原始電話格式驗證邏輯
            if (val && !/^\d{3,10}$/.test(val)) {
                feedback.textContent = '❌ Invalid Phone Format';
                return;
            }
            checkDuplicate(val);
        }
    });
    
    // 增加容器內距解決擠迫感
    const modalContent = el('div', { style: { padding: '10px 4px' } }, nameInput, phoneInput, feedback);
    
    new Modal('New Customer', modalContent, async () => {
        if (!nameInput.value) return Toast.show('Name is required', 'error');
        
        // [保留] 阻止格式錯誤的資料提交
        if (feedback.textContent.includes('Invalid')) return;

        try {
            //資料同步：phone 必須同時寫入 c 欄位，確保編輯頁面能看到
            const newCustomer = await customerManager.create({
                name: nameInput.value,
                phone: phoneInput.value,
                c: phoneInput.value // 同步至聚合聯絡資訊
            });
            Toast.show('Customer created');
            this.router.navigate(`customer/${newCustomer.id}`);
        } catch (e) {
            Toast.show(e.message, 'error');
        }
    }).open();
}
}//CustomerListView 類別
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
        const lastDate = records.length ? new Date(records[0].updatedAt).toLocaleDateString() : '無記錄';
        
        this.root.innerHTML = '';
        this.root.className = 'view-container bg-soft';

        // 2. Header: 身分資訊與關鍵字
        const identityStr = `${customer.info?.gender || '男'} | ${customer.info?.age ? customer.info.age + '歲' : '年齡未填'}`;
        const header = el('div', { className: 'nav-header sticky-top' },
            el('button', { className: 'icon-btn', onclick: () => this.router.back() }, '←'),
            el('div', { className: 'nav-title-group', style: 'flex:1; margin-left:12px' },
                el('div', { style: 'display:flex; align-items:baseline; gap:8px' },
                    el('b', { className: 'nav-title' }, customer.name),
                    el('small', { style: 'color:var(--text-secondary); font-size:12px' }, identityStr)
                ),
                el('div', { className: 'nav-subtitle', style: 'font-size:11px; color:var(--primary); margin-top:2px' }, 
                    customer.kw ? `#${customer.kw.split(' ').join(' #')}` : '無關鍵字')
            ),
            el('button', { className: 'icon-btn', onclick: () => this._editCustomer(customer) }, '✎')
        );

        // 3. 統計資訊方塊化
        // 計算頻率：(總次數) / (第一筆到最後一筆的天數 / 30)
        let frequency = 'N/A';
        if (records.length >= 2) {
            const firstVisit = new Date(records[records.length - 1].updatedAt);
            const lastVisit = new Date(records[0].updatedAt);
            const monthDiff = (lastVisit - firstVisit) / (1000 * 60 * 60 * 24 * 30.44);
            frequency = monthDiff > 0 ? (totalVisits / monthDiff).toFixed(1) + ' 次/月' : '1.0 次/月';
        } else if (records.length === 1) {
            frequency = '初次首診';
        }

        // 佈局組裝：統計資訊方塊化 (三欄位) ---
        const statsGrid = el('div', { className: 'detail-stats-grid', style: 'grid-template-columns: repeat(3, 1fr);' },
            el('div', { className: 'stat-card' }, el('small', {}, '總預約次數'), el('div', { className: 'val' }, totalVisits)),
            el('div', { className: 'stat-card' }, el('small', {}, '上次預約'), el('div', { className: 'val', style: 'font-size:13px' }, lastDate)),
            el('div', { className: 'stat-card' }, el('small', {}, '回訪頻率'), el('div', { className: 'val', style: 'font-size:13px; color:var(--success)' }, frequency))
        );

        // 4. 生活脈絡與個性標籤 (套用雜湊配色)
        const contextSection = el('section', { className: 'context-section' },
            el('div', { className: 'info-row' }, el('b', { style: 'min-width:80px' }, '職業：'), customer.info?.occupation || '未填寫'),
    el('div', { className: 'info-row' }, el('b', { style: 'min-width:80px' }, '住處：'), customer.info?.address || '未填寫'), // 新增住處
    el('div', { className: 'info-row' }, el('b', { style: 'min-width:80px' }, '聯絡方式：'), customer.c || '未填寫'), // 新增聯絡方式
    el('div', { className: 'info-row' }, el('b', { style: 'min-width:80px' }, '運動/興趣：'), customer.info?.interests || '未填寫'),
    el('div', { className: 'personality-tags', id: 'personality-list' })
);

        // 5. 結構化病史彙整 (長期病史)
        const historySummary = el('section', { className: 'history-summary-box' },
            el('h5', {}, '📋 病史概覽'),
            el('div', { className: 'tag-group-list' },
                ...(customer.tags || []).map(t => {
                    const name = typeof t === 'object' ? t.tagId : t;
                    const remark = (typeof t === 'object' && t.remark) ? `【${t.remark}】` : '';
                    return el('span', { className: 'tag-chip', style: 'background:var(--primary); color:white; font-size:12px' }, `${name}${remark}`);
                }),
                (customer.tags?.length === 0) ? el('small', { style: 'color:var(--text-muted)' }, '目前無病史記錄') : null
            )
        );

// 5.1 上次服務紀錄摘要 (⚡ 快速延續入口)
        let lastVisitSummary = null;
        if (records.length > 0) {
            const lastRec = records[0];
            lastVisitSummary = el('section', { className: 'last-visit-summary-card', style: 'margin: 15px 20px; padding: 12px; background: #fff; border-radius: 8px; border: 1px solid #e2e8f0;' },
                el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;' },
                    el('h5', { style: 'margin:0; font-size:14px; color:var(--text-secondary);' }, '⚡ 上次就診摘要'),
                    el('button', { 
                        className: 'btn-flash',
                        style: 'background:var(--primary); color:white; border:none; border-radius:15px; padding:4px 12px; font-size:12px; cursor:pointer;',
                        onclick: () => this._cloneAndContinue(lastRec) 
                    }, '⚡ 延續此紀錄')
                ),
                el('div', { style: 'font-size:13px;' },
                    el('div', { style: 'color:var(--text-main); margin-bottom:4px;' }, `主訴：${lastRec.soap?.s || '無'}`),
                    el('div', { style: 'color:var(--primary); font-weight:500;' }, `計畫：${lastRec.soap?.p || '無'}`)
                )
            );
        }

        const actionArea = el('div', { style: 'padding:0 20px 16px' },
            el('button', { 
                className: 'btn-primary w-100 shadow-sm',
                onclick: () => this.router.navigate(`record/new?customerId=${this.customerId}`) 
            }, '＋ 新增診療病歷')
        );

        // 6. 歷史紀錄卡片 (保留物件化標籤邏輯)
        const historyList = el('div', { className: 'history-timeline', style: 'padding: 0 20px' });
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
                    el('p', { style: 'margin: 8px 0' }, rec.soap?.a || '無評估摘要'),
                    el('div', { className: 'card-tags' }, 
                        ...(rec.tags || []).slice(0, 8).map(t => {
                            const name = typeof t === 'object' ? t.tagId : t;
                            const remark = (typeof t === 'object' && t.remark) ? `【${t.remark}】` : '';
                            return el('small', { style: 'margin-right:8px; color:var(--primary); font-weight:500' }, `#${name}${remark}`);
                        })
                    )
                )
            );
            historyList.appendChild(card);
        });

        this.root.append(header, statsGrid, contextSection, historySummary);
        if (lastVisitSummary) this.root.append(lastVisitSummary); 
        this.root.append(actionArea, historyList);

        // 非同步渲染個性標籤配色
        if (customer.info?.personality?.length > 0) {
            const pList = this.root.querySelector('#personality-list');
            const allTags = await tagManager.getAll();
            customer.info.personality.forEach(pName => {
                const match = allTags.find(t => t.name === pName);
                pList.appendChild(el('span', { 
                    className: 'tag-chip', 
                    style: `background:${match?.color || '#94a3b8'}; font-size:11px; opacity:0.8` 
                }, pName));
            });
        }
    }


    _editCustomer(customer) {
        // 1. 初始化動態聯絡人數據
        let contactList = (customer.c || '').split(' ').filter(v => v.trim()).map(v => ({ value: v }));
        if (contactList.length === 0) contactList.push({ value: '' });

        // 初始化個性標籤與基礎資訊
        let personality = customer.info?.personality || [];
        const genderOptions = ['男', '女', '多元'];

        const contactContainer = el('div', { className: 'mt-2' });
        const renderContacts = () => {
            contactContainer.innerHTML = '';
            contactList.forEach((c, idx) => {
                const row = el('div', { style: 'display:flex; gap:8px; margin-bottom:8px' },
                    el('input', { 
                        type: 'text', value: c.value, placeholder: '電話、LINE 或 Email',
                        className: 'search-bar', style: 'flex:1',
                        oninput: (e) => contactList[idx].value = e.target.value
                    }),
                    el('button', { 
                        className: 'icon-btn text-danger',
                        onclick: () => { contactList.splice(idx, 1); renderContacts(); }
                    }, '×')
                );
                contactContainer.appendChild(row);
            });
        };
        renderContacts();

        // 構建表單結構
        const form = el('div', { className: 'rich-form' },
            el('section', { className: 'form-section' },
                el('h4', { className: 'section-title' }, '基本資料與快速搜尋'),
                el('div', { className: 'form-grid' },
                    this._createInputField('姓名 *', 'text', 'edit-name', customer.name),
                    this._createInputField('關鍵字(快速搜尋用)', 'text', 'edit-kw', customer.kw || '')
                ),
                el('div', { className: 'form-grid-three mt-3' },
                    el('div', { className: 'input-group' },
                        el('label', { className: 'input-label' }, '性別'),
                        el('select', { id: 'edit-gender', className: 'search-bar', style: 'margin-top:4px' },
                            ...genderOptions.map(g => el('option', { value: g, selected: customer.info?.gender === g }, g))
                        )
                    ),
                    this._createInputField('年齡', 'text', 'edit-age', customer.info?.age || ''),
                    this._createInputField('住處', 'text', 'edit-address', customer.info?.address || '')
                )
            ),

            el('section', { className: 'form-section mt-4' },
                el('h4', { className: 'section-title' }, '生活脈絡與個性'),
                el('div', { className: 'form-grid' },
                    this._createInputField('職業', 'text', 'edit-job', customer.info?.occupation || ''),
                    this._createInputField('運動/興趣', 'text', 'edit-hobby', customer.info?.interests || '')
                ),
                el('div', { className: 'mt-3' }, 
                    this._createInputField('個性標籤 (空格隔開，如：好聊 謹慎)', 'text', 'edit-personality', personality.join(' '))
                )
            ),

            el('section', { className: 'form-section mt-4' },
                el('div', { style: 'display:flex; justify-content:space-between; align-items:center' },
                    el('h4', { className: 'section-title' }, '聯絡方式'),
                    el('button', { 
                        className: 'btn-secondary', style: 'font-size:11px; padding:4px 10px',
                        onclick: (e) => { e.preventDefault(); contactList.push({ value: '' }); renderContacts(); }
                    }, '+ 增加欄位')
                ),
                contactContainer
            ),

            el('section', { className: 'form-section mt-4' },
                el('h4', { className: 'section-title' }, '病史'),
                el('div', { 
                    id: 'edit-tag-selector-container', 
                    style: 'min-height: 100px; display: flex; align-items: center; justify-content: center; color: var(--text-muted);' 
                }, '⏳ 正在載入標籤系統...')
            ),

            el('section', { className: 'form-section mt-4' },
                el('h4', { className: 'section-title' }, '備註事項'),
                el('textarea', { id: 'edit-note', className: 'soap-textarea', style: 'height: 80px;' }, customer.note || '')
            )
        );

        // 3. 處理 Modal 提交邏輯
        let selectedTags = [...(customer.tags || [])];
        const modal = new Modal('編輯顧客檔案', form, async () => {
            const updatedData = {
                name: form.querySelector('#edit-name').value,
                c: contactList.map(c => c.value.trim()).filter(Boolean).join(' '),
                kw: form.querySelector('#edit-kw').value,
                tags: selectedTags,
                note: form.querySelector('#edit-note').value,
                info: {
            gender: form.querySelector('#edit-gender').value,
            age: form.querySelector('#edit-age').value,
            address: form.querySelector('#edit-address').value,
            occupation: form.querySelector('#edit-job').value,
            interests: form.querySelector('#edit-hobby').value,
            personality: form.querySelector('#edit-personality').value.split(' ').filter(v => v.trim())
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

        // 4. 非同步初始化標籤選擇器
        import('./components.js').then(async ({ TagSelector }) => {
            try {
                const allTags = await tagManager.getAll(); 
                const container = form.querySelector('#edit-tag-selector-container');
                if (!container) return; 
                container.innerHTML = ''; 
                container.style.display = 'block';
                
                const ts = new TagSelector(selectedTags, allTags, (tags) => {
                    selectedTags = tags;
                });
                container.appendChild(ts.element);
            } catch (e) {
                form.querySelector('#edit-tag-selector-container').textContent = '❌ 標籤系統加載失敗';
            }
        });
    }

    _createInputField(label, type, id, value) {
        return el('div', { className: 'input-group' },
            el('label', { 
                for: id, 
                className: 'input-label',
                style: 'display: block; margin-bottom: 6px; font-weight: 500;' 
            }, label),
            el('input', { 
                type: type, 
                id: id, 
                value: value || '', 
                className: 'search-bar',
                style: 'width: 100%; box-sizing: border-box;' 
            })
        );
    }
/**
     * ⚡ 快速延續邏輯 (Clone & Continue)
     */
    async _cloneAndContinue(lastRecord) {
        try {
            // 1. 建立新紀錄物件並執行欄位處理
            const newRecord = {
                id: crypto.randomUUID(), // 重置 ID
                customerId: this.customerId,
                date: Date.now(), // 重置日期為今日
                version: "V1.0", // 重置版本號
                status: RecordStatus.DRAFT,
                soap: {
                    s: "", // 清空主訴文字
                    o: "", // 清空客觀文字
                    a: lastRecord.soap?.a || "", // 複製評估
                    p: lastRecord.soap?.p || ""  // 複製計畫
                },
                bodyParts: [...(lastRecord.bodyParts || [])], // 複製患處標記
                tags: [...(lastRecord.tags || [])], // 複製標籤
                rom: { ...(lastRecord.rom || {}) }, // 複製活動度數據
                painScale: lastRecord.painScale || 0, // 複製疼痛指數
                changeLog: [] // 清空修訂歷程
            };

            // 2. 寫入草稿儲存庫 (以新產生的 UUID 為 Key)
            const { draftManager } = await import('../modules/record.js');
            await draftManager.save(newRecord.id, newRecord);

            // 3. 導航至編輯頁面，並帶入新紀錄 ID
            Toast.show('已延續上次評估與計畫', 'success');
            this.router.navigate(`record/${newRecord.id}`);
        } catch (e) {
            Toast.show('延續紀錄失敗：' + e.message, 'error');
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
        
        //  初始化實例屬性，避免 undefined
        this.bodyMap = null;
        this.tagSelector = null;
        this.assessmentContainer = null;

        this.render();
    }

     /**
     * 防禦性標籤提取器 (Helper)
     * 支援 string | {tagId: string, remark: string}
     */
    _getTagName(tag) {
        if (!tag) return '';
        return typeof tag === 'object' ? (tag.tagId || '') : tag;
    }

    // 智慧建議強化：根據 Anatomy 標籤推薦測試
    _updateAssessmentSuggestions(selectedParts) {
    if (!this.assessmentContainer) return;

    import('../config.js').then(({ AssessmentDatabase }) => {
        if (!AssessmentDatabase) return;

        const suggestions = new Set();
        const currentTags = Array.isArray(this.data.tags) ? this.data.tags : [];
        const parts = Array.isArray(selectedParts) ? selectedParts : [];

        // 1. 處理 BodyMap 選擇的部位 (通常為字串，如 'Shoulder-R')
        parts.forEach(partId => {
            if (typeof partId !== 'string') return;
            const regionKey = Object.keys(AssessmentDatabase).find(k => 
                partId.toLowerCase().includes(k.toLowerCase())
            );
            if (regionKey) {
                AssessmentDatabase[regionKey].forEach(t => suggestions.add(t));
            }
        });

        // 2. 處理已選取的 Tags (相容物件結構 {tagId: '...'} 或 純字串)
        currentTags.forEach(tagEntry => {
            // 提取標籤名稱，優先嘗試物件結構的 tagId，若非物件則視為字串本身
            const tagName = (tagEntry && typeof tagEntry === 'object') 
                ? tagEntry.tagId 
                : tagEntry;

            if (typeof tagName !== 'string') return;

            // 執行模糊比對 (防禦性檢查：確保 AssessmentDatabase 存在該 key)
            const match = Object.keys(AssessmentDatabase).find(k => 
                tagName.toLowerCase().includes(k.toLowerCase())
            );
            
            if (match && Array.isArray(AssessmentDatabase[match])) {
                AssessmentDatabase[match].forEach(t => suggestions.add(t));
            }
        });

        // 3. 渲染 UI
        this.assessmentContainer.innerHTML = '';
        if (suggestions.size > 0) {
            this.assessmentContainer.style.display = 'block';
            const list = el('div', { className: 'suggestion-chips' });
            
            suggestions.forEach(test => {
                if (!test || !test.name) return; // 確保測試物件完整性
                list.appendChild(el('button', { 
                    className: 'chip-btn',
                    onclick: () => this._addAssessmentResult(test)
                }, test.name));
            });
            
            this.assessmentContainer.append(el('h5', {}, '💡 建議評估項目'), list);
        } else {
            this.assessmentContainer.style.display = 'none'; // 無建議時隱藏容器
        }
    }).catch(err => {
        console.error('Failed to load AssessmentDatabase:', err);
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
        // 資料載入與初始化邏輯：採用統一 ID 策略
        if (this.recordId) {
            // 編輯既有紀錄：先檢查有無草稿，若無則抓取正式紀錄
            const draft = await draftManager.get(this.recordId);
            if (draft) {
                this.data = draft.data;
                Toast.show('已恢復未儲存的編輯內容');
            } else {
                this.data = await recordManager.get(this.recordId);
            }
        } else if (this.customerId) {
            // 新增紀錄：檢查該病患是否有「新病歷」的草稿
            const draft = await draftManager.get(this.customerId);
            if (draft) {
                this.data = { ...draft.data, customerId: this.customerId };
                // 確保 recordId 指向紀錄本身的 UUID，而非 customerId
                this.recordId = draft.data.id || draft.id; 
                Toast.show('已恢復上次未完成的草稿');
            } else {
                // 建立時即產生帶有新 UUID 的物件，確保 Source of Truth 唯一性
                this.data = await recordManager.create(this.customerId);
                this.recordId = this.data.id; 
            }
        }

        if (!this.data) {
            this.root.innerHTML = '<div class="p-4">載入病歷失敗，請重試</div>';
            return;
        }

        // 確保核心數據結構完整，防止渲染報錯
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
            el('span', { className: `badge ${this.data.status === RecordStatus.FINALIZED ? 'bg-success' : 'bg-warning'}` }, this.data.status || RecordStatus.DRAFT)
        );

        // 初始化互動組件
        this.tagSelector = new TagSelector(this.data.tags, allTags, (newTags) => {
            this.data.tags = newTags;
            this._markDirty();
        });

        this.bodyMap = new BodyMap(this.data.bodyParts, (parts) => {
    const oldParts = this.data.bodyParts || [];
    this.data.bodyParts = parts;

    if (this.tagSelector) {
        import('../config.js').then(({ BodyRegions }) => {
            // 新增時：將 'Shoulder-R' 轉換為 '肩部'
            parts.filter(p => !oldParts.includes(p)).forEach(p => {
                const region = Object.values(BodyRegions).find(r => p.startsWith(r.id));
                this.tagSelector._addTag(region ? region.label : p);
            });
            // 移除時：同理轉換後移除
            oldParts.filter(p => !parts.includes(p)).forEach(p => {
                const region = Object.values(BodyRegions).find(r => p.startsWith(r.id));
                this.tagSelector._removeTag(region ? region.label : p);
            });
        });
    }
    this._markDirty();
    this._updateAssessmentSuggestions(parts); 
}, this.data.status !== RecordStatus.FINALIZED);

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
                disabled: this.data.status === RecordStatus.FINALIZED
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
        if (this.data.status !== RecordStatus.FINALIZED) {
            actions.append(
                el('button', { className: 'btn-secondary', onclick: () => this._showTemplateModal() }, '📋 範本'),
                el('button', { className: 'btn-secondary', onclick: () => this._save(RecordStatus.DRAFT) }, '儲存草稿'),
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
            // 確保 bodyParts 存在且為陣列
            const selectedParts = Array.isArray(this.data.bodyParts) ? this.data.bodyParts : [];
            
            if (selectedParts.length === 0) {
                container.innerHTML = '<p class="text-muted" style="padding:10px; font-size:12px">請先在 Body Map 標記部位以顯示對應 ROM 項目</p>';
                return;
            }

            // 修正比對邏輯：確保取出的 partId 為字串
            const relevantROMs = StandardROM.filter(rom => 
                selectedParts.some(part => {
                    const partId = this._getTagName(part).split('-')[0].toLowerCase();
                    return rom.id.includes(partId);
                })
            );

            container.innerHTML = '';
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
                        value: (this.data.rom && this.data.rom[fullId]) ? this.data.rom[fullId] : romDef.norm, 
                        onChange: (val) => {
                            if (!this.data.rom) this.data.rom = {};
                            this.data.rom[fullId] = val;
                            this._markDirty();
                        }
                    });
                    container.appendChild(slider.element);
                });
            });
        }).catch(err => {
            container.textContent = 'ROM 組件載入失敗';
            console.error(err);
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
            // 永遠只用 recordId 作為 Key
            draftManager.save(this.recordId, this.data);
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
            // 1. 宣告一個持有變數，確保閉包可以安全捕獲
            let modalInstance = null;
            const list = el('div', { className: 'template-list', style: { display: 'flex', flexDirection: 'column', gap: '8px' } });

            DefaultTemplates.forEach(tpl => {
                const btn = el('button', {
                    className: 'btn-secondary',
                    style: { textAlign: 'left' },
                    onclick: () => {
                        this._applyTemplate(tpl, tagSelector);
                        // 2. 檢查實例是否存在後再關閉
                        if (modalInstance) modalInstance.close();
                    }
                }, 
                    el('div', { style: { fontWeight: 'bold' } }, tpl.title),
                    el('div', { style: { fontSize: '12px', color: '#666' } }, tpl.description || '')
                );
                list.appendChild(btn);
            });

            // 3. 正式賦值並開啟
            modalInstance = new Modal('Select Template', list);
            modalInstance.open();
        });
    }

    async _applyTemplate(template) {
    if (!template) return;
    
    const { templateManager, draftManager } = await import('../modules/record.js');
    const { Toast, el } = await import('./components.js');
    
    // 1. 策略確認：檢查是否有既有內容
    const hasContent = !!(this.data.soap?.s || this.data.soap?.o || this.data.soap?.a || this.data.soap?.p);
    let strategy = 'Append';

    if (hasContent) {
        // 使用原有的 confirm 邏輯確定疊加或覆蓋
        if (!confirm(`目前紀錄已有內容。\n點擊「確定」進行疊加 (Append)。\n點擊「取消」進行覆蓋 (Override)。`)) {
            strategy = 'Override';
        }
    }

    // 2. [保留重要功能] 套用前先存快照備份，以供撤銷使用
    const backupId = `${this.recordId || this.customerId}_backup`;
    try {
        await draftManager.save(backupId, JSON.parse(JSON.stringify(this.data)));
    } catch (e) {
        console.warn('Backup failed, proceeding anyway:', e);
    }

    // 3. 標準化標籤格式：確保範本標籤統一為物件結構 {tagId, remark}
    const tplTags = (template.tags || []).map(t => 
        typeof t === 'string' ? { tagId: t, remark: '' } : t
    );

    // 4. 執行數據合併
    const mergedRecord = templateManager.merge(this.data, template, strategy);
    this.data.soap = mergedRecord.soap;
    this.data.bodyParts = mergedRecord.bodyParts;
    this.data.rom = mergedRecord.rom;

    // 5. 處理標籤合併與去重：使用 _getTagName 防禦性提取 ID
    if (strategy === 'Append') {
        const existingTags = Array.isArray(this.data.tags) ? this.data.tags : [];
        const combined = [...existingTags, ...tplTags];
        const seen = new Set();
        
        this.data.tags = combined.filter(t => {
            const id = this._getTagName(t);
            return (id && !seen.has(id)) ? seen.add(id) : false;
        });
    } else {
        this.data.tags = tplTags;
    }

    // 6. 更新 UI 與狀態
    await this.render(); // 觸發完整重繪以確保 TagSelector 與 BodyMap 同步
    this._markDirty();
    
    // 7. [恢復原本功能] 顯示通知與撤銷入口
    Toast.show(`已套用模板: ${template.title}`, 'success');
    
    const undoBtn = el('button', {
        style: { 
            marginLeft: '12px', color: '#fff', textDecoration: 'underline', 
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px' 
        },
        onclick: async (e) => {
            e.preventDefault();
            const backup = await draftManager.get(backupId);
            if (backup && backup.data) {
                this.data = backup.data;
                await this.render(); 
                Toast.show('已還原至套用前狀態', 'info');
                this._markDirty();
            }
        }
    }, '撤銷');

    const lastToast = document.querySelector('.toast-container .toast:last-child');
    if (lastToast) lastToast.appendChild(undoBtn);
}
// --- Settings View ---
export class SettingsView extends BaseView {
    constructor(router) {
        super();
        this.router = router;
        this.render();
    }

    /**
 * 系統設定視圖：整合標籤管理、同步狀態與資料完整性檢查
 * 具備防禦性檢查，確保異步組件加載失敗時不崩潰
 */
async render() {
    this.root.innerHTML = '<div class="loading">Loading Settings...</div>';

    try {
        // 1. 異步資源加載
        const [syncModule, dbModule] = await Promise.all([
            import('../core/sync.js').catch(() => ({ syncGateway: null })),
            import('../core/db.js').catch(() => ({ storageManager: null }))
        ]);
        
        const syncGateway = syncModule.syncGateway;
        const storageManager = dbModule.storageManager;

        // 2. 初始化容器
        this.root.innerHTML = '';
        this.root.className = 'view-container bg-soft';

        // Header：與其他頁面風格統一
        const header = el('div', { className: 'nav-header sticky-top' },
            el('button', { className: 'icon-btn', onclick: () => this.router.back() }, '←'),
            el('b', { className: 'nav-title', style: 'margin-left: 12px' }, '系統設定')
        );

        const container = el('div', { className: 'settings-scroll-area', style: 'padding: 16px; padding-bottom: 40px;' });

        // --- 區塊 A：系統管理 (標籤、評估、模板) ---
        const adminSection = el('section', { className: 'settings-card mb-4' },
            el('h4', { className: 'settings-label' }, '業務邏輯管理'),
            this._createMenuBtn('🏷️ 標籤管理中心', () => this._openTagManager()),
            this._createMenuBtn('💪 動作評估編輯器', () => this._openAssessmentEditor()),
            this._createMenuBtn('📋 範本建構器', () => this._openTemplateBuilder())
        );

        // --- 區塊 B：P2P 同步狀態 ---
        const peerId = (syncGateway && syncGateway.peerManager) ? syncGateway.peerManager.myId : 'OFFLINE';
        const currentName = localStorage.getItem('device_name') || `Device-${peerId.slice(0, 4)}`;

        const syncSection = el('section', { className: 'settings-card mb-4' },
            el('h4', { className: 'settings-label' }, '本地優先 (Local-First) 同步'),
            
            // 裝置名稱設定
            el('div', { className: 'setting-item-input' },
                el('label', {}, '當前裝置識別名稱'),
                el('div', { style: 'display:flex; gap:8px; margin-top:8px' },
                    el('input', { 
                        type: 'text', value: currentName, id: 'device-name-input',
                        className: 'search-bar', style: 'flex:1'
                    }),
                    el('button', {
                        className: 'btn-primary',
                        style: 'padding: 0 16px; white-space: nowrap;',
                        onclick: () => this._updateDeviceName(syncGateway)
                    }, '更新')
                )
            ),

            // Peer ID 顯示與廣播控制
            el('div', { className: 'sync-status-box mt-3' },
                el('div', { className: 'peer-id-label' }, '我的識別碼 (Peer ID)：'),
                el('code', { className: 'peer-id-value' }, peerId),
                el('button', { 
                    id: 'btn-scan',
                    className: 'btn-secondary w-100 mt-3',
                    onclick: (e) => this._handleScan(e.target)
                }, '📡 發送同步廣播訊號')
            )
        );

        // --- 區塊 C：資料維護中心 ---
        const dataSection = el('section', { className: 'settings-card mb-4' },
            el('h4', { className: 'settings-label' }, '資料完整性與安全'),
            this._createMenuBtn('♻️ 回收站 (還原已刪除的資料)', () => this._showRecycleBin()),
            this._createMenuBtn('🛡️ 執行資料健檢 (修復孤兒節點)', () => this._handleIntegrityCheck()),
            
            el('button', { 
                className: 'btn-danger-outline w-100 mt-3',
                style: 'padding: 12px; border-radius: 8px;',
                onclick: () => this._handleFactoryReset()
            }, '🗑️ 系統重置 (工廠設置 / 清空所有資料)')
        );

        // 組裝視圖
        container.append(adminSection, syncSection, dataSection);
        this.root.append(header, container);

    } catch (err) {
        console.error('Settings render error:', err);
        this.root.innerHTML = `<div class="error-state">設定頁面載入失敗: ${err.message}</div>`;
    }
}

/**
 * 輔助方法：裝置名稱更新邏輯
 */
_updateDeviceName(syncGateway) {
    const input = document.getElementById('device-name-input');
    const newName = input ? input.value.trim() : '';
    if (newName) {
        localStorage.setItem('device_name', newName);
        if (syncGateway && syncGateway.peerManager) {
            syncGateway.peerManager.deviceName = newName;
            syncGateway.peerManager.announce();
        }
        import('./components.js').then(({ Toast }) => Toast.show('裝置名稱已儲存'));
    }
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
                    // 改從 soap 結構抓取任何有文字的欄位作為預覽
                    const soap = draft.data.soap || {};
                    const snippet = (soap.s || soap.a || soap.o || soap.p || '').substring(0, 50) || '(No content)'; 

                    const card = el('div', { 
                        className: `record-card status-${RecordStatus.DRAFT.toLowerCase()}`,
                        style: { cursor: 'pointer', borderLeftColor: 'var(--warning)', position: 'relative', transition: 'transform 0.2s' },
                        onclick: () => this._restoreDraft(draft)
                    },
                        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, 
                            el('strong', {}, customerName),
                            el('small', { style: { color: '#666' } }, savedTime)
                        ),
                        el('div', { style: { marginTop: '8px', color: '#444' } }, snippet),
                        el('div', { style: { marginTop: '4px', fontSize: '12px', color: '#888' } }, 
                            // 處理標籤可能是物件 {tagId, remark} 的情況
                            'Tags: ' + (draft.data.tags || []).map(t => typeof t === 'object' ? t.tagId : t).join(', ')
                        )
                    );
                    
                    //  Swipe Left to Delete Logic
                    let startX = 0;
                    let currentX = 0;
                    const THRESHOLD = -80; // Swipe distance to trigger delete intent

                    card.addEventListener('touchstart', (e) => {
                        startX = e.touches[0].clientX;
                        currentX = startX;                        card.style.transition = 'none'; 
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
} // DraftListView 結束
