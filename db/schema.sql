CREATE DATABASE IF NOT EXISTS parking_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE parking_system;

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS fee_rules;
DROP TABLE IF EXISTS records;
DROP TABLE IF EXISTS spots;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(100) NOT NULL,
  name VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'operator' COMMENT 'admin/operator',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT '系统用户';

CREATE TABLE refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token CHAR(64) NOT NULL UNIQUE COMMENT '刷新令牌',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_token (token),
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '刷新令牌';

CREATE TABLE zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  remark VARCHAR(200) DEFAULT ''
) COMMENT '停车分区';

CREATE TABLE vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plate_no VARCHAR(20) NOT NULL UNIQUE COMMENT '车牌号',
  owner_name VARCHAR(50) NOT NULL COMMENT '车主姓名',
  phone VARCHAR(20) DEFAULT '',
  house_no VARCHAR(50) DEFAULT '' COMMENT '房号',
  vtype VARCHAR(20) NOT NULL DEFAULT 'resident' COMMENT 'resident住户/temp临时',
  monthly_card TINYINT NOT NULL DEFAULT 0 COMMENT '是否月卡',
  card_expire DATE NULL COMMENT '月卡到期日',
  blacklist TINYINT NOT NULL DEFAULT 0 COMMENT '黑名单',
  blacklist_reason VARCHAR(200) DEFAULT '' COMMENT '拉黑原因',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT '车辆档案';

CREATE TABLE spots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spot_no VARCHAR(20) NOT NULL UNIQUE COMMENT '车位号',
  zone_id INT NOT NULL,
  stype VARCHAR(20) NOT NULL DEFAULT 'temporary' COMMENT 'fixed固定/temporary临时',
  status VARCHAR(20) NOT NULL DEFAULT 'free' COMMENT 'free空闲/occupied占用/disabled停用',
  vehicle_id INT NULL COMMENT '固定车位绑定车辆',
  FOREIGN KEY (zone_id) REFERENCES zones(id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL
) COMMENT '车位';

CREATE TABLE fee_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  free_minutes INT NOT NULL DEFAULT 15 COMMENT '免费时长(分钟)',
  price_per_hour DECIMAL(10,2) NOT NULL DEFAULT 3.00 COMMENT '每小时单价',
  daily_cap DECIMAL(10,2) NOT NULL DEFAULT 30.00 COMMENT '每日封顶',
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 300.00 COMMENT '月卡价格/月',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT '收费规则';

CREATE TABLE records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plate_no VARCHAR(20) NOT NULL,
  spot_id INT NULL,
  entry_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  exit_time DATETIME NULL,
  fee DECIMAL(10,2) DEFAULT 0 COMMENT '应收金额',
  actual_fee DECIMAL(10,2) NULL COMMENT '实收金额',
  status VARCHAR(10) NOT NULL DEFAULT 'in' COMMENT 'in在场/out已出场',
  pay_status VARCHAR(10) NOT NULL DEFAULT 'unpaid' COMMENT 'unpaid未缴/paid已缴/free免费',
  operator VARCHAR(50) DEFAULT '',
  FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE SET NULL,
  INDEX idx_plate (plate_no),
  INDEX idx_entry (entry_time)
) COMMENT '进出场的记录';

CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  months INT NOT NULL DEFAULT 1 COMMENT '续费月数',
  amount DECIMAL(10,2) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  pay_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  remark VARCHAR(200) DEFAULT '',
  operator VARCHAR(50) DEFAULT '',
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) COMMENT '月卡缴费';

CREATE TABLE logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  detail VARCHAR(500) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT '操作日志';
