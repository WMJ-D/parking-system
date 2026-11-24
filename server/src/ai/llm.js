// OpenAI 兼容大模型客户端：支持流式（SSE）与非流式调用
const TIMEOUT_MS = 60000;
const STREAM_TIMEOUT_MS = 120000;

// 兼容用户填写的两种地址：
//   1. https://api.deepseek.com/v1        → 补 /chat/completions
//   2. https://api.deepseek.com/v1/chat/completions → 原样使用
function resolveUrl(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  return /\/chat\/completions$/i.test(b) ? b : `${b}/chat/completions`;
}

function buildPayload(cfg, messages, tools, stream) {
  const payload = {
    model: cfg.model,
    messages,
    temperature: Number(cfg.temperature ?? 0.3),
    max_tokens: Number(cfg.max_tokens || 1200),
    stream: !!stream
  };
  if (tools && tools.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }
  return payload;
}

async function requestCompletion(cfg, messages, tools, stream) {
  const url = resolveUrl(cfg.base_url);
  if (!url) throw new Error('未配置大模型 API 地址');
  if (!cfg.api_key) throw new Error('未配置大模型 API Key');
  if (!cfg.model) throw new Error('未配置模型名称');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${cfg.api_key}`
      },
      body: JSON.stringify(buildPayload(cfg, messages, tools, stream)),
      signal: AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : TIMEOUT_MS)
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(stream ? '模型响应超时（120 秒），请稍后重试' : '模型响应超时（60 秒），请稍后重试');
    }
    if (String(e.message || '').includes('ECONNREFUSED')) {
      throw new Error('无法连接模型服务，请检查 API 地址是否正确');
    }
    throw new Error(`模型请求失败：${e.message || '网络异常'}`);
  }

  if (!res.ok) {
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* 非 JSON 错误体 */ }
    const msg = data?.error?.message || data?.message || text.slice(0, 300);
    if (res.status === 401) throw new Error('模型接口鉴权失败（401），请检查 API Key');
    if (res.status === 404) throw new Error('模型接口地址不存在（404），请检查 API 地址与模型名称');
    throw new Error(`模型接口错误（HTTP ${res.status}）：${msg}`);
  }
  return res;
}

/* ---------------- 非流式（用于配置页连接测试） ---------------- */
async function chatCompletion(cfg, messages, tools = []) {
  const res = await requestCompletion(cfg, messages, tools, false);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('模型返回非 JSON 内容');
  }
  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error('模型返回结果为空');
  return msg;
}

/* ---------------- 流式（用于 AI 对话） ---------------- */
// 逐块产出 { content, toolCalls }；兼容不支持 SSE 的网关（自动降级为整包返回）
async function* chatCompletionStream(cfg, messages, tools = []) {
  const res = await requestCompletion(cfg, messages, tools, true);
  const contentType = res.headers.get('content-type') || '';

  // 网关忽略 stream 参数时，按普通 JSON 响应处理
  if (!contentType.includes('text/event-stream')) {
    let data;
    try {
      data = JSON.parse(await res.text());
    } catch (e) {
      throw new Error('模型返回无法解析的内容');
    }
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('模型返回结果为空');
    if (msg.content) yield { content: String(msg.content), toolCalls: null };
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      yield { content: '', toolCalls: msg.tool_calls.map((tc, i) => ({ index: i, ...tc })) };
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseLine = function (raw) {
    const line = raw.trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return null;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    let json;
    try { json = JSON.parse(payload); } catch (e) { return null; }
    const choice = json?.choices?.[0] || {};
    const delta = choice.delta || {};
    const content = typeof delta.content === 'string' ? delta.content : '';
    const toolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length ? delta.tool_calls : null;
    if (!content && !toolCalls) return null;
    return { content, toolCalls };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const chunk = parseLine(line);
        if (chunk) yield chunk;
      }
    }
    // 处理最后一行没有换行符的残留
    if (buffer.trim()) {
      const chunk = parseLine(buffer);
      if (chunk) yield chunk;
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
  }
}

module.exports = { chatCompletion, chatCompletionStream, resolveUrl, TIMEOUT_MS, STREAM_TIMEOUT_MS };