/**
 * src/core/utils.js
 * 核心工具函式庫
 * 
 * @description 提供全域共用的基礎設施，包含事件匯流排、UUID 生成、安全序列化與錯誤處理。
 * 此模組不依賴任何業務邏輯模組。
 */

import { EventTypes } from '../config.js';

/**
 * UUID 生成器 (UUID)
 * 優先使用 Web Crypto API 生成 v4 UUID
 * @returns {string} UUID string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export const UUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older environments (though unlikely in modern Local-First context)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/**
 * 安全 JSON 序列化 (SafeStringify)
 * 處理物件中的循環引用 (Circular References)，避免 JSON.stringify 拋出錯誤。
 * 用於 Log 記錄與 Worker 通訊。
 * 
 * @param {any} value - 要序列化的值
 * @param {number} [space=2] - 縮排空格數
 * @returns {string} JSON 字串
 */
export const SafeStringify = (value, space = 2) => {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
        if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) {
                return '[Circular]';
            }
            seen.add(val);
        }
        return val;
    }, space);
};

/**
 * 事件匯流排 (EventBus)
 * 簡單的 Pub/Sub 模式實作，用於模組間解耦。
 */
class EventBusImpl {
    constructor() {
        this.listeners = new Map();
        // [Fix] 建立合法事件白名單 Set (Flatten EventTypes)
        this.validEvents = new Set();
        this._flattenEvents(EventTypes);
    }

    _flattenEvents(obj) {
        Object.values(obj).forEach(value => {
            if (typeof value === 'object') {
                this._flattenEvents(value);
            } else {
                this.validEvents.add(value);
            }
        });
    }

    /**
     * 訂閱事件
     * @param {string} event 
     * @param {Function} callback 
     */
    on(event, callback) {
        // [Fix] 訂閱時也檢查，避免監聽不存在的事件
        if (!this.validEvents.has(event)) {
            console.warn(`[EventBus] Warning: Subscribing to unregistered event "${event}"`);
        }

        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        return () => this.off(event, callback);
    }

    /**
     * 取消訂閱
     * @param {string} event 
     * @param {Function} callback 
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * 發布事件
     * @param {string} event 
     * @param {any} payload 
     */
    emit(event, payload) {
        // [Fix] 強制檢查事件註冊表 (Global Event Registry Check)
        if (!this.validEvents.has(event)) {
            const errorMsg = `[EventBus] Critical: Attempted to emit unregistered event "${event}". This indicates a typo or logic error.`;
            console.error(errorMsg);
            // 開發模式下建議 throw Error，生產環境則至少 console.error
            throw new Error(errorMsg); 
        }

        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(payload);
                } catch (error) {
                    // 防止單一 Listener 崩潰影響其他 Listener
                    console.error(`[EventBus] Error in listener for ${event}:`, error);
                    ErrorHandler.handle(error, { context: 'EventBus', event });
                }
            });
        }
    }

    /**
     * 清除所有監聽器 (用於測試或重置)
     */
    clear() {
        this.listeners.clear();
    }
}

export const EventBus = new EventBusImpl();

/**
 * 全域錯誤處理器 (ErrorHandler)
 * 攔截未捕獲的錯誤並標準化輸出
 */
export const ErrorHandler = {
    /**
     * 初始化錯誤攔截
     */
    init() {
        window.onerror = (message, source, lineno, colno, error) => {
            this.handle(error || new Error(message), { source, lineno, colno });
            return true; // 防止預設的 console error (我們自己印)
        };

        window.onunhandledrejection = (event) => {
            this.handle(event.reason, { type: 'UnhandledRejection' });
        };
    },

    /**
     * 處理錯誤
     * @param {Error} error 
     * @param {Object} context 
     */
    handle(error, context = {}) {
        const errorReport = {
            message: error.message || String(error),
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };

        // 1. Console 輸出 (開發用)
        console.group('🚨 [System Error]');
        console.error(errorReport.message);
        console.info('Context:', context);
        if (errorReport.stack) console.debug(errorReport.stack);
        console.groupEnd();

        // 2. 發布系統事件 (讓 UI 顯示 Toast 或 LogManager 寫入日誌)
        EventBus.emit(EventTypes.SYSTEM.ERROR, errorReport);
    }
};