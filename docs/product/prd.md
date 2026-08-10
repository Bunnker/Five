# Five 产品需求文档（PRD）

> 版本：V2.4（公开网页市场验证版）
> 日期：2026-08-09
> 首发形态：手机优先的响应式公开网页，用户通过微信群里的普通链接直接访问
> 当前开发范围：公共每日五行、穿搭方案、每日图片、分享、设置与帮助、单人运营后台
> 暂不开发：微信小程序、App、公开用户登录与账户、收藏、主动提醒、出生信息、个人五行、商品和吉祥物
> 文档状态：技术启动评审有条件通过；公共网页、后台业务接口和单人维护者安全入口已经冻结，可继续本地功能开发，完成部署与上线门槛后才可公开测试
> 本次修订：ADR-0030 将匿名数据报表提升为独立一级入口；ADR-0028 的北京时间 18:00 用户侧内容切换、独立 `servedFortuneDate`、13:00 准备截止和 23:00 命理换日继续有效

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

- 手机优先的响应式公开网页，无需登录即可访问；
- 微信群只承担链接分发，不依赖微信小程序能力；
- 今日日期、日干支、当日五行；
- 首页颜色决策摘要；
- 大吉、次吉、平、较差、不利完整五档提示；
- 单色/双色/三色穿搭；
- 每日 2 张必备图片和最多 1 张可选图片；
- 推算依据；
- 分享摘要和日签海报；
- 单人维护的内容审核、版本、海报与数据后台。

### 下一阶段

- 场景与人群筛选；
- 每日穿搭小课堂。
- 是否开发微信小程序、App、登录、收藏和主动提醒，必须依据网页验证结果另行立项。

### 后续预研

- 出生年月日时；
- 个人五行/八字；
- 个人今日调整；
- 家人档案、生肖、未来 7 天与低风险宜忌；
- 商品、吉祥物和付费服务。

## 0.2 首发渠道与职责边界（已确认）

### 公开网页

公开网页是 P0 唯一面向用户的产品，主要承担：

- 用户无需安装、无需登录即可查看今日公共内容；
- 承接微信群、公众号、二维码、复制链接和外部渠道访问；
- 提供今日摘要、今日颜色说明、搭配、每日图片详情、推算依据和海报；
- 使用浏览器能力分享、复制链接或下载海报；
- P0 不承诺系统级每日通知，也不保存跨设备用户数据。

### 微信群分发

- 运营者或大师把普通网页链接发到微信群；
- 用户点击链接后直接在微信内置浏览器打开；
- P0 不调用群成员信息、不自动发群消息、不要求微信授权；
- 真实微信群访问是上线验收场景，不是产品内置功能。

### 暂不开发的客户端

- 微信小程序和 App 不进入 P0，不预留空入口或假按钮；
- 后续若网页验证有效，可复用同一服务端规则与内容数据，另行开发客户端；
- 日柱、五行、五档和颜色归类由服务端统一给出，任何后续客户端不得复制一套算法。

## 0.3 V2.3 评审修订摘要

- 前端采用 Next.js、React 和 TypeScript，只做响应式公开网页；P0 不使用 Taro；
- 后端采用 TypeScript 模块化单体、NestJS、Fastify 和 PostgreSQL，首版不引入 Redis、Kafka 等额外组件；
- `/today` 保留最长 60 秒动态共享缓存，并在 18:00 公开内容切换、23:00 命理换日、时辰和民用午夜边界前提前失效；
- 内容采用八个兼容状态，由一名维护者操作；自动内容冻结后直接发布，大师在系统外查看用户端效果并留下发布后意见；
- 公共页面直接展示大吉、次吉、平、较差、不利五档，并给已经穿了较差或不利档颜色的用户提供大吉色普通配饰平衡建议；
- 日历使用固定答案表和黄金数据：工程侧机器比对 366 个命理日，大师书面复核连续 30 日及边界样本；
- 后台 Worker 自动维持未来 30 日的文字、穿搭和模特图候选，图片供应商可替换，用户访问时不触发生成；
- 每天自动准备 `required_primary` 与 `required_alternative` 两张必备图片；`optional` 默认 `not_requested`，不阻止准备、排期或发布；
- 美国服务器、域名、对象存储和 CDN 方案暂不冻结，属于公开上线阻塞，不阻止本地文档和基础工程准备。

# 1. 产品目标与验收目标

## 1.1 产品目标

1. 用户打开后在 10 秒内知道今天优先、稳妥和建议减少的颜色。
2. 用户无需理解复杂五行理论，即可得到一套能照着穿的搭配。
3. 系统自动计算日期结果、提前生产未来 30 日候选并直接发布或排期；维护者和大师在发布后查看用户端效果，有问题时以新版本替换、下线或恢复。
4. 分享内容离开当前页面后仍可独立看懂，并能够带回公开网页。
5. 用尽量少的维护工作验证用户是否愿意持续打开、查看和分享。

## 1.2 MVP 成功标准

- 首次可见核心结果时间不超过 2 秒（有可用缓存时）；
- 目标用户中至少 90% 能在 10 秒内找到优先色和建议减少色；
- 国家标准锚点与固定版本离线库完成连续 366 个命理日的机器比对且零差异；大师书面复核不少于连续 30 日及边界样本；
- 公开网页、公共 API 和后台活跃指针使用同一内容版本；海报实例记录相同的 `sourceContentVersion`；
- 18:00 用户内容切换、23:00 命理上下文切换和异常降级通过边界测试；
- 每日图片中的主要颜色与当日搭配结构一致；
- 内容可在后台一键撤回或回滚，已外发内容保留来源版本并将入口码导向当前安全版本。

# 2. 用户角色与状态

## 2.1 用户角色

| 角色 | 能力 |
|---|---|
| 匿名访客 | 通过公开链接查看今日内容、搭配、图片、依据和分享 |
| 单一维护者 | 登录后台，编辑、校验、发布、撤回、回滚并查看记录 |
| 大师（外部确认人） | 在系统外核对日历、五行、档位和颜色，留下可追溯的确认依据；不是后台账号 |

## 2.2 使用原则

- 游客在看到公共核心价值前不得被登录墙阻断；
- P0 不收集出生信息、账户信息或家人信息；
- 图片、未来功能和商业内容不得遮挡今日免费结果；
- 对低视力或中年用户，核心色名必须同时有文字和色块。

# 3. 信息架构

## 3.1 P0 信息架构

P0 不设置内容不足的空壳“我的”Tab。公开网页以“今日”为唯一首要入口：

1. 今日首页；
2. 今日颜色说明；
3. 今日怎么搭；
4. 搭配方案详情；
5. 推算依据；
6. 分享与海报；
7. 设置与帮助。

“今日颜色说明”“今日怎么搭”“推算依据”和“分享”均从今日首页进入；“设置与帮助”放在页面右上角或更多菜单中。网页使用普通页面返回关系，不设置小程序式底部导航。

P0 不提供“历史”“昨日”或日历浏览入口。公开的 `/daily/{fortuneDate}` 路由只用于分享落地、已外发海报和既有日期链接解析，不得据此在 P0 增加历史列表、日历或右上角历史图标。

## 3.2 P1 信息架构

P1 是否存在以及包含哪些个人功能，必须依据网页市场验证结果重新评审。V2.3 不预先固定“我的”、账户或收藏导航。

## 3.3 后续导航候选

个人五行上线后再评估“我的五行”和“日历”。生肖不占用 P0/P1 主导航。AI 问事只有在独立立项和安全评审后才允许新增入口。

# 4. 全局业务规则

## 4.1 命理换日与公开交付日（已确认）

> **命理日于 23:00 切换。23:00 至次日 01:00 为子时，23:00 即进入次一命理日。**

系统必须保留：

- 民用日期时间 `civilDateTime`；
- 命理业务日期 `fortuneDate`；
- 时辰 `shichen`；
- 时区 `timezone`；
- 换日配置 `dayBoundary = 23:00`。
- 公开交付日期 `servedFortuneDate`；
- 公开切换配置 `contentBoundary = 18:00`。

### 页面展示

- 00:00 至 17:59：`servedFortuneDate = civilDate`，公开端显示该日内容；
- 18:00 至 23:59：`servedFortuneDate = civilDate + 1 天`，公开端切换并显示下一公开内容日；
- 18:00 至 22:59：`requestContext.fortuneDate` 尚未推进，允许它与 `servedFortuneDate` 相差一天，响应必须同时明确两者；
- 23:00 至 23:59：命理 `fortuneDate` 追上 `servedFortuneDate`，并常驻提示“已进入次日子时”；23:00 不再次切换内容；
- 分享海报使用实际内容的 `servedFortuneDate`，必要时说明与当前手机民用日期的差异；
- P0 的正常内容生效、缓存失效和页面内内容切换以 18:00 为边界；23:00 只负责命理日与时辰上下文。

对命理日 `D`，公开窗口固定为 `[D - 1 日 18:00, D 日 18:00)`，因此 `effectiveFrom(D)` 为前一日 18:00，`effectiveTo(D)` 为当日 18:00。准备目标仍按 `prepareBy(D) = effectiveFrom(D) - 5 小时` 计算，即前一日 13:00。到达 18:00 缺少 `D` 的安全已发布内容时必须 fail closed，不得继续展示已越过 `effectiveTo` 的旧内容。

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
- 外部日历服务只允许在离线核验或维护排错时使用，不进入在线请求的单点依赖。

验证要求：

- 基准用例：1949-10-01 = 甲子日；
- PRD 示例：2026-07-15 = 庚寅日；
- 当前验证样本：2026-07-23 = 戊戌日，2026-07-24 = 己亥日；
- 完整覆盖 22:59、23:00、23:59、00:00、00:59 和 01:00；
- 覆盖月末、年末、闰年 02-29 以及早于基准日的负偏移；
- 同一组用例分别在进程时区 UTC、America/Los_Angeles 与 Asia/Shanghai 下运行，结果必须完全一致；
- 增加性质测试：相邻日期索引必须 `+1 mod 60`，任一日期加 60 天后必须得到同一干支；
- 上线前使用国家标准基准、固定版本离线库和大师样本三方核验；
- 机器黄金样本至少覆盖连续 366 个 `fortuneDate`，并保留 `calendarRuleVersion` 与生成脚本版本；
- 大师书面复核不少于连续 30 日，并覆盖 22:59/23:00、月末、年末和闰日样本；若老师样本与标准算法冲突，必须形成规则决策并升级 `calendarRuleVersion`，不得静默改数。

资料来源：

- 国家标准全文公开系统：[GB/T 33661-2017《农历的编算和颁行》](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=E107EA4DE9725EDF819F33C60A44B296)；
- 标准解读与甲子日锚点：[中国科学院紫金山天文台《农历编算和颁行》解读](https://pmo.cas.cn/xwdt2019/kpdt2019/202203/P020240201504886119982.pdf)；
- 离线库官方仓库：[6tail/lunar-javascript](https://github.com/6tail/lunar-javascript)，V1.7.7、MIT License、无运行时第三方依赖（核验日期：2026-07-23）。
- 公农历展示数据辅助核验：[香港天文台公历与农历日期对照表](https://www.hko.gov.hk/en/gts/time/conversion.htm)；
- 时区数据维护依据：[IANA Time Zone Database](https://www.iana.org/time-zones)。

## 4.6 内容表达

- 使用：建议、宜、参考、不妨、留意、优先、稳妥、减少；
- 禁止：保证、必然、转运、暴富、破财、大凶、灾、一定有效；
- “好运、贵人、助运、加分、事半功倍、运程、吉凶”等属于 P0 高风险表达，默认不进入用户文案；确需使用时必须由维护者逐条确认且不得构成效果承诺；
- 公开页面直接使用接口的 `algorithmLabel` 展示“较差”和“不利”，保留两档的独立顺序与颜色；表达今日建议降低使用比例，不使用警报视觉和恐吓文案；
- 用户已经穿了较差或不利档颜色时，可以建议用大吉色的丝巾、包、鞋、领带、耳饰或手机壳等普通配饰做小面积平衡；
- 搭配比例属于服装搭配建议，不属于五行算法事实，应明确标注“穿搭参考”。
- O02A 必须把硬禁词、效果承诺和高风险表达分别配置；机器检查负责拦截和提示，不能替代维护者检查。

# 5. 页面与功能清单

| ID | 页面/模块 | 优先级 | P0 形态 | 说明 |
|---|---|---:|---|---|
| F01 | 今日首页 | P0 | 公开网页 | 第一屏完成颜色决策 |
| F02 | 今日颜色说明 | P0 | 公开网页 | 展示大吉、次吉、平、较差、不利完整五档 |
| F03 | 今日怎么搭 | P0 | 公开网页 | 单色、双色、三色和每日图片 |
| F04 | 搭配方案详情 | P0 | 公开网页 | 含详情和分享，不含收藏 |
| F06 | 推算依据 | P0 | 公开网页 | 三步解释当日五行和内部五档关系 |
| F07 | 分享选择 | P0 | 公开网页 | 分享当天五行页面、复制页面链接或下载海报 |
| F08 | 日签海报 | P0 | 公开网页 | 使用普通网页二维码 |
| F10A | 设置与帮助 | P0 | 公开网页 | 字号、反馈、协议、清除本地数据 |
| F11 | 全局状态 | P0 | 公开网页 | 加载、离线、错误、18:00 内容切换与 23:00 命理上下文切换 |
| O01 | 每日内容审核 | P0 | 后台网页 | 单人校验、发布、撤回和回滚 |
| O02A | 基础内容与素材 | P0 | 后台网页 | 颜色、模板、图片、权利和 AI 标识 |
| O03 | 渠道与海报 | P0 | 后台网页 | 渠道参数、海报、生成状态 |
| O04A | 运营监控 | P0 | 后台网页 | 发布、错误、访问、转化和分享 |

微信小程序、App、F05 我的颜色、F09 主动提醒、F10B 我的账户、收藏、出生信息和个人五行均不在 P0 页面清单中。它们只有在网页验证有效并重新立项后，才能重新进入 PRD。

## 5.1 公开网页交互矩阵

| 场景 | 网页行为 | 验收结果 |
|---|---|---|
| 打开今日 | 点击微信群或其他渠道里的普通链接 | 无登录墙，直接看到今日结果 |
| 查看颜色 | 打开 F02 | 公开按算法顺序显示大吉、次吉、平、较差、不利五档 |
| 查看搭配 | 打开 F03/F04 | 方案 ID、图片和文案来自同一内容版本 |
| 分享当天页面 | 页面分享可用时调用，否则复制页面链接 | 对方打开完整五行页面；链接带 `fortuneDate`、渠道参数和版本 |
| 保存海报 | 浏览器下载、长按或系统分享 | 海报正文使用同一内容版本 |
| 打开海报 | 普通二维码进入网页落地页 | 落到正确命理日期 |
| 设置字号 | 浏览器本地保存 | 刷新后仍生效 |
| 清除本地数据 | 清除当前浏览器数据 | 不影响服务端公共内容 |
| 反馈错误 | 提交表单 | 后台记录平台、版本和日期 |

# 6. F01 今日首页

## 6.1 用户目标

在不滚动或轻微滚动的情况下知道：今天是什么日、优先穿什么、稳妥穿什么、哪些颜色建议减少，以及去哪里看具体穿法。

## 6.2 页面结构

1. 品牌、分享入口与“设置和帮助”更多菜单；
2. 大日期、星期、农历、日干支和“今日 X 日”；
3. “今日优先”卡：大吉五行与颜色；
4. “稳妥选择”卡：次吉五行与颜色；
5. “日常可穿”卡：平档，可在首屏下半部或展开后显示；
6. “较差”和“不利”两张独立卡：复用前三档的编号绶带、标题区和五列色点网格，分别展示档位名、颜色与减少使用说明；大吉色普通配饰建议独立放在第五档之后；
7. 今日怎么搭：单色、双色、三色缩略卡；
8. 今日图片示范：2 张必备图，额度和质量允许时增加第 3 张；
9. 主按钮“查看今日颜色”；
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
- 较差和不利档不使用红色报警或恐吓式强调。

## 6.5 唯一首页设计基线

P0 首页采用“决策优先”结构作为唯一实现基线：

1. 首屏先展示“今日优先”“稳妥选择”“日常可穿”三张正向档位卡；
2. 较差与不利必须各自复用前三档的卡片组件，形成连续五张同宽、同高、同色点网格的独立卡；不得使用合并大框、虚线分组或不同的信息布局；
3. “今日怎么搭”和“今日图片示范”位于颜色决策区之后，分别提供单色、双色、三色缩略卡和 2 张必备图、最多 1 张可选图；
4. 页面保留“查看今日颜色”“看看怎么搭”“为什么这样排”三个明确入口；
5. P0 不显示底部固定 Tab、“我的”“生肖”“我的五行”、出生信息横幅、收藏、拍照试搭或历史浏览入口；
6. 现有探索原型只作为视觉参考，若与本 PRD 冲突，以本节和第 3.1 节为准。

# 7. F02 今日颜色说明

## 7.1 页面结构

每张卡固定包含：

- 排名、档位名和用户解释名；
- 五行；
- 全部颜色；
- 一句关系解释。

公开页面固定为五块：

| 公开名称 | 对应内部算法 | 用户解释 |
|---|---|---|
| 大吉 | `da_ji` | 今日优先 |
| 次吉 | `ci_ji` | 稳妥选择 |
| 平 | `ping` | 日常可穿 |
| 较差 | `jiao_cha` | 今天减少大面积使用；已经穿了可用大吉色小配饰做平衡 |
| 不利 | `bu_li` | 今天优先减少使用；已经穿了可用大吉色小配饰做平衡 |

动作规则：

- 大吉、次吉、平显示“查看穿法”，进入 F03 并定位到使用该档颜色的方案；
- 较差、不利不创建负面详情，分别展示颜色、简短说明和普通配饰平衡建议；
- 页面底部统一提供“看看怎么搭”入口，进入 F03 默认方案；
- 公开网页、后台公开预览和海报必须使用 `algorithmLabel` 显示 `较差`、`不利`；兼容字段 `displayLabel: "注意"` 不得作为这两档的可见标题。

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

## 8.2 图片方案数量

P0 每日目标：

- 2 张必备图片：一张以大吉色为主的主方案，一张大吉色搭配次吉色的替代方案；
- 第 3 张可选图片使用大吉色搭配平色或提供另一高频场景，但默认不自动请求；维护者明确请求、上传或从未来搭配库选择时才增加；
- 至少覆盖通勤或日常休闲中的一个高频场景；
- 两个必备方案都必须预先冻结一张与原封面不同、来源和权利材料完整且审核通过的纯色单品板；原封面不可交付或后来单图下线时立即使用该降级素材，不能临时在线生成。

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

## 9.3 P0 边界

P0 不显示收藏、登录、购买、商品、吉祥物或“即将上线”占位。我的颜色、衣柜照片和账户功能必须在网页市场验证后重新立项。

# 10. 暂不开发的个人功能

我的颜色、出生信息、账户、收藏、提醒、历史记录和个人五行不属于 V2.3，也不作为 P0 的隐藏页面或接口。若市场验证后重新立项，必须重新写清用户价值、隐私范围和验收标准。

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

### 公开网页

- 用户在完整五行页面点击分享时，浏览器支持 Web Share API 就直接分享精确的 `/daily/{fortuneDate}` URL；URL 同时携带 `expectedContentVersion` 和 `channelId`，载荷只含页面标题和 URL，不预填长段分享文字；
- 微信内置浏览器中不得把用户带到只有操作说明的空壳页；保留完整五行页面，并引导用户使用右上角菜单发送给朋友或分享到朋友圈；
- 浏览器不支持页面分享时进入分享选择页，允许复制同一个指定日期 URL；
- 复制带渠道参数的今日链接；
- 进入日签海报页后自动创建海报任务；制品使用 PNG，准备完成后优先通过浏览器文件分享能力发送，浏览器不支持文件分享时退回指定日期页面 URL；
- 海报同时支持浏览器下载和移动端长按保存；
- 链接默认进入对应 `fortuneDate` 的公开网页落地页。
- 默认公开界面不展示“系统分享”“复制今日文字”等实现术语；分享按钮使用“分享当天五行页面”，接收方打开后直接看到完整五档、穿搭和模特图。

### 共同要求

- 分享参数至少包含 `fortuneDate`、`expectedContentVersion` 和 `channelId`；P0 只有网页，不额外传端类型；
- 分享链接不得携带出生信息、账户标识等敏感字段；
- 渠道参数不得改变五行、档位和搭配正文；
- 同一内容可按 `channelId` 生成多个海报实例，正文与 `sourceContentVersion` 一致，只允许入口码和渠道标识不同；
- 普通 H5、Web Share API 和微信 JS-SDK 都不能静默把内容直接发给微信好友或朋友圈，最终目标与发送确认必须由用户完成；页面只能记录“发起分享”，不能声称外部发送成功；
- 定制微信分享卡片属于部署集成：必须具备对应 JS-SDK 权限的认证公众号、已配置的 JS 接口安全域名和服务端签名；`appSecret`、`jsapi_ticket` 等凭据不得进入浏览器或公开接口。未满足这些条件时只提供微信右上角菜单、页面 URL 和海报保存路径。

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
- 后端海报制品为可预览、可下载且可供浏览器文件分享的 PNG，不把 SVG 作为当前公开交付格式；
- 已发布不可变快照中的旧模板版本必须由渲染适配层显式兼容并输出当前 PNG，不能为修复海报而原地改写历史 `contentVersion`；
- 海报生成时的 `sourceContentVersion` 必须与页面内容一致；回滚后历史图片保留来源版本，入口页同时记录请求版本与实际服务版本并提示已更新；
- 不得使用来源不明的公众号或杂志图片；
- 网页海报二维码可被普通相机或微信识别并进入正确日期；
- 浏览器不支持直接保存或用户拒绝权限时，仍可返回页面、长按或复制链接，不得导致流程卡死；
- 历史海报保留生成时的数据快照和渠道信息。

# 13. F10 设置与帮助

## 13.1 P0 页面内跨日提示

18:00 内容切换属于 F11 全局状态，不属于主动通知：

- 用户正在页面内时，17:59 至 18:00 自动切换或提示刷新；
- 用户重新进入、刷新或从后台恢复时，检查服务端 `servedFortuneDate`；
- 22:59 至 23:00 只刷新命理 `fortuneDate`、时辰与子时提示，不得再次切换或重复发布同一内容；
- 不要求通知权限；
- 不得因为用户未开启通知而显示越过公开窗口的旧内容。

## 13.2 F10A 设置与帮助（P0）

- 字号设置；
- 反馈入口：统一承载功能建议和内容纠错，并要求用户选择反馈类别；
- 关于；
- 用户协议；
- 隐私政策；
- 清除当前浏览器的本地数据。

P0 中该页面不使用“账户中心”含义，不展示通知、收藏、登录、导出或注销占位。

主动提醒和我的账户不进入 P0，页面中不得出现对应入口。

# 14. F11 全局状态

| 状态 | 产品行为 |
|---|---|
| 首次加载 | 使用骨架屏，不用长时间装饰动画 |
| 网络错误 | 仅显示仍处于 `[effectiveFrom, effectiveTo)` 的已审核缓存并标注更新时间；缓存已过期或不存在时提示重试 |
| 内容未审核 | 展示“今日内容校验中”，不得用 LLM 临时补算 |
| 离线 | 仅展示未过期的已审核内容 |
| 17:59→18:00 | 原子切换到新的 `servedFortuneDate`；加载失败或新日无安全内容时 fail closed 并显示“今日内容校验中”，不得继续展示越过 `effectiveTo` 的旧内容 |
| 22:59→23:00 | 保持当前内容版本，只更新命理 `fortuneDate`、时辰与“已进入次日子时”提示；不得重复发布 |
| 版本回滚 | 页面、公共接口和 CDN 别名切换；绑定旧版本且未完成的海报/待发送任务取消，目标版本以新任务重新入队；已外发内容保留来源版本 |
| 图片失败 | 使用审核过的搭配模板或纯色单品板降级 |

# 15. 每日图片内容生产要求

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

P0 不在用户请求时临时生成图片。后台 Worker 在独立生产任务中提前生成未来 30 日候选并上传到自己的文件存储：

1. 系统生成结构化搭配配方；
2. 图片生成适配器调用 GPT Image 2；独立中转接口可以作为可替换备用通道；
3. 每天自动生成 2 张必备图；可选槽位默认保持 `not_requested`，只有维护者明确操作时才生成或补入；
4. 自动检查主色和禁止元素；
5. 维护者检查人物、服装结构、颜色、场景、权利和 AI 标识；
6. 大师只核对五行与颜色关系，不承担时尚审美全责；
7. 每个制品记录 `sourceType`、素材哈希、供应商无关的 `generationMethod`、来源材料引用、权利证明、审核结果和 AI 标识状态；AI 生成制品必须另记录生成模型、提示词版本、生成时间和 `reproductionReference`；非 AI 制品的这些生成字段可以为空；
8. Worker 始终维护从当前命理日起未来 30 日的滚动窗口；质量稳定且额度允许时，才通过新决策扩大窗口；
9. 图片先绑定 `draftId + fortuneDate` 上传，草稿提交时在同一事务中冻结引用并绑定 `contentVersion`；每张图片必须保存至少一个来源材料引用和一个权利记录引用；两个必备槽位必须同时冻结与原封面不同、审核和权利状态均已通过的降级素材，原图不通过时直接交付该素材。

“2 张必备、最多 1 张可选”只统计公开方案的封面槽位：`required_primary`、`required_alternative` 和最多一个 `optional`，各槽位的 `coverAssetId` 分别唯一。自动生产只请求两个必备槽位；`optional=not_requested` 不是缺图或异常。方案详情的细节图、降级卡片和原始候选素材不计入 2+1；`detailAssetIds` 保持现有兼容上限。

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

后台逐图检查必须保存结构化结果，至少包含 `colorAndCopyConsistency`、`garmentAndPersonIntegrity`、`rightsAndIdentityRisk`、`scenarioAndImitability`、`mobileAndWechatPreview` 与 `aiLabelCompliance`，并记录 `reviewId`、`reviewerAccountId`、`reviewedAt` 和备注。两个必备槽位的原封面可以不通过，但各自必须冻结同一快照内不同于原图、已审核且可安全交付的降级素材，否则提交与发布预检失败；可选封面质量不足时直接省略。

## 15.4 合规依据

- 国家互联网信息办公室等四部门发布的[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)，自 2025-09-01 起施行；
- 图片模型或中转服务在使用时生效的服务条款；
- 网页部署、对象存储、CDN 和传播平台在上线时生效的内容规则。

法规、强制标准和平台规则可能更新。正式投产、导出和提审时必须按当期规则复核，不得把本 PRD 视为一次性完成的法律结论。

# 16. 运营后台

## 16.1 O01 每日运营

- `/admin` 默认进入“今日”，普通一级导航只保留“今日”“日历”“数据”“异常”；安全设置、恢复旧版本、审计、高级配置和紧急控制进入“更多”或高级入口；
- “今日”清楚区分“当前·用户正在看到”和“下一日·准备情况”，分别显示 `servedFortuneDate`、状态、更新时间、必备图片 `0/2` 至 `2/2` 和可操作问题；
- “日历”按月显示公历日期、当日五行或主色、发布或准备状态和必备图片完成度；点击日期进入详情，不在日期格密集展示模特图；
- “异常”只显示会影响用户或下一次发布且维护者现在能处理的问题；可选图片 `not_requested`、缺失或省略均不进入异常中心；
- 日期详情显示与真实公开展示同源的 375px 手机预览。后台和公开网页共享同一个每日展示投影模块及用户端展示组件，不维护第二套五档、穿搭或图片排序规则；
- 点击具体文案或图片时，只打开对应的上下文订正控件。普通订正允许修改非算法展示文案、穿搭说明和图片；五档颜色、五档顺序、五行推导、`fortuneDate`、业务时间和时辰结果只读；
- 当前 `servedFortuneDate` 的主操作为“保存并立即替换”，未来日期为“保存并在具体日期 18:00 生效”。服务端根据同一次生成的 `RequestContext`、公开交付上下文和公开窗口决定发布或排期，网页不得自行选择业务时间；
- 北京时间 13:00 是下一 `servedFortuneDate` 准备完成截止，18:00 是用户侧正常内容生效边界；23:00 只推进命理 `fortuneDate` 与时辰，不再次发布；
- 图片 Worker 默认只生成两张必备图；缺图或图片不合适时允许单槽位重新生成、手动上传，未来可从搭配库选择；可选槽位默认 `not_requested`；
- 原始 JSON、草稿与版本编号、低层生命周期操作和工程日志只放高级入口，不作为普通维护者的日常页面；
- 所有订正继续创建新草稿与不可变版本，并保留修订号、`If-Match`、幂等、事务排期或替换、缓存失效、审计、单图下线和安全恢复。

后台新增深模块 `AdminOperationsReadModel`，由其统一读取今日概览、月历、日期详情和可操作异常，并在实现内部组合请求上下文、内容生命周期、排期、自动生产和图片交付投影。网页只消费该模块的结果，不自行推导日期、发布状态或图片完成度。

## 16.2 O02A/O02B 内容与素材库

P0 的 O02A 包含：固定颜色、固定场景与人群枚举、素材标签绑定、搭配公式、配饰库、每日图片与权利信息、`sourceType`、`generationMethod`、生成模型、提示词版本、生成时间、重现引用、来源材料、结构化人工检查、AI 标识状态、硬禁词、效果承诺、高风险表达、必要模板和失败备选模板。

P1 的 O02B 增加：可复用搭配图库、自定义标签管理、场景与人群筛选 UI、穿搭小课堂选题、提示词管理 UI、批量管理和素材效果分析。搭配图库按颜色组合、场景、人群、来源和历史表现检索已有模特图，避免相同穿法每日重复生成；仍复用 `AdminImageAsset`，不另建供应商绑定的素材模型。

## 16.3 O03 渠道与海报

- 微信群、公众号、用户分享等渠道参数；
- 海报预生成和二维码；
- 生成失败报警；
- 扫码和落地转化数据。

## 16.4 O04A 运营监控（P0）

- “数据”使用独立一级入口，默认展示最近 7 个服务端内容日期，并允许切换最近 30 日；“今日”只保留不妨碍内容运营的精简当日摘要和完整报表入口；
- 公开网页访问量、匿名访问人数及口径说明；
- 今日首页到搭配详情的转化；
- 摘要分享动作发起、海报分享动作发起、海报保存结果和海报回流；不得把无法观测的外部实际发送次数称为“分享成功量”；
- 接口错误、图片失败、内容错误和投诉；
- 每日内容生成、审核、发布和回滚状态；
- 18:00 用户侧内容切换成功率；
- 23:00 命理上下文推进且无重复发布的成功率；
- 按 `channelId` 和 `contentVersion` 筛选。

数据页使用折线图展示 PV 与匿名浏览器趋势，使用柱状图展示搭配查看、分享发起和可验证回流，使用饼图展示渠道来源。渠道饼图按可加总的 PV 计算；同一匿名浏览器可能跨多个渠道，不得把分渠道匿名浏览器数相加构成整体。行为柱状图只表示并列行为趋势，不是严格漏斗，不暗示同一批浏览器必然按固定顺序完成每一步。

所有报表只读取第一方真实埋点，不使用 demo、随机数、硬编码趋势或固定为零的占位数据。真实零事件日期保留在时间序列中；整个范围无事件时显示“暂无真实访问数据”；采集未配置、聚合读取失败或响应不完整时显示“统计暂不可用”并隐藏不完整图表。图表必须有可访问名称、图例和等价数值说明，颜色不是唯一编码，375px 宽度不得产生页面级横向滚动。

## 16.5 O04B 增长分析（P1）

- 次日、7 日和 30 日留存；
- 收藏数量、收藏率和取消收藏率；
- 我的颜色使用与方案生成转化；
- 提醒授权、发送和回访；
- 登录用户与匿名用户分层；
- 版本和渠道效果对比。

P0 看板不得显示尚未上线的收藏、账户或提醒指标，也不得用固定为零的数据冒充已完成埋点。

## 16.6 内容域术语

| 术语 | 定义 |
|---|---|
| 内容草稿 `ContentDraft` | 维护者可编辑的工作副本，不对用户公开。 |
| 内容快照载荷 `ContentSnapshotPayload` | 草稿提交审核时生成的不可变内容副本，使用唯一 `contentVersion` 标识；只保存当时已经存在的业务内容和版本引用。 |
| 生命周期投影 `ContentLifecycleProjection` | 由审核、排期、发布、撤回和回滚事件计算出的当前状态，可重建但不得反向修改快照载荷。 |
| 大师确认依据 `MasterReviewEvidence` | 大师在系统外确认后，由维护者记录确认人、确认时间、覆盖日期、意见和附件或链接。 |
| 审核与发布记录 | `MasterReviewEvidence`、`ReleaseEvent` 和 `AuditEvent` 均追加写入并引用 `contentVersion`，不嵌入不可变快照载荷。 |
| 活跃版本 `ActiveVersion` | 某个 `fortuneDate` 当前唯一允许公共端读取的内容快照。 |
| 回滚 | 将活跃版本指针重新指向一个历史已批准快照，不修改历史快照本身。 |
| 撤回 | 阻止某个快照继续公开访问；被撤回版本不得直接重新发布。 |
| 内容模块 | 日历算法、五档与文案、搭配公式、图片与版权、海报一致性。 |
| 图片交付投影 `ImageAssetDeliveryProjection` | 由提交时的版本绑定和之后追加的单图下线事件计算出的当前图片交付状态；原封面初始不合格时也可直接选择同快照降级素材或省略 optional，无须伪造下线事件；可交付且未下线的细节图必须完整交付，不得静默省略。 |
| 图片封面槽位 `imageSlot` | `required_primary`、`required_alternative` 或 `optional`；自动生产只请求两个必备槽位，`optional` 默认 `not_requested`。历史候选的槽位允许未知，但不得按上传时间、完成顺序或数组位置猜测。每天 2+1 的数量只统计封面槽位，不统计细节图、降级图和候选图。 |

公开网页、后台和公共 API 共用相同的内容快照和活跃版本。展示层使用 `algorithmLabel` 直接显示完整五档；兼容分组元数据不得改变日柱、五档、颜色、搭配配方或 `contentVersion`。

## 16.7 内容状态机（已确认）

### 内容状态

| 状态 | 含义 | 允许的下一状态 |
|---|---|---|
| `draft` | 维护者可编辑的草稿，尚未生成不可变快照 | `approved`（默认）、`in_review`（兼容历史） |
| `in_review` | 已提交审核，快照已冻结 | `approved`、`changes_requested` |
| `changes_requested` | 至少一个必审项退回 | 无；从该快照复制生成新 `draft` |
| `approved` | 已冻结、可以立即发布；发布后检查可继续补充 | `scheduled`、`published` |
| `scheduled` | 已设置在 `effectiveFrom` 自动生效 | `approved`、`published` |
| `published` | 当前活跃版本 | `superseded`、`withdrawn` |
| `superseded` | 曾发布，现被新版本或回滚替代 | 可作为回滚目标重新进入 `published` |
| `withdrawn` | 已经发布过，但因内容、版权或合规问题停止公开 | 终态；恢复时必须复制为新草稿并重新审核 |

“回滚”是一次操作和审计事件，不作为长期状态。回滚成功后，目标快照变为 `published`，原活跃快照变为 `superseded`。

每个 `fortuneDate` 只有一个排期槽，并拥有独立 `scheduleSlotRevision`。新版本替换旧排期时必须在一个原子事务中完成：旧版本 `scheduled → approved`、新版本 `approved → scheduled`，同时递增该日 `lifecycleRevision` 与 `scheduleSlotRevision`；动作响应的 `transitions` 必须同时返回两项。被取消或被新排期替换的旧任务进入终止状态，不得继续重试或覆盖活跃指针。

有效排期任务执行失败时不新增业务状态：快照保持 `scheduled`，系统追加失败事件、按退避策略自动重试并报警。任务记录 `contentVersion + scheduleSlotRevision`，每次执行或重试前只校验排期槽仍指向自己且槽修订号一致；其他版本的普通审核不得使有效排期失效。只有发布原子事务成功后才进入 `published`。

```text
draft
  → 提交并冻结为 approved
      → scheduled → published
      → published
          → 发现问题 → 复制为新 draft → 新版本 published
          → superseded
          → withdrawn

superseded → 回滚操作 → published
```

### 必审检查

| 检查项 | 内容 | 确认方式 |
|---|---|---|
| `calendar_algorithm` | 干支、地支、日五行、五档顺序、颜色归行 | 机器校验 + 大师外部确认依据 |
| `copy_and_formula` | 首页文案、关系解释、搭配公式、禁词 | 维护者检查 |
| `visual_and_rights` | 图片结构、颜色、肖像、品牌、版权、AI 标识 | 维护者检查 |
| `poster_consistency` | 日期、档位、配方、网页二维码和来源版本一致性 | 系统校验 + 维护者检查 |

这些检查项用于发布后提示、追溯和修正，不阻止本地首次发布。提交后的内容、素材引用和版本号不得原地修改。

## 16.8 角色与权限

P0 只有一个后台账号，由项目维护者使用。该账号可以创建、编辑、提交、检查、排期、发布、撤回和回滚；Issue #39 起大师依据和人工检查改为发布后补充。

大师不登录后台。维护者把待确认内容导出或发链接给大师，大师通过微信、文件批注或其他可留存方式确认。维护者只负责把确认依据原样登记到后台，不能替大师补写结论。

单人维护的补偿措施：

- 所有发布、撤回和回滚动作必须填写原因并追加审计记录；
- 后台显示完整检查清单，但未勾完不阻止首次发布；
- 大师确认依据可在发布后补充，不阻止内容进入 `approved`；
- 高风险动作要求再次输入当前内容版本或明确确认，避免误点；
- 后台登录遵守 ADR-0022 与 ADR-0026：账号只通过空凭据库上的交互式命令首次创建；至少 8 位密码校验成功后直接建立会话；
- 生产会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/admin` 且无 `Domain`，闲置 30 分钟、绝对 12 小时失效；所有后台写操作同时校验可信同源 `Origin` 和会话绑定的 CSRF 令牌；
- 忘记密码时只允许服务器管理员运行交互式离线重置；重置提升凭据修订号、撤销全部会话并追加安全审计；
- 登录在正文解析前先按单向请求来源指纹做 PostgreSQL 限流；严格解析并规范化账号后、昂贵密码校验前再做账号级限流，不存在的账号也按唯一账号当前哈希参数执行等价工作量校验；
- 登录、退出、限流、CSRF 拒绝、离线重置和紧急控制追加安全事件，至少保留 365 天且不记录任何凭据原文。

全局紧急停止与恢复都要求当前安全会话、可信 Origin、CSRF、非空原因、精确确认短语、开关 ETag 和 `Idempotency-Key`。停止短语为“停止全部公开内容”，恢复短语为“恢复全部公开内容”。开关关闭后，今日、指定日期、搭配、海报创建/查询和受控海报素材读取在源站统一返回 `503 PUBLIC_ACCESS_STOPPED`；帮助、反馈和健康检查保留。已经下载或外部转发的副本无法召回，正式 CDN 联动仍须在部署阶段验证。

## 16.9 发布、撤回与回滚规则

首次发布只要求内容可以形成完整的用户端响应，并保持单一活跃版本、并发保护和幂等。以下项目改为发布后检查清单，不再阻止首次发布：

1. 所有必审检查均已通过；
2. 日历与五档自动校验通过；
3. 大师确认依据已记录；
4. `tiers` 恰好为五档且顺序唯一；
5. 单色、双色、三色方案齐全；
6. `required_primary` 与 `required_alternative` 各自冻结与原封面不同、来源和权利完整且审核通过的降级模板；交付时原封面可用则使用原图，否则使用该降级素材；最多一个 `optional` 封面槽位不阻塞发布，细节图不计入 2+1；
7. 图片、公式和海报模板均引用同一 `contentVersion`；
8. 海报模板渲染校验和至少一条网页分享落地链路可用；单个渠道海报实例异步生成失败不阻断基础内容发布；
9. 当前活跃版本与发布操作读取到的版本一致，避免并发覆盖。

正常排期时间固定为内容的 `effectiveFrom`，即目标日期前一日北京时间 18:00。未来内容不得早于该公开窗口交付。

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
- 已下载或已转发海报无法远程收回；其来源版本必须可审计，入口码应落到当前安全版本；
- 回滚不得自动再次向微信群或其他渠道发送内容，是否发布纠错说明由维护者人工确认。

## 16.10 状态机确认方法

以下场景已经作为 P0 的开发基线。维护者开发后台时必须逐条做成可测试行为：

1. 提交后发现一句文案错误：不得修改原快照，复制为新草稿；
2. 大师退回五档：整个版本不能发布；
3. 内容提前一天审核完成：进入 `scheduled`，在 `effectiveFrom` 自动生效；
4. 发布后发现图片版权问题：立即撤回并指定安全旧版本；
5. 新版本效果不佳但没有合规问题：回滚旧版本，不复制内容；
6. 同一维护者因网络重试或多次点击发布：只执行一次，重复请求得到同一结果；
7. 用户打开旧海报：图片本身不能收回，但入口码落到当前安全版本并提示版本已更新。

如果产品决定改变任一状态语义，必须先更新本节和 ADR，再修改代码，不能在开发过程中临时改变。

## 16.11 不可变快照与审计

内容快照载荷在提交审核时生成，并至少保存：

- 完整内容 JSON；
- `fortuneDate`、生效区间和时区；
- 日历数据记录及其版本；
- 算法、文案、配方、图片清单和海报模板版本；
- 所有素材的 `assetId`、文件哈希和授权记录引用；
- 封面槽位、封面素材、细节素材和同快照降级素材引用；
- 提交时已经完成的自动检查结果。

审核中及之后的 `ContentSnapshotPayload` 不可修改或删除。需要调整内容时，复制为新草稿并生成新的 `contentVersion`。

之后产生的大师确认、状态变化、发布、撤回、回滚、单图下线和失败记录分别追加到 `MasterReviewEvidence`、`ReleaseEvent`、图片交付事件与 `AuditEvent`，均引用 `contentVersion`；`ContentLifecycleProjection` 与 `ImageAssetDeliveryProjection` 只由这些事件计算，不得用于覆盖历史事件。单图下线不改快照：必备封面切换到同一快照的审核降级素材，可选封面或问题细节图从交付中省略。审计记录后台用户不得覆盖，P0 默认至少保留 365 天。

# 17. 数据结构与 API v1 契约

## 17.1 API 通用约定

- 字段、请求、响应、状态枚举、错误码和示例的唯一事实源是 [`docs/api/openapi.yaml`](../api/openapi.yaml)；本章解释业务含义，不另行维护第二套接口；
- 公共接口前缀：`/api/v1`；后台接口前缀：`/admin/api/v1`；
- 时间使用带时区的 ISO 8601，命理日期使用 `YYYY-MM-DD`；
- 固定业务时区为 `Asia/Shanghai`；
- 内容生效区间统一为左闭右开 `[effectiveFrom, effectiveTo)`；任一时刻同一 `fortuneDate` 最多只有一个活跃版本；
- 服务端负责计算 `responseGeneratedAt`、`civilDate`、`fortuneDate` 和 `shichen`，不信任客户端设备时间；
- 服务端从同一时刻计算 `servedFortuneDate`；公开端与后台运营视图按它选择 current/next，不能从 `fortuneDate` 或客户端时钟推断；
- `responseGeneratedAt` 表示当前响应表示在源站或边缘层生成时的服务端时刻，不承诺等于用户收到缓存响应时的实时服务器时钟；客户端不得用它自行推进业务日期或时辰；
- 公开网页使用同一业务 API，后台只通过后台接口操作内容；
- P0 只有网页端，接口不传 `platform`、`sourcePlatform` 或 `targetPlatform`；
- 需要区分普通链接、海报或其他分发来源时使用 `channelId`，该字段不得改变正文、日期、档位或图片；
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
  "servedFortuneDate": "2026-07-15",
  "requestContext": {
    "responseGeneratedAt": "2026-07-14T18:30:00+08:00",
    "civilDate": "2026-07-14",
    "fortuneDate": "2026-07-14",
    "shichen": "酉",
    "timezone": "Asia/Shanghai",
    "dayBoundary": "23:00",
    "crossedDayBoundary": false
  },
  "content": {
    "fortuneDate": "2026-07-15",
    "effectiveFrom": "2026-07-14T18:00:00+08:00",
    "effectiveTo": "2026-07-15T18:00:00+08:00",
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
        "displaySection": "primary",
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
        "displaySection": "primary",
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
        "displaySection": "primary",
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
        "displayLabel": "注意",
        "displaySection": "attention",
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
        "explanation": "今日建议降低大面积使用比例；已经穿了可用大吉色小配饰做平衡。"
      },
      {
        "rank": 5,
        "tierCode": "bu_li",
        "algorithmLabel": "不利",
        "displayLabel": "注意",
        "displaySection": "attention",
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
        "explanation": "今日建议减少使用；已经穿了可用大吉色小配饰做平衡。"
      }
    ],
    "balanceSuggestion": {
      "title": "已经穿了注意色",
      "description": "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      "preferredTierCode": "da_ji",
      "accessoryExamples": ["丝巾", "包", "鞋", "耳饰"]
    },
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
        "disclaimer": "双色比例可按场景灵活调整，不必固定百分比。"
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
        "requiredForPublish": true,
        "sortOrder": 1,
        "title": "木日通勤主方案",
        "scenario": {"code": "commute", "label": "通勤"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_main_cover",
          "url": "https://cdn.example.com/assets/hash.webp",
          "width": 1200,
          "height": 1600,
          "mediaType": "image/webp",
          "altText": "红色上衣、绿色下装和白色配饰的通勤穿搭",
          "aiGenerated": true,
          "aiDisclosure": "AI 生成穿搭示意图"
        },
        "detailImages": [
          {"assetId": "asset_look_main_detail", "url": "https://cdn.example.com/assets/main-detail-hash.webp", "width": 1200, "height": 1600, "mediaType": "image/webp", "altText": "红色上衣、绿色下装和白色配饰的细节", "aiGenerated": true, "aiDisclosure": "AI 生成穿搭示意图"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "red", "description": "红色简洁上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "green", "description": "低饱和绿色下装"},
          {"category": "accessory", "categoryLabel": "鞋包/配饰", "colorCode": "white", "description": "白色小面积点缀"}
        ],
        "alternatives": [
          {"replaceCategory": "accessory", "description": "无法更换整套衣服时，可用白色包或耳饰替代。"}
        ]
      },
      {
        "lookId": "look-alt-01",
        "formulaId": "formula-mono-01",
        "priority": "alternate",
        "requiredForPublish": false,
        "sortOrder": 3,
        "title": "红粉同色系日常方案",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_alt_01_cover",
          "url": "https://cdn.example.com/assets/alt-01-cover-hash.webp",
          "width": 1200,
          "height": 1600,
          "mediaType": "image/webp",
          "altText": "红粉同色系日常穿搭",
          "aiGenerated": true,
          "aiDisclosure": "AI 生成穿搭示意图"
        },
        "detailImages": [
          {"assetId": "asset_look_alt_01_detail", "url": "https://cdn.example.com/assets/alt-01-detail-hash.webp", "width": 1200, "height": 1600, "mediaType": "image/webp", "altText": "红粉同色系材质细节", "aiGenerated": true, "aiDisclosure": "AI 生成穿搭示意图"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "pink_family", "description": "低饱和粉色上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "red", "description": "深红色下装"}
        ],
        "alternatives": []
      },
      {
        "lookId": "look-alt-02",
        "formulaId": "formula-dual-01",
        "priority": "alternate",
        "requiredForPublish": true,
        "sortOrder": 2,
        "title": "红绿双色日常方案",
        "scenario": {"code": "daily", "label": "日常"},
        "audience": {"code": "adult_women", "label": "成年女性"},
        "coverImage": {
          "assetId": "asset_look_alt_02_cover",
          "url": "https://cdn.example.com/assets/alt-02-cover-hash.webp",
          "width": 1200,
          "height": 1600,
          "mediaType": "image/webp",
          "altText": "红色上衣和绿色下装的日常穿搭",
          "aiGenerated": true,
          "aiDisclosure": "AI 生成穿搭示意图"
        },
        "detailImages": [
          {"assetId": "asset_look_alt_02_detail", "url": "https://cdn.example.com/assets/alt-02-detail-hash.webp", "width": 1200, "height": 1600, "mediaType": "image/webp", "altText": "红绿双色穿搭细节", "aiGenerated": true, "aiDisclosure": "AI 生成穿搭示意图"}
        ],
        "items": [
          {"category": "top", "categoryLabel": "上衣", "colorCode": "red", "description": "红色上衣"},
          {"category": "bottom", "categoryLabel": "下装", "colorCode": "green", "description": "绿色下装"}
        ],
        "alternatives": []
      }
    ],
    "basis": {
      "steps": ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
      "disclaimer": "内容基于传统文化规则整理，仅供穿搭参考。"
    },
    "share": {
      "summaryText": "今日木日，优先参考红、橙、紫、粉色系。",
      "copyText": "今日穿搭参考：优先火色，稳妥选择木色。",
      "posterTemplateVersion": "poster-template-v3",
      "posterJobEndpoint": "/api/v1/poster-jobs"
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
- `tiers` 是完整五档答案；`displaySection` 固定告诉网页把前三档放入 `primary`、把 `jiao_cha` 与 `bu_li` 放入 `attention` 布局区域，网页不得重新推算分组；
- UI 必须按 `rank` 展示五条记录，并使用 `algorithmLabel` 作为可见档位名；`displayLabel: "注意"` 仅作旧客户端兼容与分组元数据，不得替代“较差”“不利”；
- `balanceSuggestion` 单独返回，适用于已经穿了较差或不利档颜色的用户，始终只建议用大吉色普通配饰做小面积补充；
- `element` 固定为 `wood`、`fire`、`earth`、`metal`、`water`；
- `colorCode` 只能来自已审核颜色表，前端不得根据 HEX 或图片色相重新归行；
- `outfitFormulas` 至少包含单色、双色、三色各一项；
- 三色方案填写比例时，比例之和必须等于 100；未确认的比例返回 `null`；
- 每日恰有 2 个 `requiredForPublish = true` 的图片方案，第 3 个方案为可选；必备图不可用时必须明确使用已审核降级模板；
- 公开图片只返回展示所需的 URL、尺寸、格式、替代文字和 AI 说明；文件校验值、权利记录和内部检查状态只出现在后台；
- 所有 `formulaId`、`lookId`、`colorCode` 和 `assetId` 引用在发布前通过完整性校验；
- 图片 URL 必须包含内容哈希或版本路径，禁止覆盖同一 URL 下的文件；
- `posterTemplateVersion` 被 `contentVersion` 锁定；按渠道生成的 `posterInstanceId` 是派生制品，不回写内容快照，也不改变 `contentVersion`；
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
  "channelId": "organic"
}
```

`Idempotency-Key` 使用 UUID v4 或等价的高熵不透明值。同一业务意图的网络重试必须复用同一键；请求参数、`fortuneDate` 或 `expectedContentVersion` 变化时必须生成新键。服务端按“调用方 + 接口 + 幂等键”确定作用域并保留足以覆盖客户端重试窗口的结果；同一键配不同规范化请求体返回 `409 IDEMPOTENCY_KEY_REUSED`。

P0 只有网页端，不传来源平台或目标平台。如果 `expectedContentVersion` 不是该 `fortuneDate` 的当前活跃版本，服务端必须返回 `409 CONTENT_VERSION_CHANGED`，不得创建任务；客户端整包刷新后再重试。创建与查询任务使用同一响应结构；`status` 只允许 `processing`、`ready`、`failed` 或 `version_changed`，非 `ready` 时可为空的制品字段返回 `null`：

```json
{
  "jobId": "poster_job_01J...",
  "status": "ready",
  "sourceContentVersion": "fd-20260715-r3",
  "currentActiveContentVersion": "fd-20260715-r3",
  "posterTemplateVersion": "poster-template-v3",
  "posterInstanceId": "poster_fd-20260715-r3_organic_01",
  "channelId": "organic",
  "assetUrl": "https://cdn.example.com/posters/instance-hash.webp",
  "entry": {
    "type": "web_qr",
    "landingUrl": "https://example.com/daily/2026-07-15?channelId=user_share&expectedContentVersion=fd-20260715-r3&referralId=poster-job-20260715-0001&referralKind=poster"
  }
}
```

网页实例的 `entry.type` 为 `web_qr`，只返回 `landingUrl`。二维码入口固定使用 `channelId=user_share`，并以当前 `jobId` 同时作为 `referralId`，让海报分享发起与扫码回流可以稳定匹配；`referralKind=poster` 用于区分普通链接回流。海报正文、日期或配方变化必须生成新的 `contentVersion`；只改变入口码、渠道标识或重新渲染时生成新的 `posterInstanceId`。

撤回或回滚使任务的 `sourceContentVersion` 不再活跃时，未完成任务转为 `version_changed`，保留原 `jobId` 供轮询和审计，返回新的 `currentActiveContentVersion`，且不得产出公开 `assetUrl`。客户端必须用当前安全版本和新的 `Idempotency-Key` 创建新任务，服务端不得在原任务上偷换版本。

### 反馈契约

`POST /api/v1/feedback-reports` 请求体至少包含：

```json
{
  "category": "content_error",
  "message": "图片主色与文字配方不一致",
  "fortuneDate": "2026-07-15",
  "contentVersion": "fd-20260715-r3",
  "channelId": "organic",
  "contact": null
}
```

`category` 只允许 `content_error` 或 `product_feedback`；`message` 必填并限制长度，`contact` 可空且单独取得用户同意。成功返回 `202` 和 `feedbackId`，服务端记录 `X-Request-Id`、限流结果与处理状态。

`GET /api/v1/daily/{fortuneDate}` 可携带 `expectedContentVersion`。链接绑定的旧版本已经被新版本替代时，接口返回当前安全版本，并附带：

```json
{
  "resolution": {
    "expectedContentVersion": "fd-20260715-r2",
    "servedContentVersion": "fd-20260715-r3",
    "versionChanged": true,
    "reason": "replaced"
  }
}
```

搭配详情发现客户端版本变化时返回 `409 CONTENT_VERSION_CHANGED`，客户端必须重新获取整个每日内容包，不能拼接新旧数据。公共历史内容至少保留最近 90 个命理日；超过期限的入口返回 `410 HISTORICAL_CONTENT_EXPIRED` 和“历史内容已下线，可主动查看今日”的安全落地页，不自动伪装成今日内容。后台不可变快照不受公开期限影响。

## 17.4 后台 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/admin/api/v1/auth/sessions` | 以账号与密码直接建立后台会话 |
| `GET/DELETE` | `/admin/api/v1/auth/session` | 查看当前会话与 CSRF 令牌，或退出当前会话 |
| `POST` | `/admin/api/v1/auth/logout-all` | 注销全部后台会话 |
| `GET` | `/admin/api/v1/security-events` | 查询关键登录与安全记录 |
| `GET` | `/admin/api/v1/emergency-control` | 查看全局公开内容开关与 ETag |
| `POST` | `/admin/api/v1/emergency-control/stop` | 以安全会话与精确短语紧急停止全部公开内容 |
| `POST` | `/admin/api/v1/emergency-control/resume` | 以安全会话与精确短语恢复全部公开内容 |
| `GET` | `/admin/api/v1/daily-content-drafts?fortuneDate=...` | 从服务端查找仍可继续编辑的草稿 |
| `POST` | `/admin/api/v1/daily-content-drafts` | 创建某命理日草稿 |
| `GET` | `/admin/api/v1/daily-content-drafts/{draftId}` | 查看草稿 |
| `PATCH` | `/admin/api/v1/daily-content-drafts/{draftId}/modules/{moduleCode}` | 按模块编辑草稿 |
| `GET` | `/admin/api/v1/daily-content-drafts/{draftId}/image-assets` | 找回该草稿已上传的图片候选与预览地址 |
| `POST` | `/admin/api/v1/daily-content-drafts/{draftId}/image-assets` | 以文件和 JSON 元数据上传草稿图片 |
| `POST` | `/admin/api/v1/daily-content-drafts/{draftId}/image-assets/{assetId}/review` | 逐图登记六项结构化人工检查 |
| `GET` | `/admin/api/v1/image-assets/{assetId}/preview` | 在已认证后台按精确同源地址预览素材 |
| `POST` | `/admin/api/v1/daily-content-drafts/{draftId}/submit` | 冻结草稿并生成 `contentVersion` |
| `GET` | `/admin/api/v1/daily-content-versions?fortuneDate=...` | 查看该日全部版本 |
| `GET` | `/admin/api/v1/daily-content-versions/{contentVersion}` | 查看快照、检查项、大师确认依据和发布记录 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/master-review-evidence` | 登记大师在系统外的确认依据 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/review-decision` | 运行必审检查并批准或退回 |
| `GET` | `/admin/api/v1/daily-content-versions/{contentVersion}/daily-image-set` | 查看不可变图片引用与当前交付投影 |
| `POST` | `/admin/api/v1/daily-content-versions/{contentVersion}/image-assets/{assetId}/withdraw` | 追加单图下线事件并切换降级或省略可选图 |
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

模块内容沿用第 17.2 节对象、枚举与引用约束：`calendar_algorithm` 管理 `calendar`、`tiers` 和日历/算法版本，`copy_and_formula` 管理摘要、依据、`outfitFormulas` 和文案/搭配版本，`visual_and_rights` 管理 `looks`、2+1 封面槽位、细节与降级素材引用、素材哈希、素材清单版本、结构化人工检查与权利记录，`poster_consistency` 管理海报模板版本和渲染样张。编辑接口只允许修改 `draft`，成功返回更新后的模块与 `draftRevision`。

图片上传使用 `multipart/form-data`，其中 `file` 是二进制图片，`metadata` 是不带 filename 的普通表单字段，其 UTF-8 字段值为符合 `ImageAssetUploadMetadata` 的 JSON 文本。服务端计算文件校验值和尺寸，图片先绑定当前 `draftId + fortuneDate`；草稿提交时绑定新生成的 `contentVersion`。每次上传都必须提供非空来源材料与权利记录引用；来源类型和生成方式按 OpenAPI 的固定组合提交。上传与逐图审核都必须携带当前草稿 ETag、CSRF 和幂等键，不能通过重复请求创建重复素材或重复审核记录。后台预览只接受 `/admin/api/v1/image-assets/{assetId}/preview` 这一精确同源路径。

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

- 除未登录阶段的登录外，所有后台写操作必须携带会话绑定的 `X-CSRF-Token`，并由服务端同时验证可信同源 `Origin`；
- 所有后台响应（包括业务内容、核对凭证和错误）一律 `Cache-Control: no-store`，密码、CSRF 和会话原文不得进入 localStorage、URL 或日志；
- `PATCH` 草稿、图片上传和逐图审核必须原样回传上次响应中的草稿 `ETag`，例如 `If-Match: "draft:7"`；成功响应返回新的草稿 ETag；
- `submit` 使用草稿 `If-Match` 校验冻结前版本并必须携带 `Idempotency-Key`；成功后的 `ETag` 改为表示新建生命周期聚合的 `lifecycleRevision`；
- 登记大师确认依据、批准、排期、取消排期、发布、撤回和回滚必须原样回传内容版本 ETag，例如 `If-Match: "lifecycle:12"`；
- `submit`、图片上传、逐图审核、单图下线及所有状态变化动作必须携带 `Idempotency-Key`，网络重试不得重复创建素材、审核、快照、下线事件或发布；
- 单图下线使用内容版本 ETag 并增加 `lifecycleRevision`；它只追加交付事件，不修改不可变快照，必备封面切换同快照审核降级素材，可选封面和问题细节图省略；
- 批准动作必须一次检查：大师确认依据、366 日机器比对状态、文案、两张必备图片、权利记录、AI 标识、海报样张和引用完整性；
- 退回时必须填写原因；发布、撤回和回滚必须记录操作者、原因、请求标识、前后状态及内容版本；
- `expectedActiveContentVersion` 必填但允许为 `null`，用于防止旧页面覆盖新版本；
- 撤回可带安全替代版本；不带替代版本时公共端进入“今日内容校验中”；
- 批准、排期、发布、版本撤回和回滚等内容生命周期状态动作成功时，必须返回新的 `lifecycleRevision`、全部状态变化和事务完成后的 `activeContentVersion`；单图下线返回新的图片交付投影与审计编号，不伪造内容状态转换；
- 字段、枚举、错误码和示例以 OpenAPI 为准；后台账号密码登录、离线重置和紧急停止遵守 ADR-0022、ADR-0026、Issue #37 与 Issue #41。

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
| 401 | `AUTHENTICATION_FAILED` | 账号或密码无效；对外统一文案 |
| 401 | `UNAUTHENTICATED` | 后台未登录 |
| 403 | `FORBIDDEN` | 无对应权限 |
| 403 | `CSRF_VALIDATION_FAILED` | 后台写操作的可信 Origin 或会话 CSRF 校验失败 |
| 404 | `RESOURCE_NOT_FOUND` | 后台资源或海报任务不存在 |
| 404 | `CONTENT_NOT_FOUND` | 指定日期没有可公开内容 |
| 404 | `LOOK_NOT_FOUND` | 搭配不存在于当前版本 |
| 409 | `CONTENT_VERSION_CHANGED` | 客户端版本与活跃版本不同 |
| 409 | `ACTIVE_CONTENT_VERSION_CHANGED` | 后台旧页面看到的活跃版本已经变化 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 同一幂等键被用于不同请求体 |
| 409 | `EMERGENCY_CONTROL_CONFLICT` | 全局公开开关与请求动作发生状态冲突 |
| 409 | `INVALID_STATE_TRANSITION` | 当前状态不允许该操作 |
| 409 | `VERSION_WITHDRAWN` | 尝试发布或回滚到已撤回版本 |
| 410 | `HISTORICAL_CONTENT_EXPIRED` | 历史公开内容超过保留期 |
| 412 | `REVISION_MISMATCH` | `If-Match` 与当前草稿或生命周期修订号不一致 |
| 422 | `REQUIRED_REVIEW_MISSING` | 必审检查未全部通过 |
| 422 | `MASTER_REVIEW_EVIDENCE_MISSING` | 大师确认依据缺失或未覆盖当前版本 |
| 422 | `PUBLISH_PRECHECK_FAILED` | 五档、图片、海报模板或引用校验失败 |
| 422 | `IMAGE_REVIEW_INCOMPLETE` | 图片人工检查、权利状态或 AI 标识未满足批准条件 |
| 422 | `IMAGE_SET_INVALID` | 2+1 封面槽位、素材引用或审核降级关系不完整 |
| 422 | `IMAGE_WITHDRAWAL_BLOCKED` | 必备封面没有同快照内可安全切换的审核降级素材 |
| 413 | `IMAGE_FILE_TOO_LARGE` | 上传图片超过当前接口限制 |
| 415 | `IMAGE_MEDIA_TYPE_UNSUPPORTED` | 上传文件不是允许的图片格式 |
| 422 | `SCHEDULE_TIME_INVALID` | 排期时间不符合生效区间 |
| 428 | `PRECONDITION_REQUIRED` | 需要并发保护的写操作缺少 `If-Match` |
| 429 | `RATE_LIMITED` | 登录、恢复、海报或反馈请求过于频繁 |
| 503 | `CONTENT_NOT_READY` | 当前 `servedFortuneDate` 尚无安全已发布内容 |
| 503 | `PUBLIC_ACCESS_STOPPED` | 全局紧急开关已关闭公开内容与海报访问 |
| 503 | `POSTER_GENERATION_UNAVAILABLE` | 海报服务不可用，但基础内容仍可展示 |
| 503 | `FEEDBACK_UNAVAILABLE` | 反馈服务暂时不可用，但公共内容仍可展示 |

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

任一业务内容组成部分、图片引用、降级关系或海报模板变化都生成新的 `contentVersion` 并重新走对应模块审核。按既定模板和 `channelId` 派生的 `posterInstanceId` 不属于该组合；只重渲染入口码或渠道标识不生成新 `contentVersion`。图片交付投影可以在不改快照的前提下停用问题图片，并只切换到该快照已经冻结且审核通过的降级素材，或省略可选/细节图；补入新图、替换为快照外素材、修改文案仍必须生成新版本。

## 17.8 网页、后台与 Worker 的复用边界

必须复用：

- 服务端日历、日柱、五行、五档和颜色归类结果；
- 每日内容接口、后台接口和字段定义；
- `fortuneDate`、各版本号和内容 ID；
- 颜色表、档位名、标准文案和禁词配置；
- 埋点名称、属性和统计口径；
- 黄金测试数据与 23:00 边界用例；
- 设计令牌，包括颜色、字号、间距和圆角语义；
- API 服务与后台任务使用同一份领域规则，但作为两个进程运行，互不阻塞请求与批处理。

允许分别适配：公开网页导航、浏览器分享、网页二维码、下载、剪贴板、本地存储和后台登录。

P0 不使用跨端框架，也不开发小程序客户端。所有埋点至少包含：

```json
{
  "fortuneDate": "2026-07-15",
  "contentVersion": "fd-20260715-r3",
  "channelId": "organic",
  "anonymousId": "channel_local_id"
}
```

P0 只有网页端，因此事件不传端类型、来源端、目标端或用户账号字段。`channelId` 只表示普通链接、海报等分发来源；`anonymousId` 仅用于隐私政策允许的匿名分析，P0 不建立用户账户、跨设备身份或个人画像。

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

- P0 公共网页不收集出生信息、家人信息、账户资料或对话内容；
- 匿名访问统计使用前必须在隐私说明中写清用途、保存期限和退出方式；
- 日志中的 IP、浏览器信息和渠道参数按必要性最小化保存；
- 管理后台只有一个维护者账号，执行强密码、持久化限流、安全会话、CSRF 与追加审计；
- 安全事件至少保留 365 天，只保存请求编号、单向来源指纹和受限浏览器摘要，不保存密码、会话、CSRF、原始 IP 或完整 User-Agent；
- 未来若增加个人功能，必须重新完成隐私设计与评审，不能沿用 P0 的匿名访问授权。

## 21.4 可靠性

- 日历和算法服务有自动测试；
- 发布流程有机器检查、维护者清单和大师外部确认依据；
- 存在同日历史安全版本时可回滚；没有安全旧版本时可立即撤回并进入内容不可用状态；
- 18:00 用户侧内容切换有监控和报警；23:00 命理上下文推进另有不重复发布检查；
- 图片生成失败不影响基础五行结果。

# 22. 埋点与指标

## 22.1 P0 核心事件

- `view_today_summary`；
- `view_all_tiers`；
- `open_outfit_hub`；
- `view_daily_look`；
- `view_look_detail`；
- `share_summary_initiated`：用户触发系统分享或复制摘要链接时记录，不宣称外部发送成功；
- `share_link_landing_view`：用户分享链接成功解析并展示公开内容后记录，属性至少含随机 `referralId`、`channelId`、来源版本与实际交付版本；`referralId` 不得包含匿名访客标识；
- `share_poster_initiated`：用户从海报页发起可观测分享动作时记录；
- `poster_save_requested`、`poster_save_succeeded`、`poster_save_failed`：分别记录保存请求、用户明确确认已保存，以及浏览器已知失败或用户确认未保存；下载动作本身不得记为成功；
- `poster_landing_view`：入口页成功解析后记录，属性至少含与海报二维码及分享发起一致的稳定 `referralId`、`channelId`、`sourceContentVersion` 和实际交付 `contentVersion`；海报生成完成前无法写入二维码的 `posterInstanceId` 继续用于保存结果统计，不作为回流连接键；
- `fortune_date_switch_result`：页面内跨日检查完成时记录，属性含 `result = succeeded | failed`、切换前后日期和失败原因；
- `served_fortune_date_switch_result`：18:00 用户内容切换完成时记录，属性含 `result = succeeded | failed`、切换前后 `servedFortuneDate`、内容版本和失败原因；
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

`进入今日 → 看懂颜色 → 进入怎么搭 → 查看图片详情 → 分享或次日回访`

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

| `civilDateTime`（Asia/Shanghai） | `servedFortuneDate` | `fortuneDate` | 命理上下文日干支/日支/日五行 | 时辰 |
|---|---|---|---|---|
| 2026-07-23 17:59 | 2026-07-23 | 2026-07-23 | 戊戌 / 戌 / 土 | 酉 |
| 2026-07-23 18:00 | 2026-07-24 | 2026-07-23 | 戊戌 / 戌 / 土 | 酉 |
| 2026-07-23 22:59 | 2026-07-24 | 2026-07-23 | 戊戌 / 戌 / 土 | 亥 |
| 2026-07-23 23:00 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-23 23:59 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 00:00 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 00:59 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 子 |
| 2026-07-24 01:00 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 丑 |
| 2026-07-24 02:59 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 丑 |
| 2026-07-24 03:00 | 2026-07-24 | 2026-07-24 | 己亥 / 亥 / 水 | 寅 |

该序列必须同时证明：18:00 只推进 `servedFortuneDate`，23:00 只推进命理 `fortuneDate`，跨过民用午夜后不得再次推进任一日期。

缓存链路同时验收：23:59 的 `/today` 响应不得跨民用午夜复用；00:00 即使 `contentVersion` 与时辰未变，也必须重新得到新的 `civilDate` 和 `crossedDayBoundary = false`。

## 23.3 内容一致性

- 首页、五档、图片配方和海报使用相同大吉/次吉/平结果；
- 图片主色与文字配方一致；
- 回滚后所有入口展示同一版本；
- 海报二维码落地到相同命理日期；
- 18:00 前后不会同时缓存两套错误内容；23:00 上下文刷新不会触发第二次内容发布。

## 23.4 公开网页与后台版本一致性

- 使用同一测试时刻打开公开网页和后台预览，`servedFortuneDate`、内容 `fortuneDate`、五档和 `contentVersion` 完全一致；`requestContext.fortuneDate` 在 18:00 至 22:59 允许与内容日期相差一天，前后台仍必须返回同一命理上下文；
- 网页相同 `lookId` 的标题、图片、配色比例和场景来自同一内容快照；
- 17:59、18:00、22:59、23:00、23:59、00:00 分别执行浏览器测试，公开交付日、命理日和提示符合第 23.2 节；
- 后台发布或回滚后，公开接口、网页和 CDN 在 60 秒内读取同一活跃版本；
- 已打开页面重新进入前台或主动刷新时检查活跃版本；
- 分享链接和海报二维码均进入指定命理日期的网页；
- 链接必须在真实微信内置浏览器中完成一次访问、分享和二维码回流验收；
- P0 全流程不得主动要求登录；浏览器不支持下载时公共内容仍可完整使用；
- P0 页面不存在收藏、通知、账户、出生信息、商品、吉祥物、小程序或 App 的禁用按钮、空状态或假入口；
- P0 数据看板不存在收藏、登录和提醒指标；
- 公开页面在 375px 手机宽度和常见桌面宽度下无页面级横向滚动。

## 23.5 API、状态机与并发验收

- `tiers` 数量不为 5、排名重复或颜色引用无效时发布预检失败；
- 旧 `contentVersion` 的搭配详情请求返回 `CONTENT_VERSION_CHANGED`，客户端整包刷新；
- 旧页面修改已更新草稿时收到 `REVISION_MISMATCH`；
- 大师确认依据缺失时收到 `MASTER_REVIEW_EVIDENCE_MISSING`；
- 任一必审检查未通过时收到 `REQUIRED_REVIEW_MISSING`；
- 重复发送相同幂等键的发布或回滚请求只执行一次；
- `submit` 网络重试返回同一 `contentVersion`，不得重复生成快照；
- 新排期替换旧排期时同时返回旧版本 `scheduled → approved` 与新版本 `approved → scheduled`；同日其他版本审核不得使当前有效排期任务失效；
- 海报生成失败时基础今日内容仍可访问；
- 海报生成中途发生撤回或回滚时，旧任务返回 `version_changed` 且不公开制品，目标版本以新任务重新生成；
- 回滚原子切换活跃指针，不出现网页、公共 API 和 CDN 分别读取不同版本；
- 无安全替代版本的撤回返回“今日内容校验中”，不得由 LLM 临时补算。
- 2+1 只统计两个必备封面槽位和最多一个可选封面槽位；增加或省略细节图不改变该计数。
- 两个必备封面槽位必须各自具有可交付的原图或安全降级素材，才可计入公开交付 `2/2`；六项结构化人工检查、权利材料、适用的 AI 标识或大师依据尚未补充时不阻止本地首次发布，但必须形成发布后待检查状态、可追溯记录和可行动异常。可选图片可以不提供，也不进入异常。
- 两个必备槽位始终冻结不同于原封面的同快照审核降级素材；原封面初始不合格或单图下线后使用该素材，可选封面初始不合格或下线后省略；细节图只交付冻结集合中当前可用且未下线的完整子集；快照中的原始 `assetId`、校验值和审核记录保持不变。
- 在预发环境或受控测试素材上完成一次版权/合规撤回的 CDN `purge/deny` 演练，验证活跃接口、素材源站和 CDN 新请求均停止提供被撤回内容。

“60 秒”是发布和回滚的活跃接口同步 SLA；如技术评审确认无法达到，必须在开工前替换为另一个明确数字。

# 24. 待确认清单

## 24.1 产品与商业

- 正式名称与品牌；
- 已确认：首发只包含手机优先的响应式公开网页，微信小程序和 App 不进入 P0；
- 已确认：通过普通链接在微信群分发，不读取群成员信息，也不自动发送消息；
- 待确认：美国服务器、域名、对象存储、CDN 和正式公开时间；
- 首批图片目标人群；
- 已确认：P0 不卖商品、不做吉祥物、不设置会员或价格入口；
- 男性与家庭用户何时纳入。

## 24.2 个人五行与八字（不阻塞 P0）

- 年柱与生肖分界；
- 个人排盘中的早晚子时流派细节；
- 出生城市、时区、真太阳时；
- 性别与排盘关系；
- 五行强弱、藏干、十神、旺衰、格局、大运范围；
- 公共与个人融合规则。

## 24.3 内容

- 已确认：公开直接显示大吉、次吉、平、较差、不利完整五档；
- 已确认：较差和不利档使用温和的减少说明，已穿时可用大吉色普通配饰做小面积平衡；
- 可继续润色配饰和减少比例话术，但不得改变上述逻辑；
- 每日穿搭小课堂选题机制；
- 生肖、星座和宜忌发布时间；
- 老师名号与 AI 化授权。

## 24.4 开发启动确认

P0 技术启动评审已确认：

- 前端：Next.js + React + TypeScript，只做响应式公开网页；P0 不使用 Taro，不开发微信小程序或 App；
- 后端：Node.js/TypeScript 模块化单体，NestJS + Fastify，PostgreSQL；API 与 Worker 使用同一代码库、分进程运行；首版不引入 Redis、Kafka；
- `/today`：`responseGeneratedAt` 表示缓存表示生成时的服务端结果；动态 `s-maxage` 最长 60 秒，并在 18:00 公开切换、23:00 命理换日、时辰和民用午夜边界前提前失效；
- 内容状态：固定为 `draft`、`in_review`、`changes_requested`、`approved`、`scheduled`、`published`、`superseded`、`withdrawn`；
- 维护方式：一名维护者操作以“今日、日历、数据、异常”为一级导航的后台，大师在系统外确认并留下依据；
- 日历黄金数据：工程侧固定答案表覆盖连续 366 个命理日，大师书面复核连续 30 日及边界样本；
- 图片主管线：后台 Worker 通过可替换适配器自动生成两张必备图；可选图默认 `not_requested`，只在维护者明确操作时生成、上传或复用；
- 运营时间：13:00 是下一公开交付日准备完成截止，18:00 切换用户侧内容；23:00 只推进命理 `fortuneDate` 与时辰，366 日黄金答案不变；
- 公开档位：按 `algorithmLabel` 展示大吉、次吉、平、较差、不利；`displayLabel: "注意"` 只保留为兼容分组元数据。
- 接口契约：公共网页和单人后台的字段、枚举、错误码、版本并发保护与完整例子统一冻结在 `docs/api/openapi.yaml`；P0 不传端类型，只在需要区分分发来源时传 `channelId`。
- 后台安全：Issue #37 已确认单维护者账号密码、30 分钟闲置/12 小时绝对会话、全部会话撤销、关键安全记录和全局紧急开关；Issue #41 将密码下限调整为 8 位，详见 ADR-0022 与 ADR-0026。

已解除的开发阻塞：

- 单人后台账号密码登录、离线重置和紧急停止方案已于 2026-08-02 经维护者明确确认，可以按更新后的契约开发。

尚未解除的公开上线阻塞：

- 美国服务器的具体供应商、区域、备份与故障恢复方案；
- 正式域名、HTTPS、对象存储、CDN 及其中国大陆微信内访问情况；
- 60 秒发布/回滚同步目标在真实部署环境中的证明；
- 首批 30 天日历、大师确认依据、图片、权利记录和 AI 标识；
- 隐私说明、用户协议、参考声明和真实微信群链接访问验收。

# 25. 发布门槛

公开测试前必须满足：

1. 大师书面确认公共算法、颜色表、五档和 23:00 命理换日规则；维护者确认 18:00 用户侧内容切换规则；
2. 工程侧完成国家标准锚点与固定版本离线库连续 366 个命理日机器比对且零差异；大师书面复核不少于连续 30 日及边界样本；
3. 核心页面完成目标用户任务测试；
4. 连续 30 天每天的两个必备封面槽位具备结构化人工检查、权利记录、AI 标识、同快照降级和追加式单图下线机制；可选封面最多一个，细节图不计入 2+1；
5. 内容、海报模板、海报实例 `sourceContentVersion` 和活跃缓存版本一致；
6. 异常、离线、18:00 内容切换、23:00 命理上下文换日且不重复发布、回滚及版权/合规撤回的 CDN `purge/deny` 测试通过；
7. 用户协议、隐私说明、内容参考声明和 AI 标识方案就绪；
8. 个人五行不得在详细算法未确认时上线；
9. AI 问事不得以占位入口诱导用户提前使用；
10. 公开网页的跨日、分享、海报、发布和回滚一致性测试通过；
11. 网页不存在小程序、App、收藏、账户、出生信息、商品或吉祥物的无效占位入口；
12. 美国服务器、正式域名、HTTPS、对象存储、CDN 和备份方案完成确认；
13. 用户协议和隐私说明准确披露本地数据、匿名统计、日志、渠道参数和第三方服务；
14. 内容状态机、单人后台保护、并发保护、幂等和审计用例通过；
15. 公共 API、后台 API、错误码、缓存与版本切换契约通过联调；
16. 真实微信内置浏览器完成普通链接访问、分享、海报下载和二维码回流验收；
17. 在真实部署环境证明发布或回滚后 60 秒内网页、接口和 CDN 版本一致。

# 26. 开发启动说明

## 26.1 当前结论

V2.3 已完成 P0 技术启动评审并有条件通过，公共网页、后台业务接口和单人维护者安全入口均已冻结。工程骨架、公共读取和后台功能可以继续本地开发；服务器与 CDN 暂未确认，不阻止本地开发，但阻止公开上线。

## 26.2 建议工作流

建议按 GitHub Issues 中的 P0 票据顺序推进：

1. 已同步并确认 V2.3 文档；
2. 已冻结公共 API、后台 API、字段枚举与 `contentVersion` 语义；
3. 建立 Next.js、NestJS、PostgreSQL 的工程骨架，并按 OpenAPI 生成或校验接口类型；
4. 冻结单人后台登录和安全边界；
5. 完成 366 日黄金数据和边界测试；
6. 实现公开网页，再实现单人后台；
7. 接入发布、撤回、回滚、缓存失效和图片降级；
8. 服务器方案确认后部署，满足第 25 章门槛再公开测试。

## 26.3 V2.3 主要变化

- 从“H5 + 微信小程序”收束为单一响应式公开网页，微信群仅分发普通链接；
- 确认 Next.js 网页、TypeScript 模块化单体、NestJS、Fastify 和 PostgreSQL；
- 确认 `/today` 缓存语义、八状态内容流程、单人维护与大师外部确认；
- 公开直接显示大吉、次吉、平、较差、不利完整五档，并为后两档保留大吉色普通配饰平衡建议；
- 确认固定日历答案表、366 日机器比对和 30 日大师复核；
- 确认图片离线批量生成，Codex + GPT Image 2 为首选，中转接口为可替换备用，每天 2 张必备、最多 1 张可选；
- 冻结公共网页和后台接口，使用单一 OpenAPI 文件作为字段、枚举、错误码和例子的唯一来源；
- 冻结单人后台账号密码、安全会话、安全记录、离线重置与紧急停止，解除后台写功能的认证方案阻塞；服务器、域名、存储、CDN 和真实微信验收仍是公开上线阻塞。

## 26.4 V2.2 主要变化

- 明确 `/today` 缓存表示的时间语义、动态共享缓存时长、边界禁止过期复用及请求 ID 归属；
- 明确 F02 仅前三档提供“查看穿法”，较差与不利档不显示无目标箭头；
- 确认 P0 唯一首页为决策优先结构，并明确无底部 Tab、历史入口、出生信息和其他 P1/P2 占位；
- 明确授权素材与 AI 生成素材可共用数据模型，P0 不要求内置图像生成平台；
- 补齐 AI 显式/隐式标识、幂等键重试语义和 CDN `purge/deny` 演练要求；
- 明确 366 日机器比对由工程侧承担，大师负责不少于连续 30 日及边界样本的书面复核。

## 26.5 V2.1 基线变化

- 确认 H5 与微信小程序双端首发及职责边界；
- 确认基于国家标准锚点的确定性日干支方案，取消在线黄历 API 依赖；
- 补齐公共 API、后台 API、对象字段、错误码、缓存和版本契约；
- 增加不可变内容快照、活跃版本、审核、排期、撤回、回滚和审计模型；
- 把收藏、账户、主动提醒和增长分析统一归入 P1；
- 增加双端一致性、API、状态机与并发验收用例。
