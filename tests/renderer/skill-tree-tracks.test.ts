// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { IpcChannels } from '@shared/channels'
import SkillTreePage from '@/pages/SkillTreePage.vue'
import { SKILL_NODES } from '@shared/skill-tree'
import { SKILL_TRACK_MAP, trackProgress } from '@shared/skill-tracks'
import type { MasteryTier, SkillNodeReport } from '@shared/types'

/**
 * 技能树「国内比赛赛道」（v1.10 FR-26）：
 * 切换赛道 → 显示赛制/难度/必达进度；重点与必达节点加标记；可「只显示赛道节点」；
 * 「按赛道去题库练习」把 focus 节点带入题库筛选。
 */

function nodeOf(id: string, tier: MasteryTier = 'untouched'): SkillNodeReport {
  const n = SKILL_NODES.find((x) => x.id === id)!
  return {
    id: n.id,
    name: n.name,
    layer: n.layer,
    tags: [...n.tags],
    dependsOn: [...n.dependsOn],
    intro: n.intro,
    stats: { attempted: 0, acProblems: 0, attempts: 0, acAttempts: 0, acc: null, hardSolved: 0, lastActiveDays: null },
    tier,
    depsReady: n.dependsOn.length === 0
  }
}

function setupApi() {
  const nodes = SKILL_NODES.map((n) => nodeOf(n.id, n.id === 'impl' ? 'proficient' : 'untouched'))
  const tracks = [...SKILL_TRACK_MAP.values()].map((t) => ({
    id: t.id,
    nodeIds: [...new Set([...t.focus, ...t.required])],
    progress: trackProgress(
      t,
      nodes.map((n) => ({ id: n.id, layer: n.layer, tier: n.tier, depsReady: n.depsReady }))
    )
  }))
  const api = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === IpcChannels.SkillGet) {
        return { ok: true, data: { nodes, recommendedIds: [], allDone: false, tracks } }
      }
      return { ok: false, error: { code: 'NO_HANDLER', message: channel } }
    }),
    on: vi.fn(() => () => undefined)
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

async function mountPage() {
  setupApi()
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/problems', component: { template: '<div />' } },
      { path: '/skills', component: { template: '<div />' } }
    ]
  })
  await router.push('/skills')
  await router.isReady()
  const wrapper = mount(SkillTreePage, { global: { plugins: [pinia, router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router, pinia }
}

describe('技能树 · 国内比赛赛道', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('渲染赛道切换器（含 5 个国内比赛）与全部节点', async () => {
    const { wrapper } = await mountPage()
    const segs = wrapper.findAll('.track-row .seg').map((s) => s.text())
    expect(segs[0]).toBe('全部知识点')
    for (const name of ['蓝桥杯（省赛/国赛）', '天梯赛（GPLT）', 'ICPC / CCPC 区域赛', 'NOIP / CSP-S', '牛客多校 / 小白月赛']) {
      expect(segs.join('|')).toContain(name)
    }
    expect(wrapper.findAll('.node-card')).toHaveLength(SKILL_NODES.length)
  })

  it('选择赛道后显示赛制说明、推荐难度与必达进度', async () => {
    const { wrapper } = await mountPage()
    const lc = wrapper.findAll('.track-row .seg').find((s) => s.text().includes('蓝桥杯'))!
    await lc.trigger('click')
    await flushPromises()
    const detail = wrapper.find('.track-detail')
    expect(detail.exists()).toBe(true)
    const text = detail.text().replace(/\s+/g, ' ')
    expect(text).toContain('OI 赛制')
    expect(text).toContain('推荐难度')
    expect(text).toContain('必达')
    // 种子数据只有 impl 达标 → 蓝桥杯必达里含 impl
    expect(text).toMatch(/必达\s*1\/\d+/)
  })

  it('赛道节点加「必达/重点」标记，非赛道节点可被隐藏', async () => {
    const { wrapper } = await mountPage()
    const noip = wrapper.findAll('.track-row .seg').find((s) => s.text().includes('NOIP'))!
    await noip.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.node-card.track-req').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.node-card.track-dim').length).toBeGreaterThan(0)

    const only = wrapper.find('.only-track input')
    await only.setValue(true)
    await flushPromises()
    const visible = wrapper.findAll('.node-card').filter((c) => c.isVisible())
    expect(visible.length).toBeLessThan(SKILL_NODES.length)
    expect(visible.length).toBeGreaterThan(0)
  })

  // v1.10.1 回归：勾选「只显示赛道节点」后，连线也必须随卡片一起消失
  // （原先只过滤卡片，SVG 仍按旧坐标绘制全部依赖线 → 悬空/交叉的残留线）
  it('只显示赛道节点时，连线只剩两端都在赛道内的依赖边', async () => {
    const { wrapper } = await mountPage()
    const before = wrapper.findAll('.edges path').length
    const totalEdges = SKILL_NODES.reduce((s, n) => s + n.dependsOn.length, 0)
    expect(before).toBe(totalEdges)

    const noip = wrapper.findAll('.track-row .seg').find((s) => s.text().includes('NOIP'))!
    await noip.trigger('click')
    await flushPromises()
    // 仅切赛道（未过滤卡片）时连线保持完整
    expect(wrapper.findAll('.edges path').length).toBe(before)

    await wrapper.find('.only-track input').setValue(true)
    await flushPromises()

    const track = SKILL_TRACK_MAP.get('noip')!
    const inTrack = new Set(track.focus.concat(track.required))
    const expected = SKILL_NODES.reduce(
      (sum, n) => sum + n.dependsOn.filter((d) => inTrack.has(d) && inTrack.has(n.id)).length,
      0
    )
    const after = wrapper.findAll('.edges path').length
    expect(after).toBe(expected)
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)

    // 隐藏的节点确实不在 DOM 可见集合中（保证上面的期望值非平凡）
    const hiddenCount = wrapper.findAll('.node-card').filter((c) => !c.isVisible()).length
    expect(hiddenCount).toBe(SKILL_NODES.length - inTrack.size)

    // 取消勾选后连线恢复
    await wrapper.find('.only-track input').setValue(false)
    await flushPromises()
    expect(wrapper.findAll('.edges path').length).toBe(before)
  })

  it('「按赛道去题库练习」把该赛道重点知识点带入题库筛选', async () => {
    const { wrapper, router } = await mountPage()
    const gplt = wrapper.findAll('.track-row .seg').find((s) => s.text().includes('天梯赛'))!
    await gplt.trigger('click')
    await flushPromises()
    const btn = wrapper.findAll('.track-buttons button, .btn').find((b) => b.text().includes('按赛道去题库练习'))!
    await btn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/problems')
    const knowledge = String(router.currentRoute.value.query.knowledge ?? '')
    expect(knowledge.split(',')).toContain('sim_impl')
    expect(knowledge.split(',').length).toBe(SKILL_TRACK_MAP.get('gplt')!.focus.length)
  })
})
