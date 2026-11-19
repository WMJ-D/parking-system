USE parking_system;

-- 密码均为 123456 (bcrypt)
INSERT INTO users (username, password, name, role) VALUES
('admin', '$2a$10$eEe2EivuPnobddH8KRtm7OkxvN3218wFOXZWWwXIKLT9QP0YFAoam', '系统管理员', 'admin'),
('zhangsan', '$2a$10$eEe2EivuPnobddH8KRtm7OkxvN3218wFOXZWWwXIKLT9QP0YFAoam', '张三(收费员)', 'operator');

INSERT INTO zones (name, remark) VALUES
('A区', '地面固定车位'), ('B区', '地面临时车位'), ('C区', '地下车库');

INSERT INTO vehicles (plate_no, owner_name, phone, house_no, vtype, monthly_card, card_expire) VALUES
('京A12345', '王伟', '13800000001', '1栋101', 'resident', 1, '2026-12-31'),
('京B23456', '李娜', '13800000002', '1栋102', 'resident', 1, '2026-09-30'),
('京C34567', '张强', '13800000003', '2栋201', 'resident', 0, NULL),
('京D45678', '刘洋', '13800000004', '2栋202', 'resident', 1, '2026-08-31'),
('京E56789', '陈静', '13800000005', '3栋301', 'resident', 0, NULL),
('京F67890', '杨帆', '13800000006', '3栋302', 'resident', 1, '2027-01-31'),
('京G78901', '赵磊', '13800000007', '5栋101', 'resident', 0, NULL),
('京H89012', '孙丽', '13800000008', '5栋102', 'resident', 0, NULL),
('冀J90123', '访客车辆1', '', '', 'temp', 0, NULL),
('冀K01234', '访客车辆2', '', '', 'temp', 0, NULL);

-- 车位: A区固定20 B区临时30 C区地下30
INSERT INTO spots (spot_no, zone_id, stype, status, vehicle_id)
SELECT CONCAT('A-', LPAD(n,3,'0')), 1, 'fixed', 'free', NULL FROM
(SELECT a.N + b.N*10 + 1 AS n FROM (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
(SELECT 0 AS N UNION SELECT 1) b) t WHERE n <= 20;

INSERT INTO spots (spot_no, zone_id, stype, status, vehicle_id)
SELECT CONCAT('B-', LPAD(n,3,'0')), 2, 'temporary', 'free', NULL FROM
(SELECT a.N + b.N*10 + 1 AS n FROM (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
(SELECT 0 AS N UNION SELECT 1 UNION SELECT 2) b) t WHERE n <= 30;

INSERT INTO spots (spot_no, zone_id, stype, status, vehicle_id)
SELECT CONCAT('C-', LPAD(n,3,'0')), 3, 'fixed', 'free', NULL FROM
(SELECT a.N + b.N*10 + 1 AS n FROM (SELECT 0 AS N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
(SELECT 0 AS N UNION SELECT 1 UNION SELECT 2) b) t WHERE n <= 30;

-- 固定车位绑定住户车辆
UPDATE spots s JOIN vehicles v ON v.plate_no IN ('京A12345','京B23456','京C34567','京D45678') AND s.zone_id=1
SET s.vehicle_id = v.id
WHERE s.spot_no IN ('A-001','A-002','A-003','A-004');

INSERT INTO fee_rules (id, name, free_minutes, price_per_hour, daily_cap, monthly_price) VALUES
(1, '默认临时车规则', 15, 3.00, 30.00, 300.00);

-- 部分在场车辆
INSERT INTO records (plate_no, spot_id, entry_time, status, operator) VALUES
('京E56789', (SELECT id FROM spots WHERE spot_no='C-010'), NOW() - INTERVAL 3 HOUR, 'in', 'admin'),
('冀J90123', (SELECT id FROM spots WHERE spot_no='B-001'), NOW() - INTERVAL 40 MINUTE, 'in', 'admin'),
('京G78901', (SELECT id FROM spots WHERE spot_no='C-011'), NOW() - INTERVAL 26 HOUR, 'in', 'admin'),
('京H89012', (SELECT id FROM spots WHERE spot_no='B-002'), NOW() - INTERVAL 2 HOUR, 'in', 'admin');
UPDATE spots SET status='occupied' WHERE spot_no IN ('C-010','B-001','C-011','B-002');

-- 近7日历史出场记录（用于看板趋势）
INSERT INTO records (plate_no, spot_id, entry_time, exit_time, fee, actual_fee, status, pay_status, operator)
SELECT CONCAT('京A', LPAD(1000+n,4,'0')), NULL,
       NOW() - INTERVAL d DAY - INTERVAL 5 HOUR,
       NOW() - INTERVAL d DAY - INTERVAL 3 HOUR,
       6.00, 6.00, 'out', 'paid', 'admin'
FROM (SELECT (a.N + b.N*7) AS n, (a.N + b.N*7) AS d FROM
      (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) a,
      (SELECT 0 N) b) t;

INSERT INTO logs (username, action, detail) VALUES
('admin', '系统初始化', '初始化车位、车辆与收费规则');
