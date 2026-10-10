// CF API 响应 fixture（结构对齐 codeforces.com/api/problemset.problems）
// 仅供测试；字段类型与 src/main/services/cf.ts 中的 CfProblemsetResult 一致。
export interface CfProblemsetFixture {
  status: string
  result: {
    problems: {
      contestId: number
      index: string
      name: string
      type: string
      rating?: number
      tags: string[]
    }[]
    problemStatistics: { contestId: number; index: string; solvedCount: number }[]
  }
}

export const fixture: CfProblemsetFixture = {
  status: 'OK',
  result: {
    problems: [
      { contestId: 1741, index: 'A', name: 'Compare T-Shirt Sizes', type: 'PROGRAMMING', rating: 800, tags: ['implementation'] },
      { contestId: 1741, index: 'B', name: 'Funny Permutation', type: 'PROGRAMMING', rating: 1200, tags: ['constructive', 'math'] },
      { contestId: 1741, index: 'C', name: 'Minimize the Thickness', type: 'PROGRAMMING', rating: 1600, tags: ['brute force', 'math'] },
      { contestId: 1800, index: 'A', name: 'Deepest Ocean', type: 'PROGRAMMING', rating: 1500, tags: ['dp'] },
      { contestId: 1800, index: 'B', name: 'Hash Pattern', type: 'PROGRAMMING', rating: 1700, tags: ['dp', 'strings'] },
      { contestId: 1800, index: 'C', name: 'Binary String', type: 'PROGRAMMING', rating: 1900, tags: ['dp'] },
      { contestId: 2000, index: 'A', name: 'Poll', type: 'QUESTION', tags: [] },
      { contestId: 3000, index: 'A', name: 'No Rating Problem', type: 'PROGRAMMING', tags: ['math'] }
    ],
    problemStatistics: [
      { contestId: 1741, index: 'A', solvedCount: 100000 },
      { contestId: 1741, index: 'B', solvedCount: 50000 },
      { contestId: 1741, index: 'C', solvedCount: 20000 },
      { contestId: 1800, index: 'A', solvedCount: 30000 },
      { contestId: 1800, index: 'B', solvedCount: 15000 },
      { contestId: 1800, index: 'C', solvedCount: 8000 },
      { contestId: 3000, index: 'A', solvedCount: 1000 }
    ]
  }
}
