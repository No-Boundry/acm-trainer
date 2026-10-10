import { IpcChannels } from '@shared/channels'
import type { RatingBreakdown, RatingSnapshot } from '@shared/types'
import type { Repos } from '../services'
import { handle } from './helpers'

export function registerRatingIpc(repos: Repos): void {
  handle<unknown, RatingBreakdown & { history: RatingSnapshot[] }>(
    IpcChannels.RatingGet,
    async () => {
      const { computeRatingBreakdown } = await import('../services/rating')
      const breakdown = computeRatingBreakdown(repos)
      return { ...breakdown, history: repos.rating.history() }
    }
  )

  handle<{ source?: 'manual' | 'auto' }, RatingBreakdown & { history: RatingSnapshot[] }>(
    IpcChannels.RatingRecalc,
    async ({ source }) => {
      const { recalcRating } = await import('../services/rating')
      const r = recalcRating(repos, source ?? 'auto')
      return { ...r.breakdown, history: r.history }
    }
  )
}
