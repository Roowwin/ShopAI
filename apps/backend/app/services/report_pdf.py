"""A minimal PDF writer: enough to typeset an accountant's report, and nothing else.

WHY HAND-ROLLED. There is no PDF library in this image (`requirements.txt` carries none), and
adding a dependency to draw a text table would be a supply-chain decision made on behalf of the
whole platform for one screen's export button. A PDF that contains Helvetica text and hairlines is
about a hundred lines of specification, and this is those hundred lines.

WHAT IT SUPPORTS, deliberately: A4 portrait, the two standard PDF base fonts, one text size per
run, horizontal rules, and multiple pages. No images, no wrapping beyond what the caller does, no
compression, no fonts embedded. Anything past that is a job for a real library.

THE PARTS THAT MUST BE EXACT, because a PDF fails as a whole rather than partially:
  * every object is offset-indexed by an `xref` table, so the byte offset of each `N 0 obj` must be
    the one written into the table - which is why the body is assembled first and measured after;
  * strings are escaped (`\\`, `(`, `)`) or a filename with a bracket produces a corrupt file;
  * the byte offsets count BYTES, not characters, so the output is assembled as bytes throughout.
"""

from dataclasses import dataclass, field

A4 = (595.28, 841.89)
MARGIN = 40.0
LINE_HEIGHT = 14.0


def escape(text: str) -> str:
    """A PDF string literal. Backslash first, then the two delimiters; anything outside Latin-1
    (a smart quote an operator pasted, an em dash) is transliterated rather than dropped, so a
    document never silently loses a character."""
    out = (text or "").replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    return "".join(ch if ord(ch) < 256 else "-" for ch in out)


@dataclass
class Page:
    runs: list[tuple[float, float, float, str, bool]] = field(default_factory=list)
    rules: list[tuple[float, float, float]] = field(default_factory=list)


class Pdf:
    """Collects pages of positioned text, then serialises a valid PDF."""

    def __init__(self, title: str = "Report"):
        self.title = title
        self.pages: list[Page] = [Page()]
        self.y = A4[1] - MARGIN
        self.page = self.pages[0]

    # -- layout ------------------------------------------------------------
    def new_page(self) -> None:
        self.pages.append(Page())
        self.page = self.pages[-1]
        self.y = A4[1] - MARGIN

    def space(self, lines: float = 1.0) -> None:
        self.y -= LINE_HEIGHT * lines

    def text(self, x: float, s: str, *, size: float = 10.0, bold: bool = False) -> None:
        self.page.runs.append((x, self.y, size, escape(s), bold))

    def row(self, cells: list[tuple[float, str]], *, bold: bool = False,
            size: float = 9.0) -> None:
        """One table row: (x, text) pairs, all on the current line."""
        for x, s in cells:
            self.text(x, s, size=size, bold=bold)
        self.space()

    def rule(self, y: float | None = None, x0: float = MARGIN,
             x1: float = A4[0] - MARGIN) -> None:
        self.page.rules.append((y if y is not None else self.y, x0, x1))

    def ensure(self, lines: float = 1.0) -> None:
        """Start a new page if the next `lines` would run off the bottom."""
        if self.y - LINE_HEIGHT * lines < MARGIN:
            self.new_page()

    # -- output ------------------------------------------------------------
    def _content(self, page: Page) -> bytes:
        out: list[str] = []
        for y, x0, x1 in page.rules:
            out.append(f"0.6 w {x0:.2f} {y:.2f} m {x1:.2f} {y:.2f} l S")
        for x, y, size, s, bold in page.runs:
            font = "/F2" if bold else "/F1"
            out.append(f"BT {font} {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({s}) Tj ET")
        return "\n".join(out).encode("latin-1", "replace")

    def to_bytes(self) -> bytes:
        # Objects: 1 catalog, 2 pages, 3..N+2 the pages, then the two fonts and one content stream
        # per page. Assembled first so the xref can carry real byte offsets.
        n_pages = len(self.pages)
        page_ids = [3 + i for i in range(n_pages)]
        font_1, font_2 = 3 + n_pages, 4 + n_pages
        content_ids = [5 + n_pages + i for i in range(n_pages)]
        objects: dict[int, bytes] = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            2: ("<< /Type /Pages /Kids [" + " ".join(f"{i} 0 R" for i in page_ids)
                + f"] /Count {n_pages} >>").encode(),
            font_1: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            font_2: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        }
        for i, page in enumerate(self.pages):
            objects[page_ids[i]] = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {A4[0]:.2f} {A4[1]:.2f}]"
                f" /Resources << /Font << /F1 {font_1} 0 R /F2 {font_2} 0 R >> >>"
                f" /Contents {content_ids[i]} 0 R >>").encode()
            body = self._content(page)
            objects[content_ids[i]] = (f"<< /Length {len(body)} >>\nstream\n").encode() + body + b"\nendstream"

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: dict[int, int] = {}
        for oid in sorted(objects):
            offsets[oid] = len(out)
            out += f"{oid} 0 obj\n".encode() + objects[oid] + b"\nendobj\n"
        start_xref = len(out)
        top = max(objects) + 1
        out += f"xref\n0 {top}\n".encode()
        out += b"0000000000 65535 f \n"
        for oid in range(1, top):
            if oid in offsets:
                out += f"{offsets[oid]:010d} 00000 n \n".encode()
            else:
                out += b"0000000000 65535 f \n"
        out += (f"trailer\n<< /Size {top} /Root 1 0 R >>\nstartxref\n{start_xref}\n"
                "%%EOF\n").encode()
        return bytes(out)
