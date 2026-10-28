#!/usr/bin/env python3
"""
PTT 3D SMART BOARD - GitHub Actions Automated Shift Alert
Runs in GitHub Actions cloud on schedule (08:00 and 20:00 Bangkok time / 01:00 and 13:00 UTC)
or on manual workflow_dispatch.
Sends scheduled shift notification directly to Microsoft Teams webhook.
"""

import json
import os
import ssl
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "notify_config.json")
STATE_FILE = os.path.join(BASE_DIR, "latest_state.json")

DEFAULT_WEBHOOK = (
    "https://defaultf2fda5e72ea1450d9fc12af5f86300.95.environment.api.powerplatform.com/"
    "powerautomate/automations/direct/cu/18/workflows/904ec45ba2f343b0bf609507bba19298/"
    "triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=P7wxp36yBmVsRRsQL6hEIYzC7BoO9r8IUQrmM8_9Xfc"
)


def load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Warn] Could not read {CONFIG_FILE}: {e}")
    return {}


def load_state() -> dict:
    state = {
        "inventoryPct": 66.32,
        "inventoryTon": 13264,
        "inventoryCap": 20000,
        "demandPct": 70,
        "demandTon": 14000,
        "productPrice": 300,
        "energyPrice": 2650,
        "gspData": {
            "propanePct": 66.32,
            "lpgPct": 45.81,
            "nglPct": 60.60,
            "propanePlusLpgPct": 50.28,
            "plant": "Tank Farm",
            "meetingDate": "28/10/2026",
            "targetField": "inventory",
            "sourceMetric": "propanePct",
            "lastSync": "28/10/2026 08:30",
            "syncMethod": "ready"
        }
    }
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                state.update(saved)
        except Exception as e:
            print(f"[Warn] Could not read {STATE_FILE}: {e}")
    return state


def calculate_modes(inv_pct: float, demand_pct: float = 70.0):
    # Standard PTT Flowchart Logic:
    # Inventory > 70% -> C3 Max Mode
    # Inventory between 60% and 70% -> Optimize Mode
    # Inventory < 60% -> LPG Mode
    if inv_pct > 70.0:
        c3_max = "YES (★ เลือกโหมดนี้)"
        optimize = "NO"
        lpg_mode = "NO"
        rec_mode = "C3 Max (1. C3 Max Mode)"
        condition_text = f"Inventory {inv_pct:.2f}% > 70%"
    elif inv_pct >= 60.0:
        c3_max = "NO"
        optimize = "YES (★ เลือกโหมดนี้)"
        lpg_mode = "NO"
        rec_mode = "Optimization (2. Optimize Mode)"
        condition_text = f"Inventory {inv_pct:.2f}% อยู่ระหว่าง 60% - 70%"
    else:
        c3_max = "NO"
        optimize = "NO"
        lpg_mode = "YES (★ เลือกโหมดนี้)"
        rec_mode = "LPG Mode (3. LPG Mode)"
        condition_text = f"Inventory {inv_pct:.2f}% < 60%"

    return {
        "c3_max": c3_max,
        "optimize": optimize,
        "lpg_mode": lpg_mode,
        "rec_mode": rec_mode,
        "condition_text": condition_text,
    }


def send_alert():
    # Calculate Thai Time (UTC+7)
    thai_tz = timezone(timedelta(hours=7))
    now_thai = datetime.now(thai_tz)
    thai_months = [
        "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
        "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
    ]
    month_name = thai_months[now_thai.month - 1]
    date_thai = f"วันที่ {now_thai.day} {month_name} {now_thai.year} {now_thai.strftime('%H:%M')} น."
    full_timestamp = now_thai.strftime("%d/%m/%Y %H:%M:%S")

    config = load_config()
    webhook_url = os.environ.get("TEAMS_WEBHOOK_URL") or config.get("webhookUrl") or DEFAULT_WEBHOOK
    state = load_state()

    # Check day of week (Thai time: Mon=0, ..., Sun=6)
    day_abbr_list = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    current_day = day_abbr_list[now_thai.weekday()]
    allowed_days = config.get("scheduleDays") or state.get("scheduleDays") or day_abbr_list
    if allowed_days and current_day not in allowed_days:
        print(f"ℹ️ Today is {current_day}, not in configured scheduleDays {allowed_days}. Skipping alert.")
        return True

    # Duplicate check: If already sent today within the last 45 minutes (e.g. by local Mac daemon), skip sending
    last_sent = config.get("lastSent", "")
    if last_sent:
        try:
            last_dt = datetime.strptime(last_sent, "%d/%m/%Y %H:%M:%S")
            diff_sec = abs((now_thai.replace(tzinfo=None) - last_dt).total_seconds())
            if diff_sec < 45 * 60:
                print(f"ℹ️ Shift notification was already sent recently ({last_sent}, {int(diff_sec/60)} mins ago). Skipping duplicate send.")
                return True
        except Exception:
            pass

    inv_pct = float(state.get("inventoryPct", 68.17))
    cap_ton = float(state.get("inventoryCap", 20000))
    inv_ton = round(inv_pct / 100 * cap_ton)
    demand_pct = float(state.get("demandPct", 70))
    demand_ton = round(demand_pct / 100 * cap_ton)
    product_price = state.get("productPrice", 300)
    energy_price = state.get("energyPrice", 2650)
    gsp = state.get("gspData", {})

    modes = calculate_modes(inv_pct, demand_pct)
    reason = "GitHub Actions Cloud Automation (รอบกะการผลิต 08:00 / 20:00)"

    summary_text = (
        f"📢 [PTT 3D SMART BOARD] โหมดที่แนะนำ: {modes['rec_mode']}\n"
        f"• 1. C3 Max Mode: {modes['c3_max']}\n"
        f"• 2. Optimize Mode: {modes['optimize']}\n"
        f"• 3. LPG Mode: {modes['lpg_mode']}\n"
        f"👉 โหมดที่ระบบเลือก: ⭐ {modes['rec_mode']} ({modes['condition_text']})\n"
        f"📦 Inventory: {inv_pct:.2f}% ({inv_ton:,} / {int(cap_ton):,} Ton)\n"
        f"🌐 GSP Propane: {gsp.get('propanePct', inv_pct)}% | LPG: {gsp.get('lpgPct', 36.19)}% | NGL: {gsp.get('nglPct', 62.39)}%"
    )

    markdown_body = (
        f"## 📢 รายงาน 3D SMART BOARD (PTT - GitHub Cloud Auto-Run)\n"
        f"**🎯 โหมดการผลิตที่แนะนำ:** **{modes['rec_mode']}**\n"
        f"**📅 วันที่-เวลา:** {date_thai} ({full_timestamp}) | **ประเภทการส่ง:** {reason}\n\n"
        f"---\n"
        f"### 📊 ข้อมูล 4 ปัจจัยหลัก:\n"
        f"- 📦 **ระดับสินค้าคงคลัง (Inventory):** **{inv_pct:.2f}%** ({inv_ton:,} / {int(cap_ton):,} Ton)\n"
        f"- 🛢️ **ความต้องการใช้ถัง (Tank Farm Demand):** **{demand_pct}%** ({demand_ton:,} / {int(cap_ton):,} Ton)\n"
        f"- 💰 **ราคาผลิตภัณฑ์ (Product Price):** **{product_price} USD/Ton** (+5%)\n"
        f"- 🔥 **ต้นทุนพลังงาน (Energy Price):** **{energy_price} MMBtu/Ton** (+8%)\n\n"
        f"### 🌐 ข้อมูลจริงจาก GSP Daily Report (Tank Farm):\n"
        f"- **Propane:** {gsp.get('propanePct', inv_pct)}%\n"
        f"- **LPG:** {gsp.get('lpgPct', 36.19)}%\n"
        f"- **NGL:** {gsp.get('nglPct', 62.39)}%\n"
        f"- **Propane + LPG =** {gsp.get('propanePlusLpgPct', 43.17)}%\n\n"
        f"### ⚙️ การเลือกโหมดการผลิต (3 Production Modes):\n"
        f"- **1. C3 Max Mode:** {modes['c3_max']}\n"
        f"- **2. Optimize Mode:** {modes['optimize']}\n"
        f"- **3. LPG Mode:** {modes['lpg_mode']}\n"
        f"👉 **โหมดที่ระบบเลือก:** ⭐ **{modes['rec_mode']}** ({modes['condition_text']})\n\n"
        f"### 📈 ผลลัพธ์คาดการณ์ (Expected Result):\n"
        f"- กำไรโดยประมาณ: **สูงสุด**\n"
        f"- การใช้พลังงาน: **เหมาะสม**\n"
        f"- การใช้พื้นที่จัดเก็บ: **สมดุล**\n"
        f"- ความยืดหยุ่นในการขาย: **ดี**\n\n"
        f"🔗 เข้าชมหน้าแดชบอร์ดสด: https://bilanphoto.github.io/inventory/"
    )

    adaptive_card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.2",
        "body": [
            {
                "type": "Container",
                "style": "emphasis",
                "items": [
                    {
                        "type": "TextBlock",
                        "text": "📢 PTT 3D SMART BOARD (GitHub Cloud)",
                        "weight": "Bolder",
                        "size": "Medium",
                        "color": "Accent"
                    },
                    {
                        "type": "TextBlock",
                        "text": f"🎯 โหมดการผลิตที่แนะนำ: {modes['rec_mode']}",
                        "weight": "Bolder",
                        "size": "Large",
                        "wrap": True
                    },
                    {
                        "type": "TextBlock",
                        "text": f"📅 {date_thai} | ประเภท: {reason}",
                        "isSubtle": True,
                        "size": "Small",
                        "spacing": "None"
                    }
                ]
            },
            {
                "type": "TextBlock",
                "text": "📊 **ข้อมูล 4 ปัจจัยหลัก**",
                "weight": "Bolder",
                "size": "Medium",
                "spacing": "Medium"
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "📦 Inventory:", "value": f"{inv_pct:.2f}% ({inv_ton:,} / {int(cap_ton):,} Ton)"},
                    {"title": "🛢️ Demand:", "value": f"{demand_pct}% ({demand_ton:,} / {int(cap_ton):,} Ton)"},
                    {"title": "💰 Product Price:", "value": f"{product_price} USD/Ton (+5%)"},
                    {"title": "🔥 Energy Price:", "value": f"{energy_price} MMBtu/Ton (+8%)"}
                ]
            },
            {
                "type": "TextBlock",
                "text": "🌐 **ข้อมูลจริง GSP Daily Report (Tank Farm)**",
                "weight": "Bolder",
                "size": "Medium",
                "spacing": "Medium"
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "Propane:", "value": f"{gsp.get('propanePct', inv_pct)}%"},
                    {"title": "LPG:", "value": f"{gsp.get('lpgPct', 36.19)}%"},
                    {"title": "NGL:", "value": f"{gsp.get('nglPct', 62.39)}%"},
                    {"title": "Propane + LPG:", "value": f"{gsp.get('propanePlusLpgPct', 43.17)}%"}
                ]
            },
            {
                "type": "TextBlock",
                "text": "⚙️ **การเลือกโหมดการผลิต (3 Production Modes)**",
                "weight": "Bolder",
                "size": "Medium",
                "spacing": "Medium"
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "1. C3 Max Mode:", "value": modes["c3_max"]},
                    {"title": "2. Optimize Mode:", "value": modes["optimize"]},
                    {"title": "3. LPG Mode:", "value": modes["lpg_mode"]}
                ]
            },
            {
                "type": "TextBlock",
                "text": f"👉 **โหมดที่เลือก:** ⭐ **{modes['rec_mode']}** ({modes['condition_text']})",
                "weight": "Bolder",
                "wrap": True,
                "spacing": "Small"
            }
        ],
        "actions": [
            {
                "type": "Action.OpenUrl",
                "title": "🌐 เปิดแดชบอร์ด PTT 3D Smart Board",
                "url": "https://bilanphoto.github.io/inventory/"
            }
        ]
    }

    payload = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": None,
                "content": adaptive_card
            }
        ],
        "title": f"📢 PTT 3D SMART BOARD - โหมดที่แนะนำ: {modes['rec_mode']}",
        "summary": summary_text,
        "text": markdown_body,
        "message": markdown_body,
        "content": markdown_body,
        "recommendedMode": modes["rec_mode"],
        "inventoryPct": inv_pct,
        "inventoryTon": inv_ton,
        "demandPct": demand_pct,
        "demandTon": demand_ton,
        "productPrice": product_price,
        "energyPrice": energy_price,
        "gspData": gsp,
        "reason": reason,
        "timestamp": full_timestamp
    }

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    print(f"Sending alert to webhook ({len(data)} bytes)...")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST"
    )

    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            print(f"HTTP Response: {resp.status} {resp.reason}")
            if resp.status in (200, 202):
                print("✅ Successfully sent alert to Microsoft Teams!")
                return True
            else:
                print(f"⚠️ Unexpected status: {resp.status}")
                return False
    except Exception as e:
        print(f"❌ Error sending to MS Teams: {e}")
        return False


if __name__ == "__main__":
    success = send_alert()
    sys.exit(0 if success else 1)
