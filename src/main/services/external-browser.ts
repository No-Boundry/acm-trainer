import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { shell } from 'electron'

/**
 * 题面打开方式（v1.8）：优先调用 Microsoft Edge，缺失时回退系统默认浏览器。
 * 说明：v2.0 的「应用内题面窗口 / 本地题面」已按用户决策回退，题面统一交给浏览器打开。
 */

const EDGE_CANDIDATES = [
  path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
]

/** 解析 `reg query ... /ve` 输出中的默认值路径（纯函数，便于测试） */
export function parseRegQueryOutput(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/REG_SZ\s+(.+?)\s*$/i)
    if (m && /msedge\.exe/i.test(m[1])) return m[1].trim()
  }
  return null
}

/** 从注册表 App Paths 读取 Edge 路径（候选路径均未命中时才使用） */
function edgeFromRegistry(): string | null {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'
  ]
  for (const key of keys) {
    try {
      const r = spawnSync('reg', ['query', key, '/ve'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000
      })
      if (r.status === 0 && r.stdout) {
        const p = parseRegQueryOutput(r.stdout)
        if (p && fs.existsSync(p)) return p
      }
    } catch {
      // 忽略：继续尝试下一个来源
    }
  }
  return null
}

/**
 * 查找 Edge 可执行文件：候选路径 → 注册表 App Paths。
 * @param lookupRegistry 注册表查询（测试可注入以避免真实调用）
 */
export function findEdgePath(
  candidates: string[] = EDGE_CANDIDATES,
  exists: (p: string) => boolean = (p) => !!p && fs.existsSync(p),
  lookupRegistry: () => string | null = edgeFromRegistry
): string | null {
  for (const p of candidates) {
    if (exists(p)) return p
  }
  const fromRegistry = lookupRegistry()
  if (fromRegistry && exists(fromRegistry)) return fromRegistry
  return null
}

/** 用系统默认浏览器打开普通外链（参考资料等；仅允许 https） */
export function openExternalUrl(url: string): void {
  if (!url.startsWith('https://')) return
  void shell.openExternal(url)
}

export interface OpenResult {
  via: 'edge' | 'default-browser'
  target: string
}

/**
 * 用 Edge 打开题面；未找到 Edge 时回退系统默认浏览器。
 * @returns 实际使用的打开方式
 */
export function openInEdge(url: string, edgePath: string | null = findEdgePath()): OpenResult {
  if (edgePath) {
    try {
      const child = spawn(edgePath, [url], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return { via: 'edge', target: edgePath }
    } catch {
      // 启动失败 → 回退默认浏览器
    }
  }
  void shell.openExternal(url)
  return { via: 'default-browser', target: url }
}
