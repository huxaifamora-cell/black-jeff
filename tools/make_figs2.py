from make_figs import *  # noqa


def fig_overview():
    fig, ax = plt.subplots(figsize=(6.9, 2.5))
    setup(ax, (0, 100), (0, 40))
    cards = [
        ("S", "Market Structure", "H4", "Find the trend through\nits most valid break\nof structure", NAVY),
        ("O", "Order Flow", "H1", "Inducement, disruption\nand their POIs\n(order block boxes)", TEAL),
        ("R", "Reclamation", "H1", "A move at the POI used\nas a confirmation\n(not as an entry)", GOLD),
        ("K", "Key Level", "H1 / M5", "Found on H1, entered\non M5, with SL and TP\n(RBS, SBR, QML)", "#7A3E9D"),
    ]
    w, gap = 21, 4.5
    for i, (letter, name, tf, desc, col) in enumerate(cards):
        x = 1 + i * (w + gap)
        ax.add_patch(FancyBboxPatch((x, 3), w, 34, boxstyle="round,pad=0.3,rounding_size=1.6",
                                    fc="white", ec=col, lw=1.8))
        ax.add_patch(FancyBboxPatch((x, 26), w, 11, boxstyle="round,pad=0.3,rounding_size=1.6",
                                    fc=col, ec=col, lw=1.8))
        ax.text(x + 1.4, 31.5, letter, color="white", fontsize=17, fontweight="bold", va="center")
        ax.text(x + 5.6, 33.4, name, color="white", fontsize=6.0, fontweight="bold", va="center")
        ax.text(x + 5.6, 29.4, "Timeframe " + tf, color="white", fontsize=5.6, va="center")
        ax.text(x + w / 2, 14.5, desc, color=NAVY, fontsize=6.6, ha="center", va="center",
                linespacing=1.55)
        if i < 3:
            arrow(ax, (x + w + 0.6, 20), (x + w + gap - 0.4, 20), color=GREY, lw=1.5)
    save(fig, "f01_overview.png")


def fig_structure():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.2))
    pts = [(0, 100), (1, 110), (2, 104), (3, 118), (4, 111), (5, 124)]
    for ax, mir in zip(axes, (False, True)):
        T = (lambda y: 218 - y) if mir else (lambda y: y)
        setup(ax, (-0.5, 6.4), (94, 128) if not mir else (92, 126),
              "Uptrend: HH and HL (V shape)" if not mir else "Downtrend: LL and LH (A shape)")
        ax.plot([p[0] for p in pts], [T(p[1]) for p in pts], color=GREY, lw=1.6, zorder=3)
        ax.plot([1, 2, 3], [T(110), T(104), T(118)], color=TEAL, lw=3.2, zorder=4,
                solid_capstyle="round")
        labs = {1: "L", 2: "LH", 3: "LL", 4: "LH", 5: "LL"} if mir else \
            {1: "H", 2: "HL", 3: "HH", 4: "HL", 5: "HH"}
        for (x, y0) in pts[1:]:
            y = T(y0)
            above = (x % 2 == 1) != mir
            ax.plot([x], [y], "o", color=NAVY, ms=4.5, zorder=6)
            txt(ax, x, y + (2.0 if above else -2.0), labs[x], ha="center", fs=8, bold=True)
        for (xa, xb, yb) in ((1, 3, 110), (3, 5, 118)):
            hline(ax, T(yb), xa, xb + 0.15, color=RED)
            txt(ax, xb + 0.2, T(yb), "BOS", color=RED, fs=7.5, bold=True)
        sx, sy = 2.5, T(108.5)
        col = RED if not mir else GREEN
        ax.add_patch(Rectangle((sx - 0.11, sy - 1.1), 0.22, 2.2, fc=col, ec=col, zorder=7))
        ax.plot([sx, sx], [sy - 2.0, sy + 2.0], color=col, lw=1.2, zorder=6)
        txt(ax, 2.72, 106.0 if not mir else 109.8, "SLQ", color=col, fs=7.5, bold=True)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f02_structure.png")


def fig_liquidity():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.9))
    ax = axes[0]
    setup(ax, (-0.7, 7.3), (96, 121), "Valid: LQ + BOS")
    d = [(100, 104, 99, 103), (103, 107, 102, 106), (106, 110, 105, 109),
         (109, 109.5, 105.5, 106), (106, 108, 105, 107.5), (107.5, 112.5, 107, 112)]
    candles(ax, d)
    hline(ax, 110, 2, 5.6, color=RED)
    txt(ax, 5.75, 110, "BOS", color=RED, bold=True)
    ax.annotate("LQ", xy=(3, 105.3), xytext=(3, 100.2), ha="center", color=RED, fontsize=8,
                fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.2))
    txt(ax, -0.5, 119.2, "A red candle inside the green run is the LQ.", color=GREY, fs=7)
    txt(ax, -0.5, 117.4, "A new HH above the old high is the BOS.", color=GREY, fs=7)
    ax = axes[1]
    setup(ax, (-0.7, 7.3), (96, 121), "Exception: 2+ BOS, no SLQ")
    d = [(100, 103, 99.5, 102.5), (102.5, 106, 102, 105.5), (105.5, 109, 105, 108.5),
         (108.5, 112.5, 108, 112)]
    candles(ax, d)
    for x, y in ((1, 103), (2, 106), (3, 109)):
        hline(ax, y, x - 1, x + 0.5, color=RED)
    for (x, y) in ((1, 106), (2, 109), (3, 112.5)):
        txt(ax, x, y + 1.6, "BOS", color=RED, ha="center", fs=7.5, bold=True)
    txt(ax, -0.5, 119.2, "No red candle between them, so no SLQ.", color=GREY, fs=7)
    txt(ax, -0.5, 117.4, "The BOS themselves act as the liquidity.", color=GREY, fs=7)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f03_liquidity.png")


def fig_orderflow():
    fig, ax = plt.subplots(figsize=(6.9, 3.6))
    setup(ax, (-0.4, 11.4), (96, 143))
    pts = [(0, 100), (1, 110), (2, 104), (3, 116), (4, 109), (5, 122), (6, 115), (7, 128)]
    ax.plot([p[0] for p in pts], [p[1] for p in pts], color=GREY, lw=1.8, zorder=3)
    for x, y in pts:
        ax.plot([x], [y], "o", color=NAVY, ms=4, zorder=6)
    for x, y, lab, col in [(2, 104, "Point of liquidity line", GREY), (4, 109, "Disruption line", TEAL),
                           (6, 115, "Inducement line", GOLD)]:
        hline(ax, y, x, 10.4, color=col, ls="-", lw=1.6)
        txt(ax, 10.5, y, lab, color=col, fs=7.6, bold=True)
        ax.plot([x], [y], "o", color=col, ms=7, zorder=7)
    for x, y, lab, col in [(3, 116, "BOS 1\npoint of liquidity", GREY), (5, 122, "BOS 2\ndisruption", TEAL),
                           (7, 128, "BOS 3 (latest)\ninducement", GOLD)]:
        txt(ax, x, y + 3.4, lab, color=col, ha="center", fs=7.6, bold=True)
    txt(ax, 0.0, 141, "Each line sits on the V tip (the HL) of its BOS and extends to the right.", color=GREY, fs=7.4)
    txt(ax, 0.0, 138.4, "The latest BOS is the inducement; the one before it is the disruption.", color=GREY, fs=7.4)
    save(fig, "f04_orderflow.png")


def fig_reclamation():
    base = [(108, 109, 106.5, 107), (107, 107.3, 102.5, 103), (103, 103.2, 98.5, 99),
            (99, 104.8, 98.8, 104.5), (104.5, 105, 102.5, 103), (103, 108, 102.8, 107.5),
            (107.5, 111, 107, 110.5)]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.2))
    for ax, mir in zip(axes, (False, True)):
        data = mirror(base, 204) if mir else base
        setup(ax, (-0.8, 8.6), (95, 114) if not mir else (94, 113),
              "Bullish reclamation (uptrend)" if not mir else "Bearish reclamation (downtrend)")
        box(ax, -0.5, 8.5, 100, 104)
        candles(ax, data)
        txt(ax, 8.2, 102, "POI", color=BLUE_E, bold=True, ha="right", fs=9)
        s = -1 if mir else 1
        T = (lambda y: 204 - y) if mir else (lambda y: y)
        marks = [(1, T(107.3) + 1.7 * s), (2, T(98.5) - 1.9 * s), (3, T(104.8) + 1.8 * s),
                 (4, T(102.5) - 1.9 * s), (5, T(108) + 1.9 * s)]
        for n, (x, y) in enumerate(marks, start=1):
            num(ax, x, y, n, color=TEAL)
    fig.tight_layout(w_pad=1.2)
    save(fig, "f07_reclamation.png")


def fig_kl_types():
    kl = [(100, 102.6, 99.5, 102.4), (102.4, 105.5, 98.5, 99.6)]
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 2.6))
    ax = axes[0]
    setup(ax, (-0.8, 4.6), (96, 107), "Resistant key level")
    candles(ax, kl, x0=0.5)
    hline(ax, 102.4, -0.2, 2.8, color=RED)
    txt(ax, 3.0, 102.4, "equal top\nedges", color=RED, fs=7.6, bold=True)
    txt(ax, 0.5, 97.0, "bullish first", color=GREEN, fs=7.6, bold=True, ha="center")
    ax = axes[1]
    setup(ax, (-0.8, 4.6), (96, 107), "Support key level")
    candles(ax, mirror(kl, 204), x0=0.5)
    hline(ax, 101.6, -0.2, 2.8, color=GREEN)
    txt(ax, 3.0, 101.6, "equal bottom\nedges", color=GREEN, fs=7.6, bold=True)
    txt(ax, 0.5, 105.2, "bearish first", color=RED, fs=7.6, bold=True, ha="center")
    fig.tight_layout(w_pad=1.5)
    save(fig, "f08_kl_types.png")


def fig_wicks():
    fig, axes = plt.subplots(1, 2, figsize=(6.9, 3.2))
    kl = [(100, 102.6, 99.6, 102.4), (102.4, 103.2, 98.9, 99.6)]
    mids_hi = [(104, 105, 101.2, 104.8), (104.8, 105.5, 100.8, 105.2)]
    mids_lo = [(104, 105, 101.2, 104.8), (104.8, 105.4, 100.9, 105.1),
               (105.1, 105.9, 101.5, 105.6), (105.6, 106.3, 101.0, 105.9)]
    for ax, mids, bos, title, col in (
            (axes[0], mids_hi, (105.2, 111, 105, 110.5), "High probability: 2 wicks or fewer", GREEN),
            (axes[1], mids_lo, (105.9, 112, 105.5, 111.5), "Low probability: too many wicks", RED)):
        n = len(mids)
        setup(ax, (-0.8, n + 4.6), (95, 117), title)
        ax.title.set_color(col)
        box(ax, -0.4, n + 4.5, 99.5, 102.4)
        candles(ax, kl + mids + [bos])
        for i, m in enumerate(mids):
            x = 2 + i
            ax.plot([x], [m[2]], "o", color=RED, ms=5.5, zorder=8)
            num(ax, x, m[2] - 1.7, i + 1, color=RED)
        txt(ax, 0.5, 96.6, "KL", color=NAVY, ha="center", fs=7.6, bold=True)
        txt(ax, n + 2, bos[1] + 1.8, "BOS", color=NAVY, ha="center", fs=7.6, bold=True)
        txt(ax, n + 4.3, 100.95, "POI", color=BLUE_E, ha="right", bold=True, fs=8.5)
        txt(ax, -0.6, 115.4, f"{n} wicks inside the POI between the KL and its BOS", color=GREY, fs=7.2)
    fig.tight_layout(w_pad=1.5)
    save(fig, "f10_wicks.png")


def fig_trade():
    fig, ax = plt.subplots(figsize=(6.9, 3.9))
    setup(ax, (-0.8, 13.2), (94, 114))
    box(ax, -0.5, 8.4, 99.5, 102.4)
    d = [(106, 106.5, 104, 104.5), (104.5, 104.8, 101.5, 102), (102, 102.2, 100.2, 100.6),
         (100.6, 102.3, 100.3, 102.1), (102.1, 105, 102, 104.8), (104.8, 108, 104.5, 107.5),
         (107.5, 110, 107, 109.8)]
    candles(ax, d)
    hline(ax, 102.4, -0.5, 8.4, color=GOLD, ls="--", lw=1.4)
    hline(ax, 99.2, -0.5, 8.4, color=RED, ls="--", lw=1.4)
    hline(ax, 108.8, -0.5, 8.4, color=GREEN, ls="--", lw=1.4)
    txt(ax, 8.7, 108.8, "TP (1:2 example)", color=GREEN, fs=7.8, bold=True)
    txt(ax, 8.7, 103.3, "Buy limit at the top edge", color=GOLD, fs=7.8, bold=True)
    txt(ax, 8.7, 99.2, "SL slightly below the POI", color=RED, fs=7.8, bold=True)
    txt(ax, 8.7, 101.0, "POI (RBS)", color=BLUE_E, fs=7.8, bold=True)
    ax.annotate("Price pulls back into\nthe POI on M5", xy=(1, 103.2), xytext=(-0.2, 112),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    ax.annotate("Engulf candle inside the POI\n= M5 confirmation", xy=(3, 100.0), xytext=(2.0, 96.3),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    ax.annotate("Price moves out of the\ntop of the POI", xy=(4.3, 103.4), xytext=(5.6, 97.8),
                fontsize=7.6, color=NAVY, fontweight="bold", ha="left", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    save(fig, "f11_trade.png")


def fig_qml():
    fig, ax = plt.subplots(figsize=(6.9, 4.2))
    setup(ax, (-1, 14.6), (91, 118))
    d = [(100, 102.6, 99.6, 102.4), (102.4, 105.5, 98.5, 99.5), (99.5, 100.5, 96, 97),
         (97, 100, 96.5, 99.8), (99.8, 107.5, 99.5, 107), (107, 112, 106.5, 111),
         (111, 111.5, 104, 104.8), (104.8, 105, 98, 98.6), (98.6, 103.5, 98.2, 103),
         (103, 106.2, 102.6, 103.3), (103.3, 103.5, 97, 97.5)]
    box(ax, -0.4, 7.4, 99.5, 102.4, fc="#BBBBBB", ec=GREY, alpha=0.25, ls="--")
    box(ax, 7.0, 14.5, 102.4, 112, fc="#F4C77A", ec=GOLD, alpha=0.38)
    candles(ax, d)
    txt(ax, -0.4, 93.4, "RBS POI (becomes invalid)", color=GREY, fs=7.6, bold=True)
    txt(ax, 14.2, 110.4, "QML POI", color=GOLD, ha="right", fs=9, bold=True)
    txt(ax, 14.2, 108.6, "bottom: top of old POI", color=GREY, ha="right", fs=7.2)
    txt(ax, 14.2, 107.2, "top: highest point", color=GREY, ha="right", fs=7.2)
    ax.annotate("Swing high (the extreme)", xy=(5, 112.3), xytext=(0.8, 115.6), fontsize=7.6,
                color=NAVY, fontweight="bold", arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1),
                va="center")
    ax.annotate("A body closes below\nthe POI = invalid", xy=(7, 98.0), xytext=(7.6, 93.4),
                fontsize=7.6, color=RED, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=RED, lw=1.1))
    ax.annotate("Price goes up into the QML POI\nand sells off = sell entry", xy=(9.4, 105.2),
                xytext=(7.4, 116.2), fontsize=7.6, color=NAVY, fontweight="bold", va="center",
                arrowprops=dict(arrowstyle="-|>", color=NAVY, lw=1.1))
    save(fig, "f12_qml.png")


def fig_bjeff():
    fig, ax = plt.subplots(figsize=(6.9, 3.7))
    setup(ax, (0, 16.4), (0, 10.6))
    box(ax, 1.0, 8.4, 1.4, 7.4, fc=BLUE_F, ec=BLUE_E, alpha=0.28)
    box(ax, 1.0, 8.4, 1.4, 4.4, fc="#F4C77A", ec=GOLD, alpha=0.45, z=1.5)
    hline(ax, 4.4, 1.0, 8.4, color=GOLD, ls="--", lw=1.4)
    txt(ax, 1.15, 6.9, "H1 key level POI (100%)", color=BLUE_E, fs=8, bold=True)
    txt(ax, 8.55, 7.4, "100%", color=BLUE_E, fs=7.6, bold=True)
    txt(ax, 8.55, 4.4, "50%", color=GOLD, fs=7.6, bold=True)
    txt(ax, 8.55, 1.4, "0%", color=GREY, fs=7.6, bold=True)
    txt(ax, 1.15, 3.95, "New 50% POI (RBS: bottom half)", color="#8A6212", fs=7.8, bold=True)
    box(ax, 4.2, 7.4, 1.7, 3.0, fc="#FFFFFF", ec=NAVY, alpha=0.6, ls="-", lw=1.4, z=2)
    for x, (o, h, l, c) in ((5.2, (2.9, 3.05, 1.8, 2.0)), (6.1, (2.0, 3.2, 1.75, 2.9))):
        col = GREEN if c >= o else RED
        ax.plot([x, x], [l, h], color=col, lw=1.4, zorder=6)
        ax.add_patch(Rectangle((x - 0.22, min(o, c)), 0.44, abs(c - o), fc=col, ec=col, zorder=7))
    txt(ax, 4.3, 1.05, "bjeff zone = M5 key level", color=NAVY, fs=7.6, bold=True)
    arrow(ax, (3.0, 10.2), (3.0, 7.6), color=GREY, lw=1.6)
    arrow(ax, (3.0, 7.6), (3.0, 4.6), color=GREY, lw=1.6, ls=":")
    arrow(ax, (7.9, 2.0), (7.9, 9.6), color=GREEN, lw=1.8)
    txt(ax, 3.2, 9.8, "Price retraces", color=GREY, fs=7.6)
    txt(ax, 6.0, 10.2, "Trade from the zone", color=GREEN, fs=7.6, bold=True)
    steps = ["1  Mark 100% of the H1 key level POI",
             "2  Fibonacci: find the 50%, draw the new POI",
             "3  Price comes into the bjeff zone",
             "4  Body closes inside it, then take any",
             "    confirmation entry on M5",
             "For SBR, flip it: the top half is the new POI."]
    for i, s in enumerate(steps):
        txt(ax, 9.8, 7.9 - i * 1.0, s, color=NAVY if i < 5 else GREY, fs=6.7,
            bold=(i < 4 and not s.startswith("    ")))
    save(fig, "f13_bjeff.png")


if __name__ == "__main__":
    fig_overview(); fig_structure(); fig_liquidity(); fig_orderflow(); fig_ob(); fig_body()
    fig_reclamation(); fig_kl_types(); fig_rbs(); fig_wicks(); fig_trade(); fig_qml(); fig_bjeff()
    print("done")
