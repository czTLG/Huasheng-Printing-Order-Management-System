# 发给 AI Studio 的前端重构详细说明

目标：重构“包装工厂管理系统”的前端。不要做空壳页面，必须把订单管理、开单管理、成本核算这些核心业务页面做完整。  
重要限制：只重构前端，不改后端接口，不迁移数据库，不修改真实业务数据，不新增旧版接口能力。

## 1. 必须理解的系统定位

这是包装袋印刷厂内部管理系统，核心流程是：

```text
开单管理 -> 同步生成订单 -> 订单流转 -> 生产看板 -> 成本核算/报价/导出/邮件
```

订单生产流程固定为：

```text
印刷 -> 复膜 -> 制袋 -> 发货 -> 完成
```

前端必须围绕真实工厂业务设计，不是普通 CRUD 管理后台。页面不能只显示 ID、名称、状态，必须展示生产人员真正要看的字段：品名、客户、袋型、规格、数量、印膜信息、压辊、油墨要求、备注、滞留天数、加急、流程按钮、回退按钮、详情入口。

## 2. 现有资料来源

请按以下资料重构：

- `docs/API_SPEC.md`：接口契约。
- `mocks/mock-data.json`：Mock 数据。
- `legacy/public/index.html`：旧版主页面参考，里面包含完整业务字段和页面行为。
- `legacy/public/mobile.html`：移动端参考。

如果接口文档和旧版页面有差异，以旧版页面展示字段和接口文档的 API 地址共同为准。

## 3. 总体页面模块

必须实现这些模块：

```text
登录/注册
订单管理
开单管理
成本核算
生产看板
统计分析
权限管理
报价单/报价历史（可作为二期，但菜单和数据结构要预留）
系统打包/股票/期货/菜单等非核心模块可弱化，但不能破坏权限菜单
```

第一阶段最重要的是：

```text
订单管理
开单管理
成本核算
生产看板
权限控制
```

## 4. 权限和菜单

前端菜单要根据用户角色和 `/api/auth/me` 返回的 `permissions` 控制显示。

角色说明：

```text
super_admin：全部模块、全部按钮。
manager：订单、开单、成本、看板、统计。
ai_sales：开单、订单查看、报价、成本、统计，但不能随便删除订单。
worker_print：只看印刷相关订单和看板。
worker_film：只看复膜相关订单和看板。
worker_bag：只看制袋相关订单和看板。
worker_ship：只看发货相关订单和看板。
```

前端隐藏按钮只是体验优化，真正权限以后端为准。即使按钮隐藏，也要处理接口返回 `403` 的错误提示。

## 5. 订单管理页面必须完整

### 5.1 顶部控制区

必须有：

```text
搜索/筛选按钮：点击后展开/收起筛选面板。
紧凑模式按钮：点击后压缩布局、隐藏非关键信息，不改接口数据。
```

筛选面板字段：

```text
q：关键词，搜索客户/袋型/备注/规格/数量。
statusFilter：印刷、复膜、制袋、发货、完成、全部。
rollerFilter：全部压辊、具体压辊。
urgentOnly：全部订单、仅看加急。
stayMinDays：滞留大于等于 N 天。
orderDayMode：全部时间、仅今天新单、近3天新单。
orderDataMode：全部数据、仅异常数据。
sortBy：默认排序、按开单时间。
sortOrder：倒序、正序。
orderCardMode：完整、标准、精简。
```

注意：当前先不要新增后端筛选能力。已有接口支持的字段才传给后端；本地筛选可以只做 UI 层，不强行要求后端新增。

### 5.2 订单卡片不能缺字段

订单列表每一条必须至少显示：

```text
主标题：优先显示品名，其次显示客户名。
客户：如果客户和品名不同，显示“客户：xxx”。
袋型：如自立拉链袋、八边封、三边封。
状态：印刷/复膜/制袋/发货/完成。
规格：来自 order_spec 或 use_case 解析。
数量：order_qty。
印膜信息：wo_print_mold 或 wo_print_film_size + wo_print_film_qty + unit。
压辊：roller。
创建时间：start_time 或 created_at。
备注：remark/use_case 中解析出的备注。
滞留天数：根据 updated_at/start_time/created_at 计算。
加急标记：urgency = 1。
油墨要求：wo_ink_requirement，如里印、水煮、蒸煮、哑油、表印。
异常数据标记：品名或规格缺失时显示“数据待核对”。
订阅状态：my_subscribed = 1 时显示“我已订阅”。
```

订单卡片按钮：

```text
完成印刷/完成覆膜/完成制袋/完成发货：根据当前 status 显示。
详情：打开订单详情。
回退：复膜可回退印刷，制袋可回退复膜，发货/完成可回退制袋。
订阅/取消订阅。
```

按钮对应接口：

```text
完成当前工序：PATCH /api/orders/:id/next
标记处理中：PATCH /api/orders/:id/processing
回退：POST /api/orders/:id/rollback-last-complete
详情：GET /api/orders/:id/detail
订阅：POST /api/orders/:id/subscribe
取消订阅：DELETE /api/orders/:id/subscribe
```

完成工序时要弹窗让用户填写：

```text
source：机台/加工来源，必填。
qty：完成数量，必填且大于 0。
unit：印刷/复膜默认“米”，制袋默认“袋”，发货默认“单”。
```

### 5.3 订单详情必须完整

订单详情不只是订单字段，要显示：

```text
订单基础信息：客户、品名、袋型、规格、数量、状态、加急、创建时间。
开单摘要：work_order_summary。
印刷信息：印膜材料、印膜尺寸、印膜数量、印刷数量、参考色、油墨要求。
覆膜信息：layer1-layer4，每层材质/尺寸/重量。
制袋信息：袋型、拉链位置、撕口位置、孔位、封边、封边数值。
装箱信息：装箱类型、装箱规格、实际成品数量、装箱人。
图片：order_image_url / order_image_thumb_url。
最近变化：recent_change_diff。
操作日志：operation_logs，包括 COMPLETE 和 ROLLBACK。
```

如果后端返回 `image_can_delete`，只有 true 时显示删除图片按钮。

## 6. 开单管理页面必须完整

开单管理是系统核心，不能空。页面应按旧版生产单模板分区。

### 6.1 顶部全局搜索

必须有“全局搜索（客户/商品）”区域：

```text
综合搜索输入框：wo_product_search。
匹配方式：全部关键词 / 任一关键词。
可添加多个关键词。
搜索结果下拉：wo_product_search_result。
搜索结果卡片：显示客户、商品、袋型、规格、最近开单信息。
```

接口：

```text
GET /api/work-orders/product-search?q=关键词&mode=all|any
```

搜索结果选中后要自动带入：

```text
业务员
客户
品名
袋型
规格
数量
压辊
印膜材料/尺寸/数量
覆膜层信息
备注
邮件信息
```

### 6.2 业务员/客户区域

必须有：

```text
业务员下拉：wo_salesperson。
客户下拉：wo_customer。
历史商品下拉：wo_product_pick。
加载历史商品按钮。
新增客户/商品按钮。
修改当前客户名按钮。
```

接口：

```text
GET /api/work-orders/meta
GET /api/work-orders/product-options
POST /api/work-orders/customers
PATCH /api/work-orders/customers/:id
```

新增客户/商品面板字段：

```text
归属业务员
客户名，必填
商品名，可选
保存客户按钮
```

### 6.3 开单表单分区和字段

必须按以下分区实现：

#### 基础信息

```text
日期：wo_date
品名：wo_product，必填
规格：wo_spec，必填
要求数量：wo_qty，必填
袋型图片URL：wo_image_url
上传袋型图片：wo_image_file
```

#### 印刷信息

```text
印膜材料：wo_print_mold，必填，下拉来自 materialOptions.names。
印膜尺寸：wo_print_film_size，必填，如 55*10c。
印膜数量：wo_print_film_qty，必填，只填数字。
印膜单位：wo_print_film_unit，kg/米/粒。
印刷数量：wo_print_qty。
压辊：wo_roller，必填，选项 55/65/75/80/90/105。
参考色：wo_ref_color，按彩稿/按打样膜/按原膜样/按样品袋。
油墨要求：多选，里印/水煮/蒸煮/哑油/表印。
印刷米数：wo_print_shift。
```

#### 覆膜工艺

```text
覆膜工艺：wo_film_type，蒸煮/双组/普通。
快捷备注：wo_film_note。
材料字典维护：新增材料、删除材料。
第一层材质/尺寸/数量/单位：wo_layer1, wo_l1_size, wo_l1_weight, wo_l1_unit。
第二层材质/尺寸/数量/单位：wo_layer2, wo_l2_size, wo_l2_weight, wo_l2_unit。
第三层材质/尺寸/数量/单位：wo_layer3, wo_l3_size, wo_l3_weight, wo_l3_unit。
第四层材质/尺寸/数量/单位：wo_layer4, wo_l4_size, wo_l4_weight, wo_l4_unit。
```

层尺寸格式示例：

```text
55*10c
55.5*8c
56*10cm
```

#### 制袋与交付

```text
交货日期：wo_delivery。
是否外加工：wo_outsource，是/否。
袋型：wo_bag_type，必填。
袋型选项：自立、自立拉链、单拉链、八边封、三边封、背封、侧边封袋、四边封、异形袋、自动包。
拉链位置：wo_zip_pos。
撕口位置：wo_tear_pos。
挂孔位置：wo_hole_pos。
孔位选项：圆孔/飞机孔/手提孔。
封边选项：上封/边封/下封。
封边数值：wo_edge_cm。
其它要求：wo_other_req。
备注：wo_remark。
邮件 To：wo_email_to，可多个。
```

#### 装箱信息

```text
装箱类型：wo_pack_type，纸箱/编织袋/打版。
装箱规格：wo_box_spec。
实际成品数量：wo_actual_qty。
装箱人签名：wo_packer_sign。
```

#### 底部动作

```text
同步生成订单并发邮件：wo_sync_order，默认勾选。
保存/提交开单。
预览/导出 Excel。
预览/导出 PDF。
发送邮件。
清空表单。
保存草稿/草稿列表。
```

提交接口：

```text
POST /api/work-orders
```

提交 body 至少包含：

```json
{
  "salespersonId": 1,
  "customerId": 1,
  "customerName": "华北食品",
  "productName": "山楂卷",
  "bagType": "自立拉链袋",
  "spec": "180*260+40mm",
  "quantity": "20000",
  "deliveryDate": "2026-04-30",
  "roller": "65",
  "remark": "优先排产",
  "syncToOrder": true,
  "emailTo": ["factory@example.com"],
  "emailCc": [],
  "processRequirements": {
    "date": "2026-04-21",
    "printMold": "PET",
    "printFilmSize": "55*10c",
    "printFilmQty": "1200",
    "printFilmUnit": "kg",
    "printQty": "6000",
    "printShift": "6000米",
    "refColor": "按彩稿",
    "inkRequirement": "里印/水煮",
    "filmType": "普通",
    "filmNote": "双组",
    "layer1": "PET",
    "l1Size": "55*10c",
    "l1Weight": "1420kg",
    "layer2": "PE",
    "l2Size": "55.5*8c",
    "l2Weight": "850kg",
    "layer3": "",
    "l3Size": "",
    "l3Weight": "",
    "layer4": "",
    "l4Size": "",
    "l4Weight": "",
    "outsource": "否",
    "zipPos": "上方",
    "tearPos": "两边",
    "holePos": "",
    "holes": "圆孔/飞机孔",
    "edges": "上封/边封",
    "edgeCm": "各1厘米",
    "packType": "纸箱",
    "boxSpec": "50*40*30",
    "actualQty": "",
    "packerSign": "",
    "otherReq": "注意色差"
  }
}
```

### 6.4 开单缺项检测

页面上必须有缺项提示，不要等提交后才失败。

必填项：

```text
业务员
客户
品名
规格
要求数量
印膜材料
印膜尺寸
印膜数量
印膜单位
压辊
袋型
```

如果勾选同步生成订单，需要提示订单同步结果。

## 7. 成本核算页面必须完整

成本核算不能空。必须做成“表格版”，支持不同袋型模板、材料层、自动汇总、计算结果、过程追踪、样例和历史。

### 7.1 核算模板

模板下拉和快捷按钮都要有：

```text
stand_zipper_bag：自立拉链袋成本核算
three_side_seal：三边封袋成本核算
eight_side_seal：八边封成本核算
irregular_zipper_bag：自立拉链异形袋成本核算
back_seal：背封袋成本核算
side_seal：侧边封袋成本核算
four_side_seal：四边封袋成本核算
auto_bag：自动包成本核算
material_weight：材料重量核算
```

切换模板时，相关字段必须动态显示/隐藏：

```text
三边封：不使用底/侧边。
八边封：底作为侧边展开逻辑的一部分。
异形袋：有“有底/无底”选择，无底时底不参与计算。
背封/侧边封/四边封：需要侧边字段。
自动包：隐藏高/宽/底/侧边，显示分切费用、运费、纸筒、边条纸箱、卷宽、卷长。
材料重量：只核算重量，不显示加工费、运费、损耗、利润。
```

### 7.2 基础尺寸字段

```text
高/长：c_ba_chang
宽：c_ba_kuang
侧边：c_ba_ce
底：c_ba_di
异形袋有底：c_ir_has_bottom，0=无底，1=有底
```

单位：

```text
普通袋型按 cm。
材料重量模板按 m。
自动包不使用这些尺寸。
```

### 7.3 材料层表

必须有 4 层材料表：

```text
第1层：材料 c_mat1，厚度 c_t1，比重 c_p1，单价 c_pr1。
第2层：材料 c_mat2，厚度 c_t2，比重 c_p2，单价 c_pr2。
第3层：材料 c_mat3，厚度 c_t3，比重 c_p3，单价 c_pr3。
第4层：材料 c_mat4，厚度 c_t4，比重 c_p4，单价 c_pr4。
```

材料下拉来自：

```text
GET /api/cost/material-prices
```

选材料后自动带出：

```text
比重 prop -> c_p*
单价 price -> c_pr*
```

自动汇总只读字段：

```text
c_thick：厚度数组，如 3,4,5,0。
c_price：单价数组，如 9000,12000,9800,0。
c_prop：比重数组，如 0.92,1.14,1.38,0。
```

### 7.4 成本公共字段

```text
每平方加工费：c_jgf，元/平方。
运费：c_zxyf，元/吨，默认 600。
损耗：c_sh，百分比，10 表示 10%。
利润：c_lr，百分比，12 表示 12%。
拉链单价：c_lldj，元/米，拉链袋必填。
拉链总费用：c_ba_zdf，可空，若填写则优先。
第二层面积：c_m2，可空。
第三层面积：c_m3，可空。
第四层面积：c_m4，可空。
```

自动包专用字段：

```text
分切费用：c_fqfy，默认 400。
自动包运费：c_yf，默认 600。
纸筒：c_zt，默认 0。
边条纸箱：c_btzt，默认 0。
卷宽厘米：c_roll_w，默认 17。
卷长米：c_roll_l，默认 1000。
```

### 7.5 成本计算入参

点击计算时调用：

```text
POST /api/cost/calculate
```

body：

```json
{
  "costType": "stand_zipper_bag",
  "withTrace": true,
  "input": {
    "ba_chang": 20,
    "ba_kuang": 12,
    "ba_ce": 0,
    "ba_di": 5,
    "irregular_has_bottom": 0,
    "thick": [3, 4, 5, 0],
    "price": [9000, 12000, 9800, 0],
    "proportion": [0.92, 1.14, 1.38, 0],
    "jgf": 18,
    "zxyf": 600,
    "sh": 0.1,
    "lr": 0.12,
    "lldj": 2.2,
    "ba_zdf": 0,
    "z_mian_2": 0,
    "z_mian_3": 0,
    "z_mian_4": 0,
    "t1": 3,
    "t2": 4,
    "t3": 5,
    "t4": 0,
    "p1": 0.92,
    "p2": 1.14,
    "p3": 1.38,
    "p4": 0,
    "pr1": 9000,
    "pr2": 12000,
    "pr3": 9800,
    "pr4": 0,
    "mat1": "PE",
    "mat2": "NY",
    "mat3": "PET",
    "mat4": "",
    "fqfy": 400,
    "yf": 600,
    "zt": 0,
    "btzt": 0,
    "roll_w": 17,
    "roll_l": 1000
  }
}
```

注意：

```text
前端损耗和利润输入是百分比，但传给后端要除以 100。
例如页面输入 10，传 sh = 0.1。
页面输入 12，传 lr = 0.12。
```

### 7.6 成本计算结果必须展示

不要只显示 JSON。必须显示成业务可读结果：

```text
展开长度 z_chang
展开宽度 z_kuang
产品面积 z_mian
总厚度 totalThickness
分层重量 layerWeightTon / layerWeightKg
分层材料成本 layerCost
材料成本 materialCost
加工成本 processCost
运费 freightCost
总成本 totalCost 或 costBeforeProfit
最终报价 finalQuote
单位成本 unitCost
```

八边封还要额外显示：

```text
正面材料成本 frontMaterialCost
正面加工成本 frontProcessCost
正面运费 frontFreightCost
正面成本 frontCost
正面报价 frontQuote
侧边展开长 side_chang
侧边展开宽 side_kuang
侧边面积 side_mian
侧边材料成本 sideMaterialCost
侧边加工成本 sideProcessCost
侧边运费 sideFreightCost
侧边成本 sideCost
侧边报价 sideQuote
总报价 = frontQuote + sideQuote
```

自动包还要显示：

```text
折合厚度 allpro
每吨平方数 sqmPerTon
每吨加工费 alljgf
总材料成本 materialCost
分切费用 fqfy
纸筒 zt
边条纸箱 btzt
每卷平方数 rollAreaM2
每平方价格 pricePerSqm
每卷价格 rollPrice
每卷重量 rollWeightKg
```

材料重量模板显示：

```text
每层材料重量 kg
每层材料金额
总重量 kg
总重量 g
总厚度
总材料金额
第一层标准卷长
理论出袋数
折损后出袋数，固定 93%
```

### 7.7 成本结果还要显示“计算过程追踪”

如果接口返回 `trace.steps`，必须展示表格：

```text
序号
变量中文名
公式
计算值
```

不要隐藏过程追踪，这是财务/老板复核用的。

### 7.8 成本页面动作

必须有：

```text
计算按钮
填入演示数据按钮
清空按钮
保存样例
加载样例
删除样例
重命名样例
保存历史
加载历史
导出 Excel
导出 PDF
发送邮件
成本邮件状态
```

接口：

```text
GET /api/cost/snapshots?kind=case
POST /api/cost/snapshots
PATCH /api/cost/snapshots/:id
DELETE /api/cost/snapshots/:id
GET /api/cost/snapshots?kind=history
POST /api/cost/export.xls
POST /api/cost/export.pdf
POST /api/cost/send-email
GET /api/cost/email-logs
POST /api/cost/email-logs/:id/retry
```

## 8. 生产看板页面

生产看板用于车间查看。必须显示：

```text
工序筛选：全部/印刷/复膜/制袋/发货/完成。
压辊筛选。
关键词搜索。
时间范围。
统计区：筛选后订单、加急订单、完成订单、筛选条件。
订单表格：客户/品名/规格/数量/袋型/状态/压辊/备注/更新时间。
统计区显示/隐藏按钮。
表格密度切换：标准/紧凑。
自动刷新开关。
全屏看板按钮。
```

接口：

```text
GET /api/orders/board/panel
GET /api/orders/board/summary
```

## 9. Mock 数据要求

Mock 不要只有一条空数据。至少准备这些状态的数据：

```text
印刷订单：可完成印刷。
复膜订单：可回退印刷，可完成覆膜。
制袋订单：可回退覆膜，可完成制袋。
发货订单：可回退制袋，可完成发货。
完成订单：只显示详情和可回退制袋。
加急订单。
异常数据订单：缺品名或缺规格。
有图片订单。
有开单摘要订单。
有操作日志订单。
有回退日志订单。
worker_print 只能看到本人印刷订单。
manager 能看到全部订单。
```

开单 Mock 至少包含：

```text
业务员 2 个。
客户 3 个。
历史商品 5 个。
材料字典：PET、PE、NY、BOPP、CPP、AL。
袋型：自立拉链、八边封、三边封、背封、自动包。
一条完整四层覆膜数据。
一条只填两层材料的数据。
一条带邮件收件人的数据。
```

成本 Mock 至少包含：

```text
自立拉链袋演示。
八边封演示。
三边封演示。
自动包演示。
材料重量演示。
计算 trace.steps。
保存样例列表。
历史计算列表。
邮件日志。
```

## 10. 交互细节

### 搜索/筛选

点击“搜索/筛选”：

```text
如果面板隐藏，则显示。
如果面板显示，则隐藏。
按钮文案在“搜索/筛选”和“收起筛选”之间切换。
移动端默认可隐藏，桌面端默认展开。
```

### 紧凑模式

点击“紧凑模式”：

```text
按钮文案“紧凑模式：开/关”。
打开后压缩订单卡片 padding/margin。
隐藏筛选面板中的高级筛选行和排序行。
隐藏统计卡片。
隐藏订单卡片非关键信息，如第三行以后的备注/创建时间。
不修改接口参数。
不修改订单数据。
```

### 错误处理

所有接口错误必须弹出或展示：

```text
401：请重新登录。
403：无权限访问该功能。
400：表单校验失败，显示后端 error。
404：数据不存在。
409：流程冲突，例如无可回退记录。
500：服务器错误。
```

## 11. 不要做的事

```text
不要把开单页面简化成只有客户、产品、数量三个字段。
不要把成本核算做成一个空 JSON 输入框。
不要让订单列表只显示订单号和状态。
不要新增后端接口。
不要要求数据库迁移。
不要把前端权限当成安全边界。
不要删除旧业务字段。
不要把真实数据库或 data 目录导入前端。
```

## 12. 验收标准

AI Studio 生成的前端必须满足：

```text
登录后能根据角色显示菜单。
订单列表字段完整，不缺品名/规格/数量/印膜/压辊/备注/按钮。
搜索/筛选能展开收起。
紧凑模式能明显改变布局。
开单表单完整，有生产单所需全部字段。
开单可以通过 Mock 完整提交并生成订单状态。
成本核算能选择袋型模板，填材料层，调用 Mock 计算，展示结果和过程追踪。
生产看板能显示订单和统计。
所有核心页面在手机端可用。
用 Mock 数据时，不应出现大片空白模块。
```

## 13. 推荐给 AI Studio 的第一条任务

请按本说明重构前端，不要只生成空壳。优先完成：

```text
1. 登录与权限菜单。
2. 订单管理完整卡片、筛选面板、紧凑模式、详情弹窗、流程按钮。
3. 开单管理完整生产单表单、客户/商品搜索、历史商品回填、同步生成订单。
4. 成本核算完整表格版、材料层、模板切换、计算结果、过程追踪、样例/历史。
5. 生产看板。
```

先使用 `mocks/mock-data.json` 开发，页面完整后再切换到真实 API。

---

## 14. 订单管理重点补充：展示、修改、完成按钮

这一节是订单管理的最高优先级补充。AI Studio 生成订单管理页面时，必须严格按这里做，不能只做普通表格。

### 14.1 订单列表需要突出显示哪些字段

订单列表不是普通后台列表，必须做成“生产卡片”或“生产表格 + 卡片详情”的形式。每条订单要让车间人员一眼看清楚：现在做什么、谁的货、规格数量、用什么膜、在哪个工序、能不能完成。

#### 第一视觉层级：必须最醒目

这些字段必须放在订单卡片最明显的位置：

```text
品名 productName：优先从 use_case / legacy_json / work_order_summary.productName 中解析。
客户 customerName：如果客户和品名不同，显示“客户：xxx”。
当前工序 status：印刷/复膜/制袋/发货/完成，用颜色标签突出。
加急 urgency：如果 urgency=1，必须显示红色“加急”。
滞留天数 stayDays：根据 updated_at/start_time/created_at 计算，超过 3 天建议红色突出。
完成按钮：当前状态不是完成时必须显示，如“完成印刷”。
详情按钮：每条必须有。
```

推荐卡片头部结构：

```text
[状态标签] [加急] [袋型] [油墨标签] [订阅标签]
品名大标题
客户：xxx
右侧：滞留 N 天
```

#### 第二视觉层级：生产必看字段

这些字段必须在卡片中部展示，不能藏到详情里才有：

```text
规格：order_spec 或 work_order_summary.spec。
数量：order_qty 或 work_order_summary.quantity。
袋型：bag_type。
印膜：wo_print_mold；如果没有，则显示 wo_print_film_size + wo_print_film_qty + wo_print_film_unit。
压辊：roller / work_order_summary.roller。
创建时间：start_time 或 created_at，至少显示日期。
```

推荐展示：

```text
规格：180*260+40mm
数量：20000
印膜：PET 55*10c 1200kg
压辊：65
创建：2026-04-21
```

#### 第三视觉层级：辅助判断字段

这些字段可在完整模式显示，紧凑模式可隐藏：

```text
备注：remark 或 use_case 中解析出的备注。
油墨要求：里印/水煮/蒸煮/哑油/表印，要用小标签显示。
是否外加工：wo_outsource。
交货日期：work_order_summary.deliveryDate。
来源开单号：source_work_no。
最近变更差异：recent_change_diff。
异常数据标记：缺品名、缺规格、缺印膜、缺印刷数量时显示“数据待核对”。
订阅状态：my_subscribed=1 显示“我已订阅”。
图片标记：有 order_image_url 时显示图片图标或缩略图入口。
```

#### 不同模式展示要求

完整模式：

```text
显示品名、客户、袋型、状态、加急、滞留、规格、数量、印膜、压辊、创建时间、备注、油墨、所有按钮。
```

标准模式：

```text
显示品名、客户、状态、规格、数量、印膜、压辊、主要按钮。
```

精简/紧凑模式：

```text
显示品名、状态、规格、数量、压辊、滞留、完成按钮、详情按钮。
隐藏备注、创建时间、统计区、高级筛选行。
```

### 14.2 订单列表按钮规则

每条订单至少有这些按钮：

```text
完成印刷/完成覆膜/完成制袋/完成发货：根据当前 status 显示。
详情：打开订单详情抽屉或弹窗。
回退：如果当前状态允许回退则显示。
订阅/取消订阅：根据 my_subscribed 显示。
```

状态与按钮映射：

```text
status=印刷：显示“完成印刷”，不显示回退。
status=复膜：显示“完成覆膜”，显示“回退印刷”。
status=制袋：显示“完成制袋”，显示“回退覆膜”。
status=发货：显示“完成发货”，显示“回退制袋”。
status=完成：不显示完成按钮，显示“回退制袋”和“详情”。
```

接口映射：

```text
完成按钮：PATCH /api/orders/:id/next
回退按钮：POST /api/orders/:id/rollback-last-complete
详情按钮：GET /api/orders/:id/detail
订阅：POST /api/orders/:id/subscribe
取消订阅：DELETE /api/orders/:id/subscribe
```

### 14.3 完成按钮必须提供哪些选项

点击“完成印刷/完成覆膜/完成制袋/完成发货”后，必须弹出“完成登记”弹窗，不能直接完成。

弹窗字段：

```text
当前工序：只读显示，如“印刷完成登记”。
来源 source：下拉选择，必填。
本次完成数量 qty：数字输入，必填，大于 0。
单位 unit：根据工序自动显示，也可作为只读字段。
备注 remark：可选，前端可保留，当前后端不一定保存。
取消按钮。
确认完成按钮。
```

不同工序的来源选项必须按以下配置：

```text
印刷：
1号机
2号机
3号机
源天外加工1
郭林外加工2
外加工下园3

复膜：
干复 1 号
干复 2 号
无溶 1 号
无溶 2 号
外加工

制袋：
厂内1 号
厂内 2 号
厂内 3 号
厂内 4号
厂内 5 号
厂内6号
厂内7号
厂内8号
厂内9号
桥头制袋 10 号
元华制袋 11 号
崇衍制袋 12 号
源天制袋 13 号
老尾 14 号
俊明制袋 15 号
陈湧钿分切

发货：
发货口1
发货口2
外发
```

不同工序的单位：

```text
印刷：米
复膜：米
制袋：袋
发货：单
```

提交 body：

```json
{
  "source": "1号机",
  "qty": 5000,
  "unit": "米"
}
```

校验规则：

```text
source 不能为空。
qty 必须是数字。
qty 必须大于 0。
确认按钮点击后要防重复提交。
成功后刷新订单列表和生产看板。
失败时显示后端 error。
```

### 14.4 回退按钮怎么做

回退用于撤销上一步完成记录。不要让用户任意选择历史节点，只允许回退上一个工序。

回退规则：

```text
当前是复膜：回退印刷完成，订单状态回到印刷。
当前是制袋：回退复膜完成，订单状态回到复膜。
当前是发货：回退制袋完成，订单状态回到制袋。
当前是完成：回退制袋完成，订单状态回到制袋。
当前是印刷：没有可回退步骤。
```

点击回退时：

```text
弹确认框：确认回退 xxx 完成吗？
可选填写回退原因 rollbackReason。
调用 POST /api/orders/:id/rollback-last-complete。
成功后刷新订单列表、详情、生产看板。
失败 409 时提示“该工序没有可回退的完成记录”。
```

前端可以发送：

```json
{
  "reason": "误点完成，数量录错"
}
```

兼容旧字段时也可以发送：

```json
{
  "processType": "PRINT"
}
```

但新版推荐只依赖当前订单状态和 reason。

### 14.5 修改订单模块怎么做

修改订单不要只做一个简单弹窗。订单详情里必须分成两个编辑区域：

```text
订单信息编辑：修改 orders 表里的核心订单字段。
开单字段对齐：修改对应 work_orders 里的生产单字段。
```

只有 `super_admin` 和 `manager` 显示修改入口。其他角色只读。

#### 订单信息编辑字段

这些字段来自订单主表，保存接口：

```text
PATCH /api/orders/:id/full
```

表单字段：

```text
客户名 customer_name
袋型 bag_type
状态 status：印刷/复膜/制袋/发货/完成
紧急程度 urgency：普通/加急
数量 order_qty
规格 order_spec
印刷机台 assigned_print_worker
覆膜机台 assigned_lamination_worker
制袋岗位 assigned_bagging_worker
发货岗位 assigned_shipping_worker
业务备注/用途 use_case
```

保存 body 示例：

```json
{
  "customer_name": "华北食品",
  "bag_type": "自立拉链袋",
  "status": "印刷",
  "urgency": 1,
  "order_qty": "20000",
  "order_spec": "180*260+40mm",
  "assigned_print_worker": "1号印刷机",
  "assigned_lamination_worker": "1号覆膜机",
  "assigned_bagging_worker": "wangwu",
  "assigned_shipping_worker": "zhaoliu",
  "use_case": "品名：山楂卷；备注：优先排产"
}
```

保存后：

```text
提示“订单信息已保存”。
刷新订单列表。
重新加载当前订单详情。
如果当前在生产看板，也刷新看板。
```

#### 开单字段对齐编辑字段

这部分修改对应开单记录，是为了补齐订单展示缺失字段。保存接口：

```text
PATCH /api/orders/:id/work-order-full
```

表单字段必须覆盖生产单核心字段：

```text
品名 productName
袋型 bagType
规格 spec
开单数量 quantity
交货日期 deliveryDate
压辊 roller

印刷数量 printQty
印膜 printMold
印膜尺寸 printFilmSize
印膜数量 printFilmQty
印膜单位 printFilmUnit
印刷米数 printShift
参考色 refColor
油墨要求 inkRequirement

覆膜工艺 filmType
覆膜要求 filmNote
第一层材质 layer1
第一层规格 l1Size
第一层数量 l1Weight
第二层材质 layer2
第二层规格 l2Size
第二层数量 l2Weight
第三层材质 layer3
第三层规格 l3Size
第三层数量 l3Weight
第四层材质 layer4
第四层规格 l4Size
第四层数量 l4Weight

是否外加工 outsource
拉链位置 zipPos
撕口位置 tearPos
挂孔位置 holePos
孔位 holes
封边 edges
封边数值 edgeCm

装箱类型 packType
装箱规格 boxSpec
实际成品数量 actualQty
装箱人签名 packerSign
其它要求 otherReq
开单备注 remark
```

保存 body 示例：

```json
{
  "productName": "山楂卷",
  "bagType": "自立拉链袋",
  "spec": "180*260+40mm",
  "quantity": "20000",
  "deliveryDate": "2026-04-30",
  "roller": "65",
  "printQty": "6000",
  "printMold": "PET",
  "printFilmSize": "55*10c",
  "printFilmQty": "1200",
  "printFilmUnit": "kg",
  "printShift": "6000米",
  "refColor": "按彩稿",
  "inkRequirement": "里印/水煮",
  "filmType": "普通",
  "filmNote": "双组",
  "layer1": "PET",
  "l1Size": "55*10c",
  "l1Weight": "1420kg",
  "layer2": "PE",
  "l2Size": "55.5*8c",
  "l2Weight": "850kg",
  "layer3": "",
  "l3Size": "",
  "l3Weight": "",
  "layer4": "",
  "l4Size": "",
  "l4Weight": "",
  "outsource": "否",
  "zipPos": "上方",
  "tearPos": "两边",
  "holePos": "",
  "holes": "圆孔/飞机孔",
  "edges": "上封/边封",
  "edgeCm": "各1厘米",
  "packType": "纸箱",
  "boxSpec": "50*40*30",
  "actualQty": "",
  "packerSign": "",
  "otherReq": "注意色差",
  "remark": "优先排产"
}
```

#### 修改订单的缺项提示

订单详情编辑区必须检测关键字段缺失。

订单主表关键字段：

```text
客户名
袋型
数量
规格
```

开单关键字段：

```text
品名
袋型
规格
开单数量
压辊
印膜
印膜尺寸
印膜数量
```

如果缺失：

```text
字段标红。
显示“缺失字段：xxx、xxx”。
提供“定位缺失项”按钮。
允许管理员强制保存，但要二次确认。
```

### 14.6 订单详情展示结构

订单详情建议使用抽屉或大弹窗，分块展示。

必须有这些区块：

```text
订单基础信息
回退上一步
缺项提示
印刷信息
覆膜工艺
制袋与交付
开单字段对齐/编辑
袋型参考图
操作日志
业务备注
订单信息编辑
历史导入字段
危险操作（仅 super_admin）
```

#### 订单基础信息

显示：

```text
订单ID
客户
品名
袋型
状态
数量
规格
来源开单号
最近变更差异
印刷机台
覆膜机台
制袋岗位
发货岗位
创建时间
更新时间
```

#### 印刷信息

显示：

```text
印膜材料
印膜尺寸
印膜数量
印膜单位
印刷数量
印刷米数
参考色
油墨要求
压辊
```

#### 覆膜工艺

显示：

```text
覆膜工艺
覆膜要求
第一层材质/规格/数量
第二层材质/规格/数量
第三层材质/规格/数量
第四层材质/规格/数量
```

#### 制袋与交付

显示：

```text
袋型
交货日期
是否外加工
拉链位置
撕口位置
挂孔位置
孔位
封边
封边数值
其它要求
```

#### 操作日志

日志必须区分完成和回退：

```text
[完成] 工序 ｜ 来源 ｜ 数量+单位 ｜ 操作人 ｜ 时间
[回退] 工序 ｜ 来源 ｜ 数量+单位 ｜ 操作人 ｜ 时间 ｜ 原因
已回退的完成记录要显示“已回退”。
```

### 14.7 图片模块

订单详情要支持袋型图片：

```text
显示 order_image_thumb_url，点击查看 order_image_url 原图。
可粘贴图片 URL 保存。
可上传 png/jpg/webp 图片。
图片大小限制 6MB。
只有 image_can_delete=true 时显示删除图片按钮。
```

接口：

```text
POST /api/orders/:id/image，body: { imageUrl }
POST /api/orders/:id/image，body: { imageDataUrl }
DELETE /api/orders/:id/image
```

### 14.8 排序、置顶和订阅

订单列表可以支持：

```text
长按订单卡片置顶。
调用 POST /api/orders/:id/priority。
priority 越大越靠前。
订阅/取消订阅按钮。
订阅后卡片显示“我已订阅”。
```

### 14.9 订单异常判断

如果订单数据不完整，不要静默隐藏，要明确标记。

异常条件：

```text
品名为空。
规格为空。
品名看起来像“备注：xxx”。
印膜信息为空。
印刷数量为空。
历史导入订单客户字段混乱。
```

显示方式：

```text
卡片显示黄色“数据待核对”。
详情页显示缺项提示条。
修改模块提供补齐入口。
```

### 14.10 历史导入订单处理

旧系统导入的订单可能存在客户/品名混乱。前端要兼容：

```text
如果 is_legacy_imported=true，不要强行把 customer_name 当客户展示。
优先显示从 work_order_summary 找到的 productName/customerName。
详情里保留“历史导入字段”折叠区，方便人工核对。
列表中如果客户字段不可信，可以隐藏客户，只显示品名和规格。
```

### 14.11 订单管理验收标准补充

订单管理完成后必须满足：

```text
列表一眼能看出：品名、客户、当前工序、规格、数量、印膜、压辊、滞留、加急。
点击完成会弹出来源和数量，不会直接完成。
不同工序的来源选项不同。
完成后操作日志新增 COMPLETE。
回退后订单状态回到上一工序，日志出现 ROLLBACK。
详情里能修改订单主字段和开单字段。
缺字段会标红并提示。
有图片时能显示和更换。
管理员能保存修改，工人只能完成本人负责工序。
紧凑模式下仍保留核心生产字段和完成按钮。
Mock 数据能演示印刷/复膜/制袋/发货/完成五种状态。
```

---

## 15. 开单管理补充：邮件、PDF、Excel、预览与草稿

这一节补充开单管理里的“提交、预览、导出、邮件”按钮。AI Studio 不能漏掉这些功能，否则开单管理会变成只能录入不能交付的空模块。

### 15.1 开单表单底部必须有的按钮

开单表单底部动作区必须包含：

```text
同步生成订单并发邮件：复选框 wo_sync_order，默认勾选。
是否加急：wo_urgent，普通/加急。
提交开单。
提交开单并预览PDF。
预览PDF（不提交）。
保存草稿。
恢复草稿。
清空表单。
刷新列表。
```

按钮含义：

```text
提交开单：保存正式开单记录，可按 wo_sync_order 同步生成订单并发送邮件。
提交开单并预览PDF：先保存正式开单，成功后打开该开单 PDF。
预览PDF（不提交）：不生成正式开单，只按当前表单生成 PDF 预览，并保存一条预览草稿。
保存草稿：保存到本地草稿或前端状态，用于未提交前恢复。
恢复草稿：把草稿内容回填表单。
清空表单：清空当前开单表单和勾选项。
刷新列表：刷新开单记录列表和预览草稿列表。
```

### 15.2 提交开单

接口：

```text
POST /api/work-orders
```

提交时必须携带：

```text
salespersonId
customerId
customerName
productName
bagType
spec
quantity
deliveryDate
roller
remark
processRequirements
imageUrl 或 imageDataUrl
emailTo
syncToOrder
urgency
```

提交前要做必填校验，缺字段必须标红并提示。

必填字段：

```text
业务员
客户
品名
规格
要求数量
袋型
压辊
印膜材料
印膜尺寸
印膜数量
印膜单位
```

提交成功后返回示例：

```json
{
  "ok": true,
  "id": 501,
  "workNo": "WO20260421001",
  "orderId": 1001,
  "productNameSaved": "山楂卷-20260421",
  "emailQueued": true,
  "emailTo": "factory@example.com",
  "emailStatus": "sent"
}
```

提交成功后的交互：

```text
弹出“开单成功：WOxxxx”。
如果返回 orderId，跳转到订单管理并高亮新订单。
清空表单主要字段。
重置加急为普通。
重置材料单位为 kg。
清空油墨/孔位/封边多选。
刷新开单列表。
```

### 15.3 提交开单并预览 PDF

按钮行为：

```text
先调用 POST /api/work-orders。
成功后调用 GET /api/work-orders/:id/export.pdf。
把返回的 PDF blob 用新窗口打开。
```

注意：

```text
如果浏览器拦截弹窗，要提示“请允许弹窗后重试”。
预览失败不能影响已经提交成功的开单记录。
```

### 15.4 预览 PDF（不提交）

这个按钮非常重要，用于业务员在正式提交前检查生产单格式。

接口：

```text
POST /api/work-orders/preview.pdf
```

特点：

```text
不生成正式 work_orders 记录。
不生成订单。
不发送邮件。
只根据当前表单 body 生成 PDF 预览。
后端会保存预览草稿，前端要刷新预览未提交记录列表。
```

请求 body 结构和正式提交类似，但可以没有 customerId，只要有 customerName：

```json
{
  "salespersonId": 1,
  "customerName": "华北食品",
  "productName": "山楂卷",
  "bagType": "自立拉链袋",
  "spec": "180*260+40mm",
  "quantity": "20000",
  "deliveryDate": "2026-04-30",
  "roller": "65",
  "remark": "优先排产",
  "processRequirements": {
    "date": "2026-04-21",
    "refColor": "按彩稿",
    "inkRequirement": "里印/水煮",
    "printQty": "6000",
    "printMold": "PET",
    "printFilmSize": "55*10c",
    "printFilmQty": "1200",
    "printFilmUnit": "kg",
    "printFilm": "PET 55*10c 1200kg",
    "printShift": "6000米",
    "filmType": "普通",
    "filmNote": "双组",
    "layer1": "PET",
    "l1Size": "55*10c",
    "l1Qty": "1420",
    "l1Unit": "kg",
    "l1Weight": "1420kg",
    "layer2": "PE",
    "l2Size": "55.5*8c",
    "l2Qty": "850",
    "l2Unit": "kg",
    "l2Weight": "850kg",
    "outsource": "否",
    "holes": "圆孔/飞机孔",
    "edges": "上封/边封",
    "packType": "纸箱",
    "boxSpec": "50*40*30",
    "otherReq": "注意色差"
  }
}
```

成功后：

```text
打开 PDF 新窗口。
调用 GET /api/work-orders/preview-drafts 刷新“预览未提交记录”。
```

### 15.5 预览未提交记录

开单页面必须有一个“预览未提交记录”区域。只有有草稿时显示。

接口：

```text
GET /api/work-orders/preview-drafts?salespersonId=&q=
GET /api/work-orders/preview-drafts/:id
DELETE /api/work-orders/preview-drafts/:id
```

列表每条显示：

```text
预览稿 ID
业务员
客户
品名
袋型
规格
数量
预览时间
```

每条按钮：

```text
导入该订单：把草稿 payload_json 回填到开单表单。
提交开单：把草稿 payload_json 正式 POST /api/work-orders。
提交并预览PDF：正式提交后打开 PDF。
删除：删除该预览草稿。
```

交互要求：

```text
导入草稿后提示“已导入预览未提交记录，可直接提交”。
提交草稿成功后删除该预览草稿。
删除草稿前弹确认框。
```

### 15.6 开单记录列表必须有的字段

开单记录列表不能只显示开单号。每条至少显示：

```text
开单号 work_no
业务员 salesperson_name
客户 customer_name
品名 product_name
袋型 bag_type
规格 spec
数量 quantity
交货日期 delivery_date
关联订单 order_id
开单时间 created_at
邮件状态 email_status
备注 remark
```

邮件状态要用标签显示：

```text
sent：邮件:已发送，绿色。
send_failed：邮件:发送失败，红色。
pending：邮件:待发送，黄色。
空值：可以显示待发送或不显示。
其它值：显示“邮件:xxx”。
```

开单记录列表需要有搜索和分页：

```text
搜索输入：wo_q，搜索开单号/客户/商品/规格。
每页数量：20/50/100。
上一页/下一页。
跳转页码。
```

接口：

```text
GET /api/work-orders?salespersonId=&customerId=&q=&page=&pageSize=
```

### 15.7 开单记录每条必须有的操作按钮

每条开单记录至少有：

```text
导入该订单/导入订单：把该开单记录回填到表单，方便修改后再次提交。
复制开单：复制该记录作为新开单模板。
发送到邮箱。
导出/预览下拉。
执行按钮。
```

导出/预览下拉选项：

```text
预览Excel
导出Excel
WPS专用Excel
预览PDF
导出PDF
```

选项与接口映射：

```text
预览Excel：GET /api/work-orders/:id/preview.xls
导出Excel：GET /api/work-orders/:id/export.xls
WPS专用Excel：GET /api/work-orders/:id/export.wps.xls
预览PDF：GET /api/work-orders/:id/export.pdf
导出PDF：GET /api/work-orders/:id/export.pdf
发送到邮箱：POST /api/work-orders/:id/send-email
```

### 15.8 预览 Excel

预览 Excel 的用途是让用户在浏览器里快速查看开单表格。

接口：

```text
GET /api/work-orders/:id/preview.xls
```

交互：

```text
fetch 后读取 text/html 或 xls HTML 内容。
打开新窗口 about:blank。
把返回内容写入新窗口 document。
如果弹窗被拦截，提示用户允许弹窗。
```

不要把预览 Excel 直接当下载处理，否则用户无法快速检查。

### 15.9 导出 Excel 和 WPS 专用 Excel

导出 Excel：

```text
GET /api/work-orders/:id/export.xls
下载文件名：work_order_<id>.xls
```

WPS 专用 Excel：

```text
GET /api/work-orders/:id/export.wps.xls
下载文件名：work_order_<id>_wps.xls
```

交互：

```text
fetch blob。
创建 a 标签。
URL.createObjectURL(blob)。
触发下载。
下载后 revokeObjectURL。
```

### 15.10 预览 PDF 和导出 PDF

预览 PDF：

```text
GET /api/work-orders/:id/export.pdf
```

交互：

```text
fetch blob。
URL.createObjectURL(blob)。
window.open(blobUrl, '_blank')。
60 秒后 revokeObjectURL。
```

导出 PDF：

```text
GET /api/work-orders/:id/export.pdf
下载文件名：work_order_<id>.pdf
```

同一个接口可以用于预览和下载，区别只在前端处理方式。

### 15.11 发送开单到邮箱

发送邮件必须是弹窗，不要只做一个 prompt。

接口：

```text
POST /api/work-orders/:id/send-email
```

邮件弹窗字段：

```text
收件邮箱 To：可多个输入框，至少一个。
抄送邮箱 Cc：可多个输入框，可空。
+ 添加收件邮箱。
+ 添加抄送邮箱。
每个邮箱输入框旁边有删除按钮。
取消。
发送。
```

发送 body：

```json
{
  "to": "factory@example.com,boss@example.com",
  "cc": "sales@example.com"
}
```

交互要求：

```text
如果 To 为空，提示“请至少填写一个收件邮箱”。
发送前二次确认：“确认发送开单 #id 到所填邮箱？发送后将记录日志。”
发送中按钮 loading。
成功后提示“邮件已发送”。
保存当前用户最近使用的 To/Cc 到 localStorage，下次默认带出。
刷新开单列表，更新 email_status。
失败时显示“发送失败：后端错误”。
```

localStorage 建议 key：

```text
wo.mailTo.last.<username>
wo.mailCc.last.<username>
```

### 15.12 批量操作（现代表格可选但推荐）

如果使用现代表格，可以提供勾选和批量操作：

```text
勾选多条开单记录。
批量导出 PDF。
批量发送邮件。
清空勾选。
```

批量导出 PDF：

```text
逐条调用 GET /api/work-orders/:id/export.pdf 下载。
```

批量发送邮件：

```text
逐条调用 POST /api/work-orders/:id/send-email。
每条失败不能中断全部，最后汇总成功/失败数量。
```

### 15.13 开单导出和邮件权限

这些功能至少允许：

```text
super_admin
manager
ai_sales
```

如果接口返回 403：

```text
显示“无权限发送/导出该开单”。
不要让页面崩溃。
```

### 15.14 开单管理验收标准补充

开单管理完成后必须满足：

```text
表单底部能看到：提交、提交并预览PDF、预览PDF不提交、保存草稿、恢复草稿、清空表单、刷新列表。
预览PDF不提交能打开 PDF，并在预览未提交记录里出现草稿。
预览草稿能导入、正式提交、提交后预览PDF、删除。
开单记录列表能显示邮件状态。
每条开单记录有发送到邮箱按钮。
发送邮箱弹窗支持多个 To/Cc 输入框。
每条开单记录有导出/预览下拉，包含预览Excel、导出Excel、WPS专用Excel、预览PDF、导出PDF。
预览 Excel 是打开新窗口查看，不是直接下载。
导出 Excel/PDF 是下载文件。
提交开单并预览 PDF 会先正式提交，再打开 PDF。
所有下载/预览失败都要显示后端错误信息。
```

---

## 16. 工序模块折叠/展开展示规范与订单模拟数据

这一节用于修正 AI Studio 对“印刷、覆膜、制袋”三个工序模块的理解。前端不能把订单详情做成一整块长表单，也不能所有字段默认全部展开。应按工序模块分块展示，每个模块默认折叠只显示核心生产信息，点击展开后显示完整工艺要求。

术语对齐：

```text
用户口径“覆膜” = 系统旧字段/部分代码里的“复膜”。
用户口径“复合” = 当前系统统一按“覆膜/复膜”处理，不新增“复合”状态。
系统流程状态仍使用：印刷 -> 复膜 -> 制袋 -> 发货 -> 完成。
前端展示文案可以显示“覆膜”，但接口 status 仍兼容“复膜”。
```

### 16.1 工序模块的数据来源字段映射

订单列表和订单详情会同时用到 `orders` 主表字段和 `work_order_summary` 里的开单字段。

通用字段映射：

```text
品名：
优先 work_order_summary.productName
其次从 use_case 解析“品名：xxx”
再次 legacy_json.name

客户：
customer_name_display
work_order_summary.customerName
customer_name
历史导入订单 is_legacy_imported=true 时不要强行展示混乱客户字段

成品规格：
order_spec
work_order_summary.spec
use_case 中“规格：xxx”

数量：
order_qty
work_order_summary.quantity

袋型：
bag_type
work_order_summary.bagType

压辊：
work_order_summary.roller
wo_roller / roller

交货日期：
work_order_summary.deliveryDate

备注：
work_order_summary.remark
use_case 中解析出的备注
```

印刷字段映射：

```text
印刷膜/印膜材料：
work_order_summary.printMold
列表字段 wo_print_mold
processRequirements.printMold

印刷膜尺寸：
work_order_summary.printFilmSize
列表字段 wo_print_film_size
processRequirements.printFilmSize

印刷膜数量：
work_order_summary.printFilmQty + work_order_summary.printFilmUnit
列表字段 wo_print_film_qty + wo_print_film_unit
processRequirements.printFilmQty + processRequirements.printFilmUnit

印刷米数/印刷数量：
work_order_summary.printQty
列表字段 wo_print_qty
processRequirements.printQty

参考色：
work_order_summary.refColor
processRequirements.refColor

油墨要求：
work_order_summary.inkRequirement
列表字段 wo_ink_requirement
processRequirements.inkRequirement

印刷工艺备注/特殊说明：
work_order_summary.printShift
work_order_summary.otherReq
work_order_summary.remark
processRequirements.printShift / otherReq
```

覆膜字段映射：

```text
印膜材料，即印刷后的膜：
work_order_summary.printMold
wo_print_mold

印刷膜尺寸：
work_order_summary.printFilmSize
wo_print_film_size

印刷膜数量：
work_order_summary.printFilmQty + work_order_summary.printFilmUnit
wo_print_film_qty + wo_print_film_unit

覆膜工艺要求：
work_order_summary.filmType
work_order_summary.filmNote
processRequirements.filmType / filmNote

印刷膜第一层：
work_order_summary.printMold / printFilmSize / printFilmQty
可在 UI 中作为“印刷膜（第一层）”展示

覆膜第一层：
work_order_summary.layer1.material
work_order_summary.layer1.size
work_order_summary.layer1.weight
或 l1Size / l1Weight / layer1

覆膜第二层：
layer2.material / layer2.size / layer2.weight
或 l2Size / l2Weight / layer2

覆膜第三层：
layer3.material / layer3.size / layer3.weight
或 l3Size / l3Weight / layer3

覆膜第四层：
layer4.material / layer4.size / layer4.weight
或 l4Size / l4Weight / layer4

油墨要求：
inkRequirement，可与印刷工序复用

其它备注/特殊工艺：
filmNote / otherReq / remark
```

制袋字段映射：

```text
品名：
work_order_summary.productName

成品规格：
work_order_summary.spec
order_spec

袋型：
work_order_summary.bagType
bag_type

撕口：
work_order_summary.tearPos

拉链：
work_order_summary.zipPos

挂孔：
work_order_summary.holePos
work_order_summary.holes

封边：
work_order_summary.edges
work_order_summary.edgeCm

制袋交付信息：
work_order_summary.deliveryDate
work_order_summary.outsource

装箱信息：
work_order_summary.packType
work_order_summary.boxSpec
work_order_summary.actualQty
work_order_summary.packerSign

其它特殊要求：
work_order_summary.otherReq
work_order_summary.remark
```

### 16.2 印刷工序模块展示规范

印刷模块适用于：

```text
订单详情里的“印刷信息”区块。
订单列表中当前状态为“印刷”的卡片重点信息。
生产看板的印刷列/印刷筛选状态。
```

默认折叠状态只展示核心信息：

```text
品名：productName。
印刷膜：printMold。
印刷膜尺寸：printFilmSize。
印刷膜厚度：如果后端没有独立 thickness 字段，则从 printFilmSize、filmNote、otherReq 或 layer 信息中提取；提取不到显示“-”，不要虚构。
米数：printQty，单位默认米。
压辊：roller。
```

推荐默认折叠卡片：

```text
印刷
品名：山楂卷
印刷膜：PET
尺寸/厚度：55*10c / 12u
米数：6000米
压辊：65
```

点击展开后补充完整信息：

```text
印刷工艺备注：printShift / filmNote / remark。
参考色：refColor，例如按彩稿、按打样膜、按原膜样、按样品袋。
油墨要求：inkRequirement，例如里印、水煮、蒸煮、哑油、表印。
油墨颜色/型号：当前接口没有独立字段时，可放在 inkRequirement 或 otherReq 中显示。
环保/食品级标准：当前接口没有独立字段时，可放在 otherReq 中显示，例如“食品级油墨，符合食品包装要求”。
其它特殊工艺说明：otherReq。
图片：如果有 order_image_url，可显示袋型图入口。
操作日志：印刷 COMPLETE/ROLLBACK 日志。
```

印刷模块缺字段提示：

```text
缺品名：显示“缺品名”。
缺印刷膜：显示“缺印刷膜”。
缺印刷膜尺寸：显示“缺印膜尺寸”。
缺米数：显示“缺印刷米数”。
缺压辊：显示“缺压辊”。
```

### 16.3 覆膜工序模块展示规范

覆膜模块对应系统状态 `复膜`，前端文案建议显示“覆膜”。不要新增 `复合` 状态。

默认折叠状态只展示核心信息，并与印刷模块布局对齐：

```text
印膜材料：printMold，表示印刷后的膜。
印刷膜尺寸：printFilmSize。
印刷膜数量：printFilmQty + printFilmUnit。
```

推荐默认折叠卡片：

```text
覆膜
印膜材料：PET
印刷膜尺寸：55*10c
印刷膜数量：1200kg
```

点击展开后显示覆膜全流程结构和要求：

```text
品名：productName，与印刷工序联动。
覆膜工艺要求：filmType，例如蒸煮、双组、普通。
覆膜要求备注：filmNote，例如耐温、防潮、强度、蒸煮要求。
油墨要求：inkRequirement，可与印刷工序复用。
其它备注/特殊工艺说明：otherReq / remark。
```

覆膜层结构必须以“层结构表”展示：

```text
印刷膜（第一层）：
材料 = printMold
尺寸 = printFilmSize
数量 = printFilmQty + printFilmUnit

覆膜第一层：
材质 = layer1.material / layer1
尺寸 = layer1.size / l1Size
厚度 = 如果没有独立字段，从 size 或 material 文本提取；提取不到显示“-”
数量 = layer1.weight / l1Weight

覆膜第二层：
材质 = layer2.material / layer2
尺寸 = layer2.size / l2Size
厚度 = 同上
数量 = layer2.weight / l2Weight

覆膜第三层：
材质 = layer3.material / layer3
尺寸 = layer3.size / l3Size
厚度 = 同上
数量 = layer3.weight / l3Weight

覆膜第四层：
材质 = layer4.material / layer4
尺寸 = layer4.size / l4Size
厚度 = 同上
数量 = layer4.weight / l4Weight
```

说明：

```text
用户需求里写“覆膜第一层、第二层、第三层”，旧系统实际支持 layer1-layer4 四层。
前端应支持最多四层；没有值的层可以隐藏或显示“-”。
印刷膜也要作为覆膜结构中的“印刷膜（第一层）”单独展示，不能丢掉。
```

覆膜模块缺字段提示：

```text
缺印膜材料。
缺印刷膜尺寸。
缺印刷膜数量。
缺覆膜工艺要求时，不阻止展示，但展开区显示“未填写覆膜工艺要求”。
```

### 16.4 制袋工序模块展示规范

制袋模块适用于订单详情中的“制袋与交付”区块，也适用于当前状态为制袋的订单卡片重点展示。

默认折叠状态只展示核心业务信息：

```text
品名：productName。
成品规格：spec / order_spec。
袋型：bagType / bag_type，例如自立袋、三边封、拉链袋、八边封、背封、自动包。
```

推荐默认折叠卡片：

```text
制袋
品名：山楂卷
成品规格：180*260+40mm
袋型：自立拉链袋
```

点击展开后显示制袋全流程细节：

```text
制袋工艺要求：
撕口 tearPos
拉链 zipPos
挂孔 holePos / holes
封边 edges / edgeCm
其它特殊要求 otherReq

制袋交付信息：
交货日期 deliveryDate
是否外加工 outsource

装箱信息：
装箱类型 packType
装箱规格 boxSpec
实际成品数量 actualQty
装箱人签名 packerSign

备注：
remark
```

制袋模块缺字段提示：

```text
缺品名。
缺成品规格。
缺袋型。
缺交货日期时只提示，不阻止展示。
缺撕口/拉链/挂孔/封边时显示“未填写”，不能隐藏整块。
```

### 16.5 三个工序模块的 UI 行为

每个工序模块建议使用 `details/summary`、折叠卡片或手风琴组件实现。

通用行为：

```text
默认折叠。
折叠态只显示核心字段。
点击模块标题或“展开详情”后显示完整字段。
再次点击收起。
如果当前订单状态等于该工序，该模块应高亮。
如果该工序已经完成，显示“已完成”标签，并显示完成日志摘要。
如果该工序被回退，显示“已回退”标签或在日志中标注。
```

推荐视觉状态：

```text
当前工序：蓝色或主色高亮。
已完成工序：绿色标签。
待处理工序：灰色标签。
异常/缺项：黄色提示。
加急订单：红色加急标识。
```

移动端要求：

```text
折叠态必须一屏内能看到多个订单。
展开态允许纵向滚动。
核心字段不能横向溢出。
层结构表在移动端可改为卡片列表。
```

### 16.6 工序模块对应完成按钮

三个工序模块中的完成按钮仍按订单状态决定，不按模块是否展开决定。

```text
当前状态=印刷：印刷模块显示“完成印刷”按钮。
当前状态=复膜：覆膜模块显示“完成覆膜”按钮。
当前状态=制袋：制袋模块显示“完成制袋”按钮。
当前状态=发货：发货模块显示“完成发货”按钮，发货模块可以是简单交付模块。
当前状态=完成：不显示完成按钮。
```

完成按钮仍必须弹出完成登记：

```text
来源 source
本次完成数量 qty
单位 unit
```

不要因为模块折叠就直接调用完成接口。

### 16.7 订单模拟数据示例

AI Studio 需要在 Mock 中准备更真实的订单数据，覆盖印刷、覆膜、制袋三个模块的折叠/展开展示。

#### 模拟订单 1：印刷中，自立拉链袋，加急

```json
{
  "id": 2001,
  "customer_name": "华北食品",
  "customer_name_display": "华北食品",
  "bag_type": "自立拉链袋",
  "status": "印刷",
  "urgency": 1,
  "order_qty": "20000",
  "order_spec": "180*260+40mm",
  "use_case": "品名：山楂卷；规格：180*260+40mm；备注：食品级油墨，颜色按彩稿，优先排产",
  "assigned_print_worker": "1号机",
  "assigned_lamination_worker": "干复 1 号",
  "assigned_bagging_worker": "厂内1号",
  "assigned_shipping_worker": "发货口1",
  "start_time": "2026-04-22 08:30:00",
  "created_at": "2026-04-22 08:30:00",
  "updated_at": "2026-04-22 09:10:00",
  "wo_print_mold": "PET",
  "wo_print_film_size": "55*10c",
  "wo_print_film_qty": "1200",
  "wo_print_film_unit": "kg",
  "wo_print_qty": "6000",
  "wo_ink_requirement": "里印/食品级/水煮",
  "work_order_summary": {
    "workNo": "WO20260422001",
    "customerName": "华北食品",
    "productName": "山楂卷",
    "bagType": "自立拉链袋",
    "spec": "180*260+40mm",
    "quantity": "20000",
    "deliveryDate": "2026-04-30",
    "roller": "65",
    "remark": "食品级油墨，颜色按彩稿，优先排产",
    "printMold": "PET",
    "printFilmSize": "55*10c",
    "printFilmQty": "1200",
    "printFilmUnit": "kg",
    "printQty": "6000",
    "printShift": "预计印刷 6000 米，注意套印偏差",
    "refColor": "按彩稿",
    "inkRequirement": "里印/食品级/水煮",
    "filmType": "普通",
    "filmNote": "防潮，强度正常",
    "layer1": { "material": "PET", "size": "55*10c", "weight": "1200kg" },
    "layer2": { "material": "PE", "size": "55.5*8c", "weight": "850kg" },
    "layer3": { "material": "", "size": "", "weight": "" },
    "layer4": { "material": "", "size": "", "weight": "" },
    "zipPos": "上方",
    "tearPos": "两边",
    "holePos": "",
    "holes": "圆孔",
    "edges": "上封/边封",
    "edgeCm": "各1厘米",
    "outsource": "否",
    "packType": "纸箱",
    "boxSpec": "50*40*30",
    "actualQty": "",
    "packerSign": "",
    "otherReq": "食品级标准，注意色差"
  },
  "operation_logs": []
}
```

#### 模拟订单 2：覆膜中，八边封，带蒸煮要求

```json
{
  "id": 2002,
  "customer_name": "南方宠物食品",
  "customer_name_display": "南方宠物食品",
  "bag_type": "八边封袋",
  "status": "复膜",
  "urgency": 0,
  "order_qty": "15000",
  "order_spec": "200*300+80mm",
  "use_case": "品名：宠物冻干袋；规格：200*300+80mm；备注：蒸煮级，覆膜强度加严",
  "assigned_print_worker": "2号机",
  "assigned_lamination_worker": "无溶 1 号",
  "assigned_bagging_worker": "厂内3号",
  "assigned_shipping_worker": "发货口2",
  "start_time": "2026-04-21 14:00:00",
  "created_at": "2026-04-21 14:00:00",
  "updated_at": "2026-04-22 10:20:00",
  "wo_print_mold": "PET",
  "wo_print_film_size": "62*12c",
  "wo_print_film_qty": "980",
  "wo_print_film_unit": "kg",
  "wo_print_qty": "5200",
  "wo_ink_requirement": "里印/蒸煮/耐温",
  "work_order_summary": {
    "workNo": "WO20260421008",
    "customerName": "南方宠物食品",
    "productName": "宠物冻干袋",
    "bagType": "八边封袋",
    "spec": "200*300+80mm",
    "quantity": "15000",
    "deliveryDate": "2026-05-02",
    "roller": "80",
    "printMold": "PET",
    "printFilmSize": "62*12c",
    "printFilmQty": "980",
    "printFilmUnit": "kg",
    "printQty": "5200",
    "refColor": "按打样膜",
    "inkRequirement": "里印/蒸煮/耐温",
    "filmType": "蒸煮",
    "filmNote": "耐温 121℃，防潮，复合强度加严",
    "layer1": { "material": "PET", "size": "62*12c", "weight": "980kg" },
    "layer2": { "material": "NY", "size": "62*15c", "weight": "760kg" },
    "layer3": { "material": "PE", "size": "62*80c", "weight": "1260kg" },
    "layer4": { "material": "", "size": "", "weight": "" },
    "outsource": "否",
    "zipPos": "",
    "tearPos": "两边",
    "holePos": "",
    "holes": "",
    "edges": "边封/下封",
    "edgeCm": "边封1.2厘米",
    "packType": "纸箱",
    "boxSpec": "60*45*35",
    "otherReq": "覆膜后静置 24 小时再制袋"
  },
  "operation_logs": [
    {
      "id": 9101,
      "stage": "印刷",
      "source": "2号机",
      "qty": 5200,
      "unit": "米",
      "event_type": "COMPLETE",
      "rolled_back": 0,
      "operated_by": "print02",
      "created_at": "2026-04-22 09:30:00"
    }
  ]
}
```

#### 模拟订单 3：制袋中，三边封，外加工

```json
{
  "id": 2003,
  "customer_name": "潮汕调味品",
  "customer_name_display": "潮汕调味品",
  "bag_type": "三边封袋",
  "status": "制袋",
  "urgency": 0,
  "order_qty": "30000",
  "order_spec": "120*180mm",
  "use_case": "品名：调味料小袋；规格：120*180mm；备注：外加工制袋，装箱按 1000 个/箱",
  "assigned_print_worker": "3号机",
  "assigned_lamination_worker": "干复 2 号",
  "assigned_bagging_worker": "桥头制袋 10 号",
  "assigned_shipping_worker": "外发",
  "start_time": "2026-04-20 09:00:00",
  "created_at": "2026-04-20 09:00:00",
  "updated_at": "2026-04-22 11:00:00",
  "wo_print_mold": "BOPP",
  "wo_print_film_size": "48*8c",
  "wo_print_film_qty": "700",
  "wo_print_film_unit": "kg",
  "wo_print_qty": "8000",
  "wo_ink_requirement": "表印/普通",
  "work_order_summary": {
    "workNo": "WO20260420012",
    "customerName": "潮汕调味品",
    "productName": "调味料小袋",
    "bagType": "三边封袋",
    "spec": "120*180mm",
    "quantity": "30000",
    "deliveryDate": "2026-04-28",
    "roller": "55",
    "printMold": "BOPP",
    "printFilmSize": "48*8c",
    "printFilmQty": "700",
    "printFilmUnit": "kg",
    "printQty": "8000",
    "refColor": "按样品袋",
    "inkRequirement": "表印/普通",
    "filmType": "普通",
    "filmNote": "防潮",
    "layer1": { "material": "BOPP", "size": "48*8c", "weight": "700kg" },
    "layer2": { "material": "CPP", "size": "48*50c", "weight": "980kg" },
    "layer3": { "material": "", "size": "", "weight": "" },
    "layer4": { "material": "", "size": "", "weight": "" },
    "outsource": "是",
    "zipPos": "",
    "tearPos": "单边撕口",
    "holePos": "",
    "holes": "",
    "edges": "三边封",
    "edgeCm": "边封0.8厘米",
    "packType": "纸箱",
    "boxSpec": "1000个/箱",
    "actualQty": "",
    "packerSign": "",
    "otherReq": "外加工制袋，回厂后抽检封边"
  },
  "operation_logs": [
    {
      "id": 9201,
      "stage": "印刷",
      "source": "3号机",
      "qty": 8000,
      "unit": "米",
      "event_type": "COMPLETE",
      "rolled_back": 0,
      "operated_by": "print03",
      "created_at": "2026-04-20 15:00:00"
    },
    {
      "id": 9202,
      "stage": "复膜",
      "source": "干复 2 号",
      "qty": 7800,
      "unit": "米",
      "event_type": "COMPLETE",
      "rolled_back": 0,
      "operated_by": "film02",
      "created_at": "2026-04-21 12:00:00"
    }
  ]
}
```

#### 模拟订单 4：字段缺失，展示异常提示

```json
{
  "id": 2004,
  "customer_name": "备注：旧系统导入字段混乱",
  "customer_name_display": "",
  "bag_type": "自立袋",
  "status": "印刷",
  "urgency": 0,
  "order_qty": "10000",
  "order_spec": "",
  "use_case": "生产信息：旧系统导入；备注: 缺品名和规格，需要人工核对",
  "is_legacy_imported": true,
  "wo_print_mold": "",
  "wo_print_film_size": "",
  "wo_print_film_qty": "",
  "wo_print_film_unit": "",
  "wo_print_qty": "",
  "work_order_summary": null,
  "operation_logs": []
}
```

该订单前端必须显示：

```text
数据待核对。
缺品名。
缺规格。
缺印刷膜。
缺印膜尺寸。
缺印刷米数。
历史导入字段折叠区。
管理员可在修改订单模块中补齐。
```

### 16.8 AI Studio 对工序模块的验收标准

完成后必须满足：

```text
订单详情里有印刷、覆膜、制袋三个独立模块。
三个模块默认折叠，只显示该工序核心字段。
点击展开后显示完整工艺要求。
覆膜模块文案显示“覆膜”，但接口仍兼容 status=复膜。
覆膜层结构表不能丢印刷膜，也不能只显示一层。
制袋模块默认必须显示品名、规格、袋型。
制袋展开必须显示撕口、拉链、挂孔、封边、交期、外加工、装箱。
缺字段时显示黄色提示，而不是空白。
Mock 数据至少包含上面 4 条订单。
移动端折叠态要紧凑，展开态可滚动。
```

## 17. 开单管理与成本核算字段字典、字段属性、排版规范

这一节用于补齐开发人员最容易缺失的内容：`开单管理` 和 `成本核算` 到底需要哪些字段、每个字段是什么属性、是否必填、如何联动、前端页面怎么排布。AI Studio 不能只按模块标题做页面，必须按下面的字段规格落地。

### 17.1 字段属性统一约定

本文中字段属性含义统一如下：

```text
字段编码：建议给前端表单 state / mock / types 使用，不要求后端真实接口必须同名。
显示名称：页面上给业务员/跟单/生产看的中文名称。
类型：input / number / select / textarea / radio / checkbox / date / datetime / table / readonly / action。
必填：Y = 提交正式开单/正式计算前必须校验；N = 可空；C = 条件必填。
默认值：新建页面初始值，没有则为空。
数据来源：手工录入 / 接口回填 / 历史商品回填 / 自动计算 / 当前登录人。
联动规则：字段之间的显示/隐藏、自动回填、自动计算规则。
布局：页面中所在分组和推荐栅格宽度，例如 1/4、1/3、1/2、整行。
```

前端排版统一约定：

```text
PC 端使用 24 栅格。
1/4 = span 6。
1/3 = span 8。
1/2 = span 12。
2/3 = span 16。
整行 = span 24。
移动端统一改为单列。
关键字段优先放在首屏，不允许全部塞进折叠区。
```

### 17.2 开单管理页面总体排版

开单管理页面建议固定为以下顺序：

```text
顶部工具条
客户/历史商品快捷选择区
基础订单信息区
印刷信息区
覆膜结构区
制袋与交付区
装箱与邮件区
备注与附件区
底部操作按钮区
右侧或底部联动摘要区
```

布局要求：

```text
顶部工具条固定显示，不随表单折叠而消失。
客户/历史商品快捷选择区放在最上方，避免重复录入。
印刷、覆膜、制袋三个工艺分区必须独立卡片，不能混成一个长表单。
覆膜四层结构必须用表格或分层行展示，不能做成一个 textarea。
底部按钮固定包含：提交、提交并预览 PDF、预览 PDF、不提交保存草稿、恢复草稿、清空、刷新。
右侧或底部联动摘要区实时显示关键结果：客户、品名、袋型、规格、数量、交期、压辊、材料层、是否同步生成订单。
```

### 17.3 开单管理字段字典

#### 17.3.1 顶部工具条字段

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| work_no | 开单号 | readonly | N | 自动生成或空 | 后端返回 | 提交成功后回填；草稿可为空 | 1/4 |
| salesman | 业务员 | select / readonly | Y | 当前登录人 | 当前用户 / 用户列表 | 可根据权限限制是否可改 | 1/4 |
| created_at | 开单时间 | readonly | N | 当前时间 | 前端显示 / 后端回填 | 提交后锁定 | 1/4 |
| sync_order | 同步生成订单 | checkbox | Y | true | 前端默认 | 关闭时只生成开单记录，不推订单流转 | 1/4 |
| draft_status | 草稿状态 | readonly | N | 未保存 | 前端状态 | 保存草稿后显示“已保存”及时间 | 1/4 |

#### 17.3.2 客户与历史商品快捷区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| customer_keyword | 客户搜索 | input | N | 空 | 手工录入 | 输入时搜索客户列表 | 1/3 |
| customer_id | 客户ID | hidden / readonly | N | 空 | 客户接口 | 选中客户后写入 | 1/4 |
| customer_name | 客户名称 | input / select | Y | 空 | 手工录入 / 客户回填 | 选客户后回填常用联系人、邮箱、历史商品 | 1/3 |
| customer_contact | 联系人 | input | N | 空 | 客户资料 | 跟随客户回填，可改 | 1/4 |
| customer_phone | 联系电话 | input | N | 空 | 客户资料 | 跟随客户回填，可改 | 1/4 |
| customer_email | 默认邮箱 | input / tags | N | 空 | 客户资料 | 发邮件弹窗默认带出 | 1/3 |
| history_product_keyword | 历史商品搜索 | input | N | 空 | 手工录入 | 搜索该客户历史商品 | 1/3 |
| history_product_id | 历史商品ID | hidden | N | 空 | 历史商品接口 | 选中后回填品名/袋型/规格/材料层等 | 1/4 |
| history_fill_mode | 回填方式 | radio | N | 覆盖空字段 | 前端默认 | 支持“仅填空值 / 全部覆盖” | 1/3 |

#### 17.3.3 基础订单信息区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| product_name | 品名 | input | Y | 空 | 手工录入 / 历史商品回填 | 同步显示到摘要、订单列表、工序模块 | 1/3 |
| product_alias | 商品简称 | input | N | 空 | 手工录入 | 用于列表副标题或搜索别名 | 1/4 |
| bag_type | 袋型 | select | Y | 空 | 手工录入 / 历史回填 | 决定成本模板和制袋字段显示 | 1/4 |
| order_spec | 成品规格 | input | Y | 空 | 手工录入 / 历史回填 | 同步到制袋模块；支持 mm 文本 | 1/4 |
| order_qty | 订单数量 | number | Y | 空 | 手工录入 | 与单位一起显示；可用于成本换算 | 1/4 |
| order_qty_unit | 数量单位 | select | Y | 个 | 前端默认 | 常见：个 / 只 / 包 | 1/4 |
| delivery_date | 交货日期 | date | Y | 空 | 手工录入 | 订单列表显示滞留天数 | 1/4 |
| urgency | 是否加急 | radio | Y | 否 | 前端默认 | 选“是”后订单卡片显示加急标签 | 1/4 |
| use_case | 用途 / 应用场景 | input | N | 空 | 手工录入 | 可给成本核算和材质建议使用 | 1/3 |
| order_note | 订单备注 | textarea | N | 空 | 手工录入 | 列表和详情都要可见 | 整行 |

#### 17.3.4 印刷信息区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| roller | 压辊 | input | C | 空 | 手工录入 / 历史回填 | 有印刷工序时必填 | 1/4 |
| print_mold | 印膜材质 | select / input | C | 空 | 手工录入 / 历史回填 | 同步给印刷/覆膜模块 | 1/4 |
| print_film_size | 印刷膜尺寸 | input | C | 空 | 手工录入 | 折叠态重点显示 | 1/4 |
| print_film_thickness | 印刷膜厚度 | input | N | 空 | 手工录入 / 推导 | 若接口无独立字段，可并入尺寸文本 | 1/4 |
| print_film_qty | 印刷膜数量 | input | C | 空 | 手工录入 | 与单位组合显示 | 1/4 |
| print_film_unit | 印刷膜单位 | select | C | kg | 前端默认 | kg / 卷 / 米 | 1/4 |
| print_qty | 印刷米数 | number | C | 空 | 手工录入 | 印刷完成按钮默认单位用米 | 1/4 |
| color_count | 色数 | input | N | 空 | 手工录入 | 可用于压辊/油墨识别 | 1/4 |
| ref_color | 参考色 / 色样 | input | N | 空 | 手工录入 | 详情展开显示 | 1/4 |
| ink_requirement | 油墨要求 | textarea | N | 空 | 手工录入 / 历史回填 | 可包含颜色、型号、环保、食品级要求 | 1/2 |
| print_process_note | 印刷工艺备注 | textarea | N | 空 | 手工录入 | 展开区显示 | 1/2 |
| print_special_note | 印刷特殊工艺 | textarea | N | 空 | 手工录入 | 如专色、哑光、反印等 | 1/2 |

#### 17.3.5 覆膜结构区

覆膜区必须做成分层结构，不允许一个字段糊成文本。

公共字段：

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| film_type | 覆膜类型 | select | N | 普通 | 手工录入 | 可选普通 / 蒸煮 / 高阻隔 / 冷冻等 | 1/4 |
| film_note | 覆膜工艺要求 | textarea | N | 空 | 手工录入 | 如耐温、防潮、蒸煮、强度要求 | 1/2 |
| film_ink_requirement | 覆膜油墨要求 | textarea | N | 同印刷 | 手工录入 / 复用 | 默认可继承印刷油墨要求 | 1/2 |

层结构字段建议做成 4 行表格，每行字段一致：

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| layerX_role | 层级角色 | readonly / select | Y | 第X层 | 前端固定 | 第1层通常为印刷膜 | 1/6 |
| layerX_material | 材质 | input / select | C | 空 | 手工录入 / 历史回填 | 只要该层启用则必填 | 1/4 |
| layerX_size | 尺寸 | input | C | 空 | 手工录入 | 与材质同层显示 | 1/4 |
| layerX_thickness | 厚度 | input | N | 空 | 手工录入 | 无独立字段时可空 | 1/6 |
| layerX_qty | 数量 / 重量 | input | C | 空 | 手工录入 | 可写 kg 或数量 | 1/6 |
| layerX_unit | 单位 | select | N | kg | 前端默认 | kg / 米 / 卷 | 1/6 |
| layerX_enabled | 启用该层 | checkbox | N | X=1,2 默认启用 | 前端默认 | 未启用时该行隐藏或禁用 | 1/6 |

层级语义建议：

```text
layer1 = 印刷膜
layer2 = 覆膜第一层
layer3 = 覆膜第二层
layer4 = 覆膜第三层
```

#### 17.3.6 制袋与交付区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bag_spec | 制袋规格 | input | N | 同成品规格 | 手工录入 / 继承 | 默认继承成品规格，可单独调整 | 1/4 |
| bag_edge_type | 封边方式 | input / select | N | 空 | 手工录入 | 如三边封、背封、八边封 | 1/4 |
| zipper_type | 拉链类型 | input / select | N | 空 | 手工录入 | 袋型涉及拉链时显示 | 1/4 |
| zipper_pos | 拉链位置 | input | N | 空 | 手工录入 | 拉链袋时显示 | 1/4 |
| tear_type | 撕口 | input / select | N | 空 | 手工录入 | 制袋展开区显示 | 1/4 |
| hole_type | 挂孔类型 | input / select | N | 空 | 手工录入 | 有挂孔需求时显示 | 1/4 |
| hole_count | 挂孔数量 | input | N | 空 | 手工录入 | 与挂孔类型联动 | 1/4 |
| outsource_bagging | 外加工 | radio | N | 否 | 前端默认 | 选“是”时显示外加工厂备注 | 1/4 |
| outsource_vendor | 外加工厂家 | input | C | 空 | 手工录入 | 外加工时必填 | 1/3 |
| delivery_method | 交付方式 | input / select | N | 空 | 手工录入 | 自提 / 送货 / 物流 | 1/4 |
| actual_delivery_qty | 实交数量 | input | N | 空 | 手工录入 | 可后补 | 1/4 |
| other_req | 其他特殊要求 | textarea | N | 空 | 手工录入 | 对应详情里的特殊要求 | 整行 |

#### 17.3.7 装箱与邮件区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pack_type | 装箱类型 | input / select | N | 空 | 手工录入 | 如纸箱 / 编织袋 | 1/4 |
| box_spec | 装箱规格 | input | N | 空 | 手工录入 | 如 1000个/箱 | 1/4 |
| box_qty | 箱数 | input | N | 空 | 手工录入 | 可后补 | 1/4 |
| mail_to | 收件人 | tags | N | 空 | 客户资料 / 手工录入 | 打开发送邮件弹窗时默认带出 | 1/2 |
| mail_cc | 抄送人 | tags | N | 空 | 最近记录 / 手工录入 | 发送邮件弹窗默认带出 | 1/2 |
| mail_subject | 邮件主题 | input | N | 系统生成 | 前端模板 | 默认包含客户、品名、开单号 | 1/2 |
| mail_remark | 邮件备注 | textarea | N | 空 | 手工录入 | 仅用于邮件正文附加说明 | 1/2 |

#### 17.3.8 备注与附件区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attachment_list | 附件列表 | upload / table | N | 空 | 上传接口 | 支持图片、PDF、样袋参考图 | 整行 |
| internal_note | 内部备注 | textarea | N | 空 | 手工录入 | 仅内部可见，不发给客户 | 整行 |
| customer_note | 客户备注 | textarea | N | 空 | 手工录入 | 可进 PDF / 邮件 | 整行 |

### 17.4 开单管理字段联动与校验规则

核心校验规则：

```text
正式提交时至少校验：业务员、客户、品名、袋型、规格、数量、交期。
存在印刷工序时校验：压辊、印膜材质、印刷膜尺寸、印刷膜数量、印刷米数。
选择外加工=是 时必须填写外加工厂家。
袋型涉及拉链时必须显示并校验拉链类型或拉链位置。
点击“提交并预览 PDF”时，先走正式提交逻辑，再跳预览。
点击“预览 PDF（不提交）”时，只校验生成预览所需关键字段，不写正式订单。
历史商品回填后，必须高亮本次回填了哪些字段，避免业务员误覆盖。
```

推荐交互：

```text
客户选中后自动展开历史商品面板。
历史商品回填后如果覆盖了现有值，给出浅色差异提示。
覆膜层数默认显示两层，开启第三/第四层时再追加显示。
右侧摘要区随输入实时更新，方便人工核对。
```

### 17.5 成本核算页面总体排版

成本核算不是单个表单，而是“模板切换 + 参数表 + 材料层表 + 结果区 + 过程区 + 样例/历史”组成的工具页。

推荐页面结构：

```text
顶部模板与动作条
基础尺寸参数区
材料层参数表
辅料与工艺参数区
损耗/利润/税费区
计算结果区
过程追踪区
样例与历史区
```

布局要求：

```text
模板选择和计算按钮固定在页面顶部。
材料层必须是表格区，不能用一堆散乱输入框。
计算结果区必须在首屏可见，不要滚到底才看见。
过程追踪区显示公式和中间值，不能只有最终金额。
样例与历史区可折叠，但默认至少展示最近 3 条。
```

### 17.6 成本核算字段字典

#### 17.6.1 顶部模板与动作条

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cost_template | 袋型模板 | select | Y | stand_zipper_bag | 前端默认 / 历史选择 | 决定尺寸字段和公式差异 | 1/4 |
| quote_customer | 客户名称 | input / select | N | 空 | 手工录入 / 开单带入 | 仅用于报价标题和历史记录 | 1/4 |
| quote_product_name | 品名 | input | N | 空 | 开单带入 / 手工录入 | 与历史方案联动 | 1/4 |
| quote_qty | 订单数量 | number | Y | 空 | 手工录入 / 开单带入 | 影响单个成本和总成本 | 1/4 |
| calc_action | 开始核算 | action | Y | - | 用户点击 | 触发计算 | 1/4 |
| reset_action | 重置 | action | N | - | 用户点击 | 清空当前参数 | 1/4 |
| load_sample_action | 加载样例 | action | N | - | 用户点击 | 加载模板样例 | 1/4 |
| save_history_action | 保存历史 | action | N | - | 用户点击 | 保存当前核算方案 | 1/4 |

#### 17.6.2 基础尺寸参数区

这些字段随袋型模板动态变化，但建议统一保留字段编码，按模板决定显示。

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bag_width | 袋宽 | number | Y | 空 | 手工录入 | 单位 mm | 1/4 |
| bag_height | 袋高 | number | Y | 空 | 手工录入 | 单位 mm | 1/4 |
| side_gusset | 侧边 / 侧风琴 | number | C | 空 | 手工录入 | 八边封/侧边封等模板显示 | 1/4 |
| bottom_gusset | 底边 / 底插 | number | C | 空 | 手工录入 | 自立袋/八边封常用 | 1/4 |
| top_margin | 上边 | number | N | 空 | 手工录入 | 用于核算展开尺寸 | 1/4 |
| bottom_margin | 下边 | number | N | 空 | 手工录入 | 用于核算展开尺寸 | 1/4 |
| zipper_length | 拉链长度 | C | N | 空 | 手工录入 | 拉链袋模板显示 | 1/4 |
| zipper_width | 拉链宽度 | number | N | 空 | 手工录入 | 自动包等可隐藏 | 1/4 |
| hole_size | 挂孔尺寸 | number | N | 空 | 手工录入 | 有挂孔时显示 | 1/4 |
| edge_width | 封边宽度 | number | N | 空 | 手工录入 | 三边封/背封等使用 | 1/4 |
| one_row_count | 一出几 | number | N | 1 | 手工录入 | 影响用料和效率 | 1/4 |
| print_repeat | 印刷周长 / 周长版长 | number | N | 空 | 手工录入 | 与印刷米数换算相关 | 1/4 |

模板显示建议：

```text
自立拉链袋：袋宽、袋高、底插、拉链长度、上边、下边。
三边封：袋宽、袋高、封边宽度、上边、下边。
八边封：袋宽、袋高、侧边、底边、上边、下边。
背封/侧边封/四边封：袋宽、袋高、侧边或封边宽度。
自动包：卷膜宽度、单包长度、一出几、切刀间距等扩展字段要显示。
```

#### 17.6.3 材料层参数表

材料层表是成本核算核心。每层一行，至少支持 4 层。

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| materialX_enabled | 启用层 | checkbox | N | 1,2 层默认启用 | 前端默认 | 控制该行是否参与计算 | 1/8 |
| materialX_name | 材料名称 | select / input | C | 空 | 材料库 / 手工录入 | 启用该层时必填 | 1/6 |
| materialX_spec | 材料规格 | input | N | 空 | 材料库回填 | 可显示如 `PET12` | 1/6 |
| materialX_thickness | 厚度 | number | C | 空 | 材料库回填 / 手工录入 | 单位通常为 um | 1/8 |
| materialX_density | 比重 | number | C | 空 | 材料库回填 / 手工录入 | 参与重量计算 | 1/8 |
| materialX_width | 用料宽度 | number | C | 空 | 自动计算 / 手工修正 | 可根据模板和尺寸自动推导 | 1/8 |
| materialX_length | 用料长度 / 米数 | number | N | 空 | 自动计算 | 结果字段，可允许人工修正 | 1/8 |
| materialX_loss_rate | 损耗率 | number | N | 0 | 手工录入 | 百分比 | 1/8 |
| materialX_unit_price | 单价 | number | C | 空 | 材料库回填 / 手工录入 | 单位通常元/kg | 1/8 |
| materialX_weight | 预计重量 | readonly | N | 0 | 自动计算 | 参与总成本 | 1/8 |
| materialX_amount | 材料金额 | readonly | N | 0 | 自动计算 | = 重量 * 单价 * (1+损耗) | 1/8 |

材料层表推荐额外列：

```text
材料类别：表印 / 里膜 / 中间层 / 铝箔 / 拉链。
备注：例如“蒸煮级”“哑光膜”“高阻隔”。
```

#### 17.6.4 辅料与工艺参数区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| zipper_price | 拉链单价 | number | N | 0 | 手工录入 | 拉链袋模板显示 | 1/4 |
| zipper_cost_mode | 拉链计价方式 | select | N | 按条 | 前端默认 | 按条 / 按米 | 1/4 |
| valve_price | 气阀单价 | number | N | 0 | 手工录入 | 咖啡袋等可用 | 1/4 |
| spout_price | 吸嘴单价 | number | N | 0 | 手工录入 | 吸嘴袋时显示 | 1/4 |
| print_plate_fee | 制版费 | number | N | 0 | 手工录入 | 可摊入单价或单独展示 | 1/4 |
| print_fee | 印刷费 | number | N | 0 | 手工录入 | 可按色数或订单量计算 | 1/4 |
| lamination_fee | 覆膜费 | number | N | 0 | 手工录入 | 按米或按公斤核算 | 1/4 |
| bagging_fee | 制袋费 | number | N | 0 | 手工录入 | 与袋型相关 | 1/4 |
| labor_fee | 人工费 | number | N | 0 | 手工录入 | 可直接录入 | 1/4 |
| packing_fee | 包装费 | number | N | 0 | 手工录入 | 箱、袋、托盘等 | 1/4 |
| shipping_fee | 运费 | number | N | 0 | 手工录入 | 可选是否摊入单价 | 1/4 |
| misc_fee | 其他费用 | number | N | 0 | 手工录入 | 其它辅料/加工费 | 1/4 |

#### 17.6.5 损耗、利润、税费区

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| overall_loss_rate | 总损耗率 | number | N | 0 | 手工录入 | 对总成本二次加成 | 1/4 |
| management_fee_rate | 管理费率 | number | N | 0 | 手工录入 | 可选 | 1/4 |
| profit_rate | 利润率 | number | Y | 0 | 手工录入 | 报价必须有 | 1/4 |
| tax_rate | 税率 | number | N | 0 | 手工录入 | 可选含税报价 | 1/4 |
| include_tax | 是否含税 | radio | N | 是 | 前端默认 | 影响最终报价展示 | 1/4 |
| include_shipping | 运费是否摊入 | radio | N | 否 | 前端默认 | 控制单价组成 | 1/4 |
| quote_round_mode | 报价取整方式 | select | N | 保留4位 | 前端默认 | 保留2位 / 4位 / 角分取整 | 1/4 |

#### 17.6.6 自动包专用字段

这些字段只在 `auto_bag` 模板下显示。

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auto_roll_width | 卷膜宽度 | number | Y | 空 | 手工录入 | 自动包模板显示 | 1/4 |
| auto_cut_length | 单包长度 | number | Y | 空 | 手工录入 | 自动包模板显示 | 1/4 |
| auto_speed_loss | 机速损耗 | number | N | 0 | 手工录入 | 影响损耗 | 1/4 |
| auto_cursor_gap | 光标间距 | number | N | 0 | 手工录入 | 影响长度 | 1/4 |
| auto_punch_fee | 打孔费用 | number | N | 0 | 手工录入 | 特殊工艺 | 1/4 |
| auto_slit_fee | 分切费用 | number | N | 0 | 手工录入 | 特殊工艺 | 1/4 |

#### 17.6.7 计算结果区

结果区全部只读，必须大字号突出展示。

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| result_total_material_cost | 材料总成本 | readonly | N | 0 | 自动计算 | 汇总所有材料层 | 1/4 |
| result_total_process_cost | 工艺总成本 | readonly | N | 0 | 自动计算 | 汇总印刷/覆膜/制袋等 | 1/4 |
| result_total_accessory_cost | 辅料总成本 | readonly | N | 0 | 自动计算 | 汇总拉链/吸嘴等 | 1/4 |
| result_total_cost | 总成本 | readonly | N | 0 | 自动计算 | 含损耗前或后需文案明确 | 1/4 |
| result_unit_cost | 单个成本 | readonly | N | 0 | 自动计算 | = 总成本 / 数量 | 1/4 |
| result_quote_unit_price | 报价单价 | readonly | N | 0 | 自动计算 | 含利润、税费等 | 1/4 |
| result_quote_total_price | 报价总价 | readonly | N | 0 | 自动计算 | = 报价单价 * 数量 | 1/4 |
| result_gross_profit | 毛利额 | readonly | N | 0 | 自动计算 | 用于业务判断 | 1/4 |
| result_gross_profit_rate | 毛利率 | readonly | N | 0 | 自动计算 | 用于业务判断 | 1/4 |

#### 17.6.8 过程追踪区

过程追踪区不是字段录入区，而是公式展开区。建议结构如下：

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| trace_material_rows | 材料计算过程 | table / readonly | N | 空 | 自动计算 | 每层显示宽度、长度、重量、金额公式 | 整行 |
| trace_process_rows | 工艺计算过程 | table / readonly | N | 空 | 自动计算 | 显示印刷/覆膜/制袋费用构成 | 整行 |
| trace_summary | 汇总公式 | textarea / readonly | N | 空 | 自动计算 | 显示总成本、报价、利润形成过程 | 整行 |

### 17.7 成本核算字段联动规则

核心联动规则：

```text
切换袋型模板时，只切换显示和计算逻辑，不清空所有公共字段。
从开单管理进入成本核算时，客户、品名、袋型、规格、数量、材料层优先自动带入。
切换到拉链相关模板时显示拉链字段；切换到非拉链模板时隐藏但保留已录值。
切换到自动包模板时显示自动包专用字段，并隐藏不适用的制袋字段。
启用某个材料层时，该层材质、厚度、比重、单价变为必填。
材料名称从材料库选中后，可自动回填规格、厚度、比重、默认单价。
总损耗率、利润率、税率变化时，结果区实时刷新。
```

推荐默认值：

```text
profit_rate 默认 8% 或沿用最近一次值。
include_tax 默认“是”。
include_shipping 默认“否”。
material1、material2 默认启用。
load_sample_action 根据当前模板加载对应样例。
```

### 17.8 开单管理与成本核算的联动关系

AI Studio 做前端时，必须把两个模块打通，不能各做一套孤立页面。

联动要求：

```text
开单页可一键进入成本核算，并带入当前品名、袋型、规格、数量、材料层。
成本核算保存历史后，可回到开单页选择“采用本次核算结果”。
开单详情里应能查看最近一次相关成本核算摘要。
如果同一客户+同一品名已有历史核算方案，应在成本页推荐最近方案。
成本页不直接改后端订单数据；只有用户确认采用后，才把报价摘要回写到开单侧展示区。
```

可回写的摘要字段：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| quoted_unit_price | 报价单价 | readonly | 用于开单侧查看，不作为订单流转字段 |
| quoted_total_price | 报价总价 | readonly | 同上 |
| quoted_material_summary | 材料摘要 | readonly | 例如 `PET12/AL7/PE80` |
| quoted_version | 核算版本 | readonly | 标识采用哪次核算 |

### 17.9 给 AI Studio 的最终实现要求

完成这一节后，AI Studio 必须满足：

```text
开单管理页面有完整字段，不是空壳。
每个字段有明确分区，业务员能按工艺顺序录入。
覆膜层结构是表格化的，不是备注堆砌。
成本核算页面有模板切换、材料层表、辅料参数、结果区、过程追踪区。
成本结果不是只显示一个总价，必须展示单个成本、总成本、报价单价、毛利。
字段显隐要跟袋型模板联动。
开单管理和成本核算之间有数据带入和摘要回写能力。
Mock 数据必须覆盖至少 1 套完整开单表单和 3 套不同袋型的成本核算样例。
```

## 18. 统计分析模块字段、布局、指标与权限规范

这一节用于补齐 `统计分析` 模块。AI Studio 不能把统计分析只做成几张空图，也不能只显示“订单总数”这种通用后台指标。这个系统的统计分析必须围绕包装工厂真实业务，展示订单、客户、工序、交期、成本、利润、异常、人员绩效等维度。

### 18.1 统计分析模块总体定位

统计分析模块不是单一页面，建议拆成以下二级页签：

```text
总览看板
订单分析
客户分析
生产分析
成本与利润分析
异常与逾期分析
业务员分析
导出报表
```

如果现阶段不做完整多页签，至少要在一个页面里按以上分区展示，不能只放 2 到 3 张图。

### 18.2 统计分析页面总体布局

推荐布局顺序：

```text
顶部筛选条
核心 KPI 卡片区
总览趋势图区
订单与客户双列图区
生产与工序双列图区
成本与利润区
异常与逾期区
明细排行表格区
导出操作区
```

布局要求：

```text
PC 端首屏必须先看到 KPI 卡片和主趋势图。
移动端图表改为单列堆叠，表格默认只显示核心列。
所有图表都要支持“本月 / 上月 / 本季度 / 自定义时间”切换。
图表下方要有数值摘要，不允许只有图没有数字。
关键图表需要支持点击钻取到订单列表或明细弹窗。
```

### 18.3 顶部筛选条字段

筛选条字段建议统一供各子分析区复用。

| 字段编码 | 显示名称 | 类型 | 必填 | 默认值 | 数据来源 | 联动规则 | 布局 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| analysis_date_range | 统计时间 | daterange | Y | 本月 | 前端默认 | 驱动全部统计 | 1/3 |
| analysis_date_type | 时间口径 | select | Y | 下单日期 | 前端默认 | 可选下单日期 / 交货日期 / 完成日期 | 1/4 |
| analysis_customer | 客户 | select / searchable | N | 全部 | 客户列表 | 过滤客户相关图表与排行 | 1/4 |
| analysis_salesman | 业务员 | select | N | 全部 | 用户列表 | 权限不足时仅能看自己 | 1/4 |
| analysis_status | 订单状态 | select | N | 全部 | 状态枚举 | 可选未下单 / 印刷 / 复膜 / 制袋 / 已完成等 | 1/4 |
| analysis_bag_type | 袋型 | select | N | 全部 | 袋型枚举 | 统计不同袋型订单 | 1/4 |
| analysis_urgency | 加急类型 | select | N | 全部 | 前端枚举 | 普通 / 加急 | 1/4 |
| analysis_include_legacy | 包含历史导入 | checkbox | N | true | 前端默认 | 关闭后排除脏数据 | 1/4 |
| analysis_group_by | 聚合方式 | select | N | 按天 | 前端默认 | 按天 / 周 / 月 / 客户 / 业务员 / 袋型 | 1/4 |
| analysis_refresh | 刷新 | action | N | - | 用户点击 | 重新拉取统计数据 | 1/4 |
| analysis_export | 导出 | action | N | - | 用户点击 | 导出当前筛选口径报表 | 1/4 |

### 18.4 核心 KPI 卡片区

KPI 卡片是首屏重点，必须大字展示，不要埋在图表下面。

| 指标编码 | 显示名称 | 类型 | 数据来源 | 说明 |
| --- | --- | --- | --- | --- |
| kpi_order_count | 订单总数 | KPI | 订单统计接口 | 当前筛选范围内订单数 |
| kpi_order_qty | 订单总量 | KPI | 订单统计接口 | 单位按系统主单位显示 |
| kpi_pending_count | 在制订单数 | KPI | 订单统计接口 | 未完成订单 |
| kpi_completed_count | 已完成订单数 | KPI | 订单统计接口 | 已完成订单 |
| kpi_overdue_count | 逾期订单数 | KPI | 订单统计接口 | 交期已过且未完成 |
| kpi_urgent_count | 加急订单数 | KPI | 订单统计接口 | urgency=1 |
| kpi_customer_count | 活跃客户数 | KPI | 客户统计接口 | 当前区间有订单的客户数 |
| kpi_total_amount | 订单金额 / 报价金额 | KPI | 若接口有金额字段则显示 | 无金额时可隐藏 |
| kpi_estimated_cost | 估算成本总额 | KPI | 成本汇总接口 | 有成本数据时显示 |
| kpi_estimated_profit | 估算利润总额 | KPI | 成本汇总接口 | 有成本和报价时显示 |

展示要求：

```text
首行至少显示 6 个 KPI。
每个 KPI 支持同比或环比小标签，例如较上月 +12%。
没有同比数据时显示“-”，不要伪造。
点击 KPI 可跳转到对应明细列表。
```

### 18.5 总览趋势图区

总览趋势图至少包含以下组件：

| 组件编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| trend_order_count | 订单数量趋势 | 折线 / 柱状 | 按日 / 周 / 月展示订单数量变化 |
| trend_order_qty | 订单数量总量趋势 | 折线 | 展示产量或订单量走势 |
| trend_completed_rate | 完成率趋势 | 折线 | 已完成 / 总订单 |
| trend_overdue_rate | 逾期率趋势 | 折线 | 逾期订单占比 |

要求：

```text
主趋势图默认显示订单数量趋势。
支持切换第二指标，例如切换到“完成率趋势”。
鼠标悬停显示当天订单数、完成数、逾期数、加急数。
点击某一天可下钻订单列表，并自动带入日期筛选。
```

### 18.6 订单分析

订单分析关注订单结构和流转状态。

#### 18.6.1 订单分析指标

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| order_status_dist | 订单状态分布 | 环形图 | 未下单 / 印刷 / 复膜 / 制袋 / 已完成 / 异常 |
| order_bag_type_dist | 袋型分布 | 柱状图 | 各袋型订单数 |
| order_customer_top | 客户订单排行 | 横向条形图 | 客户订单数 Top N |
| order_stay_days_top | 滞留天数排行 | 表格 | 滞留最久订单 |
| order_urgent_ratio | 加急订单占比 | 环形图 | 普通 vs 加急 |
| order_completion_cycle | 平均完成周期 | KPI / 折线 | 下单到完成的平均天数 |

#### 18.6.2 订单分析明细表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| order_no | 订单号 | text | 可点击进详情 |
| customer_name | 客户 | text | 历史导入异常可标记 |
| product_name | 品名 | text | 核心字段 |
| bag_type | 袋型 | text | 核心字段 |
| order_spec | 规格 | text | 核心字段 |
| order_qty | 数量 | text | 核心字段 |
| status | 当前工序 | tag | 印刷 / 复膜 / 制袋 / 已完成 |
| stay_days | 滞留天数 | number | 超过阈值高亮 |
| delivery_date | 交期 | date | 逾期标红 |
| urgency | 加急 | tag | 是 / 否 |
| salesman | 业务员 | text | 便于追踪责任 |

### 18.7 客户分析

客户分析要帮助业务员判断客户贡献、活跃度和客户偏好。

#### 18.7.1 客户分析指标

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| customer_order_top | 客户订单数排行 | 条形图 | Top N 客户 |
| customer_qty_top | 客户订货量排行 | 条形图 | 按数量汇总 |
| customer_repeat_rate | 复购客户占比 | KPI | 本期复购客户 / 活跃客户 |
| customer_new_count | 新客户数 | KPI | 首次下单客户数 |
| customer_bag_preference | 客户袋型偏好 | 堆叠柱状 | 客户常做袋型 |
| customer_delivery_risk | 客户逾期订单排行 | 表格 | 哪些客户最容易积压 |

#### 18.7.2 客户分析明细表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| customer_name | 客户名称 | text | 可点击查看客户详情 |
| order_count | 订单数 | number | 当前筛选区间 |
| total_qty | 订货总量 | number | 当前筛选区间 |
| urgent_count | 加急单数 | number | 当前筛选区间 |
| overdue_count | 逾期单数 | number | 当前筛选区间 |
| main_bag_type | 主要袋型 | text | 该客户最常下单袋型 |
| last_order_date | 最近下单日期 | date | 判断活跃度 |

### 18.8 生产分析

生产分析必须按工序展开，不能只给一个“生产中订单数”。

#### 18.8.1 工序看板指标

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| stage_print_count | 印刷中订单数 | KPI | 当前在印刷工序 |
| stage_lamination_count | 覆膜中订单数 | KPI | 当前在复膜/覆膜工序 |
| stage_bagging_count | 制袋中订单数 | KPI | 当前在制袋工序 |
| stage_waiting_count | 待排产订单数 | KPI | 尚未进入生产 |
| stage_abnormal_count | 异常订单数 | KPI | 有字段缺失或流程异常 |

#### 18.8.2 工序产能与流转图

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| stage_inflow_outflow | 工序流入流出趋势 | 堆叠柱状 | 各工序每天进入/完成单量 |
| stage_completion_rate | 工序完成率 | 条形图 | 各工序完成率对比 |
| machine_source_dist | 机台 / 来源分布 | 柱状图 | 完成按钮里的来源统计 |
| rollback_count | 回退次数统计 | 条形图 | 查看流程异常点 |
| operator_workload | 操作员工作量 | 条形图 | 按完成日志统计 |

#### 18.8.3 生产明细表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| order_no | 订单号 | text | 可点进详情 |
| product_name | 品名 | text | 核心字段 |
| current_stage | 当前工序 | tag | 印刷 / 覆膜 / 制袋 |
| source_name | 当前来源 / 机台 | text | 来自完成日志 |
| stage_entered_at | 进入当前工序时间 | datetime | 用于算滞留 |
| stage_stay_days | 当前工序滞留时长 | number | 高亮超时订单 |
| operator_name | 当前责任人 | text | 权限允许时显示 |
| next_action_hint | 下一步动作 | text | 例如“待覆膜完成” |

### 18.9 成本与利润分析

这一块和成本核算模块联动，但统计分析更偏汇总和趋势。

#### 18.9.1 成本与利润指标

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| profit_total | 利润总额 | KPI | 有报价和成本时显示 |
| profit_rate_avg | 平均毛利率 | KPI | 当前筛选区间 |
| cost_bag_type_dist | 各袋型成本分布 | 柱状图 | 看哪些袋型成本高 |
| profit_customer_top | 客户利润排行 | 条形图 | Top N |
| profit_product_top | 品名利润排行 | 条形图 | Top N |
| cost_material_share | 材料成本占比 | 饼图 | 表印 / 里膜 / 铝箔 / 拉链等 |
| cost_trend | 成本趋势 | 折线 | 成本总额变化 |
| quote_vs_cost | 报价与成本对比 | 双轴图 | 报价、成本、利润对比 |

#### 18.9.2 成本利润明细表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| quote_no | 核算/报价编号 | text | 可关联开单 |
| customer_name | 客户 | text | 维度字段 |
| product_name | 品名 | text | 维度字段 |
| bag_type | 袋型 | text | 维度字段 |
| order_qty | 数量 | number | 维度字段 |
| total_cost | 总成本 | money | 汇总值 |
| unit_cost | 单个成本 | money | 汇总值 |
| quote_unit_price | 报价单价 | money | 汇总值 |
| quote_total_price | 报价总价 | money | 汇总值 |
| gross_profit | 毛利额 | money | 汇总值 |
| gross_profit_rate | 毛利率 | percent | 汇总值 |

### 18.10 异常与逾期分析

这个系统必须把异常单和逾期单单独拉出来，不能埋在普通统计里。

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| abnormal_order_count | 异常订单数 | KPI | 缺关键字段、流程异常等 |
| overdue_order_count | 逾期订单数 | KPI | 超交期未完成 |
| abnormal_type_dist | 异常类型分布 | 环形图 | 缺品名、缺规格、缺印膜、流程回退过多等 |
| overdue_stage_dist | 逾期工序分布 | 条形图 | 哪个工序最容易积压 |
| abnormal_top_table | 异常订单排行 | 表格 | 按严重程度、滞留天数排序 |

异常明细表至少要有：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| order_no | 订单号 | text | 可点进详情 |
| abnormal_reason | 异常原因 | text | 缺字段 / 回退异常 / 状态冲突 |
| missing_fields | 缺失字段 | text | 例如 品名、规格、印刷米数 |
| current_stage | 当前工序 | tag | 当前所在工序 |
| stay_days | 滞留天数 | number | 当前工序滞留 |
| delivery_date | 交期 | date | 逾期标红 |
| owner | 责任人 | text | 可选 |

### 18.11 业务员分析

如果系统有业务员角色，统计分析里必须有业务员分析。

| 指标编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| salesman_order_top | 业务员订单数排行 | 条形图 | 谁开单最多 |
| salesman_customer_count | 业务员客户数 | 条形图 | 活跃客户数 |
| salesman_urgent_ratio | 业务员加急单占比 | 条形图 | 反映订单结构 |
| salesman_overdue_ratio | 业务员逾期单占比 | 条形图 | 风险提示 |
| salesman_profit_top | 业务员利润排行 | 条形图 | 有利润数据时显示 |

业务员明细表字段：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| salesman_name | 业务员 | text | 维度字段 |
| order_count | 订单数 | number | 当前区间 |
| customer_count | 客户数 | number | 当前区间 |
| urgent_count | 加急单数 | number | 当前区间 |
| overdue_count | 逾期单数 | number | 当前区间 |
| total_qty | 总数量 | number | 当前区间 |
| total_profit | 总利润 | money | 有数据时显示 |

### 18.12 图表与交互实现要求

AI Studio 不能只画静态图。统计分析至少满足以下交互：

```text
所有图表支持 hover tooltip。
核心图表支持点击下钻到订单列表或明细弹窗。
筛选条件变化后，KPI、图表、表格同步刷新。
表格支持按数值排序，例如按滞留天数、订单数、利润额降序。
支持“重置筛选”。
空数据时显示“当前条件下暂无数据”，不要白屏。
图表数据为 0 时也要渲染坐标轴和 0 状态说明。
```

### 18.13 权限要求

统计分析要考虑不同角色看到的数据范围不同。

权限建议：

```text
管理员：可看全部统计、全部客户、全部业务员、利润数据、导出。
业务员：默认只看自己的订单、客户、报价和利润；不可看其他业务员明细。
生产人员：可看订单和工序统计，但默认不显示利润、报价金额。
财务/老板角色：可看全部利润和成本趋势。
普通账号若无导出权限，隐藏导出按钮。
```

前端必须支持：

```text
根据登录用户权限隐藏或禁用利润相关图表。
根据权限限制业务员筛选下拉可选范围。
无权限字段显示为“-”或不展示，不要报错。
```

### 18.14 统计分析模块 Mock 数据口径要求

Mock 不能只给 3 个 KPI 数字，要覆盖完整结构。

至少需要以下模拟数据：

```text
KPI 汇总对象 1 份。
按天订单趋势 30 条。
按状态分布 1 组。
按袋型分布 1 组。
客户排行 10 条。
业务员排行 5 条。
工序流入流出趋势 14 条。
逾期订单明细 10 条。
异常订单明细 10 条。
利润排行 10 条。
```

建议的 Mock 字段结构：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| summary | KPI 汇总 | object | 放所有 KPI 数值 |
| orderTrend | 订单趋势 | array | 日期、订单数、完成数、逾期数 |
| statusDistribution | 状态分布 | array | status、count |
| bagTypeDistribution | 袋型分布 | array | bagType、count |
| customerRanking | 客户排行 | array | customerName、orderCount、qty |
| salesmanRanking | 业务员排行 | array | salesman、orderCount、customerCount |
| stageFlowTrend | 工序流转趋势 | array | date、printIn、printOut、filmIn、filmOut、bagIn、bagOut |
| overdueOrders | 逾期订单明细 | array | 订单核心字段 |
| abnormalOrders | 异常订单明细 | array | 异常原因、缺失字段 |
| profitRanking | 利润排行 | array | customer/product/profit |

### 18.15 给 AI Studio 的最终实现要求

统计分析完成后必须满足：

```text
不是空白图表页，而是完整业务分析页。
有顶部筛选、KPI、趋势图、结构图、排行表。
有订单、客户、生产、成本利润、异常、业务员几个维度。
图表和表格字段围绕包装厂业务，而不是通用电商后台字段。
支持权限控制，生产角色默认不看利润。
支持空数据态、排序、下钻、导出。
Mock 数据结构完整，足够把页面做满，不会出现图表为空、表格没列的情况。
```

## 19. 系统管理模块字段、权限管理、系统打包与发布规范

这一节用于补齐 `系统管理` 模块。AI Studio 不能把系统管理只做成一个“用户列表 + 新增按钮”的空后台。这个项目的系统管理至少要覆盖：

```text
用户管理
角色管理
权限管理
菜单管理
系统配置
数据字典/基础资料
操作日志
系统打包与发布入口
导入导出与备份说明
```

注意：

```text
不改线上数据库结构。
不迁移真实业务数据。
不重构后端核心权限架构。
前端只围绕现有用户、角色、permissions、菜单控制做整理和重构。
```

### 19.1 系统管理模块总体布局

建议采用左侧二级导航 + 右侧详情区布局。

推荐菜单顺序：

```text
系统管理
  用户管理
  角色管理
  权限管理
  菜单管理
  系统配置
  数据字典
  操作日志
  系统打包
  导入导出说明
```

布局要求：

```text
左侧显示二级菜单。
右侧页面顶部统一有筛选、刷新、导出、权限提示。
列表页必须有分页、状态标签、最后更新时间。
编辑页或抽屉页必须区分“可编辑字段”和“只读系统字段”。
危险操作必须二次确认。
```

### 19.2 权限模型前端口径

前端必须以 `/api/auth/me` 返回的用户身份和 `permissions` 为准，不允许硬编码所有菜单都显示。

权限口径建议：

```text
roleCode：角色编码，例如 super_admin、manager、sales、operator、finance。
permissions：接口/菜单/按钮权限数组。
menuKeys：当前用户可见菜单 key 数组。
dataScope：数据范围，例如 all / self / department / none。
```

前端必须支持：

```text
菜单级权限：没有菜单权限就不显示该菜单。
页面级权限：有菜单但无查看权限时，显示“无权限访问”空态。
按钮级权限：如删除、导出、修改、打包等按钮按权限隐藏或禁用。
数据范围权限：业务员只看自己的订单、客户、统计。
利润权限：生产角色默认看不到利润、报价金额、成本分析。
```

### 19.3 用户管理

用户管理不是简单账号表，必须支持账号状态、角色绑定、数据范围和最近登录信息。

#### 19.3.1 用户列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| user_id | 用户ID | text | 系统主键，只读 |
| username | 登录账号 | text | 唯一标识 |
| real_name | 姓名 | text | 页面显示名称 |
| role_name | 角色 | tag / text | 可多角色时显示多个标签 |
| department | 部门 | text | 可选 |
| phone | 手机号 | text | 可选 |
| email | 邮箱 | text | 可选 |
| status | 状态 | switch / tag | 启用 / 停用 |
| data_scope | 数据范围 | tag | 全部 / 本人 / 部门 |
| last_login_at | 最后登录时间 | datetime | 只读 |
| last_login_ip | 最后登录IP | text | 只读 |
| created_at | 创建时间 | datetime | 只读 |
| updated_at | 更新时间 | datetime | 只读 |

#### 19.3.2 用户筛选字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| user_keyword | 关键词 | input | 搜账号/姓名/手机号 |
| user_role_filter | 角色 | select | 按角色筛选 |
| user_status_filter | 状态 | select | 启用 / 停用 |
| user_department_filter | 部门 | select | 按部门筛选 |

#### 19.3.3 用户编辑字段

| 字段编码 | 显示名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| username | 登录账号 | input | Y | 新建时必填，编辑时通常只读 |
| real_name | 姓名 | input | Y | 用户展示名 |
| password | 初始密码 | password | C | 新建时必填，编辑时可重置 |
| phone | 手机号 | input | N | 联系方式 |
| email | 邮箱 | input | N | 联系方式 |
| role_ids | 角色 | checkbox / select | Y | 至少选一个角色 |
| data_scope | 数据范围 | select | Y | all / self / department |
| status | 状态 | switch | Y | 启用 / 停用 |
| remark | 备注 | textarea | N | 内部备注 |

用户管理行为要求：

```text
支持新增、编辑、停用/启用、重置密码。
删除用户属于危险操作，若旧系统不支持真实删除，前端只做停用，不虚构删除接口。
编辑用户时要提示该用户当前角色和权限影响范围。
业务员角色默认 data_scope=self。
```

### 19.4 角色管理

角色管理决定菜单、按钮和数据范围的组合。

#### 19.4.1 角色列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| role_id | 角色ID | text | 主键 |
| role_code | 角色编码 | text | 例如 super_admin、manager、sales |
| role_name | 角色名称 | text | 中文名 |
| role_desc | 角色说明 | text | 用途说明 |
| user_count | 绑定人数 | number | 该角色当前关联用户数 |
| data_scope | 数据范围 | tag | all / self / department |
| status | 状态 | switch / tag | 启用 / 停用 |
| created_at | 创建时间 | datetime | 只读 |
| updated_at | 更新时间 | datetime | 只读 |

#### 19.4.2 角色编辑字段

| 字段编码 | 显示名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| role_code | 角色编码 | input | Y | 唯一 |
| role_name | 角色名称 | input | Y | 中文名称 |
| role_desc | 角色说明 | textarea | N | 描述角色用途 |
| data_scope | 数据范围 | select | Y | all / self / department |
| status | 状态 | switch | Y | 是否启用 |
| permission_keys | 权限项 | tree / checkbox | Y | 勾选菜单/按钮/接口权限 |
| menu_keys | 菜单可见项 | tree | Y | 控制左侧菜单 |

角色管理行为要求：

```text
角色编辑必须使用树形权限选择，不要只给一个 textarea。
保存前要显示“该角色将获得哪些菜单和按钮权限”的摘要。
停用角色前要提示当前绑定用户数量。
super_admin 角色默认不可删除。
```

### 19.5 权限管理

权限管理要细到菜单、页面、按钮，不是只有“查看/编辑”两个开关。

#### 19.5.1 权限项分类

```text
菜单权限：orders.view、work_orders.view、costing.view、stats.view、system.view
页面操作权限：orders.edit、orders.delete、orders.rollback、orders.complete
开单权限：work_orders.create、work_orders.preview_pdf、work_orders.export_excel、work_orders.email
成本权限：costing.calculate、costing.view_profit、costing.export
统计权限：stats.export、stats.view_profit
系统权限：users.manage、roles.manage、permissions.manage、menus.manage、system.package
```

#### 19.5.2 权限列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| permission_key | 权限标识 | text | 唯一 key |
| permission_name | 权限名称 | text | 中文显示 |
| permission_type | 类型 | tag | menu / page / button / api |
| module_name | 所属模块 | text | 订单、开单、成本、统计、系统 |
| parent_key | 上级权限 | text | 树结构父节点 |
| sort_order | 排序 | number | 前端展示顺序 |
| status | 状态 | tag | 启用 / 停用 |
| remark | 备注 | text | 说明 |

权限管理行为要求：

```text
前端以树形结构展示权限。
支持按模块筛选权限项。
支持展开/收起全部节点。
支持查看“哪些角色引用了该权限”。
如果旧系统权限是固定代码表，前端不要假装支持随意新增权限后端逻辑，只做展示和勾选绑定。
```

### 19.6 菜单管理

菜单管理负责控制左侧导航和首页入口，不是仅供展示。

#### 19.6.1 菜单列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| menu_key | 菜单 key | text | 唯一标识 |
| menu_name | 菜单名称 | text | 左侧显示 |
| parent_menu_key | 上级菜单 | text | 树形结构 |
| route_path | 路由路径 | text | 前端页面路径 |
| icon_name | 图标 | text | 可选 |
| sort_order | 排序 | number | 控制菜单顺序 |
| visible | 是否显示 | switch | 显示 / 隐藏 |
| enabled | 是否启用 | switch | 启用 / 停用 |
| permission_key | 绑定权限 | text | 访问该菜单所需权限 |
| remark | 备注 | text | 说明 |

菜单管理行为要求：

```text
菜单管理可以调整排序，但不要影响已有后端权限 key。
系统打包、统计分析、成本核算等菜单必须能按权限隐藏。
如果用户没有菜单权限，不应在首页快捷入口显示对应卡片。
支持查看菜单预览树。
```

### 19.7 系统配置

系统配置用于承载非业务数据但影响前端展示和操作的配置。

#### 19.7.1 系统配置分类

```text
基础配置
订单配置
开单配置
成本配置
邮件配置
打印导出配置
UI 配置
```

#### 19.7.2 系统配置字段示例

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| company_name | 公司名称 | input | 页头、PDF 抬头 |
| company_short_name | 公司简称 | input | 页面简写 |
| default_order_compact | 默认紧凑模式 | switch | 订单页默认是否紧凑 |
| default_filter_open | 默认筛选展开 | switch | 列表页默认状态 |
| overdue_warning_days | 逾期预警天数 | number | 超过多少天标红 |
| default_profit_rate | 默认利润率 | number | 成本核算默认值 |
| default_tax_rate | 默认税率 | number | 成本核算默认值 |
| email_sender_name | 发件人名称 | input | 邮件发送默认名 |
| pdf_header_text | PDF 页眉文案 | input | 导出模板使用 |
| excel_template_name | Excel 模板名称 | input | 导出模板使用 |
| maintenance_notice | 系统公告 | textarea | 首页公告或顶部横幅 |

系统配置行为要求：

```text
配置项必须按分类分组显示。
编辑后应提示哪些页面会受到影响。
如果旧系统配置来自本地 JSON 或数据库配置表，前端只使用现有接口，不新造配置中心。
关键配置改动要有保存确认。
```

### 19.8 数据字典与基础资料

数据字典用于维护系统中大量枚举值和下拉项。

建议包含：

```text
袋型字典
材料字典
工序状态字典
机台/来源字典
油墨要求字典
装箱类型字典
邮件模板字典
```

#### 19.8.1 数据字典列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| dict_type | 字典类型 | text | 如 bag_type、material_type |
| dict_code | 字典编码 | text | 唯一编码 |
| dict_label | 字典名称 | text | 用户可见 |
| dict_value | 字典值 | text | 实际存储值 |
| sort_order | 排序 | number | 下拉顺序 |
| status | 状态 | switch / tag | 启用 / 停用 |
| color_tag | 标签颜色 | text | 可选，用于状态标签 |
| remark | 备注 | text | 说明 |

行为要求：

```text
材料字典如来自现有材料文件或配置，不要擅自改数据结构。
字典项支持按类型筛选。
字典停用后，不应影响旧数据展示，旧订单仍要显示原值。
```

### 19.9 操作日志

系统管理必须提供操作日志查看入口，方便追踪改动。

#### 19.9.1 日志列表字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| log_id | 日志ID | text | 主键 |
| operator_name | 操作人 | text | 谁操作的 |
| module_name | 模块 | text | 订单 / 开单 / 成本 / 系统 |
| action_type | 操作类型 | tag | CREATE / UPDATE / DELETE / COMPLETE / ROLLBACK / LOGIN |
| target_type | 对象类型 | text | 订单 / 用户 / 角色 / 配置 |
| target_id | 对象ID | text | 目标主键 |
| action_summary | 操作摘要 | text | 例如“修改订单规格” |
| action_detail | 操作详情 | text / json | 可折叠显示 |
| created_at | 操作时间 | datetime | 时间 |
| operator_ip | 操作 IP | text | 可选 |

日志筛选字段：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| log_keyword | 关键词 | input | 搜对象ID/摘要 |
| log_module_filter | 模块 | select | 按模块筛选 |
| log_action_filter | 操作类型 | select | 按动作筛选 |
| log_user_filter | 操作人 | select | 按人筛选 |
| log_date_range | 时间范围 | daterange | 时间过滤 |

行为要求：

```text
日志列表默认按时间倒序。
重要日志详情支持展开查看字段变更前后对比。
无导出权限时隐藏日志导出按钮。
订单 COMPLETE 和 ROLLBACK 日志必须在这里能查到。
```

### 19.10 系统打包与发布入口

这里的“系统打包”不是让 AI Studio 自己实现真实 CI/CD，而是要把前端上的打包/导出入口和说明整理清楚，方便管理员使用。

前端可设计成一个“系统打包”说明页或工具页，至少包含以下区块：

```text
当前系统版本信息
最近打包记录
前端导出包说明
AI Studio 导入包说明
静态资源检查结果
环境配置提醒
发布注意事项
```

#### 19.10.1 系统打包页字段

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| current_version | 当前版本 | readonly | 如 v1.0.0 |
| last_build_at | 最近打包时间 | readonly | 最近一次打包时间 |
| last_build_by | 最近打包人 | readonly | 谁执行的 |
| export_package_name | 导出包名称 | readonly | 如 ai-studio-frontend-rebuild.zip |
| export_package_scope | 打包范围 | readonly | docs / mocks / legacy refs |
| build_note | 打包说明 | textarea / readonly | 本包用途说明 |
| env_notice | 环境提醒 | readonly | 如“仅前端重构用途，不含数据库” |
| release_checklist | 发布检查清单 | checklist / readonly | 上线前注意事项 |

#### 19.10.2 系统打包页行为要求

```text
不要假装前端可以直接一键发布线上。
可以提供“下载当前导出包”“查看导出内容”“复制 AI Studio 任务说明”等辅助功能。
明确提示：不包含数据库、不包含 node_modules、不包含 .git、不包含线上业务数据。
明确提示：此包仅用于前端重构、联调和交付说明。
```

推荐页面文案：

```text
此导出包仅用于 AI Studio 前端重构，不包含数据库、线上配置、真实业务数据和 Git 历史。
上传前请确认权限说明、接口文档、Mock 数据和旧版页面参考文件均已更新。
```

### 19.11 导入导出与备份说明

这一块主要是给管理员看边界，不是让前端实现数据库备份。

建议说明项：

```text
导出文档包
导出 Mock 数据包
导出 PDF / Excel 模板
系统配置导出
日志导出
备份边界说明
```

边界要求：

```text
不提供真实数据库导出按钮。
不提供迁移真实业务数据的入口。
如果需要“备份”概念，只能做说明文案或导出配置/文档，不要误导成数据库备份。
```

### 19.12 系统管理模块权限要求

权限建议：

```text
super_admin：可见全部系统管理菜单，含角色、权限、菜单、配置、打包。
manager：可看用户、日志、部分配置；是否可改角色按现有系统权限控制。
sales：通常不可进入系统管理，最多可看个人资料。
operator：不可看系统管理。
finance：可看部分配置和导出，不一定可改权限。
```

前端必须支持：

```text
无系统管理权限时，左侧菜单不显示“系统管理”。
有系统管理菜单但无某子模块权限时，只显示有权限的子菜单。
没有 `system.package` 权限时，不显示“系统打包”页签。
没有 `permissions.manage` 权限时，角色页只读，不显示权限树编辑。
```

### 19.13 系统管理模块 Mock 数据口径要求

Mock 至少需要覆盖：

```text
用户列表 10 条。
角色列表 5 条。
权限树 1 份，至少覆盖订单、开单、成本、统计、系统五大模块。
菜单树 1 份。
系统配置对象 1 份。
数据字典至少 3 类，每类 5 条。
操作日志 20 条，包含 LOGIN、UPDATE、COMPLETE、ROLLBACK。
打包记录 3 条。
```

建议的 Mock 结构：

| 字段编码 | 显示名称 | 类型 | 说明 |
| --- | --- | --- | --- |
| users | 用户列表 | array | 用户管理页 |
| roles | 角色列表 | array | 角色管理页 |
| permissionTree | 权限树 | array | 树形结构 |
| menuTree | 菜单树 | array | 树形结构 |
| systemConfig | 系统配置 | object | 配置页 |
| dictionaries | 数据字典 | object | 按字典类型分组 |
| operationLogs | 操作日志 | array | 日志页 |
| buildRecords | 打包记录 | array | 系统打包页 |

### 19.14 给 AI Studio 的最终实现要求

系统管理完成后必须满足：

```text
不是只有一个账号表，而是完整系统管理模块。
有用户、角色、权限、菜单、配置、日志、打包说明几个子页。
权限控制要和订单、开单、成本、统计模块联动。
系统打包页要明确边界，只做导出说明和文件包信息展示，不伪造上线发布能力。
数据字典和系统配置要能支持现有页面下拉项和默认值。
操作日志要能覆盖订单 COMPLETE/ROLLBACK 和系统配置变更。
Mock 数据完整，足够支撑整套系统管理页面展示。
```
