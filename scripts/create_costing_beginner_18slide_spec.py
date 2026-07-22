#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DECK_DIR = ROOT / "docs" / "costing" / "costing-beginner-18slides"


STYLE = {
    "name": "清爽专业讲义风",
    "visual_direction": (
        "16:9 full-slide training handout. Dense but readable Chinese business training deck. "
        "Use light warm white background, deep navy titles, dark teal accents, muted amber warning tags, "
        "thin grid lines, compact tables, formula boxes, and practical checklist cards."
    ),
    "color_palette": "warm white #F8F6EF, navy #17324D, teal #146C64, amber #D98E27, graphite #263238, light gray #E6E1D7",
    "typography": "Chinese text must be crisp and readable; use bold title hierarchy, compact body, table-friendly sans-serif style.",
    "texture_and_finish": "clean printed handout, subtle paper texture, no decorative clutter",
    "density": "high-density lecture notes; each slide should contain tables, formulas, or examples, not just sparse bullets",
}


DECK_CONTEXT = {
    "source_summary": "食品包装软包装袋成本核算新人训练。受众是数学基础较弱的新业务，需要按袋型、材料、费用参数和历史订单学会基础报价。",
    "core_claim": "先认袋型和资料边界，再找历史单，最后代入材料费、加工费、损耗、附件、运费和利润。",
    "canonical_terms": [
        "三边封",
        "自立袋",
        "八边封/平底袋",
        "异形袋",
        "卷膜",
        "加工费",
        "损耗",
        "利润",
        "拉链费",
        "版费",
    ],
}


SLIDES = [
    {
        "number": 1,
        "title": "新人核价总流程",
        "role": "process",
        "intent": "给新人建立从客户信息到报价的完整路径。",
        "key_points": [
            "8 步：认产品 → 补资料 → 找历史 → 选费用 → 算成本 → 加利润 → 复核 → 输出报价",
            "不要先背公式，先判断袋型、材料、数量、附件和物流边界",
            "遇到特殊材料、特殊工艺、外贸清关或大金额订单，必须先复核",
        ],
        "layout": {
            "composition": "horizontal 8-step flow with compact warning box on the right",
            "content_zones": "top title, middle flowchart, bottom quick rule strip",
        },
        "visual_elements": {
            "main_visual": "8 connected process cards with arrows",
            "supporting_elements": "small checklist tags: 袋型 / 材料 / 费用 / 复核",
        },
    },
    {
        "number": 2,
        "title": "客户资料怎么问：缺什么不能报",
        "role": "comparison",
        "intent": "区分内销和外贸资料要求。",
        "key_points": [
            "内销最小信息：袋型、尺寸、数量、材料厚度、印刷、附件、送货地点",
            "外贸额外信息：贸易条款、起运港、目的港/地址、清关责任、箱数毛重体积",
            "缺厚度只能预估；缺材料或数量不能正式报价；DDP 必须确认清关资料",
        ],
        "layout": {
            "composition": "two-column table: 内销 / 外贸, with red/yellow cannot-quote row",
            "content_zones": "title top, large comparison table, bottom asking script",
        },
        "visual_elements": {"main_visual": "dense table plus '不能正式报价' warning ribbon"},
    },
    {
        "number": 3,
        "title": "单位换算和材料成本",
        "role": "concept",
        "intent": "解释最容易错的单位口径。",
        "key_points": [
            "客户常说微米，内部常用 C：厚度C = 微米 ÷ 10，例如 90μm = 9C",
            "材料价格优先按元/kg；看到 8200元/吨 要换成 8.2元/kg",
            "单层重量 = 厚度C × 比重 × 展开面积 ÷ 1000000；材料费 = 重量 × 单价",
        ],
        "layout": {
            "composition": "left formula board, right common unit conversion cards",
            "content_zones": "formula zone, worked conversion examples, error warning",
        },
        "visual_elements": {"main_visual": "formula boxes and unit conversion ladder"},
    },
    {
        "number": 4,
        "title": "常见材料和结构判断",
        "role": "data evidence",
        "intent": "让新人知道材料不是符号，要能判断用途和风险。",
        "key_points": [
            "PET/BOPP/MOPP 多用于外层和印刷；PE/CPP/CPE 多用于热封层",
            "VMPET/VMCPP 是镀铝膜，主要避光防潮；AL 铝箔是高阻隔，必须谨慎",
            "NY 用于耐穿刺、冷冻、液体；纸要问 gsm，不能只问厚度",
        ],
        "layout": {
            "composition": "material matrix table plus structure-risk ladder",
            "content_zones": "upper material table, lower structure examples",
        },
        "visual_elements": {"main_visual": "compact matrix: material / role / risk / ask father"},
    },
    {
        "number": 5,
        "title": "三边封怎么算",
        "role": "concept explanation",
        "intent": "说明最基础袋型的展开面积和费用档。",
        "key_points": [
            "展开长 = 高×2 + 1.5；展开宽 = 宽；展开面积 = 展开长×展开宽",
            "加工费：小尺寸简单结构看 0.28/0.36；大尺寸看 0.45；复杂多层看 0.65",
            "例：30×20，NY1.5/CPP8.5，加工费0.28，历史报价约0.265元/个",
        ],
        "layout": {"composition": "formula left, fee ladder middle, mini worked example right"},
        "visual_elements": {"main_visual": "flat pouch outline with dimension arrows and calculation card"},
    },
    {
        "number": 6,
        "title": "自立袋怎么算",
        "role": "concept explanation",
        "intent": "强调底部风琴对面积和加工费的影响。",
        "key_points": [
            "展开长 = 高×2 + 1.5 + 底；比三边封多底部成型风险",
            "普通自立袋加工费常看0.62/0.65；底大、厚料、VMPET、要求高看0.8/0.81",
            "拉链常见0.1/0.2；无拉链必须改为0或确认，不要默认有拉链",
        ],
        "layout": {"composition": "stand-up pouch diagram + three parameter cards + example strip"},
        "visual_elements": {"main_visual": "pouch with bottom gusset, fee decision cards"},
    },
    {
        "number": 7,
        "title": "八边封 / 平底袋怎么算",
        "role": "architecture",
        "intent": "拆解前片和侧片，防止按自立袋错算。",
        "key_points": [
            "前片面积 = (高×2+4+底) × (宽+0.6)",
            "侧片面积 = 高 × (底×2+1.2)；总面积 = 前片 + 侧片",
            "拉链常见0.35/0.45/0.52；八边封不能照搬自立袋拉链费",
        ],
        "layout": {"composition": "split diagram: front panel and side panel, with formula callouts"},
        "visual_elements": {"main_visual": "flat-bottom pouch exploded into front and side panels"},
    },
    {
        "number": 8,
        "title": "异形袋、背封、四边封怎么算",
        "role": "comparison",
        "intent": "把三种特殊袋型压缩成判断表。",
        "key_points": [
            "异形袋先问有底/没底，很多用拉链总费用，不要套普通自立袋",
            "背封：展开长更接近 宽×2+3.5；不要拿三边封公式硬套",
            "四边封：有侧边时面积显著增大，大尺寸多层结构加工费常0.65起",
        ],
        "layout": {"composition": "three-column comparison table with small formula boxes"},
        "visual_elements": {"main_visual": "three bag icons: irregular, back seal, four-side seal"},
    },
    {
        "number": 9,
        "title": "卷膜怎么算",
        "role": "concept",
        "intent": "讲清卷膜按吨、平方米、卷，不按个数。",
        "key_points": [
            "折合厚度 = Σ(厚度C×比重) ÷ 10；每吨平方数 = 10000 ÷ 折合厚度",
            "报价按元/吨，也可换算每卷价格：每卷面积 = 宽m × 长m",
            "普通卷膜加工费0.42/0.45；窄卷、厚料、要求高可看0.6/0.63；损耗常2%",
        ],
        "layout": {"composition": "calculation pipeline: thickness → sqm/ton → RMB/ton → RMB/roll"},
        "visual_elements": {"main_visual": "roll film icon, formula chain, fee cards"},
    },
    {
        "number": 10,
        "title": "加工费怎么选",
        "role": "data table",
        "intent": "做总表，帮助新人快速选费用档。",
        "key_points": [
            "袋型越复杂、尺寸越大、层数越多、材料越特殊，加工费越不能取低档",
            "三边封：0.28/0.36/0.45/0.65；自立袋：0.62/0.65/0.8/0.81",
            "八边封：0.6/0.64/0.76/0.81；卷膜：0.42/0.45/0.6/0.63",
        ],
        "layout": {"composition": "large decision matrix table with risk arrows"},
        "visual_elements": {"main_visual": "fee ladder by bag type"},
    },
    {
        "number": 11,
        "title": "损耗和利润怎么选",
        "role": "comparison",
        "intent": "让新人知道10%和2%不是机械默认。",
        "key_points": [
            "普通成品袋常见损耗10%；卷膜常见2%；小单、多款、异形、复杂印刷要上浮",
            "利润看客户、数量、风险和市场：历史出现过12%、15%、22%、24%",
            "外贸、材料不确定、特殊工艺、售后风险高时，利润要更保守",
        ],
        "layout": {"composition": "left loss rules, right profit rules, bottom warning strip"},
        "visual_elements": {"main_visual": "two compact tables with risk heat tags"},
    },
    {
        "number": 12,
        "title": "拉链、附件、印刷怎么处理",
        "role": "warning",
        "intent": "避免新人给附件和印刷乱编单价。",
        "key_points": [
            "明确单独算的主要是拉链单价、拉链总费用、卷膜分切、运费",
            "普通易撕口/圆角/挂孔多放在加工费经验里；气阀、吸嘴、激光易撕线必须单独确认",
            "多色、满版、浅色、专色、白墨、哑油，会影响加工费、损耗、利润或版费",
        ],
        "layout": {"composition": "do/don't table plus zipper fee mini table"},
        "visual_elements": {"main_visual": "warning dashboard with accessory icons"},
    },
    {
        "number": 13,
        "title": "版费和小单分摊",
        "role": "case study",
        "intent": "用简单数字说明版费另算和摊入单价的差异。",
        "key_points": [
            "版费不要默认混进单价；新版、改稿、多款设计都要单独问",
            "例：版费600元，10000个摊入=0.06元/个；3000个摊入=0.20元/个",
            "小单如果摊版费，单价会明显变高；报价时必须说清楚是否另算",
        ],
        "layout": {"composition": "large arithmetic example with two quantity scenarios"},
        "visual_elements": {"main_visual": "calculator-style comparison cards"},
    },
    {
        "number": 14,
        "title": "历史订单做题：三边封",
        "role": "case study",
        "intent": "完整代入一个简单袋型题。",
        "key_points": [
            "题目：三边封30×20，NY1.5/CPP8.5，加工费0.28，损耗10%，利润22%",
            "面积：展开长61.5，展开宽20，面积1230；材料费0.14960448，加工费0.03444",
            "成本=(材料费+加工费)×1.10+拉链+运费=0.217592；报价=0.265463元/个",
        ],
        "layout": {"composition": "worked problem page: known data, steps, final answer"},
        "visual_elements": {"main_visual": "math worksheet with highlighted final quote"},
    },
    {
        "number": 15,
        "title": "历史订单做题：八边封",
        "role": "case study",
        "intent": "完整代入一个复杂袋型题。",
        "key_points": [
            "题目：八边封24.5×16.5+8+8，PET2.5/CPE8.5，加工费0.64，拉链0.52",
            "前片面积1043.1，侧片面积421.4；加工费=0.64×(1043.1+421.4)÷10000=0.093728",
            "材料费0.16446042，拉链0.08892，运费0.010096；最终报价约0.467289元/个",
        ],
        "layout": {"composition": "two-panel calculation: front/side split and cost stack"},
        "visual_elements": {"main_visual": "exploded flat-bottom pouch with cost stack bar"},
    },
    {
        "number": 16,
        "title": "完整报价流程模板",
        "role": "process",
        "intent": "把客户消息转为可报价动作。",
        "key_points": [
            "拆字段：袋型、尺寸、材料厚度、数量、印刷、附件、用途、交付边界",
            "选模板：三边封/自立袋/八边封/异形袋/卷膜/背封/四边封",
            "复核：重量是否合理、历史是否接近、费用是否漏算、版费和运费是否说清楚",
        ],
        "layout": {"composition": "workflow checklist plus quote output template"},
        "visual_elements": {"main_visual": "from message bubble to quote sheet pipeline"},
    },
    {
        "number": 17,
        "title": "哪些必须问爸爸确认",
        "role": "warning",
        "intent": "建立升级边界，防止新人硬报。",
        "key_points": [
            "材料：AL、纸铝塑、NY厚料、易撕PE、食品级/认证/高阻隔/蒸煮/冷冻/液体",
            "工艺：气阀、吸嘴、激光易撕线、复杂异形、特殊窗口、特殊手提孔",
            "商务：大金额订单、目标价接近成本、DDP/双清包税、特殊目的国清关",
        ],
        "layout": {"composition": "risk checklist wall with three categories: 材料/工艺/商务"},
        "visual_elements": {"main_visual": "red-amber-green escalation board"},
    },
    {
        "number": 18,
        "title": "新人速查卡",
        "role": "summary",
        "intent": "最后一页给新人背诵和日常检查。",
        "key_points": [
            "先认袋型，再选加工费；先看历史单，再代入计算；先确认资料，再报正式价",
            "速查：袋类损耗常10%，卷膜常2%；拉链按袋型选，版费通常另算",
            "常见错：微米/C、cm/mm、元/吨/元/kg、八边封按自立袋、卷膜按个数、忘记拉链版费",
        ],
        "layout": {"composition": "dense one-page cheat sheet with three blocks and final rule"},
        "visual_elements": {"main_visual": "laminated cheat-card style page"},
    },
]


def slide_constraints() -> list[str]:
    return [
        "必须使用简体中文，文字要准确、清晰、可读，不能乱码。",
        "讲义型 PPT，每页内容要满，但不要拥挤到不可读。",
        "优先使用表格、公式框、流程卡、风险标签。",
        "不要添加无关 logo、水印或页码。",
        "所有数字、公式和袋型名称必须按提示准确呈现。",
    ]


def write_outline() -> None:
    lines = ["# 新手成本核算训练讲义：18页PPT大纲", ""]
    for slide in SLIDES:
        lines.append(f"## Slide {slide['number']}: {slide['title']}")
        lines.append("")
        lines.append("- 角色：" + slide["role"])
        lines.append("- 目的：" + slide["intent"])
        lines.append("- 重点：")
        for point in slide["key_points"]:
            lines.append(f"  - {point}")
        lines.append("- 版式：" + slide["layout"]["composition"])
        lines.append("")
    (DECK_DIR / "outline.md").write_text("\n".join(lines), encoding="utf-8")


def write_spec() -> None:
    deck = {
        "deck_name": "costing-beginner-18slides",
        "language": "Chinese",
        "goal": "让新人按袋型、材料、历史订单和费用参数完成基础成本核算与报价。",
        "style": STYLE,
        "deck_context": DECK_CONTEXT,
        "sample_generation_method": {
            "backend_used": "codex-ppt CLI/API fallback",
            "tool_name": "scripts/image_gen.py",
            "mode": "generate",
            "prompt_source": "prompts/slide_XX.json",
            "size": "2560x1440",
            "quality": "medium",
            "model": "gpt-image-2",
            "approved_sample_path": "",
            "input_context_preparation": "text-only slide prompts from deck_spec.json; no required input images",
            "handoff_rule": "Use the same CLI/API fallback generation path for every slide.",
        },
        "slides": [],
    }
    for slide in SLIDES:
        deck["slides"].append(
            {
                **slide,
                "speaker_focus": "按讲义方式解释，不要只念文字；强调判断边界和新人易错点。",
                "constraints": slide_constraints(),
            }
        )
    (DECK_DIR / "deck_spec.json").write_text(json.dumps(deck, ensure_ascii=False, indent=2), encoding="utf-8")


def write_speech() -> None:
    chunks = []
    for slide in SLIDES:
        n = slide["number"]
        chunks.append(f"## Slide {n}: {slide['title']}\n")
        chunks.append(
            "这一页讲清楚本页的判断方法。培训时先让新人看标题，再按表格或公式从左到右走一遍，"
            "最后强调不要机械套数，要结合袋型、材料、数量和历史单复核。\n"
        )
        chunks.append("---\n")
        chunks.append("注意点：\n")
        chunks.append(f"- 重点：{slide['intent']}\n")
        chunks.append("- 画面引导：先看标题，再看主表格/公式，最后看底部警示或结论。\n")
        chunks.append("- 节奏：遇到公式页要慢下来，要求新人跟着代入一遍。\n")
        chunks.append("\n")
    (DECK_DIR / "speech.md").write_text("".join(chunks), encoding="utf-8")


def main() -> None:
    (DECK_DIR / "origin_image").mkdir(parents=True, exist_ok=True)
    (DECK_DIR / "prompts").mkdir(parents=True, exist_ok=True)
    write_outline()
    write_spec()
    write_speech()
    print(DECK_DIR)


if __name__ == "__main__":
    main()
