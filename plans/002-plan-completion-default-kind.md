# 计划 002：完成车险、年检等计划时，新记录默认记为「其他费用」

> **执行说明**：按步骤顺序执行。每一步都要运行「验证」里的命令，确认结果与预期一致后才能进入下一步。出现「停止条件」中的任何一种情况，立即停下并报告，不要自行变通。完成后，更新 `plans/README.md` 中本计划那一行的状态（如果派你来的审查者说明由他维护索引，则不用改）。
>
> **漂移检查（最先运行）**：`git diff --stat 5322246..HEAD -- miniprogram/utils/domain.js miniprogram/pages/entry/index.js tests/domain.test.js tests/pages.test.js README.md`
> 如果有输出，先把下文「现状」中的摘录与实际代码逐一对照。以下改动属于预期，不算漂移：计划 001 改了 `README.md` 开头的验证说明；计划 003 改了 `entry/index.js` 的 `save()` / `commit()`，并在 `tests/pages.test.js` 新增了一个测试。除此之外的任何不一致都按停止条件处理。下文的行号以提交 `5322246` 为准；如果行号有偏移，用给出的原文搜索定位。

## 状态

- **优先级**：P1
- **工作量**：S（约 45 分钟）
- **风险**：LOW
- **依赖**：无硬性依赖。建议在计划 001 之后执行（这样 PR 会被 CI 检查）。与计划 003 修改同一个文件，二者必须先后执行，不能同时进行。
- **类别**：bug
- **计划基于**：提交 `5322246`，2026-11-13
- **对应**：2026-11-13 `/improve quick` 体检第 1 条
- **版本**：V1

## 为什么要做

「车小记」允许把一次车险或年检付款关联到养护计划，作为「记录已完成」。产品设计把保险、年检归为「其他费用」（`DESIGN.md` 第 55 行：「停车、通行、洗车、保险、维修等作为其他费用分类。」）。但从计划进入记账页时，记录类型默认是「保养」，只自动选好了类别「保险」或「年检」，而类别只对「其他费用」生效。用户照常填金额保存，一笔 3800 元的车险就会计入保养支出，每年重复一次，没有任何提示。现有页面测试在保存前手动切换了类型，所以一直没有发现。完成后：这类计划默认记为「其他费用」并带上正确类别；某个计划上次完成时用的是什么类型，下次就默认用同样的类型。

## 现状

### 相关文件

- `miniprogram/pages/entry/index.js`：记一笔 / 记录详情页。`onLoad`（第 34–89 行）决定新记录的默认值。
- `miniprogram/utils/domain.js`：纯业务逻辑（校验、统计、计划推算），页面通过 `U.D.xxx` 调用（`U` 是 `require('../../utils/ui')`，`U.D` 就是 `domain.js`）。
- `tests/domain.test.js`：纯函数测试。
- `tests/pages.test.js`：用模拟的 `wx` 对象加载页面并操作的测试。
- `README.md`：功能说明，第 34 行描述了这项行为。

### `miniprogram/pages/entry/index.js` 第 47–49 行与第 56–79 行

~~~js
          kinds = U.D.allowedKinds(v)
            .filter(id => !plan || U.D.PLAN_KINDS.includes(id))
            .map(id => ({ id, name: U.D.KINDS[id] }));
~~~

~~~js
        let form = Object.assign({}, this.data.form, {
          vehicleId: v.id,
          kind: kinds[0].id,
          date: today,
          full: !!(lastFuel && lastFuel.full),
          confirmed: !!(lastCharge && lastCharge.confirmed),
        });
        if (record)
          form = Object.assign(form, U.D.recordInput(record), {
            price: record.quantity100 && record.cents ? (record.cents / record.quantity100).toFixed(2) : '',
            category: record.category || '其他',
          });
        else if (plan)
          form = Object.assign(form, {
            planId: plan.id,
            complete: true,
            note: plan.name,
            category: /险/.test(plan.name) ? '保险' : /年检|年审/.test(plan.name) ? '年检' : '其他',
          });
        this.setData({
          vehicle: v,
          kinds,
          form,
          kindIndex: kinds.findIndex(k => k.id === form.kind),
~~~

要点：

- 第 47–49 行：从计划进入时，可选类型只剩 `['service', 'other']`，即保养、其他费用。
- 第 58 行：默认类型取第一个，也就是 `service`（保养）。
- 第 63–67 行：编辑已有记录时，沿用记录原来的值。本计划不改这一分支。
- 第 68–74 行：从计划新建记录时，只按计划名推断了类别，没有改类型。这是要改的地方。
- 第 79 行：`kindIndex` 根据 `form.kind` 计算。页面上的类型按钮按 `kindIndex` 高亮（`entry/index.wxml` 中是 `class="filter {{kindIndex === index ? 'active' : ''}}"`），所以只要 `form.kind` 对了，界面无需改动。

### `miniprogram/utils/domain.js`

第 8–9 行：

```js
const PLAN_KINDS = ['service', 'other'];
const OTHER_CATEGORIES = ['停车', '通行', '洗车', '保险', '年检', '维修', '罚款', '其他'];
```

第 133 行（在 `normalizeRecord` 中）：类别只为其他费用保存。

```js
  if (r.kind === 'other') r.category = OTHER_CATEGORIES.includes(input.category) ? input.category : '其他';
```

第 322–326 行（`reminder` 中找「最近一次完成记录」的排序，新函数要用完全相同的排序）：

```js
function reminder(plan, records, mileage, asOf = today(), dailyKm = 0) {
  const completions = records
    .filter(r => r.planId === plan.id && r.complete)
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id));
  const last = completions[0];
```

存储中的记录对象，与本计划相关的字段：`id`、`vehicleId`、`kind`（`fuel` / `charge` / `service` / `other`）、`date`（`YYYY-MM-DD`）、`mileage`（数字；完成计划的记录一定有里程）、`planId`、`complete`（是否完成了计划）、`category`（只有 `other` 有）。

### 代码约定（照着写）

小而纯的业务函数放在 `domain.js`，函数上方用一两行英文注释说明「为什么」，并加入文件末尾的 `module.exports`。范例是 `domain.js` 第 279–290 行：

```js
// Common starting points only: real intervals come from the owner's manual, so every field stays editable.
const PLAN_PRESETS = [
  { name: '机油机滤', months: 6, km: 5000, engine: true },
  // ...（共 6 项）
];
function planPresets(v) {
  return PLAN_PRESETS.filter(p => !p.engine || typeOf(v).fuel);
}
```

`module.exports` 在第 370–402 行，其中第 396 行是 `planPresets,`。

## 需要用到的命令

| 用途 | 命令 | 成功时的结果 |
|------|------|--------------|
| 全部测试 | `npm test` | 末尾有 `ℹ fail 0` |
| 只跑新测试 | `node --test --test-name-pattern="完成计划的新记录" tests/domain.test.js` | `ℹ tests 1`、`ℹ pass 1`、`ℹ fail 0` |
| 项目检查 | `npm run check` | 输出一行以 `Checked` 开头的说明，退出码 0 |
| 格式检查 | `npx --yes prettier@3.9.10 --check --end-of-line auto miniprogram/utils/domain.js miniprogram/pages/entry/index.js tests/domain.test.js tests/pages.test.js` | `All matched files use Prettier code style!` |
| 格式化（仅在格式检查失败时使用，只针对这 4 个文件） | `npx --yes prettier@3.9.10 --write --end-of-line auto miniprogram/utils/domain.js miniprogram/pages/entry/index.js tests/domain.test.js tests/pages.test.js` | 列出 4 个文件，退出码 0 |

`--end-of-line auto` 让格式检查在 Windows（以 CRLF 检出）和 Linux 上结果一致。如果计划 001 已经完成，也可以直接用 `npm run format:check`。

## 范围

**可以修改**（只改这些）：

- `miniprogram/utils/domain.js`：新增 `planRecordDefaults` 函数并导出
- `miniprogram/pages/entry/index.js`：只改 `onLoad` 中的 `else if (plan)` 分支（第 68–74 行）
- `tests/domain.test.js`：新增 1 个测试
- `tests/pages.test.js`：修改 2 个现有测试，见「测试计划」
- `README.md`：只改一句话
- `plans/README.md`：只更新本计划的状态行

**不要修改**：

- `entry/index.js` 的 `save()` / `commit()`（计划 003 负责），以及编辑已有记录的分支（第 63–67 行）：编辑时必须保持记录原来的类型。
- `PLAN_KINDS`、`OTHER_CATEGORIES`、`normalizeRecord`、`reminder`、`PLAN_PRESETS`。
- `entry/index.wxml` 和其他页面。

## Git 流程

- 分支名：`plan-completion-default-kind`。
- 提交示例：`fix: default plan completions for insurance and inspection to other expenses`，正文说明默认类型的规则。
- 没有得到操作者明确允许时，不要推送，也不要开 PR。

## 步骤

### 第 1 步：确认起点

运行 `npm test`，记下末尾 `ℹ tests` 后面的数字 N。

**验证**：末尾为 `ℹ fail 0`。

### 第 2 步：在 `domain.js` 中新增 `planRecordDefaults`

在 `planPresets` 函数之后（第 290 行的 `}` 之后、`function normalizePlan` 之前）插入：

```js
// A new record that completes `plan` starts like the last completion of that plan. With none yet, insurance and
// inspection plans default to other expenses (DESIGN.md files them there) and everything else to maintenance.
function planRecordDefaults(plan, records) {
  const last = records
    .filter(r => r.planId === plan.id && r.complete && PLAN_KINDS.includes(r.kind))
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id.localeCompare(a.id))[0];
  if (last) return { kind: last.kind, category: last.kind === 'other' ? last.category || '其他' : '其他' };
  const category = /险/.test(plan.name) ? '保险' : /年检|年审/.test(plan.name) ? '年检' : '';
  return category ? { kind: 'other', category } : { kind: 'service', category: '其他' };
}
```

然后在文件末尾的 `module.exports` 中，`planPresets,` 的下一行加入 `planRecordDefaults,`。

**验证**：`node -e "const D=require('./miniprogram/utils/domain');console.log(JSON.stringify(D.planRecordDefaults({id:'p',name:'车险续期'},[])))"` → `{"kind":"other","category":"保险"}`

### 第 3 步：记账页改用新函数

把 `entry/index.js` 第 68–74 行（以 `else if (plan)` 开头、包含 `category: /险/.test(plan.name)` 的那一段）：

```js
        else if (plan)
          form = Object.assign(form, {
            planId: plan.id,
            complete: true,
            note: plan.name,
            category: /险/.test(plan.name) ? '保险' : /年检|年审/.test(plan.name) ? '年检' : '其他',
          });
```

替换为：

```js
        else if (plan)
          form = Object.assign(
            form,
            { planId: plan.id, complete: true, note: plan.name },
            U.D.planRecordDefaults(plan, s.records)
          );
```

不要改第 79 行，它会根据新的 `form.kind` 算出 `kindIndex`。

**验证**：

- `grep -c "planRecordDefaults" miniprogram/pages/entry/index.js` → `1`
- `grep -c "/险/" miniprogram/pages/entry/index.js` → `0`
- `npm test` → 末尾为 `ℹ fail 0`（现有测试在这一步应全部仍然通过）

### 第 4 步：补测试

按「测试计划」新增 1 个测试、修改 2 个测试。

**验证**：

- `node --test --test-name-pattern="完成计划的新记录" tests/domain.test.js` → `ℹ pass 1`、`ℹ fail 0`
- `npm test` → `ℹ fail 0`，`ℹ tests` 为 N+1

### 第 5 步：更新 README

在 `README.md` 中找到包含「完成车险、年检计划时自动选好类别」的那一行（提交 `5322246` 时是第 34 行），把这几个字改为「完成车险、年检计划时默认记为其他费用并选好类别（之后沿用该计划上次完成时的类型）」，同一行的其他文字不变。

**验证**：`grep -c "默认记为其他费用" README.md` → `1`

### 第 6 步：格式与收尾

运行格式检查命令；如果失败，只对那 4 个文件运行格式化命令，然后再检查一次。最后运行 `npm run check`。

**验证**：格式检查输出 `All matched files use Prettier code style!`；`npm run check` 退出码 0；`git status --short` 只列出范围内的文件。

## 测试计划

1. **`tests/domain.test.js` 新增 1 个测试**，放在以 `test('其他费用可以完成计划并计入其他费用；补能记录不能完成计划'` 开头的测试之后（提交 `5322246` 时它在第 218–239 行）。写法参考同一文件第 32–41 行：直接构造记录数组，调用纯函数，用 `assert.deepEqual` 比较。内容如下：

   ```js
   test('完成计划的新记录默认沿用该计划上次的类型；没有记录时车险、年检记为其他费用', () => {
     const plan = name => ({ id: 'p', name }),
       done = (id, date, kind, extra = {}) =>
         Object.assign({ id, vehicleId: 'v', planId: 'p', complete: true, date, mileage: 1000, kind }, extra),
       defaults = (name, records = []) => D.planRecordDefaults(plan(name), records);
     assert.deepEqual(defaults('车险续期'), { kind: 'other', category: '保险' });
     assert.deepEqual(defaults('交强险'), { kind: 'other', category: '保险' });
     assert.deepEqual(defaults('年检'), { kind: 'other', category: '年检' });
     assert.deepEqual(defaults('年审'), { kind: 'other', category: '年检' });
     assert.deepEqual(defaults('机油机滤'), { kind: 'service', category: '其他' });
     // The last completion of this plan wins over the name.
     assert.deepEqual(defaults('机油机滤', [done('a', '2025-01-01', 'other', { category: '维修' })]), {
       kind: 'other',
       category: '维修',
     });
     assert.deepEqual(defaults('车险续期', [done('a', '2025-01-01', 'service')]), { kind: 'service', category: '其他' });
     assert.deepEqual(
       defaults('车险续期', [done('a', '2024-01-01', 'service'), done('b', '2025-01-01', 'other', { category: '保险' })]),
       { kind: 'other', category: '保险' }
     );
     // Unfinished records and completions of other plans do not count.
     assert.deepEqual(
       defaults('机油机滤', [
         done('a', '2025-01-01', 'other', { complete: false }),
         done('b', '2025-01-01', 'other', { planId: 'q' }),
       ]),
       { kind: 'service', category: '其他' }
     );
   });
   ```

2. **`tests/pages.test.js` 中以 `test('首页按紧急程度显示前两条计划；完成车险计划可记为其他费用并进入养护历史'` 开头的测试**（提交 `5322246` 时在第 254–285 行）：
   - 把测试名改为 `'首页按紧急程度显示前两条计划；完成车险计划默认记为其他费用并进入养护历史'`。
   - 删除这一行（第 277 行）：`entry.pickKind({ currentTarget: { dataset: { index: 1 } } });`
   - 在原位置插入：

     ```js
     assert.equal(entry.data.form.kind, 'other');
     assert.equal(entry.data.kindIndex, 1);
     assert.equal(entry.data.form.category, '保险');
     ```

   - 后面的 `assert.equal(raw.records[0].kind, 'other');` 保持不变：它现在证明的是默认值，而不是手动切换的结果。

3. **`tests/pages.test.js` 中以 `test('其他费用可选类别；完成车险计划默认归为保险；账本标题显示类别'` 开头的测试**（提交 `5322246` 时在第 493–506 行），把其中这一行：

   ```js
   assert.equal(loadPage('entry', { vehicleId: id, planId: pid }).data.form.category, '保险');
   ```

   替换为：

   ```js
   const planEntry = loadPage('entry', { vehicleId: id, planId: pid });
   assert.equal(planEntry.data.form.kind, 'other');
   assert.equal(planEntry.data.form.category, '保险');
   ```

4. **不要改** `tests/pages.test.js` 中的 `assert.equal(entry.data.form.kind, 'service');`（提交 `5322246` 时在第 162 行，所属计划名为「机油机滤」）。它必须继续通过，证明普通保养计划仍默认记为保养。

## 完成标准

全部满足才算完成：

- [ ] `npm test` 末尾为 `ℹ fail 0`，`ℹ tests` 比第 1 步多 1
- [ ] `node --test --test-name-pattern="完成计划的新记录" tests/domain.test.js` → `ℹ pass 1`
- [ ] `node -e "const D=require('./miniprogram/utils/domain');console.log(JSON.stringify(D.planRecordDefaults({id:'p',name:'年检'},[])))"` → `{"kind":"other","category":"年检"}`
- [ ] `grep -c "planRecordDefaults" miniprogram/utils/domain.js` → `2`（定义一次，导出一次）
- [ ] `grep -c "/险/" miniprogram/pages/entry/index.js` → `0`
- [ ] `grep -c "pickKind" tests/pages.test.js` → `1`（只剩「其他费用可选类别」测试中那一处）
- [ ] `npm run check` 退出码 0；格式检查输出 `All matched files use Prettier code style!`
- [ ] `git status --short` 中没有范围之外的文件
- [ ] `plans/README.md` 中本计划的状态已更新

## 停止条件

出现以下情况时停止并报告，不要自行变通：

- `entry/index.js` 的 `onLoad`（第 41–86 行）或 `domain.js` 第 8–9、322–326 行与「现状」中的摘录不一致（计划 003 对 `save()` / `commit()` 的修改不算）。
- `domain.js` 中已经存在名为 `planRecordDefaults` 的函数。
- 第 3 步之后，除「测试计划」第 2、3 条提到的两个测试之外，还有其他测试失败。
- 你认为必须修改 WXML、`normalizeRecord` 或数据存储结构才能完成。

## 维护说明

- 判断「保险 / 年检」的正则与计划模板的名称有关（`PLAN_PRESETS` 中的「车险续期」「年检」）。以后改模板名称时，要同步检查这个正则。
- 审查重点：编辑已有记录时类型不会被改（第 63–67 行的分支没有动）；新的默认值只影响从计划进入的新记录。
- 暂不处理：车船税、ETC 等更多名称。用户第一次把这类计划记成「其他费用」后，之后会自动沿用。
