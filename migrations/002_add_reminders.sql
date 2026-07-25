-- 排程提醒功能需要的資料表
-- 需要在 Cloudways 的 MySQL 上手動執行(phpMyAdmin 或 mysql client)

CREATE TABLE linebot_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bot_id VARCHAR(50) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  remind_at DATETIME NOT NULL,
  is_sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pending (is_sent, remind_at),
  INDEX idx_bot_group (bot_id, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 注意:remind_at 一律以 UTC 存取(程式碼的 mysql2 連線池設定了 timezone: 'Z'),
-- 不依賴 MySQL 伺服器本身的時區設定,不需要另外調整資料庫的 time_zone。
