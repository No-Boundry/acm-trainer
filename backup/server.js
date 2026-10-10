// ACM 训练模式 —— 本地服务器(零依赖)。
// 静态资源 + API。启动:node server.js [--port 4000] 或 start.bat
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const problemsLib = require('./lib/problems.js');
const { judge } = require('./lib/judge.js');
const store = require('./lib/store.js');
const coachLib = require('./lib/coach.js');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || process.argv[2] === '--port' ? process.argv[3] : 4000) || 4000;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  try {
    // ---- API ----
    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, name: 'acm-trainer', problems: problemsLib.problems.length });
    }

    if (p === '/api/problems' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, problems: problemsLib.listView() });
    }

    const detailMatch = p.match(/^\/api\/problems\/([^/]+)$/);
    if (detailMatch && req.method === 'GET') {
      const prob = problemsLib.detailView(detailMatch[1]);
      if (!prob) return sendJson(res, 404, { ok: false, message: '题目不存在' });
      return sendJson(res, 200, { ok: true, problem: prob });
    }

    if (p === '/api/xcpc' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, plan: problemsLib.xcpc });
    }

    // 洛谷在线抓取(实验性):本机网络可能无法直连洛谷,失败时请改用粘贴导入
    const luoguMatch = p.match(/^\/api\/luogu\/user\/(\d+)$/);
    if (luoguMatch && req.method === 'GET') {
      const uid = luoguMatch[1];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(`https://www.luogu.com.cn/user/${uid}?_contentOnly=1`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.luogu.com.cn/'
          },
          signal: controller.signal
        });
        const text = await resp.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* 非 JSON,下面按失败处理 */ }
        const list = data && data.currentData && data.currentData.passedProblems;
        if (!Array.isArray(list)) {
          return sendJson(res, 200, {
            ok: false,
            code: 'parse_failed',
            message: `洛谷返回异常(HTTP ${resp.status}),可能被风控或本机网络无法直连洛谷;请改用「粘贴导入」。`
          });
        }
        const passed = list.map((x) => String(x && x.pid || '').toUpperCase()).filter((s) => /^P\d+$/.test(s));
        const unique = [...new Set(passed)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
        return sendJson(res, 200, { ok: true, uid: Number(uid), count: unique.length, passed: unique, importedAt: new Date().toISOString() });
      } catch (e) {
        return sendJson(res, 200, {
          ok: false,
          code: 'network_error',
          message: `无法连接洛谷:${e && e.name === 'AbortError' ? '请求超时' : (e && e.message || e)}。本机网络可能无法直连洛谷,请改用「粘贴导入」。`
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (p === '/api/progress' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, progress: store.load() });
    }

    if (p === '/api/progress' && req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req, 2 * 1024 * 1024)); }
      catch (e) { return sendJson(res, 400, { ok: false, message: '请求体解析失败' }); }
      const progress = store.save(body && typeof body === 'object' ? body : {});
      return sendJson(res, 200, { ok: true, progress });
    }

    if (p === '/api/submit' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req, 300 * 1024)); }
      catch (e) { return sendJson(res, 400, { ok: false, message: '请求体解析失败或过大' }); }
      const { problemId, lang, code } = body || {};
      const prob = problemsLib.byId.get(problemId);
      if (!prob) return sendJson(res, 404, { ok: false, message: '题目不存在' });
      const result = await judge(prob, lang, code);
      return sendJson(res, 200, { ok: true, problemId, lang, ...result });
    }

    if (p === '/api/coach' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req, 128 * 1024)); }
      catch (e) { return sendJson(res, 400, { ok: false, message: '请求体解析失败' }); }
      const apiKey = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
      const problem = body && body.problemId ? problemsLib.byId.get(body.problemId) : null;
      const r = await coachLib.coach({
        apiKey,
        endpoint: body && body.endpoint || coachLib.DEFAULT_ENDPOINT,
        model: body && body.model || coachLib.DEFAULT_MODEL,
        problem,
        question: body && body.question,
        history: body && body.history
      });
      return sendJson(res, 200, r);
    }

    // ---- 静态资源 ----
    if (req.method === 'GET') return serveStatic(req, res, p);
    res.writeHead(405); res.end('Method Not Allowed');
  } catch (e) {
    sendJson(res, 500, { ok: false, message: `服务器错误:${e && e.message || e}` });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[acm-trainer] ACM 训练模式已启动:http://${HOST}:${PORT}`);
  console.log(`[acm-trainer] 内置题目 ${problemsLib.problems.length} 道 | 训练计划 ${problemsLib.xcpc.sessions.length} 次 | 判题语言: C / C++ / Python`);
});
