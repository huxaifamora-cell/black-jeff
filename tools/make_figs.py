import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyBboxPatch, FancyArrowPatch, Polygon

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "fig")
os.makedirs(OUT, exist_ok=True)

GREEN = "#1E9E6A"
RED = "#D8454B"
NAVY = "#12263F"
TEAL = "#1B7F8C"
GOLD = "#C8962E"
BLUE_F = "#8EC5FF"
BLUE_E = "#2F7BBF"
GREY = "#6B7785"
LIGHT = "#EEF2F6"

plt.rcParams["font.family"] = "DejaVu Sans"


def candles(ax, data, x0=0, w=0.55):
    for i, (o, h, l, c) in enumerate(data):
        x = x0 + i
        col = GREEN if c >= o else RED
        ax.plot([x, x], [l, h], color=col, lw=1.6, solid_capstyle="round", zorder=3)
        ax.add_patch(Rectangle((x - w / 2, min(o, c)), w, max(abs(c - o), 0.08),
                               facecolor=col, edgecolor=col, zorder=4))


def mirror(data, k):
    return [(k - o, k - l, k - h, k - c) for (o, h, l, c) in data]


def box(ax, x0, x1, y0, y1, fc=BLUE_F, ec=BLUE_E, alpha=0.33, ls="-", lw=1.2, z=1):
    ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, facecolor=fc, edgecolor="none",
                           alpha=alpha, zorder=z))
    ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, facecolor="none", edgecolor=ec,
                           linestyle=ls, linewidth=lw, zorder=z + 0.1))


def hline(ax, y, x0, x1, color=GREY, ls="--", lw=1.1, z=2):
    ax.plot([x0, x1], [y, y], color=color, linestyle=ls, linewidth=lw, zorder=z)


def txt(ax, x, y, s, color=NAVY, ha="left", va="center", fs=8, bold=False, bg=False, z=10):
    kw = dict(color=color, ha=ha, va=va, fontsize=fs, zorder=z,
              fontweight="bold" if bold else "normal")
    if bg:
        kw["bbox"] = dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.85)
    ax.text(x, y, s, **kw)


def num(ax, x, y, n, color=NAVY):
    ax.text(x, y, str(n), ha="center", va="center", fontsize=8, color="white",
            fontweight="bold", zorder=12,
            bbox=dict(boxstyle="circle,pad=0.28", fc=color, ec="none"))


def arrow(ax, p0, p1, color=GREY, lw=1.4, style="-|>", ls="-", rad=0.0):
    ax.add_patch(FancyArrowPatch(p0, p1, arrowstyle=style, mutation_scale=11, color=color,
                                 linewidth=lw, linestyle=ls, zorder=9,
                                 connectionstyle=f"arc3,rad={rad}"))


def setup(ax, xlim, ylim, title=None):
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.axis("off")
    if title:
        ax.set_title(title, fontsize=10, fontweight="bold", color=NAVY, loc="left", pad=6)


def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------- fig 1
def fig_overview():
    fig, ax = plt.subplots(figsize=(6.9, 2.7))
    setup(ax, (0, 100), (0, 40))
    cards = [
        ("S", "Market Structure", "H4", "Find the trend through its\nmost valid break of structure\n(liquidity + BOS)", NAVY),
        ("O", "Order Flow", "H1", "Mark inducement and\ndisruption, draw their POIs\n(order block boxes)", TEAL),
        ("R", "Reclamation", "M5", "A specific move at the POI\nused as a confirmation\n(not as an entry)", GOLD),
        ("K", "Key Level", "H1 / M5", "Find the key level on H1,\nenter on M5, then SL and TP\n(RBS, SBR, QML)", "#7A3E9D"),
    ]
    w, gap = 22, 4
    for i, (letter, name, tf, desc, col) in enumerate(cards):
        x = 2 + i * (w + gap)
        ax.add_patch(FancyBboxPatch((x, 3), w, 34, boxstyle="round,pad=0.4,rounding_size=2",
                                    fc="white", ec=col, lw=1.8))
        ax.add_patch(FancyBboxPatch((x, 27), w, 10, boxstyle="round,pad=0.4,rounding_size=2",
                                    fc=col, ec=col, lw=1.8))
        ax.text(x + 3, 32, letter, color="white", fontsize=22, fontweight="bold", va="center")
        ax.text(x + 8.2, 33.6, name, color="white", fontsize=8.6, fontweight="bold", va="center")
        ax.text(x + 8.2, 29.7, "Timeframe: " + tf, color="white", fontsize=7.6, va="center")
        ax.text(x + w / 2, 15, desc, color=NAVY, fontsize=7.5, ha="center", va="center",
                linespacing=1.5)
        if i < 3:
            arrow(ax, (x + w + 0.8, 20), (x + w + gap - 0.6, 20), color=GREY, lw=1.6)
    save(fig, "f01_overview.png")


# ---------------------------------------------------------------- fig 2
def fig_structure():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.2))
    pts = [(0, 100), (1, 110), (2, 104), (3, 118), (4, 111), (5, 124)]
    for ax, mir in zip(axes, (False, True)):
        T = (lambda y: 218 - y) if mir else (lambda y: y)
        setup(ax, (-0.5, 6.4), (94, 128) if not mir else (92, 126),
              "Uptrend: HH and HL (V shape)" if not mir else "Downtrend: LL and LH (A shape)")
        xs = [p[0] for p in pts]
        ys = [T(p[1]) for p in pts]
        ax.plot(xs, ys, color=GREY, lw=1.6, zorder=3)
        # V / A highlight
        vx = [1, 2, 3]
        vy = [T(110), T(104), T(118)]
        ax.plot(vx, vy, color=TEAL, lw=3.2, zorder=4, solid_capstyle="round")
        labels_up = {1: "H", 2: "HL", 3: "HH", 4: "HL", 5: "HH"}
        labels_dn = {1: "L", 2: "LH", 3: "LL", 4: "LH", 5: "LL"}
        labs = labels_dn if mir else labels_up
        for (x, y0) in pts[1:]:
            y = T(y0)
            is_high_orig = (x % 2 == 1)
            above = is_high_orig != mir
            ax.plot([x], [y], "o", color=NAVY, ms=4.5, zorder=6)
            txt(ax, x, y + (2.0 if above else -2.0), labs[x], ha="center", fs=8, bold=True)
        # BOS lines
        for (xa, xb, yb) in ((1, 3, 110), (3, 5, 118)):
            hline(ax, T(yb), xa, xb + 0.15, color=RED)
            txt(ax, xb + 0.2, T(yb) + (0.0), "BOS", color=RED, fs=7.5, bold=True)
        # SLQ marker on the right side of the V / A
        sx, sy = 2.5, T(108.5)
        col = RED if not mir else GREEN
        ax.add_patch(Rectangle((sx - 0.11, sy - 1.1), 0.22, 2.2, fc=col, ec=col, zorder=7))
        ax.plot([sx, sx], [sy - 2.0, sy + 2.0], color=col, lw=1.2, zorder=6)
        if not mir:
            txt(ax, 2.72, 106.0, "SLQ", color=col, fs=7.5, bold=True)
            txt(ax, 0.0, 124.5, "V: HH > HL > HH", color=TEAL, fs=7.5, bold=True)
            txt(ax, 0.0, 121.8, "SLQ sits on the right side of the V,", color=GREY, fs=7)
            txt(ax, 0.0, 119.6, "not above the previous HH", color=GREY, fs=7)
        else:
            txt(ax, 2.72, 109.8, "SLQ", color=col, fs=7.5, bold=True)
            txt(ax, 0.0, 95.5, "A: LL > LH > LL", color=TEAL, fs=7.5, bold=True)
            txt(ax, 0.0, 98.3, "SLQ sits on the right side of the A,", color=GREY, fs=7)
            txt(ax, 0.0, 100.5, "not below the previous LL", color=GREY, fs=7)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f02_structure.png")


# ---------------------------------------------------------------- fig 3
def fig_liquidity():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.9))
    ax = axes[0]
    setup(ax, (-0.7, 7.3), (96, 117), "Valid: liquidity (LQ) + break of structure (BOS)")
    d = [(100, 104, 99, 103), (103, 107, 102, 106), (106, 110, 105, 109),
         (109, 109.5, 105.5, 106), (106, 108, 105, 107.5), (107.5, 112.5, 107, 112)]
    candles(ax, d)
    hline(ax, 110, 2, 5.6, color=RED)
    txt(ax, 5.75, 110, "BOS", color=RED, bold=True)
    ax.annotate("LQ", xy=(3, 105.3), xytext=(3, 100.2), ha="center", color=RED, fontsize=8,
                fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.2))
    txt(ax, -0.5, 115.2, "A red candle inside the green run is the LQ.", color=GREY, fs=7)
    txt(ax, -0.5, 113.4, "A new HH above the old high is the BOS.", color=GREY, fs=7)
    ax = axes[1]
    setup(ax, (-0.7, 7.3), (96, 117), "Exception: 2 or more BOS and no SLQ")
    d = [(100, 103, 99.5, 102.5), (102.5, 106, 102, 105.5), (105.5, 109, 105, 108.5),
         (108.5, 112.5, 108, 112)]
    candles(ax, d)
    for x, y in ((1, 103), (2, 106), (3, 109)):
        hline(ax, y, x - 1, x + 0.5, color=RED)
    for i, (x, y) in enumerate(((1, 106), (2, 109), (3, 112.5))):
        txt(ax, x, y + 1.6, "BOS", color=RED, ha="center", fs=7.5, bold=True)
    txt(ax, -0.5, 115.2, "No red candle between them, so no SLQ.", color=GREY, fs=7)
    txt(ax, -0.5, 113.4, "The BOS themselves act as the liquidity.", color=GREY, fs=7)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f03_liquidity.png")


# ---------------------------------------------------------------- fig 4
def fig_orderflow():
    fig, ax = plt.subplots(figsize=(6.9, 3.5))
    setup(ax, (-0.4, 11.2), (96, 134))
    pts = [(0, 100), (1, 110), (2, 104), (3, 116), (4, 109), (5, 122), (6, 115), (7, 128)]
    ax.plot([p[0] for p in pts], [p[1] for p in pts], color=GREY, lw=1.8, zorder=3)
    for x, y in pts:
        ax.plot([x], [y], "o", color=NAVY, ms=4, zorder=6)
    # V tips -> horizontal lines
    lines = [(2, 104, "Point of liquidity line", GREY), (4, 109, "Disruption line", TEAL),
             (6, 115, "Inducement line", GOLD)]
    for x, y, lab, col in lines:
        hline(ax, y, x, 10.4, color=col, ls="-", lw=1.6)
        txt(ax, 10.5, y, lab, color=col, fs=7.6, bold=True)
        ax.plot([x], [y], "o", color=col, ms=7, zorder=7)
    # BOS tags
    tags = [(3, 116, "BOS 1\npoint of liquidity", GREY), (5, 122, "BOS 2\ndisruption", TEAL),
            (7, 128, "BOS 3 (latest)\ninducement", GOLD)]
    for x, y, lab, col in tags:
        txt(ax, x, y + 3.2, lab, color=col, ha="center", fs=7.6, bold=True)
    txt(ax, 0.0, 131, "Each line sits on the V tip (the HL) of its BOS and extends to the right.", color=GREY, fs=7.4)
    txt(ax, 0.0, 128.6, "The latest BOS is the inducement; the one before it is the disruption.", color=GREY, fs=7.4)
    save(fig, "f04_orderflow.png")


# ---------------------------------------------------------------- fig 5
def fig_ob():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.3))
    ax = axes[0]
    setup(ax, (-0.8, 9.2), (98, 118), "Bullish scenario (uptrend)")
    d = [(112, 113, 109, 110), (110, 111, 106, 107), (107, 108.2, 103.5, 104),
         (104, 111, 103.8, 110.5), (110.5, 115, 110, 114.5)]
    candles(ax, d)
    box(ax, 1.65, 9.0, 103.5, 107)
    txt(ax, 5.3, 105.3, "POI", color=BLUE_E, bold=True, ha="center", fs=9)
    ax.annotate("Order block:\nlast bearish candle\nbefore the rise", xy=(2, 108.6), xytext=(-0.6, 100.2),
                fontsize=7.4, color=RED, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.1), va="center")
    txt(ax, 3.2, 100.6, "Box: bottom wick to top of body", color=GREY, fs=7.2)
    txt(ax, 3.2, 99.0, "Extends to the right", color=GREY, fs=7.2)
    ax = axes[1]
    setup(ax, (-0.8, 9.2), (92, 112), "Bearish scenario (downtrend)")
    d = [(100, 103, 99, 102), (102, 106, 101.5, 105), (105, 109, 104.5, 108),
         (108, 108.5, 101, 101.5), (101.5, 102, 96, 96.5)]
    candles(ax, d)
    box(ax, 1.65, 9.0, 105, 109)
    txt(ax, 5.3, 107, "POI", color=BLUE_E, bold=True, ha="center", fs=9)
    ax.annotate("Order block:\nlast bullish candle\nbefore the drop", xy=(2, 104.0), xytext=(-0.6, 94.5),
                fontsize=7.4, color=GREEN, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color=GREEN, lw=1.1), va="center")
    txt(ax, 3.2, 111.0, "Box: upper wick to bottom of body", color=GREY, fs=7.2)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f05_ob.png")


# ---------------------------------------------------------------- fig 6
def fig_body():
    fig, axes = plt.subplots(1, 3, figsize=(6.9, 3.0))
    # a) normal body, bullish
    ax = axes[0]
    setup(ax, (-1, 5.4), (97, 115), "Normal body")
    candles(ax, [(107, 108.5, 103.5, 104)], x0=0)
    candles(ax, [(104, 111, 103.8, 110.5)], x0=1)
    box(ax, -0.4, 5.3, 104, 107)
    txt(ax, 3.4, 105.5, "POI", color=BLUE_E, bold=True, ha="center", fs=8.5)
    txt(ax, -0.9, 99.5, "Body to body:\nthe whole body is the POI", color=GREY, fs=7.2)
    # b) long body bullish scenario
    ax = axes[1]
    setup(ax, (-1, 5.4), (95, 117), "Long body, bullish")
    candles(ax, [(112, 113, 99.5, 100)], x0=0)
    candles(ax, [(100, 118, 99.8, 117)], x0=1)
    hline(ax, 106, -0.4, 5.3, color=GREY, ls=":")
    box(ax, -0.4, 5.3, 100, 106)
    txt(ax, 3.4, 103, "POI", color=BLUE_E, bold=True, ha="center", fs=8.5)
    txt(ax, -0.9, 96.5, "Bottom 50% of the body", color=GREY, fs=7.2)
    # c) long body bearish scenario
    ax = axes[2]
    setup(ax, (-1, 5.4), (91, 113), "Long body, bearish")
    candles(ax, [(100, 112, 99, 112)], x0=0)
    candles(ax, [(112, 112.5, 94, 95)], x0=1)
    hline(ax, 106, -0.4, 5.3, color=GREY, ls=":")
    box(ax, -0.4, 5.3, 106, 112)
    txt(ax, 3.4, 109, "POI", color=BLUE_E, bold=True, ha="center", fs=8.5)
    txt(ax, -0.9, 92.5, "Top 50% of the body", color=GREY, fs=7.2)
    fig.tight_layout(w_pad=1.2)
    save(fig, "f06_body.png")


# ---------------------------------------------------------------- fig 7
def fig_reclamation():
    base = [(108, 109, 106.5, 107), (107, 107.3, 102.5, 103), (103, 103.2, 98.5, 99),
            (99, 104.8, 98.8, 104.5), (104.5, 105, 102.5, 103), (103, 108, 102.8, 107.5),
            (107.5, 111, 107, 110.5)]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.6))
    for ax, mir in zip(axes, (False, True)):
        data = mirror(base, 204) if mir else base
        setup(ax, (-0.8, 8.6), (95, 114) if not mir else (94, 113),
              "Bullish reclamation (uptrend)" if not mir else "Bearish reclamation (downtrend)")
        box(ax, -0.5, 8.5, 100, 104)
        candles(ax, data)
        txt(ax, 7.9, 102, "POI", color=BLUE_E, bold=True, ha="center", fs=9)
        T = (lambda y: 204 - y) if mir else (lambda y: y)
        # step markers
        steps = [(1, T(107.3) + (1.6 if not mir else -1.6)), (2, T(98.5) + (-1.8 if not mir else 1.8)),
                 (3, T(104.8) + (1.7 if not mir else -1.7)), (4, T(102.5) + (-1.8 if not mir else 1.8)),
                 (5, T(108) + (1.8 if not mir else -1.8))]
        for n, (x, y) in zip(range(1, 6), [(1, steps[0][1]), (2, steps[1][1]), (3, steps[2][1]),
                                             (4, steps[3][1]), (5, steps[4][1])]):
            num(ax, x if n != 5 else 5, y, n, color=TEAL)
    # captions under each panel
    cap_up = ["1 down into the POI", "2 body closes below it", "3 back up, body closes above",
              "4 back into the POI, no body break", "5 out of the POI, uptrend direction"]
    cap_dn = ["1 up into the POI", "2 body closes above it", "3 back down, body closes below",
              "4 back into the POI, no body break", "5 out of the POI, downtrend direction"]
    for ax, caps, ypos in zip(axes, (cap_up, cap_dn), (97.0, 111.0)):
        pass
    axes[0].text(-0.7, 96.2, "\n".join(cap_up), fontsize=6.9, color=GREY, va="top", linespacing=1.45)
    axes[1].text(-0.7, 94.8, "\n".join(cap_dn), fontsize=6.9, color=GREY, va="top", linespacing=1.45)
    fig.tight_layout(w_pad=1.2)
    fig.subplots_adjust(bottom=0.27)
    save(fig, "f07_reclamation.png")


# ---------------------------------------------------------------- fig 8 (key level anatomy)
def fig_kl_types():
    kl = [(100, 102.6, 99.5, 102.4), (102.4, 105.5, 98.5, 99.6)]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.9))
    ax = axes[0]
    setup(ax, (-0.8, 4.6), (96, 108), "Resistant key level")
    candles(ax, kl, x0=0.5)
    hline(ax, 102.4, -0.2, 2.8, color=RED)
    txt(ax, 3.0, 102.4, "equal top\nedges", color=RED, fs=7.4, bold=True)
    txt(ax, -0.7, 107.2, "Bullish candle first, then a", color=GREY, fs=7.2)
    txt(ax, -0.7, 105.8, "bearish candle: two adjacent", color=GREY, fs=7.2)
    txt(ax, -0.7, 104.4, "bodies with equal top edges", color=GREY, fs=7.2)
    ax = axes[1]
    setup(ax, (-0.8, 4.6), (96, 108), "Support key level")
    candles(ax, mirror(kl, 204), x0=0.5)
    hline(ax, 101.6, -0.2, 2.8, color=GREEN)
    txt(ax, 3.0, 101.6, "equal bottom\nedges", color=GREEN, fs=7.4, bold=True)
    txt(ax, -0.7, 107.2, "Bearish candle first, then a", color=GREY, fs=7.2)
    txt(ax, -0.7, 105.8, "bullish candle: two adjacent", color=GREY, fs=7.2)
    txt(ax, -0.7, 104.4, "bodies with equal bottom edges", color=GREY, fs=7.2)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f08_kl_types.png")


# ---------------------------------------------------------------- fig 9 (RBS / SBR)
def fig_rbs():
    d = [(100, 102.6, 99.5, 102.4), (102.4, 105.5, 98.5, 99.5), (99.5, 100.5, 96, 97),
         (97, 100, 96.5, 99.8), (99.8, 107.5, 99.5, 107)]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.4))
    ax = axes[0]
    setup(ax, (-0.8, 7.2), (93.5, 111), "Resistant becomes support (RBS)")
    box(ax, -0.4, 7.1, 99.5, 102.4)
    candles(ax, d)
    hline(ax, 105.5, 1, 4.4, color=RED, ls=":")
    txt(ax, 4.55, 105.5, "longest wick", color=RED, fs=7.2, bold=True)
    txt(ax, 6.9, 100.95, "POI", color=BLUE_E, ha="right", bold=True, fs=8.5)
    ax.annotate("Resistant KL", xy=(0.5, 98.6), xytext=(-0.4, 94.8), fontsize=7.6, color=NAVY,
                fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.0))
    ax.annotate("A bullish body closes above\nthe longest wick = RBS", xy=(4, 107.2),
                xytext=(0.6, 109.5), fontsize=7.4, color=GREEN, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=GREEN, lw=1.1))
    ax = axes[1]
    setup(ax, (-0.8, 7.2), (93, 110.5), "Support becomes resistant (SBR)")
    m = mirror(d, 204)
    box(ax, -0.4, 7.1, 204 - 102.4, 204 - 99.5)
    candles(ax, m)
    hline(ax, 204 - 105.5, 1, 4.4, color=GREEN, ls=":")
    txt(ax, 4.55, 204 - 105.5, "longest wick", color=GREEN, fs=7.2, bold=True)
    txt(ax, 6.9, 204 - 100.95, "POI", color=BLUE_E, ha="right", bold=True, fs=8.5)
    ax.annotate("Support KL", xy=(0.5, 204 - 98.6), xytext=(-0.4, 108.5), fontsize=7.6, color=NAVY,
                fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.0))
    ax.annotate("A bearish body closes below\nthe longest wick = SBR", xy=(4, 204 - 107.2),
                xytext=(0.6, 94.5), fontsize=7.4, color=RED, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.1))
    fig.tight_layout(w_pad=1.5)
    save(fig, "f09_rbs.png")


# ---------------------------------------------------------------- fig 10 (wick rule)
def fig_wicks():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.3))
    kl = [(100, 102.6, 99.6, 102.4), (102.4, 103.2, 98.9, 99.6)]
    mids_hi = [(104, 105, 101.2, 104.8), (104.8, 105.5, 100.8, 105.2)]
    mids_lo = [(104, 105, 101.2, 104.8), (104.8, 105.4, 100.9, 105.1),
               (105.1, 105.9, 101.5, 105.6), (105.6, 106.3, 101.0, 105.9)]
    for ax, mids, bos, title, col in (
            (axes[0], mids_hi, (105.2, 111, 105, 110.5), "High probability: 2 wicks or fewer", GREEN),
            (axes[1], mids_lo, (105.9, 112, 105.5, 111.5), "Low probability: too many wicks", RED)):
        n = len(mids)
        setup(ax, (-0.8, n + 4.6), (96, 114), title)
        ax.title.set_color(col)
        box(ax, -0.4, n + 4.5, 99.5, 102.4)
        candles(ax, kl + mids + [bos])
        for i, m in enumerate(mids):
            x = 2 + i
            ax.plot([x], [m[2]], "o", color=RED, ms=5.5, zorder=8)
            num(ax, x, m[2] - 1.6, i + 1, color=RED)
        txt(ax, 0.5, 96.9, "KL", color=NAVY, ha="center", fs=7.6, bold=True)
        txt(ax, n + 2, bos[1] + 1.6, "BOS", color=NAVY, ha="center", fs=7.6, bold=True)
        txt(ax, n + 4.3, 100.95, "POI", color=BLUE_E, ha="right", bold=True, fs=8.5)
        txt(ax, -0.6, 113, f"{n} wicks inside the POI between the KL and its BOS", color=GREY, fs=7.2)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f10_wicks.png")


# ---------------------------------------------------------------- fig 11 (trade setup)
def fig_trade():
    fig, ax = plt.subplots(figsize=(6.9, 3.9))
    setup(ax, (-0.8, 12.2), (95, 112.5))
    box(ax, -0.5, 8.4, 99.5, 102.4)
    d = [(106, 106.5, 104, 104.5), (104.5, 104.8, 101.5, 102), (102, 102.2, 100.2, 100.6),
         (100.6, 102.3, 100.3, 102.1), (102.1, 105, 102, 104.8), (104.8, 108, 104.5, 107.5),
         (107.5, 110, 107, 109.8)]
    candles(ax, d)
    hline(ax, 102.4, -0.5, 8.4, color=GOLD, ls="--", lw=1.4)
    hline(ax, 99.2, -0.5, 8.4, color=RED, ls="--", lw=1.4)
    hline(ax, 108.8, -0.5, 8.4, color=GREEN, ls="--", lw=1.4)
    txt(ax, 8.6, 108.8, "TP (1:2 example)", color=GREEN, fs=7.8, bold=True)
    txt(ax, 8.6, 102.4, "Buy limit at the top edge", color=GOLD, fs=7.8, bold=True)
    txt(ax, 8.6, 99.2, "SL slightly below the POI", color=RED, fs=7.8, bold=True)
    txt(ax, 8.6, 100.95, "POI (RBS)", color=BLUE_E, fs=7.8, bold=True)
    ax.annotate("Price pulls back into\nthe POI on M5", xy=(1, 103.5), xytext=(0.2, 110),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    ax.annotate("Engulf candle inside the POI\n= M5 confirmation", xy=(3, 100.1), xytext=(2.0, 96.4),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    ax.annotate("Price moves out of the\ntop of the POI", xy=(4, 105.2), xytext=(3.5, 109.6),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    save(fig, "f11_trade.png")


# ---------------------------------------------------------------- fig 12 (QML)
def fig_qml():
    fig, ax = plt.subplots(figsize=(6.9, 4.2))
    setup(ax, (-1, 14.6), (92, 117))
    d = [(100, 102.6, 99.6, 102.4), (102.4, 105.5, 98.5, 99.5), (99.5, 100.5, 96, 97),
         (97, 100, 96.5, 99.8), (99.8, 107.5, 99.5, 107), (107, 112, 106.5, 111),
         (111, 111.5, 104, 104.8), (104.8, 105, 98, 98.6), (98.6, 103.5, 98.2, 103),
         (103, 106.2, 102.6, 103.3), (103.3, 103.5, 97, 97.5)]
    box(ax, -0.4, 7.4, 99.5, 102.4, fc="#BBBBBB", ec=GREY, alpha=0.25, ls="--")
    box(ax, 7.0, 14.5, 102.4, 112, fc="#F4C77A", ec=GOLD, alpha=0.38)
    candles(ax, d)
    txt(ax, 0.0, 97.3, "RBS POI (becomes invalid)", color=GREY, fs=7.6, bold=True)
    txt(ax, 13.9, 109.8, "QML POI", color=GOLD, ha="right", fs=9, bold=True)
    txt(ax, 13.9, 107.9, "bottom = top of the old POI", color=GREY, ha="right", fs=7.2)
    txt(ax, 13.9, 106.3, "top = highest point before the drop", color=GREY, ha="right", fs=7.2)
    ax.annotate("Swing high (the extreme)", xy=(5, 112.2), xytext=(1.2, 114.6), fontsize=7.6,
                color=NAVY, fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1),
                va="center")
    ax.annotate("A body closes below\nthe POI = invalid", xy=(7, 98.3), xytext=(7.3, 94.2),
                fontsize=7.6, color=RED, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.1))
    ax.annotate("Price goes up into the QML POI\nand sells off = sell entry", xy=(9.5, 106.0),
                xytext=(9.6, 114.8), fontsize=7.6, color=NAVY, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    save(fig, "f12_qml.png")


# ---------------------------------------------------------------- fig 13 (advanced KL / bjeff zone)
def fig_bjeff():
    fig, ax = plt.subplots(figsize=(6.9, 3.9))
    setup(ax, (0, 14), (0, 10.6))
    box(ax, 1.0, 8.4, 1.4, 7.4, fc=BLUE_F, ec=BLUE_E, alpha=0.28)
    box(ax, 1.0, 8.4, 1.4, 4.4, fc="#F4C77A", ec=GOLD, alpha=0.45, z=1.5)
    hline(ax, 4.4, 1.0, 8.4, color=GOLD, ls="--", lw=1.4)
    txt(ax, 1.15, 6.9, "H1 key level POI (100%)", color=BLUE_E, fs=8, bold=True)
    txt(ax, 8.55, 7.4, "100%", color=BLUE_E, fs=7.6, bold=True)
    txt(ax, 8.55, 4.4, "50%", color=GOLD, fs=7.6, bold=True)
    txt(ax, 8.55, 1.4, "0%", color=GREY, fs=7.6, bold=True)
    txt(ax, 1.15, 3.95, "New 50% POI (RBS: bottom half)", color="#8A6212", fs=7.8, bold=True)
    # bjeff zone with mini candles
    box(ax, 4.2, 7.4, 1.7, 3.0, fc="#FFFFFF", ec=NAVY, alpha=0.6, ls="-", lw=1.4, z=2)
    for x, (o, h, l, c) in ((5.2, (2.9, 3.05, 1.8, 2.0)), (6.1, (2.0, 3.2, 1.75, 2.9))):
        col = GREEN if c >= o else RED
        ax.plot([x, x], [l, h], color=col, lw=1.4, zorder=6)
        ax.add_patch(Rectangle((x - 0.22, min(o, c)), 0.44, abs(c - o), fc=col, ec=col, zorder=7))
    txt(ax, 4.3, 1.1, "bjeff zone = M5 key level", color=NAVY, fs=7.6, bold=True)
    # price path
    arrow(ax, (4.8, 10.2), (4.8, 7.6), color=GREY, lw=1.6)
    arrow(ax, (4.8, 7.6), (4.8, 3.1), color=GREY, lw=1.6, ls=":")
    arrow(ax, (6.6, 2.5), (6.6, 9.6), color=GREEN, lw=1.8)
    txt(ax, 4.0, 9.9, "Price retraces", color=GREY, ha="right", fs=7.6)
    txt(ax, 6.8, 9.7, "Trade from the zone", color=GREEN, fs=7.6, bold=True)
    # steps
    steps = ["1  Mark 100% of the H1 key level POI",
             "2  Fibonacci: find the 50%, draw the new POI",
             "3  Price comes into the bjeff zone",
             "4  Body closes inside it, then take any",
             "    confirmation entry on M5",
             "SBR: flip it. The top half is the new POI."]
    for i, s in enumerate(steps):
        txt(ax, 9.6 + (0 if i != 5 else 0), 7.8 - i * 0.95, s, color=NAVY if i < 5 else GREY,
            fs=6.9 if i != 5 else 6.8, bold=(i < 5 and not s.startswith("    ")))
    save(fig, "f13_bjeff.png")


if __name__ == "__main__":
    fig_overview()
    fig_structure()
    fig_liquidity()
    fig_orderflow()
    fig_ob()
    fig_body()
    fig_reclamation()
    fig_kl_types()
    fig_rbs()
    fig_wicks()
    fig_trade()
    fig_qml()
    fig_bjeff()
    print("ok", sorted(os.listdir(OUT)))
