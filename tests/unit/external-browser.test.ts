import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 题面打开方式测试（v1.8）：优先 Edge，缺失/启动失败时回退系统默认浏览器。
 */

const openExternal = vi.fn(async () => undefined)
const spawnMock = vi.fn(() => ({ unref: () => undefined }) as unknown as ReturnType<typeof import('child_process').spawn>)

vi.mock('electron', () => ({ shell: { openExternal } }))
vi.mock('child_process', () => ({ spawn: spawnMock }))

const { findEdgePath, openInEdge, parseRegQueryOutput } = await import(
  '../../src/main/services/external-browser'
)

describe('parseRegQueryOutput（注册表默认值解析）', () => {
  it('从 reg query /ve 输出中取出 msedge.exe 路径', () => {
    const out = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe
    (默认)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe

`
    expect(parseRegQueryOutput(out)).toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    )
  })

  it('无 msedge 路径 → null', () => {
    expect(parseRegQueryOutput('随便一段输出 REG_SZ C:\\other\\app.exe')).toBeNull()
    expect(parseRegQueryOutput('')).toBeNull()
  })
})

describe('findEdgePath（Edge 可执行文件探测）', () => {
  const noReg = (): string | null => null

  it('命中第一个存在的候选路径', () => {
    const exists = (p: string): boolean => p === 'C:/Edge/msedge.exe'
    expect(findEdgePath(['C:/nope/msedge.exe', 'C:/Edge/msedge.exe'], exists, noReg)).toBe(
      'C:/Edge/msedge.exe'
    )
  })

  it('全部不存在 → null', () => {
    expect(findEdgePath(['a', 'b'], () => false, noReg)).toBeNull()
  })

  it('空路径被跳过（环境变量缺失时不误判）', () => {
    expect(findEdgePath(['', 'C:/Edge/msedge.exe'], (p) => p === 'C:/Edge/msedge.exe', noReg)).toBe(
      'C:/Edge/msedge.exe'
    )
  })

  it('候选路径均未命中 → 回退注册表 App Paths', () => {
    const regPath = 'D:/CustomEdge/msedge.exe'
    const found = findEdgePath(['C:/nope/msedge.exe'], (p) => p === regPath, () => regPath)
    expect(found).toBe(regPath)
  })

  it('注册表路径不存在（残留项）→ null，不误报', () => {
    const regPath = 'D:/Gone/msedge.exe'
    expect(findEdgePath(['C:/nope/msedge.exe'], () => false, () => regPath)).toBeNull()
  })
})

describe('openInEdge（Edge 优先，回退默认浏览器）', () => {
  beforeEach(() => {
    spawnMock.mockClear()
    openExternal.mockClear()
  })

  it('检测到 Edge → 用 msedge.exe 打开', () => {
    const r = openInEdge('https://codeforces.com/problemset/problem/1/A', 'C:/Edge/msedge.exe')
    expect(r.via).toBe('edge')
    expect(spawnMock).toHaveBeenCalledWith(
      'C:/Edge/msedge.exe',
      ['https://codeforces.com/problemset/problem/1/A'],
      expect.objectContaining({ detached: true })
    )
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('未检测到 Edge → 回退系统默认浏览器', () => {
    const r = openInEdge('https://www.luogu.com.cn/problem/P1000', null)
    expect(r.via).toBe('default-browser')
    expect(openExternal).toHaveBeenCalledWith('https://www.luogu.com.cn/problem/P1000')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('Edge 启动抛错 → 回退默认浏览器', () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    const r = openInEdge('https://www.luogu.com.cn/problem/P1000', 'C:/Edge/msedge.exe')
    expect(r.via).toBe('default-browser')
    expect(openExternal).toHaveBeenCalled()
  })
})
