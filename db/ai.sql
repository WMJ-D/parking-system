-- AI 助手升级脚本（已有库可直接执行，幂等）
-- mysql -uroot -p123456 --default-character-set=utf8mb4 < db/ai.sql
USE parking_system;

CREATE TABLE IF NOT EXISTS ai_config (
  id TINYINT PRIMARY KEY DEFAULT 1,
  base_url VARCHAR(300) NOT NULL DEFAULT '' COMMENT 'OpenAI 兼容接口地址',
  api_key VARCHAR(500) NOT NULL DEFAULT '',
  model VARCHAR(100) NOT NULL DEFAULT '' COMMENT '模型名称',
  temperature DECIMAL(3,2) NOT NULL DEFAULT 0.30,
  max_tokens INT NOT NULL DEFAULT 1200,
  enabled TINYINT NOT NULL DEFAULT 0 COMMENT '是否启用',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT 'AI 大模型配置（单行）';
INSERT IGNORE INTO ai_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(100) NOT NULL DEFAULT '新对话',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_conv_user (user_id)
) COMMENT 'AI 会话';

CREATE TABLE IF NOT EXISTS ai_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  role VARCHAR(20) NOT NULL COMMENT 'user/assistant',
  content MEDIUMTEXT,
  meta JSON NULL COMMENT '工具执行轨迹与页面跳转指令',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_msg_conv (conversation_id),
  CONSTRAINT fk_ai_msg_conv FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
) COMMENT 'AI 消息';