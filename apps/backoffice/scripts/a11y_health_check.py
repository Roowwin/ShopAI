#!/usr/bin/env python
"""Health check for the backoffice admin pages: contrast ratios and static accessibility.

WHY THIS EXISTS
    The admin UI is a dark theme built on one token palette. Every colour decision that looks
    fine in isolation can still be unreadable in combination, because the palette's ink scale is
    INVERTED (a higher ink number is LIGHTER, i.e. stronger text on a dark ground). That inversion
    is exactly the trap: `text-ink-900` reads like "very dark grey" and is in fact near-white, so
    pairing it with a light fill such as `bg-brand-700` produces white-on-emerald. Nothing in the
    build catches this - there is no linter, no runtime check, and the contrast decisions live in
    prose comments in `app/globals.css`.

    So: the fill+ink pairs are enumerated from the source and computed. The unit of the sweep is
    one class string - a background utility and a text utility appearing together are assumed to
    be a fill and the ink placed on it.

WHAT IT CHECKS
    1. Contrast of every background/foreground pair found in the admin source, against the token
       values actually declared in `app/globals.css`. WCAG 2.1 AA: 4.5:1 for body text, 3:1 for
       large text (>=24px, or >=18.66px when bold). The font size is inferred from the text-size
       utility on the same class string and defaults to the stricter body-text rule.
    2. A set of static accessibility smells that do not need a browser: images with no alt text,
       interactive elements with no accessible name, click handlers on things that are not
       buttons, links with no href, and inputs with no label of any kind.
    3. Token drift: colour utilities that no token or known Tailwind builtin can resolve. An
       unresolved token is a WARN, never a silent pass - it usually means a class was added
       against a name the palette does not have.

HONEST LIMITS
    This is a static sweep, not a rendering audit. It cannot see inheritance, `opacity-*` on a
    parent, an image behind a translucent panel, or a class assembled at runtime. It therefore
    reports a pair as a failure only when it fails on its own terms, and marks a pair whose
    translucency makes the result backdrop-dependent as a WARN with both readings shown. Treat a
    FAIL as a real defect and a WARN as something to look at.

    Three deliberate exceptions recorded in `app/globals.css` are honoured rather than
    re-litigated:
      - `--line` / `--line-strong` sit below the 3:1 non-text bar on purpose (they are hairlines,
        and the comment there says not to "fix" them). They are never text, so they do not enter
        the fill+ink sweep; their use is counted and reported as an accepted exception.
      - the LIGHT DOCUMENTS. The packing slip, the dispatch label and the invoice are white paper
        inside this dark app, and they rebind the ink tokens to a light ladder through the scoped
        `.print-doc` class. Such a scope is not the app's palette, so `load_palette` reads only
        `:root`; and a source file that names the scope resolves against the paper ladder, because
        `bg-white + text-ink-900` is 1.05:1 on the app's ground and 14.4:1 inside the scope. Before
        this, that block silently REPLACED the app's own values and every
        `bg-surface + text-brand-300` was reported as 2.1:1.

USAGE
    python apps/backoffice/scripts/a11y_health_check.py            # human report
    python apps/backoffice/scripts/a11y_health_check.py --strict   # WARNs fail the run too
    python apps/backoffice/scripts/a11y_health_check.py --json     # machine-readable

    Runs on the host with the standard library only (the api container does not mount the
    backoffice tree, so this cannot run inside it). Exits 1 when anything FAILs.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ----------------------------------------------------------------------------- palette input

# The admin app uses these Tailwind builtins directly rather than through the token palette.
# They are listed so the sweep can resolve them instead of calling them drift; `LivePreview`
# renders a deliberately LIGHT surface (a mock storefront card) inside the dark app, which is
# where the white/stone/slate literals come from.
BUILTIN = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "stone-50": (250, 250, 249),
    "stone-100": (245, 245, 244),
    "stone-200": (231, 229, 228),
    "slate-100": (241, 245, 249),
    "slate-200": (226, 232, 240),
    "slate-400": (148, 163, 184),
    "slate-500": (100, 116, 139),
    "slate-600": (71, 85, 105),
    "slate-700": (51, 65, 85),
    "slate-900": (15, 23, 42),
}

# Utilities that are not colours at all, so a `bg-`/`text-` prefix on them is not a fill or ink.
NON_COLOUR = {
    "transparent", "current", "inherit", "none", "auto", "full", "center", "left", "right",
    "justify", "start", "end", "clip", "ellipsis", "wrap", "nowrap", "balance", "pretty",
    "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
    "solid", "soft", "ink",  # bare `text-ink` is not a token; `ink` alone is drift
}

# Recorded in app/globals.css as deliberate: hairlines below the 3:1 non-text bar.
ACCEPTED_EXCEPTIONS = {"line", "line-strong"}

VAR_RE = re.compile(r"--([a-z0-9-]+)\s*:\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;")
# The variant chain is captured and paired on. Without it `"bg-surface-sunken text-ink-500
# hover:bg-brand-700 hover:text-white"` yields a bg-brand-700 + text-ink-500 pair that exists in
# no state at all: the base ink is for the base fill, and the hover fill is for the hover ink.
#
# The utilities are matched with an explicit prefix list rather than a loose `[a-z-]+`: that
# looser form reads `bg-brand-700` as prefix "bg-brand" + name "700" and finds nothing. The
# trailing lookahead keeps the name whole, so `bg-surface-sunken` is one token.
COLOUR_UTIL_RE = re.compile(
    r"(?<![a-z0-9-])((?:[a-z-]+:)*)"
    r"(bg|text|from|via|to|fill|stroke)-"
    r"([a-z][a-z0-9]*(?:-[a-z0-9]+)*)"
    r"(?:/(\d{1,3}))?"
    r"(?![a-z0-9-])")
FILL_PREFIXES = ("bg", "from", "to", "via")
INK_PREFIXES = ("text", "fill", "stroke")

# `resolve` returns this when the utility is a real, recognised non-colour utility (`text-xs`,
# `bg-transparent`) - as opposed to None, which means nothing claims the name and it is drift.
NON_COLOUR_UTIL = object()

# JSX/TS comments are stripped before any scanning: several of them discuss `<img>` and `<a>`
# in prose ("renders an <a>"), and a static reader that cannot tell prose from markup reports
# the explanation instead of the code.
COMMENT_RE = re.compile(r"\{/\*.*?\*/\}|/\*.*?\*/", re.S)
LINE_COMMENT_RE = re.compile(r"(?m)//(?![^\n]*[\"'])")  # crude: `//` outside a URL-ish string


def strip_comments(text: str) -> str:
    """Blank out comments but keep every newline, so reported line numbers stay true."""
    def blank(match: re.Match) -> str:
        return re.sub(r"[^\n]", " ", match.group(0))
    return LINE_COMMENT_RE.sub(blank, COMMENT_RE.sub(blank, text))


def block_bodies(text: str, opener: str) -> str:
    """The concatenated bodies of every `<opener> { ... }` block, brace-matched.

    `opener` is a literal selector prefix: `:root` for the palette, `.print-doc` for the light
    document scope below.
    """
    out = []
    for m in re.finditer(re.escape(opener) + r"[^{}]*\{", text):
        depth, i = 1, m.end()
        while i < len(text) and depth:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        out.append(text[m.end():i - 1])
    return "\n".join(out)


def root_blocks(text: str) -> str:
    """The concatenated bodies of every `:root { ... }` block.

    The palette is what `:root` declares. A SCOPED rebind is by definition not the app's palette:
    the print documents carry `.print-doc { --ink-900: ...; --surface: ...; }` so that white paper
    inside this dark app resolves the ink tokens against a light ladder. Reading the whole file
    last-wins let that block REPLACE the app's own values, and the sweep then reported a page of
    phantom failures - every `bg-surface + text-brand-300` as 2.1:1, because `surface` had become
    white. Only `:root` is the palette; a class-scoped block is a local override.
    """
    return block_bodies(text, ":root")


def load_palette(globals_css: Path) -> dict[str, tuple[int, int, int]]:
    """Every `--token: R G B;` triple `:root` declares, keyed by the utility suffix."""
    palette = {}
    for name, r, g, b in VAR_RE.findall(root_blocks(globals_css.read_text(encoding="utf-8"))):
        palette[name] = (int(r), int(g), int(b))
    return palette


def load_document_palette(globals_css: Path) -> dict[str, tuple[int, int, int]]:
    """The `.print-doc` / `.print-doc-paper` ladder - the light paper the two printable screens are.

    Those screens are white documents inside a dark app, and they rebind the ink tokens to a light
    ladder so a printed packing slip is not near-white on white. The sweep reads classes per line
    and cannot see which element it is inside, so without this a fixed document would keep failing
    the check it was fixed for: `bg-white + text-ink-900` reads 1.05:1 against the app palette and
    14.4:1 inside the scope. Resolving a file that names the scope class against this ladder is the
    same recorded-exception move as the hairlines below - the failure is real on one ground and not
    on the other, and only the element says which.
    """
    body = block_bodies(globals_css.read_text(encoding="utf-8"), ".print-doc")
    return {name: (int(r), int(g), int(b)) for name, r, g, b in VAR_RE.findall(body)}


def resolve(token: str, palette: dict[str, tuple[int, int, int]]):
    """A colour utility's suffix -> RGB; NON_COLOUR_UTIL when it is a recognised non-colour
    utility; None when nothing claims the name at all (drift)."""
    if token in NON_COLOUR:
        return NON_COLOUR_UTIL
    if token.startswith("gradient"):    # `bg-gradient-to-br` paints nothing by itself
        return NON_COLOUR_UTIL
    if token in palette:
        return palette[token]
    if token in BUILTIN:
        return BUILTIN[token]
    return None


# ----------------------------------------------------------------------------- contrast maths

def _channel(value: int) -> float:
    srgb = value / 255.0
    return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = (_channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = luminance(a), luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def over(fill: tuple[int, int, int], alpha: int, backdrop: tuple[int, int, int]) -> tuple[int, int, int]:
    """Composite a translucent fill onto a backdrop - the standard source-over blend."""
    f = alpha / 100.0
    return tuple(round(fill[i] * f + backdrop[i] * (1 - f)) for i in range(3))


# ----------------------------------------------------------------------------- source sweep

def source_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.tsx") if "node_modules" not in p.parts)


def pairs_in_line(line: str):
    """Every (fill, ink) pair on one source line, grouped by variant.

    A pair is only a pair within one state: `hover:bg-brand-700` sits on `hover:text-white`, not
    on the idle `text-ink-500` that happens to share the class string. Each item yielded is
    (variant, fill_token, fill_alpha, ink_token), all bare of their `bg-`/`text-` prefixes.
    """
    by_variant: dict[str, list[tuple[str, str, int]]] = {}
    for variant, prefix, name, alpha in COLOUR_UTIL_RE.findall(line):
        by_variant.setdefault(variant, []).append((prefix, name, int(alpha) if alpha else 100))
    for variant, tokens in by_variant.items():
        for f_prefix, f_name, f_alpha in tokens:
            if f_prefix not in FILL_PREFIXES:
                continue
            for i_prefix, i_name, i_alpha in tokens:
                if i_prefix in INK_PREFIXES and i_alpha == 100:
                    yield variant, f_name, f_alpha, i_name


SIZE_RE = re.compile(r"\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b")
BOLD_RE = re.compile(r"\bfont-(semibold|bold|extrabold|black)\b")
SIZE_PX = {"xs": 12, "sm": 14, "base": 16, "lg": 18, "xl": 20, "2xl": 24, "3xl": 30, "4xl": 36}


def required_ratio(line: str) -> tuple[float, str]:
    """WCAG 2.1 AA: large text is 24px, or 18.66px when bold. Default to the body-text rule."""
    match = SIZE_RE.search(line)
    px = SIZE_PX.get(match.group(1), 16) if match else 16
    bold = bool(BOLD_RE.search(line))
    if px >= 24 or (bold and px >= 18.66):
        return 3.0, f"large text ({px}px{', bold' if bold else ''})"
    return 4.5, f"body text ({px}px{', bold' if bold else ''})"


def audit_contrast(files: list[Path], palette: dict[str, tuple[int, int, int]],
                   doc_palette: dict[str, tuple[int, int, int]] | None = None):
    """Walk every source line, compute its fill+ink pairs, and sort the results."""
    failures, warnings, unresolved = [], [], {}
    ground = palette.get("surface-sunken", (2, 6, 23))
    panel = palette.get("surface", (15, 23, 42))
    checked = 0

    for path in files:
        text = strip_comments(path.read_text(encoding="utf-8"))
        # A file that draws one of the printable documents resolves its inks against the paper
        # ladder instead of the app's - see load_document_palette. Per file, not global: the scope
        # class is only on those screens.
        active = {**palette, **doc_palette} if (doc_palette and "print-doc" in text) else palette
        file_ground = active.get("surface-sunken", ground)
        file_panel = active.get("surface", panel)
        for number, line in enumerate(text.splitlines(), 1):
            if "bg-" not in line and "from-" not in line and "to-" not in line:
                continue
            for variant, fill_token, alpha, ink_token in pairs_in_line(line):
                fill, ink = resolve(fill_token, active), resolve(ink_token, active)
                if fill is NON_COLOUR_UTIL or ink is NON_COLOUR_UTIL:
                    continue  # `text-xs`, `bg-transparent`: not a colour at all
                if fill is None or ink is None:
                    for token, got in ((fill_token, fill), (ink_token, ink)):
                        if got is None and token not in ACCEPTED_EXCEPTIONS:
                            unresolved[token] = unresolved.get(token, 0) + 1
                    continue

                need, why = required_ratio(line)
                where = f"{path.relative_to(path.parents[1])}:{number}"
                filled = f"{variant}bg-{fill_token}"
                inked = f"{variant}text-{ink_token}"
                checked += 1
                if alpha == 100:
                    ratio = contrast(fill, ink)
                    if ratio < need:
                        failures.append({"where": where, "pair": f"{filled} + {inked}",
                                         "ratio": round(ratio, 2), "need": need, "why": why,
                                         "line": line.strip()[:200]})
                else:
                    # Translucent fill: the result depends on what is behind it, so read it
                    # against both candidate grounds and only call it a failure if neither works.
                    on_panel = contrast(over(fill, alpha, file_panel), ink)
                    on_ground = contrast(over(fill, alpha, file_ground), ink)
                    best = max(on_panel, on_ground)
                    entry = {"where": where, "pair": f"{filled}/{alpha} + {inked}",
                             "need": need, "line": line.strip()[:200]}
                    if best < need:
                        failures.append({**entry, "ratio": round(best, 2),
                                         "why": why + ", best case over surface/sunken"})
                    elif min(on_panel, on_ground) < need:
                        warnings.append({**entry, "ratio": round(min(on_panel, on_ground), 2),
                                         "why": "passes over one ground, fails over the other"})
    return checked, failures, warnings, unresolved


# ------------------------------------------------------------------- static accessibility

IMG_NO_ALT_RE = re.compile(r"<img\b(?![^>]*\balt\s*=)[^>]*>")
DIV_CLICK_RE = re.compile(r"<(div|span|li|td|tr)\b[^>]*\bonClick\b(?![^>]*\brole\s*=)")
ANCHOR_NO_HREF_RE = re.compile(r"<a\b(?![^>]*\bhref\s*=)[^>]*>")
BUTTON_RE = re.compile(r"<button\b([^>]*)>(.*?)</button>", re.S)
FIELD_RE = re.compile(r"<(input|select|textarea)\b([^>]*)/?>")
ARIA_LABEL_RE = re.compile(r"\baria-label(?:ledby)?\s*=")
LABELED_RE = re.compile(r"\b(id|name|aria-label|aria-labelledby|placeholder)\s*=")

# Elements that are pure decoration inside a button and never contribute a name.
DECORATION_RE = re.compile(r"^\s*(<svg\b.*?</svg>|<[A-Z][A-Za-z]*\b[^>]*/>|\{/\*.*?\*/\})\s*$", re.S)


def _line_of(text: str, index: int) -> int:
    return text[:index].count("\n") + 1


def audit_a11y(files: list[Path]):
    failures, warnings = [], []
    for path in files:
        text = strip_comments(path.read_text(encoding="utf-8"))
        rel = path.relative_to(path.parents[1])
        for match in IMG_NO_ALT_RE.finditer(text):
            failures.append({"where": f"{rel}:{_line_of(text, match.start())}",
                             "check": "img-without-alt",
                             "detail": match.group(0).strip()[:160]})
        for match in DIV_CLICK_RE.finditer(text):
            warnings.append({"where": f"{rel}:{_line_of(text, match.start())}",
                             "check": "click-on-non-interactive",
                             "detail": match.group(0).strip()[:160]})
        for match in ANCHOR_NO_HREF_RE.finditer(text):
            if "{..." in match.group(0):
                continue  # href may arrive through a spread; a static reader cannot say
            warnings.append({"where": f"{rel}:{_line_of(text, match.start())}",
                             "check": "anchor-without-href",
                             "detail": match.group(0).strip()[:160]})
        for match in BUTTON_RE.finditer(text):
            attrs, body = match.group(1), match.group(2)
            if ARIA_LABEL_RE.search(attrs) or "{..." in attrs:
                continue
            # A name can be text, or a nested element with its own label; only flag when the
            # whole body is decoration or interpolation with nothing readable in it.
            visible = re.sub(r"<[^>]+>", "", body)
            visible = re.sub(r"\{[^{}]*\}", "", visible)
            if visible.strip() or DECORATION_RE.match(body) is None:
                continue
            warnings.append({"where": f"{rel}:{_line_of(text, match.start())}",
                             "check": "control-without-accessible-name",
                             "detail": " ".join(body.split())[:160]})
        for match in FIELD_RE.finditer(text):
            attrs = match.group(2)
            # `<input {...rest} />` is a wrapper: the label, id and placeholder come from the
            # caller, and reporting the wrapper as unlabelled would be reporting the API.
            if "{..." in attrs or LABELED_RE.search(attrs):
                continue
            warnings.append({"where": f"{rel}:{_line_of(text, match.start())}",
                             "check": "field-without-label",
                             "detail": match.group(0).strip()[:160]})
    return failures, warnings


# --------------------------------------------------------------------------------- reporting

def main() -> int:
    here = Path(__file__).resolve().parents[1]          # apps/backoffice
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--app", default=str(here),
                        help="backoffice app root (default: the one this script lives in)")
    parser.add_argument("--strict", action="store_true", help="treat WARN as failure")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    app = Path(args.app).resolve()
    globals_css = app / "app" / "globals.css"
    if not globals_css.exists():
        print(f"health check: cannot find {globals_css}", file=sys.stderr)
        return 2

    palette = load_palette(globals_css)
    doc_palette = load_document_palette(globals_css)
    files = source_files(app / "app")
    checked, failures, warnings, unresolved = audit_contrast(files, palette, doc_palette)
    a11y_failures, a11y_warnings = audit_a11y(files)
    failures += a11y_failures
    warnings += a11y_warnings

    line_uses = sum(len(re.findall(r"(?:ring|border|divide|outline)-line(?:-strong)?\b",
                                   p.read_text(encoding="utf-8")))
                    for p in files)

    report = {
        "scanned": {"files": len(files), "pairs": checked, "palette_tokens": len(palette)},
        "failures": failures,
        "warnings": warnings,
        "unresolved_tokens": unresolved,
        "accepted_exceptions": {
            "hairlines": sorted(ACCEPTED_EXCEPTIONS), "uses": line_uses,
            "light_documents": sorted(doc_palette), "files": sum(
                1 for p in files if "print-doc" in p.read_text(encoding="utf-8")),
        },
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Admin accessibility health check - {app}")
        print(f"  scanned {len(files)} files, {checked} fill+ink pairs, "
              f"{len(palette)} palette tokens")
        if failures:
            print(f"\nFAIL ({len(failures)}):")
            for f in failures:
                if "ratio" in f:
                    print(f"  {f['where']}  {f['pair']}  {f['ratio']}:1 < {f['need']}:1  ({f['why']})")
                else:
                    print(f"  {f['where']}  {f['check']}  {f['detail']}")
        if warnings:
            print(f"\nWARN ({len(warnings)}):")
            for w in warnings:
                if "ratio" in w:
                    print(f"  {w['where']}  {w['pair']}  {w['ratio']}:1 < {w['need']}:1  ({w['why']})")
                else:
                    print(f"  {w['where']}  {w['check']}  {w['detail']}")
        if unresolved:
            print("\nUnresolved colour utilities (no token and no builtin):")
            for token, count in sorted(unresolved.items(), key=lambda kv: -kv[1]):
                print(f"  {token}  x{count}")
        print(f"\nAccepted exceptions: hairlines {', '.join(sorted(ACCEPTED_EXCEPTIONS))} "
              f"used {line_uses}x (recorded in globals.css; below the 3:1 non-text bar on purpose)")
        print(f"                      the light documents (packing slip / dispatch label / invoice) "
              f"resolve against the .print-doc ladder in {report['accepted_exceptions']['files']} file(s), "
              f"not the app palette")
        verdict = "FAIL" if failures or (args.strict and warnings) else "PASS"
        print(f"\n{verdict}: {len(failures)} failure(s), {len(warnings)} warning(s)"
              + ("" if not unresolved else f", {len(unresolved)} unresolved token(s)"))

    return 1 if failures or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
