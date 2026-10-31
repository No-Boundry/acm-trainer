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
  { key: 'misc', label: '其他常用', hint: 'pair / tuple / bitset / 数值 / 初始化与清空' },
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
    code: `// —— 初始化（五种写法都要会）——
vector<int> v;                       // 空
vector<int> a(n, 0);                 // 填充构造：n 个 0
vector<int> b{1, 2, 3};              // 初始化列表（C++11）
vector<int> c(arr, arr + n);         // 从 C 数组区间构造
vector<int> d(a.begin(), a.begin() + k);  // 从另一容器的迭代器区间
vector<int> e = a;                   // 拷贝构造
vector<vector<int>> g(n);            // 邻接表

// —— 增删查 ——
v.push_back(x); v.emplace_back(a, b);   // 尾插 O(1) 均摊
v.pop_back();
v.size(); v.empty(); v.front(); v.back(); v[i]; v.at(i);  // at 会检查越界
v.insert(v.begin() + i, x);          // 中间插入 O(n)
v.erase(v.begin() + i);              // 删除第 i 个 O(n)

// —— 重置 / 清空 / 释放 ——
v.assign(5, 7);                      // 重置为 5 个 7（会改大小）
v.resize(k); v.resize(k, -1);        // 变长补默认值/指定值；变短则截断
v.clear();                           // 清空：size=0，capacity 不变
v = {};                              // C++11 清空惯用法（等价 clear）
vector<int>().swap(v);               // 连同内存一起释放（capacity 归零）
v.shrink_to_fit();                   // 请求释放多余容量（非强制）
v.swap(w); swap(v, w);               // O(1) 交换

sort(v.begin(), v.end());            // 排序 O(n log n)
v.reserve(1 << 20);                  // 预分配，避免多次扩容`,
    complexity: '尾插/尾删 O(1) 均摊；随机访问 O(1)；任意位置插删 O(n)',
    pitfalls: '扩容会使全部迭代器/指针失效；vector<bool> 是位压缩特化，不能取地址。',
    url: cref('container/vector')
  },
  {
    id: 'deque',
    category: 'sequence',
    name: 'std::deque',
    summary: '双端队列容器，两端 O(1) 插删；也常用来替代 vector 实现 0-1 BFS。',
    code: `deque<int> dq;                       // 空
deque<int> dq2(n, 0);                // 填充构造
deque<int> dq3{1, 2, 3};             // 初始化列表
deque<int> dq4(v.begin(), v.end());  // 从区间构造（vector → deque）

dq.push_back(x); dq.push_front(y);
dq.emplace_back(x); dq.emplace_front(y);
dq.pop_back();   dq.pop_front();
dq.front(); dq.back(); dq[i];
dq.size(); dq.empty();
dq.clear();                          // 清空（deque 有 clear，适配器没有）
dq = {};                             // 清空惯用法
deque<int>().swap(dq);               // 释放内存
dq.swap(other);`,
    complexity: '两端插删 O(1)；随机访问 O(1)（常数略大于 vector）',
    pitfalls: '内存不连续，遍历比 vector 慢；中间插删仍是 O(n)。',
    url: cref('container/deque')
  },
  {
    id: 'array',
    category: 'sequence',
    name: 'std::array',
    summary: '定长数组容器，避免 C 数组退化为指针，支持 size()/begin()/end()。',
    code: `array<int, 5> a{};           // 聚合初始化 → 全 0
array<int, 5> b = {1, 2, 3}; // 其余元素补 0
array<int, 5> c;             // 未初始化！元素为不确定值
c.fill(-1);                  // 统一赋值（最常用）
a.fill(0);                   // 重新填 0（array 没有 clear，用 fill 代替）
a.swap(b);                   // 同长度数组交换
a.size();                    // 编译期常量，无运行时开销
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
    code: `// —— 初始化 ——
string s;                        // 空串
string s1("hello");              // 字面量
string s2(5, 'a');               // "aaaaa"（重复字符构造）
string s3(3, 'x');  string s4 = s1;
string s5(s1, 1, 3);             // 从下标 1 取 3 个字符
string s6(s1.begin(), s1.begin() + 2);  // 迭代器区间
string s7 = to_string(123);      // 数值 → 字符串

// —— 修改 ——
s += " world";  s.append("!");  s.push_back('x');
s.insert(s.begin(), '#');        // 头部插入 O(n)
s.append(3, 'x');                // 追加 3 个 'x'
s.pop_back();                    // 删末字符（C++11）

// —— 清空 / 重置 / 交换 ——
s.clear();                       // 清空（size=0，capacity 不变）
s = "";                          // 等价清空
s.erase();                       // 无参 erase 也是清空
s.assign(3, 'z');                // 重置为 "zzz"
s.assign("abc");                 // 重置为 "abc"
string().swap(s);                // 连内存一起释放
s.swap(t);

// —— 查询 / 截取 ——
s.size(); s.empty(); s.length(); s[i]; s.at(i);
s.substr(1, 3);                  // "ell"
s.find("world");                 // 下标或 string::npos
s.rfind("l");
s.replace(0, 5, "hi");
s.compare(0, 3, "abc") == 0;     // 前缀比较
stoi("42"); stoll("1e18");       // 字符串 → 数值
to_string(123);                  // 数值 → 字符串
getline(cin, s);                 // 读整行（可与 cin >> 混用）`,
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
    code: `// —— 初始化 ——
stack<int> st;                       // 空栈（底层默认 deque<int>）
stack<int> st2(dq);                  // 用已有容器拷贝构造
stack<int, vector<int>> st3(v);      // 指定底层容器为 vector
stack<int, list<int>> st4;

// —— 常用操作 ——
st.push(x); st.emplace(x);           // 压栈（emplace 原地构造）
st.pop();                            // ⚠ 返回 void！要先 top() 再 pop()
int x = st.top();
st.size(); st.empty();
st.swap(st2);

// —— 清空：适配器都没有 clear() ——
st = stack<int>();                   // ① 重新赋值成空栈（推荐）
st = {};                             // ② C++11 写法
while (!st.empty()) st.pop();        // ③ 逐个弹出 O(n)，不释放内存
stack<int>().swap(st);               // ④ 连内存一起释放`,
    complexity: 'push/pop/top O(1)',
    pitfalls: '不提供遍历与迭代器；pop() 不返回元素，需先 top()。',
    url: cref('container/stack')
  },
  {
    id: 'queue',
    category: 'adapter',
    name: 'std::queue',
    summary: '先进先出；BFS、模拟队列。',
    code: `// —— 初始化 ——
queue<int> q;                        // 空队列（底层默认 deque<int>）
queue<int> q2(dq);                   // 用已有容器拷贝构造
queue<int, list<int>> q3;            // 指定底层容器

// —— 常用操作 ——
q.push(x); q.emplace(x);             // 入队
q.pop();                             // ⚠ 返回 void！要先 front()
int x = q.front();
q.front(); q.back();
q.size(); q.empty();
q.swap(q2);

// —— 清空：同样没有 clear() ——
q = queue<int>();                    // ① 重新赋值（推荐）
q = {};                              // ② C++11
while (!q.empty()) q.pop();          // ③ 逐个弹出 O(n)
queue<int>().swap(q);                // ④ 释放内存`,
    complexity: 'push/pop/front O(1)',
    pitfalls: 'pop() 只删除不返回，取值必须用 front()/top()；同样不能遍历。',
    url: cref('container/queue')
  },
  {
    id: 'priority_queue',
    category: 'adapter',
    name: 'std::priority_queue',
    summary: '大顶堆（默认）/小顶堆；贪心、Dijkstra、动态取最值。',
    code: `// —— 初始化 ——
priority_queue<int> mx;                                    // 大顶堆（默认 less）
priority_queue<int, vector<int>, greater<int>> mn;         // 小顶堆
priority_queue<int> pq(v.begin(), v.end());                // 从区间建堆，O(n)
priority_queue<int, vector<int>, greater<>> pqg(v.begin(), v.end());  // 小顶堆 + 区间
priority_queue<pair<int,int>, vector<pair<int,int>>, greater<>> pq2;  // 按 first 最小
struct Node { int d, u; };
struct Cmp { bool operator()(const Node& a, const Node& b) const { return a.d > b.d; } };
priority_queue<Node, vector<Node>, Cmp> pq3;               // 自定义（注意是"反着写"）

// —— 常用操作 ——
mx.push(x); mx.emplace(x); mx.top(); mx.pop();
mx.size(); mx.empty();

// —— 清空：没有 clear() ——
mx = priority_queue<int>();                                // ① 重新赋值（推荐）
mx = {};                                                   // ② C++11
while (!mx.empty()) mx.pop();                              // ③ 逐个弹出 O(n log n)
priority_queue<int>().swap(mx);                            // ④ 释放内存

// —— 已有 vector 当堆用（heap 算法，比 priority_queue 更省常数）——
make_heap(v.begin(), v.end());                    // 大顶堆
make_heap(v.begin(), v.end(), greater<int>());    // 小顶堆
v.push_back(x); push_heap(v.begin(), v.end());    // 入堆
pop_heap(v.begin(), v.end()); v.pop_back();       // 弹出堆顶（大顶堆时堆顶在 v[0]）
sort_heap(v.begin(), v.end());                    // 堆 → 有序`,
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
    code: `// —— 初始化 ——
set<int> s;                        // 空
set<int> s2{3, 1, 2};              // 初始化列表（自动排序去重 → 1 2 3）
set<int> s3(a.begin(), a.end());   // 从区间构造（排序 + 去重）
set<int, greater<int>> desc{1, 2, 3};  // 降序比较器
multiset<int> ms{1, 1, 2};         // 允许重复

// —— 增删查 ——
s.insert(3); s.emplace(3);
s.erase(3);                        // 按值删（multiset 会删全部）
s.erase(s.begin());                // 按迭代器删
s.count(3);                        // 0 / 1（multiset 是重复个数）
auto it = s.find(3);
auto it2 = s.lower_bound(3);       // ≥ 3 的第一个（成员函数 O(log n)）
auto it3 = s.upper_bound(3);       // > 3
if (it2 != s.end()) cout << *it2;
s.size(); s.empty();

// —— 清空 / 交换 ——
s.clear();                         // 清空（关联容器有 clear）
s = {};                            // 等价清空
s.swap(s2);
set<int>().swap(s);                // 释放内存

// —— multiset 只删一个 ——
auto it4 = ms.find(5);
if (it4 != ms.end()) ms.erase(it4);   // 只删一个 5（erase(5) 会删全部）`,
    complexity: 'insert/erase/find/lower_bound O(log n)',
    pitfalls: 'multiset 用 erase(key) 会删除所有相等元素；遍历时删除须用迭代器并接收返回值。',
    url: cref('container/set')
  },
  {
    id: 'map',
    category: 'associative',
    name: 'std::map / multimap',
    summary: '有序键值表：计数、离散化、区间统计、前驱后继。',
    code: `// —— 初始化 ——
map<string, int> cnt;                      // 空
map<string, int> c2{{"a", 1}, {"b", 2}};   // 初始化列表
map<string, int> c3(m2);                   // 拷贝
map<int, int, greater<int>> desc;          // 按键降序
multimap<int, int> mm;                     // 允许键重复

// —— 增删改查 ——
cnt["abc"]++;                  // 不存在则插入 0 再自增（副作用！）
cnt.insert({"k", 1});          // 已存在则不覆盖
cnt.emplace("k", 1);
auto it = cnt.find("abc");     // 别用 cnt["x"] 判断存在（会插入）
if (it != cnt.end()) cout << it->second;
cnt.count("abc");              // 0 / 1
cnt.erase("abc");              // 按键删
cnt.erase(it);                 // 按迭代器删
auto itl = cnt.lower_bound("b");   // 第一个 ≥ "b"
auto itu = cnt.upper_bound("b");   // 第一个 >  "b"
for (auto& [k, v] : cnt) cout << k << ' ' << v;   // C++17 结构化绑定
// multimap 只删一个：
auto e = mm.find(5);
if (e != mm.end()) mm.erase(e);

// —— 清空 / 释放 / 交换 ——
cnt.clear();                   // 清空（关联容器都有 clear）
cnt = {};                      // 等价清空
map<string, int>().swap(cnt);  // 连内存一起释放
cnt.swap(c2);`,
    complexity: '增删查 O(log n)',
    pitfalls: 'operator[] 会插入默认值，判存在请用 find/count；键为自定义类型需提供比较器。',
    url: cref('container/map')
  },
  {
    id: 'unordered',
    category: 'associative',
    name: 'std::unordered_set / unordered_map',
    summary: '哈希表：均摊 O(1) 查找，适合大量计数与判重。',
    code: `// —— 初始化 ——
unordered_map<long long, int> mp;          // 空
unordered_map<long long, int> mp2{{1, 10}, {2, 20}};
unordered_map<long long, int> mp3(mp);
unordered_set<int> vis;                    // 空
unordered_set<int> vis2{1, 2, 3};
unordered_multiset<int> ums;               // 允许重复

// —— 性能调优（竞赛必写）——
mp.reserve(1 << 16);           // 预留桶，减少 rehash（按元素数估）
mp.max_load_factor(0.7);       // 装载因子，越小越快越费内存

// —— 增删查 ——
mp[x]++;  mp.insert({x, 1});  mp.emplace(x, 1);
auto it = mp.find(x);          // 判存在用 find/count，别用 mp[x]
if (it != mp.end()) cout << it->second;
mp.count(x);                   // 0 / 1（multi 版是重复个数）
mp.erase(x);                   // 按键删
mp.erase(it);                  // 按迭代器删
ums.insert(5); ums.count(5);
vis.insert(x); vis.count(x);

// —— 清空 / 释放 / 交换 ——
mp.clear();
mp = {};
unordered_map<long long, int>().swap(mp);   // 释放桶内存
mp.swap(mp2);`,
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
    code: `// —— 初始化 ——
pair<int,int> p{1, 2};
pair<int,int> q = make_pair(1, 2);
pair<int,int> zero{};                      // {0, 0}
tuple<int,int,int> t{1, 2, 3};
tuple<int,int,int> t2 = make_tuple(1, 2, 3);
array<pair<int,int>, 3> arr{};             // 常用：定长点集

// —— 访问与修改 ——
p.first; p.second;
get<0>(t); get<1>(t);
auto [a, b] = p;                           // C++17 结构化绑定
auto [x1, x2, x3] = t;
p.first = 5; get<0>(t) = 5;

// —— 排序 / 去重 / 比较 ——
vector<pair<int,int>> v;
v.push_back({x, y}); v.emplace_back(x, y);
sort(v.begin(), v.end());                  // 先 first 再 second
sort(v.begin(), v.end(), [](auto& a, auto& b){ return a.second < b.second; });
v.erase(unique(v.begin(), v.end()), v.end());
v.clear();                                 // vector 本身有 clear
// 超过 2 元用 tuple，自带字典序比较
tuple<int,int,int> A{1,2,3}, B{1,3,0};
cout << (A < B);                           // true（逐个比较）

// —— 交换 / 清空 ——
p.swap(q); swap(p, q);
t.swap(t2);
p = {}; t = {};`,
    complexity: '比较 O(1)（按字典序）',
    url: cref('utility/pair')
  },
  {
    id: 'bitset',
    category: 'misc',
    name: 'std::bitset',
    summary: '定长位集合：位运算加速、可达性/背包状压、集合交并。',
    code: `// —— 初始化（长度必须是编译期常量）——
bitset<100000> bs;                    // 全 0
bitset<100000> bs2(12345ULL);         // 用整数初始化（低位对齐）
bitset<8> b8("10110000");             // 用字符串初始化（左边是高位）
bitset<100> all0; all0.reset();       // 显式全 0
bitset<100> all1; all1.set();         // 全 1

// —— 位操作 ——
bs[3] = 1; bs.set(3); bs.reset(3); bs.flip(3);   // 单点置/清/反
bs.set(); bs.reset(); bs.flip();                  // 全体置/清/反
bs.count();                           // 1 的个数
bs.any(); bs.none(); bs.all();        // C++11
bs.size();                            // 编译期长度
bs._Find_first(); bs._Find_next(i);   // GCC 扩展：找下一个 1（比循环快）

// —— 集合运算与位移 ——
bs |= (bs << k);                      // 背包可达性整体左移
bs >>= 1;
(bs & bs2).count();                   // 交集大小
bs &= bs2; bs |= bs2; bs ^= bs2; ~bs;

// —— 转换 / 清空 ——
bs.to_string();                       // "0101..."
bs.to_ulong(); bs.to_ullong();
bs.reset();                           // 清空 = 全部置 0（bitset 没有 clear）
bs = bitset<100000>();                // 等价重置`,
    complexity: '位运算 O(n/64)',
    pitfalls: '长度必须是编译期常量；大 bitset 每次操作 O(n/64)，注意总复杂度。',
    url: cref('utility/bitset')
  },
  {
    id: 'stl-init-clear',
    category: 'misc',
    name: '初始化与清空速查对照',
    summary: '各容器的初始化写法、清空方式与内存释放；array / 适配器 / bitset 都没有 clear()。',
    code: `// ——— 初始化 ———
vector<int> v(n, 0);                    // 填充构造：n 个 0
vector<int> v2{1, 2, 3};                // 初始化列表
vector<int> v3(a.begin(), a.end());     // 迭代器区间
vector<vector<int>> g(n);               // 邻接表
deque<int> dq(n, 0);  queue<int> q(dq); // 适配器可从容器拷贝构造
array<int, 5> a{};                      // 必须写 {}，否则元素未初始化
string s(n, 'c');     string s2 = to_string(123);
set<int> st{3, 1, 2}; map<int,int> mp{{1, 10}};
priority_queue<int> pq(v.begin(), v.end());   // 从区间 O(n) 建堆，比逐个 push 快
bitset<100> bs("1011");  bitset<100> bs2(123ULL);

// ——— 清空：先看有没有 clear() ———
// ✅ 有 clear()：vector / deque / string / set / multiset / map / multimap
//                unordered_set / unordered_map
v.clear();  s.clear();  st.clear();  mp.clear();
// ❌ 没有 clear()：
array<int, 5> a{};  a.fill(0);              // array 用 fill 代替
stack<int> st;      st = {};                // 适配器：重新赋值
queue<int> q;       q = queue<int>();
priority_queue<int> pq;  pq = priority_queue<int>();
bitset<100> bs;     bs.reset();              // bitset 用 reset 全置 0
// 其他等价写法
v = {};                                     // C++11 清空惯用法
while (!st.empty()) st.pop();                // O(n)，不释放内存

// ——— 释放内存（clear 不缩容）———
vector<int>().swap(v);                      // 容量归零，竞赛最常用
vector<int>(v).swap(v);                     // 保留元素、去掉多余容量
v.shrink_to_fit();                          // C++11，只是"请求"

// ——— 交换 ———
v.swap(w);  swap(v, w);                     // O(1)

// ——— 常见坑 ———
// 1) 多组数据忘清空 → 上一组残留导致 WA
// 2) 邻接表要逐行清：for (auto& row : g) row.clear();
//    g.clear() 会把整张表结构丢掉，下次还得重新 resize
// 3) clear() 之后容器仍可继续用，capacity 保留
// 4) 字符串读入前 s.clear() + 处理残留换行（getline 与 >> 混用）`,
    complexity: 'clear() 析构 O(n)；swap 释放 O(1)',
    pitfalls: 'clear() 不缩容；array / 适配器 / bitset 没有 clear()；多测务必逐层清空。',
    url: cref('container')
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
