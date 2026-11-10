"""Builds web/guide.html (the in-app study guide) from the same content as the PDF.

It runs the content section of build_pdf.py with HTML versions of its helper functions,
so the PDF and the in-app guide can never drift apart.
Usage: python tools/make_guide_html.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, "build_pdf.py")).read()
code = SRC[SRC.index("# ------------------------------------------------------------------ 1. overview"):SRC.index("doc.build(story)")]

fig_no = [0]
NAVY, TEAL, GOLD, PURPLE, GREY, LIGHT, TEALBG, GOLDBG = "#12263F", "#1B7F8C", "#C8962E", "#7A3E9D", "#6B7785", "#EEF2F6", "#E7F2F4", "#FBF3E2"


class colors:
    @staticmethod
    def HexColor(x):
        return x


def P(t, s="body"):
    return {"h2": f"<h2>{t}</h2>", "h3": f"<h3>{t}</h3>", "small": f'<p class="small">{t}</p>'}.get(s, f"<p>{t}</p>")


def B(items):
    return ["<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"]


def N(items):
    return ["<ol>" + "".join(f"<li>{i}</li>" for i in items) + "</ol>"]


def banner(letter, title, tf, color):
    return [f'<h1 style="background:{color}"><span class="l">{letter}</span><span>{title}</span><small>{tf}</small></h1>']


def simple_banner(title, color=NAVY):
    return [f'<h1 style="background:{color}"><span>{title}</span></h1>']


def rule(text, color=TEAL, bg=TEALBG, title="Rule"):
    return [f'<div class="rule" style="border-color:{color};background:{bg}"><b>{title}:</b> {text}</div>']


def figure(name, caption, width=None):
    fig_no[0] += 1
    return f'<figure><img src="fig/{name}" alt="" loading="lazy"><figcaption>Figure {fig_no[0]}. {caption}</figcaption></figure>'


def table(rows, widths, header=True, zebra=True, head_color=NAVY):
    out = ['<div class="tw"><table>']
    for i, r in enumerate(rows):
        if header and i == 0:
            out.append(f'<tr style="background:{head_color}">' + "".join(f"<th>{c}</th>" for c in r) + "</tr>")
        else:
            out.append("<tr>" + "".join(f"<td>{'<b>' + str(c) + '</b>' if j == 0 else c}</td>" for j, c in enumerate(r)) + "</tr>")
    out.append("</table></div>")
    return ["".join(out)]


body, small, h2, h3 = "body", "small", "h2", "h3"
mm, CW, story = 1, 1.0, []
exec(code, {k: v for k, v in globals().items() if k not in ("code", "SRC")} | {"story": story})
CSS = """
:root{color-scheme:light dark}body{margin:0;padding:14px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
color:#1f2937;background:#fff}h1{color:#fff;display:flex;align-items:center;gap:10px;font-size:18px;margin:26px 0 10px;padding:10px 12px;border-radius:10px}
h1 .l{font-size:26px;width:34px;text-align:center}h1 small{margin-left:auto;font-weight:400;font-size:12px;opacity:.9}h2{font-size:16px;color:#12263F;margin:18px 0 4px}
h3{font-size:14px;color:#1B7F8C}p.small{font-size:12.5px;color:#6B7785}ul,ol{padding-left:22px}li{margin:3px 0}
.rule{border-left:4px solid;padding:9px 12px;border-radius:6px;margin:10px 0;color:#1f2937}
figure{margin:12px 0}figure img{width:100%;height:auto;border-radius:8px;border:1px solid #e3e8ee;background:#fff}
figcaption{font-size:12px;color:#6B7785;font-style:italic;margin-top:4px}.tw{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th{color:#fff;text-align:left;padding:6px 8px}td{padding:6px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top}
tr:nth-child(even) td{background:#f5f7fa}
@media (prefers-color-scheme:dark){body{background:#101722;color:#dbe3ec}h2{color:#cfe0f3}.rule{color:#1f2937}td{border-color:#2a3647}tr:nth-child(even) td{background:#162030}figure img{border-color:#2a3647}}
"""
LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono:wght@400;500&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/static/guide-theme.css">'
page = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SORK study guide</title><style>{CSS}</style>' + LINK + '</head><body>' + \
       '<h1 style="background:#12263F;margin-top:4px"><span>SORK Trading Concept: Study Guide</span></h1><p class="small">A forex trading concept by B-Jeff. All charts are drawn examples, not real market data.</p>' + \
       "".join(story) + "</body></html>"
out = os.path.join(HERE, "..", "web", "guide.html")
open(out, "w", encoding="utf-8").write(page)
print("wrote", os.path.abspath(out), len(page), "bytes,", fig_no[0], "figures")
