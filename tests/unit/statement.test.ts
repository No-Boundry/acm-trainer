import { describe, it, expect } from 'vitest'
import { isAllowedHostUrl } from '../../src/main/services/web-window'

describe('isAllowedHostUrl（题面导航白名单，docs/03 §4.2 + §9.5）', () => {
  const allowed = [
    'https://codeforces.com/problemset/problem/1741/A',
    'https://codeforces.com/contest/1741/problem/A',
    'https://codeforces.com/login',
    'https://cdn.codeforces.com/xxx/main.css',
    'https://sub.codeforces.com/profile/abc',
    // v1.1 洛谷（FR-8.5）
    'https://www.luogu.com.cn/problem/P1000',
    'https://www.luogu.com.cn/record/list?pid=P1000',
    'https://cdn.luogu.com.cn/upload/image_hosting/x.png',
    'https://fecdn.luogu.com.cn/assets/luogu.ico'
  ]
  for (const url of allowed) {
    it(`允许 ${url}`, () => {
      expect(isAllowedHostUrl(url)).toBe(true)
    })
  }

  const denied = [
    'http://codeforces.com/contest/1/problem/A', // 非 https
    'https://evil.com/codeforces.com',
    'https://www.baidu.com',
    'file:///C:/windows/system32',
    'https://codeforces.evil.com/x',
    'https://luogu.com.cn.evil.com/x', // 域名后缀伪造
    'https://evil-luogu.com.cn/x',
    'not-a-url'
  ]
  for (const url of denied) {
    it(`拒绝 ${url}`, () => {
      expect(isAllowedHostUrl(url)).toBe(false)
    })
  }
})
