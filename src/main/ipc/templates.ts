import { clipboard } from 'electron'
import { IpcChannels } from '@shared/channels'
import type { Template } from '@shared/types'
import type { Repos } from '../services'
import type { CreateTemplateInput } from '../db/repositories/templates'
import { AppError } from '../db/errors'
import { handle } from './helpers'

interface TemplatesListReq {
  keyword?: string
  category?: string
}

export function registerTemplatesIpc(repos: Repos): void {
  handle<TemplatesListReq, Template[]>(IpcChannels.TemplatesList, (req) =>
    repos.templates.list(req ?? {})
  )

  handle<{ id: number }, Template | null>(IpcChannels.TemplatesGet, ({ id }) =>
    repos.templates.getById(id)
  )

  handle<CreateTemplateInput, Template>(IpcChannels.TemplatesCreate, (req) =>
    repos.templates.create(req)
  )

  handle<{ id: number } & Partial<CreateTemplateInput>, Template>(
    IpcChannels.TemplatesUpdate,
    ({ id, ...fields }) => repos.templates.update(id, fields)
  )

  handle<{ id: number }, void>(IpcChannels.TemplatesDelete, ({ id }) => repos.templates.delete(id))

  handle<{ id: number }, { copied: boolean }>(IpcChannels.TemplatesCopy, ({ id }) => {
    const tpl = repos.templates.getById(id)
    if (!tpl) throw new AppError('NOT_FOUND', '模板不存在')
    clipboard.writeText(tpl.code)
    return { copied: true }
  })
}
