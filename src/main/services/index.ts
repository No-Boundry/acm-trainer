import { getDb } from '../db'
import { ProblemsRepo } from '../db/repositories/problems'
import { RecordsRepo } from '../db/repositories/records'
import { NotesRepo } from '../db/repositories/notes'
import { TemplatesRepo } from '../db/repositories/templates'
import { ContestsRepo } from '../db/repositories/contests'
import { SettingsRepo } from '../db/repositories/settings'
import { RatingRepo } from '../db/repositories/rating'
import { ListsRepo } from '../db/repositories/lists'
import { PlansRepo } from '../db/repositories/plans'

/** 数据访问层聚合（供各 IPC 域使用） */
export interface Repos {
  problems: ProblemsRepo
  records: RecordsRepo
  notes: NotesRepo
  templates: TemplatesRepo
  contests: ContestsRepo
  settings: SettingsRepo
  rating: RatingRepo
  /** v1.10：题单 + 题单内复习 */
  lists: ListsRepo
  /** v1.10：训练计划 */
  plans: PlansRepo
}

export function createRepos(): Repos {
  const db = getDb()
  return {
    problems: new ProblemsRepo(db),
    records: new RecordsRepo(db),
    notes: new NotesRepo(db),
    templates: new TemplatesRepo(db),
    contests: new ContestsRepo(db),
    settings: new SettingsRepo(db),
    rating: new RatingRepo(db),
    lists: new ListsRepo(db),
    plans: new PlansRepo(db)
  }
}
