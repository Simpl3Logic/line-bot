-- 新增第二支 bot(嘻哈仔)前的資料庫遷移
-- 需要在 Cloudways 的 MySQL 上手動執行(例如透過 phpMyAdmin 或 mysql client)
-- 執行前建議先備份 linebot_conversation_history / linebot_group_settings 兩張表

-- 1. 對話記錄表:加上 bot_id,舊資料一律視為 xiao-n(既有那支 bot)
ALTER TABLE linebot_conversation_history
  ADD COLUMN bot_id VARCHAR(50) NOT NULL DEFAULT 'xiao-n' AFTER id;

ALTER TABLE linebot_conversation_history
  ADD INDEX idx_bot_group (bot_id, group_id);

-- 2. 群組設定表:加上 bot_id,舊資料一律視為 xiao-n
ALTER TABLE linebot_group_settings
  ADD COLUMN bot_id VARCHAR(50) NOT NULL DEFAULT 'xiao-n' AFTER group_id;

-- 3. 執行下面這行,確認 linebot_group_settings 原本 group_id 上的唯一鍵/主鍵名稱
--    (程式碼用 INSERT ... ON DUPLICATE KEY UPDATE,依賴這個唯一鍵才能運作)
SHOW CREATE TABLE linebot_group_settings;

-- 4. 把上一步看到的舊唯一鍵名稱代入下面的 DROP INDEX,
--    並把 group_id 的唯一鍵改成 (bot_id, group_id) 複合唯一鍵。
--    常見鍵名可能是 group_id 或 PRIMARY,依實際 SHOW CREATE TABLE 結果調整,例如:
-- ALTER TABLE linebot_group_settings DROP INDEX group_id;
ALTER TABLE linebot_group_settings
  ADD UNIQUE KEY uniq_bot_group (bot_id, group_id);

-- 完成後,新資料會依 (bot_id, group_id) 隔離;
-- 之後新增第三支 bot 時,只要在 index.js 的 BOTS 陣列多加一筆設定即可,不用再改資料庫結構。
