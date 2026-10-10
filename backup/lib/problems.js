// 题库加载与对外视图:对外不暴露隐藏测试数据。
const problems = require('../data/problems.js');
const xcpc = require('../data/xcpc2026.js');

const byId = new Map();
for (const p of problems) byId.set(p.id, p);

function listView() {
  return problems.map((p) => ({
    id: p.id,
    title: p.title,
    source: p.source,
    difficulty: p.difficulty,
    tags: p.tags,
    timeLimit: p.timeLimit,
    memoryLimit: p.memoryLimit,
    sampleCount: (p.samples || []).length,
    testCount: (p.tests || []).length
  }));
}

function detailView(id) {
  const p = byId.get(id);
  if (!p) return null;
  const { tests, ...rest } = p;
  return rest;
}

module.exports = { problems, byId, xcpc, listView, detailView };
