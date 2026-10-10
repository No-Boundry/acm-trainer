# 本地题包示例（ACM-Trainer v2.0）

目录结构（FR-13 规范）：

```
package-P9001/
├── problem.json        必填：id / title（选填 timeLimit / memoryLimit / tags / source）
├── statement.md        必填：题面（Markdown 或 statement.html）
├── tests/              必填：成对的 *.in 与 *.out（编号连续，1 起）
│   ├── 1.in  1.out
│   ├── 2.in  2.out
│   └── 3.in  3.out
├── editorials/         选填：题解 Markdown（也可从洛谷题解区抓取）
│   └── solution-1.md
└── README.md           选填
```

导入方式：应用内「题库」页打开任意题目详情 → 「本地判题」区块 → 点「导入本地题包…」，
选择本目录即可（或到「设置 → 本地测评 → 导入本地题包」）。
