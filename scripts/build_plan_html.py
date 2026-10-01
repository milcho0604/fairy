#!/usr/bin/env python3
"""docs/plan.md 를 원본으로 docs/plan.html 을 만든다.

md 를 고친 뒤 이 스크립트를 돌리면 html 이 따라온다. html 을 손으로 고치지 않는다.

    python3 scripts/build_plan_html.py
"""

from __future__ import annotations

import html
import re
import sys
from pathlib import Path

try:
    import markdown
except ImportError:
    sys.exit("python-markdown 이 필요하다: pip3 install markdown")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "plan.md"
OUT = ROOT / "docs" / "plan.html"
ASSETS = ROOT / "docs" / "assets"


def inline_svg(body: str) -> str:
    """<img src="assets/x.svg"> 를 svg 원문으로 바꿔 html 한 파일로 열리게 한다."""

    def repl(m: re.Match[str]) -> str:
        svg_path = ASSETS / m["src"]
        if not svg_path.exists():
            return m[0]
        svg = svg_path.read_text(encoding="utf-8")
        return f'<figure class="diagram">{svg}<figcaption>{m["alt"]}</figcaption></figure>'

    pattern = r'<p><img alt="(?P<alt>[^"]*)" src="assets/(?P<src>[^"]+\.svg)" ?/?></p>'
    return re.sub(pattern, repl, body)


def task_lists(body: str) -> str:
    body = body.replace("<li>[ ] ", '<li class="task"><input type="checkbox" disabled> ')
    body = body.replace("<li>[x] ", '<li class="task"><input type="checkbox" checked disabled> ')
    return body


def wrap_tables(body: str) -> str:
    body = body.replace("<table>", '<div class="table-wrap"><table>')
    return body.replace("</table>", "</table></div>")


def tag_priorities(body: str) -> str:
    for label, cls in (("MVP", "mvp"), ("v1", "v1"), ("v2", "v2")):
        body = body.replace(f"<td>{label}</td>", f'<td data-priority="{cls}"><span class="tag {cls}">{label}</span></td>')
    for label, cls in (("요청", "asked"), ("제안", "suggested")):
        body = body.replace(f"<td>{label}</td>", f'<td><span class="src {cls}">{label}</span></td>')
    return body


def mark_feature_table(body: str) -> str:
    """기능 리스트 표에 id 를 붙이고 위에 필터 버튼을 둔다."""
    head = '<h2 id="기능-리스트">기능 리스트</h2>'
    idx = body.find(head)
    if idx < 0:
        return body
    wrap = body.find('<div class="table-wrap"><table>', idx)
    if wrap < 0:
        return body
    filters = (
        '<div class="filters" role="group" aria-label="우선순위 필터">'
        '<button type="button" data-filter="all" aria-pressed="true">전체</button>'
        '<button type="button" data-filter="mvp" aria-pressed="false">MVP</button>'
        '<button type="button" data-filter="v1" aria-pressed="false">v1</button>'
        '<button type="button" data-filter="v2" aria-pressed="false">v2</button>'
        '<span class="count" aria-live="polite"></span>'
        "</div>"
    )
    marked = '<div class="table-wrap"><table id="features">'
    return body[:wrap] + filters + marked + body[wrap + len('<div class="table-wrap"><table>'):]


def slugify(value: str, separator: str) -> str:
    value = re.sub(r"[^\w\s-]", "", value).strip().lower()
    return re.sub(r"[\s]+", separator, value)


def build() -> None:
    text = SRC.read_text(encoding="utf-8")
    md = markdown.Markdown(
        extensions=["tables", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": slugify, "toc_depth": "2"}},
    )
    body = md.convert(text)
    title = re.search(r"^# (.+)$", text, re.M).group(1).strip()

    body = inline_svg(body)
    body = task_lists(body)
    body = wrap_tables(body)
    body = tag_priorities(body)
    body = mark_feature_table(body)

    # 첫 h1 은 머리말로 따로 그린다.
    body = re.sub(r"<h1[^>]*>.*?</h1>\s*", "", body, count=1)

    toc_links = "".join(
        f'<li><a href="#{t["id"]}">{html.escape(t["name"])}</a></li>'
        for t in md.toc_tokens[0]["children"]
    ) if md.toc_tokens else ""

    page = TEMPLATE.replace("{{title}}", html.escape(title))
    page = page.replace("{{toc}}", toc_links).replace("{{body}}", body)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT}")


TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<style>
:root {
  --bg: #ffffff;
  --surface: #f6f8fa;
  --text: #1f2328;
  --muted: #59636e;
  --border: #d1d9e0;
  --accent: #0969da;
  --accent-soft: rgba(9, 105, 218, 0.10);
  --mvp: #1a7f37; --mvp-soft: rgba(26, 127, 55, 0.12);
  --v1: #9a6700; --v1-soft: rgba(154, 103, 0, 0.12);
  --v2: #8250df; --v2-soft: rgba(130, 80, 223, 0.12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117; --surface: #151b23; --text: #e6edf3; --muted: #9198a1; --border: #3d444d;
    --accent: #4493f8; --accent-soft: rgba(68, 147, 248, 0.15);
    --mvp: #3fb950; --mvp-soft: rgba(63, 185, 80, 0.15);
    --v1: #d29922; --v1-soft: rgba(210, 153, 34, 0.15);
    --v2: #ab7df8; --v2-soft: rgba(171, 125, 248, 0.15);
  }
}
:root[data-theme="dark"] {
  --bg: #0d1117; --surface: #151b23; --text: #e6edf3; --muted: #9198a1; --border: #3d444d;
  --accent: #4493f8; --accent-soft: rgba(68, 147, 248, 0.15);
  --mvp: #3fb950; --mvp-soft: rgba(63, 185, 80, 0.15);
  --v1: #d29922; --v1-soft: rgba(210, 153, 34, 0.15);
  --v2: #ab7df8; --v2-soft: rgba(171, 125, 248, 0.15);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif;
  word-break: keep-all; overflow-wrap: break-word;
}
.layout { max-width: 1120px; margin: 0 auto; padding: 0 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 40px; }
@media (min-width: 960px) { .layout { grid-template-columns: 220px minmax(0, 1fr); padding: 0 32px; } }
header.top { grid-column: 1 / -1; padding: 48px 0 8px; border-bottom: 1px solid var(--border); }
header.top h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.3; }
header.top .meta { color: var(--muted); font-size: 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.theme-toggle {
  margin-left: auto; font: inherit; font-size: 13px; color: var(--text); background: var(--surface);
  border: 1px solid var(--border); border-radius: 999px; padding: 4px 12px; cursor: pointer;
}
nav.toc { display: none; }
@media (min-width: 960px) {
  nav.toc { display: block; position: sticky; top: 24px; align-self: start; font-size: 14px; }
  nav.toc ol { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--border); }
  nav.toc a { display: block; padding: 4px 0 4px 14px; color: var(--muted); text-decoration: none; margin-left: -1px; border-left: 2px solid transparent; }
  nav.toc a:hover, nav.toc a.active { color: var(--text); border-left-color: var(--accent); }
}
main { min-width: 0; padding-bottom: 80px; }
main > p:first-child { font-size: 18px; }
h2 { font-size: 24px; margin: 56px 0 16px; padding-top: 8px; scroll-margin-top: 16px; }
a { color: var(--accent); }
code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 1px 5px; word-break: break-all; }
li { margin: 4px 0; }
li.task { list-style: none; margin-left: -22px; }
li.task input { margin-right: 6px; }
.table-wrap { overflow-x: auto; margin: 16px 0; border: 1px solid var(--border); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; line-height: 1.55; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--border); }
th { background: var(--surface); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
#features td:first-child, #features td:nth-child(2) { white-space: nowrap; }
.tag { display: inline-block; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; }
.tag.mvp { color: var(--mvp); background: var(--mvp-soft); }
.tag.v1 { color: var(--v1); background: var(--v1-soft); }
.tag.v2 { color: var(--v2); background: var(--v2-soft); }
.src { font-size: 13px; color: var(--muted); }
.src.suggested { color: var(--accent); }
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
.filters button {
  font: inherit; font-size: 13px; color: var(--text); background: var(--bg); border: 1px solid var(--border);
  border-radius: 999px; padding: 4px 14px; cursor: pointer;
}
.filters button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.filters .count { color: var(--muted); font-size: 13px; margin-left: 4px; }
figure.diagram { margin: 16px 0; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); }
figure.diagram svg { display: block; width: 100%; height: auto; }
figure.diagram figcaption { color: var(--muted); font-size: 13px; margin-top: 8px; text-align: center; }
:root[data-theme="dark"] figure.diagram svg .ink { fill: #e6edf3; }
:root[data-theme="dark"] figure.diagram svg .quiet { fill: #9198a1; }
:root[data-theme="dark"] figure.diagram svg .edge, :root[data-theme="dark"] figure.diagram svg .box { stroke: #6e7681; }
:root[data-theme="dark"] figure.diagram svg .arrow { fill: #6e7681; }
:root[data-theme="dark"] figure.diagram svg .main { fill: rgba(56, 139, 253, 0.15); stroke: #388bfd; }
:root[data-theme="light"] figure.diagram svg .ink { fill: #1f2328; }
:root[data-theme="light"] figure.diagram svg .quiet { fill: #59636e; }
:root[data-theme="light"] figure.diagram svg .edge, :root[data-theme="light"] figure.diagram svg .box { stroke: #8c959f; }
:root[data-theme="light"] figure.diagram svg .arrow { fill: #8c959f; }
:root[data-theme="light"] figure.diagram svg .main { fill: rgba(9, 105, 218, 0.12); stroke: #0969da; }
@media print {
  nav.toc, .theme-toggle, .filters { display: none !important; }
  .layout { display: block; }
  h2 { break-after: avoid; }
  tr, figure { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="layout">
  <header class="top">
    <h1>{{title}}</h1>
    <div class="meta">
      <span>docs/plan.md 에서 생성</span>
      <button type="button" class="theme-toggle" aria-label="밝은 테마와 어두운 테마 전환">테마 전환</button>
    </div>
  </header>
  <nav class="toc" aria-label="목차"><ol>{{toc}}</ol></nav>
  <main>
{{body}}
  </main>
</div>
<script>
(() => {
  const root = document.documentElement;
  const key = "plan-theme";
  try { const saved = localStorage.getItem(key); if (saved) root.dataset.theme = saved; } catch (e) {}
  document.querySelector(".theme-toggle").addEventListener("click", () => {
    const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem(key, next); } catch (e) {}
  });

  const table = document.getElementById("features");
  const bar = document.querySelector(".filters");
  if (table && bar) {
    const rows = [...table.tBodies[0].rows];
    const count = bar.querySelector(".count");
    const apply = (f) => {
      let shown = 0;
      rows.forEach((r) => {
        const p = r.querySelector("[data-priority]")?.dataset.priority;
        const on = f === "all" || p === f;
        r.hidden = !on;
        if (on) shown++;
      });
      count.textContent = shown + "개";
      bar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
    };
    bar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) apply(b.dataset.filter); });
    apply("all");
  }

  const links = [...document.querySelectorAll("nav.toc a")];
  if (links.length && "IntersectionObserver" in window) {
    const byId = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((a) => a.classList.remove("active"));
          byId.get(en.target.id)?.classList.add("active");
        }
      });
    }, { rootMargin: "0px 0px -70% 0px" });
    document.querySelectorAll("main h2[id]").forEach((h) => io.observe(h));
  }
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    build()
