# 计划 003：「请核对」弹窗路径下，连点保存也只记一笔

> **执行说明**：按步骤顺序执行。每一步都要运行「验证」里的命令，确认结果与预期一致后才能进入下一步。出现「停止条件」中的任何一种情况，立即停下并报告，不要自行变通。完成后，更新 `plans/README.md` 中本计划那一行的状态（如果派你来的审查者说明由他维护索引，则不用改）。
>
> **漂移检查（最先运行）**：`git diff --stat 5322246..HEAD -- miniprogram/pages/entry/index.js tests/pages.test.js`
> 如果计划 002 已经合并，这两个文件会有改动，这是预期的：002 只改 `onLoad` 中的 `else if (plan)` 分支和两个现有页面测试。本计划只要求下文 `save()` / `commit()` 的摘录与实际代码一致，不一致就按停止条件处理。下文的行号以提交 `5322246` 为准；如果行号有偏移，用给出的原文搜索定位。

## 状态

- **优先级**：P2
- **工作量**：S（约 30 分钟）
- **风险**：LOW
- **依赖**：无硬性依赖。与计划 002 修改同一个文件，二者必须先后执行，不能同时进行；建议在 002 之后执行。
- **类别**：bug
- **计划基于**：提交 `5322246`，2026-11-13
- **对应**：2026-11-13 `/improve quick` 体检第 3 条
- **版本**：V1

## 为什么要做

「车小记」的记一笔页在保存前会做一次「疑似录错」检查（里程突增、油量过大、单价异常），有疑点时弹出「请核对」窗口，用户点「仍要保存」才写入。`save()` 只靠 `saving` 防重复，而 `saving` 要到 `commit()` 里才会置为真；弹窗期间没有任何标记，`commit()` 本身也不检查。如果用户在弹窗出现之前连点两次保存，会调用两次 `wx.showModal`；两个弹窗都确认后，同一笔记录会写入两次。在弹窗排队等待回答的模拟环境里已经复现：出现 2 个弹窗，写入 2 条记录。产品设计要求重复提交不能产生重复数据（`DESIGN.md` 第 102 行：「保存失败保留输入，重复提交使用幂等键。」）。微信里快速连点是否真的会弹出两个窗口，还没有在真机上确认，但这个修复在任何情况下都无害。完成后：同一时间最多只有一个核对弹窗，`commit()` 被重复调用也只会写入一次。

## 现状

### `miniprogram/pages/entry/index.js` 第 110–141 行

```js
    // Likely typos get a confirmation rather than a block; validation errors are shown next to their field.
    save() {
      if (this.data.saving || !this.data.ready) return;
      U.guard(
        this,
        () => {
          const s = U.getStore().read(),
            v = s.vehicles.find(x => x.id === this.data.form.vehicleId),
            warnings = U.D.recordWarnings(
              U.D.normalizeRecord(Object.assign({}, this.data.form, { id: this.data.form.id || '' }), v),
              v,
              s.records
            );
          if (!warnings.length) return this.commit();
          wx.showModal({
            title: '请核对',
            content: warnings.join('；') + '。确认无误再保存。',
            confirmText: '仍要保存',
            success: r => {
              if (r.confirm) this.commit();
            },
          });
        },
        FIELDS
      );
    },
    commit() {
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveRecord(this.data.form), FIELDS);
      if (id) U.saved();
      else this.setData({ saving: false });
    },
```

- `U` 是 `require('../../utils/ui')`。`U.guard(page, fn, labels)` 运行 `fn`，出错时把错误显示在页面上，并返回 `undefined`。`U.saved()` 弹出「已保存」提示并返回上一页。
- 没有核对提示时，`save()` 直接调用 `commit()`，后者同步把 `saving` 置为真，第二次点击会在 `save()` 第一行被拦下，所以这条路径本来就没问题。有问题的只是弹窗路径。
- 其他页面（`vehicle/index.js`、`plan/index.js`）的 `save()` 在调用存储之前就设置了 `saving: true`，也没有核对弹窗，不需要改。
- 新增的 `this.confirming` 是页面实例上的普通属性。小程序页面允许在 `this` 上挂自定义属性；它不参与渲染，所以不放进 `data`。

### 页面测试的模拟环境（`tests/pages.test.js`）

- 第 39–42 行：每个测试开始前，`wx.showModal` 被模拟为立即用变量 `answer` 回调 `success`：

  ```js
      showModal: o => {
        modals.push(o.content || o.placeholderText);
        o.success(answer);
      },
  ```

  这个模拟**只调用 `success`，不调用 `complete`**。所以下文把 `confirming` 的复位放在 `success` 和 `fail` 中，而不是放在 `complete`。

- 单个测试可以临时替换 `wx` 上的方法（每个测试开始前 `beforeEach` 会重建 `global.wx`）。范例在第 307 行：

  ```js
  wx.chooseMessageFile = o => o.success({ tempFiles: [{ path: shared[0].filePath }] });
  ```

- `createCar(type)`（第 93–99 行）建一辆车：基准读数为 2025-01-01、1000 km。新记录的里程填 `12000` 会触发「多出 11000 km」的核对提示。
- 现有测试 `test('疑似录错时先确认：取消不保存，确认后保存'`（第 378–396 行）要求「取消之后还能再次保存」。修复后它必须继续通过。

## 需要用到的命令

| 用途 | 命令 | 成功时的结果 |
|------|------|--------------|
| 全部测试 | `npm test` | 末尾有 `ℹ fail 0` |
| 只跑新测试 | `node --test --test-name-pattern="核对弹窗出现前连点两次保存" tests/pages.test.js` | `ℹ tests 1`、`ℹ pass 1`、`ℹ fail 0` |
| 只跑原有的核对测试 | `node --test --test-name-pattern="疑似录错时先确认" tests/pages.test.js` | `ℹ pass 1` |
| 项目检查 | `npm run check` | 输出一行以 `Checked` 开头的说明，退出码 0 |
| 格式检查 | `npx --yes prettier@3.9.10 --check --end-of-line auto miniprogram/pages/entry/index.js tests/pages.test.js` | `All matched files use Prettier code style!` |
| 格式化（仅在格式检查失败时使用） | `npx --yes prettier@3.9.10 --write --end-of-line auto miniprogram/pages/entry/index.js tests/pages.test.js` | 列出 2 个文件，退出码 0 |

`--end-of-line auto` 让格式检查在 Windows（以 CRLF 检出）和 Linux 上结果一致。如果计划 001 已经完成，也可以直接用 `npm run format:check`。

## 范围

**可以修改**（只改这些）：

- `miniprogram/pages/entry/index.js`：只改 `save()` 和 `commit()`
- `tests/pages.test.js`：新增 1 个测试
- `plans/README.md`：只更新本计划的状态行

**不要修改**：

- `entry/index.js` 的 `onLoad`（计划 002 负责）。
- `miniprogram/utils/ui.js` 的 `guard` / `saved`，以及 `miniprogram/utils/store.js`：`DESIGN.md` 中的「幂等键」是存储层方案，不在本计划内。
- 其他页面和所有 WXML 文件。

## Git 流程

- 分支名：`entry-single-save`。
- 提交示例：`fix: save a record once even when the confirmation dialog is triggered twice`。
- 没有得到操作者明确允许时，不要推送，也不要开 PR。

## 步骤

### 第 1 步：确认起点

运行 `npm test`，记下末尾 `ℹ tests` 后面的数字 N。

**验证**：末尾为 `ℹ fail 0`。

### 第 2 步：先写一个会失败的测试

在 `tests/pages.test.js` 中，以 `test('疑似录错时先确认：取消不保存，确认后保存'` 开头的测试结束处（它的 `});`，提交 `5322246` 时在第 396 行）之后插入：

```js
test('核对弹窗出现前连点两次保存，只弹一次、只记一笔；取消后可以再次保存', () => {
  const id = createCar('fuel'),
    entry = loadPage('entry', { vehicleId: id }),
    queued = [];
  // Dialogs wait for an answer instead of answering at once, like a user tapping twice before the first one shows.
  wx.showModal = o => queued.push(o);
  entry.setData({
    'form.date': '2025-01-02',
    'form.mileage': '12000',
    'form.amount': '300',
    'form.quantity': '40',
    'form.full': true,
  });
  entry.save();
  entry.save();
  assert.equal(queued.length, 1);
  queued[0].success({ confirm: false });
  assert.equal(raw.records.length, 0);
  entry.save();
  assert.equal(queued.length, 2);
  queued[1].success({ confirm: true });
  assert.equal(raw.records.length, 1);
  entry.commit();
  assert.equal(raw.records.length, 1);
});
```

**验证**：`node --test --test-name-pattern="核对弹窗出现前连点两次保存" tests/pages.test.js` → `ℹ fail 1`（修复之前必须失败，失败信息是 `2 !== 1` 之类，对应 `assert.equal(queued.length, 1)` 那一行）。如果这一步没有失败，按停止条件处理。

### 第 3 步：修改 `save()` 和 `commit()`

把「现状」一节中摘录的第 110–141 行整段替换为：

```js
    // Likely typos get a confirmation rather than a block; validation errors are shown next to their field.
    save() {
      if (this.data.saving || this.confirming || !this.data.ready) return;
      U.guard(
        this,
        () => {
          const s = U.getStore().read(),
            v = s.vehicles.find(x => x.id === this.data.form.vehicleId),
            warnings = U.D.recordWarnings(
              U.D.normalizeRecord(Object.assign({}, this.data.form, { id: this.data.form.id || '' }), v),
              v,
              s.records
            );
          if (!warnings.length) return this.commit();
          // One confirmation at a time: a second tap before the dialog shows must not open another one.
          this.confirming = true;
          wx.showModal({
            title: '请核对',
            content: warnings.join('；') + '。确认无误再保存。',
            confirmText: '仍要保存',
            success: r => {
              this.confirming = false;
              if (r.confirm) this.commit();
            },
            fail: () => {
              this.confirming = false;
            },
          });
        },
        FIELDS
      );
    },
    // Saving twice must not write twice, whichever path calls this.
    commit() {
      if (this.data.saving) return;
      this.setData({ saving: true });
      const id = U.guard(this, () => U.getStore().saveRecord(this.data.form), FIELDS);
      if (id) U.saved();
      else this.setData({ saving: false });
    },
```

**验证**：

- `node --test --test-name-pattern="核对弹窗出现前连点两次保存" tests/pages.test.js` → `ℹ pass 1`、`ℹ fail 0`
- `node --test --test-name-pattern="疑似录错时先确认" tests/pages.test.js` → `ℹ pass 1`
- `npm test` → 末尾为 `ℹ fail 0`，`ℹ tests` 为 N+1

### 第 4 步：格式与收尾

运行格式检查命令；如果失败，只对那 2 个文件运行格式化命令，然后再检查一次。最后运行 `npm run check`。

**验证**：格式检查输出 `All matched files use Prettier code style!`；`npm run check` 退出码 0；`git status --short` 只列出范围内的文件。

## 测试计划

- 新增 1 个页面测试（第 2 步），写法沿用同一文件中「疑似录错时先确认」的测试：用 `createCar` 建车，`loadPage` 打开页面，`setData` 填表，并按第 307 行的写法在测试内临时替换 `wx.showModal`，让弹窗排队等待回答。它覆盖：
  1. 弹窗出现前连点两次保存，只弹出一个窗口；
  2. 取消后不写入，并且可以再次保存、再次弹窗；
  3. 确认后只写入一条；
  4. 保存完成后再次调用 `commit()`，不会多写。
- 原有的「疑似录错时先确认」测试必须继续通过，证明取消后标记会复位。
- 验证：`npm test` → `ℹ fail 0`，测试数比开始时多 1。

## 完成标准

全部满足才算完成：

- [ ] `npm test` 末尾为 `ℹ fail 0`，`ℹ tests` 比第 1 步多 1
- [ ] `node --test --test-name-pattern="核对弹窗出现前连点两次保存" tests/pages.test.js` → `ℹ pass 1`
- [ ] `grep -c "this.confirming" miniprogram/pages/entry/index.js` → `4`
- [ ] `grep -c "if (this.data.saving) return;" miniprogram/pages/entry/index.js` → `1`
- [ ] `npm run check` 退出码 0；格式检查输出 `All matched files use Prettier code style!`
- [ ] `git status --short` 中没有范围之外的文件
- [ ] `plans/README.md` 中本计划的状态已更新
- [ ] （可选，由仓库所有者在真机上做）输入一个比上次多 3000 km 以上的里程，快速连点两次「保存记录」：只出现一个「请核对」，确认后账本只多一笔。

## 停止条件

出现以下情况时停止并报告，不要自行变通：

- `save()` / `commit()` 与「现状」中的摘录不一致，例如已经有人加过防重复的判断。
- 第 2 步的新测试在修复之前没有失败：说明实际行为与本计划的前提不同。
- 修复之后，原有的「疑似录错时先确认」测试失败。
- 你认为必须修改 `ui.js`、`store.js` 或 WXML 才能完成。

## 维护说明

- 以后如果在 `commit()` 之前再加入别的异步步骤（另一个弹窗、异步校验等），也必须设置并复位 `this.confirming`，否则重复提交会再次出现。
- 审查重点：弹窗的每一种结束方式（确认、取消、调用失败）都会把 `confirming` 复位。
- 暂不处理：`DESIGN.md` 中存储层的「幂等键」能为所有页面防重复，但需要在记录里新增字段，属于更大的改动，以后再议。
