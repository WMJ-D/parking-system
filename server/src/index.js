const express = require('express');
const cors = require('cors');
const {
  auth, adminOnly, log,
  issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllForUser, cleanupExpired
} = require('./auth');
const pool = require('./db');
const ExcelJS = require('exceljs');
const { computeParkingFee } = require('./fee');
const aiRoutes = require('./ai/routes');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- 登录 ----------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ code: 1, msg: '请输入账号和密码' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  if (!rows.length || !require('bcryptjs').compareSync(password, rows[0].password)) {
    return res.json({ code: 1, msg: '账号或密码错误' });
  }
  const u = rows[0];
  await cleanupExpired();
  const pair = await issueTokenPair(u);
  await log(u.username, '登录系统');
  res.json({ code: 0, data: { ...pair, user: { id: u.id, username: u.username, name: u.name, role: u.role } } });
});

// 静默续期：用 refresh token 换一对新令牌（旧 refresh token 立即作废）
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(401).json({ code: 401, msg: '缺少刷新令牌' });
  try {
    const r = await rotateRefreshToken(refreshToken);
    if (!r) return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
    res.json({ code: 0, data: { ...r } });
  } catch (e) {
    res.status(401).json({ code: 401, msg: '刷新失败，请重新登录' });
  }
});

// 退出登录：撤销 refresh token
app.post('/api/auth/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) await revokeRefreshToken(refreshToken);
  res.json({ code: 0 });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ code: 0, data: req.user }));

// 修改自己的密码
app.put('/api/auth/password', auth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const bcrypt = require('bcryptjs');
  const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!rows.length || !bcrypt.compareSync(oldPassword || '', rows[0].password)) {
    return res.json({ code: 1, msg: '原密码错误' });
  }
  if (!newPassword || newPassword.length < 6) return res.json({ code: 1, msg: '新密码至少6位' });
  await pool.query('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  // 改密码后踢掉该账号所有会话，强制重新登录
  await revokeAllForUser(req.user.id);
  await log(req.user.username, '修改密码', req.user.username);
  res.json({ code: 0 });
});

// 管理员重置用户密码
app.put('/api/users/:id/password', auth, adminOnly, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.json({ code: 1, msg: '新密码至少6位' });
  const [r] = await pool.query('UPDATE users SET password=? WHERE id=?',
    [require('bcryptjs').hashSync(newPassword, 10), req.params.id]);
  if (!r.affectedRows) return res.json({ code: 1, msg: '用户不存在' });
  await revokeAllForUser(Number(req.params.id));
  await log(req.user.username, '重置密码', `用户ID:${req.params.id}`);
  res.json({ code: 0 });
});

// ---------- 数据看板 ----------
app.get('/api/dashboard', auth, async (req, res) => {
  const [spotStat] = await pool.query(
    "SELECT COUNT(*) total, SUM(status='occupied') occupied, SUM(status='free') free, SUM(status='disabled') disabled FROM spots");
  const [todayIn] = await pool.query("SELECT COUNT(*) c FROM records WHERE DATE(entry_time)=CURDATE()");
  const [todayOut] = await pool.query("SELECT COUNT(*) c FROM records WHERE DATE(exit_time)=CURDATE()");
  const [todayIncome] = await pool.query("SELECT IFNULL(SUM(actual_fee),0) s FROM records WHERE status='out' AND DATE(exit_time)=CURDATE()");
  const [monthIncome] = await pool.query("SELECT IFNULL(SUM(actual_fee),0) s FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')");
  const [trend] = await pool.query(
    `SELECT DATE(d.dt) dt, IFNULL(SUM(r.actual_fee),0) income, COUNT(r.id) cnt
     FROM (SELECT CURDATE() - INTERVAL n DAY dt FROM (SELECT 0 N UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) a) d
     LEFT JOIN records r ON DATE(r.exit_time)=d.dt AND r.status='out'
     GROUP BY d.dt ORDER BY d.dt`);
  const [expireSoon] = await pool.query(
    "SELECT id, plate_no, owner_name, card_expire FROM vehicles WHERE monthly_card=1 AND card_expire IS NOT NULL AND card_expire <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) ORDER BY card_expire");
  const [vehicles] = await pool.query("SELECT COUNT(*) c FROM vehicles");
  const [monthlyCards] = await pool.query("SELECT COUNT(*) c FROM vehicles WHERE monthly_card=1");
  // 车位类型统计：固定/临时的总数与占用数，固定车位绑定率
  const [typeStat] = await pool.query(
    "SELECT stype, COUNT(*) total, SUM(status='occupied') occupied, SUM(vehicle_id IS NOT NULL) bound FROM spots GROUP BY stype");
  const fixed = typeStat.find(r => r.stype === 'fixed') || { total: 0, occupied: 0, bound: 0 };
  const temporary = typeStat.find(r => r.stype === 'temporary') || { total: 0, occupied: 0, bound: 0 };
  const bindRate = Number(fixed.total) ? Math.round(Number(fixed.bound) / Number(fixed.total) * 100) : 0;
  // 长时间停车预警：场内超24小时
  const [longStay] = await pool.query(
    `SELECT r.plate_no, r.entry_time, s.spot_no, TIMESTAMPDIFF(HOUR, r.entry_time, NOW()) h
     FROM records r LEFT JOIN spots s ON s.id=r.spot_id
     WHERE r.status='in' AND r.entry_time < NOW() - INTERVAL 24 HOUR ORDER BY r.entry_time`);
  res.json({ code: 0, data: {
    spots: spotStat[0], todayIn: todayIn[0].c, todayOut: todayOut[0].c,
    todayIncome: todayIncome[0].s, monthIncome: monthIncome[0].s,
    trend, expireSoon, vehicles: vehicles[0].c, monthlyCards: monthlyCards[0].c,
    longStay,
    spotTypes: {
      fixed: { total: Number(fixed.total), occupied: Number(fixed.occupied), bound: Number(fixed.bound) },
      temporary: { total: Number(temporary.total), occupied: Number(temporary.occupied) },
      bindRate
    }
  }});
});

// ---------- 欠费管理 ----------
// 按车牌汇总未缴出场记录
app.get('/api/debts', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT plate_no, COUNT(*) cnt, SUM(fee) total, MAX(exit_time) last_time
     FROM records WHERE status='out' AND pay_status='unpaid' AND fee>0
     GROUP BY plate_no ORDER BY total DESC`);
  res.json({ code: 0, data: rows });
});

// 结清某车牌全部欠费
app.post('/api/debts/settle', auth, async (req, res) => {
  const { plate_no } = req.body;
  if (!plate_no) return res.json({ code: 1, msg: '缺少车牌号' });
  const [[{ cnt, total }]] = await pool.query(
    "SELECT COUNT(*) cnt, IFNULL(SUM(fee),0) total FROM records WHERE plate_no=? AND status='out' AND pay_status='unpaid' AND fee>0", [plate_no]);
  if (!cnt) return res.json({ code: 1, msg: '该车牌没有未缴记录' });
  await pool.query(
    "UPDATE records SET pay_status='paid', actual_fee=fee WHERE plate_no=? AND status='out' AND pay_status='unpaid' AND fee>0", [plate_no]);
  await log(req.user.username, '结清欠费', `${plate_no} ${cnt}笔 ¥${total}`);
  res.json({ code: 0, data: { cnt, total: Number(total) } });
});

// 某车牌的欠费明细
app.get('/api/debts/detail', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, s.spot_no FROM records r LEFT JOIN spots s ON s.id=r.spot_id
     WHERE r.plate_no=? AND r.status='out' AND r.pay_status='unpaid' ORDER BY r.exit_time DESC`, [req.query.plate_no]);
  res.json({ code: 0, data: rows });
});

// ---------- 收入报表 ----------
app.get('/api/reports/income', auth, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const [daily] = await pool.query(
    `SELECT DATE(exit_time) d, COUNT(*) cnt, IFNULL(SUM(actual_fee),0) income
     FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=?
     GROUP BY DATE(exit_time) ORDER BY d`, [month]);
  const [sum] = await pool.query(
    `SELECT COUNT(*) cnt, IFNULL(SUM(actual_fee),0) income FROM records
     WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=?`, [month]);
  res.json({ code: 0, data: { month, daily, total: { cnt: sum[0].cnt, income: Number(sum[0].income) } } });
});

// ---------- 导出 Excel ----------
function exportStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function sendExcel(res, filename, sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns;
  const head = ws.getRow(1);
  head.font = { bold: true, size: 11 };
  head.height = 22;
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F7' } };
  head.alignment = { vertical: 'middle' };
  for (const row of rows) ws.addRow(row);
  const lastCol = String.fromCharCode(64 + columns.length);
  ws.autoFilter = { from: 'A1', to: `${lastCol}1` };

  const encoded = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
  await wb.xlsx.write(res);
  res.end();
}

app.get('/api/export/records', auth, async (req, res, next) => {
  try {
    const start = req.query.start || '2000-01-01';
    const end = req.query.end || '2099-12-31';
    const [rows] = await pool.query(
      `SELECT r.*, s.spot_no FROM records r LEFT JOIN spots s ON s.id=r.spot_id
       WHERE r.entry_time >= ? AND r.entry_time <= ? ORDER BY r.id DESC`, [start, end + ' 23:59:59']);
    await log(req.user.username, '导出记录', `${start}~${end} 共${rows.length}条`);
    await sendExcel(res, `进出记录_${start}_${end}.xlsx`, '进出记录', [
      { header: '车牌号', width: 14 },
      { header: '车位', width: 12 },
      { header: '入场时间', width: 20 },
      { header: '出场时间', width: 20 },
      { header: '应收(元)', width: 12 },
      { header: '实收(元)', width: 12 },
      { header: '状态', width: 10 },
      { header: '缴费状态', width: 10 },
      { header: '操作员', width: 14 }
    ], rows.map(r => [r.plate_no, r.spot_no || '', r.entry_time, r.exit_time || '', Number(r.fee || 0), r.actual_fee ?? '',
      r.status === 'in' ? '在场' : '已出场', { paid: '已缴', free: '免费', unpaid: '未缴' }[r.pay_status] || r.pay_status, r.operator]));
  } catch (e) {
    next(e);
  }
});

app.get('/api/export/income', auth, async (req, res, next) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const [rows] = await pool.query(
      `SELECT DATE(exit_time) d, COUNT(*) cnt, IFNULL(SUM(actual_fee),0) income
       FROM records WHERE status='out' AND DATE_FORMAT(exit_time,'%Y-%m')=?
       GROUP BY DATE(exit_time) ORDER BY d`, [month]);
    await log(req.user.username, '导出收入报表', month);
    await sendExcel(res, `收入报表_${month}.xlsx`, '收入报表', [
      { header: '日期', width: 14 },
      { header: '出场车次', width: 12 },
      { header: '收入(元)', width: 14 }
    ], rows.map(r => [String(r.d).slice(0, 10), Number(r.cnt), Number(r.income)]));
  } catch (e) {
    next(e);
  }
});

app.get('/api/export/logs', auth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10000, 1), 50000);
    const [rows] = await pool.query(
      'SELECT created_at, username, action, detail FROM logs ORDER BY id DESC LIMIT ?', [limit]);
    await log(req.user.username, '导出操作日志', `共${rows.length}条`);
    await sendExcel(res, `操作日志_${exportStamp()}.xlsx`, '操作日志', [
      { header: '时间', width: 20 },
      { header: '操作人', width: 14 },
      { header: '操作', width: 18 },
      { header: '详情', width: 60 }
    ], rows.map(r => [r.created_at, r.username, r.action, r.detail || '']));
  } catch (e) {
    next(e);
  }
});

// ---------- 车位 ----------
app.get('/api/spots', auth, async (req, res) => {
  const { zone_id, status, keyword, page = 1, size = 10 } = req.query;
  const conds = []; const params = [];
  if (zone_id) { conds.push('s.zone_id = ?'); params.push(zone_id); }
  if (status) { conds.push('s.status = ?'); params.push(status); }
  if (keyword) { conds.push('(s.spot_no LIKE ? OR v.plate_no LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) total FROM spots s JOIN zones z ON z.id=s.zone_id LEFT JOIN vehicles v ON v.id=s.vehicle_id ${where}`, params);
  const [rows] = await pool.query(
    `SELECT s.*, z.name zone_name, v.plate_no, v.owner_name
     FROM spots s JOIN zones z ON z.id=s.zone_id LEFT JOIN vehicles v ON v.id=s.vehicle_id
     ${where} ORDER BY s.spot_no LIMIT ? OFFSET ?`,
    [...params, Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

// 车位图：全部车位（不分页）
app.get('/api/spots/map', auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, z.name zone_name, v.plate_no, v.owner_name, v.phone
     FROM spots s JOIN zones z ON z.id=s.zone_id LEFT JOIN vehicles v ON v.id=s.vehicle_id
     ORDER BY z.id, s.spot_no`);
  res.json({ code: 0, data: rows });
});

app.post('/api/spots', auth, async (req, res) => {
  const { spot_no, zone_id, stype, vehicle_id } = req.body;
  if (!spot_no || !zone_id) return res.json({ code: 1, msg: '车位号和分区必填' });
  try {
    await pool.query('INSERT INTO spots (spot_no, zone_id, stype, status, vehicle_id) VALUES (?,?,?,?,?)',
      [spot_no, zone_id, stype || 'temporary', 'free', vehicle_id || null]);
    await log(req.user.username, '新增车位', spot_no);
    res.json({ code: 0 });
  } catch (e) {
    res.json({ code: 1, msg: e.code === 'ER_DUP_ENTRY' ? '车位号已存在' : '创建失败' });
  }
});

app.put('/api/spots/:id', auth, async (req, res) => {
  const { spot_no, zone_id, stype, status, vehicle_id } = req.body;
  const [cur] = await pool.query('SELECT * FROM spots WHERE id=?', [req.params.id]);
  if (!cur.length) return res.json({ code: 1, msg: '车位不存在' });
  const newStatus = status || cur[0].status;
  if (newStatus === 'free' && cur[0].status === 'occupied') return res.json({ code: 1, msg: '车位有在场车辆，请先办理出场' });
  await pool.query('UPDATE spots SET spot_no=?, zone_id=?, stype=?, status=?, vehicle_id=? WHERE id=?',
    [spot_no ?? cur[0].spot_no, zone_id ?? cur[0].zone_id, stype ?? cur[0].stype, newStatus,
     vehicle_id !== undefined ? (vehicle_id || null) : cur[0].vehicle_id, req.params.id]);
  await log(req.user.username, '修改车位', spot_no);
  res.json({ code: 0 });
});

app.delete('/api/spots/:id', auth, async (req, res) => {
  const [cur] = await pool.query('SELECT * FROM spots WHERE id=?', [req.params.id]);
  if (!cur.length) return res.json({ code: 1, msg: '车位不存在' });
  if (cur[0].status === 'occupied') return res.json({ code: 1, msg: '车位占用中，不可删除' });
  await pool.query('DELETE FROM spots WHERE id=?', [req.params.id]);
  await log(req.user.username, '删除车位', cur[0].spot_no);
  res.json({ code: 0 });
});

app.get('/api/zones', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM zones ORDER BY id');
  res.json({ code: 0, data: rows });
});

app.post('/api/zones', auth, async (req, res) => {
  const { name, remark } = req.body;
  if (!name) return res.json({ code: 1, msg: '分区名称必填' });
  const [r] = await pool.query('INSERT INTO zones (name, remark) VALUES (?,?)', [name, remark || '']);
  await log(req.user.username, '新增分区', name);
  res.json({ code: 0, data: { id: r.insertId } });
});

// ---------- 车辆 ----------
app.get('/api/vehicles', auth, async (req, res) => {
  const { keyword, vtype, monthly, blacklist, page = 1, size = 10 } = req.query;
  const conds = []; const params = [];
  if (keyword) { conds.push('(plate_no LIKE ? OR owner_name LIKE ? OR phone LIKE ? OR house_no LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  if (vtype) { conds.push('vtype = ?'); params.push(vtype); }
  if (monthly !== undefined && monthly !== '') { conds.push('monthly_card = ?'); params.push(monthly); }
  if (blacklist !== undefined && blacklist !== '') { conds.push('blacklist = ?'); params.push(blacklist); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM vehicles ${where}`, params);
  const [rows] = await pool.query(`SELECT * FROM vehicles ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

app.post('/api/vehicles', auth, async (req, res) => {
  const { plate_no, owner_name, phone, house_no, vtype, monthly_card, card_expire } = req.body;
  if (!plate_no || !owner_name) return res.json({ code: 1, msg: '车牌号和车主姓名必填' });
  try {
    await pool.query(
      'INSERT INTO vehicles (plate_no, owner_name, phone, house_no, vtype, monthly_card, card_expire) VALUES (?,?,?,?,?,?,?)',
      [plate_no, owner_name, phone || '', house_no || '', vtype || 'resident', monthly_card ? 1 : 0,
       monthly_card ? (card_expire || null) : null]);
    await log(req.user.username, '新增车辆', plate_no);
    res.json({ code: 0 });
  } catch (e) {
    res.json({ code: 1, msg: e.code === 'ER_DUP_ENTRY' ? '该车牌已存在' : '创建失败' });
  }
});

// 拉黑 / 移出黑名单
app.put('/api/vehicles/:id/blacklist', auth, async (req, res) => {
  const { blacklist, reason } = req.body;
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
  if (!veh.length) return res.json({ code: 1, msg: '车辆不存在' });
  const [inRec] = await pool.query("SELECT id FROM records WHERE plate_no=? AND status='in'", [veh[0].plate_no]);
  if (blacklist && inRec.length) return res.json({ code: 1, msg: '该车辆在场内，请先办理出场后再拉黑' });
  await pool.query('UPDATE vehicles SET blacklist=?, blacklist_reason=? WHERE id=?',
    [blacklist ? 1 : 0, blacklist ? (reason || '未填写') : '', req.params.id]);
  await log(req.user.username, blacklist ? '车辆拉黑' : '移出黑名单', `${veh[0].plate_no} ${reason || ''}`);
  res.json({ code: 0 });
});

app.put('/api/vehicles/:id', auth, async (req, res) => {
  const [cur] = await pool.query('SELECT * FROM vehicles WHERE id=?', [req.params.id]);
  if (!cur.length) return res.json({ code: 1, msg: '车辆不存在' });
  const b = req.body;
  const mc = b.monthly_card !== undefined ? (b.monthly_card ? 1 : 0) : cur[0].monthly_card;
  await pool.query(
    'UPDATE vehicles SET plate_no=?, owner_name=?, phone=?, house_no=?, vtype=?, monthly_card=?, card_expire=? WHERE id=?',
    [b.plate_no ?? cur[0].plate_no, b.owner_name ?? cur[0].owner_name, b.phone ?? cur[0].phone,
     b.house_no ?? cur[0].house_no, b.vtype ?? cur[0].vtype, mc,
     mc ? (b.card_expire ?? cur[0].card_expire) : null, req.params.id]);
  await log(req.user.username, '修改车辆', b.plate_no || cur[0].plate_no);
  res.json({ code: 0 });
});

app.delete('/api/vehicles/:id', auth, async (req, res) => {
  const [inRec] = await pool.query("SELECT id FROM records WHERE plate_no=(SELECT plate_no FROM vehicles WHERE id=?) AND status='in'", [req.params.id]);
  if (inRec.length) return res.json({ code: 1, msg: '该车辆在场内，不可删除' });
  const [cur] = await pool.query('DELETE FROM vehicles WHERE id=?', [req.params.id]);
  if (!cur.affectedRows) return res.json({ code: 1, msg: '车辆不存在' });
  await log(req.user.username, '删除车辆', `ID:${req.params.id}`);
  res.json({ code: 0 });
});

// ---------- 进出场 ----------

app.get('/api/records', auth, async (req, res) => {
  const { status, keyword, start, end, page = 1, size = 10 } = req.query;
  const conds = []; const params = [];
  if (status) { conds.push('r.status = ?'); params.push(status); }
  if (keyword) { conds.push('r.plate_no LIKE ?'); params.push(`%${keyword}%`); }
  if (start) { conds.push('r.entry_time >= ?'); params.push(start); }
  if (end) { conds.push('r.entry_time <= ?'); params.push(end + ' 23:59:59'); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM records r ${where}`, params);
  const [rows] = await pool.query(
    `SELECT r.*, s.spot_no FROM records r LEFT JOIN spots s ON s.id = r.spot_id
     ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, [...params, Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

// 入场
app.post('/api/records/entry', auth, async (req, res) => {
  const { plate_no } = req.body;
  if (!plate_no) return res.json({ code: 1, msg: '请输入车牌号' });
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no = ?', [plate_no]);
  if (!veh.length) return res.json({ code: 1, msg: '该车辆未登记，请先在车辆管理中登记', data: { needRegister: true } });
  if (veh[0].blacklist === 1) {
    await log(req.user.username, '黑名单拦截', `${plate_no} 拒绝入场`);
    return res.json({ code: 1, msg: `该车辆已被列入黑名单，禁止入场（原因：${veh[0].blacklist_reason || '未填写'}）`, data: { blocked: true } });
  }
  // 历史欠费提示
  const [[{ debt }]] = await pool.query(
    "SELECT IFNULL(SUM(fee),0) debt FROM records WHERE plate_no=? AND status='out' AND pay_status='unpaid'", [plate_no]);
  const [inRec] = await pool.query("SELECT id FROM records WHERE plate_no=? AND status='in'", [plate_no]);
  if (inRec.length) return res.json({ code: 1, msg: '该车辆已在场内，请勿重复入场' });

  // 优先分配：固定车未占用的本车固定车位 -> 同类型空闲 -> 任意空闲
  let spot = null;
  const [fixed] = await pool.query(
    "SELECT * FROM spots WHERE vehicle_id=(SELECT id FROM vehicles WHERE plate_no=?) AND status='free' LIMIT 1", [plate_no]);
  if (fixed.length) spot = fixed[0];
  if (!spot) {
    const pref = veh[0].vtype === 'temp' ? 'temporary' : 'fixed';
    const [same] = await pool.query("SELECT * FROM spots WHERE status='free' AND stype=? ORDER BY RAND() LIMIT 1", [pref]);
    spot = same[0] || null;
  }
  if (!spot) {
    const [any] = await pool.query("SELECT * FROM spots WHERE status='free' ORDER BY RAND() LIMIT 1");
    spot = any[0] || null;
  }
  if (!spot) return res.json({ code: 1, msg: '当前无空闲车位' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE spots SET status='occupied' WHERE id=?", [spot.id]);
    const [r] = await conn.query('INSERT INTO records (plate_no, spot_id, status, operator) VALUES (?,?,?,?)',
      [plate_no, spot.id, 'in', req.user.name]);
    await conn.commit();
    await log(req.user.username, '车辆入场', `${plate_no} -> ${spot.spot_no}`);
    res.json({ code: 0, data: { recordId: r.insertId, spotNo: spot.spot_no, debt: Number(debt) || 0 } });
  } catch (e) {
    await conn.rollback();
    res.json({ code: 1, msg: '入场失败' });
  } finally {
    conn.release();
  }
});

// 预估费用 / 出场结算预览
app.get('/api/records/:id/fee', auth, async (req, res) => {
  const [recs] = await pool.query('SELECT * FROM records WHERE id=?', [req.params.id]);
  if (!recs.length || recs[0].status !== 'in') return res.json({ code: 1, msg: '记录不存在或已出场' });
  const rec = recs[0];
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no=?', [rec.plate_no]);
  const [rules] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  const calc = computeParkingFee(rec, veh[0] || null, rules[0]);
  res.json({ code: 0, data: { hours: Math.round(calc.hours * 10) / 10, fee: calc.fee,
    free: calc.free, cardCoveredUntil: calc.cardCoveredUntil, rule: rules[0],
    vehicle: veh[0] || null, spot_no: rec.spot_id ? null : undefined } });
});

// 出场
app.post('/api/records/:id/exit', auth, async (req, res) => {
  const [recs] = await pool.query('SELECT * FROM records WHERE id=?', [req.params.id]);
  if (!recs.length || recs[0].status !== 'in') return res.json({ code: 1, msg: '记录不存在或已出场' });
  const rec = recs[0];
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE plate_no=?', [rec.plate_no]);
  const [rules] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  const calc = computeParkingFee(rec, veh[0] || null, rules[0]);
  const fee = calc.fee;
  const actual = req.body.unpaid ? 0 : (req.body.actual_fee !== undefined ? Number(req.body.actual_fee) : fee);
  // 未缴放行（逃费/挂账）记 unpaid，正常收款记 paid，0元免费记 free
  const payStatus = (req.body.unpaid && fee > 0) ? 'unpaid' : (actual > 0 ? 'paid' : 'free');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE records SET status='out', exit_time=NOW(), fee=?, actual_fee=?, pay_status=? WHERE id=?",
      [fee, actual, payStatus, rec.id]);
    if (rec.spot_id) {
      // 若为固定车位且绑定车辆则恢复 free；临时车位也恢复 free
      await conn.query("UPDATE spots SET status='free' WHERE id=? AND status='occupied'", [rec.spot_id]);
    }
    await conn.commit();
    await log(req.user.username, '车辆出场', `${rec.plate_no} 收费 ${actual} 元`);
    res.json({ code: 0, data: { fee, actual } });
  } catch (e) {
    await conn.rollback();
    res.json({ code: 1, msg: '出场失败' });
  } finally {
    conn.release();
  }
});

// 缴费确认（未出场先缴费）
app.post('/api/records/:id/pay', auth, async (req, res) => {
  await pool.query("UPDATE records SET pay_status='paid', actual_fee=? WHERE id=? AND status='in'",
    [Number(req.body.actual_fee) || 0, req.params.id]);
  await log(req.user.username, '预缴费', `记录ID:${req.params.id}`);
  res.json({ code: 0 });
});

// ---------- 收费规则 ----------
app.get('/api/rules', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM fee_rules ORDER BY id');
  res.json({ code: 0, data: rows });
});

app.put('/api/rules/:id', auth, async (req, res) => {
  const { free_minutes, price_per_hour, daily_cap, monthly_price, name } = req.body;
  await pool.query('UPDATE fee_rules SET name=?, free_minutes=?, price_per_hour=?, daily_cap=?, monthly_price=? WHERE id=?',
    [name, free_minutes, price_per_hour, daily_cap, monthly_price, req.params.id]);
  await log(req.user.username, '修改收费规则', `ID:${req.params.id}`);
  res.json({ code: 0 });
});

// ---------- 月卡缴费 ----------
app.get('/api/payments', auth, async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) total FROM payments');
  const [rows] = await pool.query(
    `SELECT p.*, v.plate_no, v.owner_name FROM payments p JOIN vehicles v ON v.id=p.vehicle_id
     ORDER BY p.id DESC LIMIT ? OFFSET ?`, [Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

app.post('/api/payments', auth, async (req, res) => {
  const { vehicle_id, months, remark } = req.body;
  if (!vehicle_id || !months || months < 1) return res.json({ code: 1, msg: '请选择车辆和续费月数' });
  const [veh] = await pool.query('SELECT * FROM vehicles WHERE id=?', [vehicle_id]);
  if (!veh.length) return res.json({ code: 1, msg: '车辆不存在' });
  const [rules] = await pool.query('SELECT * FROM fee_rules ORDER BY id LIMIT 1');
  const amount = Number(rule0(rules).monthly_price) * months;
  // 起始日期：当前月卡未到期则顺延
  const cur = veh[0].card_expire ? new Date(veh[0].card_expire + ' 23:59:59') : null;
  const start = cur && cur > new Date() ? new Date(cur.getTime() + 86400000) : new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + Number(months));
  const fmt = d => d.toISOString().slice(0, 10);
  await pool.query(
    'INSERT INTO payments (vehicle_id, months, amount, start_date, end_date, remark, operator) VALUES (?,?,?,?,?,?,?)',
    [vehicle_id, months, amount, fmt(start), fmt(end), remark || '', req.user.name]);
  await pool.query('UPDATE vehicles SET monthly_card=1, card_expire=? WHERE id=?', [fmt(end), vehicle_id]);
  await log(req.user.username, '月卡续费', `${veh[0].plate_no} ${months}个月 ¥${amount}`);
  res.json({ code: 0, data: { amount, end_date: fmt(end) } });
});
function rule0(rules) { return rules[0] || { monthly_price: 300 }; }

// ---------- 系统用户 ----------
app.get('/api/users', auth, adminOnly, async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) total FROM users');
  const [rows] = await pool.query('SELECT id, username, name, role, created_at FROM users ORDER BY id LIMIT ? OFFSET ?',
    [Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.json({ code: 1, msg: '账号、密码、姓名必填' });
  try {
    const hash = require('bcryptjs').hashSync(password, 10);
    await pool.query('INSERT INTO users (username, password, name, role) VALUES (?,?,?,?)',
      [username, hash, name, role === 'admin' ? 'admin' : 'operator']);
    await log(req.user.username, '新增用户', username);
    res.json({ code: 0 });
  } catch (e) {
    res.json({ code: 1, msg: e.code === 'ER_DUP_ENTRY' ? '账号已存在' : '创建失败' });
  }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.json({ code: 1, msg: '不能删除自己' });
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  await log(req.user.username, '删除用户', `ID:${req.params.id}`);
  res.json({ code: 0 });
});

// ---------- 日志 ----------
app.get('/api/logs', auth, async (req, res) => {
  const { page = 1, size = 10 } = req.query;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) total FROM logs');
  const [rows] = await pool.query('SELECT * FROM logs ORDER BY id DESC LIMIT ? OFFSET ?',
    [Number(size), (page - 1) * Number(size)]);
  res.json({ code: 0, data: { list: rows, total } });
});

// ---------- AI 助手 ----------
app.use('/api/ai', aiRoutes);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`parking-server listening on http://localhost:${PORT}`));
