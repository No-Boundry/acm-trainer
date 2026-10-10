import { REVIEW_INTERVALS, type ReviewEase } from '@shared/types'

/**
 * 题单内间隔复习（v1.10 FR-29）。
 *
 * 阶梯：1 / 3 / 7 / 14 / 30 / 60 天（stage 1..6，超出后固定按最后一档）。
 * 反馈语义：
 * - hard（困难）：退一档（至少 1 档），尽快重来；
 * - ok（一般）：正常推进一档；
 * - easy（轻松）：跳一档推进（跨两级）。
 *
 * 纯函数，便于单测；日期一律用本地 'YYYY-MM-DD'。
 */

/** 本地日期字符串（避免 toISOString 的 UTC 偏移） */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 日期加天数（本地时区，跨月/跨年安全） */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((x) => Number(x))
  const base = new Date(y, (m ?? 1) - 1, d ?? 1)
  base.setDate(base.getDate() + days)
  return localDate(base)
}

/** 两个日期相差天数（b - a），负数表示 b 早于 a */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ta = new Date(ay, am - 1, ad).getTime()
  const tb = new Date(by, bm - 1, bd).getTime()
  return Math.round((tb - ta) / 86400000)
}

/** 档位对应的间隔天数（数组越界时取最后一档） */
export function intervalForStage(stage: number): number {
  if (stage <= 0) return REVIEW_INTERVALS[0]
  const idx = Math.min(stage, REVIEW_INTERVALS.length) - 1
  return REVIEW_INTERVALS[idx]
}

/**
 * 完成/复习一次后的新状态。
 * @param stage 当前档位（0 表示首次完成，尚未进入复习）
 * @param ease 本次反馈；首次完成（stage=0）无反馈 → 直接进入第 1 档
 */
export function nextReview(
  stage: number,
  ease: ReviewEase | null,
  today: string = localDate()
): { stage: number; due: string } {
  const max = REVIEW_INTERVALS.length
  let next: number
  if (stage <= 0) {
    next = 1
  } else if (ease === 'hard') {
    next = Math.max(1, stage - 1)
  } else if (ease === 'easy') {
    next = Math.min(max, stage + 2)
  } else {
    next = Math.min(max, stage + 1)
  }
  return { stage: next, due: addDays(today, intervalForStage(next)) }
}

/** 是否到期（due ≤ today；未进入复习的条目不算到期） */
export function isDue(
  item: { reviewStage: number; reviewDue: string | null },
  today: string = localDate()
): boolean {
  if (item.reviewStage <= 0 || !item.reviewDue) return false
  return diffDays(item.reviewDue, today) >= 0
}

/** 是否已全部走完阶梯（最后一档且已复习过） */
export function isMastered(item: { reviewStage: number }): boolean {
  return item.reviewStage >= REVIEW_INTERVALS.length
}

/** 复习状态展示文案 */
export function reviewLabel(item: {
  reviewStage: number
  reviewDue: string | null
}): string {
  if (item.reviewStage <= 0) return '未开始'
  const mastered = item.reviewStage >= REVIEW_INTERVALS.length
  const stageText = `第 ${item.reviewStage}/${REVIEW_INTERVALS.length} 档`
  if (mastered) return `${stageText} · 已巩固`
  return item.reviewDue ? `${stageText} · 下次 ${item.reviewDue}` : stageText
}
