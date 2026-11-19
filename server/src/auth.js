const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');

const SECRET = 'parking-system-secret-2026';

// access token 有效期（秒）：短一些，靠 refresh token 静默续期
const ACCESS_TTL = 30 * 60;
// refresh token 有效期（天）：每次刷新都会滑动顺延，活跃用户永不掉线
const REFRESH_TTL_DAYS = 7;

function signAccessToken(user) {
  return jwt.sign({ id: user.id, username: user.username, type: 'access' }, SECRET, { expiresIn: ACCESS_TTL });
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 位十六进制
}

// 签发 refresh token 并落库（支持服务端撤销）
async function issueRefreshToken(userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);
  await pool.query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?,?,?)',
    [userId, token, expires]);
  return { refreshToken: token, refreshExpiresAt: expires.toISOString() };
}

// 清理已过期的刷新令牌，避免表无限增长
async function cleanupExpired() {
  try {
    await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
  } catch (e) { /* 清理失败不影响主流程 */ }
}

// 登录时一次性签发 access + refresh
async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const rt = await issueRefreshToken(user.id);
  return {
    token: accessToken,
    refreshToken: rt.refreshToken,
    expiresIn: ACCESS_TTL,
    refreshExpiresIn: REFRESH_TTL_DAYS * 86400,
    refreshExpiresAt: rt.refreshExpiresAt
  };
}

// 刷新：校验 -> 旧 refresh token 立即作废（旋转）-> 签发全新一对
// 返回 null 表示 refresh token 无效/过期
async function rotateRefreshToken(token) {
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT rt.id, rt.user_id, rt.expires_at, u.username, u.name, u.role
     FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token = ?`, [token]);
  if (!rows.length) return null;
  const row = rows[0];
  // 过期则顺手删掉
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
    return null;
  }
  // 旋转：旧的立即失效，防止被重放
  await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [row.id]);
  const user = { id: row.user_id, username: row.username, name: row.name, role: row.role };
  const pair = await issueTokenPair(user);
  return { ...pair, user };
}

// 撤销单个刷新令牌（退出登录）
async function revokeRefreshToken(token) {
  if (!token) return;
  await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
}

// 撤销某用户全部刷新令牌（改密码 / 被删号时强制下线所有会话）
async function revokeAllForUser(userId) {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' });
  try {
    const payload = jwt.verify(token, SECRET);
    // 只接受 access token，防止拿 refresh token 直接当访问凭证
    if (payload.type !== 'access') {
      return res.status(401).json({ code: 401, msg: '令牌类型错误' });
    }
    const [rows] = await pool.query('SELECT id, username, name, role FROM users WHERE id = ?', [payload.id]);
    if (!rows.length) return res.status(401).json({ code: 401, msg: '用户不存在' });
    req.user = rows[0];
    next();
  } catch (e) {
    const expired = e.name === 'TokenExpiredError';
    return res.status(401).json({ code: 401, msg: expired ? '登录已过期' : '登录状态无效', expired });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ code: 403, msg: '需要管理员权限' });
  next();
}

async function log(username, action, detail = '') {
  try {
    await pool.query('INSERT INTO logs (username, action, detail) VALUES (?, ?, ?)', [username, action, String(detail).slice(0, 490)]);
  } catch (e) { /* 日志失败不影响主流程 */ }
}

module.exports = {
  auth, adminOnly, log, SECRET,
  ACCESS_TTL, REFRESH_TTL_DAYS,
  signAccessToken, issueTokenPair, issueRefreshToken,
  rotateRefreshToken, revokeRefreshToken, revokeAllForUser, cleanupExpired
};
