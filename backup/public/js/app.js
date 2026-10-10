/* ACM 训练模式 前端 */
'use strict';

// ---------------- 小工具 ----------------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok || (data && data.ok === false && data.code !== 'no_api_key')) {
    throw new Error((data && data.message) || `HTTP ${res.status}`);
  }
  return data;
}

function toast(msg, type) {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 极简 Markdown 渲染(已转义输入)
function md(text) {
  if (!text) return '';
  const src = escapeHtml(text).replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  let html = '';
  let listType = null;
  let inCode = false;
  let codeBuf = [];
  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith('```')) {
      if (!inCode) { closeList(); inCode = true; codeBuf = []; }
      else { html += `<pre>${codeBuf.join('\n')}</pre>`; inCode = false; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const lv = Math.min(4, h[1].length + 1); html += `<h${lv}>${inline(h[2])}</h${lv}>`; continue; }
    if (/^[-*]\s+/.test(line)) { if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; } html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`; continue; }
    if (/^\d+\.\s+/.test(line)) { if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; } html += `<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`; continue; }
    if (line.trim() === '') { closeList(); continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  if (inCode) html += `<pre>${codeBuf.join('\n')}</pre>`;
  closeList();
  return html;
}

// ---------------- 全局状态 ----------------
const state = {
  problems: [],
  plan: null,
  progress: null,
  detail: null,          // 当前题目详情
  filters: { q: '', diff: 0, tag: '', status: 'all' },
  editor: null,
  submitting: false,
  settings: { apiKey: '', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/chat/completions' },
  coach: { messages: [], problemId: '', busy: false }
};

const DIFF_LABEL = { 1: '入门', 2: '简单', 3: '中等', 4: '较难', 5: '困难' };
const DIFF_COLOR = { 1: '#3ecf8e', 2: '#4d9fff', 3: '#ffd43b', 4: '#ffa94d', 5: '#ff5c5c' };

function loadLS(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

state.settings = Object.assign(state.settings, loadLS('acm-trainer-settings', {}));
state.coach.messages = loadLS('acm-trainer-chat', []);

// ---------------- 进度 ----------------
let progressSaving = Promise.resolve();
function saveProgress() {
  state.progress.updatedAt = new Date().toISOString();
  progressSaving = progressSaving.then(() => api('/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.progress)
  })).catch((e) => toast('保存进度失败:' + e.message, 'err'));
}

function recordSubmit(problemId, lang, verdict) {
  const p = state.progress.problems[problemId] || (state.progress.problems[problemId] = { solved: false, solvedAt: null, attempts: 0, acCount: 0, lastVerdict: '', lastSubmitAt: null, submits: [] });
  const now = new Date().toISOString();
  p.attempts++;
  p.lastVerdict = verdict;
  p.lastSubmitAt = now;
  p.submits.push({ at: now, lang, verdict });
  if (p.submits.length > 200) p.submits = p.submits.slice(-200);
  if (verdict === 'AC') {
    p.acCount++;
    if (!p.solved) { p.solved = true; p.solvedAt = now; }
  }
  saveProgress();
}

function solvedSet() {
  const s = new Set();
  for (const id in (state.progress.problems || {})) if (state.progress.problems[id].solved) s.add(id);
  return s;
}

// ---------------- 路由 ----------------
const TABS = ['problems', 'plan', 'notes', 'stats', 'coach'];
let currentProblemId = null;

function router() {
  let h = location.hash || '#/problems';
  if (h === '#' || h === '#/') h = '#/problems';
  if (h.startsWith('#/problem/')) {
    currentProblemId = decodeURIComponent(h.slice('#/problem/'.length));
    showProblem(currentProblemId);
    setActiveTab('');
    return;
  }
  const tab = h.slice(2);
  if (TABS.includes(tab)) { setActiveTab(tab); renderTab(tab); }
  else { location.hash = '#/problems'; }
}

function setActiveTab(tab) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
}

function renderTab(tab) {
  if (tab === 'problems') renderProblems();
  else if (tab === 'plan') renderPlan();
  else if (tab === 'notes') renderNotes();
  else if (tab === 'stats') renderStats();
  else if (tab === 'coach') renderCoach();
}

// ---------------- 题库列表 ----------------
function allTags() {
  const s = new Set();
  state.problems.forEach((p) => (p.tags || []).forEach((t) => s.add(t)));
  return [...s].sort();
}

// ---------------- 题库(含按练习情况/笔记动态更新) ----------------
// 单题练习状态:solved 已解决 / trying 尝试中 / weak 薄弱 / noteRec 笔记推荐
function problemStatus(p) {
  const pr = state.progress.problems[p.id];
  const s = { solved: false, trying: false, weak: false, attempts: 0, acCount: 0 };
  if (pr) {
    s.attempts = pr.attempts || 0;
    s.acCount = pr.acCount || 0;
    s.solved = !!pr.solved;
    s.trying = !pr.solved && s.attempts > 0;
    const nonAc = s.attempts - s.acCount;
    s.weak = !pr.solved && nonAc >= 2 && (s.attempts === 0 || s.acCount / s.attempts < 0.5);
  }
  return s;
}

// 笔记推荐的内置题(出现在笔记任务/推荐练习里的本地题)
function noteRecSet() {
  const s = new Set();
  for (const np of (state.progress.notePlans || [])) {
    for (const t of np.tasks) {
      for (const pr of (t.problems || [])) {
        if (pr.oj === '内置') s.add(pr.code);
      }
    }
  }
  return s;
}

// 笔记引用的外部题(洛谷/HDU/POJ),含来源笔记
function noteExternalProblems() {
  const map = new Map();
  for (const np of (state.progress.notePlans || [])) {
    for (const t of np.tasks) {
      for (const pr of (t.problems || [])) {
        if (pr.oj === '内置') continue;
        const key = pr.oj + ':' + pr.code;
        if (!map.has(key)) map.set(key, { oj: pr.oj, code: pr.code, url: pr.url, notes: [] });
        const src = np.name || np.title;
        if (!map.get(key).notes.includes(src)) map.get(key).notes.push(src);
      }
    }
  }
  return [...map.values()];
}

function renderProblems() {
  const v = $('#view');
  const solved = solvedSet();
  const tags = allTags();
  const rec = noteRecSet();
  const externals = noteExternalProblems();
  const statusOf = (p) => problemStatus(p);
  const f = state.filters;

  const statCounts = {
    todo: state.problems.filter((p) => !statusOf(p).attempts).length,
    weak: state.problems.filter((p) => statusOf(p).weak).length,
    rec: rec.size,
    ext: externals.length
  };

  v.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="problem-toolbar">
        <div class="search-box"><input type="text" id="filter-q" placeholder="搜索题目标题 / ID…" value="${escapeHtml(f.q)}"></div>
        <div class="chips" id="filter-diff">
          <span class="chip ${f.diff === 0 ? 'active' : ''}" data-d="0">全部难度</span>
          ${[1, 2, 3, 4, 5].map((d) => `<span class="chip ${f.diff === d ? 'active' : ''}" data-d="${d}" style="color:${DIFF_COLOR[d]}">${d} ${DIFF_LABEL[d]}</span>`).join('')}
        </div>
        <select id="filter-tag">
          <option value="">全部知识点</option>
          ${tags.map((t) => `<option ${f.tag === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
        <select id="filter-status">
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="todo" ${f.status === 'todo' ? 'selected' : ''}>未做</option>
          <option value="trying" ${f.status === 'trying' ? 'selected' : ''}>尝试中</option>
          <option value="weak" ${f.status === 'weak' ? 'selected' : ''}>薄弱(多次未 AC)</option>
          <option value="solved" ${f.status === 'solved' ? 'selected' : ''}>已解决</option>
          <option value="rec" ${f.status === 'rec' ? 'selected' : ''}>笔记推荐</option>
        </select>
      </div>
      <div class="row wrap" style="gap:8px;font-size:12px;color:var(--text-2)">
        <span>📋 待练习 <b style="color:var(--accent)">${statCounts.todo}</b></span>
        <span>🔥 薄弱 <b style="color:var(--red)">${statCounts.weak}</b></span>
        <span>📌 笔记推荐 <b style="color:var(--purple)">${statCounts.rec}</b></span>
        <span>🔗 笔记外部题 <b style="color:var(--cyan)">${statCounts.ext}</b></span>
        <span class="muted">根据练习记录与导入笔记自动更新</span>
      </div>
    </div>
    <div class="card">
      <table class="problem-table">
        <thead><tr>
          <th style="width:64px">状态</th><th>题目</th><th>难度</th><th>知识点</th><th>练习</th><th>限制</th>
        </tr></thead>
        <tbody id="problem-rows"></tbody>
      </table>
    </div>
    ${externals.length ? `
    <div class="card" style="margin-top:14px">
      <div class="panel-title">笔记引用的外部题 <span class="hint">${externals.length} 道 · 来自导入的笔记,点击跳转原 OJ</span></div>
      <div class="problem-chips">
        ${externals.map((x) => {
          const lgDone = x.oj === '洛谷' && luoguPassedSet().has(x.code);
          return `<span class="problem-chip">
            <a href="${escapeHtml(x.url)}" target="_blank" rel="noopener" style="font-weight:600">${escapeHtml(x.code)}</a>
            <span class="muted" style="font-size:11px">${escapeHtml(x.oj)}</span>
            ${lgDone ? '<span class="lg-badge ok">洛谷已AC</span>' : ''}
          </span>`;
        }).join('')}
      </div>
    </div>` : ''}`;

  const rows = $('#problem-rows');
  const q = f.q.trim().toLowerCase();
  const list = state.problems.filter((p) => {
    if (f.diff && p.difficulty !== f.diff) return false;
    if (f.tag && !(p.tags || []).includes(f.tag)) return false;
    if (q && !(p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))) return false;
    if (f.status && f.status !== 'all') {
      const st = statusOf(p);
      if (f.status === 'todo' && st.attempts) return false;
      if (f.status === 'trying' && !st.trying) return false;
      if (f.status === 'weak' && !st.weak) return false;
      if (f.status === 'solved' && !st.solved) return false;
      if (f.status === 'rec' && !rec.has(p.id)) return false;
    }
    return true;
  });

  if (!list.length) { rows.innerHTML = `<tr><td colspan="6"><div class="empty">没有符合条件的题目</div></td></tr>`; }
  else {
    rows.innerHTML = list.map((p) => {
      const st = statusOf(p);
      let badge = '';
      if (st.solved) badge += `<span class="solved-badge" title="已解决">✓</span>`;
      if (st.weak) badge += `<span class="st-badge weak" title="多次未 AC,建议复习">薄弱</span>`;
      if (rec.has(p.id)) badge += `<span class="st-badge rec" title="出现在导入笔记中">笔记</span>`;
      if (st.trying) badge += `<span class="st-badge try" title="提交过但未通过">尝试中</span>`;
      const prac = st.attempts ? `${st.acCount}/${st.attempts} AC` : '';
      return `<tr class="problem-row" data-id="${p.id}">
        <td>${badge}</td>
        <td>
          <div class="problem-title-cell">${escapeHtml(p.title)}</div>
          <div class="problem-meta">${escapeHtml(p.source || '')} · ${p.id}</div>
        </td>
        <td><span class="diff-stars" style="color:${DIFF_COLOR[p.difficulty]}">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span><span class="diff-num">${DIFF_LABEL[p.difficulty]}</span></td>
        <td><span class="tag-list">${(p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span></td>
        <td class="mono muted" style="font-size:12px">${prac || '未做'}</td>
        <td class="muted mono">${p.timeLimit}ms</td>
      </tr>`;
    }).join('');
  }

  $$('#filter-diff .chip').forEach((c) => c.onclick = () => { f.diff = Number(c.dataset.d); renderProblems(); });
  $('#filter-q').oninput = (e) => { f.q = e.target.value; renderProblems(); };
  $('#filter-tag').onchange = (e) => { f.tag = e.target.value; renderProblems(); };
  $('#filter-status').onchange = (e) => { f.status = e.target.value; renderProblems(); };
  $$('#problem-rows .problem-row').forEach((r) => r.onclick = () => { location.hash = '#/problem/' + r.dataset.id; });
}

// ---------------- 题目详情 ----------------
async function showProblem(id) {
  const v = $('#view');
  v.innerHTML = `<div class="empty">加载题目…</div>`;
  try {
    const { problem } = await api('/api/problems/' + encodeURIComponent(id));
    state.detail = problem;
    renderProblemDetail();
  } catch (e) {
    v.innerHTML = `<div class="empty">加载失败:${escapeHtml(e.message)}</div>`;
  }
}

function renderProblemDetail() {
  const p = state.detail;
  const v = $('#view');
  const prog = state.progress.problems[p.id] || {};
  const solved = !!prog.solved;

  v.innerHTML = `
    <button class="btn btn-sm" id="back-btn" style="margin-bottom:14px">← 返回题库</button>
    <div class="detail-head">
      <div class="detail-title">
        <span>${solved ? '<span class="solved-badge">✓</span> ' : ''}${escapeHtml(p.title)}</span>
        <span class="tag" style="color:${DIFF_COLOR[p.difficulty]};border-color:currentColor">${DIFF_LABEL[p.difficulty]}</span>
      </div>
      <div class="detail-meta">
        <span>来源:${escapeHtml(p.source || '原创')}</span>
        <span>知识点:${(p.tags || []).join('、')}</span>
        <span>时间限制:${p.timeLimit}ms</span>
        <span>内存限制:${p.memoryLimit}MB</span>
        <span class="mono">${p.id}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="section"><h3>题目描述</h3><div class="body">${md(p.description)}</div></div>
      <div class="section"><h3>输入格式</h3><div class="body">${md(p.inputSpec)}</div></div>
      <div class="section"><h3>输出格式</h3><div class="body">${md(p.outputSpec)}</div></div>
      <div class="section"><h3>样例</h3>
        <div class="sample-grid">${(p.samples || []).map((s, i) => `
          <div class="sample-box">
            <div class="sample-label">样例 ${i + 1} 输入</div><pre>${escapeHtml(s.input)}</pre>
            <div class="sample-label">样例 ${i + 1} 输出</div><pre>${escapeHtml(s.output)}</pre>
          </div>`).join('')}
        </div>
      </div>
      <div class="section"><h3>提示</h3><div id="hints-area"></div></div>
      <div class="section"><h3>题解</h3><div id="editorial-area"></div></div>
    </div>

    <div class="card submit-panel">
      <div class="panel-title">提交代码
        <span class="hint">本地编译运行判题(C / C++ / Python)</span>
        <span class="hint" style="margin-left:auto" id="prog-hint">${prog.attempts ? `已提交 ${prog.attempts} 次 · ${prog.lastVerdict || ''}` : '尚未提交'}</span>
      </div>
      <div class="row wrap" style="margin-bottom:10px">
        <select id="lang-select">
          <option value="cpp" selected>C++17(g++)</option>
          <option value="c">C11(gcc)</option>
          <option value="python">Python 3</option>
        </select>
        <span class="muted" style="font-size:12px">Ctrl+Enter 提交 · Tab 缩进</span>
        <span class="spacer" style="flex:1"></span>
        <button class="btn btn-sm" id="load-sample">载入样例代码</button>
      </div>
      <div class="editor-wrap">
        <div class="editor-gutter" id="editor-gutter"></div>
        <textarea id="code-editor" spellcheck="false" placeholder="在这里编写代码…"></textarea>
      </div>
      <div class="editor-tools">
        <div class="code-actions">
          <button class="btn btn-primary" id="submit-btn">提交</button>
          <button class="btn" id="coach-btn">请教 AI 教练</button>
        </div>
        <span class="spacer"></span>
        <span id="submit-status" class="muted"></span>
      </div>
      <div id="result-area"></div>
    </div>`;

  $('#back-btn').onclick = () => { location.hash = '#/problems'; };

  // 提示:分级展开
  const hintsArea = $('#hints-area');
  const hints = p.hints || [];
  if (!hints.length) hintsArea.innerHTML = '<span class="muted">本题暂无提示</span>';
  else {
    hintsArea.innerHTML = hints.map((h, i) => `
      <div class="hint-box hidden" data-hint="${i}">
        <div class="hint-label">提示 ${i + 1}</div><div>${escapeHtml(h)}</div>
      </div>`).join('');
    const btnWrap = document.createElement('div');
    const showBtn = document.createElement('button');
    showBtn.className = 'btn btn-sm reveal-btn';
    showBtn.textContent = '展开提示 1';
    showBtn.onclick = () => {
      const boxes = $$('#hints-area .hint-box');
      const next = boxes.find((b) => b.classList.contains('hidden'));
      if (next) { next.classList.remove('hidden'); next.scrollIntoView({ block: 'nearest' }); }
      const shown = boxes.length - $$('#hints-area .hint-box.hidden').length;
      showBtn.textContent = shown >= boxes.length ? '提示已全部展开' : `展开提示 ${shown + 1}`;
    };
    btnWrap.appendChild(showBtn);
    hintsArea.appendChild(btnWrap);
  }

  // 题解:确认后显示
  const edArea = $('#editorial-area');
  const edBtn = document.createElement('button');
  edBtn.className = 'btn btn-sm';
  edBtn.textContent = '查看题解(建议先自己思考)';
  edBtn.onclick = () => confirmModal('查看题解', '确定要放弃思考、直接查看本题题解吗?', () => {
    edArea.innerHTML = `<div class="body">${md(p.editorial || '本题暂无题解')}</div>`;
    edBtn.remove();
  });
  edArea.appendChild(edBtn);

  // 编辑器
  initEditor();

  $('#lang-select').onchange = (e) => setTemplate(e.target.value);
  $('#load-sample').onclick = () => {
    const el = state.editor;
    if (!el) return;
    const s = (p.samples || [])[0];
    if (s) { el.setValue(s.input + '\n'); }
  };
  $('#submit-btn').onclick = submitCode;
  $('#coach-btn').onclick = () => { state.coach.problemId = p.id; location.hash = '#/coach'; };

  // 记住语言
  const lang = loadLS('acm-trainer-lang', 'cpp');
  $('#lang-select').value = lang;
  setTemplate(lang);
}

function setTemplate(lang) {
  const el = state.editor;
  if (!el) return;
  saveLS('acm-trainer-lang', lang);
  const tpl = {
    cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}`,
    c: `#include <stdio.h>\n\nint main() {\n\n    return 0;\n}`,
    python: `import sys\n\ndef main():\n    data = sys.stdin.read().strip().split()\n    # 在这里编写代码\n\nif __name__ == '__main__':\n    main()`
  };
  if (!el.getValue().trim()) el.setValue(tpl[lang] || '');
}

// ---------------- 代码编辑器(带行号) ----------------
function initEditor() {
  const ta = $('#code-editor');
  const gutter = $('#editor-gutter');
  const lineHeight = 20;

  const paint = () => {
    const n = ta.value.split('\n').length;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= n; i++) { const d = document.createElement('div'); d.textContent = i; frag.appendChild(d); }
    gutter.innerHTML = '';
    gutter.appendChild(frag);
  };
  const syncScroll = () => { gutter.scrollTop = ta.scrollTop; };

  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', syncScroll);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('    ', s, en, 'end');
      paint();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      submitCode();
    }
  });

  state.editor = {
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; paint(); },
    clear: () => { ta.value = ''; paint(); }
  };
  paint();
}

// ---------------- 提交判题 ----------------
async function submitCode() {
  if (state.submitting) return;
  const el = state.editor;
  if (!el) return;
  const code = el.getValue();
  const lang = $('#lang-select').value;
  const btn = $('#submit-btn');
  const status = $('#submit-status');
  const resultArea = $('#result-area');

  if (!code.trim()) { toast('请先编写代码', 'err'); return; }

  state.submitting = true;
  btn.disabled = true;
  status.innerHTML = '<span class="spin"></span> 判题中…(编译 + 运行全部测试点)';
  resultArea.innerHTML = '';

  try {
    const r = await api('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemId: state.detail.id, lang, code })
    });
    recordSubmit(state.detail.id, lang, r.verdict);
    renderResult(r);
    status.textContent = '';
    const hint = $('#prog-hint');
    if (hint) { const prog = state.progress.problems[state.detail.id]; hint.textContent = prog.attempts ? `已提交 ${prog.attempts} 次 · ${prog.lastVerdict || ''}` : ''; }
  } catch (e) {
    status.textContent = '';
    toast('提交失败:' + e.message, 'err');
  } finally {
    state.submitting = false;
    btn.disabled = false;
  }
}

const VERDICT_TEXT = { AC: 'Accept', WA: 'Wrong Answer', TLE: 'Time Limit Exceeded', MLE: 'Memory Limit Exceeded', RE: 'Runtime Error', CE: 'Compile Error', OLE: 'Output Limit Exceeded', IE: 'Internal Error' };
const fmtKB = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');

function renderResult(r) {
  const area = $('#result-area');
  const first = (r.testResults || []).find((t) => t.verdict !== 'AC');
  const memInfo = r.memLimitEnabled
    ? `峰值内存 ${r.peakMemKB ? fmtKB(r.peakMemKB) : '-'}`
    : '内存限制未启用(辅助进程不可用)';
  let html = `<div class="result-panel">
    <div class="result-summary">
      <span class="verdict v-${r.verdict}">${r.verdict} ${VERDICT_TEXT[r.verdict] || ''}</span>
      <span class="muted">${escapeHtml(r.message || '')}</span>
      <span class="muted mono">总耗时 ${r.timeMs || 0}ms</span>
      <span class="muted mono">${memInfo}</span>
    </div>`;

  if (r.compileError) {
    html += `<div class="diff-box"><div class="panel-title" style="margin-top:4px">编译错误</div>
      <pre>${escapeHtml(r.compileError)}</pre></div>`;
  }

  if (r.testResults && r.testResults.length) {
    html += `<table class="result-table">
      <tr><th>#</th><th>判定</th><th>耗时</th><th>内存</th><th>说明</th></tr>
      ${r.testResults.map((t) => `<tr>
        <td>${t.index + 1}</td>
        <td><span class="verdict v-${t.verdict}" style="font-size:11px;padding:1px 8px">${t.verdict}</span></td>
        <td class="mono muted">${t.timeMs}ms</td>
        <td class="mono muted">${t.memKB ? fmtKB(t.memKB) : '-'}</td>
        <td class="muted" style="font-size:12px">${escapeHtml((t.message || '').split('\n')[0])}</td>
      </tr>`).join('')}
    </table>`;
  }

  if (first && (first.diff || first.input !== undefined)) {
    html += `<div class="diff-box"><div class="panel-title" style="margin-top:8px">第 ${first.index + 1} 个测试点(错误详情)</div>`;
    if (first.input !== undefined) html += `<div class="muted" style="font-size:12px">输入</div><pre>${escapeHtml(first.input)}</pre>`;
    if (first.diff) html += first.diff.map((d) => `<pre style="color:var(--red)">${escapeHtml(d)}</pre>`).join('');
    html += `</div>`;
  }
  html += `</div>`;
  area.innerHTML = html;
}

// ---------------- 洛谷练习记录 ----------------
// 解析粘贴文本:兼容洛谷 _contentOnly JSON(取 passedProblems[].pid)与纯题号列表
function parseLuoguText(text) {
  const pids = new Set();
  try {
    const obj = JSON.parse(text);
    const walk = (o) => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') {
        for (const k in o) {
          if (k === 'pid' && typeof o[k] === 'string') { const m = o[k].match(/^[Pp](\d{1,6})$/); if (m) pids.add('P' + m[1]); }
          else walk(o[k]);
        }
      }
    };
    walk(obj);
  } catch (e) { /* 非 JSON,走正则 */ }
  const re = /[Pp](\d{1,6})/g;
  let m;
  while ((m = re.exec(text))) pids.add('P' + m[1]);
  return [...pids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function luoguPassedSet() {
  return new Set((state.progress.luogu && state.progress.luogu.passed) || []);
}

function saveLuogu(luogu) {
  state.progress.luogu = luogu;
  saveProgress();
  toast(`已导入洛谷练习记录:${luogu.count} 道题`, 'ok');
  renderPlan();
}

function clearLuogu() {
  delete state.progress.luogu;
  saveProgress();
  toast('已清除洛谷导入记录', 'ok');
  renderPlan();
}

function markLuoguDone() {
  const passed = luoguPassedSet();
  if (!passed.size) { toast('请先导入洛谷练习记录', 'err'); return; }
  const done = state.progress.plan;
  let n = 0;
  for (const s of state.plan.sessions) {
    for (const p of s.problems) {
      if (p.oj === '洛谷' && passed.has(p.code)) {
        if (!done[s.id]) done[s.id] = {};
        if (!done[s.id][p.oj + ':' + p.code]) { done[s.id][p.oj + ':' + p.code] = true; n++; }
      }
    }
  }
  saveProgress();
  toast(`已按洛谷记录标记 ${n} 道题完成`, n ? 'ok' : 'err');
  renderPlan();
}

// ---------------- 笔记计划(.md 导入 → 学习计划) ----------------
// 从一行文本中提取题目引用(洛谷 P 题号 / HDU / POJ / URL)
function extractProblems(line) {
  const out = [];
  const re = /(?:luogu\.com\.cn\/problem\/)?[Pp](\d{1,6})|hdu\s*(\d{1,5})|poj\s*(\d{1,5})|showproblem\.php\?pid=(\d{1,5})|problem\.php\?id=(\d{1,5})/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ oj: '洛谷', code: 'P' + m[1], url: `https://www.luogu.com.cn/problem/P${m[1]}` });
    else if (m[2] || m[4]) { const c = m[2] || m[4]; out.push({ oj: 'HDU', code: c, url: `http://acm.hdu.edu.cn/showproblem.php?pid=${c}` }); }
    else if (m[3] || m[5]) { const c = m[3] || m[5]; out.push({ oj: 'POJ', code: c, url: `http://poj.org/problem?id=${c}` }); }
  }
  return out;
}

// 解析 Markdown 笔记 → 学习计划任务列表
function parseMarkdownPlan(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let docTitle = '';
  const tasks = [];
  let current = null;
  let inCode = false;

  const ensureTask = () => {
    if (!current) { current = { id: 't-' + tasks.length, title: '笔记内容', points: [], problems: [] }; tasks.push(current); }
    return current;
  };
  const pushProblem = (task, probs) => {
    for (const p of probs) {
      if (!task.problems.some((x) => x.oj === p.oj && x.code === p.code)) task.problems.push(p);
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const title = h[2].trim();
      if (!docTitle && h[1].length === 1) docTitle = title;
      current = { id: 't-' + tasks.length, title, points: [], problems: [] };
      tasks.push(current);
      continue;
    }
    const t = ensureTask();
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isList = /^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed);
    const pointText = isList ? trimmed.replace(/^[-*+]\s+|^\d+[.)]\s+/, '') : trimmed;
    pushProblem(t, extractProblems(trimmed));
    if (isList && pointText) t.points.push(pointText.slice(0, 160));
    else if (!isList && !/^[-*+>\s|]*$/.test(trimmed)) t.points.push(trimmed.slice(0, 160));
  }

  // 知识点匹配 → 内置题库推荐任务
  const rec = recommendProblems(text);
  if (rec.length) {
    tasks.push({
      id: 't-' + tasks.length,
      title: '推荐练习(按笔记知识点匹配内置题库)',
      points: [],
      problems: rec.map((p) => ({ oj: '内置', code: p.id, title: p.title, url: '#/problem/' + p.id }))
    });
  }

  // 整理:去掉没有要点也没有题目的空章节;保留有内容的
  const real = tasks.filter((t) => t.points.length || t.problems.length || t.title === '推荐练习(按笔记知识点匹配内置题库)');
  const final = real.length ? real : [{ id: 't-0', title: '笔记内容', points: [], problems: [] }];
  return { title: docTitle || '我的笔记', tasks: final };
}

// 笔记全文 → 命中的内置题库知识点 → 推荐题
function recommendProblems(text) {
  const tagHits = new Set();
  for (const p of state.problems) {
    for (const tag of (p.tags || [])) {
      if (text.includes(tag)) tagHits.add(tag);
    }
  }
  if (!tagHits.size) return [];
  const seen = new Set();
  const out = [];
  for (const p of state.problems) {
    if ((p.tags || []).some((t) => tagHits.has(t)) && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
  }
  return out;
}

function addNotePlans(plans) {
  if (!state.progress.notePlans) state.progress.notePlans = [];
  state.progress.notePlans.push(...plans);
  saveProgress();
  const taskN = plans.reduce((a, p) => a + p.tasks.length, 0);
  toast(`已导入 ${plans.length} 篇笔记,共 ${taskN} 个学习任务`, 'ok');
  renderNotes();
}

function removeNotePlan(idx) {
  if (!state.progress.notePlans) return;
  state.progress.notePlans.splice(idx, 1);
  saveProgress();
  toast('已删除该笔记', 'ok');
  renderNotes();
}

function clearNotePlans() {
  delete state.progress.notePlans;
  state.progress.notePlans = [];
  saveProgress();
  toast('已清空全部笔记计划', 'ok');
  renderNotes();
}

function toggleNoteTask(planIdx, id, done) {
  const plans = state.progress.notePlans;
  if (!plans || !plans[planIdx]) return;
  const t = plans[planIdx].tasks.find((x) => x.id === id);
  if (t) { t.done = done; saveProgress(); renderNotes(); }
}

// 读取多个文件 → 解析为笔记计划
function readNoteFiles(files) {
  return Promise.all(Array.from(files).map((f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const plan = parseMarkdownPlan(String(reader.result || ''));
        plan.name = f.name;
        plan.importedAt = new Date().toISOString();
        resolve(plan);
      } catch (e) { reject(new Error(`解析 ${f.name} 失败:${e && e.message || e}`)); }
    };
    reader.onerror = () => reject(new Error('读取 ' + f.name + ' 失败'));
    reader.readAsText(f, 'utf-8');
  })));
}

function taskCardHtml(planIdx, t, i) {
  return `
    <div class="card note-task ${t.done ? 'done' : ''}" style="margin:10px 0 0">
      <div class="row wrap">
        <input type="checkbox" data-plan="${planIdx}" data-task="${escapeHtml(t.id)}" ${t.done ? 'checked' : ''} style="accent-color:var(--green);transform:scale(1.2)">
        <span class="note-task-index mono muted">#${i + 1}</span>
        <span class="note-task-title" style="font-weight:700">${escapeHtml(t.title)}</span>
        <span class="muted" style="font-size:12px;margin-left:auto">${t.problems.length ? t.problems.length + ' 道题' : ''}${t.points.length ? ' · ' + t.points.length + ' 条要点' : ''}</span>
      </div>
      ${t.problems.length ? `<div class="problem-chips" style="margin-top:10px">
        ${t.problems.map((p) => `<span class="problem-chip">
          <a href="${escapeHtml(p.url)}" ${p.url.startsWith('#') ? '' : 'target="_blank" rel="noopener"'} style="font-weight:600">${escapeHtml(p.code)}</a>
          <span class="muted" style="font-size:11px">${escapeHtml(p.oj)}${p.title ? '·' + escapeHtml(p.title) : ''}</span>
        </span>`).join('')}
      </div>` : ''}
      ${t.points.length ? `<details style="margin-top:8px">
        <summary style="cursor:pointer;color:var(--accent);font-size:12px">展开要点(${t.points.length})</summary>
        <ul class="muted" style="font-size:12.5px;margin:8px 0 0 18px">${t.points.slice(0, 20).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}${t.points.length > 20 ? `<li>…等 ${t.points.length} 条</li>` : ''}</ul>
      </details>` : ''}
    </div>`;
}

function renderNotes() {
  const v = $('#view');
  const plans = state.progress.notePlans || [];
  const totalTasks = plans.reduce((a, p) => a + p.tasks.length, 0);
  const totalDone = plans.reduce((a, p) => a + p.tasks.filter((t) => t.done).length, 0);

  v.innerHTML = `
    <div class="card" style="margin-bottom:16px" id="note-import-card">
      <div class="panel-title">导入 .md 笔记,自动生成学习计划
        <span class="hint">支持多文件 · 解析章节结构 · 题目引用(洛谷/HDU/POJ)· 知识点推荐</span>
      </div>
      ${plans.length ? `
        <div class="row wrap" style="margin-bottom:10px">
          <span class="verdict v-AC">已导入 ${plans.length} 篇笔记</span>
          <span class="muted" style="font-size:12px">${totalTasks} 个任务 · 完成 ${totalDone}/${totalTasks}</span>
        </div>` : `<div class="muted" style="font-size:13px;margin-bottom:10px">可一次选择多个 .md 文件(按住 Ctrl/Shift 多选),或粘贴笔记内容;每篇笔记自动生成独立的学习计划。</div>`}
      <div class="row wrap" style="margin-bottom:8px">
        <input type="file" id="note-file" accept=".md,.markdown,.txt" multiple class="btn" style="padding:6px 10px;width:auto">
        <span class="muted" style="font-size:12px">或粘贴(追加为一篇笔记):</span>
      </div>
      <textarea id="note-paste" placeholder="粘贴 Markdown 笔记内容…(支持 ## 章节标题、- 要点列表、洛谷 P1000 / hdu1234 / poj5678 题号)" style="width:100%;min-height:100px;font-family:var(--mono);font-size:12px"></textarea>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn btn-sm btn-primary" id="note-import">粘贴为笔记</button>
        ${plans.length ? `<button class="btn btn-sm" id="note-clear">清空全部笔记</button>` : ''}
        <span class="muted" id="note-status" style="font-size:12px"></span>
      </div>
    </div>
    <div id="note-plan-area"></div>`;

  const fileInput = $('#note-file');
  fileInput.onchange = async () => {
    const files = fileInput.files;
    if (!files || !files.length) return;
    const status = $('#note-status');
    status.innerHTML = `<span class="spin"></span> 解析 ${files.length} 个文件…`;
    try {
      const plans = await readNoteFiles(files);
      addNotePlans(plans);
    } catch (e) { toast(e.message, 'err'); }
    status.textContent = '';
    fileInput.value = '';
  };
  $('#note-import').onclick = () => {
    const text = $('#note-paste').value;
    if (!text.trim()) { $('#note-status').textContent = '请先粘贴内容'; return; }
    const plan = parseMarkdownPlan(text);
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    plan.name = `粘贴笔记 ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    plan.importedAt = new Date().toISOString();
    addNotePlans([plan]);
    $('#note-paste').value = '';
    $('#note-status').textContent = '';
  };
  const clearBtn = $('#note-clear');
  if (clearBtn) clearBtn.onclick = clearNotePlans;

  // 笔记库列表
  const area = $('#note-plan-area');
  if (!plans.length) { area.innerHTML = `<div class="empty">导入笔记后,这里会按篇展示学习计划</div>`; return; }
  const totalPct = totalTasks ? Math.round(totalDone / totalTasks * 100) : 0;
  area.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">学习计划总览 <span class="hint">${plans.length} 篇笔记</span></div>
      <div class="bar-row">
        <span class="bar-label">总进度</span>
        <div class="bar-track"><div class="bar-fill" style="width:${totalPct}%"></div></div>
        <span class="bar-num">${totalDone}/${totalTasks}</span>
      </div>
    </div>
    ${plans.map((np, pi) => {
      const dn = np.tasks.filter((t) => t.done).length;
      const pct = np.tasks.length ? Math.round(dn / np.tasks.length * 100) : 0;
      return `<div class="card" style="margin-bottom:16px">
        <div class="row wrap">
          <span style="font-weight:800;font-size:15px">📄 ${escapeHtml(np.name || np.title)}</span>
          <span class="muted" style="font-size:12px">${fmtTime(np.importedAt)} · ${np.tasks.length} 个任务</span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-sm btn-danger" data-del="${pi}">删除</button>
        </div>
        <div class="bar-row" style="margin-top:8px">
          <span class="bar-label">进度</span>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <span class="bar-num">${dn}/${np.tasks.length}</span>
        </div>
        ${np.tasks.map((t, i) => taskCardHtml(pi, t, i)).join('')}
      </div>`;
    }).join('')}`;

  $$('#note-plan-area input[type=checkbox]').forEach((cb) => cb.onchange = () => {
    toggleNoteTask(Number(cb.dataset.plan), cb.dataset.task, cb.checked);
  });
  $$('#note-plan-area [data-del]').forEach((b) => b.onclick = () => removeNotePlan(Number(b.dataset.del)));
  $$('#note-plan-area a[href^="#/problem/"]').forEach((a) => a.onclick = () => { location.hash = a.getAttribute('href'); return false; });
}

// ---------------- 训练计划 ----------------
function renderPlan() {
  const v = $('#view');
  const plan = state.plan;
  if (!plan) { v.innerHTML = `<div class="empty">训练计划未加载</div>`; return; }
  const done = state.progress.plan || {};
  const passed = luoguPassedSet();
  const lg = state.progress.luogu;
  const totalAll = plan.sessions.reduce((a, s) => a + s.problems.length, 0);
  const doneAll = plan.sessions.reduce((a, s) => a + s.problems.filter((p) => done[s.id] && done[s.id][p.oj + ':' + p.code]).length, 0);
  const lgAll = plan.sessions.reduce((a, s) => a + s.problems.filter((p) => p.oj === '洛谷' && passed.has(p.code)).length, 0);

  v.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">${escapeHtml(plan.title)} <span class="hint">${escapeHtml(plan.source || '')}</span></div>
      <div class="muted" style="font-size:13px">${escapeHtml(plan.note || '')}</div>
      <div class="bar-row" style="margin-top:12px">
        <span class="bar-label">总进度(手动)</span>
        <div class="bar-track"><div class="bar-fill" style="width:${totalAll ? Math.round(doneAll / totalAll * 100) : 0}%"></div></div>
        <span class="bar-num">${doneAll}/${totalAll}</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">洛谷已 AC</span>
        <div class="bar-track"><div class="bar-fill" style="width:${totalAll ? Math.round(lgAll / totalAll * 100) : 0}%;background:linear-gradient(90deg,#3ecf8e,#7c5cff)"></div></div>
        <span class="bar-num">${lgAll}/${totalAll}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px" id="luogu-card">
      <div class="panel-title">洛谷练习记录导入 <span class="hint">把洛谷 AC 情况带到训练计划里</span></div>
      ${lg ? `
        <div class="row wrap" style="margin-bottom:10px">
          <span class="verdict v-AC">已导入 ${lg.count} 题</span>
          <span class="muted" style="font-size:12px">${escapeHtml(lg.source === 'api' ? '来源:UID 在线抓取' : '来源:粘贴')} · ${fmtTime(lg.importedAt)}</span>
        </div>` : `<div class="muted" style="font-size:13px;margin-bottom:10px">尚未导入洛谷记录,任选一种方式:</div>`}
      <details ${lg ? '' : 'open'}>
        <summary style="cursor:pointer;color:var(--accent);font-size:13px;margin-bottom:8px">方式一:粘贴洛谷数据(推荐,离线可用)</summary>
        <div class="muted" style="font-size:12px;margin-bottom:6px">在洛谷浏览器里打开 <code>https://www.luogu.com.cn/user/你的UID?_contentOnly=1</code>(页面直接显示 JSON),全选复制粘贴到下面;也可以直接粘贴每行一个题号的列表(如 P1000)。</div>
        <textarea id="luogu-paste" placeholder="粘贴洛谷 _contentOnly JSON 或题号列表…" style="width:100%;min-height:90px;font-family:var(--mono);font-size:12px"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn btn-sm btn-primary" id="luogu-parse">解析并导入</button>
          <span class="muted" id="luogu-parse-status" style="font-size:12px"></span>
        </div>
      </details>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--accent);font-size:13px;margin-bottom:8px">方式二:UID 在线抓取(实验性,依赖本机网络)</summary>
        <div class="row wrap">
          <input type="number" id="luogu-uid" placeholder="洛谷 UID" style="width:160px" min="1">
          <button class="btn btn-sm" id="luogu-fetch">在线抓取</button>
          <span class="muted" id="luogu-fetch-status" style="font-size:12px"></span>
        </div>
      </details>
      <div class="row wrap" style="margin-top:12px">
        ${lg ? `<button class="btn btn-sm" id="luogu-clear">清除导入记录</button>` : ''}
        ${lg && lgAll ? `<button class="btn btn-sm" id="luogu-mark">把洛谷已 AC 的题标记为完成(${lgAll} 题)</button>` : ''}
      </div>
    </div>
    <div id="session-list"></div>`;

  const list = $('#session-list');
  list.innerHTML = plan.sessions.map((s) => {
    const dn = s.problems.filter((p) => done[s.id] && done[s.id][p.oj + ':' + p.code]).length;
    const lgn = s.problems.filter((p) => p.oj === '洛谷' && passed.has(p.code)).length;
    return `<div class="session" data-session="${s.id}">
      <div class="session-head">
        <span class="session-title">${escapeHtml(s.title)}</span>
        <span class="session-theme">${escapeHtml(s.theme || '')}</span>
        <span class="session-progress">手动 ${dn}/${s.problems.length} · 洛谷AC ${lgn}</span>
      </div>
      <div class="session-body">
        <div class="problem-chips">
          ${s.problems.map((p) => {
            const key = p.oj + ':' + p.code;
            const isDone = !!(done[s.id] && done[s.id][key]);
            const lgHit = p.oj === '洛谷' && passed.has(p.code);
            const lgMiss = p.oj === '洛谷' && !!lg && !passed.has(p.code);
            return `<span class="problem-chip ${isDone ? 'done' : ''}">
              <input type="checkbox" data-session="${s.id}" data-key="${key}" ${isDone ? 'checked' : ''}>
              <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.code)}</a>
              <span class="muted" style="font-size:11px">${escapeHtml(p.oj)}</span>
              ${lgHit ? '<span class="lg-badge ok">洛谷已AC</span>' : (lgMiss ? '<span class="lg-badge no">未AC</span>' : '')}
            </span>`;
          }).join('')}
        </div>
        ${s.note ? `<div class="session-note">${escapeHtml(s.note)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  $$('.session-head').forEach((h) => h.onclick = () => { const se = h.parentElement; se.classList.toggle('open'); });
  $$('.session:first-child').forEach((se) => se.classList.add('open'));

  $$('.problem-chip input[type=checkbox]').forEach((cb) => cb.onchange = () => {
    const sid = cb.dataset.session, key = cb.dataset.key;
    if (!state.progress.plan[sid]) state.progress.plan[sid] = {};
    if (cb.checked) state.progress.plan[sid][key] = true;
    else delete state.progress.plan[sid][key];
    saveProgress();
    cb.parentElement.classList.toggle('done', cb.checked);
    renderPlan(); // 刷新进度数字
  });

  // 洛谷导入事件
  const parseBtn = $('#luogu-parse');
  if (parseBtn) parseBtn.onclick = () => {
    const text = $('#luogu-paste').value;
    const pids = parseLuoguText(text);
    const status = $('#luogu-parse-status');
    if (!pids.length) { status.textContent = '未识别到任何题号(请检查粘贴内容)'; return; }
    saveLuogu({ source: 'paste', importedAt: new Date().toISOString(), count: pids.length, passed: pids });
    status.textContent = '';
  };
  const fetchBtn = $('#luogu-fetch');
  if (fetchBtn) fetchBtn.onclick = async () => {
    const uid = $('#luogu-uid').value.trim();
    const status = $('#luogu-fetch-status');
    if (!uid) { status.textContent = '请先填写 UID'; return; }
    fetchBtn.disabled = true;
    status.innerHTML = '<span class="spin"></span> 抓取中…';
    try {
      const r = await api('/api/luogu/user/' + encodeURIComponent(uid));
      if (r.ok) saveLuogu({ source: 'api', uid: r.uid, importedAt: r.importedAt, count: r.count, passed: r.passed });
      else status.textContent = r.message || '抓取失败';
    } catch (e) { status.textContent = '抓取失败:' + e.message; }
    fetchBtn.disabled = false;
  };
  const clearBtn = $('#luogu-clear');
  if (clearBtn) clearBtn.onclick = clearLuogu;
  const markBtn = $('#luogu-mark');
  if (markBtn) markBtn.onclick = markLuoguDone;
}

// ---------------- 统计 ----------------
function renderStats() {
  const v = $('#view');
  const solved = solvedSet();
  const total = state.problems.length;
  const solvedCount = [...solved].filter((id) => state.problems.some((p) => p.id === id)).length;
  let totalSubmits = 0, acSubmits = 0;
  const recent = [];
  for (const id in state.progress.problems) {
    const p = state.progress.problems[id];
    totalSubmits += p.attempts || 0;
    acSubmits += p.acCount || 0;
    (p.submits || []).forEach((s) => recent.push({ at: s.at, problemId: id, lang: s.lang, verdict: s.verdict }));
  }
  recent.sort((a, b) => (b.at < a.at ? -1 : 1));
  const accuracy = totalSubmits ? Math.round(acSubmits / totalSubmits * 100) : 0;
  const byDiff = [1, 2, 3, 4, 5].map((d) => {
    const ps = state.problems.filter((p) => p.difficulty === d);
    const so = ps.filter((p) => solved.has(p.id)).length;
    return { d, total: ps.length, solved: so };
  });
  const lg = state.progress.luogu;
  const passed = luoguPassedSet();
  const planLgProblems = state.plan ? state.plan.sessions.reduce((a, s) => a.concat(s.problems.filter((p) => p.oj === '洛谷')), []) : [];
  const planLgTotal = planLgProblems.length;
  const planLgHit = planLgProblems.filter((p) => passed.has(p.code)).length;
  const noteTasks = (state.progress.notePlans || []).reduce((a, p) => a + p.tasks.length, 0);
  const noteDone = (state.progress.notePlans || []).reduce((a, p) => a + p.tasks.filter((t) => t.done).length, 0);

  v.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="num" style="color:var(--green)">${solvedCount}/${total}</div><div class="label">已解决 / 总题数</div></div>
      <div class="stat-card"><div class="num">${totalSubmits}</div><div class="label">累计提交次数</div></div>
      <div class="stat-card"><div class="num" style="color:var(--accent)">${accuracy}%</div><div class="label">通过率(按提交)</div></div>
      <div class="stat-card"><div class="num" style="color:var(--orange)">${recent.filter((r) => r.verdict === 'AC').length}/${recent.length}</div><div class="label">最近提交 AC 数</div></div>
      <div class="stat-card"><div class="num" style="color:var(--purple)">${lg ? lg.count : 0}</div><div class="label">洛谷已 AC(导入)</div></div>
      <div class="stat-card"><div class="num" style="color:var(--cyan)">${noteDone}/${noteTasks}</div><div class="label">笔记任务(完成/总数)</div></div>
    </div>
    ${lg ? `
    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">洛谷练习记录
        <span class="hint">${escapeHtml(lg.source === 'api' ? 'UID 在线抓取' : '粘贴导入')} · ${fmtTime(lg.importedAt)} · 共 ${lg.count} 题</span>
      </div>
      <div class="bar-row" style="margin-top:4px">
        <span class="bar-label">计划内已 AC</span>
        <div class="bar-track"><div class="bar-fill" style="width:${planLgTotal ? Math.round(planLgHit / planLgTotal * 100) : 0}%;background:linear-gradient(90deg,#3ecf8e,#7c5cff)"></div></div>
        <span class="bar-num">${planLgHit}/${planLgTotal}</span>
      </div>
      <div class="row wrap" style="margin-top:12px" id="lg-tags">
        ${lg.passed.slice(0, 40).map((pid) => `<span class="tag">${escapeHtml(pid)}</span>`).join('')}
        ${lg.count > 40 ? `<span class="muted" style="font-size:12px">…等 ${lg.count} 题</span>` : ''}
      </div>
    </div>` : ''}

    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">按难度分布</div>
      ${byDiff.map((b) => `
        <div class="bar-row">
          <span class="bar-label">${DIFF_LABEL[b.d]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${b.total ? Math.round(b.solved / b.total * 100) : 0}%"></div></div>
          <span class="bar-num">${b.solved}/${b.total}</span>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">题目状态</div>
      <table class="problem-table">
        <thead><tr><th>状态</th><th>题目</th><th>难度</th><th>提交/AC</th><th>最近判定</th><th>最近提交</th></tr></thead>
        <tbody>
          ${state.problems.map((p) => {
            const pr = state.progress.problems[p.id];
            const st = pr && pr.solved ? '<span class="solved-badge">已解决</span>' : (pr && pr.attempts ? '<span style="color:var(--orange)">尝试中</span>' : '<span class="muted">未做</span>');
            return `<tr class="problem-row" data-id="${p.id}">
              <td>${st}</td>
              <td><div class="problem-title-cell">${escapeHtml(p.title)}</div><div class="problem-meta">${p.id}</div></td>
              <td><span class="diff-stars" style="color:${DIFF_COLOR[p.difficulty]}">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span></td>
              <td class="mono">${pr ? pr.attempts : 0} / ${pr ? pr.acCount : 0}</td>
              <td>${pr && pr.lastVerdict ? `<span class="verdict v-${pr.lastVerdict}" style="font-size:11px;padding:1px 8px">${pr.lastVerdict}</span>` : '<span class="muted">-</span>'}</td>
              <td class="muted" style="font-size:12px">${fmtTime(pr && pr.lastSubmitAt)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="panel-title">薄弱题(多次未 AC) <span class="hint">建议优先复习</span></div>
      ${(() => {
        const weak = state.problems.filter((p) => problemStatus(p).weak);
        if (!weak.length) return '<div class="empty" style="padding:16px">暂无薄弱题,继续加油!</div>';
        return `<table class="problem-table">
          <thead><tr><th>题目</th><th>难度</th><th>提交/AC</th><th>通过率</th><th>最近判定</th></tr></thead>
          <tbody>
            ${weak.map((p) => {
              const pr = state.progress.problems[p.id];
              const rate = pr && pr.attempts ? Math.round(pr.acCount / pr.attempts * 100) : 0;
              return `<tr class="problem-row" data-id="${p.id}">
                <td><div class="problem-title-cell">${escapeHtml(p.title)}</div><div class="problem-meta">${p.id}</div></td>
                <td><span class="diff-stars" style="color:${DIFF_COLOR[p.difficulty]}">${'★'.repeat(p.difficulty)}${'☆'.repeat(5 - p.difficulty)}</span></td>
                <td class="mono">${pr.attempts} / ${pr.acCount}</td>
                <td class="mono" style="color:${rate < 30 ? 'var(--red)' : 'var(--orange)'}">${rate}%</td>
                <td><span class="verdict v-${pr.lastVerdict}" style="font-size:11px;padding:1px 8px">${pr.lastVerdict}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
      })()}
    </div>

    <div class="card">
      <div class="panel-title">最近提交</div>
      ${recent.length ? `<table class="result-table">
        <tr><th>时间</th><th>题目</th><th>语言</th><th>判定</th></tr>
        ${recent.slice(0, 20).map((r) => `<tr>
          <td class="muted">${fmtTime(r.at)}</td>
          <td>${escapeHtml((state.problems.find((p) => p.id === r.problemId) || {}).title || r.problemId)}</td>
          <td class="mono muted">${r.lang}</td>
          <td><span class="verdict v-${r.verdict}" style="font-size:11px;padding:1px 8px">${r.verdict}</span></td>
        </tr>`).join('')}
      </table>` : '<div class="empty">还没有提交记录,去做第一道题吧</div>'}
    </div>`;

  $$('#view .problem-row').forEach((r) => r.onclick = () => { location.hash = '#/problem/' + r.dataset.id; });
}

// ---------------- AI 教练 ----------------
function renderCoach() {
  const v = $('#view');
  v.innerHTML = `
    <div class="coach-layout">
      <div>
        <div class="panel-title">AI 教练 <span class="hint">引导式教学 · 默认不直接给答案</span></div>
        <div class="chat-box" id="chat-box">
          ${state.coach.messages.length ? state.coach.messages.map((m) => msgHtml(m)).join('') :
            `<div class="empty">向教练描述你的卡点,例如「a-plus-b 这题我 WA 了,我的思路是…」;教练会先引导你思考。</div>`}
        </div>
        <div class="chat-input">
          <textarea id="chat-input" placeholder="输入你的问题 / 思路 / 代码…(Enter 发送,Shift+Enter 换行)"></textarea>
          <button class="btn btn-primary" id="chat-send">发送</button>
        </div>
      </div>
      <div class="coach-side">
        <div class="card">
          <div class="panel-title" style="margin-bottom:8px">上下文题目</div>
          <select id="ctx-problem" style="width:100%">
            <option value="">无(自由提问)</option>
            ${state.problems.map((p) => `<option value="${p.id}" ${state.coach.problemId === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
          </select>
          <div class="hint" style="margin-top:8px">选择题目后,教练会结合题目描述与样例进行辅导。</div>
        </div>
        <div class="card">
          <div class="panel-title" style="margin-bottom:8px">模型设置</div>
          <div class="settings-form">
            <label>API Key(DeepSeek 或兼容服务)</label>
            <input type="password" id="set-key" placeholder="sk-…" value="${escapeHtml(state.settings.apiKey)}">
            <label>接口地址</label>
            <input type="text" id="set-endpoint" value="${escapeHtml(state.settings.endpoint)}">
            <label>模型</label>
            <input type="text" id="set-model" value="${escapeHtml(state.settings.model)}">
            <div class="row">
              <button class="btn btn-sm" id="set-save">保存设置</button>
              <button class="btn btn-sm" id="set-test">测试连接</button>
            </div>
            <div class="hint">未配置 Key 时,教练会用题目内置提示/题解兜底。Key 仅保存在本机浏览器。</div>
          </div>
        </div>
        <div class="card">
          <div class="panel-title" style="margin-bottom:8px">操作</div>
          <div class="row wrap">
            <button class="btn btn-sm" id="chat-clear">清空对话</button>
          </div>
        </div>
      </div>
    </div>`;

  const ta = $('#chat-input');
  const send = async () => {
    const q = ta.value.trim();
    if (!q || state.coach.busy) return;
    state.coach.messages.push({ role: 'user', content: q });
    ta.value = '';
    persistChat(); renderChat();
    state.coach.busy = true;
    renderChat();
    try {
      const r = await api('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.settings.apiKey },
        body: JSON.stringify({
          problemId: state.coach.problemId || '',
          question: q,
          history: state.coach.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
          endpoint: state.settings.endpoint,
          model: state.settings.model
        })
      });
      if (r.ok) {
        state.coach.messages.push({ role: 'ai', content: r.content });
        if (r.builtin) toast('使用了内置提示/题解(未配置 API Key)', 'ok');
      } else {
        state.coach.messages.push({ role: 'ai', content: `⚠️ ${r.message || '请求失败'}`, error: true });
        if (r.builtin) {
          const b = r.builtin;
          let extra = '';
          if (b.hints && b.hints.length) extra += '\n\n【内置提示】\n' + b.hints.map((h, i) => `${i + 1}. ${h}`).join('\n');
          if (b.editorial) extra += '\n\n【内置题解】\n' + b.editorial;
          state.coach.messages.push({ role: 'ai', content: extra, error: false });
        }
      }
    } catch (e) {
      state.coach.messages.push({ role: 'ai', content: '⚠️ 请求失败:' + e.message, error: true });
    }
    state.coach.busy = false;
    persistChat(); renderChat();
  };

  $('#chat-send').onclick = send;
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  $('#ctx-problem').onchange = (e) => { state.coach.problemId = e.target.value; };
  $('#set-save').onclick = () => {
    state.settings.apiKey = $('#set-key').value.trim();
    state.settings.endpoint = $('#set-endpoint').value.trim() || 'https://api.deepseek.com/chat/completions';
    state.settings.model = $('#set-model').value.trim() || 'deepseek-chat';
    saveLS('acm-trainer-settings', state.settings);
    toast('设置已保存', 'ok');
  };
  $('#set-test').onclick = async () => {
    const btn = $('#set-test');
    btn.disabled = true;
    const key = $('#set-key').value.trim();
    if (!key) { toast('请先填写 API Key', 'err'); btn.disabled = false; return; }
    state.settings.apiKey = key;
    saveLS('acm-trainer-settings', state.settings);
    try {
      const r = await api('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ question: '请只回复 OK 以确认连接。', problemId: '', endpoint: $('#set-endpoint').value.trim(), model: $('#set-model').value.trim() })
      });
      toast(r.ok ? '连接成功:' + r.content.slice(0, 60) : r.message, r.ok ? 'ok' : 'err');
    } catch (e) { toast('连接失败:' + e.message, 'err'); }
    btn.disabled = false;
  };
  $('#chat-clear').onclick = () => {
    state.coach.messages = [];
    persistChat();
    renderChat();
    toast('对话已清空', 'ok');
  };
}

function msgHtml(m) {
  const cls = m.role === 'user' ? 'user' : 'ai' + (m.error ? ' error' : '');
  const role = m.role === 'user' ? '你' : 'AI 教练';
  return `<div class="msg ${cls}"><div class="role">${role}</div><div>${md(m.content)}</div></div>`;
}

function persistChat() {
  saveLS('acm-trainer-chat', state.coach.messages.slice(-100));
}

function renderChat() {
  const box = $('#chat-box');
  if (!box) return;
  box.innerHTML = state.coach.messages.length ? state.coach.messages.map((m) => msgHtml(m)).join('') : '<div class="empty">开始对话吧</div>';
  box.scrollTop = box.scrollHeight;
  const btn = $('#chat-send');
  if (btn) { btn.disabled = state.coach.busy; btn.innerHTML = state.coach.busy ? '<span class="spin"></span> 思考中' : '发送'; }
}

// ---------------- 通用 ----------------
function confirmModal(title, text, onOk) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal">
    <h4>${escapeHtml(title)}</h4>
    <p class="muted">${escapeHtml(text)}</p>
    <div class="actions">
      <button class="btn" data-act="no">再想想</button>
      <button class="btn btn-primary" data-act="yes">确定</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  mask.querySelector('[data-act="no"]').onclick = () => mask.remove();
  mask.querySelector('[data-act="yes"]').onclick = () => { mask.remove(); onOk(); };
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
}

// ---------------- 启动 ----------------
async function boot() {
  // 健康检查
  const dot = $('#server-dot'), st = $('#server-status');
  const checkHealth = async () => {
    try {
      const h = await api('/api/health');
      dot.classList.toggle('ok', !!h.ok);
      dot.classList.remove('bad');
      st.textContent = h.ok ? `服务器正常 · ${h.problems} 道题` : '服务器异常';
    } catch (e) {
      dot.classList.remove('ok');
      dot.classList.add('bad');
      st.textContent = '无法连接服务器';
    }
  };
  checkHealth();
  setInterval(checkHealth, 15000);

  try {
    const [p, x, pr] = await Promise.all([
      api('/api/problems'),
      api('/api/xcpc'),
      api('/api/progress')
    ]);
    state.problems = p.problems;
    state.plan = x.plan;
    state.progress = pr.progress;
    if (!state.progress.problems) state.progress.problems = {};
    if (!state.progress.plan) state.progress.plan = {};
    // 迁移:旧版单笔记(notePlan) → 多笔记(notePlans)
    if (state.progress.notePlan && !Array.isArray(state.progress.notePlans)) {
      state.progress.notePlans = [state.progress.notePlan];
      delete state.progress.notePlan;
    }
    if (!state.progress.notePlans) state.progress.notePlans = [];
    if (!state.progress.version) { state.progress.version = 1; saveProgress(); }
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">初始化失败:${escapeHtml(e.message)}<br>请确认服务器已启动(node server.js)</div>`;
    return;
  }

  // 标签页
  $$('.tab').forEach((t) => t.onclick = () => { location.hash = '#/' + t.dataset.tab; });
  window.addEventListener('hashchange', router);
  router();
}

document.addEventListener('DOMContentLoaded', boot);
