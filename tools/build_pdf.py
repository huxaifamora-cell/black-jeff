from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
                                TableStyle, Image, KeepTogether, PageBreak, CondPageBreak)
from PIL import Image as PILImage

import os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "web", "SORK_Trading_Concept_Study_Guide.pdf")
FIGS = os.path.join(HERE, "..", "web", "fig") + "/"

NAVY = colors.HexColor("#12263F")
TEAL = colors.HexColor("#1B7F8C")
GOLD = colors.HexColor("#C8962E")
PURPLE = colors.HexColor("#7A3E9D")
GREY = colors.HexColor("#6B7785")
LIGHT = colors.HexColor("#EEF2F6")
TEALBG = colors.HexColor("#E7F2F4")
GOLDBG = colors.HexColor("#FBF3E2")
LINE = colors.HexColor("#D5DCE4")

W, H = A4
LM = RM = 18 * mm
TM = 18 * mm
BM = 18 * mm
CW = W - LM - RM

body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.6, leading=13.6, textColor=colors.HexColor("#1F2937"),
                      spaceAfter=5)
small = ParagraphStyle("small", parent=body, fontSize=8.2, leading=11, textColor=GREY, spaceAfter=3)
h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=colors.white)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11.4, leading=14.5, textColor=NAVY,
                    spaceBefore=9, spaceAfter=4)
h3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=9.8, leading=13, textColor=TEAL,
                    spaceBefore=5, spaceAfter=2)
bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=2, spaceAfter=2.5)
cap = ParagraphStyle("cap", fontName="Helvetica-Oblique", fontSize=8, leading=10.5, textColor=GREY,
                     spaceBefore=2, spaceAfter=8)
cell = ParagraphStyle("cell", fontName="Helvetica", fontSize=8.6, leading=11.4, textColor=colors.HexColor("#1F2937"))
cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
cellh = ParagraphStyle("cellh", parent=cell, fontName="Helvetica-Bold", textColor=colors.white)
rulest = ParagraphStyle("rule", parent=body, fontSize=9.2, leading=13, spaceAfter=0)

story = []
fig_no = [0]


def P(t, s=body):
    return Paragraph(t, s)


def B(items):
    return [Paragraph(t, bullet, bulletText="\u2022") for t in items]


def N(items):
    return [Paragraph(t, bullet, bulletText=f"{i}.") for i, t in enumerate(items, start=1)]


def banner(letter, title, tf, color):
    t = Table([[Paragraph(f"<b>{letter}</b>", ParagraphStyle("l", fontName="Helvetica-Bold", fontSize=22,
                                                              leading=24, textColor=colors.white,
                                                              alignment=TA_CENTER)),
                Paragraph(title, h1),
                Paragraph(tf, ParagraphStyle("tf", fontName="Helvetica", fontSize=9, leading=12,
                                             textColor=colors.white, alignment=2))]],
              colWidths=[16 * mm, CW - 16 * mm - 52 * mm, 52 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                           ("LEFTPADDING", (0, 0), (0, 0), 4), ("RIGHTPADDING", (-1, 0), (-1, 0), 9)]))
    return [CondPageBreak(70 * mm), t, Spacer(1, 6)]


def simple_banner(title, color=NAVY):
    t = Table([[Paragraph(title, h1)]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color),
                           ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                           ("LEFTPADDING", (0, 0), (-1, -1), 10)]))
    return [CondPageBreak(70 * mm), t, Spacer(1, 6)]


def rule(text, color=TEAL, bg=TEALBG, title="Rule"):
    t = Table([[Paragraph(f"<b>{title}:</b> {text}", rulest)]], colWidths=[CW])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg),
                           ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                           ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return [t, Spacer(1, 6)]


def figure(name, caption, width=None):
    fig_no[0] += 1
    im = PILImage.open(FIGS + name)
    w = width or CW
    h = w * im.size[1] / im.size[0]
    return KeepTogether([Image(FIGS + name, width=w, height=h),
                         Paragraph(f"Figure {fig_no[0]}. {caption}", cap)])


def table(rows, widths, header=True, zebra=True, head_color=NAVY):
    data = []
    for r_i, r in enumerate(rows):
        data.append([Paragraph(str(c), cellh if (header and r_i == 0) else (cellb if c_i == 0 else cell))
                     for c_i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
          ("TOPPADDING", (0, 0), (-1, -1), 4.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
          ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]
    if header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), head_color))
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if i % 2 == 0:
                st.append(("BACKGROUND", (0, i), (-1, i), LIGHT))
    t.setStyle(TableStyle(st))
    return [t, Spacer(1, 7)]


# ------------------------------------------------------------------ page templates
def cover(c, doc):
    c.saveState()
    c.setFillColor(NAVY)
    c.rect(0, H * 0.38, W, H * 0.62, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(0, H * 0.38 - 3, W, 3, stroke=0, fill=1)
    # SORK tiles
    cols = [NAVY, TEAL, GOLD, PURPLE]
    letters = "SORK"
    names = ["Market Structure", "Order Flow", "Reclamation", "Key Level"]
    tile = 34 * mm
    gap = 5 * mm
    total = 4 * tile + 3 * gap
    x0 = (W - total) / 2
    y0 = H * 0.38 + 26 * mm
    for i in range(4):
        x = x0 + i * (tile + gap)
        c.setFillColor(colors.white)
        c.roundRect(x, y0 + 0 * mm, tile, 44 * mm, 3 * mm, stroke=0, fill=1)
        c.setFillColor(cols[i] if i else colors.HexColor("#1D3C5E"))
        c.roundRect(x + 2.5 * mm, y0 + 2.5 * mm, tile - 5 * mm, 39 * mm, 2 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 44)
        c.drawCentredString(x + tile / 2, y0 + 17 * mm, letters[i])
        c.setFont("Helvetica", 8.2)
        c.drawCentredString(x + tile / 2, y0 + 8 * mm, names[i])
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 30)
    c.drawCentredString(W / 2, H * 0.38 + 14 * mm, "SORK Trading Concept")
    c.setFont("Helvetica", 14)
    c.setFillColor(colors.HexColor("#D6E2EE"))
    c.drawCentredString(W / 2, H * 0.38 + 5 * mm, "Study Guide with illustrations")
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, H * 0.38 - 20 * mm, "A forex trading concept by black jeff")
    c.setFont("Helvetica", 9.5)
    c.setFillColor(GREY)
    c.drawCentredString(W / 2, H * 0.38 - 30 * mm, "Market Structure  |  Order Flow  |  Reclamation  |  Key Level")
    c.drawCentredString(W / 2, 22 * mm, "Compiled from project status v0.50 (2026-11-05)")
    c.drawCentredString(W / 2, 17 * mm, "All charts are drawn examples to explain the rules, not real market data.")
    c.restoreState()


def later(c, doc):
    c.saveState()
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(LM, 12.5 * mm, W - RM, 12.5 * mm)
    c.setFont("Helvetica", 8)
    c.setFillColor(GREY)
    c.drawString(LM, 8 * mm, "SORK Trading Concept - Study Guide")
    c.drawRightString(W - RM, 8 * mm, f"Page {doc.page}")
    c.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=LM, rightMargin=RM, topMargin=TM, bottomMargin=BM,
                      title="SORK Trading Concept - Study Guide", author="black jeff",
                      subject="Forex trading concept study guide")
frame = Frame(LM, BM, CW, H - TM - BM, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="cover", frames=[Frame(LM, BM, CW, H - TM - BM, id="c0")], onPage=cover),
                      PageTemplate(id="main", frames=[frame], onPage=later)])
from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate("main"))
story.append(PageBreak())

# ------------------------------------------------------------------ 1. overview
story += simple_banner("1. The SORK framework at a glance")
story.append(P("SORK is a forex trading concept built on four pillars. Each pillar answers one question, and each "
               "is read on its own timeframe. Work through them in order: the trend first, then the points of "
               "interest, then the confirmation, and finally the key level where the trade is entered."))
story.append(figure("f01_overview.png", "The four pillars of SORK, the timeframe each one is read on, and what each one does."))
story += table([
    ["Pillar", "Timeframe", "Question it answers", "What it gives you"],
    ["S: Market Structure", "H4", "Which way is the market going?", "A valid trend, found through its most valid break of structure"],
    ["O: Order Flow", "H1", "Where are the points of interest?", "Inducement and disruption, drawn as POI boxes on their order blocks"],
    ["R: Reclamation", "H1", "Is price confirming at the POI?", "A confirmation (never an entry on its own)"],
    ["K: Key Level", "H1 to find, M5 to enter", "Where do I enter, and where do I get out?", "Entry, stop loss, take profit, and the QML for reversals"],
], [34 * mm, 28 * mm, 48 * mm, CW - 110 * mm])
story.append(P("Timeframe cheat sheet", h2))
story += table([
    ["What you are doing", "Timeframe"],
    ["Finding the trend direction (market structure)", "H4 only. H1 is not used to find the trend direction."],
    ["Marking inducement, disruption and their POIs; judging if they are invalidated", "H1"],
    ["Finding a key level and judging whether it is valid", "H1"],
    ["Checking for a QML (and its confirmation)", "H1. The entry is on M5."],
    ["Reclamation at the inducement and disruption POIs, and judging whether a reclamation is invalid", "H1"],
    ["Entry confirmations (move out of the POI, engulf, harami)", "M5, inside the POI box"],
    ["Invalidating a key level (a body closing outside its POI)", "M5"],
    ["Bjeff zone", "An M5 key level inside the 50% of an H1 key level"],
], [CW * 0.58, CW * 0.42])

# ------------------------------------------------------------------ 2. S
story += banner("S", "Market Structure", "Timeframe: H4", NAVY)
story.append(P("Market structure tells you the direction of the market, which is also called the <b>market bias</b>. "
               "The trend direction comes from H4 only. The trend is identified through the <b>most valid break "
               "of structure (BOS)</b> on H4. That H4 trend is then used to set the inducement and disruption on H1; "
               "H1 is used for order flow, not for trend direction. A BOS is the same on every timeframe."))
story.append(P("Reading the trend", h2))
story += B(["<b>Uptrend:</b> the market creates higher highs (HH) and higher lows (HL).",
            "<b>Downtrend:</b> the market creates lower lows (LL) and lower highs (LH)."])
story.append(P("Making a trend valid", h2))
story.append(P("A trend is only valid when it has both liquidity and a break of structure."))
story += B(["<b>Liquidity (LQ):</b> an opposite-colored candle within the trend. In an uptrend bullish green candles dominate, "
            "so the LQ is a bearish red candle. In a downtrend the LQ is a bullish candle.",
            "<b>Break of structure (BOS):</b> a new HH in an uptrend, or a new LL in a downtrend.",
            "<b>Structural liquidity (SLQ):</b> liquidity that sits within a valid market structure."])
story += rule("Market structure is valid when the LQ and the BOS are both present. Otherwise it is not valid. "
              "The most valid BOS is the one that meets these rules.")
story.append(figure("f03_liquidity.png",
                    "Left: a valid structure has an LQ (the red candle) and a BOS above the old high. "
                    "Right: the exception, where two or more BOS form with no SLQ between them."))
story.append(P("Exception: BOS without SLQ", h2))
story.append(P("If there is a BOS but no SLQ, and two or more BOS have formed without SLQ, those BOS can be treated as the "
               "liquidity. How close together they are does not matter. This second type of BOS also makes the "
               "market structure valid."))
story.append(P("Where the SLQ must sit", h2))
story += B(["An <b>uptrend</b> (HH and HL) mostly forms a <b>V shape</b>. The SLQ has to be on the right side of the V, "
            "and not above the previous HH.",
            "A <b>downtrend</b> (LL and LH) mostly forms a capital <b>A shape</b>. Everything is reversed: the SLQ has "
            "to be on the right side of the A, and not below the previous LL."])
story.append(figure("f02_structure.png",
                    "The V shape of an uptrend and the A shape of a downtrend (teal line). The SLQ sits on the right "
                    "side of the shape, not above the previous HH and not below the previous LL. The red dashed lines mark each BOS."))

# ------------------------------------------------------------------ 3. O
story += banner("O", "Order Flow", "Timeframe: H1", TEAL)
story.append(P("Order flow looks for <b>inducement</b>, <b>disruption</b> and <b>points of liquidity</b>. All breaks of structure "
               "are liquidity zones. Inducement and disruption are the special ones that order flow focuses on. "
               "The H4 trend sets the direction, and these are marked on H1."))
story += B(["<b>Inducement:</b> the latest BOS in a trend.",
            "<b>Disruption:</b> the BOS immediately before the inducement.",
            "<b>Point of liquidity:</b> any BOS that is not the inducement or the disruption."])
story.append(P("Marking them", h2))
story.append(P("Draw a horizontal line on the chart for each one. That place is marked as the <b>point of interest (POI)</b>."))
story += B(["<b>Uptrend:</b> directly on the tip of the highest low of the BOS (the tip of the V shape).",
            "<b>Downtrend:</b> on the top tip of the lower high of the BOS (above the A shape)."])
story.append(figure("f04_orderflow.png",
                    "An uptrend with three BOS. The latest is the inducement, the one before it is the disruption, "
                    "and the older one is a point of liquidity. Each line sits on the V tip of its BOS."))
story.append(P("Order block (OB)", h2))
story += B(["<b>Uptrend:</b> the last bearish candle before the bullish move starts.",
            "<b>Downtrend:</b> the last bullish candle right before the downtrend starts."])
story.append(P("Drawing the POI", h2))
story.append(P("The POI is drawn on the order block from <b>wick to body</b> (not wick to wick), as a horizontal box that extends "
               "beyond the right side of the chart. The box covers the order block candle only. It does not cover the "
               "other wick, and it does not extend to the candle after it."))
story += B(["<b>Uptrend:</b> from the bottom wick of the order block to the top of its body.",
            "<b>Downtrend:</b> from the upper wick of the order block to the bottom of its body."])
story.append(figure("f05_ob.png",
                    "The order block and its POI. Bullish scenario: last bearish candle, box from its bottom wick to the top of its body. "
                    "Bearish scenario: last bullish candle, box from its upper wick to the bottom of its body."))
story.append(P("POI for inducement, disruption and points of liquidity", h2))
story.append(P("Every inducement, disruption or point of liquidity has an order block. Its POI is drawn the same way as the order "
               "block POI above, with one change: it is drawn <b>from candle body to body</b>, so the wicks are left out."))
story += rule("If the body of the order block candle is longer than average (judged by eye), only 50% of the body is used for the POI. "
              "Bearish scenario (downtrend): the top 50% of the body. Bullish scenario (uptrend): the bottom 50% of the body.")
story.append(figure("f06_body.png",
                    "Body-to-body POIs. A normal body is used whole. When the body is longer than average, only 50% is used: "
                    "the bottom half for a bullish scenario, the top half for a bearish one."))
story.append(P("When inducement and disruption become invalid", h2))
story.append(P("Invalidation of order flow is judged on H1."))
story += B(["<b>Bullish disruption:</b> if a candle body closes below its POI, the disruption is invalidated together with its inducement. "
            "The trend has ended and changed direction, and a new inducement and disruption are mapped in the current trend.",
            "<b>Bearish disruption:</b> the inverse. A candle body closing above its POI invalidates it together with its inducement."])
story.append(P("Reclamation behavior and the disruption POI are two different things, so the H1 steps of a reclamation do not conflict with this rule.", small))

# ------------------------------------------------------------------ 4. R
story += banner("R", "Reclamation", "Timeframe: H1", GOLD)
story.append(P("POIs are drawn so they can be used for various things. One of them is waiting for a reclamation. A reclamation "
               "happens from the POI of an inducement, a disruption, or any POI of a liquidity zone, and it is detected on H1."))
story.append(P("The five steps", h2))
story += table([
    ["Step", "Bullish reclamation (uptrend)", "Bearish reclamation (downtrend)"],
    ["1", "Price comes down into the POI.", "Price goes up into the POI."],
    ["2", "Price breaks below the POI with the body of a candle.", "Price breaks above the POI with the body of a candle."],
    ["3", "Price comes back up into the POI and breaks above it with the body of a candle.", "Price comes back down into the POI and breaks below it with the body of a candle."],
    ["4", "Price comes back down into the POI without breaking it with a body.", "Price goes back up into the POI without breaking it with a body."],
    ["5", "Price goes all the way up out of the POI, in the direction of the uptrend.", "Price goes all the way down out of the POI, in the direction of the downtrend."],
], [14 * mm, (CW - 14 * mm) / 2, (CW - 14 * mm) / 2], head_color=GOLD)
story.append(figure("f07_reclamation.png",
                    "The numbered steps of a bullish reclamation (left) and its exact inverse, the bearish reclamation (right). "
                    "That specific movement is the reclamation."))
story.append(P("Definitions", h2))
story += B(["<b>A break:</b> a candle body has to close beyond the far edge of the POI box (below the bottom edge for bullish, above the top "
            "edge for bearish). Wicks poking past the edge do not count.",
            "<b>Going all the way out:</b> price goes past the edge of the POI box in the trend direction (past the top edge in an uptrend, "
            "past the bottom edge in a downtrend).",
            "<b>Direction rule:</b> the last step of a reclamation must match the trend of its inducement or disruption."])
story.append(P("Confirmation, not entry", h2))
story += rule("A reclamation is not used as an entry, only as a confirmation. We only use key levels for entry.", color=GOLD, bg=GOLDBG)
story.append(P("<b>Invalid reclamation:</b> invalidation of a reclamation is judged on H1. If any of the reclamation steps is not complete, the "
               "reclamation is invalid. The market then has to go through a valid reclamation before it counts as a confirmation."))
story.append(P("Trading without a reclamation", h2))
story.append(P("If you are trading from order flow without a reclamation, do not enter from the first key level. Use the second key level "
               "as the confirmation. The second key level is the one you enter from, and it does not have to form inside the inducement "
               "or disruption POI. This type of trading is not advisable, but sometimes a person just wants to trade without waiting for a reclamation."))

# ------------------------------------------------------------------ 5. K
story += banner("K", "Key Level", "Found on H1, entered on M5", PURPLE)
story.append(P("A <b>key level</b> is two opposite candle bodies that sit right next to each other. In a <b>resistant key level</b> the "
               "<b>tops</b> of the two bodies must be at the same height, or almost the same; the bottoms can be any length. In a <b>support key level</b> "
               "the <b>bottoms</b> of the two bodies must be at the same height, or almost the same; the tops can be any length. RBS follows the same logic "
               "as the resistant key level, and SBR follows the same logic as the support key level. Key levels are found on H1 and their validity is judged on H1. The direction of the market "
               "is called market bias, so resistant, support, RBS and SBR are all <b>directional bias key levels</b>."))
story.append(P("The four types", h2))
story += table([
    ["Type", "How it forms", "Valid when"],
    ["Resistant key level (RKL)", "A bullish candle first forms the key level.", "It later becomes RBS."],
    ["Support key level (SKL)", "A bearish candle first forms the key level.", "It later becomes SBR."],
    ["Resistant becomes support (RBS)", "A resistant key level that has another bullish body candle closing above its longest wick.", "Valid. Look for buys."],
    ["Support becomes resistant (SBR)", "A support key level that has another bearish candle body closing below its longest wick.", "Valid. Look for sells."],
], [48 * mm, 80 * mm, CW - 128 * mm], head_color=PURPLE)
story.append(figure("f08_kl_types.png",
                    "A resistant key level (bullish candle first, the tops of the bodies are equal, the bottoms can differ) and a support key level (bearish candle first, the bottoms of the bodies are equal, the tops can differ)."))
story.append(figure("f09_rbs.png",
                    "RBS and SBR. The dotted line is the longest wick of the key level; a body closing beyond it turns the key level into RBS or SBR. "
                    "The POI box runs from the key level to that candle and then extends to the right."))
story.append(P("What each one is used for", h2))
story += B(["At a resistant key level, look for sell opportunities, at the stage before it becomes RBS.",
            "At a support key level, look for buy opportunities, at the stage before it becomes SBR.",
            "At RBS, look for buy trades. At SBR, look for sell trades."])
story.append(P("Drawing the POI of a valid key level", h2))
story.append(P("Draw the POI box the same way as for a reclamation: from the top to the bottom of the two bodies that form the key level. The box starts at the left edge of the first (left) candle that formed the key level. "
               "For an RBS or SBR the box extends from the key level to the candle that closed to make it valid, and then extends "
               "horizontally to the right."))
story.append(P("High and low probability setups", h2))
story += rule("A low probability setup has too many wicks inside its POI, in between the key level and its BOS, and it is not traded. "
              "A high probability key level has no more than 2 wicks inside the POI in between the key level and its BOS. "
              "The wick rule applies to all types of key level POI.")
story.append(figure("f10_wicks.png",
                    "Counting the wicks that poke into the POI between the key level and its BOS. Two wicks is fine; four is too many."))

story.append(P("Entering a trade", h2))
story.append(P("Before entering a trade, wait for price to pull back into the POI box of the key level on M5."))
story += B(["<b>RBS (buy):</b> once price has pulled back down into the POI box, enter a buy when it moves out of the POI from the top of the box.",
            "<b>SBR (sell):</b> the inverse. Once price has pulled back up into the POI box, enter a sell when it moves out of the POI from the bottom of the box.",
            "<b>Engulf candle:</b> an engulf candle inside the POI box can also be used as the confirmation.",
            "<b>Harami candle:</b> a harami candle is also one of the entry confirmations on M5.",
            "<b>All confirmations must be inside the POI box on M5.</b>",
            "<b>Limit order:</b> an alternative way to enter that works together with the M5 confirmations. RBS uses a buy limit at the upper horizontal "
            "line (top edge) of the POI box. SBR uses a sell limit at the lower edge of the box."])
story.append(P("Stop loss, take profit and closing the trade", h2))
story += B(["<b>Stop loss (SL):</b> slightly outside the POI, in the opposite direction of the trade. For RBS slightly below the POI, for SBR slightly above it.",
            "<b>Take profit (TP):</b> set using a risk reward ratio (RR). Everyone decides this for themselves; some use 1:2, 1:3, 1:4, and so on.",
            "<b>Close the trade</b> when a key level fails while you are inside it, or when the trade reaches its TP or its SL."])
story.append(figure("f11_trade.png",
                    "An RBS trade on M5: price pulls back into the POI, an engulf candle forms inside it, and price moves out of the top. "
                    "The buy limit sits at the top edge, the SL slightly below the box, and the TP is set with the chosen risk reward ratio (1:2 shown).",
                    width=CW * 0.92))
story.append(P("When a key level is invalid", h2))
story += rule("A candle body closing outside the POI on M5 invalidates the POI box and the key level. In practice this is price pulling back out of "
              "the POI with a body candle: below the box for RBS, above the box for SBR.", color=PURPLE, bg=colors.HexColor("#F3ECF7"))
story.append(P("<b>Series of key levels:</b> key levels can form one after another. Use the most current key level. When the current key level becomes "
               "invalid because of its POI, all the other key levels become invalid as well."))

# ------------------------------------------------------------------ 6. QML
story += simple_banner("QML: the inverse key level (Quasimodo Level)", PURPLE)
story.append(P("QML means <b>Quasimodo Level</b>. It is used for market reversal: it is how to trade after a directional key level has been taken out "
               "or invalidated, in the reverse direction. It is checked for on H1; all confirmation is on H1 and the entry is on M5, just like a normal key level."))
story.append(P("Drawing the QML POI", h2))
story += table([
    ["After an invalidated", "Bottom of the new POI", "Top of the new POI", "Entry"],
    ["Buy key level (RBS)", "The top of the invalidated POI", "The highest point price went to before it started coming down",
     "Price goes up into the QML POI and then sells off in a downtrend (a sell)."],
    ["Sell key level (SBR)", "The lowest point price went to before it started going up", "The bottom of the invalidated POI",
     "Price goes down into the QML POI and then rallies in an uptrend (a buy)."],
], [32 * mm, 40 * mm, 46 * mm, CW - 118 * mm], head_color=PURPLE)
story.append(P("For the SBR case the box is the exact mirror: the bottom of the invalidated POI becomes the top of the new POI.", small))
story.append(figure("f12_qml.png",
                    "QML after an invalidated RBS. A body closes below the RBS POI. The top of that POI becomes the bottom of the QML POI, and the highest point (at a point of liquidity) becomes its top. "
                    "Price comes up into the QML POI and sells off.", width=CW * 0.95))
story.append(P("Things to watch out for", h2))
story += rule("A QML must be traded where the reversal happened at a point of liquidity, or close to a point of liquidity. "
              "Points of liquidity are looked for in the last 2 months of H1 candles.", color=PURPLE, bg=colors.HexColor("#F3ECF7"))
story += B(["<b>QML plus inverse:</b> if a directional key level has failed, the QML is how to enter in the inverse direction. After that, every other key "
            "level can be traded in the inverse direction.",
            "<b>Stop loss and take profit</b> stay the same as for directional key levels: the SL slightly outside the POI, the TP set with a risk reward ratio.",
            "The wick rule applies to QML POIs too."])

# ------------------------------------------------------------------ 7. advanced
story += simple_banner("Advanced key level and the black jeff zone", NAVY)
story.append(P("Advanced key level", h2))
story += N(["On the H1 key level, mark out <b>100%</b> of the key level. The 100% is the full POI box, from the top to the bottom of the two bodies.",
            "Allow the market to retrace and come back into <b>50%</b> of the key level. The 50% is the middle of that box.",
            "Take the trade on M5 by looking for candle reversal patterns (engulf, harami and others) as the entry confirmation, inside the key level POI or outside it."])
story.append(P("For the advanced key level the confirmation can be inside or outside the POI. This differs from the standard key level, where every M5 confirmation "
               "has to be inside the POI box. The stop loss and take profit stay the same.", small))
story.append(P("Black jeff zone (bjeff zone)", h2))
story.append(P("On H1, mark the 100% of the key level POI, then use the fibonacci retracement to find the 50% of the POI and draw the new POI. "
               "The new 50% POI is the half that price enters second: the <b>bottom half for RBS</b> and the <b>top half for SBR</b>. "
               "Inside it there is a <b>bjeff zone</b>, which is an M5 key level within the 50% of an H1 key level."))
story += B(["Wait for price to get into the bjeff zone.",
            "Then wait for any confirmation entry to place a trade.",
            "Find a bjeff zone key level and trade from there if a body candle closes inside it.",
            "All stop loss and take profit rules stay the same, and the bjeff zone is invalidated the same way as a normal key level."])
story.append(figure("f13_bjeff.png",
                    "The bjeff zone for an RBS: the H1 key level POI (100%), the fibonacci 50% line, the new 50% POI (bottom half) and the M5 key level inside it.",
                    width=CW * 0.95))

# ------------------------------------------------------------------ 8. checklist
story += simple_banner("Trade checklist", TEAL)
story += N(["<b>H4, trend:</b> find the trend through its most valid BOS. Liquidity and a BOS must both be present, with the SLQ on the right side of the V or A.",
            "<b>H1, order flow:</b> mark the inducement and disruption and draw their POIs (body to body). Check they are not invalidated by an H1 body close beyond the disruption POI.",
            "<b>H1, key level:</b> find a key level and wait for it to become RBS or SBR so it is valid. Count the wicks inside its POI: no more than 2.",
            "<b>Draw the POI</b> from the top to the bottom of the two bodies, and extend it to the right.",
            "<b>H1, check for a reclamation</b> at the inducement or disruption POI. A valid reclamation adds confirmation. <b>M5, wait for the pullback</b> into the key level POI box.",
            "<b>M5, confirm inside the POI box:</b> price moving out of the box, an engulf candle or a harami candle. A buy or sell limit at the box edge is the alternative entry.",
            "<b>Set the SL</b> slightly outside the POI and the <b>TP</b> with your risk reward ratio.",
            "<b>Close the trade</b> if a key level fails (a body closing outside the POI on M5), or when the TP or SL is hit.",
            "<b>If the directional key level fails,</b> look for the QML at the H1 swing high or low and trade in the inverse direction."])
story.append(P("Glossary", h2))
story += table([
    ["Term", "Meaning"],
    ["LQ", "Liquidity: an opposite-colored candle within the trend."],
    ["BOS", "Break of structure: a new HH in an uptrend or a new LL in a downtrend."],
    ["SLQ", "Structural liquidity: liquidity that sits within a valid market structure."],
    ["Inducement", "The latest BOS in a trend."],
    ["Disruption", "The BOS immediately before the inducement."],
    ["Point of liquidity", "Any BOS that is not the inducement or the disruption."],
    ["OB", "Order block: the last opposite candle before the move starts."],
    ["POI", "Point of interest: the box drawn on an order block, key level or QML."],
    ["Market bias", "The direction of the market."],
    ["KL", "Key level: two adjacent opposite candle bodies. Resistant: equal or almost equal tops. Support: equal or almost equal bottoms."],
    ["RKL / SKL", "Resistant key level / support key level."],
    ["RBS / SBR", "Resistant becomes support / support becomes resistant."],
    ["QML", "Quasimodo Level: the inverse key level used for market reversal."],
    ["Bjeff zone", "An M5 key level within the 50% of an H1 key level."],
], [34 * mm, CW - 34 * mm])
story += rule("The concept above is defined. Still to be set outside the concept itself: target pairs, performance targets, risk per trade and risk limits.",
              color=GREY, bg=LIGHT, title="Not covered yet")

doc.build(story)
print("built", OUT)
