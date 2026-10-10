import { describe, it, expect } from 'vitest'
import { SKILL_NODES, SKILL_NODE_MAP } from '@shared/skill-tree'
import { SKILL_TRACKS, SKILL_TRACK_MAP, isTrackDone, trackNodeIds, trackProgress } from '@shared/skill-tracks'
import type { MasteryTier } from '@shared/types'

/**
 * 国内比赛赛道（v1.10 FR-26）：数据合法性 + 进度计算。
 * 赛道引用不存在的节点会在界面静默失效，故这里强校验。
 */

describe('赛道数据合法性', () => {
  it('至少 5 个赛道，id/名称唯一', () => {
    expect(SKILL_TRACKS.length).toBeGreaterThanOrEqual(5)
    expect(new Set(SKILL_TRACKS.map((t) => t.id)).size).toBe(SKILL_TRACKS.length)
    expect(new Set(SKILL_TRACKS.map((t) => t.name)).size).toBe(SKILL_TRACKS.length)
  })

  it('覆盖国内主要比赛：蓝桥杯 / 天梯赛 / ICPC-CCPC / NOIP-CSP / 牛客', () => {
    const ids = SKILL_TRACKS.map((t) => t.id)
    for (const id of ['lanqiao', 'gplt', 'icpc', 'noip', 'nowcoder']) {
      expect(ids, `缺少赛道 ${id}`).toContain(id)
    }
  })

  it('focus / required 引用的节点都存在，且不为空、无重复', () => {
    for (const t of SKILL_TRACKS) {
      expect(t.focus.length, `${t.id} focus 为空`).toBeGreaterThan(0)
      expect(t.required.length, `${t.id} required 为空`).toBeGreaterThan(0)
      expect(new Set(t.focus).size, `${t.id} focus 有重复`).toBe(t.focus.length)
      expect(new Set(t.required).size, `${t.id} required 有重复`).toBe(t.required.length)
      for (const id of [...t.focus, ...t.required]) {
        expect(SKILL_NODE_MAP.get(id), `${t.id} 引用了不存在的节点 ${id}`).toBeTruthy()
      }
    }
  })

  it('required 必须包含在 focus 中（必达项也是重点项）', () => {
    for (const t of SKILL_TRACKS) {
      for (const id of t.required) {
        expect(t.focus, `${t.id} 的必达节点 ${id} 不在重点列表中`).toContain(id)
      }
    }
  })

  it('难度区间合法（下限 < 上限）', () => {
    for (const t of SKILL_TRACKS) {
      expect(t.ratingRange[0]).toBeLessThan(t.ratingRange[1])
    }
  })

  it('赛道覆盖面：ICPC 区域赛的重点节点数最多（全图谱定位）', () => {
    const sorted = [...SKILL_TRACKS].sort((a, b) => b.focus.length - a.focus.length)
    expect(sorted[0].id).toBe('icpc')
  })

  it('trackNodeIds 返回 focus ∪ required', () => {
    const t = SKILL_TRACK_MAP.get('noip')!
    const set = trackNodeIds(t)
    expect(set.size).toBe(new Set([...t.focus, ...t.required]).size)
    expect(set.has('dp')).toBe(true)
  })
})

describe('赛道进度计算', () => {
  const tierOf = (id: string, tier: MasteryTier): { id: string; layer: number; tier: MasteryTier; depsReady: boolean } => ({
    id,
    layer: SKILL_NODE_MAP.get(id)!.layer,
    tier,
    depsReady: true
  })

  it('未达标时 requiredDone=0，nextIds 按 layer 升序给出建议', () => {
    const track = SKILL_TRACK_MAP.get('lanqiao')!
    const nodes = SKILL_NODES.map((n) => tierOf(n.id, 'untouched'))
    const p = trackProgress(track, nodes)
    expect(p.requiredDone).toBe(0)
    expect(p.requiredTotal).toBe(track.required.length)
    expect(p.focusTotal).toBe(track.focus.length)
    expect(p.nextIds.length).toBeGreaterThan(0)
    // 按 layer 升序（同层按 focus 顺序）
    const layers = p.nextIds.map((id) => SKILL_NODE_MAP.get(id)!.layer)
    expect([...layers].sort((a, b) => a - b)).toEqual(layers)
  })

  it('达标线是「基本掌握」及以上（learning 不算达标）', () => {
    expect(isTrackDone('untouched')).toBe(false)
    expect(isTrackDone('newbie')).toBe(false)
    expect(isTrackDone('learning')).toBe(false)
    expect(isTrackDone('proficient')).toBe(true)
    expect(isTrackDone('master')).toBe(true)
  })

  it('全部达标 → 进度 100% 且 nextIds 为空', () => {
    const track = SKILL_TRACK_MAP.get('gplt')!
    const nodes = SKILL_NODES.map((n) => tierOf(n.id, 'proficient'))
    const p = trackProgress(track, nodes)
    expect(p.requiredDone).toBe(p.requiredTotal)
    expect(p.focusDone).toBe(p.focusTotal)
    expect(p.nextIds).toEqual([])
  })

  it('依赖未满足的节点不进入 nextIds（避免推荐锁住的节点）', () => {
    const track = SKILL_TRACK_MAP.get('noip')!
    const nodes = SKILL_NODES.map((n) => ({
      id: n.id,
      layer: n.layer,
      tier: 'untouched' as MasteryTier,
      depsReady: false
    }))
    const p = trackProgress(track, nodes)
    expect(p.nextIds).toEqual([])
  })
})
