-- 群組記憶功能需要的資料表
-- 需要在 Cloudways 的 MySQL 上手動執行(phpMyAdmin 或 mysql client)

CREATE TABLE linebot_group_memory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bot_id VARCHAR(50) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  memory_key VARCHAR(100) NOT NULL,
  memory_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bot_group_key (bot_id, group_id, memory_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
