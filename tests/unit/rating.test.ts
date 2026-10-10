import { describe, it, expect } from 'vitest'
import {
  computePracticeRating,
  computeContestRating,
  combineRating,
  titleForRating,
  clampRating,
  luoguMappedRating,
  computeLuoguPracticeRating,
  normalizeWeights,
  parseRatingWeights,
  parseLuoguDiffMap,
  DEFAULT_RATING_WEIGHTS,
  RATING_FLOOR,
  RATING_CEIL
} from '../../src/main/services/rating'

describe('可配置权值与映射（v1.4）', () => {
  it('combineRating 自定义权值：0.5/0.5 → (1400+1600)/2=1500', () => {
    expect(combineRating(1400, 1600, { practice: 0.5, contest: 0.5 })).toBe(1500)
  })

  it('归一化：0.35/0.15 与 0.7/0.3 等价', () => {
    expect(combineRating(1400, 1600, { practice: 0.35, contest: 0.15 })).toBe(
      combineRating(1400, 1600, DEFAULT_RATING_WEIGHTS)
    )
  })

  it('normalizeWeights：非法输入回退默认', () => {
    expect(normalizeWeights({ practice: 0, contest: 0 })).toEqual({ practice: 0.7, contest: 0.3 })
    expect(normalizeWeights(null)).toEqual({ practice: 0.7, contest: 0.3 })
    expect(normalizeWeights({ practice: -1, contest: 1 })).toEqual({ practice: 0, contest: 1 })
  })

  it('parseRatingWeights：JSON/非法/缺省', () => {
    expect(parseRatingWeights('{"practice":0.6,"contest":0.4}')).toEqual({ practice: 0.6, contest: 0.4 })
    expect(parseRatingWeights('garbage')).toEqual(DEFAULT_RATING_WEIGHTS)
    expect(parseRatingWeights(null)).toEqual(DEFAULT_RATING_WEIGHTS)
    expect(parseRatingWeights('{"practice":"x"}')).toEqual(DEFAULT_RATING_WEIGHTS)
  })

  it('parseLuoguDiffMap：合法保留/越界与超界键丢弃/全非法与坏 JSON → null（回退默认）', () => {
    expect(parseLuoguDiffMap('{"1":800,"3":1300}')).toEqual({ 1: 800, 3: 1300 })
    expect(parseLuoguDiffMap('{"2":700,"5":9999,"9":1000}')).toBeNull() // 全部非法 → null
    expect(parseLuoguDiffMap('{"2":700,"3":1300}')).toEqual({ 3: 1300 }) // 部分非法只保留合法项
    expect(parseLuoguDiffMap('bad')).toBeNull()
    expect(parseLuoguDiffMap(null)).toBeNull()
  })

  it('luoguMappedRating 使用自定义映射', () => {
    expect(luoguMappedRating(2, { 2: 1000 })).toBe(1000)
    expect(luoguMappedRating(1, { 2: 1000 })).toBeNull()
  })
})

describe('luoguMappedRating / computeLuoguPracticeRating（v1.3 FR-6.6）', () => {
  it('难度映射表：1→900 … 7→2300；0/null → null', () => {
    expect(luoguMappedRating(1)).toBe(900)
    expect(luoguMappedRating(2)).toBe(1100)
    expect(luoguMappedRating(3)).toBe(1300)
    expect(luoguMappedRating(4)).toBe(1500)
    expect(luoguMappedRating(5)).toBe(1750)
    expect(luoguMappedRating(6)).toBe(2050)
    expect(luoguMappedRating(7)).toBe(2300)
    expect(luoguMappedRating(0)).toBeNull()
    expect(luoguMappedRating(null)).toBeNull()
  })

  it('全 AC（难度 1/2/3）→ 均分 1100', () => {
    expect(
      computeLuoguPracticeRating([
        { difficulty: 1, isAc: true },
        { difficulty: 2, isAc: true },
        { difficulty: 3, isAc: true }
      ])
    ).toBe(1100)
  })

  it('正确率 50%（难度 1/3）→ 1100 − 150 = 950', () => {
    expect(
      computeLuoguPracticeRating([
        { difficulty: 1, isAc: true },
        { difficulty: 3, isAc: false }
      ])
    ).toBe(950)
  })

  it('空/全 0 难度 → null', () => {
    expect(computeLuoguPracticeRating([])).toBeNull()
    expect(
      computeLuoguPracticeRating([
        { difficulty: 0, isAc: true },
        { difficulty: 0, isAc: false }
      ])
    ).toBeNull()
  })
})

describe('computePracticeRating（04 §2.1）', () => {
  it('全 AC 且难度均值 1500 → 1500', () => {
    expect(
      computePracticeRating([
        { rating: 1400, isAc: true, createdAt: '2026-01-01' },
        { rating: 1500, isAc: true, createdAt: '2026-01-01' },
        { rating: 1600, isAc: true, createdAt: '2026-01-01' }
      ])
    ).toBe(1500)
  })

  it('正确率 50%，均值 1500 → 1500 - 150 = 1350', () => {
    expect(
      computePracticeRating([
        { rating: 1400, isAc: true, createdAt: '2026-01-01' },
        { rating: 1600, isAc: false, createdAt: '2026-01-01' }
      ])
    ).toBe(1350)
  })

  it('无有效记录 → null', () => {
    expect(computePracticeRating([])).toBeNull()
  })

  it('全错且均值 1200 → 下限钳制 900', () => {
    expect(
      computePracticeRating([
        { rating: 1200, isAc: false, createdAt: '2026-01-01' }
      ])
    ).toBe(900)
  })

  it('下限 800 钳制', () => {
    expect(
      computePracticeRating([
        { rating: 800, isAc: false, createdAt: '2026-01-01' }
      ])
    ).toBe(RATING_FLOOR)
  })
})

describe('computeContestRating（04 §2.1）', () => {
  it('无比赛数据 → null', () => {
    expect(computeContestRating([])).toBeNull()
  })

  it('solvedAvg 1500、无罚时 → 1500', () => {
    expect(computeContestRating([{ solvedAvg: 1500, penaltyMinutes: 0 }])).toBe(1500)
  })

  it('罚时折算：1500 - 50min×2 = 1400', () => {
    expect(computeContestRating([{ solvedAvg: 1500, penaltyMinutes: 50 }])).toBe(1400)
  })

  it('多场取均值（空场被忽略）', () => {
    expect(
      computeContestRating([
        { solvedAvg: null, penaltyMinutes: 0 },
        { solvedAvg: 1400, penaltyMinutes: 0 },
        { solvedAvg: 1600, penaltyMinutes: 0 }
      ])
    ).toBe(1500)
  })
})

describe('combineRating（04 §2.1）', () => {
  it('双无 → null', () => {
    expect(combineRating(null, null)).toBeNull()
  })

  it('无比赛 → 用练习分', () => {
    expect(combineRating(1400, null)).toBe(1400)
  })

  it('0.7×1400 + 0.3×1600 = 1460', () => {
    expect(combineRating(1400, 1600)).toBe(1460)
  })
})

describe('titleForRating（04 §2.1 边界）', () => {
  const cases: [number, string][] = [
    [999, '新手'],
    [1000, '入门'],
    [1199, '入门'],
    [1200, '进阶'],
    [1399, '进阶'],
    [1400, '省赛候选'],
    [1599, '省赛候选'],
    [1600, '区域赛候选'],
    [1899, '区域赛候选'],
    [1900, '区域赛选手'],
    [2199, '区域赛选手'],
    [2200, '顶尖选手']
  ]
  for (const [rating, expectTitle] of cases) {
    it(`rating=${rating} → ${expectTitle}`, () => {
      expect(titleForRating(rating).title).toContain(expectTitle)
    })
  }
})

describe('clampRating', () => {
  it('上下限钳制', () => {
    expect(clampRating(100)).toBe(RATING_FLOOR)
    expect(clampRating(5000)).toBe(RATING_CEIL)
    expect(clampRating(1500.4)).toBe(1500)
    expect(clampRating(1500.5)).toBe(1501)
  })
})
