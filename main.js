/**
 * src/main.js
 * 應用程式入口 (The Bootstrapper)
 * 
 * @description 負責初始化系統、掛載路由、偵測環境並啟動 UI。
 * 包含 Integrity Guard 與 Ephemeral Detector 安全機制。
 */

import { storageManager } from './core/db.js';
import { searchEngine } from './core/search.js';
import { ErrorHandler, EventBus } from './core/utils.js';
import { EventTypes } from './config.js';
import { CustomerListView, CustomerDetailView, RecordEditorView, SettingsView, DraftListView } from './ui/views.js';
import { Toast } from './ui/components.js';

// --- 1. Code Integrity Guard (1.2) ---
const IntegrityGuard = {
    check() {
        // 檢查關鍵模組是否包含 Git 衝突標記
        const criticalFunctions = [
            storageManager.runTransaction,
            App.prototype.init
        ];

        for (const fn of criticalFunctions) {
            const code = fn.toString();
            if (code.includes('<<<<<<<') || code.includes('=======')) {
                throw new Error('FATAL: Code integrity violation. Git conflict markers detected.');
            }
        }
        console.log('🛡️ Code Integrity Check Passed');
    }
};

// --- 2. Ephemeral Detector (1.3) ---
const EphemeralDetector = {
    async check() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            // 嚴格判定：Quota 極小 (通常無痕模式 Quota 會被限制)
            if (estimate.quota < 120 * 1024 * 1024) { 
                console.warn('[System] Ephemeral Mode Detected (Low Quota).');
                // 通知 StorageManager 鎖定寫入
                storageManager.setEphemeralMode(true);
                Toast.show('⚠️ Incognito Mode Detected. App is Read-Only.', 'warning', 10000);
                return true;
            }
        }
        return false;
    }
};

// --- Router ---
class Router {
    constructor(routes) {
        this.routes = routes;
        this.currentView = null;
        this.appRoot = document.getElementById('app');
        window.addEventListener('hashchange', () => this._handleHashChange());
    }

    start() { this._handleHashChange(); }
    navigate(path) { window.location.hash = path; }
    back() { window.history.back(); }

    async _handleHashChange() {
        const hash = window.location.hash.slice(1) || 'list';
        const [path, query] = hash.split('?');

        //  無痕模式路由守衛 (Incognito Route Guard)
        // 設計目的：防止使用者在無寫入權限的環境下嘗試編輯，導致 UX 挫折
        if (storageManager.isEphemeral) {
            const restrictedPaths = ['record', 'drafts'];
            const isRestricted = restrictedPaths.some(p => path.startsWith(p));
            
            if (isRestricted) {
                console.warn('[Router] Navigation blocked: Incognito Mode');
                // 動態載入 Toast 以避免循環依賴，並給予使用者明確回饋
                import('./ui/components.js').then(({ Toast }) => {
                    Toast.show('編輯功能在無痕模式下已停用', 'warning');
                });
                
                // 強制重導向回列表頁
                if (path !== 'list') this.navigate('list');
                return;
            }
        }

        if (this.currentView && this.currentView.onLeave) {
            const canLeave = this.currentView.onLeave();
            if (!canLeave) return;
        }

        let MatchedView = null;
        let params = {};

        for (const [pattern, ViewClass] of Object.entries(this.routes)) {
            const regexPattern = pattern.replace(/:([^/]+)/g, '([^/]+)');
            const regex = new RegExp(`^${regexPattern}$`);
            const match = path.match(regex);

            if (match) {
                MatchedView = ViewClass;
                const paramNames = (pattern.match(/:([^/]+)/g) || []).map(s => s.slice(1));
                match.slice(1).forEach((val, index) => {
                    params[paramNames[index]] = val;
                });
                break;
            }
        }

        if (MatchedView) {
            if (this.currentView) this.currentView.unmount();
            this.currentView = new MatchedView(this, params);
            this.currentView.mount(this.appRoot);
        } else {
            this.appRoot.innerHTML = '404 Not Found';
        }
    }
}

// --- App Bootstrapper ---
class App {
    constructor() {
        this.loadingOverlay = null;
    }

    async init() {
        console.log('🚀 App Initializing...');
        
        try {
            // 1. Integrity Check (First thing!)
            IntegrityGuard.check();

            // 2. Error Handling
            ErrorHandler.init();

            // 3. Environment Check (Gate)
            await EphemeralDetector.check();

            // 4. Core Init
            await storageManager.init();
            searchEngine.init();

            // 5. UI Initialization
            const routes = {
                'list': CustomerListView,
                'customer/:id': CustomerDetailView,
                'record/:id': RecordEditorView,
                'settings': SettingsView,
                'drafts': DraftListView
            };

            this.router = new Router(routes);
            this.router.start();

            //  Global Dirty Check (Prevent Tab Close)
            window.onbeforeunload = (e) => {
                if (this.router.currentView && this.router.currentView.isDirty) {
                    e.preventDefault();
                    e.returnValue = ''; // Standard for Chrome
                    return '';
                }
            };

            // 6. Global Event Listeners
            EventBus.on(EventTypes.SYSTEM.ERROR, (err) => Toast.show(err.message, 'error'));
            EventBus.on(EventTypes.SYSTEM.QUOTA_WARN, () => Toast.show('Storage Full!', 'error'));
            
            //  傳輸鎖定 UI 處理 (Modal/Overlay)
            // 補足 P2P 同步時的視覺回饋，避免使用者誤以為當機
            EventBus.on(EventTypes.UI.MODAL, (payload) => this._handleGlobalModal(payload));

            //  背景完整性檢測 (Delayed Start)
            // 啟動 5 秒後執行，避免影響首屏渲染效能 (Non-blocking)
            setTimeout(() => {
                console.log('[System] Triggering background integrity check...');
                searchEngine.checkIntegrity().then(report => {
                    if (report && report.orphanCount > 0) {
                        console.warn('[Integrity] Orphans found:', report);
                        EventBus.emit(EventTypes.SYSTEM.INTEGRITY_FAIL, report);
                    } else {
                        console.log('[Integrity] System healthy.');
                    }
                });
            }, 5000);
            
            console.log('✅ App Ready');
            
        } catch (error) {
            document.body.innerHTML = `<div style="padding:20px; color:red; font-family:sans-serif;">
                <h1>System Halted</h1>
                <p>${error.message}</p>
            </div>`;
            console.error(error);
        }
    }

    /**
     * 處理全域 Modal 事件 (主要用於 P2P 傳輸鎖定)
     * 實作全螢幕遮罩，攔截所有點擊
     */
    _handleGlobalModal(payload) {
        if (payload.type === 'LOADING') {
            if (!this.loadingOverlay) {
                this.loadingOverlay = document.createElement('div');
                this.loadingOverlay.className = 'modal-overlay';
                this.loadingOverlay.style.zIndex = '9999'; // 最高層級
                this.loadingOverlay.innerHTML = `
                    <div class="modal-container" style="text-align:center; padding:30px;">
                        <div class="spinner" style="margin:0 auto 20px;"></div>
                        <h3>${payload.message || 'Processing...'}</h3>
                    </div>
                `;
                document.body.appendChild(this.loadingOverlay);
            }
        } else if (payload.type === 'CLOSE') {
            if (this.loadingOverlay) {
                this.loadingOverlay.remove();
                this.loadingOverlay = null;
            }
        }
    }
}

const app = new App();
app.init();
window.app = app;