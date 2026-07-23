# Five 产品需求文档（PRD）

> 版本：V2.2（H5 + 微信小程序公共穿搭 MVP）
> 日期：2026-07-23
> 首发形态：移动端 H5 与微信小程序，均纳入 P0 公开测试范围
> 当前开发范围：公共每日五行、穿搭方案、每日模特、分享、设置与帮助、运营后台
> 后续开发范围：我的颜色、收藏、账户、主动提醒、场景筛选与增长分析
> 后续预研范围：出生年月日时、八字个性化、生肖、低风险宜忌
> 文档状态：可进入技术设计、任务拆分和并行开发；标为“待确认”的业务规则不得由研发自行假设
> 本次修订：补齐 `/today` 缓存语义、F02 负向档交互、P0 唯一首页方向、历史入口边界、图片来源与 AI 标识要求

[[PAGEBREAK]]

# 0. 文档控制与优先级

| 标识 | 含义 |
|---|---|
| P0 | MVP 必须完成，缺失则不能公开测试 |
| P1 | MVP 稳定后进入 V1.0，验证交互和留存价值 |
| P2 | V1.5 个人五行预研与验证 |
| P3 | V2.0 及以后，需重新评审 |
| 已确认 | 可以进入设计和开发 |
| 待确认 | 只记录产品方向，不允许研发自行实现 |

## 0.1 产品范围摘要

### 当前开发

- H5 与微信小程序公共体验，共用服务端数据与内容版本；
- 今日日期、日干支、当日五行；
- 首页颜色决策摘要；
- 完整五档；
- 单色/双色/三色穿搭；
- 每日模特穿搭与方案详情；
- 推算依据；
- 分享摘要和日签海报；
- 内容审核、版本、海报与数据后台。

### 下一阶段

- 我的颜色；
- 场景与人群筛选；
- 收藏、账户、主动提醒和未来 1 天；
- 每日穿搭小课堂。

### 后续预研

- 出生年月日时；
- 个人五行/八字；
- 个人今日调整；
- 家人档案、生肖、未来 7 天与低风险宜忌。

## 0.2 首发渠道与职责边界（已确认）

### H5

H5 是公共内容的通用访问和传播落地端，主要承担：

- 用户无需安装、无需登录即可查看今日公共内容；
- 承接微信群、公众号、二维码、复制链接和外部渠道访问；
- 提供今日摘要、完整五档、搭配、模特详情、推算依据和海报；
- P0 不承诺稳定的系统级每日通知；
- P0 不承诺与微信小程序同步本地设置和浏览状态。

### 微信小程序

微信小程序是微信内完整使用端和后续留存承载端，主要承担：

- 提供与 H5 一致的公共核心内容；
- 使用微信原生分享路径传播今日摘要和搭配内容；
- 在 P1 接入用户主动授权后的收藏、账户和提醒能力；
- 不得在用户看到公共核心内容前要求登录或授权。

### 共同原则

- H5 与微信小程序使用同一服务端业务数据、审核结果和 `contentVersion`；
- 日柱、五行、五档和颜色归类不得由两个客户端各自实现一套计算逻辑；
- 两端功能语义、业务结果、档位顺序和内容版本一致；
- 两端导航、分享、保存图片和权限申请可根据渠道能力分别实现；
- 双端一致指业务结果一致，不要求页面像素级一致；
- App 不进入本轮范围；两端可分批灰度，但都必须通过 P0 验收。

## 0.3 V2.2 评审修订摘要

- `/today` 的请求上下文定义为“当前缓存表示生成时的服务端解析结果”，不再把缓存正文中的时间字段解释为每次请求的实时服务器时钟；
- F02 仅大吉、次吉、平三档提供“查看穿法”动作，较差与不利档不显示无目标箭头；
- P0 首页采用唯一的“决策优先”结构，不使用底部 Tab、出生信息入口或历史浏览入口；
- `/daily/{fortuneDate}` 用于分享落地和既有历史链接解析，不代表 P0 提供历史列表或昨日入口；
- 图片数据模型同时支持授权素材与 AI 生成素材；P0 不要求内置图像生成平台，但正式内容必须记录来源、权利与 AI 标识状态。

# 1. 产品目标与验收目标

## 1.1 产品目标

1. 用户打开后在 10 秒内知道今天优先、稳妥和建议减少的颜色。
2. 用户无需理解复杂五行理论，即可得到一套能照着穿的搭配。
3. 每日内容能够自动计算、生成、审核、发布和回滚。
4. 分享内容离开当前页面或当前渠道后仍可独立看懂，并能够带回 H5 或微信小程序。
5. 为后续个人五行建立清晰的数据、时间和隐私边界。

## 1.2 MVP 成功标准

- 首次可见核心结果时间不超过 2 秒（有可用缓存时）；
- 目标用户中至少 90% 能在 10 秒内找到优先色和建议减少色；
- 国家标准锚点与固定版本离线库完成连续 366 个命理日的机器比对且零差异；业务老师书面复核不少于连续 30 日及边界样本；
- H5、小程序、公共 API 和后台活跃指针使用同一内容版本；海报实例记录相同的 `sourceContentVersion`；
- 23:00 跨日切换和异常降级通过边界测试；
- 模特图中的主要颜色与当日搭配结构一致；
- 内容可在后台一键撤回或回滚，已外发内容保留来源版本并将入口码导向当前安全版本。

# 2. 用户角色与状态

## 2.1 用户角色

| 角色 | 能力 |
|---|---|
| 游客 | 查看全部公共日运、搭配、模特、依据和分享 |
| 注册用户（P1） | 收藏、提醒、同步“我的颜色”与历史 |
| 会员（后续） | 个人五行、未来日历、家人档案和更多方案 |
| 运营编辑 | 生成和编辑草稿、提交审核、查看自己相关记录 |
| 运营审核 | 审核文案、搭配、图片、版权和海报一致性 |
| 业务老师 | 核对算法结果与关键内容，进行最终业务审核 |
| 发布人 | 排期、发布、撤回、回滚和查看发布审计 |
| 管理员 | 用户、权限、渠道、系统配置和紧急撤回 |

## 2.2 使用原则

- 游客在看到公共核心价值前不得被登录墙阻断；
- 出生信息只在用户主动进入个人五行功能时收集；
- 模特图片、生肖和未来会员入口不得遮挡今日免费结果；
- 对低视力或中年用户，核心色名必须同时有文字和色块。

# 3. 信息架构

## 3.1 P0 信息架构

P0 不设置内容不足的空壳“我的”Tab。两端均以“今日”为唯一首要入口：

1. 今日首页；
2. 完整五档；
3. 今日怎么搭；
4. 搭配方案详情；
5. 推算依据；
6. 分享与海报；
7. 设置与帮助。

“完整五档”“今日怎么搭”“推算依据”和“分享”均从今日首页进入；“设置与帮助”放在页面右上角或更多菜单中。H5 与微信小程序可采用不同导航样式，但页面层级和返回关系必须保持一致。

P0 不提供“历史”“昨日”或日历浏览入口。公开的 `/daily/{fortuneDate}` 路由只用于分享落地、已外发海报和既有日期链接解析，不得据此在 P0 增加历史列表、日历或右上角历史图标。

## 3.2 P1 信息架构

P1 上线账户、收藏和我的颜色后，再评估固定导航：

- 今日；
- 搭配；
- 我的。

“我的”包含我的颜色、收藏、提醒、账户与隐私、设置与帮助。

## 3.3 后续导航候选

个人五行上线后再评估“我的五行”和“日历”。生肖不占用 P0/P1 主导航。AI 问事只有在独立立项和安全评审后才允许新增入口。

# 4. 全局业务规则

## 4.1 命理换日（已确认）

> **命理日于 23:00 切换。23:00 至次日 01:00 为子时，23:00 即进入次一命理日。**

系统必须保留：

- 民用日期时间 `civilDateTime`；
- 命理业务日期 `fortuneDate`；
- 时辰 `shichen`；
- 时区 `timezone`；
- 换日配置 `dayBoundary = 23:00`。

### 页面展示

- 00:00 至 22:59：正常显示当前民用日期对应的命理日；
- 23:00 至 23:59：显示次一命理日内容，并常驻提示“已进入次日子时”；
- 分享海报应使用 `fortuneDate`，必要时在页面中说明与当前手机日期的差异；
- P0 的内容生效、缓存失效和页面内跨日均以 23:00 为边界；P1 主动提醒的发送时间单独配置。

## 4.2 十二时辰（已确认）

| 时辰 | 区间（左闭右开） | 传统称谓 |
|---|---|---|
| 子 | [23:00, 次日01:00) | 夜半、子夜、中夜 |
| 丑 | [01:00, 03:00) | 鸡鸣 |
| 寅 | [03:00, 05:00) | 平旦、黎明 |
| 卯 | [05:00, 07:00) | 日出、破晓 |
| 辰 | [07:00, 09:00) | 食时、早食 |
| 巳 | [09:00, 11:00) | 隅中 |
| 午 | [11:00, 13:00) | 日中、正午 |
| 未 | [13:00, 15:00) | 日昳 |
| 申 | [15:00, 17:00) | 哺时、夕食 |
| 酉 | [17:00, 19:00) | 日入、日落 |
| 戌 | [19:00, 21:00) | 黄昏 |
| 亥 | [21:00, 23:00) | 人定 |

## 4.3 公共五行算法（已确认）

- 输入：命理业务日期对应的日柱干支；
- 取值：只取日柱地支；
- 地支五行：寅卯木、巳午火、申酉金、亥子水、辰戌丑未土；
- 五档：大吉=我生者，次吉=同我者，平=克我者，较差=生我者，不利=我克者；
- 大模型不得计算或修正干支、地支、五行、五档和颜色归行。

## 4.4 五行颜色唯一表（已确认）

| 五行 | 颜色 |
|---|---|
| 火 | 红色、橙色、紫色、粉色系 |
| 木 | 绿色、青色、翠色、湖蓝、浅绿系 |
| 土 | 黄色、咖色、棕色、卡其、褐色系 |
| 水 | 黑色、藏青、宝蓝、墨绿、深灰系 |
| 金 | 白色、乳白、银色、金色、浅色系 |

反直觉规则：墨绿属水、湖蓝属木、宝蓝和藏青属水。前端和 AI 不得按肉眼色相重新归类。

## 4.5 日历与干支数据源（已确认）

### 核心结论

P0 不依赖外部“黄历 API”实时返回日干支。服务端按确定性规则计算并缓存结果，客户端只展示已审核结果。

依据现行国家标准 GB/T 33661-2017《农历的编算和颁行》：

- 以北京时间为标准时间；
- 公历 1949-10-01 对应的农历日为甲子日；
- 干支纪日按六十干支周循环；
- 标准中的农历日以 00:00 为边界，本产品的 23:00 换日是独立产品规则，必须先得到 `fortuneDate`，再计算该日期的标准日干支。

服务端计算顺序固定为：

```text
请求时刻 instant
  → 转换为 Asia/Shanghai 本地时间 localDateTime
  → civilDate = 本地民用日期
  → localTime >= 23:00 ? fortuneDate = civilDate + 1 天 : fortuneDate = civilDate
  → dayOffset = fortuneDate 与 1949-10-01 的公历自然日差
  → ganzhiIndex = ((dayOffset % 60) + 60) % 60
  → 按六十干支周取得 ganzhiDay
  → 取得日支、日五行、五档与颜色
```

实现约束：

- 日差按公历纯日期计算，不使用客户端本地毫秒差，避免时区和夏令时误差；
- 核心计算封装为无网络依赖的 `CalendarRuleEngine`，输入、输出和规则版本可测试；
- P0 的日干支真源是上述“国标锚点 + 公历自然日取模”规则；`lunar-javascript@1.7.7` 只作为农历展示和测试交叉校验适配器，不得成为唯一真源；必须锁定版本并保留 MIT 许可证；
- 禁止直接把宿主设备的 `Date` 交给离线库后当作权威结果；必须先显式转换为 `Asia/Shanghai` 的年月日时字段，且 `fortuneDate` 只能平移一次，不能再叠加库内的 23:00 精确日柱逻辑；
- `lunar-javascript` 或其他库不得直接覆盖本产品的 23:00 `fortuneDate` 规则；
- 后端技术栈不是 JavaScript/TypeScript 时，应实现同一 `CalendarProvider` 契约并通过同一组黄金测试，不因语言更换改变结果；
- 农历月份、农历日与节气仅用于页面展示，不参与公共五档核心计算；
- 外部日历服务只允许在离线核验或运营排错时使用，不进入在线请求的单点依赖。

验证要求：

- 基准用例：1949-10-01 = 甲子日；
- PRD 示例：2026-07-15 = 庚寅日；
- 当前验证样本：2026-07-23 = 戊戌日，2026-07-24 = 己亥日；
- 完整覆盖 22:59、23:00、23:59、00:00、00:59 和 01:00；
- 覆盖月末、年末、闰年 02-29 以及早于基准日的负偏移；
- 同一组用例分别在进程时区 UTC、America/Los_Angeles 与 Asia/Shanghai 下运行，结果必须完全一致；
- 增加性质测试：相邻日期索引必须 `+1 mod 60`，任一日期加 60 天后必须得到同一干支；
- 上线前使用国家标准基准、固定版本离线库和业务老师样本三方核验；
- 机器黄金样本至少覆盖连续 366 个 `fortuneDate`，并保留 `calendarRuleVersion` 与生成脚本版本；
- 业务老师书面复核不少于连续 30 日，并覆盖 22:59/23:00、月末、年末和闰日样本；若老师样本与标准算法冲突，必须形成规则决策并升级 `calendarRuleVersion`，不得静默改数。

资料来源：

- 国家标准全文公开系统：[GB/T 33661-2017《农历的编算和颁行》](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=E107EA4DE9725EDF819F33C60A44B296)；
- 标准解读与甲子日锚点：[中国科学院紫金山天文台《农历编算和颁行》解读](https://pmo.cas.cn/xwdt2019/kpdt2019/202203/P020240201504886119982.pdf)；
- 离线库官方仓库：[6tail/lunar-javascript](https://github.com/6tail/lunar-javascript)，V1.7.7、MIT License、无运行时第三方依赖（核验日期：2026-07-23）。
- 公农历展示数据辅助核验：[香港天文台公历与农历日期对照表](https://www.hko.gov.hk/en/gts/time/conversion.htm)；
- 时区数据维护依据：[IANA Time Zone Database](https://www.iana.org/time-zones)。

## 4.6 内容表达

- 使用：建议、宜、参考、不妨、留意、优先、稳妥、减少；
- 禁止：保证、必然、转运、暴富、破财、大凶、灾、一定有效；
- “好运、贵人、助运、加分、事半功倍、运程、吉凶”等属于 P0 高风险表达，默认不进入用户文案；确需使用时必须由运营审核逐条确认且不得构成效果承诺；
- “不利”只表示今日建议降低使用比例，不使用警报视觉和恐吓文案；
- 搭配比例属于服装搭配建议，不属于五行算法事实，应明确标注“穿搭参考”。
- O02A 必须把硬禁词、效果承诺和高风险表达分别配置；机器检查负责拦截和提示，不能替代运营审核。

# 5. 页面与功能清单

| ID | 页面/模块 | 优先级 | H5 | 微信小程序 | 说明 |
|---|---|---:|---|---|---|
| F01 | 今日首页 | P0 | 必做 | 必做 | 第一屏完成颜色决策 |
| F02 | 完整五档 | P0 | 必做 | 必做 | 查看五档颜色与一句依据 |
| F03 | 今日怎么搭 | P0 | 必做 | 必做 | 单色、双色、三色和模特方案 |
| F04 | 搭配方案详情 | P0 | 必做 | 必做 | P0 含详情和分享，不含收藏 |
| F05 | 我的颜色 | P1 | 必做 | 必做 | 游客本地使用，登录后可同步 |
| F06 | 推算依据 | P0 | 必做 | 必做 | 三步解释当日五行和五档 |
| F07 | 分享选择 | P0 | 必做 | 必做 | 根据渠道提供不同分享动作 |
| F08 | 日签海报 | P0 | 必做 | 必做 | 同内容、渠道化二维码或小程序码 |
| F09 | 主动提醒 | P1 | 能力降级 | 订阅能力 | 不属于 P0 页面内跨日切换 |
| F10A | 设置与帮助 | P0 | 必做 | 必做 | 字号、反馈、协议、清除本地数据 |
| F10B | 我的账户 | P1 | 必做 | 必做 | 收藏、账户、导出与注销 |
| F11 | 全局状态 | P0 | 必做 | 必做 | 加载、离线、错误、23:00 跨日 |
| O01 | 每日内容审核 | P0 | 后台 Web | 后台 Web | 审核、发布、撤回和回滚 |
| O02A | 基础内容与素材 | P0 | 后台 Web | 后台 Web | P0 所需颜色、模板、图片和授权 |
| O02B | 完整素材运营 | P1 | 后台 Web | 后台 Web | 选题、标签、提示词和批量管理 |
| O03 | 渠道与海报 | P0 | 后台 Web | 后台 Web | 渠道参数、海报、生成状态 |
| O04A | 运营监控 | P0 | 后台 Web | 后台 Web | 发布、错误、访问、转化和分享 |
| O04B | 增长分析 | P1 | 后台 Web | 后台 Web | 留存、收藏、用户和版本对比 |
| B01 | 出生信息录入 | P2 | 后续 | 后续 | 个人五行预研 |
| B02 | 个人五行结果 | P2 | 后续 | 后续 | 输出范围待老师确认 |
| B03 | 个人今日调整 | P2 | 后续 | 后续 | 公共与个人融合规则待确认 |

## 5.1 双端页面矩阵

| 场景 | H5 | 微信小程序 | 共同验收结果 |
|---|---|---|---|
| 打开今日 | 直接打开公开链接 | 打开首页或分享路径 | 无登录墙，结果一致 |
| 查看五档 | H5 二级页面 | 小程序二级页面 | 档位、颜色和解释一致 |
| 查看搭配 | H5 二级页面 | 小程序二级页面 | 方案 ID、图片和文案一致 |
| 分享摘要 | 系统分享可用时调用，否则复制链接 | 微信原生分享卡片 | 均带 `fortuneDate`、渠道参数和版本 |
| 保存海报 | 下载、长按或系统分享 | 用户操作后申请保存相册权限 | 海报正文使用同一版本 |
| 打开海报 | 二维码进入 H5 落地页 | 小程序码进入对应页面；图上另印可人工访问的 H5 短链接 | 两种入口分别落到正确命理日期，不承诺自动回退 |
| 设置字号 | 本地保存 | 本地保存 | 刷新或重启后仍生效 |
| 清除本地数据 | 清除本端数据 | 清除本端数据 | 明示不会清除另一端数据 |
| 反馈错误 | 提交表单 | 提交表单 | 后台记录平台、版本和日期 |
| 收藏 | P1 | P1 | P0 不显示禁用或占位入口 |
| 主动提醒 | P1，按能力展示或引导小程序 | P1，按可用订阅能力实现 | 不承诺平台不能保证的送达 |
| 账户同步 | P1 | P1 | 登录前不得影响公共内容访问 |

# 6. F01 今日首页

## 6.1 用户目标

在不滚动或轻微滚动的情况下知道：今天是什么日、优先穿什么、稳妥穿什么、哪些颜色建议减少，以及去哪里看具体穿法。

## 6.2 页面结构

1. 品牌、分享入口与“设置和帮助”更多菜单；
2. 大日期、星期、农历、日干支和“今日 X 日”；
3. “今日优先”卡：大吉五行与颜色；
4. “稳妥选择”卡：次吉五行与颜色；
5. “日常可穿”卡：平档，可在首屏下半部或展开后显示；
6. “建议减少/今日先收起”：较差与不利的紧凑摘要；
7. 今日怎么搭：单色、双色、三色缩略卡；
8. 今日模特示范：主推 1 套、备选 2 套缩略图；
9. 主按钮“查看完整五档”；
10. 次入口“看看怎么搭”“为什么这样排”；
11. 免责声明。

## 6.3 交互要求

- 色块必须同时显示色名；
- 不使用横向滚动隐藏关键颜色；
- 点击档位进入 F02 或对应详情；
- 点击搭配进入 F03；
- 点击模特缩略图进入 F04；
- 23:00 至 23:59 显示“已进入次日子时”提示；
- 有已审核本地缓存时优先展示；新内容包完整下载并校验为同一 `contentVersion` 后，原子替换整包数据。

## 6.4 验收

- 木日显示火/木/金/水/土五档顺序；
- 湖蓝显示在木，墨绿显示在水；
- 在 375px 宽度下无页面级横向滚动；
- 大字模式下核心决策仍在 1.5 屏内；
- 不利档不使用红色报警。

## 6.5 唯一首页设计基线

P0 首页采用“决策优先”结构作为唯一实现基线：

1. 首屏先展示“今日优先”“稳妥选择”“日常可穿”三张正向档位卡；
2. 较差与不利合并为紧凑的“建议减少/今日先收起”区域；
3. “今日怎么搭”和“今日模特示范”位于颜色决策区之后，分别提供单色、双色、三色缩略卡和 1 主 2 备模特入口；
4. 页面保留“查看完整五档”“看看怎么搭”“为什么这样排”三个明确入口；
5. P0 不显示底部固定 Tab、“我的”“生肖”“我的五行”、出生信息横幅、收藏、拍照试搭或历史浏览入口；
6. 现有探索原型只作为视觉参考，若与本 PRD 冲突，以本节和第 3.1 节为准。

# 7. F02 完整五档

## 7.1 页面结构

每张卡固定包含：

- 排名、档位名和用户解释名；
- 五行；
- 全部颜色；
- 一句关系解释。

动作规则：

- 大吉、次吉、平三档显示“查看穿法”箭头，进入 F03 并定位到使用该档颜色的方案；
- 较差与不利档不显示箭头，不创建空详情或禁用占位；卡内只保留一句减少使用说明；
- 页面底部统一提供“看看怎么搭”入口，进入 F03 默认方案。

建议用户解释名：

| 算法档位 | 用户解释名 |
|---|---|
| 大吉 | 今日优先 |
| 次吉 | 稳妥选择 |
| 平 | 日常可穿 |
| 较差 | 建议减少 |
| 不利 | 今日先收起 |

算法档位名必须保留，用户解释名可在业务老师确认后调整。

## 7.2 信息密度

- 五档应在约 1 至 1.5 屏内看完；
- 大吉卡可略高，其余逐步紧凑；
- 列表不承载配饰长文和多段运势；
- 颜色较多时换行，不使用横向滑动。

# 8. F03 今日怎么搭

## 8.1 页面结构

### 单色穿法

- 使用大吉色内部不同深浅；
- 展示 2 套模特或 1 套主模特 + 1 套单品板；
- 说明适用场景和可替代单品。

### 双色穿法

- 默认组合“大吉 × 次吉”；
- 可提供“大吉 × 平”作为更稳妥方案；
- 每个组合显示结构化色点、模特缩略图和场景。

### 三色穿法

- 默认穿搭参考：主色约 60%、辅助色约 30%、点缀色约 10%；
- 页面必须注明比例为穿搭参考，不是五行推算规则；
- 图片旁标注上衣、下装、鞋包/饰品对应颜色。

### 配饰替代

当用户无法换整套衣服时，提供丝巾、包、鞋、耳饰、领带、手机壳等小面积方案。

## 8.2 模特方案数量

P0 每日目标：

- 1 套主方案；
- 2 套备选；
- 至少覆盖通勤或日常休闲中的一个高频场景。

P0 内容可以携带场景和人群标签，但不提供筛选 UI；场景与人群筛选交互进入 P1。

# 9. F04 搭配方案详情

## 9.1 必要信息

- 方案标题与场景；
- 正面或全身主图；
- 1 至 2 张细节图；
- 主色、辅助色、点缀色比例；
- 上衣、下装、鞋包和配饰说明；
- 适用场景；
- 现有单品替代方案；
- P0 提供分享；收藏入口在 P1 上线前不展示；
- AI 图片标识（适用时）。

## 9.2 禁止

- 不写“提升贵人运、增强财运、保证谈判成功”等效果承诺；
- 不使用明显错误或无法制作的服装结构；
- 不使用未授权品牌 Logo 和人物肖像；
- 不允许图片颜色与文字配方不一致。

## 9.3 P1 收藏

- 用户主动点击收藏时才触发登录或账户绑定；
- 登录前可选择仅保存在本地，但必须明确“仅保存在当前设备”；
- 跨 H5 与微信小程序同步需建立统一身份后才能承诺；
- 收藏内容被撤回或图片替换后，收藏页应显示内容状态，不得继续展示已撤回内容；
- P0 页面不得保留不可点击的收藏图标或“即将上线”占位。

# 10. F05 我的颜色（P1）

## 10.1 用户流程

`进入我的颜色 → 勾选今天衣柜可用颜色 → 生成推荐 → 查看完整搭配或配饰替代`

## 10.2 输入

- 用户从固定颜色表多选；
- P1 首版不要求上传衣柜照片；
- 已登录用户可选择保存常用颜色，游客仅在本地保存。

## 10.3 输出规则

- 优先从大吉和次吉中选择；
- 可使用平档作为点缀或中性色；
- 较差和不利只提示减少，不提供恐吓文案；
- 规则无法给出完整组合时，提供配饰替代；
- 结果必须展示“为什么选择这些颜色”。

## 10.4 后续

上传衣柜照片、服装识别、自动抠图和商品匹配均不进入 P1 首版。

# 11. F06 推算依据

## 11.1 公共版本

三步展示：

1. 今日干支，例如庚寅日；
2. 取日柱地支“寅”；
3. 寅属木，因此为木日，并展示五档关系。

不得展示未参与公共算法的年柱/月柱分布，避免用户误以为它们参与当前计算。

## 11.2 五档关系

- 木生火 → 火为大吉；
- 同我为木 → 木为次吉；
- 金克木 → 金为平；
- 水生木 → 水为较差；
- 木克土 → 土为不利。

页面底部注明内容基于传统文化规则整理，仅供穿搭参考。

# 12. F07/F08 分享与海报

## 12.1 分享方式

### H5

- 调用系统分享能力（可用时）；
- 复制带渠道参数的今日链接；
- 保存或分享日签海报；
- 链接默认进入对应 `fortuneDate` 的 H5 公共落地页。

### 微信小程序

- 分享今日摘要到微信会话；
- 生成并保存日签海报；
- 分享路径进入对应 `fortuneDate` 的小程序页面；
- 小程序海报使用小程序码，并同时印出可人工访问的 H5 短链接；不承诺小程序码可以自动变成 H5 二维码。

### 共同要求

- 分享参数至少包含 `fortuneDate`、`expectedContentVersion`、`sourcePlatform`、`targetPlatform` 和 `channelId`；`platform` 仅用于表示埋点代码实际运行端；
- 分享链接和小程序路径不得携带出生信息、账户标识等敏感字段；
- 渠道参数不得改变五行、档位和搭配正文；
- 同一内容可按 `sourcePlatform + targetPlatform + channelId` 生成多个海报实例，正文与 `sourceContentVersion` 一致，只允许入口码和渠道标识不同。

## 12.2 日签海报结构

1. 大日期、月份、星期、农历和日干支；
2. 今日五行；
3. 五档完整或紧凑结果；
4. 今日搭配公式；
5. 可选的主方案钩子；每日穿搭小课堂进入 P1，P0 无内容时整块隐藏；
6. 品牌、二维码、渠道参数；
7. 免责声明和 AI 标识（适用时）。

## 12.3 海报验收

- 微信聊天缩略图中仍可识别日期和前三档；
- 二维码有足够留白；
- 分享落地页直接打开当日内容；
- 海报生成时的 `sourceContentVersion` 必须与页面内容一致；回滚后历史图片保留来源版本，入口页同时记录请求版本与实际服务版本并提示已更新；
- 不得使用来源不明的公众号或杂志图片；
- H5 海报二维码可被普通相机或微信识别并进入正确日期；
- 小程序海报码进入正确小程序页面；同张图上的 H5 短链接可独立打开正确日期，二者分别验收；
- 用户拒绝相册权限时仍可返回页面，不得导致流程卡死；
- 历史海报保留生成时的数据快照和渠道信息。

# 13. F09/F10 提醒、设置与账户

## 13.1 P0 页面内跨日提示

23:00 内容切换属于 F11 全局状态，不属于主动通知：

- 用户正在页面内时，22:59 至 23:00 自动切换或提示刷新；
- 用户重新进入、刷新或从后台恢复时，检查当前 `fortuneDate`；
- 不要求通知权限；
- 不得因为用户未开启通知而显示旧的命理日。

## 13.2 F09 主动提醒（P1）

主动提醒指用户未打开产品时的触达：

- 只有用户主动点击“提醒我”后才允许申请相关权限；
- 微信小程序按照届时可用的订阅消息能力实现，不承诺未经授权的每日持续送达；
- H5 先检测浏览器能力；不可稳定提醒时不得展示无效开关，可引导用户进入小程序；
- 早晨穿衣提醒与 23:00 页面内换日提示分别配置；
- 每日不得多次营销催促；
- 通知文案不得制造“不看会倒霉”的焦虑；
- 拒绝权限不影响任何公共 P0 功能。

## 13.3 F10A 设置与帮助（P0）

- 字号设置；
- 反馈入口：统一承载功能建议和内容纠错，并要求用户选择反馈类别；
- 关于；
- 用户协议；
- 隐私政策；
- 清除当前渠道的本地数据。

P0 中该页面不使用“账户中心”含义，不展示通知、收藏、登录、导出或注销占位。

## 13.4 F10B 我的账户（P1）

- 收藏；
- 常用颜色；
- 提醒设置；
- 账户信息；
- 数据导出；
- 账户注销；
- 当前渠道与跨端同步状态说明。

用户只在使用收藏、同步或提醒等明确需要身份的功能时登录。登录不得成为查看公共今日内容的前置条件。

# 14. F11 全局状态

| 状态 | 产品行为 |
|---|---|
| 首次加载 | 使用骨架屏，不用长时间装饰动画 |
| 网络错误 | 仅显示仍处于 `[effectiveFrom, effectiveTo)` 的已审核缓存并标注更新时间；缓存已过期或不存在时提示重试 |
| 内容未审核 | 展示“今日内容校验中”，不得用 LLM 临时补算 |
| 离线 | 仅展示未过期的已审核内容 |
| 22:59→23:00 | 立即停止把旧内容当作今日内容；自动切换新内容，可先显示“已进入次日子时”阻断提示，加载失败则显示“今日内容校验中” |
| 版本回滚 | 页面、公共接口和 CDN 别名切换；绑定旧版本且未完成的海报/待发送任务取消，目标版本以新任务重新入队；已外发内容保留来源版本 |
| 图片失败 | 使用审核过的搭配模板或纯色单品板降级 |

# 15. 每日模特内容生产要求

## 15.1 输入结构

```json
{
  "fortuneDate": "2026-07-15",
  "dayElement": "木",
  "primary": ["红色", "橙色", "紫色", "粉色系"],
  "secondary": ["绿色", "青色", "翠色", "湖蓝", "浅绿系"],
  "neutral": ["白色", "乳白", "银色", "金色", "浅色系"],
  "scenario": "通勤",
  "audience": "成年女性",
  "formula": {"primary": 60, "secondary": 30, "accent": 10}
}
```

## 15.2 生产流程

P0 允许授权素材与 AI 生成素材并存，不要求在产品内建设完整图像生成平台。首发可以在外部完成生成或选图后人工上传，再进入统一审核与发布流程；正式批量生产前由产品和运营根据样张质量、稳定性、权利证明、成本与平台审核结果确定主管线。

1. 系统生成结构化搭配配方；
2. 从授权素材库匹配，或调用/外部使用图像生成服务后上传制品；
3. 自动检查主色和禁止元素；
4. 运营检查人物、服装结构、颜色和场景；
5. 老师仅审核五行与颜色关系，不承担时尚审美全责；
6. 每个制品记录 `assetSourceType`、素材哈希、权利证明、审核结果和 AI 标识状态；AI 生成制品另记录生成模型、提示词版本、随机种子或等价重现信息；
7. 审核通过后绑定内容版本；
8. 不通过时调用备选模板。

## 15.3 审核清单

- 是否真实出现规定主色；
- 是否误用不利色为大面积主色；
- 模特肢体、手指、服装和阴影是否自然；
- 服装是否符合目标场景和季节；
- 文案与图片是否一致；
- 是否存在品牌、版权、肖像或不当内容风险；
- AI 生成内容是否按适用法律、强制标准和平台规则完成用户可感知的显式标识；
- AI 生成文件是否保留所需隐式标识和来源记录，下载、复制或导出后是否仍符合标识要求；
- 是否至少有一套普通用户可模仿。

## 15.4 合规依据

- 国家互联网信息办公室等四部门发布的[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)，自 2025-09-01 起施行；
- 微信开放文档的[小程序平台运营规范](https://developers.weixin.qq.com/miniprogram/product/)；
- 微信开放文档的[小程序开放服务类目](https://developers.weixin.qq.com/miniprogram/product/material/)。

法规、强制标准和平台规则可能更新。正式投产、导出和提审时必须按当期规则复核，不得把本 PRD 视为一次性完成的法律结论。

# 16. 运营后台

## 16.1 O01 每日审核

- 显示命理业务日期、民用日期、干支、地支和五行；
- 显示五档矩阵和颜色；
- 显示首页摘要、搭配公式、模特图和海报模板预览；P1 可扩展主动提醒预览；
- 对每个模块分别审核或退回；
- 记录审核人、时间、意见和版本；
- 支持定时生效、立即撤回和回滚。

## 16.2 O02A/O02B 内容与素材库

P0 的 O02A 包含：固定颜色、固定场景与人群枚举、素材标签绑定、搭配公式、配饰库、模特图与授权信息、`assetSourceType`、AI 标识状态、生成模型和提示词版本记录、硬禁词、效果承诺、高风险表达、必要模板和失败备选模板。

P1 的 O02B 增加：自定义标签管理、场景与人群筛选 UI、穿搭小课堂选题、提示词管理 UI、批量管理和素材效果分析。

## 16.3 O03 渠道与海报

- 微信群、公众号、用户分享等渠道参数；
- 海报预生成和二维码；
- 生成失败报警；
- 扫码和落地转化数据。

## 16.4 O04A 运营监控（P0）

- H5 与微信小程序访问量、匿名访问人数及口径说明；
- 今日首页到搭配详情的转化；
- 摘要分享动作发起、海报分享动作发起、海报保存结果和海报回流；不得把无法观测的外部实际发送次数称为“分享成功量”；
- 接口错误、图片失败、内容错误和投诉；
- 每日内容生成、审核、发布和回滚状态；
- 23:00 切换成功率；
- 按 `platform`、`channelId` 和 `contentVersion` 筛选。

## 16.5 O04B 增长分析（P1）

- 次日、7 日和 30 日留存；
- 收藏数量、收藏率和取消收藏率；
- 我的颜色使用与方案生成转化；
- 提醒授权、发送和回访；
- 登录用户与匿名用户分层；
- H5 与微信小程序的跨端用户合并；
- 版本和渠道效果对比。

P0 看板不得显示尚未上线的收藏、账户或提醒指标，也不得用固定为零的数据冒充已完成埋点。

## 16.6 内容域术语

| 术语 | 定义 |
|---|---|
| 内容草稿 `ContentDraft` | 运营可编辑的工作副本，不对用户公开。 |
| 内容快照载荷 `ContentSnapshotPayload` | 草稿提交审核时生成的不可变内容副本，使用唯一 `contentVersion` 标识；只保存当时已经存在的业务内容和版本引用。 |
| 生命周期投影 `ContentLifecycleProjection` | 由审核、排期、发布、撤回和回滚事件计算出的当前状态，可重建但不得反向修改快照载荷。 |
| 审核与发布记录 | `ModuleReview`、`ReleaseEvent` 和 `AuditEvent` 均追加写入并引用 `contentVersion`，不嵌入不可变快照载荷。 |
| 活跃版本 `ActiveVersion` | 某个 `fortuneDate` 当前唯一允许公共端读取的内容快照。 |
| 回滚 | 将活跃版本指针重新指向一个历史已批准快照，不修改历史快照本身。 |
| 撤回 | 阻止某个快照继续公开访问；被撤回版本不得直接重新发布。 |
| 内容模块 | 日历算法、五档与文案、搭配公式、模特与版权、海报一致性。 |

H5 与微信小程序共用相同的内容快照和活跃版本。平台差异不得改变日柱、五档、颜色、搭配配方或 `contentVersion`。

## 16.7 内容状态机（开发基线，按本节场景完成四方确认后冻结）

### 内容快照状态

| 状态 | 含义 | 允许的下一状态 |
|---|---|---|
| `in_review` | 已提交审核，快照已冻结 | `approved`、`changes_requested` |
| `changes_requested` | 至少一个必审模块退回 | 无；从该快照复制生成新草稿 |
| `approved` | 所有必审模块已通过，尚未生效 | `scheduled`、`published`、`withdrawn` |
| `scheduled` | 已设置在 `effectiveFrom` 自动生效 | `approved`、`published`、`withdrawn` |
| `published` | 当前活跃版本 | `superseded`、`withdrawn` |
| `superseded` | 曾发布，现被新版本或回滚替代 | 可作为回滚目标重新进入 `published` |
| `withdrawn` | 永久禁止该快照公开，不要求此前已经发布 | 终态；恢复时必须复制为新草稿并重新审核 |

“回滚”是一次操作和审计事件，不作为长期状态。回滚成功后，目标快照变为 `published`，原活跃快照变为 `superseded`。

每个 `fortuneDate` 只有一个排期槽，并拥有独立 `scheduleSlotRevision`。新版本替换旧排期时必须在一个原子事务中完成：旧版本 `scheduled → approved`、新版本 `approved → scheduled`，同时递增该日 `lifecycleRevision` 与 `scheduleSlotRevision`；动作响应的 `transitions` 必须同时返回两项。被取消或被新排期替换的旧任务进入终止状态，不得继续重试或覆盖活跃指针。

有效排期任务执行失败时不新增业务状态：快照保持 `scheduled`，系统追加失败事件、按退避策略自动重试并报警。任务记录 `contentVersion + scheduleSlotRevision`，每次执行或重试前只校验排期槽仍指向自己且槽修订号一致；其他版本的普通审核不得使有效排期失效。只有发布原子事务成功后才进入 `published`。

```text
内容草稿
  → 提交并冻结
  → in_review
      → changes_requested → 复制为新草稿
      → approved
          → scheduled → published
          → published
              → superseded
              → withdrawn

superseded → 回滚操作 → published
```

### 审核模块

| 模块代码 | 内容 | 必审人 |
|---|---|---|
| `calendar_algorithm` | 干支、地支、日五行、五档顺序、颜色归行 | 业务老师 |
| `copy_and_formula` | 首页文案、关系解释、搭配公式、禁词 | 运营审核 |
| `visual_and_rights` | 模特结构、图片颜色、肖像、品牌、版权、AI 标识 | 运营审核 |
| `poster_consistency` | 海报模板渲染样张中的日期、五档、配方、入口码占位和来源版本一致性 | 系统校验通过后由运营审核 |

任一必审模块为 `changes_requested` 时，整个快照不得批准。提交审核后的内容、素材引用和版本号不得原地修改。

## 16.8 角色与权限

| 动作 | 运营编辑 | 运营审核 | 业务老师 | 发布人 | 管理员 |
|---|---:|---:|---:|---:|---:|
| 创建、编辑草稿 | 是 | 是 | 否 | 否 | 配置授权 |
| 提交审核 | 是 | 是 | 否 | 否 | 否 |
| 审核文案、搭配和图片 | 否 | 是 | 否 | 否 | 否 |
| 审核算法和五档 | 否 | 否 | 是 | 否 | 否 |
| 排期与发布 | 否 | 否 | 否 | 是 | 否；如需发布必须另授“发布人”角色 |
| 撤回与回滚 | 否 | 否 | 否 | 是 | 仅紧急撤回；回滚需另授“发布人”角色 |
| 管理角色与系统配置 | 否 | 否 | 否 | 否 | 是 |
| 查看审计记录 | 自己相关 | 是 | 是 | 是 | 是 |

同一人员可以被授予多个角色，但同一个 `contentVersion` 必须满足：

- 任何编辑过某模块的人不得审核该模块；系统按模块记录 `editedByActorIds`，不能只检查最初创建者；
- 最终发布者不得创建或编辑该版本的任何业务模块；
- 管理员不得绕过必审模块进行正常发布；
- 管理员可以紧急撤回，但必须填写原因。

## 16.9 发布、撤回与回滚规则

发布前必须同时满足：

1. 所有必审模块均已通过；
2. 日历与五档自动校验通过；
3. `tiers` 恰好为五档且顺序唯一；
4. 单色、双色、三色方案齐全；
5. 至少一套主模特可用，其他方案或审核过的降级模板可用；
6. 图片、公式和海报模板均引用同一 `contentVersion`；
7. 海报模板渲染校验和至少一条分享落地链路可用；单个渠道海报实例异步生成失败不阻断基础内容发布；
8. 发布人与创建者不同；
9. 当前活跃版本与发布操作读取到的版本一致，避免并发覆盖。

正常排期时间固定为内容的 `effectiveFrom`。未来命理日不得提前公开。

撤回当前版本时：

- 可以同时指定同一 `fortuneDate` 下处于 `superseded` 的安全版本作为替代；系统必须先复查素材授权、入口链路和当前发布预检；
- 指定替代版本时，以一个原子事务完成“撤回当前版本 + 回滚安全旧版本”；从未发布的 `approved` 或 `scheduled` 版本只能走正常发布；
- 未指定替代版本时，公共 API 返回“今日内容校验中”；
- 系统控制的公共 API、源站和 CDN 停止向新请求提供被撤回版本、图片和海报；已经缓存、下载或外部转发的副本无法远程收回；
- 审计后台仍保留原始快照与撤回原因。

回滚时：

- 目标必须是同一 `fortuneDate` 下处于 `superseded`、审核记录完整且通过当前素材授权与发布预检的快照；
- 系统以一次原子操作切换活跃版本指针；
- 页面、公共接口和 CDN 缓存切换到目标版本；绑定原活跃版本且尚未完成的海报或待发送任务标记为 `version_changed` 并停止，不得原地改写 `sourceContentVersion`，目标版本使用新的任务 ID 重新入队；
- 已发送通知、已下载或已转发海报无法远程收回；其来源版本必须可审计，入口码应落到当前安全版本；
- 回滚不得自动再次发送通知，是否发送纠错通知由运营人工确认。

## 16.10 状态机确认方法

产品、运营、业务老师和后端研发共同逐条演练以下场景；角色、结果和页面表现无歧义后，由四方在评审记录中确认，本节即从“建议方案”改为“已确认”：

1. 运营提交后发现一句文案错误：不得修改原快照，复制为新草稿；
2. 业务老师退回五档：整个版本不能发布；
3. 内容提前一天审核完成：进入 `scheduled`，在 `effectiveFrom` 自动生效；
4. 发布后发现图片版权问题：立即撤回并指定安全旧版本；
5. 新版本效果不佳但没有合规问题：回滚旧版本，不复制内容；
6. 两个人同时点击发布：只能一个成功，另一个得到 `VERSION_CONFLICT`；
7. 用户打开旧海报：图片本身不能收回，但入口码落到当前安全版本并提示版本已更新。

研发开工默认按上述结果设计；如果任一参与方不同意，必须在进入发布后台开发前修改本节，不允许在代码评审阶段临时改变状态语义。

## 16.11 不可变快照与审计

内容快照载荷在提交审核时生成，并至少保存：

- 完整内容 JSON；
- `fortuneDate`、生效区间和时区；
- 日历数据记录及其版本；
- 算法、文案、配方、图片清单和海报模板版本；
- 所有素材的 `assetId`、文件哈希和授权记录引用；
- 提交时已经完成的自动检查结果。

审核中及之后的 `ContentSnapshotPayload` 不可修改或删除。需要调整内容时，复制为新草稿并生成新的 `contentVersion`。

之后产生的模块审核、状态变化、发布、撤回、回滚和失败记录分别追加到 `ModuleReview`、`ReleaseEvent` 与 `AuditEvent`，均引用 `contentVersion`；`ContentLifecycleProjection` 只由这些事件计算，不得用于覆盖历史事件。审计记录后台用户不得覆盖，P0 默认至少保留 365 天。

# 17. 数据结构与 API v1 契约

## 17.1 API 通用约定

- 公共接口前缀：`/api/v1`；后台接口前缀：`/admin/api/v1`；
- 时间使用带时区的 ISO 8601，命理日期使用 `YYYY-MM-DD`；
- 固定业务时区为 `Asia/Shanghai`；
- 内容生效区间统一为左闭右开 `[effectiveFrom, effectiveTo)`；任一时刻同一 `fortuneDate` 最多只有一个活跃版本；
- 服务端负责计算 `responseGeneratedAt`、`civilDate`、`fortuneDate` 和 `shichen`，不信任客户端设备时间；
- `responseGeneratedAt` 表示当前响应表示在源站或边缘层生成时的服务端时刻，不承诺等于用户收到缓存响应时的实时服务器时钟；客户端不得用它自行推进业务日期或时辰；
- H5 与微信小程序共用同一业务 API；
- 客户端使用 `X-Client-Platform: h5` 或 `wechat_miniprogram` 上报平台，该字段不得影响算法结果；
- 客户端可使用 `X-Channel-Id` 上报渠道，渠道字段不得改变正文；
- API 版本与 `algorithmVersion` 相互独立，客户端不得从版本字符串推断规则；
- `contentVersion` 是不透明唯一标识，客户端不得解析其字符串含义；
- 公共 API 只返回活跃的已发布快照，不返回内部审核状态；
- 每个响应通过 `X-Request-Id` 响应头返回请求标识；错误响应体同时返回该值，后台写操作把它写入审计日志；共享缓存命中时由 CDN/边缘层为每次外部请求生成或重写该值，不得把源站请求 ID 作为缓存正文的一部分复用；
- 公共缓存响应使用 HTTP `Date` 和 `Age` 表示响应生成时间与缓存年龄；
- 内容响应通过 `X-Content-Version` 响应头返回业务版本，缓存校验器与业务版本分离。

## 17.2 今日内容响应

`GET /api/v1/today`

```json
{
  "requestContext": {
    "responseGeneratedAt": "2026-07-14T23:30:00+08:00",
    "civilDate": "2026-07-14",
    "fortuneDate": "2026-07-15",
    "shichen": "子",
    "timezone": "Asia/Shanghai",
    "dayBoundary": "23:00",
    "crossedDayBoundary": true
  },
  "content": {
    "fortuneDate": "2026-07-15",
    "effectiveFrom": "2026-07-14T23:00:00+08:00",
    "effectiveTo": "2026-07-15T23:00:00+08:00",
    "calendar": {
      "weekdayText": "星期三",
      "lunarDateText": "六月初二",
      "ganzhiDay": "庚寅",
      "branch": "寅",
      "dayElement": "wood",
      "dayElementLabel": "木"
    },
    "tiers": [
      {
        "rank": 1,
        "tierCode": "da_ji",
        "algorithmLabel": "大吉",
        "displayLabel": "今日优先",
        "element": "fire",
        "elementLabel": "火",
        "colors": [
          {"colorCode": "red", "name": "红色"},
          {"colorCode": "orange", "name": "橙色"},
          {"colorCode": "purple", "name": "紫色"},
          {"colorCode": "pink_family", "name": "粉色系"}
        ],
        "relationText": "木生火",
        "explanation": "今日木日，木生火，火为大吉。"
      },
      {
        "rank": 2,
        "tierCode": "ci_ji",
        "algorithmLabel": "次吉",
        "displayLabel": "稳妥选择",
        "element": "wood",
        "elementLabel": "木",
        "colors": [
          {"colorCode": "green", "name": "绿色"},
          {"colorCode": "cyan", "name": "青色"},
          {"colorCode": "emerald", "name": "翠色"},
          {"colorCode": "lake_blue", "name": "湖蓝"},
          {"colorCode": "light_green_family", "name": "浅绿系"}
        ],
        "relationText": "木与木同类",
        "explanation": "与今日五行相同，作为稳妥选择。"
      },
      {
        "rank": 3,
        "tierCode": "ping",
        "algorithmLabel": "平",
        "displayLabel": "日常可穿",
        "element": "metal",
        "elementLabel": "金",
        "colors": [
          {"colorCode": "white", "name": "白色"},
          {"colorCode": "ivory", "name": "乳白"},
          {"colorCode": "silver", "name": "银色"},
          {"colorCode": "gold", "name": "金色"},
          {"colorCode": "light_family", "name": "浅色系"}
        ],
        "relationText": "金克木",
        "explanation": "适合作为日常穿搭参考。"
      },
      {
        "rank": 4,
        "tierCode": "jiao_cha",
        "algorithmLabel": "较差",
        "displayLabel": "建议减少",
        "element": "water",
        "elementLabel": "水",
        "colors": [
          {"colorCode": "black", "name": "黑色"},
          {"colorCode": "navy", "name": "藏青"},
          {"colorCode": "royal_blue", "name": "宝蓝"},
          {"colorCode": "dark_green", "name": "墨绿"},
          {"colorCode": "dark_gray_family", "name": "深灰系"}
        ],
        "relationText": "水生木",
        "explanation": "今日建议降低大面积使用比例。"
      },
      {
        "rank": 5,
        "tierCode": "bu_li",
        "algorithmLabel": "不利",
        "displayLabel": "今日先收起",
        "element": "earth",
        "elementLabel": "土",
        "colors": [
          {"colorCode": "yellow", "name": "黄色"},
          {"colorCode": "coffee", "name": "咖色"},
          {"colorCode": "brown", "name": "棕色"},
          {"colorCode": "khaki", "name": "卡其"},
          {"colorCode": "dark_brown_family", "name": "褐色系"}
        ],
        "relationText": "木克土",
        "explanation": "今日建议减少使用，仅作穿搭参考。"
      }
    ],
    "outfitFormulas": [
      {
        "formulaId": "formula-mono-01",
        "kind": "mono",
        "title": "大吉色同色系",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "slots": [
          {"role": "primary", "roleLabel": "主色", "tierCode": "da_ji", "colorCodes": ["red", "pink_family"], "ratioPercent": 100, "garmentParts": ["上衣", "下装"]}
        ],
        "lookIds": ["look-alt-01"],
        "disclaimer": "同色系深浅变化属于穿搭参考。"
      },
      {
        "formulaId": "formula-dual-01",
        "kind": "dual",
        "title": "大吉 × 次吉",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "slots": [
          {"role": "primary", "roleLabel": "主色", "tierCode": "da_ji", "colorCodes": ["red"], "ratioPercent": null, "garmentParts": ["上衣"]},
          {"role": "secondary", "roleLabel": "辅助色", "tierCode": "ci_ji", "colorCodes": ["green"], "ratioPercent": null, "garmentParts": ["下装"]}
        ],
        "lookIds": ["look-alt-02"],
        "disclaimer": "双色比例未固定时返回 null，不虚构百分比。"
      },
      {
        "formulaId": "formula-triple-01",
        "kind": "triple",
        "title": "60/30/10 通勤搭配",
        "scenario": {"code": "commute", "label": "通勤"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "slots": [
          {"role": "primary", "roleLabel": "主色", "tierCode": "da_ji", "colorCodes": ["red"], "ratioPercent": 60, "garmentParts": ["上衣"]},
          {"role": "secondary", "roleLabel": "辅助色", "tierCode": "ci_ji", "colorCodes": ["green"], "ratioPercent": 30, "garmentParts": ["下装"]},
          {"role": "accent", "roleLabel": "点缀色", "tierCode": "ping", "colorCodes": ["white"], "ratioPercent": 10, "garmentParts": ["鞋包", "配饰"]}
        ],
        "lookIds": ["look-main-01"],
        "disclaimer": "60/30/10 为穿搭参考，不是五行推算规则。"
      }
    ],
    "looks": [
      {
        "lookId": "look-main-01",
        "formulaId": "formula-triple-01",
        "priority": "primary",
        "sortOrder": 1,
        "title": "木日通勤主方案",
        "scenario": {"code": "commute", "label": "通勤"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_main_cover",
          "url": "https://cdn.example.com/assets/hash.webp",
          "width": 1200,
          "height": 1600,
          "altText": "红色上衣、绿色下装和白色配饰的通勤穿搭",
          "aiGenerated": true
        },
        "detailImages": [
          {"assetId": "asset_look_main_detail", "url": "https://cdn.example.com/assets/main-detail-hash.webp", "altText": "红色上衣、绿色下装和白色配饰的细节"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "red", "description": "红色简洁上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "green", "description": "低饱和绿色下装"},
          {"category": "accessory", "categoryLabel": "鞋包/配饰", "colorCode": "white", "description": "白色小面积点缀"}
        ],
        "alternatives": [
          {"replaceCategory": "accessory", "description": "无法更换整套衣服时，可用白色包或耳饰替代。"}
        ],
        "aiDisclosure": "AI 生成穿搭示意图"
      },
      {
        "lookId": "look-alt-01",
        "formulaId": "formula-mono-01",
        "priority": "alternate",
        "sortOrder": 2,
        "title": "红粉同色系日常方案",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_alt_01_cover",
          "url": "https://cdn.example.com/assets/alt-01-cover-hash.webp",
          "width": 1200,
          "height": 1600,
          "altText": "红粉同色系日常穿搭",
          "aiGenerated": true
        },
        "detailImages": [
          {"assetId": "asset_look_alt_01_detail", "url": "https://cdn.example.com/assets/alt-01-detail-hash.webp", "altText": "红粉同色系材质细节"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "pink_family", "description": "低饱和粉色上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "red", "description": "深红色下装"}
        ],
        "alternatives": [],
        "aiDisclosure": "AI 生成穿搭示意图"
      },
      {
        "lookId": "look-alt-02",
        "formulaId": "formula-dual-01",
        "priority": "alternate",
        "sortOrder": 3,
        "title": "红绿双色日常方案",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_alt_02_cover",
          "url": "https://cdn.example.com/assets/alt-02-cover-hash.webp",
          "width": 1200,
          "height": 1600,
          "altText": "红色上衣和绿色下装的日常穿搭",
          "aiGenerated": true
        },
        "detailImages": [
          {"assetId": "asset_look_alt_02_detail", "url": "https://cdn.example.com/assets/alt-02-detail-hash.webp", "altText": "红绿双色穿搭细节"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "red", "description": "红色上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "green", "description": "绿色下装"}
        ],
        "alternatives": [],
        "aiDisclosure": "AI 生成穿搭示意图"
      }
    ],
    "basis": {
      "steps": ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
      "disclaimer": "内容基于传统文化规则整理，仅供穿搭参考。"
    },
    "share": {
      "summaryText": "今日木日，优先参考红、橙、紫、粉色系。",
      "copyText": "今日穿搭参考：优先火色，稳妥选择木色。",
      "poster": {
        "posterTemplateVersion": "poster-template-v3",
        "jobEndpoint": "/api/v1/poster-jobs"
      }
    },
    "versions": {
      "contentVersion": "fd-20260715-r3",
      "calendarDataVersion": "calendar-20260715-r1",
      "calendarRuleVersion": "fortune-date-23h-v1",
      "algorithmVersion": "wx-public-1.0.0",
      "copyVersion": "copy-20260715-r2",
      "outfitVersion": "outfit-20260715-r3",
      "assetManifestVersion": "assets-20260715-r2",
      "posterTemplateVersion": "poster-template-v3"
    }
  }
}
```

字段约束：

- `requestContext` 描述当前响应表示生成时的服务端解析结果；在该表示的有效缓存期内，`civilDate`、`fortuneDate`、`shichen` 和 `crossedDayBoundary` 必须保持相互一致；
- 客户端只消费服务端给出的日期、时辰和跨日结果，不根据 `responseGeneratedAt` 或设备时钟自行重算；
- `tiers` 必须恰好五项，`rank` 为 1–5 且不可重复；
- `tierCode` 固定为 `da_ji`、`ci_ji`、`ping`、`jiao_cha`、`bu_li`；
- `element` 固定为 `wood`、`fire`、`earth`、`metal`、`water`；
- `colorCode` 只能来自已审核颜色表，前端不得根据 HEX 或图片色相重新归行；
- `outfitFormulas` 至少包含单色、双色、三色各一项；
- 三色方案填写比例时，比例之和必须等于 100；未确认的比例返回 `null`；
- 每日至少一套 `primary` 模特，另有两套 `alternate` 或已审核降级模板；
- 所有 `formulaId`、`lookId`、`colorCode` 和 `assetId` 引用在发布前通过完整性校验；
- 图片 URL 必须包含内容哈希或版本路径，禁止覆盖同一 URL 下的文件；
- `posterTemplateVersion` 被 `contentVersion` 锁定；按平台与渠道生成的 `posterInstanceId` 是派生制品，不回写内容快照，也不改变 `contentVersion`；
- `civilDate` 只属于请求上下文，不写入不可变内容快照；
- `reviewStatus` 只出现在后台接口，不出现在公共响应。

## 17.3 公共 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/v1/today` | 按服务端当前时间返回今日活跃内容 |
| `GET` | `/api/v1/daily/{fortuneDate}` | 打开分享落地页或解析既有历史日期链接；不代表 P0 提供历史浏览入口 |
| `GET` | `/api/v1/daily/{fortuneDate}/looks/{lookId}?expectedContentVersion=...` | 获取搭配详情并校验页面版本 |
| `POST` | `/api/v1/poster-jobs` | 校验预期活跃版本后获取或异步生成海报 |
| `GET` | `/api/v1/poster-jobs/{jobId}` | 查询海报生成状态 |
| `POST` | `/api/v1/feedback-reports` | 提交功能建议或内容纠错 |

### 海报任务契约

`POST /api/v1/poster-jobs` 必须携带 `Idempotency-Key`，请求体为：

```json
{
  "fortuneDate": "2026-07-15",
  "expectedContentVersion": "fd-20260715-r3",
  "sourcePlatform": "wechat_miniprogram",
  "targetPlatform": "wechat_miniprogram",
  "channelId": "organic"
}
```

`Idempotency-Key` 使用 UUID v4 或等价的高熵不透明值。同一业务意图的网络重试必须复用同一键；请求参数、`fortuneDate` 或 `expectedContentVersion` 变化时必须生成新键。服务端按“调用方 + 接口 + 幂等键”确定作用域并保留足以覆盖客户端重试窗口的结果；同一键配不同规范化请求体返回 `409 IDEMPOTENCY_KEY_REUSED`。

`sourcePlatform` 与 `targetPlatform` 都只允许 `h5` 或 `wechat_miniprogram`。如果 `expectedContentVersion` 不是该 `fortuneDate` 的当前活跃版本，服务端必须返回 `409 CONTENT_VERSION_CHANGED`，不得创建任务；客户端整包刷新后再重试。创建与查询任务使用同一响应结构；`status` 只允许 `processing`、`ready`、`failed` 或 `version_changed`，非 `ready` 时可为空的制品字段返回 `null`：

```json
{
  "jobId": "poster_job_01J...",
  "status": "ready",
  "sourceContentVersion": "fd-20260715-r3",
  "currentActiveContentVersion": "fd-20260715-r3",
  "posterTemplateVersion": "poster-template-v3",
  "posterInstanceId": "poster_fd-20260715-r3_wechat_miniprogram_wechat_miniprogram_organic_01",
  "sourcePlatform": "wechat_miniprogram",
  "targetPlatform": "wechat_miniprogram",
  "channelId": "organic",
  "assetUrl": "https://cdn.example.com/posters/instance-hash.webp",
  "entry": {
    "type": "wechat_miniprogram_code",
    "miniProgramPath": "/pages/daily/index?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r3&sourcePlatform=wechat_miniprogram&targetPlatform=wechat_miniprogram&channelId=organic",
    "fallbackShortUrl": "https://example.com/d/2026-07-15?expectedContentVersion=fd-20260715-r3&sourcePlatform=wechat_miniprogram&targetPlatform=h5&channelId=organic"
  }
}
```

H5 实例的 `entry.type` 为 `h5_qr`，返回 `landingUrl`，不返回 `miniProgramPath`。`sourcePlatform` 表示分享动作发生端，`targetPlatform` 表示该入口目标端，`platform` 只表示埋点实际运行端。海报正文、日期或配方变化必须生成新的 `contentVersion`；只改变入口码、渠道标识或重新渲染时生成新的 `posterInstanceId`。

撤回或回滚使任务的 `sourceContentVersion` 不再活跃时，未完成任务转为 `version_changed`，保留原 `jobId` 供轮询和审计，返回新的 `currentActiveContentVersion`，且不得产出公开 `assetUrl`。客户端必须用当前安全版本和新的 `Idempotency-Key` 创建新任务，服务端不得在原任务上偷换版本。

### 反馈契约

`POST /api/v1/feedback-reports` 请求体至少包含：

```json
{
  "category": "content_error",
  "message": "图片主色与文字配方不一致",
  "fortuneDate": "2026-07-15",
  "contentVersion": "fd-20260715-r3",
  "platform": "h5",
  "channelId": "organic",
  "contact": null
}
```

`category` 只允许 `content_error` 或 `product_feedback`；`message` 必填并限制长度，`contact` 可空且单独取得用户同意。成功返回 `202` 和 `feedbackId`，服务端记录 `X-Request-Id`、限流结果与处理状态。

`GET /api/v1/daily/{fortuneDate}` 可携带 `expectedContentVersion`。旧版本被回滚或撤回时，接口返回当前安全版本，并附带：

```json
{
  "resolution": {
    "expectedContentVersion": "fd-20260715-r3",
    "servedContentVersion": "fd-20260715-r2",
    "versionChanged": true,
    "reason": "rolled_back"
  }
}
```

搭配详情发现客户端版本变化时返回 `409 CONTENT_VERSION_CHANGED`，客户端必须重新获取整个每日内容包，不能拼接新旧数据。公共历史内容至少保留最近 90 个命理日；超过期限的入口返回 `410 HISTORICAL_CONTENT_EXPIRED` 和“历史内容已下线，可主动查看今日”的安全落地页，不自动伪装成今日内容。后台不可变快照不受公开期限影响。

## 17.4 后台 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/admin/api/v1/daily-content-drafts` | 创建某命理日草稿 |
| `GET` | `/admin/api/v1/daily-content-drafts/{draftId}` | 查看草稿 |
| `PATCH` | `/admin/api/v1/daily-content-drafts/{draftId}/modules/{moduleCode}` | 按模块编辑草稿 |
| `POST` | `/admin/api/v1/daily-content-drafts/{draftId}/submit` | 冻结草稿并生成 `contentVersion` |
| `GET` | `/admin/api/v1/daily-content-versions?fortuneDate=...` | 查看该日全部版本 |
| `GET` | `/admin/api/v1/daily-content-versions/{contentVersion}` | 查看快照、审核和发布记录 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/reviews` | 提交模块审核结果 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/schedule` | 设置定时生效 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/cancel-schedule` | 取消排期并回到已批准 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/publish` | 立即发布 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/withdraw` | 撤回，可指定安全替代版本 |
| `POST` | `/admin/api/v1/daily-content-days/{fortuneDate}/rollback` | 回滚到指定历史版本 |
| `GET` | `/admin/api/v1/audit-events` | 查询审计记录 |

### 草稿契约

创建草稿请求体：

```json
{
  "fortuneDate": "2026-07-15",
  "copyFromContentVersion": null
}
```

`copyFromContentVersion` 可空；非空时只能复制同一 `fortuneDate` 下后台可见的快照。成功返回 `201`：

```json
{
  "draftId": "draft_01J...",
  "fortuneDate": "2026-07-15",
  "draftRevision": 1,
  "modules": {
    "calendar_algorithm": {},
    "copy_and_formula": {},
    "visual_and_rights": {},
    "poster_consistency": {}
  }
}
```

模块内容沿用第 17.2 节对象、枚举与引用约束：`calendar_algorithm` 管理 `calendar + tiers + calendar versions`，`copy_and_formula` 管理摘要、依据与 `outfitFormulas`，`visual_and_rights` 管理 `looks`、素材哈希与授权记录，`poster_consistency` 管理海报模板选择和渲染样张。编辑接口使用 `Content-Type: application/merge-patch+json`，请求体是仅作用于路径中 `moduleCode` 的 RFC 7396 Merge Patch；服务端校验必填字段、引用和权限，并把操作者加入该模块的 `editedByActorIds`。成功返回更新后的模块、`draftRevision`，并在 `ETag` 返回相同修订号。

`submit` 不接收业务内容，请求体为空，必须携带当前草稿 `If-Match` 和 `Idempotency-Key`。成功冻结载荷并返回：

```json
{
  "draftId": "draft_01J...",
  "contentVersion": "fd-20260715-r3",
  "state": "in_review",
  "lifecycleRevision": 1
}
```

成功响应的 `ETag` 表示新的 `lifecycleRevision`，草稿此后不再返回可编辑 ETag。同一 `draftId + draftRevision + Idempotency-Key` 的重试必须返回第一次生成的同一 `contentVersion`，不得重复创建快照。

### 后台写操作约定

- `PATCH` 草稿必须使用 `If-Match: "<draftRevision>"`；成功响应通过 `ETag` 返回新的草稿修订号；
- `submit` 使用草稿 `If-Match` 校验冻结前版本并必须携带 `Idempotency-Key`；成功后的 `ETag` 改为表示新建生命周期聚合的 `lifecycleRevision`；
- 审核、排期、取消排期、发布、撤回和回滚必须使用 `If-Match: "<lifecycleRevision>"`；该修订号属于整个 `fortuneDate` 生命周期聚合，任一模块审核、排期槽或活跃指针变化都会递增；
- `submit`、审核、排期、取消排期、发布、撤回和回滚必须携带 `Idempotency-Key`；同一键与同一规范化请求体返回第一次结果，同一键配不同请求体返回 `409 IDEMPOTENCY_KEY_REUSED`；
- 所有动作必须校验当前状态、角色和 `lifecycleRevision`；成功后通过 `ETag` 返回新修订号并返回新的生命周期投影，失败不得局部更新活跃指针；
- 后台身份认证方式由技术设计确定，但权限判定必须使用第 16.8 节角色语义。

核心动作请求体冻结为：

```json
{
  "review": {
    "moduleCode": "calendar_algorithm",
    "decision": "approved",
    "comment": "连续样本核对通过",
    "expectedState": "in_review"
  },
  "schedule": {
    "effectiveAt": "2026-07-14T23:00:00+08:00",
    "expectedState": "approved"
  },
  "publish": {
    "expectedState": "approved",
    "expectedActiveVersion": "fd-20260715-r2"
  },
  "withdraw": {
    "reason": "图片版权授权失效",
    "fallbackContentVersion": "fd-20260715-r2",
    "expectedActiveVersion": "fd-20260715-r3"
  },
  "rollback": {
    "targetContentVersion": "fd-20260715-r2",
    "reason": "回到最近安全版本",
    "expectedActiveVersion": "fd-20260715-r3"
  }
}
```

上面是各动作独立请求体的字段集合，不是一次请求同时执行多个动作。`decision` 只允许 `approved` 或 `changes_requested`；退回时 `comment` 必填。`expectedActiveVersion` 必填但允许为 `null`：`null` 明确表示调用方预期该日尚无活跃版本，省略字段属于无效请求。`fallbackContentVersion` 可空，为空时撤回后该日进入不可用状态。取消排期必须提供 `reason` 和 `expectedState = scheduled`。

动作成功统一返回：

```json
{
  "lifecycleRevision": 8,
  "scheduleSlotRevision": 3,
  "transitions": [
    {
      "contentVersion": "fd-20260715-r3",
      "previousState": "published",
      "state": "withdrawn"
    },
    {
      "contentVersion": "fd-20260715-r2",
      "previousState": "superseded",
      "state": "published"
    }
  ],
  "activeContentVersion": "fd-20260715-r2",
  "effectiveAt": "2026-07-14T23:00:00+08:00"
}
```

简单动作的 `transitions` 只有一项；撤回带替代版本或回滚时必须列出所有被原子改变的版本。`activeContentVersion` 表示事务完成后的安全版本，没有活跃版本时为 `null`。响应头返回 `X-Request-Id` 与新的生命周期 `ETag`。

## 17.5 错误响应

```json
{
  "error": {
    "code": "CONTENT_NOT_READY",
    "message": "今日内容正在校验中，请稍后重试。",
    "retryable": true,
    "requestId": "req_01J...",
    "details": {}
  }
}
```

| HTTP | 错误码 | 场景 |
|---:|---|---|
| 400 | `INVALID_ARGUMENT` | 参数格式错误 |
| 400 | `INVALID_FORTUNE_DATE` | 命理日期格式或范围错误 |
| 401 | `UNAUTHENTICATED` | 后台未登录 |
| 403 | `FORBIDDEN` | 无对应权限 |
| 403 | `SELF_APPROVAL_NOT_ALLOWED` | 编辑过该模块的人员尝试审核同一模块 |
| 404 | `CONTENT_NOT_FOUND` | 指定日期没有可公开内容 |
| 404 | `LOOK_NOT_FOUND` | 搭配不存在于当前版本 |
| 409 | `CONTENT_VERSION_CHANGED` | 客户端版本与活跃版本不同 |
| 409 | `VERSION_CONFLICT` | 草稿被他人更新或活跃指针已变化 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 同一幂等键被用于不同请求体 |
| 409 | `INVALID_STATE_TRANSITION` | 当前状态不允许该操作 |
| 409 | `VERSION_WITHDRAWN` | 尝试发布或回滚到已撤回版本 |
| 410 | `HISTORICAL_CONTENT_EXPIRED` | 历史公开内容超过保留期 |
| 412 | `REVISION_MISMATCH` | `If-Match` 与当前草稿或生命周期修订号不一致 |
| 422 | `REQUIRED_REVIEW_MISSING` | 必审模块未全部通过 |
| 422 | `PUBLISH_PRECHECK_FAILED` | 五档、图片、海报模板或引用校验失败 |
| 422 | `SCHEDULE_TIME_INVALID` | 排期时间不符合生效区间 |
| 428 | `PRECONDITION_REQUIRED` | 需要并发保护的写操作缺少 `If-Match` |
| 429 | `RATE_LIMITED` | 海报或反馈请求过于频繁 |
| 503 | `CONTENT_NOT_READY` | 当前命理日尚无已发布内容 |
| 503 | `POSTER_GENERATION_UNAVAILABLE` | 海报服务不可用，但基础内容仍可展示 |

## 17.6 缓存与原子更新

- `/today` 和非版本化每日接口使用动态共享缓存时长 `N = min(60 秒, 距 effectiveTo 的秒数, 距下一时辰边界的秒数, 距下一民用午夜的秒数)`；
- 推荐响应头为 `Cache-Control: public, max-age=0, s-maxage=N, must-revalidate`；不得通过 `stale-while-revalidate` 或其他过期复用机制跨越上述任一边界；
- 到达边界后的首个请求必须重新解析完整 `requestContext`，不得只替换 `civilDate` 或单个字段；
- `ETag` 使用完整响应表示的哈希并支持 `If-None-Match`；`X-Content-Version` 单独返回业务版本，不得把二者混用；
- 本地缓存键包含 `fortuneDate + contentVersion`；
- 本地缓存到达 `effectiveTo` 后过期，离线状态不得继续当作今日内容展示；
- 内容处于可公开状态时，带内容哈希的图片和海报实例可使用长期不可变缓存；
- 发布、撤回和回滚后立即清除系统控制的活跃接口和 CDN 别名缓存；版权或合规撤回的素材还必须对源站与 CDN 执行 purge 或 deny，新请求不得继续获取；
- 客户端只有在新内容包完整下载、引用校验通过后，才一次性替换旧内容；
- 已下载、截图或外部转发的内容不属于可清除缓存范围。

## 17.7 版本规则

`contentVersion` 锁定以下版本组合：

```json
{
  "contentVersion": "fd-20260715-r3",
  "calendarDataVersion": "calendar-20260715-r1",
  "calendarRuleVersion": "fortune-date-23h-v1",
  "algorithmVersion": "wx-public-1.0.0",
  "copyVersion": "copy-20260715-r2",
  "outfitVersion": "outfit-20260715-r3",
  "assetManifestVersion": "assets-20260715-r2",
  "posterTemplateVersion": "poster-template-v3"
}
```

任一业务内容组成部分或海报模板变化都生成新的 `contentVersion` 并重新走对应模块审核。按既定模板、平台和渠道派生的 `posterInstanceId` 不属于该组合；只重渲染入口码或渠道标识不生成新 `contentVersion`。不得只替换图片或文案而继续沿用旧版本。

## 17.8 双端复用与适配边界

必须复用：

- 服务端日历、日柱、五行、五档和颜色归类结果；
- 每日内容接口和字段定义；
- `fortuneDate`、各版本号和内容 ID；
- 颜色表、档位名、标准文案和禁词配置；
- 埋点名称、属性和统计口径；
- 黄金测试数据与 23:00 边界用例；
- 设计令牌，包括颜色、字号、间距和圆角语义。

允许分别适配：页面导航、微信分享与浏览器分享、小程序码与 H5 二维码、相册保存、剪贴板、权限申请、登录、提醒、本地存储和平台发布流程。

不要求为了代码复用强行选择某一跨端框架，但不得复制业务算法。所有埋点至少包含：

```json
{
  "platform": "h5 | wechat_miniprogram",
  "sourcePlatform": "h5 | wechat_miniprogram | null",
  "targetPlatform": "h5 | wechat_miniprogram | null",
  "fortuneDate": "2026-07-15",
  "contentVersion": "fd-20260715-r3",
  "channelId": "organic",
  "anonymousId": "channel_local_id",
  "userId": null
}
```

`platform` 是事件实际运行端；`sourcePlatform` 与 `targetPlatform` 只在分享、海报和落地链路中填写，其他事件可为 `null`。`anonymousId` 仅用于隐私政策允许的匿名分析；未建立统一身份前，不承诺 H5 与微信小程序匿名用户自动合并。

# 18. 个人五行/八字模块（P2，方向记录）

## 18.1 功能目标

帮助用户理解公共每日建议如何结合个人出生信息进行调整。当前只确认产品方向与时间边界，不确认完整排盘和吉凶算法。

## 18.2 B01 出生信息输入候选

- 公历/农历（转换规则待确认）；
- 出生年月日；
- 精确出生时间或直接选择时辰；
- “不知道时辰”；
- 出生城市（是否必填待确认）；
- 性别（是否需要待确认）。

用户填写 23:00 至 23:59 时，页面必须提示：

> 按本产品采用的传统时辰规则，23:00 后进入次日子时，排盘日柱将按次一命理日计算。

## 18.3 未知时辰

- 不得默认 12:00 或任意时辰；
- 只输出不依赖时柱的基础结果；
- 明确标识“结果未纳入时柱”；
- 不展示看似精确但实际依赖时柱的结论。

## 18.4 数据保存

同时保存原始与计算值：

```json
{
  "civilDateTime": "1995-05-08T23:30:00+08:00",
  "fortuneDate": "1995-05-09",
  "shichen": "子",
  "dayBoundary": "23:00",
  "birthplace": null,
  "calculationRuleVersion": "bazi-tbd"
}
```

## 18.5 B02/B03 输出候选

- 四柱基础信息；
- 五行概况；
- 结果完整度；
- 今日公共参考；
- 个人调整；
- 最终穿搭建议；
- 解释公共与个人差异。

所有输出范围、强弱计算、用神或其他理论均为待确认，不得依据网络通用算法擅自实现。

# 19. 生肖、星座与宜忌（后续）

## 19.1 生肖

- 可作为低门槛身份和内容入口；
- 当前已确认生肖地支五行映射可用于公共五档分组；
- 出生年份生肖分界规则仍待确认；
- 不与另一套合冲生肖体系混用，除非老师给出独立规则和解释。

## 19.2 星座

- 暂不参与五行、八字或穿衣推荐的核心计算；
- 可作为未来轻内容、标签和分享玩法；
- 星座内容必须标明独立来源，不与八字结论混成一个总分。

## 19.3 低风险宜忌

候选允许类别：

- 宜整理、复盘、沟通、推进已有事项、休息、日常社交；
- 建议放慢节奏、减少争论、减少临时加码；
- 穿搭、配色、作息等日常参考。

禁止或需专业评审：

- 投资、医疗、法律、赌博；
- 离婚、辞职、买房、生育等重大代决策；
- 重大婚丧嫁娶和商业签约择日；
- 以绝对吉凶替代专业判断。

# 20. AI 问事（P3，独立立项）

- 当前 PRD 不要求开发可用入口；
- 上线前必须另行完成安全与隐私规范；
- 明确展示 AI 身份，不使用“老师正在真人回复”的误导表达；
- 医疗、投资、法律、违法、赌博等直接拦截；
- 重大人生决定只帮助梳理，不替用户拍板；
- 对话数据与出生数据分开授权、保存和删除；
- 需要人工应急、投诉和下线机制。

# 21. 非功能需求

## 21.1 性能

- 首页关键数据接口目标 P95 小于 800ms；
- 有缓存时首屏可见目标小于 2 秒；
- 海报异步生成，前台展示明确进度和失败重试；
- 图片使用多尺寸与渐进加载。

## 21.2 可访问性

- 正文 15 至 16px 起；
- 点击区域不小于 44×44px；
- 色彩不是唯一标识；
- 浅色圆点有边框；
- 提供大字模式；
- 重要文字与暖米白背景保持足够对比。

## 21.3 隐私与安全

- 公共功能无需出生信息；
- 个人功能按字段说明用途并单独确认；
- 出生数据、家人数据与对话数据分开处理；
- 提供修改、导出、清空和删除；
- 管理后台执行最小权限和审计日志；
- 不默认使用出生信息或对话训练模型。

## 21.4 可靠性

- 日历和算法服务有自动测试；
- 发布流程有审核和双人复核能力；
- 存在同日历史安全版本时可回滚；没有安全旧版本时可立即撤回并进入内容不可用状态；
- 23:00 切换有监控和报警；
- 图片生成失败不影响基础五行结果。

# 22. 埋点与指标

## 22.1 P0 核心事件

- `view_today_summary`；
- `view_all_tiers`；
- `open_outfit_hub`；
- `view_daily_look`；
- `view_look_detail`；
- `share_summary_initiated`：用户触发系统分享或复制摘要链接时记录，不宣称外部发送成功；
- `share_poster_initiated`：用户从海报页发起可观测分享动作时记录；
- `poster_save_requested`、`poster_save_succeeded`、`poster_save_failed`：分别记录保存请求及最终结果；
- `poster_landing_view`：入口页成功解析后记录，属性至少含 `posterInstanceId`、`sourcePlatform`、`targetPlatform`、`sourceContentVersion` 和 `servedContentVersion`；
- `fortune_date_switch_result`：页面内跨日检查完成时记录，属性含 `result = succeeded | failed`、切换前后日期和失败原因；
- `open_algorithm_basis`；
- `submit_feedback`：提交反馈时记录，属性含 `category = content_error | product_feedback` 与提交结果；
- `change_font_size`；
- `clear_local_data`。

## 22.2 P1 核心事件

- `select_owned_colors`；
- `generate_owned_color_plan`；
- `save_look`；
- `remove_saved_look`；
- `start_login`；
- `complete_login`；
- `enable_notification`；
- `notification_landing_view`。

## 22.3 P2 核心事件

- `start_birth_profile`；
- `complete_birth_profile`；
- `delete_birth_profile`。

## 22.4 漏斗

P0：

`进入今日 → 看懂颜色 → 进入怎么搭 → 查看模特详情 → 分享或次日回访`

P1：

`进入今日 → 查看搭配 → 收藏/使用我的颜色 → 开启提醒 → 次日回访`

P2：

`看到个人入口 → 了解用途 → 开始填写 → 完成填写 → 查看个人调整 → 次日继续查看`

# 23. 核心验收用例

## 23.1 木日数据

`庚寅日 → 寅 → 木日`

- 大吉火：红、橙、紫、粉色系；
- 次吉木：绿、青、翠、湖蓝、浅绿系；
- 平金：白、乳白、银、金、浅色系；
- 较差水：黑、藏青、宝蓝、墨绿、深灰系；
- 不利土：黄、咖、棕、卡其、褐色系。

## 23.2 跨日边界

| `civilDateTime`（Asia/Shanghai） | `fortuneDate` | 日干支/日支/日五行 | 时辰 |
|---|---|---|---|
| 2026-07-23 22:59 | 2026-07-23 | 戊戌 / 戌 / 土 | 亥 |
| 2026-07-23 23:00 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-23 23:59 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 00:00 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 00:59 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 01:00 | 2026-07-24 | 己亥 / 亥 / 水 | 丑 |
| 2026-07-24 02:59 | 2026-07-24 | 己亥 / 亥 / 水 | 丑 |
| 2026-07-24 03:00 | 2026-07-24 | 己亥 / 亥 / 水 | 寅 |

该序列必须证明 `fortuneDate` 只平移一次：跨过民用午夜后不得再次加一天。

缓存链路同时验收：23:59 的 `/today` 响应不得跨民用午夜复用；00:00 即使 `contentVersion` 与时辰未变，也必须重新得到新的 `civilDate` 和 `crossedDayBoundary = false`。

## 23.3 内容一致性

- 首页、五档、模特配方和海报使用相同大吉/次吉/平结果；
- 图片主色与文字配方一致；
- 回滚后所有入口展示同一版本；
- 海报二维码落地到相同命理日期；
- 23:00 前后不会同时缓存两套错误内容。

## 23.4 H5 与微信小程序一致性

- 使用同一测试时刻打开两端，`fortuneDate`、日干支、五行、五档顺序和 `contentVersion` 完全一致；
- 两端相同 `lookId` 的标题、图片、配色比例和场景一致；
- 22:59、23:00、23:59、00:00 分别执行双端测试，业务日期和提示一致；
- 后台发布或回滚后，新打开的 H5 和小程序在 60 秒内读取同一活跃版本；
- 已打开页面重新进入前台或主动刷新时检查活跃版本；
- H5 分享链接和小程序分享路径均进入指定命理日期；
- H5 海报二维码和小程序海报码分别通过真机扫码验收；
- P0 全流程不得主动要求登录；用户拒绝相册权限后公共内容仍可完整使用，P1 拒绝登录或提醒权限后可返回公共内容；
- P0 页面不存在收藏、通知和账户的禁用按钮、空状态或假入口；
- P0 数据看板不存在收藏、登录和提醒指标；
- 双端公共页面均达到已有性能、字号和无横向滚动要求。

## 23.5 API、状态机与并发验收

- `tiers` 数量不为 5、排名重复或颜色引用无效时发布预检失败；
- 旧 `contentVersion` 的搭配详情请求返回 `CONTENT_VERSION_CHANGED`，客户端整包刷新；
- 两位运营同时修改草稿时，较晚提交者收到 `VERSION_CONFLICT`；
- 编辑过某模块的人审核同一模块时收到 `SELF_APPROVAL_NOT_ALLOWED`；
- 任一必审模块未通过时收到 `REQUIRED_REVIEW_MISSING`；
- 重复发送相同幂等键的发布或回滚请求只执行一次；
- `submit` 网络重试返回同一 `contentVersion`，不得重复生成快照；
- 新排期替换旧排期时同时返回旧版本 `scheduled → approved` 与新版本 `approved → scheduled`；同日其他版本审核不得使当前有效排期任务失效；
- 海报生成失败时基础今日内容仍可访问；
- 海报生成中途发生撤回或回滚时，旧任务返回 `version_changed` 且不公开制品，目标版本以新任务重新生成；
- 回滚原子切换活跃指针，不出现 H5、小程序和 CDN 分别读取不同版本；
- 无安全替代版本的撤回返回“今日内容校验中”，不得由 LLM 临时补算。
- 在预发环境或受控测试素材上完成一次版权/合规撤回的 CDN `purge/deny` 演练，验证活跃接口、素材源站和 CDN 新请求均停止提供被撤回内容。

“60 秒”是发布和回滚的活跃接口同步 SLA；如技术评审确认无法达到，必须在开工前替换为另一个明确数字。

# 24. 待确认清单

## 24.1 产品与商业

- 正式名称与品牌；
- 已确认：首发包含移动端 H5 和微信小程序，App 不进入本轮范围；
- 待排期：两端是否同日公开，可分批灰度，但均需通过 P0 验收；
- 首批模特目标人群；
- 会员权益、价格和未来预览范围；
- 男性与家庭用户何时纳入。

## 24.2 个人五行与八字（不阻塞 P0）

- 年柱与生肖分界；
- 个人排盘中的早晚子时流派细节；
- 出生城市、时区、真太阳时；
- 性别与排盘关系；
- 五行强弱、藏干、十神、旺衰、格局、大运范围；
- 公共与个人融合规则。

## 24.3 内容

- 用户可见五档别名最终版本；
- 配饰替代和减少比例标准话术；
- 每日穿搭小课堂选题机制；
- 生肖、星座和宜忌发布时间；
- 老师名号与 AI 化授权。

## 24.4 开发启动确认

以下事项不再留给研发在编码时自行猜测，必须通过技术设计或评审记录确认：

- 前端是共用跨端框架还是两端独立实现；无论选择哪种方式，均共用 API 和服务端规则；
- 后端语言、数据库、对象存储、CDN 和部署环境；
- H5 域名及微信小程序主体、类目、接口域名和平台审核条件；
- `/today` 的 `responseGeneratedAt` 语义、动态 `s-maxage`、边界禁止过期复用及边缘 `X-Request-Id` 方案；
- 60 秒发布/回滚同步 SLA 是否可达；
- 第 16.7 至 16.10 节状态机由产品、运营、业务老师和后端研发完成场景确认；
- 固定版本日历库的依赖审计、许可证留存和 366 日黄金数据生成方式。
- 首批图片主管线、权利证明、AI 显式/隐式标识、人工审核和失败降级方案。

# 25. 发布门槛

公开测试前必须满足：

1. 业务老师书面确认公共算法、颜色表、五档和 23:00 产品换日规则；
2. 工程侧完成国家标准锚点与固定版本离线库连续 366 个命理日机器比对且零差异；业务老师书面复核不少于连续 30 日及边界样本；
3. 核心页面完成目标用户任务测试；
4. 模特图具备审核、备选和下线机制；
5. 内容、海报模板、海报实例 `sourceContentVersion` 和活跃缓存版本一致；
6. 异常、离线、23:00 跨日、回滚及版权/合规撤回的 CDN `purge/deny` 测试通过；
7. 用户协议、隐私说明、内容参考声明和 AI 标识方案就绪；
8. 个人五行不得在详细算法未确认时上线；
9. AI 问事不得以占位入口诱导用户提前使用；
10. H5 与微信小程序的 P0 页面、跨日、分享、海报、发布和回滚一致性测试通过；
11. 两端均不存在 P1 功能的无效占位入口；
12. 微信小程序类目、文案、分享及所需权限按提交时的平台规则完成审核；
13. 两端用户协议和隐私说明准确披露本地数据、渠道参数、权限申请和跨端不同步边界；
14. 内容状态机、角色权限、并发保护、幂等和审计用例通过；
15. 公共 API、后台 API、错误码、缓存与版本切换契约通过联调。

# 26. 开发启动说明

## 26.1 当前结论

V2.2 已具备进入技术设计、任务拆分和并行开发的产品输入。正式工程落地前需完成第 24.4 节与具体实现直接相关的工程选型和确认；日历引擎、领域模型、固定数据页面骨架、后台信息架构和设计修订可并行启动。不得由客户端、后台或运营各自补充一套业务规则。

## 26.2 建议工作流

可以并行启动：

- 日历规则引擎、366 日黄金数据与边界测试；
- 公共 API、内容快照、活跃版本和状态机数据模型；
- H5 与微信小程序基于固定示例数据开发 P0 页面；
- 运营后台的信息架构、角色权限和审核页面设计；
- 海报模板、渠道参数和图片降级方案。

必须按顺序完成：

1. 冻结 OpenAPI/字段枚举与 `contentVersion` 语义；
2. 两端接入同一公共 API；
3. 接入发布、撤回、回滚和缓存失效；
4. 完成双端、并发、离线和 23:00 真机验收；
5. 满足第 25 章发布门槛后再公开测试。

## 26.3 V2.2 主要变化

- 明确 `/today` 缓存表示的时间语义、动态共享缓存时长、边界禁止过期复用及请求 ID 归属；
- 明确 F02 仅前三档提供“查看穿法”，较差与不利档不显示无目标箭头；
- 确认 P0 唯一首页为决策优先结构，并明确无底部 Tab、历史入口、出生信息和其他 P1/P2 占位；
- 明确授权素材与 AI 生成素材可共用数据模型，P0 不要求内置图像生成平台；
- 补齐 AI 显式/隐式标识、幂等键重试语义和 CDN `purge/deny` 演练要求；
- 明确 366 日机器比对由工程侧承担，业务老师负责不少于连续 30 日及边界样本的书面复核。

## 26.4 V2.1 基线变化

- 确认 H5 与微信小程序双端首发及职责边界；
- 确认基于国家标准锚点的确定性日干支方案，取消在线黄历 API 依赖；
- 补齐公共 API、后台 API、对象字段、错误码、缓存和版本契约；
- 增加不可变内容快照、活跃版本、审核、排期、撤回、回滚和审计模型；
- 把收藏、账户、主动提醒和增长分析统一归入 P1；
- 增加双端一致性、API、状态机与并发验收用例。
