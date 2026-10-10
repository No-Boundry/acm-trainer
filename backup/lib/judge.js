// 本地判题机:编译 + 逐测试点运行 + 比对输出。
// 设计说明:
//  - 零 npm 依赖,仅用 node:child_process / node:fs / node:path / node:os。
//  - 程序直接 spawn(不包 cmd),stdio 使用文件描述符(stdin/stdout/stderr 全走文件),
//    避免管道捕获;超时用 child.kill() 终止直接子进程(Windows 上父进程可终止自己的子进程),
//    并带硬超时兜底,保证任何情况下判题都不会挂死。
//  - 内存限制:用 Windows Job Object 硬限制(memlimit.c 编译出的辅助进程),
//    超出即被系统终止,判 MLE;同时上报每个测试点的峰值内存。
//    辅助进程编译失败时自动降级为"仅时间限制"(memLimitEnabled=false)。
//  - 支持 C(gcc)/ C++(g++)/ Python(python)。
//  - 判题队列串行执行,防止同时跑多个程序。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const OUTPUT_CAP = 256 * 1024;   // 输出上限字节,超过判 OLE
const COMPILE_TIMEOUT = 20000;   // 编译超时 ms
const RUN_GRACE = 300;           // 运行超时的额外宽限 ms(进程启动开销)
const HARD_FALLBACK = 1500;      // 杀死失败时强制返回的兜底宽限 ms
const COMPILE_ERR_CAP = 8 * 1024;

const LANGS = {
  cpp: { label: 'C++17', file: 'main.cpp', exe: 'main.exe', compile: (exe) => ['g++', '-O2', '-std=c++17', 'main.cpp', '-o', exe, '-lm'] },
  c: { label: 'C11', file: 'main.c', exe: 'main.exe', compile: (exe) => ['gcc', '-O2', '-std=c11', 'main.c', '-o', exe, '-lm'] },
  python: { label: 'Python 3', file: 'main.py', exe: null, runExe: 'python', runArgs: ['main.py'] }
};

// ---------- 内存限制辅助进程(memlimit.c → .cache/memlimit.exe) ----------
const memlimit = {
  ready: false,
  exe: null,
  error: ''
};

function compileMemlimitHelper() {
  const dir = path.join(__dirname, '.cache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { memlimit.error = '无法创建缓存目录'; return; }
  const exe = path.join(dir, 'memlimit.exe');
  if (fs.existsSync(exe)) { memlimit.ready = true; memlimit.exe = exe; return; }
  const src = path.join(__dirname, 'memlimit.c');
  if (!fs.existsSync(src)) { memlimit.error = '缺少 memlimit.c'; return; }
  const args = ['-O2', '-municode', src, '-o', exe, '-lpsapi'];
  runProcess('g++', args, __dirname, 20000, { errFile: path.join(dir, 'compile_err.txt') }).then((r) => {
    if (r.code === 0 && fs.existsSync(exe)) {
      memlimit.ready = true;
      memlimit.exe = exe;
    } else {
      memlimit.error = `内存限制辅助进程编译失败(${r.error || 'exit ' + r.code}),本次仅按时间限制判题`;
    }
  });
}
compileMemlimitHelper(); // 模块加载时异步编译一次

// ---------- 输出比对(ACM 惯例:忽略行尾空白与首尾空行,保留内部结构与前导空格) ----------
function normalize(s) {
  const lines = String(s).replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ---------- 直接运行一个进程(fd 型 stdio,可被 kill) ----------
function runProcess(exe, args, cwd, timeoutMs, files) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timedOut = false;
    let settled = false;
    let child = null;
    let timer = null;
    let hardTimer = null;

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      const code = extra && extra.code != null ? extra.code : (child && child.exitCode != null ? child.exitCode : -1);
      resolve({ timedOut, code, elapsed: Date.now() - start, error: extra && extra.error });
    };

    const openFd = (f, flags) => { try { return fs.openSync(f, flags); } catch (e) { return 'ignore'; } };

    try {
      child = spawn(exe, args, {
        cwd,
        windowsHide: true,
        stdio: [
          files.inFile ? openFd(files.inFile, 'r') : 'ignore',
          files.outFile ? openFd(files.outFile, 'w') : 'ignore',
          files.errFile ? openFd(files.errFile, 'w') : 'ignore'
        ]
      });
    } catch (e) {
      return finish({ error: String(e && e.message || e) });
    }

    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (e) { /* ignore */ }
    }, timeoutMs);

    // 硬兜底:即使 kill 失败也强制返回,绝不让判题挂死
    hardTimer = setTimeout(() => finish({}), timeoutMs + HARD_FALLBACK);

    child.on('error', (err) => finish({ error: String(err.message || err) }));
    child.on('close', (code) => finish({ code }));
  });
}

function readIfExists(file, cap) {
  try {
    const st = fs.statSync(file);
    if (st.size > cap) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
}

// ---------- 队列:串行判题 ----------
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});
  return run;
}

/**
 * 判一份提交。
 * @param {object} p 题目对象(含 tests)
 * @param {string} lang cpp | c | python
 * @param {string} code
 * @returns {Promise<object>}
 */
function judge(p, lang, code) {
  return enqueue(() => doJudge(p, lang, code));
}

async function doJudge(p, lang, code) {
  const spec = LANGS[lang];
  if (!spec) return { verdict: 'IE', message: `不支持的语言:${lang}` };
  if (typeof code !== 'string' || code.length === 0) return { verdict: 'CE', message: '代码为空' };
  if (code.length > 256 * 1024) return { verdict: 'CE', message: '代码过长(上限 256KB)' };

  const runDir = path.join(os.tmpdir(), 'acm-trainer-run', crypto.randomUUID());
  fs.mkdirSync(runDir, { recursive: true });
  const clean = () => {
    try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (e) { /* ignore */ }
  };

  const result = {
    verdict: 'IE',
    timeMs: 0,
    compileError: '',
    testResults: [],
    total: p.tests ? p.tests.length : 0,
    passed: 0,
    message: ''
  };

  try {
    // 1) 写源码
    const srcFile = path.join(runDir, spec.file);
    fs.writeFileSync(srcFile, code);

    // 2) 编译(C/C++)
    if (spec.compile) {
      const exeName = spec.exe;
      const errFile = path.join(runDir, 'compile_err.txt');
      const compileArgs = spec.compile(exeName);
      const cr = await runProcess(compileArgs[0], compileArgs.slice(1), runDir, COMPILE_TIMEOUT, { errFile });
      if (cr.error) {
        result.verdict = 'IE';
        result.message = `无法启动编译器:${cr.error}`;
        return result;
      }
      const errText = readIfExists(errFile, COMPILE_ERR_CAP);
      if (cr.timedOut) {
        result.verdict = 'CE';
        result.compileError = '编译超时';
        return result;
      }
      if (cr.code !== 0 || !fs.existsSync(path.join(runDir, exeName))) {
        result.verdict = 'CE';
        result.compileError = (errText || '编译失败(无错误输出)').slice(0, COMPILE_ERR_CAP);
        return result;
      }
    }

    // 3) 逐测试点运行
    const tests = p.tests || [];
    const limitMB = p.memoryLimit || 256;
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const inFile = path.join(runDir, 'in.txt');
      const outFile = path.join(runDir, 'out.txt');
      const errFile = path.join(runDir, 'err.txt');
      fs.writeFileSync(inFile, t.input || '');

      const runExe = spec.runExe || path.join(runDir, spec.exe);
      const runArgs = spec.runArgs || [];

      let rr;
      let peakKB = 0;
      let exitCode = null;
      let timedOut = false;
      let memExceeded = false;
      let helperReport = null;
      if (memlimit.ready) {
        // 经辅助进程运行:严格超时 + 内存限制(轮询采样,超限即被终止)
        const reportFile = path.join(runDir, 'report.txt');
        rr = await runProcess(
          memlimit.exe,
          [String(limitMB), String(p.timeLimit), reportFile, runExe, ...runArgs],
          runDir,
          p.timeLimit + 1500,
          { inFile, outFile, errFile }
        );
        helperReport = readIfExists(reportFile, 1024);
        if (helperReport) {
          const m1 = helperReport.match(/peak_kb=(\d+)/); if (m1) peakKB = Number(m1[1]);
          const m2 = helperReport.match(/exit_code=(-?\d+)/); if (m2) exitCode = Number(m2[1]);
          timedOut = /timed_out=1/.test(helperReport);
          memExceeded = /mem_exceeded=1/.test(helperReport);
        }
      } else {
        rr = await runProcess(runExe, runArgs, runDir, p.timeLimit + RUN_GRACE, { inFile, outFile, errFile });
        exitCode = rr.code;
        timedOut = rr.timedOut;
      }

      const outText = readIfExists(outFile, OUTPUT_CAP);
      const errText = readIfExists(errFile, 2048);
      const timeMs = rr.elapsed || 0;

      // 内存相关终止码(系统级,兜底识别)
      const MEM_STATUS_CODES = [0xC0000148, 0xC000012D, 0xC0000017]; // STATUS_JOB_OBJECT_MEMORY_LIMIT / COMMITMENT_LIMIT / NO_MEMORY

      let v;
      let detail = { index: i, timeMs, memKB: peakKB, verdict: 'AC' };
      if (rr.error) { v = 'IE'; detail.message = `无法运行:${rr.error}`; }
      else if (timedOut) { v = 'TLE'; detail.message = `超出时间限制 ${p.timeLimit}ms`; }
      else if (memlimit.ready && !helperReport) { v = 'IE'; detail.message = '内存限制辅助进程未返回报告'; }
      else if (memExceeded || (memlimit.ready && peakKB > limitMB * 1024) || MEM_STATUS_CODES.includes(exitCode)) { v = 'MLE'; detail.message = `超出内存限制 ${limitMB}MB(峰值 ${fmtKB(peakKB)})`; }
      else if (outText === null) { v = 'OLE'; detail.message = `输出过大(上限 ${OUTPUT_CAP / 1024}KB)`; }
      else if (exitCode !== 0) { v = 'RE'; detail.message = `运行时错误,退出码 ${exitCode}`; if (errText) detail.message += `\n${errText.slice(0, 1024)}`; }
      else {
        const expected = normalize(t.output || '');
        const got = normalize(outText);
        if (got === expected) { v = 'AC'; }
        else {
          v = 'WA';
          detail.message = '输出与答案不一致';
          detail.input = (t.input || '').slice(0, 2000);
          detail.expected = (t.output || '').slice(0, 2000);
          detail.got = (outText || '').slice(0, 2000);
        }
      }
      detail.verdict = v;
      result.testResults.push(detail);
      if (v === 'AC') result.passed++;
    }

    // 4) 汇总判定
    if (result.testResults.length === 0) { result.verdict = 'IE'; result.message = '题目没有测试数据'; }
    else if (result.testResults.every((r) => r.verdict === 'AC')) {
      result.verdict = 'AC';
      result.message = `全部 ${result.testResults.length} 个测试点通过`;
    } else {
      const first = result.testResults.find((r) => r.verdict !== 'AC');
      result.verdict = first.verdict;
      result.message = `第 ${first.index + 1}/${result.testResults.length} 个测试点 ${first.verdict}` +
        (first.message ? `:${first.message.split('\n')[0]}` : '');
      if (result.verdict === 'WA') {
        const a = normalize((first.expected || '')).split('\n');
        const b = normalize((first.got || '')).split('\n');
        const diffLines = [];
        for (let k = 0; k < Math.max(a.length, b.length); k++) {
          if (a[k] !== b[k]) diffLines.push(`期望第 ${k + 1} 行:${a[k] === undefined ? '(无)' : JSON.stringify(a[k])}  实际:${b[k] === undefined ? '(无)' : JSON.stringify(b[k])}`);
          if (diffLines.length >= 5) break;
        }
        first.diff = diffLines;
      }
    }
    result.timeMs = result.testResults.reduce((a, r) => a + (r.timeMs || 0), 0);
    result.peakMemKB = result.testResults.reduce((a, r) => Math.max(a, r.memKB || 0), 0);
    result.memLimitEnabled = memlimit.ready;
    return result;
  } catch (e) {
    result.verdict = 'IE';
    result.message = `判题机内部错误:${e && e.message || e}`;
    return result;
  } finally {
    clean();
  }
}

module.exports = { judge, normalize, LANGS };

// ---------- 内存格式化 ----------
function fmtKB(kb) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
