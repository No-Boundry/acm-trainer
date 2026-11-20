import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../../src/main/db/index'
import { createRepos, type Repos } from '../../src/main/services/index'
import { buildSkillReport } from '../../src/main/services/skill'
import { SKILL_NODES } from '@shared/skill-tree'
import { canonicalTags } from '@shared/tag-map'
import type { ProblemUpsertInput } from '@shared/types'

/**
 * 掌握度广度门槛（v1.21.1 FR-45）集成：
 * 节点把多个标签的知识点并在一起，只刷其中一个标签不能让整个知识点「基本掌握 / 熟练」；
 * 分母只统计「本地题库里有题」的标签（tagTotal），分子是已有至少 1 道 AC 的标签数（coveredTags）。
 */

let db: ReturnType<typeof initDb>
let repos: Repos

const stringsNode = SKILL_NODES.find((n) => n.id === 'strings')!
const stringsTags = canonicalTags(stringsNode.tags)

function problem(index: string, tags: string[]): ProblemUpsertInput {
  return { contestId: 0, index, name: `题目 ${index}`, solvedCount: 0, source: 'luogu', tags, difficulty: 3 }
}

beforeEach(() => {
  closeDb()
  db = initDb(':memory:')
  repos = createRepos()
})

afterEach(() => closeDb())

describe('buildSkillReport：掌握度广度（tagTotal / coveredTags）', () => {
  it('分母只算本地有题的标签；只 AC 其中一个标签 → 档位被压到 learning', () => {
    // 只为节点的前 4 个标签建题（第 5 个标签本地没题，不计入分母）
    const seeded = stringsTags.slice(0, 4)
    const inputs: ProblemUpsertInput[] = []
    // 12 道 AC 全压在第一个标签上：聚合口径已是 proficient
    for (let i = 1; i <= 12; i++) inputs.push(problem(`S${i}`, [seeded[0]]))
    for (let t = 1; t < seeded.length; t++) inputs.push(problem(`T${t}`, [seeded[t]]))
    repos.problems.upsertMany(inputs, '2026-10-04 10:00:00')
    for (let i = 1; i <= 12; i++) repos.records.create({ problemId: `S${i}`, status: 'AC' })

    const report = buildSkillReport(repos)
    const node = report.nodes.find((n) => n.id === 'strings')!
    expect(node.stats.acProblems).toBe(12)
    expect(node.stats.tagTotal).toBe(4) // 5 个标签里只有 4 个本地有题
    expect(node.stats.coveredTags).toBe(1)
    expect(node.tier).not.toBe('proficient')
    expect(node.tier).not.toBe('master')
    // 聚合口径本身达到 proficient，广度把它压到 learning
    expect(node.tier).toBe('learning')
  })

  it('覆盖到 60% 及以上才允许 proficient（同一聚合口径）', () => {
    const seeded = stringsTags.slice(0, 4) // 60% = 3，4 个可练标签 → 全覆盖
    const inputs: ProblemUpsertInput[] = []
    for (let t = 0; t < seeded.length; t++) inputs.push(problem(`C${t}`, [seeded[t]]))
    for (let i = 1; i <= 12; i++) inputs.push(problem(`D${i}`, [seeded[0]]))
    repos.problems.upsertMany(inputs, '2026-10-04 10:00:00')
    // 4 个标签各 AC 至少 1 题 → covered 4/4
    for (let t = 0; t < seeded.length; t++) repos.records.create({ problemId: `C${t}`, status: 'AC' })
    for (let i = 1; i <= 12; i++) repos.records.create({ problemId: `D${i}`, status: 'AC' })

    const report = buildSkillReport(repos)
    const node = report.nodes.find((n) => n.id === 'strings')!
    expect(node.stats.tagTotal).toBe(4)
    expect(node.stats.coveredTags).toBe(4)
    expect(node.tier).toBe('proficient')
  })

  it('中英文标签先归一：题目标签写 strings 也能算进「字符串与 KMP」节点', () => {
    repos.problems.upsertMany([problem('E1', ['strings'])], '2026-10-04 10:00:00')
    repos.records.create({ problemId: 'E1', status: 'AC' })

    const report = buildSkillReport(repos)
    const node = report.nodes.find((n) => n.id === 'strings')!
    expect(node.stats.tagTotal).toBe(1) // 本地只有「字符串」这一个可练标签
    expect(node.stats.coveredTags).toBe(1)
  })
})
