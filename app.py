#!/usr/bin/env python3
"""
3D SMART BOARD - PTT Production Mode Recommendation Web App
Backend server (Python standard library) + Operation Mode Flowchart Decision Engine
+ GSP Daily Report (https://gspdailyreport.pttplc.com/DailyReport/Index) Live Extractor
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GSP_URL = "https://gspdailyreport.pttplc.com/DailyReport/Index"
DEFAULT_TEAMS_WEBHOOK_URL = (
    "https://defaultf2fda5e72ea1450d9fc12af5f86300.95.environment.api.powerplatform.com/"
    "powerautomate/automations/direct/cu/18/workflows/904ec45ba2f343b0bf609507bba19298/"
    "triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=P7wxp36yBmVsRRsQL6hEIYzC7BoO9r8IUQrmM8_9Xfc"
)

ACTIVE_SESSIONS = {}  # token -> {"username": str, "expires": float}

def get_auth_config():
    config_path = os.path.join(BASE_DIR, "auth_config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "salt": "ptt_gsp_salt_2026",
        "authHash": "5747b8ca95b6179f51c02e61bc83a75b71ac9cc64062f6642381a646d7ca2d0c",
        "userHash": "a14a9eba57bca5f3e4d7abba45ca2261cc2dce23961b5e7a3f56ed214133222d",
        "sessionTimeoutHours": 24,
    }

def verify_credentials(username: str, password: str) -> bool:
    cfg = get_auth_config()
    salt = cfg.get("salt", "ptt_gsp_salt_2026")
    expected_hash = cfg.get("authHash", "")
    calc_hash = hashlib.sha256(f"{username}:{password}:{salt}".encode("utf-8")).hexdigest()
    return hmac.compare_digest(calc_hash, expected_hash)

THAI_MONTHS_SHORT = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
]

def get_current_thai_datetime():
    now = datetime.now()
    day = now.day
    month = THAI_MONTHS_SHORT[now.month - 1]
    year = now.year
    hh = f"{now.hour:02d}"
    mm = f"{now.minute:02d}"
    return f"วันที่ {day} {month} {year}", f"{hh}:{mm} น."

_init_date, _init_time = get_current_thai_datetime()

# Default Dashboard State matching bg_3dc3.png + GSP Daily Report Tank Farm data + live datetime
CURRENT_STATE = {
    "dateText": _init_date,
    "timeText": _init_time,
    # Card 1: Inventory
    "inventoryPct": 68.17,  # Propane % from GSP Daily Report (Tank Farm)
    "inventoryTon": 13634,
    "inventoryCap": 20000,
    # Card 2: Tank Farm Demand
    "demandPct": 70,
    "demandTon": 14000,
    "demandCap": 20000,
    "remainingTon": 6366,
    "tanksUsed": 7,
    "tanksTotal": 10,
    # Card 3: Product Price
    "productPrice": 300,
    "productPriceChange": "+5%",
    "productHistory": [250, 275, 290, 310, 330, 355, 375],
    # Card 4: Energy Price
    "energyPrice": 2650,
    "energyPriceChange": "+8%",
    "energyHistory": [2200, 2450, 2600, 2750, 2900, 3050, 3200],
    # Flowchart condition: Cross C3 to LPG ?
    "crossC3ToLpg": True,
    # GSP Daily Report Tank Farm Values (from https://gspdailyreport.pttplc.com/DailyReport/Index)
    "gspData": {
        "propanePct": 68.17,
        "lpgPct": 36.19,
        "nglPct": 62.39,
        "propanePlusLpgPct": 43.17,
        "plant": "Tank Farm",
        "meetingDate": "25/10/2026",
        "targetField": "inventory",  # 'inventory' | 'demand' | 'none'
        "sourceMetric": "propanePct",  # 'propanePct' | 'lpgPct' | 'nglPct' | 'propanePlusLpgPct'
        "lastSync": "25/10/2026 09:30",
        "syncMethod": "ready",
    },
    # Production Modes configuration (editable numbers)
    "modes": {
        "c3_max": {
            "id": "c3_max",
            "index": 1,
            "name": "1. C3 Max Mode",
            "c3": 60,
            "c4": 20,
            "lpg": 15,
            "other": 5,
            "suitability": 70,
        },
        "optimize": {
            "id": "optimize",
            "index": 2,
            "name": "2. Optimize Mode",
            "c3": 40,
            "c4": 30,
            "lpg": 25,
            "other": 5,
            "suitability": 85,
        },
        "lpg_mode": {
            "id": "lpg_mode",
            "index": 3,
            "name": "3. LPG Mode",
            "c3": 20,
            "c4": 20,
            "lpg": 55,
            "other": 5,
            "suitability": 45,
        },
    },
    # Expected Result (EST.)
    "expectedResult": {
        "profit": "สูงสุด",
        "energy": "เหมาะสม",
        "storage": "สมดุล",
        "flexibility": "ดี",
    },
    # MS Teams Notification Configuration (Power Automate Webhook)
    "notifyConfig": {
        "webhookUrl": DEFAULT_TEAMS_WEBHOOK_URL,
        "scheduleEnabled": True,
        "scheduleTimes": ["08:00", "20:00"],
        "scheduleTime": "08:00, 20:00",
        "lastSent": None,
        "lastStatus": None,
        "lastError": None,
        "sendLogs": [],
    },
}

NOTIFY_CONFIG_FILE = os.path.join(BASE_DIR, "notify_config.json")

def load_notify_config():
    if os.path.exists(NOTIFY_CONFIG_FILE):
        try:
            with open(NOTIFY_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    CURRENT_STATE.setdefault("notifyConfig", {}).update(saved)
                    print(f"[Notify] Loaded notification config: {CURRENT_STATE['notifyConfig'].get('scheduleTimes')}")
        except Exception as e:
            print(f"[Notify] Error loading notify_config.json: {e}")

def save_notify_config(cfg: dict = None):
    try:
        if cfg is None:
            cfg = CURRENT_STATE.get("notifyConfig", {})
        with open(NOTIFY_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Notify] Error saving notify_config.json: {e}")

load_notify_config()


def parse_gsp_text_or_html(content: str) -> dict:
    """
    Extracts Propane %, LPG %, NGL %, and Propane + LPG % from either visible text or HTML
    of https://gspdailyreport.pttplc.com/DailyReport/Index
    """
    result = {}

    # 1. Look for "Propane + LPG =" followed by percentage
    m_sum = re.search(r"Propane\s*\+\s*LPG\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*%", content, re.IGNORECASE)
    if m_sum:
        result["propanePlusLpgPct"] = float(m_sum.group(1))

    # 2. Look for 3 consecutive percentages after Propane / LPG / NGL headers
    # In the page layout, Propane, LPG, NGL tank gauges appear just before "Propane + LPG ="
    before_sum = content.split("Propane + LPG")[0] if "Propane + LPG" in content else content
    pct_matches = re.findall(r"([0-9]{1,3}\.[0-9]{1,2})\s*%", before_sum)
    if len(pct_matches) >= 3:
        # The last 3 percentages right before "Propane + LPG =" are Propane, LPG, NGL
        p_val, l_val, n_val = pct_matches[-3], pct_matches[-2], pct_matches[-1]
        result["propanePct"] = float(p_val)
        result["lpgPct"] = float(l_val)
        result["nglPct"] = float(n_val)

    # 3. Also look for Daily Meeting Date (dd/mm/yyyy)
    m_date = re.search(r"(\d{2}/\d{2}/\d{4})", content)
    if m_date:
        result["meetingDate"] = m_date.group(1)

    return result


def fetch_gsp_from_chrome_tab() -> dict:
    """
    Uses macOS AppleScript to read the live logged-in DOM of
    https://gspdailyreport.pttplc.com/DailyReport/Index directly from Google Chrome.
    """
    js_code = r"""
    (function() {
      var text = document.body.innerText || '';
      var inputs = Array.from(document.querySelectorAll('input, span, div, label, td'))
        .map(function(el) { return (el.value || el.innerText || '').trim(); })
        .filter(Boolean)
        .join(' | ');
      return JSON.stringify({ text: text, flat: inputs, url: location.href });
    })()
    """
    apple_script = f'''
    tell application "Google Chrome"
      repeat with w in windows
        repeat with t in tabs of w
          if URL of t contains "gspdailyreport.pttplc.com" then
            return execute t javascript {json.dumps(js_code)}
          end if
        end repeat
      end repeat
    end tell
    return "TAB_NOT_FOUND"
    '''
    try:
        proc = subprocess.run(
            ["osascript", "-e", apple_script],
            capture_output=True,
            text=True,
            timeout=12,
        )
        if proc.returncode != 0:
            err = proc.stderr.strip()
            if "Allow JavaScript from Apple Events" in err:
                return {
                    "ok": False,
                    "reason": "APPLE_EVENTS_JS_DISABLED",
                    "message": "ต้องเปิดใช้งาน View > Developer > Allow JavaScript from Apple Events ในเมนูด้านบนของ Google Chrome (ทำครั้งเดียว)",
                }
            if "Not authorized to send Apple events" in err or "(-1743)" in err:
                return {
                    "ok": False,
                    "reason": "PERMISSION_DENIED",
                    "message": "ยังไม่ได้รับสิทธิ์ควบคุม Chrome: โปรดไปที่ System Settings > Privacy & Security > Automation แล้วเปิดอนุญาตให้ควบคุม Google Chrome",
                }
            return {"ok": False, "reason": "OSASCRIPT_ERROR", "message": err}

        out = proc.stdout.strip()
        if out == "TAB_NOT_FOUND" or not out:
            return {
                "ok": False,
                "reason": "TAB_NOT_FOUND",
                "message": "ไม่พบแท็บ gspdailyreport.pttplc.com ที่เปิดอยู่ใน Google Chrome (กรุณาเปิดหน้าเว็บ GSP Daily Report ค้างไว้ใน Chrome)",
            }

        payload = json.loads(out)
        parsed = parse_gsp_text_or_html(payload.get("text", "") + "\n" + payload.get("flat", ""))
        if parsed:
            return {"ok": True, "method": "chrome_tab", "data": parsed}
        return {
            "ok": False,
            "reason": "PARSE_EMPTY",
            "message": "พบแท็บแต่ไม่พบตัวเลข Propane / LPG / NGL (ตรวจสอบว่าเลือก Plant: Tank Farm และแท็บ PRODUCTION & DELIVERY แล้ว)",
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "reason": "TIMEOUT",
            "message": "การเชื่อมต่อกับ Chrome หมดเวลา (Timeout): ตรวจสอบว่า macOS มีหน้าต่างเด้งถามสิทธิ์ควบคุม Chrome ค้างอยู่หรือไม่ หรือลองคลิกที่แท็บ GSP ใน Chrome ให้ตื่นแล้วกดดึงค่าอีกครั้ง",
        }
    except Exception as e:
        return {"ok": False, "reason": "EXCEPTION", "message": str(e)}


def fetch_gsp_with_cookie(cookie_str: str = "") -> dict:
    """
    Attempts to fetch https://gspdailyreport.pttplc.com/DailyReport/Index directly via HTTPS.
    Note: Because GSP Daily Report uses Azure AD OIDC login, a valid session cookie is required.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        GSP_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            **({"Cookie": cookie_str} if cookie_str else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
            final_url = resp.geturl()
            html = resp.read().decode("utf-8", errors="ignore")
            if "/Login" in final_url or "loginAD" in html:
                return {
                    "ok": False,
                    "reason": "AUTH_REQUIRED",
                    "message": "เว็บ gspdailyreport.pttplc.com บังคับ Login ผ่าน Azure AD (SSO) ก่อนเข้าถึงข้อมูล",
                }
            parsed = parse_gsp_text_or_html(html)
            if parsed:
                return {"ok": True, "method": "direct_https", "data": parsed}
            return {
                "ok": False,
                "reason": "SPA_DYNAMIC",
                "message": "เข้าถึงหน้าเว็บได้แล้ว แต่ค่าตัวเลขโหลดผ่าน JavaScript ฝั่งเบราว์เซอร์",
            }
    except Exception as e:
        return {"ok": False, "reason": "NETWORK_ERROR", "message": str(e)}


def evaluate_flowchart(state: dict) -> dict:
    """
    Evaluates the Operation Mode Flowchart (ผังการตัดสินใจเลือกโหมดการผลิต):
      Start -> Cross C3 to LPG ? -> Inventory > 60% ? -> Inventory > 70% ?
    """
    cross_c3 = bool(state.get("crossC3ToLpg", True))
    inv_pct = float(state.get("inventoryPct", 62))

    steps = {
        "start": True,
        "crossC3ToLpg": cross_c3,
        "invGt60": None,
        "invGt70": None,
        "recommendedMode": "optimize",
        "recommendedIndex": 2,
        "recommendedLabel": "Optimization (2. Optimize Mode)",
        "path": ["start", "cond_cross"],
    }

    if not cross_c3:
        steps["recommendedMode"] = "c3_max"
        steps["recommendedIndex"] = 1
        steps["recommendedLabel"] = "C3 Max (1. C3 Max Mode)"
        steps["path"].extend(["branch_cross_no", "res_c3_max"])
    else:
        steps["path"].extend(["branch_cross_yes", "cond_inv60"])
        inv_gt_60 = inv_pct > 60.0
        steps["invGt60"] = inv_gt_60
        if not inv_gt_60:
            steps["recommendedMode"] = "c3_max"
            steps["recommendedIndex"] = 1
            steps["recommendedLabel"] = "C3 Max (1. C3 Max Mode)"
            steps["path"].extend(["branch_inv60_no", "res_c3_max"])
        else:
            steps["path"].extend(["branch_inv60_yes", "cond_inv70"])
            inv_gt_70 = inv_pct > 70.0
            steps["invGt70"] = inv_gt_70
            if not inv_gt_70:
                steps["recommendedMode"] = "optimize"
                steps["recommendedIndex"] = 2
                steps["recommendedLabel"] = "Optimization (2. Optimize Mode)"
                steps["path"].extend(["branch_inv70_no", "res_optimize"])
            else:
                steps["recommendedMode"] = "lpg_mode"
                steps["recommendedIndex"] = 3
                steps["recommendedLabel"] = "LPG Mode (3. LPG Mode)"
                steps["path"].extend(["branch_inv70_yes", "res_lpg"])

    if inv_pct <= 30:
        inv_status = {"level": "low", "label": "ต่ำ", "range": "0 - 30%", "color": "#ef4444"}
    elif inv_pct <= 70:
        inv_status = {"level": "normal", "label": "ปกติ", "range": "31 - 70%", "color": "#22c55e"}
    else:
        inv_status = {"level": "high", "label": "สูง", "range": "71 - 100%", "color": "#eab308"}

    return {
        "flowchart": steps,
        "inventoryStatus": inv_status,
    }


def upload_image_to_cdn(image_bytes: bytes, filename: str = "dashboard.jpg") -> str:
    """
    Uploads dashboard screenshot to high-speed image CDN (Catbox / Litterbox)
    so Microsoft Teams can render the crystal-clear full dashboard screenshot.
    """
    if not image_bytes or len(image_bytes) < 100:
        return ""

    # 1. Try Catbox (Permanent hosting)
    try:
        boundary = '----WebKitFormBoundaryCatbox'
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="{filename}"\r\nContent-Type: image/jpeg\r\n\r\n'
        ).encode('utf-8') + image_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        req = urllib.request.Request(
            'https://catbox.moe/user/api.php',
            data=body,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            u = res.read().decode('utf-8').strip()
            if u.startswith('http'):
                print(f"[MS Teams Image] Uploaded to Catbox: {u}")
                return u
    except Exception as e:
        print(f"[MS Teams Image] Catbox error: {e}")

    # 2. Fallback to Litterbox (24 hours)
    try:
        boundary = '----WebKitFormBoundaryLitter'
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n24h\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="{filename}"\r\nContent-Type: image/jpeg\r\n\r\n'
        ).encode('utf-8') + image_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')
        req = urllib.request.Request(
            'https://litterbox.catbox.moe/resources/internals/api.php',
            data=body,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            u = res.read().decode('utf-8').strip()
            if u.startswith('http'):
                print(f"[MS Teams Image] Uploaded to Litterbox: {u}")
                return u
    except Exception as e:
        print(f"[MS Teams Image] Litterbox error: {e}")

    return ""


def build_teams_payload(
    state: dict,
    reason: str = "ส่งทันที (Manual)",
    note: str = "",
    screenshot_b64: str = ""
) -> dict:
    """
    Constructs an informative payload for Microsoft Teams via Power Automate.
    Formats rich Markdown as well as structured data fields, plus crystal-clear dashboard snapshot image.
    """
    eval_res = evaluate_flowchart(state)
    flow = eval_res.get("flowchart", {})
    rec_mode_name = flow.get("recommendedLabel", "1. C3 Max Mode")
    rec_key = flow.get("recommendedMode", "optimize")

    inv_pct = state.get("inventoryPct", 68.17)
    inv_ton = state.get("inventoryTon", 10162)
    inv_cap = state.get("inventoryCap", 20000)

    demand_pct = state.get("demandPct", 70)
    demand_ton = state.get("demandTon", 14000)
    demand_cap = state.get("demandCap", 20000)

    prod_price = state.get("productPrice", 300)
    prod_chg = state.get("productPriceChange", "+5%")
    energy_price = state.get("energyPrice", 2650)
    energy_chg = state.get("energyPriceChange", "+8%")

    gsp = state.get("gspData", {})
    cross_c3 = "YES" if state.get("crossC3ToLpg", True) else "NO"
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    cur_date, cur_time = get_current_thai_datetime()
    display_date = state.get("dateText") or cur_date
    display_time = state.get("timeText") or cur_time

    # Process & upload screenshot if provided or available on disk
    screenshot_path = os.path.join(BASE_DIR, "latest_dashboard.jpg")
    image_bytes = None

    if screenshot_b64:
        try:
            raw_b64 = screenshot_b64
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            image_bytes = base64.b64decode(raw_b64)
            with open(screenshot_path, "wb") as f:
                f.write(image_bytes)
        except Exception as e:
            print(f"[Screenshot] Error decoding base64: {e}")

    if not image_bytes and os.path.exists(screenshot_path):
        try:
            with open(screenshot_path, "rb") as f:
                image_bytes = f.read()
        except Exception:
            pass

    image_url = ""
    if image_bytes:
        timestamp_slug = datetime.now().strftime("%Y%m%d_%H%M%S")
        image_url = upload_image_to_cdn(image_bytes, filename=f"3d_smartboard_{timestamp_slug}.jpg")

    exp = state.get("expectedResult", {})

    lines = [
        "## 📢 รายงาน 3D SMART BOARD (PTT)",
        f"**🎯 โหมดการผลิตที่แนะนำ:** **{rec_mode_name}**",
        f"**📅 วันที่-เวลา:** {display_date} {display_time} ({now_str}) | **ประเภทการส่ง:** {reason}",
    ]
    if note:
        lines.append(f"**📝 หมายเหตุ:** {note}")

    if image_url:
        lines.append(f"\n📸 **ภาพหน้าจอแดชบอร์ด:**\n![3D SMART BOARD Snapshot]({image_url})\n👉 [คลิกเพื่อดูภาพความละเอียดสูงเต็มจอ]({image_url})\n")

    lines.extend([
        "",
        "---",
        "### 📊 ข้อมูล 4 ปัจจัยหลัก:",
        f"- 📦 **ระดับสินค้าคงคลัง (Inventory):** **{inv_pct:.2f}%** ({inv_ton:,} / {inv_cap:,} Ton)",
        f"- 🛢️ **ความต้องการใช้ถัง (Tank Farm Demand):** **{demand_pct}%** ({demand_ton:,} / {demand_cap:,} Ton)",
        f"- 💰 **ราคาผลิตภัณฑ์ (Product Price):** **{prod_price} USD/Ton** ({prod_chg})",
        f"- 🔥 **ต้นทุนพลังงาน (Energy Price):** **{energy_price} MMBtu/Ton** ({energy_chg})",
        "",
        "### 🌐 ข้อมูลจริงจาก GSP Daily Report (Tank Farm):",
        f"- **Propane:** {gsp.get('propanePct', 68.17):.2f}%",
        f"- **LPG:** {gsp.get('lpgPct', 36.19):.2f}%",
        f"- **NGL:** {gsp.get('nglPct', 62.39):.2f}%",
        f"- **Propane + LPG =** {gsp.get('propanePlusLpgPct', 43.17):.2f}%",
        "",
        "### ⚙️ การเลือกโหมดการผลิต (3 Production Modes):",
        f"- **1. C3 Max Mode:** {'YES (★ เลือกโหมดนี้)' if rec_key == 'c3_max' else 'NO'}",
        f"- **2. Optimize Mode:** {'YES (★ เลือกโหมดนี้)' if rec_key == 'optimize' else 'NO'}",
        f"- **3. LPG Mode:** {'YES (★ เลือกโหมดนี้)' if rec_key == 'lpg_mode' else 'NO'}",
        f"👉 **โหมดที่ระบบเลือก:** ⭐ **{rec_mode_name}** (จาก Inventory {inv_pct:.2f}% > 60% แต่ยังไม่เกิน 70%)",
        "",
        "### 📈 ผลลัพธ์คาดการณ์ (Expected Result):",
        f"- กำไรโดยประมาณ: **{exp.get('profit', 'สูงสุด')}**",
        f"- การใช้พลังงาน: **{exp.get('energy', 'เหมาะสม')}**",
        f"- การใช้พื้นที่จัดเก็บ: **{exp.get('storage', 'สมดุล')}**",
        f"- ความยืดหยุ่นในการขาย: **{exp.get('flexibility', 'ดี')}**",
    ])

    formatted_md = "\n".join(lines)

    # Official Microsoft Teams Adaptive Card (v1.2) for Power Automate Workflows
    card_body = [
        {
            "type": "Container",
            "style": "emphasis",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "📢 PTT 3D SMART BOARD",
                    "weight": "Bolder",
                    "size": "Medium",
                    "color": "Accent",
                },
                {
                    "type": "TextBlock",
                    "text": f"🎯 โหมดการผลิตที่แนะนำ: {rec_mode_name}",
                    "weight": "Bolder",
                    "size": "Large",
                    "wrap": True,
                },
                {
                    "type": "TextBlock",
                    "text": f"📅 {display_date} {display_time} | ประเภท: {reason}",
                    "isSubtle": True,
                    "size": "Small",
                    "spacing": "None",
                },
            ],
        }
    ]

    # Insert crystal-clear full screenshot into Adaptive Card
    if image_url:
        card_body.append({
            "type": "Container",
            "spacing": "Medium",
            "items": [
                {
                    "type": "TextBlock",
                    "text": "📸 **ภาพหน้าจอแดชบอร์ด 3D SMART BOARD (คลิกรูปเพื่อขยายเต็มจอ):**",
                    "size": "Medium",
                    "weight": "Bolder",
                    "wrap": True,
                },
                {
                    "type": "Image",
                    "url": image_url,
                    "altText": "PTT 3D SMART BOARD Dashboard Snapshot",
                    "size": "Auto",
                    "msTeams": {
                        "allowExpand": True
                    }
                }
            ]
        })

    if note:
        card_body.append({
            "type": "TextBlock",
            "text": f"📝 **หมายเหตุ:** {note}",
            "wrap": True,
            "weight": "Bolder",
            "color": "Warning",
        })

    card_body.extend([
        {
            "type": "TextBlock",
            "text": "📊 **ข้อมูล 4 ปัจจัยหลัก**",
            "weight": "Bolder",
            "size": "Medium",
            "spacing": "Medium",
        },
        {
            "type": "FactSet",
            "facts": [
                {"title": "📦 Inventory:", "value": f"{inv_pct:.2f}% ({inv_ton:,} / {inv_cap:,} Ton)"},
                {"title": "🛢️ Demand:", "value": f"{demand_pct}% ({demand_ton:,} / {demand_cap:,} Ton)"},
                {"title": "💰 Product Price:", "value": f"{prod_price} USD/Ton ({prod_chg})"},
                {"title": "🔥 Energy Price:", "value": f"{energy_price} MMBtu/Ton ({energy_chg})"},
            ],
        },
        {
            "type": "TextBlock",
            "text": "🌐 **ข้อมูลจริง GSP Daily Report (Tank Farm)**",
            "weight": "Bolder",
            "size": "Medium",
            "spacing": "Medium",
        },
        {
            "type": "FactSet",
            "facts": [
                {"title": "Propane:", "value": f"{gsp.get('propanePct', 68.17):.2f}%"},
                {"title": "LPG:", "value": f"{gsp.get('lpgPct', 36.19):.2f}%"},
                {"title": "NGL:", "value": f"{gsp.get('nglPct', 62.39):.2f}%"},
                {"title": "Propane + LPG:", "value": f"{gsp.get('propanePlusLpgPct', 43.17):.2f}%"},
            ],
        },
        {
            "type": "TextBlock",
            "text": "⚙️ **การเลือกโหมดการผลิต (3 Production Modes)**",
            "weight": "Bolder",
            "size": "Medium",
            "spacing": "Medium",
        },
        {
            "type": "FactSet",
            "facts": [
                {"title": "1. C3 Max Mode:", "value": "YES (★ เลือกโหมดนี้)" if rec_key == "c3_max" else "NO"},
                {"title": "2. Optimize Mode:", "value": "YES (★ เลือกโหมดนี้)" if rec_key == "optimize" else "NO"},
                {"title": "3. LPG Mode:", "value": "YES (★ เลือกโหมดนี้)" if rec_key == "lpg_mode" else "NO"},
            ],
        },
        {
            "type": "TextBlock",
            "text": f"👉 **โหมดที่เลือก:** ⭐ **{rec_mode_name}** (จากเงื่อนไข Inventory {inv_pct:.2f}% อยู่ระหว่าง 60% - 70%)",
            "weight": "Bolder",
            "wrap": True,
            "spacing": "Small",
        },
        {
            "type": "TextBlock",
            "text": "📈 **ผลลัพธ์คาดการณ์ (Expected Result)**",
            "weight": "Bolder",
            "size": "Medium",
            "spacing": "Medium",
        },
        {
            "type": "FactSet",
            "facts": [
                {"title": "กำไรโดยประมาณ:", "value": str(exp.get('profit', 'สูงสุด'))},
                {"title": "การใช้พลังงาน:", "value": str(exp.get('energy', 'เหมาะสม'))},
                {"title": "การใช้พื้นที่จัดเก็บ:", "value": str(exp.get('storage', 'สมดุล'))},
                {"title": "ความยืดหยุ่น:", "value": str(exp.get('flexibility', 'ดี'))},
            ],
        },
    ])

    adaptive_card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.2",
        "body": card_body,
    }

    return {
        # Modern Power Automate Teams Workflows format (Required by "Post to a channel when a webhook request is received" template)
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "contentUrl": None,
                "content": adaptive_card,
            }
        ],
        # Fallback & custom schema fields for flows that parse message / text directly:
        "summary": f"3D SMART BOARD - โหมดที่แนะนำ: {rec_mode_name}",
        "title": f"📢 3D SMART BOARD - โหมดที่แนะนำ: {rec_mode_name}",
        "text": formatted_md,
        "message": formatted_md,
        "content": formatted_md,
        "recommendedMode": rec_mode_name,
        "inventoryPct": inv_pct,
        "inventoryTon": inv_ton,
        "demandPct": demand_pct,
        "demandTon": demand_ton,
        "productPrice": prod_price,
        "energyPrice": energy_price,
        "gspData": gsp,
        "reason": reason,
        "note": note,
        "timestamp": now_str,
    }


def send_teams_notification(
    reason: str = "ส่งทันที (Manual)",
    note: str = "",
    screenshot_b64: str = ""
) -> dict:
    """
    Sends notification payload to the configured MS Teams Power Automate webhook.
    """
    config = CURRENT_STATE.get("notifyConfig", {})
    webhook_url = config.get("webhookUrl", "").strip()
    if not webhook_url:
        return {"ok": False, "error": "ไม่พบ Webhook URL ของ MS Teams"}

    payload = build_teams_payload(CURRENT_STATE, reason=reason, note=note, screenshot_b64=screenshot_b64)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST"
    )

    ctx = ssl.create_default_context()
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    try:
        with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
            status_code = resp.status
            status_msg = f"สำเร็จ ({status_code} Accepted)"
            config["lastSent"] = now_str
            config["lastStatus"] = status_msg
            config["lastError"] = None

            log_entry = {
                "timestamp": now_str,
                "reason": reason,
                "status": status_msg,
                "statusCode": status_code,
                "recommendedMode": payload.get("recommendedMode", ""),
                "ok": True,
            }
            logs = config.setdefault("sendLogs", [])
            logs.insert(0, log_entry)
            config["sendLogs"] = logs[:20]
            save_notify_config(config)

            return {
                "ok": True,
                "status": status_code,
                "message": status_msg,
                "timestamp": now_str,
                "payload": payload,
            }
    except urllib.error.HTTPError as e:
        err_msg = f"HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}"
        config["lastStatus"] = err_msg
        config["lastError"] = err_msg
        log_entry = {
            "timestamp": now_str,
            "reason": reason,
            "status": err_msg,
            "statusCode": e.code,
            "ok": False,
        }
        logs = config.setdefault("sendLogs", [])
        logs.insert(0, log_entry)
        config["sendLogs"] = logs[:20]
        save_notify_config(config)
        return {"ok": False, "error": err_msg}
    except Exception as e:
        err_msg = str(e)
        config["lastStatus"] = f"Error: {err_msg}"
        config["lastError"] = err_msg
        log_entry = {
            "timestamp": now_str,
            "reason": reason,
            "status": f"Error: {err_msg}",
            "statusCode": 0,
            "ok": False,
        }
        logs = config.setdefault("sendLogs", [])
        logs.insert(0, log_entry)
        config["sendLogs"] = logs[:20]
        save_notify_config(config)
        return {"ok": False, "error": err_msg}


def parse_schedule_times(config: dict) -> list:
    """
    Parses configured schedule times into a list of "HH:MM" 24-hr time strings.
    Defaults to 08:00 and 20:00 (2 daily shifts).
    """
    raw_list = config.get("scheduleTimes")
    if isinstance(raw_list, list) and raw_list:
        return [t.strip() for t in raw_list if isinstance(t, str) and t.strip()]
    raw_str = config.get("scheduleTime", "08:00, 20:00")
    if isinstance(raw_str, str):
        return [t.strip() for t in raw_str.replace(";", ",").split(",") if t.strip()]
    return ["08:00", "20:00"]


def schedule_worker():
    """
    Background daemon thread checking scheduled times (e.g. 08:00 และ 20:00) every 15 seconds.
    Fires automatic notification to MS Teams when schedule is enabled and current time matches.
    """
    last_fired_ymd_hm = ""
    while True:
        try:
            config = CURRENT_STATE.get("notifyConfig", {})
            if config.get("scheduleEnabled"):
                now = datetime.now()
                # Check day of week (mon, tue, wed, thu, fri, sat, sun)
                day_abbr_list = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                current_day = day_abbr_list[now.weekday()]
                allowed_days = config.get("scheduleDays", day_abbr_list)
                if allowed_days and current_day not in allowed_days:
                    time.sleep(15)
                    continue

                current_hm = now.strftime("%H:%M")
                current_ymd_hm = now.strftime("%Y-%m-%d %H:%M")
                times_list = parse_schedule_times(config)
                if current_hm in times_list and last_fired_ymd_hm != current_ymd_hm:
                    last_fired_ymd_hm = current_ymd_hm
                    print(f"[MS Teams Scheduler] Triggering daily notification for {current_hm} at {current_ymd_hm}...")
                    # Automatically attempt to refresh live GSP data before sending
                    try:
                        gsp_res = fetch_gsp_from_chrome_tab()
                        if not gsp_res.get("ok"):
                            gsp_res = fetch_gsp_with_cookie()
                        if gsp_res.get("ok") and gsp_res.get("data"):
                            CURRENT_STATE["gspData"].update(gsp_res["data"])
                            if gsp_res["data"].get("propanePct") is not None:
                                pct = round(float(gsp_res["data"]["propanePct"]), 2)
                                CURRENT_STATE["inventoryPct"] = pct
                                CURRENT_STATE["inventoryTon"] = round(pct / 100 * CURRENT_STATE["inventoryCap"])
                            print(f"[MS Teams Scheduler] Auto-refreshed live GSP data: Propane={CURRENT_STATE['inventoryPct']}%")
                    except Exception as ge:
                        print(f"[MS Teams Scheduler] Note: Could not auto-fetch live tab ({ge}), using latest stored state.")
                    send_teams_notification(reason=f"ตั้งเวลาประจำวัน (รอบ {current_hm} น.)")
        except Exception as e:
            print(f"[MS Teams Scheduler Error] {e}")
        time.sleep(15)


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Allow CORS so bookmarklet / Chrome extension on gspdailyreport.pttplc.com can push data directly
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Allow embedding inside Microsoft Teams, SharePoint, and Office 365
        self.send_header(
            "Content-Security-Policy",
            "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.office.com https://*.sharepoint.com;"
        )
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/time", "/time", "/3dc3/api/time"):
            now = datetime.now()
            d, t = get_current_thai_datetime()
            self._send_json({
                "ok": True,
                "iso": now.isoformat(),
                "timestamp": now.timestamp(),
                "thaiDate": d,
                "thaiTime": t,
                "timezone": "Asia/Bangkok"
            })
            return

        if parsed.path in ("/api/auth/verify", "/api/verify"):
            auth_header = self.headers.get("Authorization", "")
            token = ""
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
            if not token:
                token = self.headers.get("X-Auth-Token", "")
            if token and token in ACTIVE_SESSIONS:
                sess = ACTIVE_SESSIONS[token]
                if time.time() < sess.get("expires", 0):
                    self._send_json({"authenticated": True, "username": sess.get("username", "oper_gsp")})
                    return
                else:
                    del ACTIVE_SESSIONS[token]
            self._send_json({"authenticated": False}, status=401)
            return
        if parsed.path in ("/api/state", "/3dc3/api/state"):
            evaluation = evaluate_flowchart(CURRENT_STATE)
            self._send_json({"state": CURRENT_STATE, "evaluation": evaluation})
            return
        if parsed.path in ("/api/notify/config", "/3dc3/api/notify/config", "/notify/config", "/3dc3/notify/config", "/notify.php"):
            cfg = dict(CURRENT_STATE.get("notifyConfig", {}))
            cfg.pop("webhookUrl", None)
            self._send_json({"ok": True, "config": cfg})
            return
        if parsed.path == "/api/fetch-gsp":
            # Try reading from open Chrome tab first, then fallback to direct HTTPS
            res = fetch_gsp_from_chrome_tab()
            if not res.get("ok"):
                direct_res = fetch_gsp_with_cookie()
                if direct_res.get("ok"):
                    res = direct_res
            if res.get("ok") and res.get("data"):
                CURRENT_STATE["gspData"].update(res["data"])
                CURRENT_STATE["gspData"]["syncMethod"] = res.get("method", "chrome_tab")
                # Propane % -> Inventory % (2 decimal places)
                if res["data"].get("propanePct") is not None:
                    pct = round(float(res["data"]["propanePct"]), 2)
                    CURRENT_STATE["inventoryPct"] = pct
                    CURRENT_STATE["inventoryTon"] = round(pct / 100 * CURRENT_STATE["inventoryCap"])
            self._send_json({
                "fetchResult": res,
                "state": CURRENT_STATE,
                "evaluation": evaluate_flowchart(CURRENT_STATE),
            })
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            data = json.loads(raw_body)
        except json.JSONDecodeError:
            data = {}

        if parsed.path in ("/api/auth/login", "/api/login"):
            username = str(data.get("username", "")).strip()
            password = str(data.get("password", "")).strip()
            if not username or not password:
                self._send_json({"ok": False, "error": "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน"}, status=400)
                return

            if verify_credentials(username, password):
                token = secrets.token_hex(24)
                cfg = get_auth_config()
                hours = cfg.get("sessionTimeoutHours", 24)
                expires = time.time() + (hours * 3600)
                ACTIVE_SESSIONS[token] = {"username": username, "expires": expires}
                self._send_json({
                    "ok": True,
                    "message": "เข้าสู่ระบบสำเร็จ",
                    "token": token,
                    "username": username,
                    "expires": expires
                })
                return
            else:
                self._send_json({
                    "ok": False,
                    "error": "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง"
                }, status=401)
                return

        if parsed.path in ("/api/auth/logout", "/api/logout"):
            token = data.get("token") or self.headers.get("X-Auth-Token", "")
            if token in ACTIVE_SESSIONS:
                del ACTIVE_SESSIONS[token]
            self._send_json({"ok": True, "message": "ออกจากระบบสำเร็จ"})
            return

        if parsed.path == "/api/evaluate":
            if isinstance(data, dict):
                CURRENT_STATE.update(data)
            evaluation = evaluate_flowchart(CURRENT_STATE)
            self._send_json({"state": CURRENT_STATE, "evaluation": evaluation})
            return

        if parsed.path in ("/api/notify/send", "/3dc3/api/notify/send", "/notify/send", "/3dc3/notify/send"):
            reason = data.get("reason", "ส่งทันที (Manual)")
            note = data.get("note", "")
            screenshot = data.get("screenshot", "")
            res = send_teams_notification(reason=reason, note=note, screenshot_b64=screenshot)
            self._send_json(res)
            return

        if parsed.path in ("/api/sync-screenshot", "/3dc3/api/sync-screenshot"):
            screenshot_b64 = data.get("screenshot", "")
            if screenshot_b64:
                try:
                    raw_b64 = screenshot_b64
                    if "," in raw_b64:
                        raw_b64 = raw_b64.split(",", 1)[1]
                    image_bytes = base64.b64decode(raw_b64)
                    screenshot_path = os.path.join(BASE_DIR, "latest_dashboard.jpg")
                    with open(screenshot_path, "wb") as f:
                        f.write(image_bytes)
                    self._send_json({"ok": True, "saved": True, "size": len(image_bytes)})
                    return
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e)}, status=400)
                    return
            self._send_json({"ok": False, "error": "No screenshot provided"}, status=400)
            return

        if parsed.path in ("/api/notify/config", "/3dc3/api/notify/config", "/notify/config", "/3dc3/notify/config"):
            config = CURRENT_STATE.setdefault("notifyConfig", {})
            if "webhookUrl" in data and isinstance(data["webhookUrl"], str):
                config["webhookUrl"] = data["webhookUrl"].strip()
            if "scheduleEnabled" in data:
                config["scheduleEnabled"] = bool(data["scheduleEnabled"])
            if "scheduleTimes" in data:
                if isinstance(data["scheduleTimes"], list):
                    config["scheduleTimes"] = [t.strip() for t in data["scheduleTimes"] if isinstance(t, str) and t.strip()]
                    config["scheduleTime"] = ", ".join(config["scheduleTimes"])
                elif isinstance(data["scheduleTimes"], str):
                    config["scheduleTime"] = data["scheduleTimes"].strip()
                    config["scheduleTimes"] = [t.strip() for t in config["scheduleTime"].replace(";", ",").split(",") if t.strip()]
            elif "scheduleTime" in data and isinstance(data["scheduleTime"], str):
                config["scheduleTime"] = data["scheduleTime"].strip()
                config["scheduleTimes"] = [t.strip() for t in config["scheduleTime"].replace(";", ",").split(",") if t.strip()]
            if "scheduleDays" in data and isinstance(data["scheduleDays"], list):
                config["scheduleDays"] = [d.strip() for d in data["scheduleDays"] if isinstance(d, str) and d.strip()]
            save_notify_config(config)
            resp_cfg = dict(config)
            resp_cfg.pop("webhookUrl", None)
            self._send_json({"ok": True, "config": resp_cfg})
            return

        if parsed.path == "/api/gsp-sync":
            # Endpoint for Bookmarklet / Extension / Cookie push
            if isinstance(data, dict):
                if "cookie" in data and data["cookie"]:
                    res = fetch_gsp_with_cookie(data["cookie"])
                    if res.get("ok") and res.get("data"):
                        CURRENT_STATE["gspData"].update(res["data"])
                    self._send_json({"fetchResult": res, "state": CURRENT_STATE})
                    return
                CURRENT_STATE["gspData"].update(data)
            self._send_json({
                "ok": True,
                "state": CURRENT_STATE,
                "evaluation": evaluate_flowchart(CURRENT_STATE),
            })
            return

        self.send_error(404, "Endpoint not found")

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def ensure_ssl_certificates(cert_path: str, key_path: str, server_ip: str = "172.20.250.127") -> bool:
    """
    Ensures SSL certificate and private key exist.
    If missing, auto-generates a self-signed certificate valid for 10 years (3650 days)
    with Subject Alternative Names (SAN) for localhost, 127.0.0.1, and the specified server IP.
    """
    if os.path.exists(cert_path) and os.path.exists(key_path):
        return True

    print(f"[SSL] Generating self-signed SSL certificate for {server_ip} and localhost...")
    try:
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", key_path,
            "-out", cert_path,
            "-days", "3650",
            "-subj", f"/C=TH/ST=Rayong/O=PTT GSP/CN={server_ip}",
            "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{server_ip}"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and os.path.exists(cert_path) and os.path.exists(key_path):
            print(f"[SSL] Certificate generated successfully: {cert_path}")
            return True
        else:
            cmd_fallback = [
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-keyout", key_path,
                "-out", cert_path,
                "-days", "3650",
                "-subj", f"/C=TH/ST=Rayong/O=PTT GSP/CN={server_ip}"
            ]
            res2 = subprocess.run(cmd_fallback, capture_output=True, text=True, timeout=10)
            if res2.returncode == 0:
                print(f"[SSL] Certificate generated (fallback mode): {cert_path}")
                return True
    except Exception as e:
        print(f"[SSL] Error generating certificate: {e}")

    return os.path.exists(cert_path) and os.path.exists(key_path)


def run_server():
    # 1. Start background scheduler thread for MS Teams notifications
    scheduler_thread = threading.Thread(target=schedule_worker, daemon=True)
    scheduler_thread.start()
    print("[MS Teams Scheduler] Background scheduler thread started.")

    # 2. Check / Generate SSL certificates for direct HTTPS
    cert_path = os.path.join(BASE_DIR, "cert.pem")
    key_path = os.path.join(BASE_DIR, "key.pem")
    server_ip = os.environ.get("SERVER_IP", "172.20.250.127")
    ssl_available = ensure_ssl_certificates(cert_path, key_path, server_ip=server_ip)

    http_port = int(os.environ.get("HTTP_PORT", os.environ.get("PORT", "8080")))
    https_port = int(os.environ.get("HTTPS_PORT", "8443"))

    ThreadingHTTPServer.allow_reuse_address = True

    # 3. Start HTTP server in a background daemon thread
    def serve_http():
        try:
            http_server = ThreadingHTTPServer(("0.0.0.0", http_port), DashboardRequestHandler)
            print(f"📡 [HTTP]  Server running at http://localhost:{http_port} (หรือ http://{server_ip}:{http_port})")
            http_server.serve_forever()
        except Exception as e:
            print(f"[HTTP Server] Error: {e}")

    http_thread = threading.Thread(target=serve_http, daemon=True)
    http_thread.start()

    # 4. Start HTTPS server (Direct HTTPS for Microsoft Teams)
    if ssl_available:
        try:
            https_server = ThreadingHTTPServer(("0.0.0.0", https_port), DashboardRequestHandler)
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)
            https_server.socket = ssl_ctx.wrap_socket(https_server.socket, server_side=True)
            print(f"🔒 [HTTPS] Server running at https://localhost:{https_port} (หรือ https://{server_ip}:{https_port})")
            print(f"👉 สำหรับ MS Teams: ใช้ https://{server_ip}:{https_port} (หรือ https://localhost:{https_port})")
            https_server.serve_forever()
        except Exception as e:
            print(f"[HTTPS Server] Error starting HTTPS: {e}")
            while True:
                time.sleep(3600)
    else:
        print("[HTTPS Server] ไม่พบไฟล์ SSL cert.pem/key.pem จะรันเฉพาะ HTTP")
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in ("--alert", "--trigger-alert", "alert"):
        reason = sys.argv[2] if len(sys.argv) > 2 else "ตั้งเวลาอัตโนมัติ (Automated Shift Alert)"
        print(f"Triggering MS Teams notification: {reason}...")
        # Auto-refresh GSP if possible
        try:
            gsp_res = fetch_gsp_from_chrome_tab()
            if not gsp_res.get("ok"):
                gsp_res = fetch_gsp_with_cookie()
            if gsp_res.get("ok") and gsp_res.get("data"):
                CURRENT_STATE["gspData"].update(gsp_res["data"])
                if gsp_res["data"].get("propanePct") is not None:
                    pct = round(float(gsp_res["data"]["propanePct"]), 2)
                    CURRENT_STATE["inventoryPct"] = pct
                    CURRENT_STATE["inventoryTon"] = round(pct / 100 * CURRENT_STATE["inventoryCap"])
                print(f"Auto-refreshed live GSP data: Propane={CURRENT_STATE['inventoryPct']}%")
        except Exception as ge:
            print(f"Note: Could not auto-fetch live tab ({ge}), using latest stored state.")
        
        result = send_teams_notification(reason=reason)
        print("Result:", json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0 if result.get("ok") else 1)

    run_server()
