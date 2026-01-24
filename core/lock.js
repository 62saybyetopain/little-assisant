/**
 * src/core/lock.js
 * 儲存鎖定管理器 (The Gatekeeper)
 * 
 * @description 封裝 Web Locks API，確保跨視窗 (Cross-Tab) 的資料寫入互斥。
 * 這對於 Local-First 架構至關重要，防止兩個 Tab 同時修改同一筆資料導致衝突。
 */

export class StorageLockManager {
    constructor(lockName = 'local_first_db_write_lock') {
        this.lockName = lockName;
    }

    /**
     * 請求獨佔鎖並執行任務
     * @param {Function} task - 要執行的非同步任務
     * @param {number} [timeout=5000] - 等待鎖的超時時間 (ms)
     * @returns {Promise<any>} 任務的回傳值
     */
    async acquire(task, timeout = 5000) {
        if (!navigator.locks) {
            console.warn('[StorageLockManager] Web Locks API not supported. Running without locks.');
            return await task();
        }

        const options = { 
            mode: 'exclusive',
            ifAvailable: false // 設為 true 會直接失敗，我們希望排隊等待
        };

        // 實作 Timeout 機制，避免死鎖
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Lock acquisition timed out')), timeout);
        });

        try {
            // navigator.locks.request 本身會排隊
            const lockPromise = navigator.locks.request(this.lockName, options, async (lock) => {
                if (!lock) {
                    throw new Error('Failed to acquire lock');
                }
                // 執行實際的寫入任務
                return await task();
            });

            return await Promise.race([lockPromise, timeoutPromise]);
        } catch (error) {
            console.error(`[StorageLockManager] Lock Error: ${error.message}`);
            throw error;
        }
    }
}

// 輸出單例
export const storageLock = new StorageLockManager();