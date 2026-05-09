#!/usr/bin/env python3
"""
generate_pdf.py — IPL Fantasy Pro Season Insights PDF
=====================================================
Generates a shareable PDF matching the Season Insights markdown.
"""

import json
import os
from datetime import datetime
from fpdf import FPDF

OUTPUT = os.path.join(os.path.dirname(__file__), "IPL_Fantasy_Insights.pdf")

# Colors (R, G, B)
DARK_BG    = (26, 26, 46)
HEADER_BG  = (31, 78, 121)
GOLD       = (255, 215, 0)
GOLD_LIGHT = (255, 248, 220)
WHITE      = (255, 255, 255)
LIGHT_GRAY = (245, 245, 250)
MID_GRAY   = (180, 180, 180)
TEXT_DARK   = (30, 30, 30)
TEXT_MID    = (80, 80, 80)
GREEN_V    = (39, 174, 96)
RED_V      = (200, 50, 50)
ORANGE_V   = (210, 140, 20)
BLUE_V     = (52, 130, 200)
PURPLE_V   = (120, 60, 160)
QUIET_V    = (150, 150, 150)

OWNER_COLORS = {
    "Venky":    (42, 157, 143),
    "Sid":      (214, 132, 67),
    "Kaushik":  (200, 57, 70),
    "Barath":   (69, 123, 157),
    "Aravinth": (50, 80, 95),
    "Vignesh":  (180, 160, 60),
    "JR":       (130, 70, 200),
}

# The narrative content from season_insights.md per owner
NARRATIVES = {
    "Venky": {
        "analysis": (
            "Why he's #1: The most complete draft in the league. 19/20 players "
            "contributing with zero duds. Only Shahbaz Ahmed (20 pts) qualifies as a miss. "
            "His mid-rounds (R6-12) delivered 1,184 pts -- the Phil Salt (R7, 231) and "
            "Anshul Kamboj (R10, 256) picks were masterstrokes. His late rounds are equally "
            "absurd -- Prasidh Krishna at R16 for 278 pts is the best late-round steal in "
            "the league. The only 'weakness' is that R4-R5 underperformed relative to draft "
            "position, but it didn't matter because literally everything else hit."
        ),
        "key_stat": "Top 3 carry only 27% of total -- the most balanced roster in the league.",
    },
    "Sid": {
        "analysis": (
            "The Bumrah gamble: Using an R1 pick on a bowler who returned only 36 pts is "
            "the single worst top-pick ROI in the league. But Sid recovered spectacularly "
            "with mid-round steals -- Jos Buttler (R8, 308) and Dhruv Jurel (R10, 329) are "
            "the 2nd and 3rd highest-scoring owned players overall. Late rounds were equally "
            "strong: Jofra Archer (R16, 244) and Sarfaraz Khan (R19, 187) are gems. The 3 "
            "DNPs (Dhoni, Karun, Arjun) hurt, but the sheer ceiling of his mid-round picks "
            "keeps him in 2nd."
        ),
        "key_stat": "R8+R10 alone (Buttler + Jurel = 637 pts) outscore most owners' entire top 5.",
    },
    "Kaushik": {
        "analysis": (
            "Mid-round maestro: Kaushik's R6-R12 produced an insane 1,339 pts -- the highest "
            "mid-round haul. Rajat Patidar (R6, 328) and Heinrich Klaasen (R11, 337) are "
            "absolute blockbusters. But the draft has structural problems: de Kock (R3) and "
            "Ishant (R16) are complete zeroes, Boult (R4, 40 pts) is effectively dead, and "
            "the late rounds (R13-R20) generated only 463 pts -- the 2nd lowest. He's propped "
            "up by a magnificent R1-R2 (Kohli 290 + Sooryavanshi 320 = 610) and a ridiculous "
            "middle, but the roster lacks depth."
        ),
        "key_stat": "Only 12 contributors -- the joint-fewest with JR, yet somehow 3rd overall.",
    },
    "Barath": {
        "analysis": (
            "The most balanced drafter. Top 3 carry only 28% (joint-best with Venky). "
            "Every section of the draft delivered: early 761, mid 905, late 862. Jamie "
            "Overton at R19 (277 pts) is a filthy pick -- 4th highest-scoring player on the "
            "roster, picked in the penultimate round. Ruturaj as R1 (80 pts) is the main "
            "drag -- an R1 pick performing like a late-rounder. Devdutt Padikkal (R10, 240) "
            "is quietly one of the best picks in the league. Only 1 DNP (Will Jacks) keeps "
            "the roster clean. With 15 contributors and the most even distribution across "
            "rounds, Barath's roster is built for consistency."
        ),
        "key_stat": "14 players with 100+ pts -- the most in the league.",
    },
    "Aravinth": {
        "analysis": (
            "MVP owner, depth problem. Aravinth owns the league's #1 overall scorer -- "
            "Ishan Kishan (R1, 367 pts). Mid-rounds were spectacular: Ravi Bishnoi (R12, "
            "285), Angkrish Raghuvanshi (R9, 242), Tim David (R10, 209). But the R2 pick "
            "(Brevis, 32 pts) is a costly bust at that draft position, and 3 late DNPs "
            "(Holder, Ansari, Brar) are dead weight. If even 2 of those duds had delivered "
            "80+ pts, Aravinth would be in the top 3. The squad's ceiling is high but the "
            "floor has holes."
        ),
        "key_stat": "R1+R9+R12 alone = 894 pts (36% of total from just 3 picks).",
    },
    "Vignesh": {
        "analysis": (
            "Solid early, leaking late. R1-R3 all hit (Rahul, Pandya, Iyer = 564 pts), and "
            "Rohit at R6 (204) was a steal. Nitish Kumar Reddy (R11, 277) is a gem. But "
            "Harshal Patel at R5 (9 pts) is essentially a wasted early pick, and 3 late DNPs "
            "drag the roster down. The total of 2,067 puts Vignesh in 6th despite having 14 "
            "contributors -- the points just aren't high enough per player. No single player "
            "exceeds 277, meaning the roster lacks a true superstar scorer."
        ),
        "key_stat": "Early rounds (631 pts) are the lowest of any owner -- R4+R5 combined only 67 pts.",
    },
    "JR": {
        "analysis": (
            "The late-round catastrophe. JR's R1-R5 (793 pts) is actually decent -- Gill, "
            "SKY, Head all delivered. Mid-rounds had some steals (Dube R6, Sandeep R9). But "
            "R13-R20 produced a league-worst 126 pts -- with 7 players at zero. That's 7 "
            "wasted picks. Starc, Carse, Bethell, Omarzai -- high-profile names that simply "
            "haven't played. This isn't bad drafting on paper (these are genuine IPL players), "
            "but it's a depth disaster that leaves JR 1,442 pts behind the leader. Without a "
            "miracle run from his dormant picks, this is unrecoverable."
        ),
        "key_stat": "7 DNPs -- more than twice any other owner. Late rounds (R13-20) = 126 pts vs Venky's 969.",
    },
}


def get_verdict(rd, pts):
    if rd <= 5:
        if pts >= 150: return ("HIT", GREEN_V)
        if pts >= 50:  return ("UNDER", ORANGE_V)
        if pts > 0:    return ("BUST", RED_V)
        return ("DNP", RED_V)
    elif rd <= 12:
        if pts >= 100: return ("STEAL", GREEN_V)
        if pts >= 50:  return ("SOLID", BLUE_V)
        if pts > 0:    return ("QUIET", QUIET_V)
        return ("DNP", RED_V)
    else:
        if pts >= 80:  return ("GEM", PURPLE_V)
        if pts >= 30:  return ("GOOD", BLUE_V)
        if pts > 0:    return ("FILLER", QUIET_V)
        return ("DNP", RED_V)


class PDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 7)
        self.set_text_color(*MID_GRAY)
        self.cell(0, 10, f"IPL Fantasy Pro  -  Page {self.page_no()}/{{nb}}  -  {datetime.now().strftime('%d %b %Y')}", align="C")


def main():
    with open("owner_player_map.json") as f:
        owner_map = json.load(f)
    with open("api_logs/latest_snapshot.json") as f:
        snap = json.load(f)
    api = {p["Name"]: p for p in snap["players"]}

    # Build stats
    ranked = []
    for owner, plist in owner_map.items():
        pts = [(p, api.get(p, {}).get("OverallPoints", 0)) for p in plist]
        total = sum(pt for _, pt in pts)
        contribs = sum(1 for _, pt in pts if pt >= 50)
        zeroes = sum(1 for _, pt in pts if pt == 0)
        top3 = sorted(pts, key=lambda x: x[1], reverse=True)[:3]
        top3t = sum(p for _, p in top3)
        early = sum(p for _, p in pts[:5])
        mid = sum(p for _, p in pts[5:12])
        late = sum(p for _, p in pts[12:])
        ranked.append({"o": owner, "t": total, "c": contribs, "z": zeroes,
                       "pts": pts, "top3t": top3t, "early": early, "mid": mid, "late": late})
    ranked.sort(key=lambda x: x["t"], reverse=True)

    pdf = PDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)

    # ═══════════════════════════════════════════════════════
    # PAGE 1: TITLE + STANDINGS + QUICK HITS
    # ═══════════════════════════════════════════════════════
    pdf.add_page()

    # Dark title bar
    pdf.set_fill_color(*DARK_BG)
    pdf.rect(0, 0, 210, 50, "F")
    pdf.set_y(12)
    pdf.set_font("Helvetica", "B", 26)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 12, "IPL Fantasy Pro", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 13)
    pdf.set_text_color(*GOLD)
    pdf.cell(0, 8, "Season Insights  -  IPL 2026", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MID_GRAY)
    pdf.cell(0, 7, "Through 21 Gamedays  -  20 Completed Matches", align="C", new_x="LMARGIN", new_y="NEXT")

    # ── Standings Table ──
    pdf.set_y(58)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*TEXT_DARK)
    pdf.cell(0, 9, "Standings at a Glance", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    col_w = [12, 26, 20, 28, 14, 22, 22, 22]
    headers = ["Rank", "Owner", "Points", "Contributors", "Duds", "Top3 %", "R1-5", "R13-20"]
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(*HEADER_BG)
    pdf.set_text_color(*WHITE)
    x_start = (210 - sum(col_w)) / 2
    pdf.set_x(x_start)
    for i, h in enumerate(headers):
        pdf.cell(col_w[i], 7, h, border=1, fill=True, align="C")
    pdf.ln()

    rank_labels = ["#1", "#2", "#3", "#4", "#5", "#6", "#7"]
    pdf.set_font("Helvetica", "", 8)
    for i, d in enumerate(ranked):
        t3pct = f"{d['top3t']/d['t']*100:.0f}%" if d["t"] else "0%"
        row = [rank_labels[i], d["o"], f"{d['t']:.0f}", f"{d['c']}/20",
               str(d["z"]), t3pct, f"{d['early']:.0f}", f"{d['late']:.0f}"]

        pdf.set_fill_color(*(GOLD_LIGHT if i == 0 else LIGHT_GRAY if i % 2 == 0 else WHITE))
        pdf.set_text_color(*TEXT_DARK)
        pdf.set_x(x_start)
        for j, val in enumerate(row):
            align = "L" if j == 1 else "C"
            pdf.cell(col_w[j], 6.5, val, border=1, fill=True, align=align)
        pdf.ln()

    pdf.ln(2)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(*TEXT_MID)
    gap12 = ranked[0]["t"] - ranked[1]["t"]
    gap17 = ranked[0]["t"] - ranked[-1]["t"]
    pdf.set_x(x_start)
    pdf.cell(0, 5, f"Leader's cushion: {gap12:.0f} pts (Venky to Sid)    |    Pack spread (2nd-7th): {gap17 - gap12:.0f} pts", new_x="LMARGIN", new_y="NEXT")

    # ── Quick Hits ──
    pdf.ln(5)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*TEXT_DARK)
    pdf.cell(0, 9, "Quick Hits", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)

    hits = [
        ("Season MVP", "Ishan Kishan (367 pts) -- Aravinth's R1"),
        ("Best late steal", "Prasidh Krishna (R16, 278 pts) -- Venky"),
        ("Worst R1 pick", "Jasprit Bumrah (36 pts) -- Sid"),
        ("Most 100+ scorers", "Barath (14 players!)"),
        ("Most balanced", "Venky (Top 3 = only 27% of total)"),
        ("Most DNPs", "JR (7 players at zero)"),
        ("Best mid-rounds", "Kaushik (1,339 pts from R6-R12)"),
        ("Best late rounds", "Venky (969 pts from R13-R20)"),
        ("JR's lifeline", "Shubman Gill (273 pts)"),
    ]

    qcol = [50, 120]
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(*HEADER_BG)
    pdf.set_text_color(*WHITE)
    pdf.set_x(x_start)
    pdf.cell(qcol[0], 7, "Stat", border=1, fill=True, align="C")
    pdf.cell(qcol[1], 7, "Answer", border=1, fill=True, align="C")
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    for i, (stat, answer) in enumerate(hits):
        pdf.set_fill_color(*(LIGHT_GRAY if i % 2 == 0 else WHITE))
        pdf.set_text_color(*TEXT_DARK)
        pdf.set_x(x_start)
        pdf.set_font("Helvetica", "B", 8)
        pdf.cell(qcol[0], 6, f"  {stat}", border=1, fill=True)
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(qcol[1], 6, f"  {answer}", border=1, fill=True)
        pdf.ln()

    # ═══════════════════════════════════════════════════════
    # PAGES 2-8: OWNER DEEP DIVES
    # ═══════════════════════════════════════════════════════
    for rank_idx, d in enumerate(ranked):
        owner = d["o"]
        color = OWNER_COLORS.get(owner, HEADER_BG)
        narr = NARRATIVES.get(owner, {})

        pdf.add_page()

        # Header bar
        pdf.set_fill_color(*color)
        pdf.rect(0, 0, 210, 28, "F")
        pdf.set_y(5)
        pdf.set_font("Helvetica", "B", 20)
        pdf.set_text_color(*WHITE)
        pdf.cell(0, 10, f"{rank_labels[rank_idx]}  {owner.upper()}", align="C", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        pdf.cell(0, 7, f"{d['t']:.0f} pts  -  {d['c']} contributors  -  {d['z']} duds", align="C", new_x="LMARGIN", new_y="NEXT")

        # Draft board
        pdf.set_y(34)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*TEXT_DARK)
        pdf.cell(0, 8, "Draft Board", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

        dcol = [12, 60, 18, 22]
        dheaders = ["Rd", "Player", "Pts", "Verdict"]
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(*HEADER_BG)
        pdf.set_text_color(*WHITE)
        dx = 15
        pdf.set_x(dx)
        for i, h in enumerate(dheaders):
            pdf.cell(dcol[i], 6.5, h, border=1, fill=True, align="C")
        pdf.ln()

        pdf.set_font("Helvetica", "", 8)
        for rd, (name, pts) in enumerate(d["pts"], 1):
            verdict, vcolor = get_verdict(rd, pts)
            if rd <= 5:
                pdf.set_fill_color(255, 248, 240)
            elif rd <= 12:
                pdf.set_fill_color(240, 248, 255)
            else:
                pdf.set_fill_color(248, 242, 255)

            pdf.set_text_color(*TEXT_DARK)
            pdf.set_x(dx)
            pdf.cell(dcol[0], 5.5, f"R{rd}", border=1, fill=True, align="C")
            pdf.cell(dcol[1], 5.5, name, border=1, fill=True)
            pdf.cell(dcol[2], 5.5, f"{pts:.0f}", border=1, fill=True, align="C")
            pdf.set_text_color(*vcolor)
            pdf.set_font("Helvetica", "B", 8)
            pdf.cell(dcol[3], 5.5, verdict, border=1, fill=True, align="C")
            pdf.set_font("Helvetica", "", 8)
            pdf.ln()

        # Phase breakdown mini-table
        pdf.ln(3)
        pdf.set_text_color(*TEXT_DARK)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_x(dx)
        pdf.cell(40, 6, "Early (R1-5)", align="C")
        pdf.cell(40, 6, "Mid (R6-12)", align="C")
        pdf.cell(40, 6, "Late (R13-20)", align="C")
        pdf.ln()
        pdf.set_font("Helvetica", "", 10)
        pdf.set_x(dx)
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(40, 6, f"{d['early']:.0f}", align="C")
        pdf.cell(40, 6, f"{d['mid']:.0f}", align="C")
        pdf.cell(40, 6, f"{d['late']:.0f}", align="C")
        pdf.ln()

        # Analysis narrative
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", 11)
        pdf.set_text_color(*TEXT_DARK)
        pdf.cell(0, 7, "Analysis", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

        # Box background
        y_before = pdf.get_y()
        pdf.set_fill_color(245, 248, 252)
        analysis_text = narr.get("analysis", "")
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*TEXT_MID)

        # Compute height needed
        pdf.set_x(15)
        pdf.multi_cell(170, 4.5, analysis_text, border=0)
        y_after = pdf.get_y()

        # Draw box behind
        pdf.set_fill_color(245, 248, 252)
        pdf.rect(12, y_before - 1, 176, y_after - y_before + 2, "F")

        # Re-draw text
        pdf.set_y(y_before)
        pdf.set_x(15)
        pdf.set_text_color(*TEXT_MID)
        pdf.multi_cell(170, 4.5, analysis_text, border=0)

        # Key stat
        pdf.ln(2)
        key = narr.get("key_stat", "")
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*color)
        pdf.cell(0, 6, f"Key stat: {key}", new_x="LMARGIN", new_y="NEXT")

    pdf.output(OUTPUT)
    print(f"PDF saved to: {os.path.abspath(OUTPUT)}")


if __name__ == "__main__":
    main()
