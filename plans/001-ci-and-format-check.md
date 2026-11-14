# 计划 001：每次推送和 PR 都自动运行测试、项目检查与格式检查

> **执行说明**：按步骤顺序执行。每一步都要运行「验证」里的命令，确认结果与预期一致后才能进入下一步。出现「停止条件」中的任何一种情况，立即停下并报告，不要自行变通。完成后，更新 `plans/README.md` 中本计划那一行的状态（如果派你来的审查者说明由他维护索引，则不用改）。
>
> **漂移检查（最先运行）**：`git diff --stat 5322246..HEAD -- .prettierrc.json package.json README.md .github`
> 如果有输出，说明这些文件在计划写成后被改过：先把下文「现状」里的摘录与实际文件逐一对照，任何不一致都按停止条件处理。

## 状态

- **优先级**：P1
- **工作量**：S（约 30 分钟）
- **风险**：LOW
- **依赖**：无
- **类别**：tests（建立自动验证）、dx
- **计划基于**：提交 `5322246`，2026-11-13
- **对应**：2026-11-13 `/improve quick` 体检第 2 条
- **版本**：V1

## 为什么要做

这个仓库是微信小程序「车小记」，有 58 个 Node 测试和一个项目检查脚本，但没有任何持续集成（CI）：已合并的 6 个 PR 都只靠人在本机手动跑测试。之后的改动大多由 AI 完成，没有自动把关，回归很容易进入 `main`。另外，格式检查在仓库所有者的 Windows 电脑上必然失败：git 设置了 `core.autocrlf=true`，拉取后被更新的文件会以 CRLF 换行检出，而 `.prettierrc.json` 要求 LF。完成后，每次推送到 `main` 或开 PR，GitHub 都会自动运行三项检查，失败时 PR 上直接标红；格式检查在 Windows 和 Linux 上都能通过。这个仓库是公开的，GitHub 托管的标准运行器对公开仓库免费（官方计费说明：https://docs.github.com/en/billing/concepts/product-billing/github-actions ，2026-11-13 查阅）。

## 现状

- 仓库结构：`miniprogram/`（小程序源码：JS / WXML / WXSS，无第三方运行依赖）、`tests/`（`node:test` 测试）、`scripts/`（`check.js` 项目检查，`tabbar-icons.js` 生成底部标签图标）。没有 `package-lock.json`，也不需要 `npm install`。
- 没有 `.github/` 目录：`ls .github` 输出 `No such file or directory`。
- `package.json` 全文（提交 `5322246`）：

  ```json
  {
    "name": "car-miniapp",
    "version": "1.0.0",
    "private": true,
    "description": "车小记原生微信小程序",
    "scripts": {
      "test": "node --test tests/*.test.js",
      "check": "node scripts/check.js",
      "format": "npx --yes prettier@3.9.10 --write \"miniprogram/**/*.{js,wxss}\" scripts tests"
    }
  }
  ```

- `.prettierrc.json` 全文，要改的是第 6 行：

  ```json
  {
    "printWidth": 120,
    "singleQuote": true,
    "trailingComma": "es5",
    "arrowParens": "avoid",
    "endOfLine": "lf",
    "overrides": [{ "files": "*.wxss", "options": { "parser": "css" } }]
  }
  ```

- 在提交 `5322246`、仓库所有者的 Windows 电脑上运行 `npx --yes prettier@3.9.10 --check "miniprogram/**/*.{js,wxss}" scripts tests`，会报告 9 个文件格式不符（`miniprogram/pages/garage/index.js`、`miniprogram/pages/vehicle/index.js`、`miniprogram/utils/backup.js`、`miniprogram/utils/csv.js`、`miniprogram/utils/store.js`、`miniprogram/utils/ui.js`、`scripts/check.js`、`tests/domain.test.js`、`tests/pages.test.js`）。这 9 个文件内容没有问题，只是以 CRLF 换行检出（`git config core.autocrlf` 输出 `true`）；仓库里提交的内容是 LF。加上 `--end-of-line auto` 后，同一条检查会输出 `All matched files use Prettier code style!`。
- `README.md` 第 12–25 行，是要更新的验证说明：

  ~~~text
  本地逻辑验证（需要支持 `node:test` 的 Node.js）：

  ```powershell
  npm test
  npm run check
  ```

  无需执行 npm install 或构建 npm。

  格式化 JS 与 WXSS（配置见 `.prettierrc.json`；首次运行会通过 npx 下载 Prettier 3.9.10，WXML 保持手写格式）：

  ```powershell
  npm run format
  ```
  ~~~

- 提交信息风格（`git log --format=%s`）：约定式前缀加英文小写描述，例如 `chore: check only template imports in the check script`、`feat: delete vehicles and export records as CSV`；正文分条说明改了什么、为什么改。
- 仓库所有者本机的 Node 版本是 v24.15.0。

### 已经做出的决定（不要改）

- **`endOfLine` 改为 `"auto"`**：Prettier 官方说明 `"auto"` 会保留文件现有的换行（https://prettier.io/docs/options#end-of-line ，2026-11-13 查阅）。由于 `core.autocrlf=true`，git 提交时仍会转成 LF，仓库内容不受影响。
- **不加 `.gitattributes`**：Prettier 官方的另一种做法是在 `.gitattributes` 中写 `* text=auto eol=lf`，但官方也提到之后可能需要 Windows 用户重新克隆仓库，成本更高，本计划不采用。
- **CI 使用 `actions/checkout@v7` 和 `actions/setup-node@v7`**：这是 2026-11-13 查到的最新主版本（checkout v7.0.1 发布于 2026-07-20，setup-node v7.1.0 发布于 2026-10-08）。setup-node 只在 `package.json` 设置了 `packageManager` 字段时才自动开启 npm 缓存（https://github.com/actions/setup-node ，2026-11-13 查阅）。本仓库没有 lockfile，因此显式设置 `package-manager-cache: false`，避免以后加了该字段反而因为找不到 lockfile 而失败。
- **Node 24**：与仓库所有者本机一致。

## 需要用到的命令

| 用途 | 命令 | 成功时的结果 |
|------|------|--------------|
| 测试 | `npm test` | 末尾有 `ℹ fail 0` |
| 项目检查 | `npm run check` | 输出一行以 `Checked` 开头的说明，退出码 0 |
| 格式检查（本计划新增） | `npm run format:check` | 最后一行 `All matched files use Prettier code style!` |
| 查看 PR 的检查结果（仅在允许推送时） | `gh pr checks <PR 编号>` | `verify` 那一行显示 `pass` |

`npm run format:check` 首次运行会通过 npx 从 npm 官方源下载 Prettier 3.9.10，需要能联网。

## 范围

**可以修改**（只改这些）：

- `.github/workflows/ci.yml`（新建）
- `.prettierrc.json`（只改 `endOfLine` 这一行）
- `package.json`（只新增 `format:check` 脚本）
- `README.md`（只替换第 12–19 行这一段）
- `plans/README.md`（只更新本计划的状态行）

**不要修改**：

- `miniprogram/`、`tests/`、`scripts/` 下的任何文件：本计划只建立检查，不修代码。
- 不要运行 `npm run format`（它会重写文件）；不要加 `.gitattributes`；不要安装依赖，也不要生成 `package-lock.json`；不要在 CI 中开启缓存。

## Git 流程

- 分支名：`ci-and-format-check`（仓库现有分支用英文短横线命名，例如 `delete-vehicle-and-csv`）。
- 一个提交即可，示例：`ci: run tests, project check and format check on every push and PR`，正文说明三项检查，以及修改 `endOfLine` 的原因。
- 没有得到操作者明确允许时，不要推送，也不要开 PR。

## 步骤

### 第 1 步：确认起点正常

运行 `npm test` 和 `npm run check`。

**验证**：`npm test` 末尾为 `ℹ fail 0`；`npm run check` 输出以 `Checked` 开头。

### 第 2 步：让格式检查保留现有换行

把 `.prettierrc.json` 第 6 行 `"endOfLine": "lf",` 改为 `"endOfLine": "auto",`，其他行不动。

**验证**：`npx --yes prettier@3.9.10 --check "miniprogram/**/*.{js,wxss}" scripts tests` → 最后一行为 `All matched files use Prettier code style!`，退出码 0。

### 第 3 步：新增 `format:check` 脚本

在 `package.json` 的 `scripts` 中，紧跟 `"format"` 那一行之后加入下面这一行，并给 `"format"` 那一行末尾补上逗号：

```json
"format:check": "npx --yes prettier@3.9.10 --check \"miniprogram/**/*.{js,wxss}\" scripts tests"
```

匹配范围必须与 `format` 完全相同。缩进与文件现有写法一致（2 个空格）。

**验证**：

- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('json ok')"` → `json ok`
- `npm run format:check` → 最后一行为 `All matched files use Prettier code style!`

### 第 4 步：新建 `.github/workflows/ci.yml`

完整内容如下，逐字复制（2 个空格缩进，不能有 Tab）：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          package-manager-cache: false
      - name: Tests
        run: npm test
      - name: Project check
        run: npm run check
      - name: Format check
        run: npm run format:check
```

**验证**：`node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(s.includes('\t'))throw Error('tab found');console.log('no tabs')"` → `no tabs`

### 第 5 步：更新 README 的验证说明

把 `README.md` 第 12–19 行（从「本地逻辑验证」到「无需执行 npm install 或构建 npm。」）替换为下面这段；第 21–25 行的「格式化 JS 与 WXSS」段落保持不变：

~~~text
本地逻辑验证（需要支持 `node:test` 的 Node.js）：

```powershell
npm test
npm run check
npm run format:check
```

无需执行 npm install 或构建 npm。`npm run format:check` 首次运行会通过 npx 下载 Prettier 3.9.10。

每次推送到 `main` 或开 PR 时，GitHub Actions 会自动运行以上三项检查（配置见 `.github/workflows/ci.yml`）；任何一项失败，PR 上会显示未通过。
~~~

**验证**：

- `grep -c "format:check" README.md` → 不小于 `1`
- `grep -c "GitHub Actions" README.md` → 不小于 `1`

### 第 6 步：完整本地检查

依次运行 `npm test`、`npm run check`、`npm run format:check`。

**验证**：三条命令的退出码都是 0，结果与「需要用到的命令」表一致；`git status --short` 只列出范围内的文件：`.github/`（新建）、`.prettierrc.json`、`package.json`、`README.md`，以及（若已更新状态）`plans/README.md`。

### 第 7 步（仅在操作者允许推送时）：在 GitHub 上确认

提交、推送分支并开 PR 后，运行 `gh pr checks <PR 编号> --watch`。

**验证**：`verify` 那一行最终显示 `pass`。没有获准推送时跳过本步，并在报告中写明「CI 尚未在 GitHub 上运行过」。

## 测试计划

本计划不新增测试，而是让现有的 58 个测试、项目检查和格式检查在每次推送和 PR 时自动运行。验证方式见第 6、7 步。

## 完成标准

全部满足才算完成：

- [ ] `.github/workflows/ci.yml` 存在，内容与第 4 步一致
- [ ] `grep -c '"endOfLine": "auto"' .prettierrc.json` → `1`
- [ ] `npm test` 末尾为 `ℹ fail 0`；`npm run check` 退出码 0；`npm run format:check` 输出 `All matched files use Prettier code style!`
- [ ] `git status --short` 中没有范围之外的文件
- [ ] （获准推送时）`gh pr checks` 显示 `verify` 为 `pass`
- [ ] `plans/README.md` 中本计划的状态已更新

## 停止条件

出现以下情况时停止并报告，不要自行变通：

- 第 1 步的测试或检查在你改动之前就失败。
- `npx` 下载 Prettier 失败（网络或代理问题）：不要换用别的格式化工具，也不要把 Prettier 装进项目，直接报告。
- 第 2 步之后格式检查仍报告文件不符：说明存在真正的格式问题，不在本计划范围内。不要运行 `npm run format`，列出文件名后报告。
- GitHub 上 CI 失败，而错误不是某个测试失败（例如找不到 `actions/checkout@v7`、Node 24 不可用）：不要猜测着改版本号，把完整错误信息报告回来。
- 需要修改范围之外的文件才能让检查通过。

## 维护说明

- 以后新增源码目录或测试文件时，`format` 和 `format:check` 两个脚本的匹配范围要一起改。
- 想让 CI 不通过的 PR 无法合并，需要在仓库设置里为 `main` 开启分支保护，并要求 `verify` 通过。这是仓库所有者的设置，不在本计划内。
- Actions 的主版本以后会过时，可以再加 Dependabot 提醒升级，不在本计划内。
- 如果以后改用 `.gitattributes` 统一 LF，应把 `endOfLine` 改回 `"lf"`。
