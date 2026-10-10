// AI 教练:代理到 DeepSeek 兼容的 Chat Completions API(非流式)。
// 客户端在请求头 Authorization 里带 API Key;无 Key 时返回题目内置的提示/题解作为兜底。

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT = `你是 ACM/ICPC(算法竞赛)教练,正在一对一辅导一名正在训练的学生。
教学原则:
1. 先问学生卡在哪里、已经尝试了什么,再针对性引导,不要一上来就甩完整解法。
2. 优先给出"分级提示"(思路方向、关键观察、复杂度目标),让学生自己动手。
3. 只有当学生明确要求"给题解/给代码"时,才给出完整解法与参考代码。
4. 讲解时说明算法正确性依据与复杂度,并用中文回答;代码示例用 C++ 或 Python。
5. 学生可能用中文提问,请全程用中文回复。
当题目上下文存在时,请基于该题目的描述、输入输出格式与样例进行教学;不要编造题目不存在的数据范围。`;

function buildSystem(problem) {
  if (!problem) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

================ 当前题目 ================
题目标题:${problem.title}
难度:${problem.difficulty}/5
知识点:${(problem.tags || []).join('、')}
时间限制:${problem.timeLimit}ms

题目描述:
${problem.description}

输入格式:
${problem.inputSpec}

输出格式:
${problem.outputSpec}

样例:
${(problem.samples || []).map((s, i) => `样例${i + 1} 输入:\n${s.input}\n样例${i + 1} 输出:\n${s.output}`).join('\n\n')}
==========================================`;
}

/**
 * 调用教练。
 * @param {object} opts { apiKey, endpoint, model, problem, question, history }
 */
async function coach(opts) {
  const { apiKey, endpoint, model, problem, question, history } = opts;

  if (!apiKey) {
    return {
      ok: false,
      code: 'no_api_key',
      message: '尚未配置 API Key。可在「AI 教练」页右上角设置;未配置时先展示题目内置提示与题解。',
      builtin: problem
        ? { hints: problem.hints || [], editorial: problem.editorial || '' }
        : null
    };
  }

  const messages = [{ role: 'system', content: buildSystem(problem) }];
  if (Array.isArray(history)) {
    for (const m of history.slice(-16)) {
      if (m && m.role && m.content) messages.push({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.content).slice(0, 6000) });
    }
  }
  messages.push({ role: 'user', content: String(question || '').slice(0, 6000) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        temperature: 0.6,
        max_tokens: 2000,
        stream: false
      }),
      signal: controller.signal
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (!resp.ok) {
      const errMsg = (data && (data.error && (data.error.message || JSON.stringify(data.error)) || data.message)) || `HTTP ${resp.status}`;
      return { ok: false, code: 'api_error', message: `模型接口返回错误:${errMsg}` };
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return { ok: false, code: 'api_error', message: '模型接口返回为空' };
    return { ok: true, content };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时(60s)' : (e && e.message || String(e));
    return { ok: false, code: 'network_error', message: `网络错误:${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { coach, DEFAULT_ENDPOINT, DEFAULT_MODEL };
