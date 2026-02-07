/**
 * src/main.js
 * 應用程式入口 (The Bootstrapper)
 * 
 * @description 負責啟動系統並確保核心元件（DB, Search）同步就緒後才啟動 UI。
 * [PATCH-v6.3.1] 修正啟動競爭與無痕模式路由保護邏輯。
 */

import { storageManager } from './core/db.js';
import { searchEngine } from './core/search.js';
import { ErrorHandler, EventBus } from './core/utils.js';
import { EventTypes } from './config.js';
import { CustomerListView, CustomerDetailView, RecordEditorView, SettingsView, DraftListView } from './ui/views.js';
import { Toast } from './ui/components.js';

const IntegrityGuard = {
    check() {
        const criticalFunctions = [storageManager.runTransaction, App.prototype.init];
        for (const fn of criticalFunctions) {
            const code = fn.toString();
            if (code.includes('<<<<<<<') || code.includes('=======')) {
                throw new Error('FATAL: Code integrity violation. Git conflict markers detected.');
            }
        }
    }
};

const EphemeralDetector = {
    async check() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            if (estimate.quota < 120 * 1024 * 1024) { 
                storageManager.setEphemeralMode(true);
                return true;
            }
        }
        return false;
    }
};

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

        // [Fix] 無痕模式存取限制
        if (storageManager.isEphemeral) {
            const restricted = ['record', 'drafts'];
            if (restricted.some(p => path.startsWith(p))) {
                Toast.show('編輯功能在無痕模式下已停用', 'warning');
                if (path !== 'list') this.navigate('list');
                return;
            }
        }

        if (this.currentView && this.currentView.onLeave) {
            if (!this.currentView.onLeave()) return;
        }

        let MatchedView = null;
        let params = {};
        for (const [pattern, ViewClass] of Object.entries(this.routes)) {
            const regexPattern = pattern.replace(/:([^/]+)/g, '([^/]+)');
            const match = path.match(new RegExp(`^${regexPattern}$`));
            if (match) {
                MatchedView = ViewClass;
                const paramNames = (pattern.match(/:([^/]+)/g) || []).map(s => s.slice(1));
                match.slice(1).forEach((val, index) => { params[paramNames[index]] = val; });
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

class App {
    constructor() {
        this.loadingOverlay = null;
        this.router = new Router({
            'list': CustomerListView,
            'customer/:id': CustomerDetailView,
            'record/:id': RecordEditorView,
            'settings': SettingsView,
            'drafts': DraftListView
        });
    }

    async init() {
        try {
            IntegrityGuard.check();
            ErrorHandler.init();

            // 1. 環境偵測與持久層啟動
            const isEphemeral = await EphemeralDetector.check();
            await storageManager.init();
            
            if (isEphemeral) {
                Toast.show('⚠️ 無痕模式：資料不會永久保存', 'warning', 8000);
            }

            // 2. [PATCH] 同步搜尋索引：確保列表渲染時索引已就緒
            await searchEngine.init();

            // 3. 啟動路由介面
            this.router.start();

            EventBus.emit(EventTypes.SYSTEM.READY);

            // 移除啟動遮罩
            const loader = document.querySelector('.loading-screen');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.remove(), 300);
            }
            
        } catch (error) {
            document.body.innerHTML = `<div class="fatal-error"><h1>System Halted</h1><p>${error.message}</p></div>`;
            console.error('[Boot] initialization failed:', error);
        }

        EventBus.on(EventTypes.UI.MODAL, (p) => this._handleGlobalModal(p));
    }

    _handleGlobalModal(payload) {
        if (payload.type === 'LOADING') {
            if (this.loadingOverlay) return;
            this.loadingOverlay = document.createElement('div');
            this.loadingOverlay.className = 'modal-overlay';
            this.loadingOverlay.style.zIndex = '9999';
            this.loadingOverlay.innerHTML = `
                <div class="modal-container" style="text-align:center; padding:30px;">
                    <div class="spinner" style="margin:0 auto 20px;"></div>
                    <h3>${payload.message || '處理中...'}</h3>
                </div>`;
            document.body.appendChild(this.loadingOverlay);
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