import { IpcChannels } from '@shared/channels'
import type { Note } from '@shared/types'
import type { Repos } from '../services'
import type { CreateNoteInput } from '../db/repositories/notes'
import { handle } from './helpers'

interface NotesListReq {
  keyword?: string
  problemId?: string | null
}

export function registerNotesIpc(repos: Repos): void {
  handle<NotesListReq, Note[]>(IpcChannels.NotesList, (req) => repos.notes.list(req ?? {}))

  handle<{ id: number }, Note | null>(IpcChannels.NotesGet, ({ id }) => repos.notes.getById(id))

  handle<CreateNoteInput, Note>(IpcChannels.NotesCreate, (req) => repos.notes.create(req))

  handle<{ id: number } & Partial<CreateNoteInput>, Note>(IpcChannels.NotesUpdate, ({ id, ...fields }) =>
    repos.notes.update(id, fields)
  )

  handle<{ id: number }, void>(IpcChannels.NotesDelete, ({ id }) => repos.notes.delete(id))
}
