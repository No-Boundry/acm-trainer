/**
 * SQLite 建表语句（幂等）。
 * 与 docs/03-详细设计 §1.2 DDL 保持一致。
 */
export const SCHEMA_SQL = `
-- 知识点标签
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- 题目（多数据源：cf / luogu / leetcode，v1.1 FR-8 / v1.9 FR-21）
CREATE TABLE IF NOT EXISTS problems (
  id            TEXT PRIMARY KEY,     -- '1741:A'(cf) / 'P1000'(luogu) / 'LC1'(leetcode)，前缀天然分区
  contest_id    INTEGER NOT NULL,     -- cf 竞赛号；luogu / leetcode 行固定 0
  "index"       TEXT NOT NULL,        -- cf 题号字母；luogu 行 = pid；leetcode 行 = titleSlug
  name          TEXT NOT NULL,
  rating        INTEGER,              -- cf 难度分（仅 cf 行非空）
  difficulty    INTEGER,              -- 洛谷难度 0-7 / 力扣难度 1-3（按 source 解释）
  solved_count  INTEGER NOT NULL DEFAULT 0,  -- cf: 全球AC数 / luogu: totalAccepted / leetcode: total_acs
  total_submit  INTEGER NOT NULL DEFAULT 0,  -- luogu: totalSubmit / leetcode: total_submitted
  source        TEXT NOT NULL DEFAULT 'cf' CHECK (source IN ('cf','luogu','leetcode')),
  cf_url        TEXT NOT NULL,        -- 语义：来源题面 URL（cf / luogu / leetcode）
  fetched_at    TEXT NOT NULL,
  UNIQUE (contest_id, "index")
);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_problem_tags_tag ON problem_tags(tag_id);

-- 练习记录
CREATE TABLE IF NOT EXISTS practice_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id       TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  status           TEXT    NOT NULL CHECK (status IN
                     ('AC','WA','TLE','RE','MLE','CE','SKIP','UNSOLVED')),
  duration_seconds INTEGER,
  note             TEXT,
  is_mistake       INTEGER NOT NULL DEFAULT 0,
  import_source    TEXT,              -- v1.2 FR-8.9：'luogu-import'（UID 导入标记，幂等去重用）
  created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_records_problem ON practice_records(problem_id);
CREATE INDEX IF NOT EXISTS idx_records_created ON practice_records(created_at);

-- 笔记（错题本/题解）
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id TEXT REFERENCES problems(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notes_problem ON notes(problem_id);

-- 代码模板
CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'C++',
  description TEXT NOT NULL DEFAULT '',
  code        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 虚拟比赛
CREATE TABLE IF NOT EXISTS contests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','finished')),
  started_at       TEXT,
  finished_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  problem_id TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  PRIMARY KEY (contest_id, position)
);

CREATE TABLE IF NOT EXISTS contest_submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id      INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id      TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  status          TEXT    NOT NULL,
  seconds_elapsed INTEGER NOT NULL,
  submitted_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_contest_sub ON contest_submissions(contest_id);

-- 水平评估历史
CREATE TABLE IF NOT EXISTS rating_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rating     INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  detail     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 题单（v1.10 FR-27）
CREATE TABLE IF NOT EXISTS problem_lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 来源：manual=手动勾选 / paste=粘贴识别 / generate=按知识点生成
  origin      TEXT NOT NULL DEFAULT 'manual',
  -- 关联比赛赛道（可选：lanqiao / gplt / icpc / noip / nowcoder）
  track_id    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 题单条目（含 v1.10 FR-29 间隔复习状态）
CREATE TABLE IF NOT EXISTS problem_list_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id        INTEGER NOT NULL REFERENCES problem_lists(id) ON DELETE CASCADE,
  problem_id     TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL DEFAULT 0,
  done           INTEGER NOT NULL DEFAULT 0,
  done_at        TEXT,
  note           TEXT NOT NULL DEFAULT '',
  -- 复习：stage 0=未进入复习（未完成）/ 1..6 = 1/3/7/14/30/60 天阶梯
  review_stage   INTEGER NOT NULL DEFAULT 0,
  review_due     TEXT,
  review_last_at TEXT,
  review_ease    TEXT,
  UNIQUE (list_id, problem_id)
);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON problem_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_due ON problem_list_items(review_due);

-- 训练计划（v1.10 FR-28）：日历排期式
CREATE TABLE IF NOT EXISTS training_plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  list_id        INTEGER REFERENCES problem_lists(id) ON DELETE SET NULL,
  target_date    TEXT,
  daily_target   INTEGER NOT NULL DEFAULT 3,
  rating_min     INTEGER,
  rating_max     INTEGER,
  -- 优先知识点（技能树节点 id，JSON 数组）
  knowledge_ids  TEXT NOT NULL DEFAULT '[]',
  -- 每周固定休息日（0=周日 … 6=周六，JSON 数组）
  rest_weekdays  TEXT NOT NULL DEFAULT '[]',
  track_id       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  problem_id TEXT    NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  due_date   TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  done_at    TEXT,
  UNIQUE (plan_id, problem_id)
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan ON plan_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_due ON plan_tasks(due_date);

-- 计划内的「没空日」（标记后任务自动顺延）
CREATE TABLE IF NOT EXISTS plan_busy_days (
  plan_id INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  date    TEXT    NOT NULL,
  reason  TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (plan_id, date)
);

-- 设置
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
