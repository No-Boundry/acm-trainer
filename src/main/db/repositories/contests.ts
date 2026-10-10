import type { Database } from 'better-sqlite3'
import type {
  Contest,
  ContestListItem,
  ContestProblem,
  ResultStatus
} from '@shared/types'
import { RESULT_STATUSES } from '@shared/types'
import { AppError } from '../errors'

interface ContestRow {
  id: number
  name: string
  durationMinutes: number
  status: Contest['status']
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

interface SubmissionRow {
  id: number
  contestId: number
  problemId: string
  status: ResultStatus
  secondsElapsed: number
  submittedAt: string
}

function nowLocal(): string {
  // SQLite 默认时间格式一致：'YYYY-MM-DD HH:MM:SS'
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export interface CreateContestInput {
  name: string
  durationMinutes: number
  problemIds: string[]
}

export class ContestsRepo {
  constructor(private db: Database) {}

  /** 创建比赛 + 题目（事务） */
  createContest(input: CreateContestInput): Contest {
    if (input.problemIds.length === 0) {
      throw new AppError('VALIDATION', '比赛至少需要 1 道题')
    }
    const run = this.db.transaction(() => {
      const info = this.db
        .prepare(
          `INSERT INTO contests (name, duration_minutes, status, created_at)
           VALUES (@name, @durationMinutes, 'pending', @createdAt)`
        )
        .run({
          name: input.name,
          durationMinutes: input.durationMinutes,
          createdAt: nowLocal()
        })
      const contestId = info.lastInsertRowid as number
      const insertProblem = this.db.prepare(
        'INSERT INTO contest_problems (contest_id, position, problem_id) VALUES (?, ?, ?)'
      )
      input.problemIds.forEach((pid, i) => {
        insertProblem.run(contestId, i, pid)
      })
      return contestId
    })
    const id = run()
    const contest = this.getById(id)
    if (!contest) throw new AppError('DB_ERROR', '比赛创建后读取失败')
    return contest
  }

  start(id: number): Contest {
    const row = this.getRow(id)
    if (!row) throw new AppError('NOT_FOUND', '比赛不存在')
    if (row.status === 'running') throw new AppError('CONTEST_ALREADY_RUNNING', '比赛已在运行中')
    if (row.status === 'finished') throw new AppError('CONTEST_ALREADY_FINISHED', '比赛已结束')
    // 同时只允许一场比赛运行
    const running = this.db
      .prepare(`SELECT id FROM contests WHERE status = 'running' AND id != ? LIMIT 1`)
      .get(id)
    if (running) throw new AppError('CONTEST_ALREADY_RUNNING', '已有一场进行中的比赛，请先结束')
    this.db
      .prepare(`UPDATE contests SET status = 'running', started_at = ? WHERE id = ?`)
      .run(nowLocal(), id)
    const contest = this.getById(id)
    if (!contest) throw new AppError('DB_ERROR', '比赛读取失败')
    return contest
  }

  submit(contestId: number, problemId: string, status: ResultStatus): Contest {
    if (!RESULT_STATUSES.includes(status)) {
      throw new AppError('VALIDATION', `非法状态: ${status}`)
    }
    const row = this.getRow(contestId)
    if (!row) throw new AppError('NOT_FOUND', '比赛不存在')
    if (row.status !== 'running') throw new AppError('CONTEST_NOT_RUNNING', '比赛未在运行中')
    if (!row.startedAt) throw new AppError('CONTEST_NOT_RUNNING', '比赛缺少开始时间')

    // 校验题目属于本场比赛
    const inContest = this.db
      .prepare('SELECT 1 FROM contest_problems WHERE contest_id = ? AND problem_id = ?')
      .get(contestId, problemId)
    if (!inContest) throw new AppError('VALIDATION', '该题目不属于此比赛')

    const started = new Date(row.startedAt.replace(' ', 'T')).getTime()
    const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000))

    // 超时后不再接受提交（ACM 规则）
    if (elapsed > row.durationMinutes * 60) {
      throw new AppError('CONTEST_TIME_UP', '比赛时间已到，无法再提交')
    }

    this.db
      .prepare(
        `INSERT INTO contest_submissions (contest_id, problem_id, status, seconds_elapsed, submitted_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(contestId, problemId, status, elapsed, nowLocal())
    const contest = this.getById(contestId)
    if (!contest) throw new AppError('DB_ERROR', '比赛读取失败')
    return contest
  }

  /** 删除比赛（级联删除题目与提交记录） */
  deleteContest(id: number): void {
    const info = this.db.prepare('DELETE FROM contests WHERE id = ?').run(id)
    if (info.changes === 0) throw new AppError('NOT_FOUND', '比赛不存在')
  }

  finish(id: number): Contest {
    const row = this.getRow(id)
    if (!row) throw new AppError('NOT_FOUND', '比赛不存在')
    if (row.status !== 'running') throw new AppError('CONTEST_NOT_RUNNING', '只有运行中的比赛可以结束')
    this.db
      .prepare(`UPDATE contests SET status = 'finished', finished_at = ? WHERE id = ?`)
      .run(nowLocal(), id)
    const contest = this.getById(id)
    if (!contest) throw new AppError('DB_ERROR', '比赛读取失败')
    return contest
  }

  getById(id: number): Contest | null {
    const row = this.getRow(id)
    if (!row) return null

    const problemRows = this.db
      .prepare(
        `SELECT cp.position, cp.problem_id AS problemId
         FROM contest_problems cp
         WHERE cp.contest_id = ?
         ORDER BY cp.position`
      )
      .all(id) as { position: number; problemId: string }[]

    const submissionRows = this.db
      .prepare(
        `SELECT id, contest_id AS contestId, problem_id AS problemId, status,
                seconds_elapsed AS secondsElapsed, submitted_at AS submittedAt
         FROM contest_submissions WHERE contest_id = ? ORDER BY id`
      )
      .all(id) as SubmissionRow[]

    return {
      id: row.id,
      name: row.name,
      durationMinutes: row.durationMinutes,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdAt: row.createdAt,
      problems: problemRows.map((p) => ({
        position: p.position,
        problem: { id: p.problemId } as ContestProblem['problem'] // 题目详情由 service 层补充
      })),
      submissions: submissionRows.map((s) => ({
        id: s.id,
        problemId: s.problemId,
        status: s.status,
        secondsElapsed: s.secondsElapsed,
        submittedAt: s.submittedAt
      }))
    }
  }

  /** 轻量列表 */
  list(): ContestListItem[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.duration_minutes AS durationMinutes, c.status,
                c.started_at AS startedAt, c.finished_at AS finishedAt, c.created_at AS createdAt,
                (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problemCount,
                (SELECT COUNT(DISTINCT cs.problem_id) FROM contest_submissions cs
                  WHERE cs.contest_id = c.id AND cs.status = 'AC') AS solvedCount
         FROM contests c
         ORDER BY c.created_at DESC, c.id DESC`
      )
      .all() as (ContestRow & { problemCount: number; solvedCount: number })[]
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      durationMinutes: r.durationMinutes,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      createdAt: r.createdAt,
      problemCount: r.problemCount,
      solvedCount: r.solvedCount
    }))
  }

  private getRow(id: number): ContestRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, duration_minutes AS durationMinutes, status,
                started_at AS startedAt, finished_at AS finishedAt, created_at AS createdAt
         FROM contests WHERE id = ?`
      )
      .get(id) as ContestRow | undefined
    return row ?? null
  }
}
