# 004 家充记录、电价与电网账单分摊（V2）

## 背景与目标

现有充电记录只认「补能量 + 实付金额」，家充用户通常拿不到每次充电的账单：电网按整月或按几天结算一次，金额和电量都属于一段区间，而不是某一晚。这个计划把家充从普通充电里分出来：

- 记一笔时只填开始充电时间与充电前后电量（或充满时间、或估计电量），先得到一条带「预估」标签的家充记录；
- 独立电表等电网账单出来后，按每条记录的预估电量作权重，把账单电量和金额分摊回去，分摊结果替换预估值；
- 共用总表没有独立账单，直接按「预估电量 × 当天电价」入账；
- 电价以版本维护，支持谷/平/峰/尖峰分段与跨零点；
- 全流程不引入网络请求、不新增存储键、不引入三方依赖。

方案版本 V2，取代 2026-11 的旧草稿（那版用「开始/结束两次打卡 + draft/confirmed 账单 + 会话状态机」，与家充的实际记账方式不符，已整体废弃）。

## 数据模型（版本 2）

存储键仍是 `car-miniapp:v1`，`version` 升到 `2`：

```js
{
  version: 2,
  vehicles: [],   // Vehicle 增加 batteryKwh100
  records: [],    // 充电记录增加家充字段
  plans: [],
  currentId,
  home: { meter: '' | 'dedicated' | 'shared', chargerKw100: 700, tariffs: [] },
  bills: []
}
```

- 金额单位仍是分（`cents`），电量统一 kWh × 100（`quantity100`），时间用「日期字符串 + 当天第几分钟」。
- 全项目一个 `home`，不按车辆区分；电价与电表是住所的属性。
- 车辆新增 `batteryKwh100`（整数或 `null`，仅插混/纯电，1.00–300.00 kWh）。
- 充电记录新增（只有 `home === true` 时有意义）：`home`、`settle`（`'' | 'pending' | 'bill' | 'manual' | 'estimate'`）、`startTime` / `endTime`（`'HH:MM'`，`endTime <= startTime` 表示次日）、`endEstimated`、`socBefore`、`estQuantity100`、`estCents`、`estMethod`（`'' | 'soc' | 'power' | 'typed'`）、`estK10000`（估算所用 k × 100）、`alloc`（`[{ billId, quantity100, cents, weight100 }]`，只由 `settleAll` 写）。

### settle 的四种含义

| settle | 表单 | 电量/金额 | 列表标签 |
| --- | --- | --- | --- |
| `pending` | 独立电表默认 | 都为空，另存预估 | 预估 |
| `bill` | 由 `settleAll` 写入 | Σ 分摊结果 | 实际或分摊 |
| `manual` | 用户关掉家充开关或手动填 | 用户填写 | 实际 |
| `estimate` | 共用总表 | 预估值 | 预估 |

`pending ↔ bill` 只由 `settleAll` 改；`estimate ↔ pending` 在切换电表类型时由 `saveHome` 改。共用总表切独立电表时，`estimate` 转 `pending`；已录账单时不允许切回共用总表，提示先删账单。

### 电价版本

```js
tariff = {
  id,
  from: 'YYYY-MM-DD',
  periods: [{ start: 'HH:MM', label: 'valley' | 'flat' | 'peak' | 'sharp', price10000 }]
}
```

- `periods` 按 `start` 排序，最后一段一直延续到次日第一段开始，因此天然跨零点；单一电价就是一段 `00:00`。
- `price10000` 是元/kWh × 10000，范围 1–50000（0.0001–5 元/kWh），最多四位小数。
- 某天使用 `from` 不晚于该天的最新版本。
- 校验：至少一段、最多 8 段、`start` 不重复、`from` 不重复。

### 电网账单

```js
bill = { id, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', quantity100, cents: null | 整数, note }
```

- `from ≤ to ≤ 今天`，跨度不超过 62 天，`quantity100 > 0`。
- `cents === null` 表示按电价表折算金额。
- 同一电表的账单区间不能重叠；只有 `meter === 'dedicated'` 可以录入。

## 算法（`miniprogram/utils/charging.js`，全部纯函数）

1. `largestRemainder(total, weights)`：先取整，再按小数部分降序（相同按传入顺序）补齐，保证合计精确等于 `total`；权重全零返回全零。
2. `chargeWindow(record)`：开始分钟到结束分钟，`end <= start` 时加 1440；时长限制 1–1440 分钟；日期以 `record.date` 为第 0 天，最多到第 1 天。
3. `estimateHomeCharge(input, vehicle, k, home)`：优先级 SOC → 功率 → 手填。SOC 法 `round(k × (socAfter − socBefore))`；功率法 `round(chargerKw100 × 分钟 / 60)`，只在用户填了充满时间时可用；手填法直接取估计电量。都没有时提示「请填写充电前后电量，或充满时间，或估计电量」。没有充满时间时按充电桩功率反推结束时间并标记 `endEstimated`。费用按 5.3 的切片结果逐段计算；当天没有电价版本时提示「请先在家充设置里填写电价」。
4. `sliceByDayAndTariff(window, quantity100, tariffs)`：在零点与当天每个 `period.start` 处切开，得到 `{ date, label, minutes, price10000 }` 段；电量按各段分钟数用最大余数法分配；每段金额 `round(q100 × price10000 / 10000)`；返回 `{ segments, byDate, byLabel, cents }`。
5. `homeK(vehicle, records, bills)`：默认 `k0 = batteryKwh100 / 100 / 0.9`（kWh / 1%）。对每张账单取所有与它有交集的家充记录，要求同车且都有充电前后电量；`pct = Σ(记录落在账单区间的分钟 / 总分钟 × ΔSOC)`；`k = Σ账单电量 / Σpct`。样本按账单结束日期取最近 8 张，少于 3 张时退回 `k0`；有 `k0` 时丢弃 `quantity100 / pct` 不在 `[0.6k0, 1.5k0]` 的离群样本；同时给出平均偏差 `mae`。`k` 不存储，只存在记录的 `estK10000` 里供展示。
6. `allocateBill(bill, records, tariffs)`：
   - 候选是与账单区间有交集、`settle ∈ pending | bill | manual` 的家充记录；
   - 权重 `w_i` = 该记录预估切片中落在账单区间内的电量合计；
   - `manual` 记录先按时间占比扣掉它自己的实际电量，剩下的才分给其它记录；账单电量小于已确认合计时提示「账单电量小于已确认记录合计，请核对」；
   - 其余记录按 `w_i` 用最大余数法分剩余电量；
   - 账单有金额时按 `w_i` 分「账单金额 − manual 按电价折算的费用」；没有金额时，每条分到的电量按自己区间内的时段结构套当天电价；
   - 所有 `w_i` 都为 0 且剩余电量大于 0.5 kWh 时提示「这段时间有用电，但没有对应的家充记录，可能漏记」，0.5 kWh 以内视为待机忽略。
7. `settleAll(state)`：清空所有家充 `alloc`，按 `from` 升序对每张账单调用 `allocateBill` 并追加分摊；随后对每条 `pending | bill` 记录判断「它的每一天都被某张账单覆盖」：覆盖则 `settle = 'bill'`、电量与金额取分摊合计、`confirmed = true`；否则回到 `pending`、电量金额置空、保留 `alloc` 用于计算「已对账 N%」。不重算预估。
8. `confidence(record, state)`：非家充或 `manual` → 实际；还没被账单完整覆盖 → 预估；被覆盖但账单同时分给了多条记录 → 分摊；账单只分给它一条 → 实际。
9. 归一化函数 `normalizeHome` / `normalizeTariff` / `normalizeBill` 负责表单与备份校验，错误文案统一走 `domain.fail`（`e.user === true`）。

## 业务逻辑调整

- `normalizeRecord`：家充的 `pending` / `estimate` 允许电量和金额为空，但要求开始时间与充电前电量；`estimate` 必须有预估值；`bill` 只能由 `settleAll` 写入。非家充保持原有规则。
- `recordInput`：空金额/电量转空串，带回全部家充字段，供编辑表单回填。
- `recordDefaults` / 单价沿用：取上一次同类记录时跳过 `pending` / `estimate`，避免把预估价当成实际单价。
- `recordWarnings`：电量检查改用 `quantity100 ?? estQuantity100`；SOC 与功率两种估法差超过 25% 时软提示核对充满时间。
- `energyIntervals`：`pending` / `estimate` 与「上次以来的充电都已记录」未确认一样视为断点，不参与区间电耗；提示优先显示「有家充待对账，对账后即可算出电耗」。
- `statistics` / `monthlyTrend`：金额用 `effectiveCents = cents ?? estCents`，并额外返回 `estimatedCents` 与 `estimatedCharge100`，让页面显示「含预估」。
- `csv.recordsCsv`：原 13 列顺序不变，末尾追加「家充、充电时段、充电前电量(%)、数据来源、预估电量(kWh)、预估金额(元)」；`pending` 的金额与补能量留空。
- `ui.recordView`：家充显示「家充」与可信度标签；`pending` 的金额显示为「预估 ¥x · 待对账（已对账 60%）」。

## 存储层

`store.js` 新增并在 `change()` 内按「校验 → 修改 → `settleAll`」执行：

- `saveHome(input)`：保存电表类型与充电桩功率，切换电表时在 `estimate` / `pending` 之间转换；
- `saveTariff(input)` / `deleteTariff(id)`：删除前检查是否有待对账记录或没填金额的账单会失去适用电价，有则拒绝并说明原因；
- `saveBill(input)` / `deleteBill(id)`：只允许独立电表；保存后立即重算分摊。

`saveRecord` 对家充先估算（需要 `homeK` 的 k）再归一化，写入预估字段；同车家充时段重叠时拒绝保存。`deleteRecord`、`undoDelete`、`deleteVehicle` 涉及家充时也会重算。备份恢复会校验 `home` / `tariffs` / `bills`，忽略备份里的 `alloc`，恢复后统一重算；v1 备份先升级再恢复。

## 页面

- **记一笔**：充电类型新增「家充」开关。独立电表显示「电量和金额等电网数据出来再对账」，默认开（`pending`）；共用总表显示「按预估入账」（`estimate`）；关掉开关就是手动填实际值。未设置电表时提示并给「去设置」。字段：开始充电时间（预约充电填预约时间）、充电前电量、充电后电量、充满/停止时间（选填，提示不是拔枪时间）、估计电量（SOC 与充满时间都没填时才出现）。表单内实时显示预估 kWh、金额、峰谷拆分与所用 k 的来源。编辑 `bill` 记录时电量与金额只读，并显示分摊明细。
- **家充对账**（`pages/settle`）：顶部待对账笔数与预估合计；录账单后可先预览分摊表（每条记录预估、分到电量、金额、权重与提示），确认后保存；账单列表可编辑删除，删除后回到待对账；待对账列表点击进入记一笔；共用总表只显示说明。
- **家充设置**（`pages/homecharge`）：电表类型、充电桩功率、电价版本（新增/编辑/复制生效中/删除）、每 1% 电量对应 kWh（按车显示当前值、来源与平均偏差）。
- 其余：车辆表单增加电池标称容量；车库增加两个入口；首页加待对账卡片与「含预估」；账本行显示可信度标签；统计页金额后显示「含预估」。

## 迁移

`migrate()` 在 `version === 1` 时升级到 2：车辆补 `batteryKwh100: null`；充电记录补 `home: false`、`settle: ''`、空时段、`est*: null/''`、`alloc: []`；补 `home` 与 `bills`。旧记录一律按非家充处理，首页、统计与 CSV 的既有结果不变。

## 测试

- `tests/charging.test.js`：最大余数、跨零点窗口、验收用例 A/B、电价版本切换、无电价报错、三种估算优先级、k 校准与离群、账单分摊与「待对账」、manual 扣减、漏记阈值、对账后统计。
- `tests/home.test.js`：v1→v2 迁移、电池容量校验、pending 记录预估值、时段重叠、账单分摊与删除回退、共用总表与切表守卫、备份恢复重算。
- `tests/pages.test.js`：独立电表两晚家充 → 录账单 → 变实际；共用总表按预估入账与关闭开关转手动；10 个页面的事件绑定齐全。
- `tests/domain.test.js`：19 列 CSV、默认值、能耗断点与统计口径。

验收数字（电价平段 07:00 ¥0.6000、谷段 23:00 ¥0.3000，电池 63 kWh，桩 7 kW）：

- 11-20 22:00、30%→80%：35.00 kWh、¥12.60，结束时间推算为次日 03:00。
- 11-21 23:00、40%→70%：21.00 kWh、¥6.30，结束时间次日 02:00。
- 账单 11-21 30.80 kWh 无金额：A 分 23.10 kWh / ¥6.93，B 分 7.70 kWh / ¥2.31，两者仍「待对账」。
- 再录 11-20 14.50 kWh：A 变 `bill`，合计 37.60 kWh / ¥13.46，标签「分摊」。
- 10.00 按 1:1:1 分为 3.34 / 3.33 / 3.33。

## 停止条件

执行中遇到以下情况应停下报告，而不是自行改方案：现状与代码不一致；v1 统计结果发生变化且非预期；需要联网、三方依赖或新的存储键；实现算出的数字与验收用例不符（报告实际数字，不改用例）。

## 实现状态

DONE（2026-11-22）。`node tests/charging.test.js`（13）、`node tests/domain.test.js`（37）、`node tests/home.test.js`（10）、`node tests/pages.test.js`（29）全部通过；`node scripts/check.js` 检查 60 个文件、10 个页面。沙箱内不能执行 `npm test`（子进程 spawn 受限）与 `npm run format:check`（npm 缓存不可写），因此测试按文件直接运行，格式按既有 Prettier 风格手写。
