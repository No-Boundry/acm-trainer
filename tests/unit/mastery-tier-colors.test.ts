import { describe, it, expect } from 'vitest'
import { MASTERY_TIER_META, MASTERY_TIER_ORDER } from '@shared/types'
import type { MasteryTier } from '@shared/types'

/**
 * 掌握度五档配色回归（v1.8 用户反馈：初学与基本掌握颜色相近）。
 * 约束：五档配色两两**色相间距 ≥ 45°**；「未开始」为低饱和灰；标签语义正确。
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`非法颜色：${hex}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** 返回 { h, s, l }（h 为 0–360，s/l 为 0–1） */
function toHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s, l }
}

function hueGap(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

describe('掌握度五档配色（v1.8）', () => {
  it('五档齐全且标签语义正确', () => {
    expect(MASTERY_TIER_ORDER).toHaveLength(5)
    const labels = MASTERY_TIER_ORDER.map((t) => MASTERY_TIER_META[t].label)
    expect(labels).toEqual(['未开始', '初学', '练习中', '基本掌握', '熟练'])
    for (const t of MASTERY_TIER_ORDER) {
      expect(MASTERY_TIER_META[t].color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('「未开始」为低饱和灰，其余四档为足够饱和的彩色', () => {
    const untouched = toHsl(MASTERY_TIER_META.untouched.color)
    expect(untouched.s).toBeLessThan(0.25)

    for (const tier of ['newbie', 'learning', 'proficient', 'master'] as MasteryTier[]) {
      const { s } = toHsl(MASTERY_TIER_META[tier].color)
      expect(s, `${tier} 饱和度偏低`).toBeGreaterThan(0.35)
    }
  })

  it('四个彩色档两两色相间距 ≥ 45°（回归：初学与基本掌握曾只差 ~26°）', () => {
    const chromatic = (['newbie', 'learning', 'proficient', 'master'] as MasteryTier[]).map((t) => ({
      tier: t,
      hue: toHsl(MASTERY_TIER_META[t].color).h
    }))
    for (let i = 0; i < chromatic.length; i++) {
      for (let j = i + 1; j < chromatic.length; j++) {
        const gap = hueGap(chromatic[i].hue, chromatic[j].hue)
        expect(
          gap,
          `${chromatic[i].tier}(${Math.round(chromatic[i].hue)}°) 与 ${chromatic[j].tier}(${Math.round(chromatic[j].hue)}°) 过近`
        ).toBeGreaterThanOrEqual(45)
      }
    }
  })

  it('相邻档位（按掌握度递进）颜色也不相近', () => {
    const hues = MASTERY_TIER_ORDER.slice(1).map((t) => toHsl(MASTERY_TIER_META[t].color).h)
    for (let i = 1; i < hues.length; i++) {
      expect(hueGap(hues[i - 1], hues[i])).toBeGreaterThanOrEqual(45)
    }
  })
})
