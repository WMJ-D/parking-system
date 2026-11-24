// AI 助手路由：大模型配置、会话管理、Agent 对话（支持 SSE 流式输出）
const express = require('express');
const pool = require('../db');
const { auth, adminOnly, log } = require('../auth');
const { chatCompletion, chatCompletionStream } = require('./llm');
const { toolDefs, execTool, TOOL_TITLES } = require('./tools');

const router = express.Router();

const MAX_ROUNDS = 6;          // 单次对话最多的工具调用轮次
const MAX_HISTORY = 20;        // 传给模型的历史消息条数
const MAX_MESSAGE_LEN = 2000;
const HEARTBEAT_MS = 15000;

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function parseMeta(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

async function getConfig() {
  const [rows] = await pool.query('SELECT * FROM ai_config WHERE id=1');
  return rows[0] || null;
}

function buildSystemPrompt(user) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const roleText = user.role === 'admin' ? '管理员' : '操作员';
  return `你是「智泊停车管理系统」内置的 AI 助手，服务于小区停车场日常管理。
当前用户：${user.name}（${user.username}，${roleText}）；当前时间：${time}。

## 能力
1. 数据查询：经营看板、车位、分区、车辆档案、进出记录、欠费、收入报表、月卡缴费记录、收费规则、操作日志、系统用户（仅管理员）。
2. 业务办理：登记车辆、车辆入场、车辆出场、月卡续费、结清欠费、新增车位、新增分区、修改收费规则。写操作会真实写入数据库并记录操作日志。
3. 页面导航：按用户意图调用 navigate_page 打开对应功能页面。

## 规则
- 所有数据必须来自工具返回结果，禁止编造；查不到就如实说明。
- 写操作前先确认必要参数（如车牌号、车主姓名、续费月数）；参数缺失时先询问用户，不要臆测。
- 查询结果较多时只展示最关键的部分（最多 10 条），其余用"共 N 条"概括。
- 金额保留两位小数；日期时间使用 YYYY-MM-DD HH:mm 格式。
- 使用简体中文，回答简洁、结构清晰，可用短列表。
- 不要输出工具调用的技术细节，用一句话说明查询或操作结果即可。`;
}

// 流式 tool_calls 增量拼接（OpenAI 规范：id/name 通常首块返回，arguments 分片返回）
function mergeToolCalls(acc, deltas) {
  for (const d of deltas) {
    const idx = typeof d.index === 'number' ? d.index : acc.length;
    if (!acc[idx]) acc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    const item = acc[idx];
    if (d.id) item.id = d.id;
    if (d.type) item.type = d.type;
    const name = d.function && d.function.name;
    if (name) {
      if (!item.function.name) item.function.name = name;
      else if (!item.function.name.endsWith(name)) item.function.name += name;
    }
    if (d.function && d.function.arguments) item.function.arguments += d.function.arguments;
  }
}

// Agent 循环：流式调用模型 -> 累积文本并实时回调 -> 执行工具 -> 继续下一轮
async function runAgent(cfg, user, history, message, hooks = {}) {
  const { onDelta = () => {}, onTool = () => {}, onDownload = () => {}, isAborted = () => false } = hooks;
  const messages = [
    { role: 'system', content: buildSystemPrompt(user) },
    ...history,
    { role: 'user', content: message }
  ];
  const trace = [];
  const navigate = [];
  const downloads = [];
  let fullText = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (isAborted()) return { reply: fullText.trim(), trace, navigate, downloads, aborted: true };

    let roundText = '';
    const callsAcc = [];
    for await (const chunk of chatCompletionStream(cfg, messages, toolDefs)) {
      if (chunk.content) {
        roundText += chunk.content;
        fullText += chunk.content;
        onDelta(chunk.content);
      }
      if (chunk.toolCalls) mergeToolCalls(callsAcc, chunk.toolCalls);
    }

    const calls = callsAcc.filter(Boolean);
    if (!calls.length) {
      return {
        reply: fullText.trim() || '我暂时无法回答这个问题，请换一种说法试试。',
        trace,
        navigate,
        downloads,
        aborted: false
      };
    }

    messages.push({ role: 'assistant', content: roundText, tool_calls: calls });

    for (const call of calls) {
      const name = call.function?.name || '';
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch (e) {
        args = {};
      }
      let result;
      try {
        result = await execTool(name, args, user);
      } catch (e) {
        result = { ok: false, summary: `${TOOL_TITLES[name] || name}执行失败`, error: e.message || '执行失败' };
      }
      const toolInfo = {
        name,
        title: TOOL_TITLES[name] || name,
        args,
        ok: result.ok !== false,
        summary: result.summary || result.error || ''
      };
      trace.push(toolInfo);
      onTool(toolInfo);
      if (result.navigate) navigate.push(result.navigate);
      if (result.download) {
        downloads.push(result.download);
        onDownload(result.download);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return {
    reply: (fullText.trim() ? `${fullText.trim()}\n\n` : '') + '这个需求需要的操作步骤过多，已自动停止。请拆分成更简单的查询或操作后重试。',
    trace,
    navigate,
    downloads,
    aborted: false
  };
}

/* ============================ 对话准备与持久化 ============================ */
class ChatError extends Error {
  constructor(message, needConfig = false) {
    super(message);
    this.needConfig = needConfig;
  }
}

async function prepareChat(req) {
  const message = String(req.body?.message || '').trim();
  let conversationId = Number(req.body?.conversationId) || 0;
  if (!message) throw new ChatError('请输入问题');
  if (message.length > MAX_MESSAGE_LEN) throw new ChatError(`问题过长，请控制在 ${MAX_MESSAGE_LEN} 字以内`);

  const cfg = await getConfig();
  if (!cfg || !cfg.enabled || !cfg.base_url || !cfg.api_key || !cfg.model) {
    throw new ChatError('尚未配置可用的大模型，请先在 AI 设置中填写 API 地址、API Key 和模型名称', true);
  }

  let conv = null;
  if (conversationId) {
    const [rows] = await pool.query('SELECT id FROM ai_conversations WHERE id=? AND user_id=?', [conversationId, req.user.id]);
    conv = rows[0] || null;
  }
  if (!conv) {
    const title = message.replace(/\s+/g, ' ').slice(0, 30);
    const [r] = await pool.query('INSERT INTO ai_conversations (user_id, title) VALUES (?,?)', [req.user.id, title]);
    conversationId = r.insertId;
  }

  const [histRows] = await pool.query(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id=? AND role IN ('user','assistant')
     ORDER BY id DESC LIMIT ?`, [conversationId, MAX_HISTORY]);
  const history = histRows.reverse().filter(m => m.content).map(m => ({ role: m.role, content: m.content }));

  await pool.query(
    'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?,?,?)',
    [conversationId, 'user', message]);

  return { cfg, conversationId, history, message };
}

async function persistAssistant(conversationId, reply, trace, navigate, downloads) {
  await pool.query(
    'INSERT INTO ai_messages (conversation_id, role, content, meta) VALUES (?,?,?,?)',
    [conversationId, 'assistant', reply, JSON.stringify({ trace, navigate, downloads })]);
  await pool.query('UPDATE ai_conversations SET updated_at=NOW() WHERE id=?', [conversationId]);
}

/* ============================ 大模型配置 ============================ */
router.get('/config', auth, async (req, res, next) => {
  try {
    const cfg = await getConfig();
    if (!cfg) return res.json({ code: 0, data: { configured: false, enabled: false } });
    res.json({
      code: 0,
      data: {
        base_url: cfg.base_url,
        api_key_masked: maskKey(cfg.api_key),
        model: cfg.model,
        temperature: Number(cfg.temperature),
        max_tokens: cfg.max_tokens,
        enabled: !!cfg.enabled,
        configured: !!(cfg.base_url && cfg.api_key && cfg.model),
        updated_at: cfg.updated_at
      }
    });
  } catch (e) {
    next(e);
  }
});

router.put('/config', auth, adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const cur = (await getConfig()) || {};
    const base_url = String(b.base_url !== undefined ? b.base_url : cur.base_url || '').trim().replace(/\/+$/, '');
    const model = String(b.model !== undefined ? b.model : cur.model || '').trim();
    const enabled = b.enabled === undefined ? 1 : (b.enabled ? 1 : 0);
    let api_key = cur.api_key || '';
    const incoming = typeof b.api_key === 'string' ? b.api_key.trim() : '';
    if (incoming && incoming !== '__CLEAR__' && !incoming.includes('****')) api_key = incoming;
    if (incoming === '__CLEAR__') api_key = '';
    const temperature = Number(b.temperature !== undefined ? b.temperature : (cur.temperature ?? 0.3));
    const max_tokens = Number(b.max_tokens !== undefined ? b.max_tokens : (cur.max_tokens ?? 1200));

    if (!/^https?:\/\//i.test(base_url)) return res.json({ code: 1, msg: 'API 地址需以 http:// 或 https:// 开头' });
    if (!model) return res.json({ code: 1, msg: '请填写模型名称' });
    if (!api_key) return res.json({ code: 1, msg: '请填写 API Key' });
    if (!(temperature >= 0 && temperature <= 2)) return res.json({ code: 1, msg: '温度需在 0~2 之间' });
    if (!(max_tokens >= 64 && max_tokens <= 8192)) return res.json({ code: 1, msg: '最大回复长度需在 64~8192 之间' });

    await pool.query(
      `UPDATE ai_config SET base_url=?, api_key=?, model=?, temperature=?, max_tokens=?, enabled=? WHERE id=1`,
      [base_url, api_key, model, temperature, max_tokens, enabled]);
    await log(req.user.username, '配置 AI 助手', `${base_url} ${model}`);
    res.json({ code: 0, data: { api_key_masked: maskKey(api_key), configured: true, enabled: !!enabled } });
  } catch (e) {
    next(e);
  }
});

router.post('/config/test', auth, adminOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const cur = (await getConfig()) || {};
    const cfg = {
      base_url: String(b.base_url !== undefined ? b.base_url : cur.base_url || '').trim(),
      api_key: (typeof b.api_key === 'string' && b.api_key && !b.api_key.includes('****')) ? b.api_key.trim() : (cur.api_key || ''),
      model: String(b.model !== undefined ? b.model : cur.model || '').trim(),
      temperature: 0,
      max_tokens: 32
    };
    if (!cfg.base_url || !cfg.api_key || !cfg.model) {
      return res.json({ code: 1, msg: '请先填写 API 地址、API Key 和模型名称' });
    }
    const started = Date.now();
    const msg = await chatCompletion(cfg, [{ role: 'user', content: '请只回复两个字：正常' }], []);
    res.json({ code: 0, data: { ms: Date.now() - started, reply: (msg.content || '').slice(0, 200) } });
  } catch (e) {
    res.json({ code: 1, msg: e.message || '连接失败' });
  }
});

/* ============================ 会话 ============================ */
router.get('/conversations', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, created_at, updated_at FROM ai_conversations
       WHERE user_id=? ORDER BY updated_at DESC, id DESC LIMIT 50`, [req.user.id]);
    res.json({ code: 0, data: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/conversations/:id', auth, async (req, res, next) => {
  try {
    const [conv] = await pool.query(
      'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id=? AND user_id=?',
      [req.params.id, req.user.id]);
    if (!conv.length) return res.json({ code: 1, msg: '会话不存在' });
    const [rows] = await pool.query(
      'SELECT id, role, content, meta, created_at FROM ai_messages WHERE conversation_id=? ORDER BY id',
      [conv[0].id]);
    res.json({
      code: 0,
      data: {
        conversation: conv[0],
        messages: rows.map(m => ({
          id: m.id, role: m.role, content: m.content, meta: parseMeta(m.meta), created_at: m.created_at
        }))
      }
    });
  } catch (e) {
    next(e);
  }
});

router.delete('/conversations/:id', auth, async (req, res, next) => {
  try {
    const [r] = await pool.query(
      'DELETE FROM ai_conversations WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!r.affectedRows) return res.json({ code: 1, msg: '会话不存在' });
    res.json({ code: 0 });
  } catch (e) {
    next(e);
  }
});

/* ============================ 对话（SSE 流式） ============================ */
router.post('/chat/stream', auth, async (req, res) => {
  let prepared;
  try {
    prepared = await prepareChat(req);
  } catch (e) {
    return res.json({
      code: 1,
      msg: e.message || '请求失败',
      ...(e.needConfig ? { data: { needConfig: true } } : {})
    });
  }

  const { cfg, conversationId, history, message } = prepared;

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (event, data) => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  try {
    send('meta', { conversationId });
    const { reply, trace, navigate, downloads } = await runAgent(cfg, req.user, history, message, {
      onDelta: content => send('delta', { content }),
      onTool: tool => send('tool', tool),
      onDownload: download => send('download', download),
      isAborted: () => closed
    });
    await persistAssistant(conversationId, reply, trace, navigate, downloads);
    send('done', { reply, trace, navigate, downloads });
  } catch (e) {
    console.error('[ai] stream error:', e.message);
    send('error', { message: e.message || 'AI 服务异常' });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

/* ============================ 对话（非流式，兼容保留） ============================ */
router.post('/chat', auth, async (req, res) => {
  try {
    const { cfg, conversationId, history, message } = await prepareChat(req);
    const { reply, trace, navigate, downloads } = await runAgent(cfg, req.user, history, message);
    await persistAssistant(conversationId, reply, trace, navigate, downloads);
    res.json({ code: 0, data: { conversationId, reply, trace, navigate, downloads } });
  } catch (e) {
    console.error('[ai] chat error:', e.message);
    res.json({
      code: 1,
      msg: e.message || 'AI 服务异常，请稍后重试',
      ...(e.needConfig ? { data: { needConfig: true } } : {})
    });
  }
});

router.use((err, req, res, next) => {
  console.error('[ai] error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ code: 500, msg: err.message || 'AI 服务内部错误' });
});

module.exports = router;