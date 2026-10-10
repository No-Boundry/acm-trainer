/**
 * STL 速查参考资料（v1.8.2 新增，FR-18）。
 * 纯数据 + 纯函数（可搜索/筛选），供渲染进程「STL 速查」页面使用，并作为 docs/10 的资料源。
 *
 * 面向 ACM/ICPC 竞赛（C++17）常用 STL：容器 / 算法 / 复杂度 / 技巧与坑。
 */

export type StlCategory =
  | 'sequence'
  | 'adapter'
  | 'associative'
  | 'misc'
  | 'algorithm'
  | 'tips'

export interface StlEntry {
  id: string
  category: StlCategory
  /** 名称（含头文件） */
  name: string
  /** 一句话用途 */
  summary: string
  /** 关键 API / 用法（C++17） */
  code: string
  /** 复杂度或量级（可选） */
  complexity?: string
  /** 常见坑 / 注意事项（可选） */
  pitfalls?: string
  /** 延伸阅读（cppreference 等） */
  url?: string
}

export interface StlCategoryMeta {
  key: StlCategory
  label: string
  hint: string
}

export const STL_CATEGORIES: readonly StlCategoryMeta[] = [
  { key: 'sequence', label: '序列容器', hint: 'vector / deque / string / array' },
  { key: 'adapter', label: '容器适配器', hint: 'stack / queue / priority_queue' },
  { key: 'associative', label: '关联容器', hint: 'set / map / unordered_*' },
  { key: 'misc', label: '其他常用', hint: 'pair / tuple / bitset / 数值' },
  { key: 'algorithm', label: '算法库', hint: '<algorithm> <numeric> 高频函数' },
  { key: 'tips', label: '技巧与坑', hint: '竞赛常见写法与陷阱' }
]

const cref = (path: string): string => `https://en.cppreference.com/w/cpp/${path}`

export const STL_ENTRIES: readonly StlEntry[] = [
  // ---------------- 序列容器 ----------------
  {
    id: 'vector',
    category: 'sequence',
    name: 'std::vector',
    summary: '动态数组，竞赛第一选择；随机访问、尾部增删、缓存友好。',
    code: `vector<int> v;              // 空
vector<int> a(n, 0);        // n 个 0
vector<vector<int>> g(n);   // 邻接表
v.push_back(x);             // 尾插 O(1) 均摊
v.emplace_back(a, b);       // 原地构造，免临时对象
v.pop_back();
v.size(); v.empty(); v.clear();
v.front(); v.back(); v.resize(n);
sort(v.begin(), v.end());   // 排序 O(n log n)
v.reserve(1 << 20);         // 预分配，避免多次扩容`,
    complexity: '尾插/尾删 O(1) 均摊；随机访问 O(1)；任意位置插删 O(n)',
    pitfalls: '扩容会使全部迭代器/指针失效；vector<bool> 是位压缩特化，不能取地址。',
    url: cref('container/vector')
  },
  {
    id: 'deque',
    category: 'sequence',
    name: 'std::deque',
    summary: '双端队列容器，两端 O(1) 插删；也常用来替代 vector 实现 0-1 BFS。',
    code: `deque<int> dq;
dq.push_back(x); dq.push_front(y);
dq.pop_back();   dq.pop_front();
dq.front(); dq.back();`,
    complexity: '两端插删 O(1)；随机访问 O(1)（常数略大于 vector）',
    pitfalls: '内存不连续，遍历比 vector 慢；中间插删仍是 O(n)。',
    url: cref('container/deque')
  },
  {
    id: 'array',
    category: 'sequence',
    name: 'std::array',
    summary: '定长数组容器，避免 C 数组退化为指针，支持 size()/begin()/end()。',
    code: `array<int, 5> a{};          // 全 0
a.fill(-1);
sort(a.begin(), a.end());
for (int x : a) cout << x;`,
    complexity: '随机访问 O(1)；无动态分配',
    url: cref('container/array')
  },
  {
    id: 'string',
    category: 'sequence',
    name: 'std::string',
    summary: '字符串容器：拼接、查找、截取、替换、数值转换。',
    code: `string s = "hello";
s += " world";
s.substr(1, 3);              // "ell"
s.find("world");             // 下标或 npos
s.replace(0, 5, "hi");
stoi("42"); stoll("1e18");   // 字符串 → 数值
to_string(123);              // 数值 → 字符串
getline(cin, s);             // 读整行（可与 cin >> 混用）`,
    complexity: '尾部追加 O(1) 均摊；find O(n·m) 朴素实现',
    pitfalls: 'cin >> 后紧接 getline 会读到空行，需先 cin.ignore()；npos 是 size_t，勿与 int 比较。',
    url: cref('string/basic_string')
  },

  // ---------------- 容器适配器 ----------------
  {
    id: 'stack',
    category: 'adapter',
    name: 'std::stack',
    summary: '后进先出；括号匹配、表达式求值、单调栈的底层容器。',
    code: `stack<int> st;
st.push(x); st.pop(); st.top(); st.size(); st.empty();`,
    complexity: 'push/pop/top O(1)',
    pitfalls: '不提供遍历与迭代器；pop() 不返回元素，需先 top()。',
    url: cref('container/stack')
  },
  {
    id: 'queue',
    category: 'adapter',
    name: 'std::queue',
    summary: '先进先出；BFS、模拟队列。',
    code: `queue<int> q;
q.push(x); q.pop(); q.front(); q.back();`,
    complexity: 'push/pop/front O(1)',
    url: cref('container/queue')
  },
  {
    id: 'priority_queue',
    category: 'adapter',
    name: 'std::priority_queue',
    summary: '大顶堆（默认）/小顶堆；贪心、Dijkstra、动态取最值。',
    code: `priority_queue<int> mx;                                   // 大顶堆
priority_queue<int, vector<int>, greater<int>> mn;        // 小顶堆
priority_queue<pair<int,int>, vector<pair<int,int>>, greater<>> pq; // 按 first 最小
struct Node { int d, u; };
struct Cmp { bool operator()(const Node& a, const Node& b) const { return a.d > b.d; } };
priority_queue<Node, vector<Node>, Cmp> pq2;              // 自定义（注意是"反着写"）

mx.push(x); mx.top(); mx.pop(); mx.empty();`,
    complexity: 'push/pop O(log n)；top O(1)',
    pitfalls: '比较器为"优先级更低者返回 true"；大顶堆取最小需存负数或用 greater。',
    url: cref('container/priority_queue')
  },

  // ---------------- 关联容器 ----------------
  {
    id: 'set',
    category: 'associative',
    name: 'std::set / multiset',
    summary: '有序集合（红黑树）：插入、删除、查找、前驱后继 O(log n)。',
    code: `set<int> s;
s.insert(3); s.erase(3);
s.count(3);                       // 0 / 1
auto it = s.lower_bound(3);       // ≥ 3 的第一个（用成员函数，O(log n)）
auto it2 = s.upper_bound(3);      // > 3
if (it != s.end()) cout << *it;
s.erase(s.begin());               // 按迭代器删（multiset 常用）
multiset<int> ms;
auto it3 = ms.find(5);
if (it3 != ms.end()) ms.erase(it3); // 只删一个 5（erase(5) 会删全部）`,
    complexity: 'insert/erase/find/lower_bound O(log n)',
    pitfalls: 'multiset 用 erase(key) 会删除所有相等元素；遍历时删除须用迭代器并接收返回值。',
    url: cref('container/set')
  },
  {
    id: 'map',
    category: 'associative',
    name: 'std::map / multimap',
    summary: '有序键值表：计数、离散化、区间统计、前驱后继。',
    code: `map<string, int> cnt;
cnt["abc"]++;                  // 不存在则插入 0 再自增
auto it = cnt.find("abc");     // 别用 cnt["x"] 判断存在（会插入！）
if (it != cnt.end()) cout << it->second;
for (auto& [k, v] : cnt) cout << k << ' ' << v;   // C++17 结构化绑定
cnt.erase(it);`,
    complexity: '增删查 O(log n)',
    pitfalls: 'operator[] 会插入默认值，判存在请用 find/count；键为自定义类型需提供比较器。',
    url: cref('container/map')
  },
  {
    id: 'unordered',
    category: 'associative',
    name: 'std::unordered_set / unordered_map',
    summary: '哈希表：均摊 O(1) 查找，适合大量计数与判重。',
    code: `unordered_map<long long, int> mp;
mp[x]++; mp.reserve(1024);     // 预留桶，减少 rehash
mp.max_load_factor(0.7);
unordered_set<int> vis; vis.insert(x); vis.count(x);`,
    complexity: '均摊 O(1)，最坏 O(n)（哈希碰撞）',
    pitfalls: 'CF 上存在被构造数据卡掉的风险；防卡可自定义 hash 或改用 map / 加随机盐。',
    url: cref('container/unordered_map')
  },

  // ---------------- 其他常用 ----------------
  {
    id: 'pair',
    category: 'misc',
    name: 'std::pair / tuple',
    summary: '二元组/多元组；自带字典序比较，排序与去重都靠它。',
    code: `pair<int,int> p = {1, 2};
p.first; p.second;
vector<pair<int,int>> v;
sort(v.begin(), v.end());                  // 先 first 再 second
v.push_back({x, y});
auto [a, b] = p;                           // C++17 结构化绑定
tuple<int,int,int> t{1,2,3};
auto [x1, x2, x3] = t;
get<0>(t);`,
    complexity: '比较 O(1)（按字典序）',
    url: cref('utility/pair')
  },
  {
    id: 'bitset',
    category: 'misc',
    name: 'std::bitset',
    summary: '定长位集合：位运算加速、可达性/背包状压、集合交并。',
    code: `bitset<100000> bs;
bs.set(); bs.reset(); bs.flip();
bs[3] = 1; bs.count();          // 1 的个数
bs |= (bs << k);                // 背包可达性整体左移
(bs & bs2).count();
bs.to_string(); bs.to_ulong();`,
    complexity: '位运算 O(n/64)',
    pitfalls: '长度必须是编译期常量；大 bitset 每次操作 O(n/64)，注意总复杂度。',
    url: cref('utility/bitset')
  },
  {
    id: 'numeric-misc',
    category: 'misc',
    name: '数值与类型工具',
    summary: '数值类型、极值、溢出与浮点常用写法。',
    code: `INT_MAX, INT_MIN, LLONG_MAX;     // <climits>
1e18, 1e9 + 7;
__int128 x;                       // GCC 扩展，可存 1e38（不能直接 cin/cout）
long double ld;                   // 精度更高
abs(x); llabs(x);
gcd(a, b); lcm(a, b);             // C++17 <numeric>
std::popcount((unsigned)x);       // C++20；C++17 用 __builtin_popcount
__builtin_clz, __builtin_ctz, __builtin_popcountll;`,
    complexity: '内置位操作通常 O(1)',
    pitfalls: 'int 溢出是 UB（务必用 long long）；浮点比较用 eps；__int128 需自己写输入输出。',
    url: cref('numeric/gcd')
  },

  // ---------------- 算法库 ----------------
  {
    id: 'sort',
    category: 'algorithm',
    name: 'sort / stable_sort / partial_sort',
    summary: '排序与部分排序；自定义比较器、多关键字排序。',
    code: `sort(v.begin(), v.end());                       // 升序
sort(v.begin(), v.end(), greater<int>());       // 降序
sort(v.begin(), v.end(), [](const auto& a, const auto& b) {
  if (a.x != b.x) return a.x < b.x;             // 第一关键字
  return a.y > b.y;                             // 第二关键字降序
});
stable_sort(v.begin(), v.end(), cmp);           // 稳定排序 O(n log^2 n)
partial_sort(v.begin(), v.begin() + k, v.end()); // 只要前 k 小`,
    complexity: 'O(n log n)（stable_sort 空间/时间常数更大）',
    pitfalls: '比较器必须满足严格弱序（不能用 <=，否则 UB/崩溃）。',
    url: cref('algorithm/sort')
  },
  {
    id: 'binary-search',
    category: 'algorithm',
    name: '二分查找与手写二分',
    summary: '有序区间查找、答案二分（竞赛最常手写）。',
    code: `// 库函数：返回第一个 ≥ x / > x 的位置
auto lo = lower_bound(v.begin(), v.end(), x);
auto hi = upper_bound(v.begin(), v.end(), x);
binary_search(v.begin(), v.end(), x);            // 是否存在

// 答案二分模板（最大可行值）
long long lo = 0, hi = 1e18;
while (lo < hi) {
  long long mid = lo + (hi - lo + 1) / 2;
  if (check(mid)) lo = mid; else hi = mid - 1;
}
// 最小可行值：mid = lo + (hi - lo) / 2，可行则 hi = mid，否则 lo = mid + 1`,
    complexity: '库函数 O(log n)',
    pitfalls: '区间需先排序；mid 用 lo + (hi - lo)/2 防溢出；注意边界取整方向。',
    url: cref('algorithm/lower_bound')
  },
  {
    id: 'unique-erase',
    category: 'algorithm',
    name: 'unique + erase（去重）',
    summary: '相邻去重（须先排序）压缩为不重复序列。',
    code: `sort(v.begin(), v.end());
v.erase(unique(v.begin(), v.end()), v.end());
int m = v.size();                       // 去重后个数

// 离散化（值域大 → 下标）
auto b = v; sort(b.begin(), b.end());
b.erase(unique(b.begin(), b.end()), b.end());
for (auto& x : v) x = lower_bound(b.begin(), b.end(), x) - b.begin() + 1;`,
    complexity: 'O(n)（不含排序）',
    pitfalls: 'unique 只去相邻重复，必须先排序；返回的是新逻辑尾迭代器。',
    url: cref('algorithm/unique')
  },
  {
    id: 'permutation',
    category: 'algorithm',
    name: 'next_permutation / prev_permutation',
    summary: '按字典序枚举全排列或下一个排列。',
    code: `sort(a.begin(), a.end());
do {
  // 处理当前排列 a
} while (next_permutation(a.begin(), a.end()));`,
    complexity: '单次 O(n)，全枚举 O(n·n!)',
    pitfalls: '必须先排序才能枚举全部排列；n > 10 时全排列数量爆炸。',
    url: cref('algorithm/next_permutation')
  },
  {
    id: 'minmax',
    category: 'algorithm',
    name: 'min / max / minmax_element / clamp',
    summary: '最值与区间最值位置；也常用于初始化。',
    code: `min(a, b); max({a, b, c});          // 多值取最大
auto p = minmax_element(v.begin(), v.end());
*p.first; *p.second;                // 最小、最大
clamp(x, lo, hi);                   // C++17 把 x 限制在区间内
*max_element(v.begin(), v.end());`,
    complexity: 'minmax_element O(n)；其余 O(1)（多值取 max 为 O(k)）',
    url: cref('algorithm/clamp')
  },
  {
    id: 'accumulate',
    category: 'algorithm',
    name: 'accumulate / iota / partial_sum',
    summary: '求和、连续赋值、前缀和（<numeric>）。',
    code: `long long s = accumulate(v.begin(), v.end(), 0LL);   // 注意初值类型！
iota(v.begin(), v.end(), 1);            // 1,2,3,...
partial_sum(v.begin(), v.end(), pre.begin());  // 前缀和

long long prod = accumulate(v.begin(), v.end(), 1LL, multiplies<long long>());`,
    complexity: 'O(n)',
    pitfalls: '初值写 0（int）会导致大和溢出；需 0LL。',
    url: cref('algorithm/accumulate')
  },
  {
    id: 'count-find',
    category: 'algorithm',
    name: 'count / count_if / find / find_if',
    summary: '计数与查找（线性）。',
    code: `count(v.begin(), v.end(), x);
count_if(v.begin(), v.end(), [](int y) { return y % 2 == 0; });
auto it = find(v.begin(), v.end(), x);
if (it == v.end()) { /* 未找到 */ }
any_of(v.begin(), v.end(), pred); all_of(...); none_of(...);`,
    complexity: 'O(n)',
    url: cref('algorithm/find')
  },
  {
    id: 'transform-fill',
    category: 'algorithm',
    name: 'fill / generate / transform / reverse / rotate',
    summary: '批量赋值、生成、映射、翻转、旋转。',
    code: `fill(v.begin(), v.end(), 0);
generate(v.begin(), v.end(), [n = 0]() mutable { return n++; });
transform(v.begin(), v.end(), v.begin(), [](int x) { return x * 2; });
reverse(v.begin(), v.end());
rotate(v.begin(), v.begin() + k, v.end());   // 左旋 k 位`,
    complexity: 'O(n)',
    url: cref('algorithm/transform')
  },
  {
    id: 'remove-erase',
    category: 'algorithm',
    name: 'remove / remove_if + erase',
    summary: '按条件删除元素（erase-remove 惯用法）。',
    code: `v.erase(remove(v.begin(), v.end(), 0), v.end());
v.erase(remove_if(v.begin(), v.end(), [](int x) { return x < 0; }), v.end());`,
    complexity: 'O(n)',
    pitfalls: 'remove 不改变容器大小，必须配合 erase。',
    url: cref('algorithm/remove')
  },
  {
    id: 'set-ops',
    category: 'algorithm',
    name: 'merge / set_union / set_intersection',
    summary: '有序区间合并与集合运算（结果也是有序区间）。',
    code: `merge(a.begin(), a.end(), b.begin(), b.end(), back_inserter(c));
set_union(a.begin(), a.end(), b.begin(), b.end(), back_inserter(c));
set_intersection(a.begin(), a.end(), b.begin(), b.end(), back_inserter(c));
set_difference(a.begin(), a.end(), b.begin(), b.end(), back_inserter(c));`,
    complexity: 'O(n + m)',
    pitfalls: '要求输入已排序；输出需预留空间或用 back_inserter。',
    url: cref('algorithm/set_union')
  },

  // ---------------- 技巧与坑 ----------------
  {
    id: 'tip-iterator-invalidation',
    category: 'tips',
    name: '迭代器/引用失效',
    summary: '容器修改后旧迭代器可能失效，是竞赛最常见的隐性 bug。',
    code: `// vector：扩容后全部失效；插入/删除点之后失效
for (auto it = v.begin(); it != v.end(); ) {
  if (bad(*it)) it = v.erase(it);   // erase 返回下一个有效迭代器
  else ++it;
}
// map/set：仅被删元素失效，其余仍有效
for (auto it = mp.begin(); it != mp.end(); ) {
  if (bad(*it)) it = mp.erase(it);
  else ++it;
}`,
    pitfalls: 'vector 里保存元素指针/引用后再 push_back 极易悬空；先 reserve 或改用 deque/list。',
    url: cref('container')
  },
  {
    id: 'tip-comparator',
    category: 'tips',
    name: '自定义比较器要点',
    summary: 'sort/set/map/priority_queue 的比较器语义不同，写错会 UB 或行为异常。',
    code: `// sort / set / map：返回 a 是否"排在 b 前面"（严格弱序，禁止用 <=）
struct Cmp { bool operator()(int a, int b) const { return a < b; } };
// priority_queue：返回 a 的优先级是否"低于" b（即堆顶是返回 false 的那个）
struct CmpPQ { bool operator()(int a, int b) const { return a > b; } };  // 小顶堆`,
    pitfalls: '比较器必须是 const 成员；含浮点比较要小心 NaN；状态依赖全局变量会导致顺序不确定。',
    url: cref('named_req/Compare')
  },
  {
    id: 'tip-fast-io',
    category: 'tips',
    name: '快速 I/O 与输入解析',
    summary: '大数据量下 cin/cout 会 TLE，需要关闭同步或用 scanf。',
    code: `int main() {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);
  // ...
}
// 按行/按分隔符解析
string line; getline(cin, line);
stringstream ss(line);
int x; while (ss >> x) { /* ... */ }
// 读到 EOF
while (cin >> x) { /* ... */ }`,
    pitfalls: '关闭同步后不要再混用 scanf/printf 与 cin/cout；endl 会 flush，输出量大时用 \'\\n\'。',
    url: cref('io/cout')
  },
  {
    id: 'tip-io-format',
    category: 'tips',
    name: '格式化输出',
    summary: '保留小数、补零、对齐；竞赛输出格式错误会被判 WA。',
    code: `printf("%.10f\\n", ans);            // 保留 10 位小数（推荐多打 2 位）
cout << fixed << setprecision(10) << ans << '\\n';
printf("%lld\\n", (long long)x);      // 注意类型必须匹配
printf("%02d:%02d\\n", h, m);
// 输出行末空格通常无害（多数 OJ 忽略行尾空白）`,
    complexity: '',
    pitfalls: '浮点误差：一般多输出 1–2 位小数；%lld 与 int 混用会输出垃圾。'
  },
  {
    id: 'tip-discretization',
    category: 'tips',
    name: '离散化与坐标压缩',
    summary: '值域过大时把出现过的值映射为连续下标，常用 map 或排序去重。',
    code: `// 方式一：排序去重 + lower_bound（见 unique/erase 条目）
// 方式二：map 边用边编号
map<int, int> id;
auto getId = [&](int x) {
  auto it = id.find(x);
  if (it != id.end()) return it->second;
  int nid = (int)id.size() + 1;
  id[x] = nid;
  return nid;
};`,
    pitfalls: '别忘了离散化后要按原值大小关系处理（前缀和/树状数组下标从 1 开始）。'
  },
  {
    id: 'tip-stl-tree',
    category: 'tips',
    name: '__gnu_pbds 平衡树（GNU 扩展）',
    summary: '需要 order_of_key / find_by_order（第 k 小）时的现成平衡树。',
    code: `#include <ext/pb_ds/assoc_container.hpp>
#include <ext/pb_ds/tree_policy.hpp>
using namespace __gnu_pbds;
template <class T> using oset =
  tree<T, null_type, less<T>, rb_tree_tag, tree_order_statistics_node_update>;

oset<int> s;
s.insert(x); s.erase(x);
s.order_of_key(x);        // 比 x 小的个数（排名，0-based）
*s.find_by_order(k);      // 第 k 小（0-based）`,
    complexity: '各操作 O(log n)',
    pitfalls: '仅 GCC/MinGW 可用；不允许多重集合直接插入重复值（可存 pair 加唯一编号）。'
  },
  {
    id: 'tip-string-tricks',
    category: 'tips',
    name: '字符串常用技巧',
    summary: '回文判断、分割、字符转换、子串计数等。',
    code: `string s = "abcba";
string r(s.rbegin(), s.rend());
bool pal = (s == r);
s.find(t) != string::npos;          // 子串存在
for (char& c : s) c = toupper(c);
s.append(3, 'x');                   // 追加 3 个 'x'
s.compare(0, 3, "abc") == 0;        // 前缀比较
count(s.begin(), s.end(), 'a');     // 字符计数`,
    pitfalls: 'toupper 参数应为 unsigned char；unsig/中文按字节处理，注意多字节边界。'
  },
  {
    id: 'tip-bitset-knapsack',
    category: 'tips',
    name: 'bitset 优化 DP（可达性/子集和）',
    summary: '把布尔 DP 压成位运算，复杂度除以 64。',
    code: `bitset<100005> dp;
dp[0] = 1;
for (int w : weights) dp |= (dp << w);
cout << dp.count() << '\\n';         // 可达和的个数
// 判断某和是否可达
if (dp[target]) { /* ... */ }`,
    complexity: 'O(n·S/64)',
    pitfalls: 'S 必须是编译期常量；dp 左移后越界位会被丢弃（这正是所需）。'
  },
  {
    id: 'tip-multiset-multimap',
    category: 'tips',
    name: 'multiset / multimap 正确删除',
    summary: '按值删除会删掉所有相等元素，通常需要按迭代器删。',
    code: `multiset<int> ms{1, 2, 2, 3};
ms.erase(2);                      // 删除全部 2
auto it = ms.find(2);
if (it != ms.end()) ms.erase(it);  // 只删一个
ms.erase(ms.lower_bound(3));       // 删第一个 ≥ 3 的元素`,
    pitfalls: '想删"某一个"时务必用迭代器；删除后原迭代器失效，需重新获取。'
  },
  {
    id: 'tip-graph-storage',
    category: 'tips',
    name: '图的 STL 存储写法',
    summary: '邻接表用 vector 数组；带权图用 pair；边表用于 Kruskal/Bellman-Ford。',
    code: `int n, m;
vector<vector<int>> g(n + 1);                          // 无权图
vector<vector<pair<int,int>>> gw(n + 1);               // 带权图 (to, w)
for (int i = 0; i < m; i++) {
  int u, v, w; cin >> u >> v >> w;
  gw[u].push_back({v, w});
  gw[v].push_back({u, w});                             // 无向图
}
struct Edge { int u, v, w; bool operator<(const Edge& o) const { return w < o.w; } };
vector<Edge> edges(m);                                 // Kruskal 边表`,
    pitfalls: '1-based 下标记得开 n+1；稠密图邻接矩阵可能爆内存（n^2）。'
  },
  {
    id: 'tip-common-functions',
    category: 'tips',
    name: '竞赛常用小函数',
    summary: '取模、快速幂、快读、随机等高频手写工具。',
    code: `const long long MOD = 1e9 + 7;
long long add(long long a, long long b) { return (a + b) % MOD; }
long long mul(long long a, long long b) { return a * b % MOD; }

long long qpow(long long a, long long e, long long mod) {
  long long r = 1 % mod; a %= mod;
  while (e) { if (e & 1) r = r * a % mod; a = a * a % mod; e >>= 1; }
  return r;
}
long long inv(long long a, long long mod) { return qpow(a, mod - 2, mod); }  // mod 为素数

mt19937 rng(chrono::steady_clock::now().time_since_epoch().count());
shuffle(v.begin(), v.end(), rng);   // 防被卡（随机化）`,
    pitfalls: '模数为 1 时 1 % mod 才安全；快速幂底数先取模，指数用 long long。'
  }
]

/** 分类标签（供 UI 显示；未知分类归入"其他"） */
export function categoryMeta(key: StlCategory): StlCategoryMeta {
  return STL_CATEGORIES.find((c) => c.key === key) ?? { key: 'misc', label: '其他', hint: '' }
}

/**
 * 关键字搜索（纯函数）：匹配名称、用途、代码、坑点；空关键字返回全部。
 * @param entries 数据源（默认全部条目）
 */
export function searchStlEntries(
  keyword: string,
  entries: readonly StlEntry[] = STL_ENTRIES
): StlEntry[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return [...entries]
  const terms = kw.split(/\s+/).filter(Boolean)
  return entries.filter((e) => {
    const hay = `${e.name}\n${e.summary}\n${e.code}\n${e.pitfalls ?? ''}\n${e.complexity ?? ''}`.toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

/** 按分类分组（保持 STL_CATEGORIES 顺序，空分类不返回） */
export function groupStlEntries(
  entries: readonly StlEntry[] = STL_ENTRIES
): { meta: StlCategoryMeta; items: StlEntry[] }[] {
  return STL_CATEGORIES.map((meta) => ({
    meta,
    items: entries.filter((e) => e.category === meta.key)
  })).filter((g) => g.items.length > 0)
}
