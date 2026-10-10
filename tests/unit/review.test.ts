import { describe, it, expect } from 'vitest'
import {
  addDays,
  diffDays,
  intervalForStage,
  isDue,
  isMastered,
  localDate,
  nextReview,
  reviewLabel
} from '../../src/main/services/review'

/**
 * 题单内间隔复习（v1.10 FR-29）：日期运算 + 阶梯推进 + 到期判定。
 * 阶梯固定为 1/3/7/14/30/60 天（REVIEW_INTERVALS），反馈 hard/ok/easy 分别退一档/进一档/跳一档。
 */

describe('日期工具（本地时区）', () => {
  it('localDate 输出 YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 9, 4))).toBe('2026-10-04')
    expect(localDate(new Date(2026, 0, 9))).toBe('2026-01-09')
  })

  it('addDays 跨月/跨年正确', () => {
    expect(addDays('2026-10-04', 1)).toBe('2026-10-05')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29') // 闰年
    expect(addDays('2026-01-01', 60)).toBe('2026-03-02')
  })

  it('diffDays 计算天数差', () => {
    expect(diffDays('2026-10-01', '2026-10-04')).toBe(3)
    expect(diffDays('2026-10-04', '2026-10-01')).toBe(-3)
    expect(diffDays('2026-10-04', '2026-10-04')).toBe(0)
  })
})

describe('间隔阶梯', () => {
  it('档位 → 间隔天数（1/3/7/14/30/60，越界取最后一档）', () => {
    expect([1, 2, 3, 4, 5, 6].map(intervalForStage)).toEqual([1, 3, 7, 14, 30, 60])
    expect(intervalForStage(0)).toBe(1)
    expect(intervalForStage(9)).toBe(60)
  })

  it('首次完成（stage=0）→ 第 1 档，1 天后复习', () => {
    expect(nextReview(0, null, '2026-10-04')).toEqual({ stage: 1, due: '2026-10-05' })
  })

  it('一般（ok）→ 进一档；轻松（easy）→ 跳一档；困难（hard）→ 退一档', () => {
    expect(nextReview(1, 'ok', '2026-10-04')).toEqual({ stage: 2, due: '2026-10-07' }) // +3 天
    expect(nextReview(1, 'easy', '2026-10-04')).toEqual({ stage: 3, due: '2026-10-11' }) // +7 天
    expect(nextReview(3, 'hard', '2026-10-04')).toEqual({ stage: 2, due: '2026-10-07' })
    expect(nextReview(1, 'hard', '2026-10-04')).toEqual({ stage: 1, due: '2026-10-05' }) // 不会低于 1
  })

  it('阶段封顶在第 6 档（60 天）', () => {
    expect(nextReview(6, 'ok', '2026-10-04')).toEqual({ stage: 6, due: '2026-12-03' })
    expect(nextReview(5, 'easy', '2026-10-04')).toEqual({ stage: 6, due: '2026-12-03' })
  })
})

describe('到期判定与展示', () => {
  it('isDue：只有进入复习且到期才算', () => {
    expect(isDue({ reviewStage: 0, reviewDue: null }, '2026-10-04')).toBe(false)
    expect(isDue({ reviewStage: 1, reviewDue: '2026-10-05' }, '2026-10-04')).toBe(false)
    expect(isDue({ reviewStage: 1, reviewDue: '2026-10-04' }, '2026-10-04')).toBe(true)
    expect(isDue({ reviewStage: 2, reviewDue: '2026-09-30' }, '2026-10-04')).toBe(true) // 逾期也算到期
    expect(isDue({ reviewStage: 1, reviewDue: '2026-10-05' }, '2026-10-06')).toBe(true) // 隔天补做
  })

  it('isMastered：走完 6 档', () => {
    expect(isMastered({ reviewStage: 5 })).toBe(false)
    expect(isMastered({ reviewStage: 6 })).toBe(true)
  })

  it('reviewLabel 文案', () => {
    expect(reviewLabel({ reviewStage: 0, reviewDue: null })).toBe('未开始')
    expect(reviewLabel({ reviewStage: 2, reviewDue: '2026-10-07' })).toBe('第 2/6 档 · 下次 2026-10-07')
    expect(reviewLabel({ reviewStage: 6, reviewDue: '2026-12-03' })).toBe('第 6/6 档 · 已巩固')
  })
})
