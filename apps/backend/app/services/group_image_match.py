"""Which photograph, in a folder of them, belongs to which brand+model+grade.

THE RULE IS A SUBSET TEST, NOT A SIMILARITY SCORE, and that is a deliberate reading of this
codebase's own stance rather than a preference. Three separate places in this repo reject fuzzy
matching in almost the same words - `services/logistics.py` ("a fuzzier matcher would confidently
conflate the two"), `staff_imports.py` ("a fuzzy match in this direction would silently swallow a
grade the operator did...") - and there is no `difflib`, no `rapidfuzz` and no similarity helper
anywhere in it. A picture is a claim about what a shopper will receive, so the failure that matters
is not "we missed one" but "we confidently attached the wrong one".

    A file is a candidate for a group only when EVERY word of the MODEL appears in the filename,
    and the grade the filename claims - when it claims one - is the group's grade.

`latitude-5420_A.jpg` qualifies for *Dell / Latitude 5420 / A*: both `latitude` and `5420` are there,
and the marker says A. `latitude.jpg` qualifies for nothing, because `5420` is missing.
`latitude-5420_B.jpg` is EXCLUDED from the Grade A group rather than ranked below it, because
handing a Grade A shopper the Grade B photograph is the exact misrepresentation the grading scale
exists to prevent.

THE BRAND IS NOT REQUIRED, AND THAT WAS LEARNED RATHER THAN ASSUMED. The first cut demanded every
word of the brand AND the model, which is the stricter and more obvious rule - and it made the whole
feature return nothing, because people do not put "Dell" in the filename of a photograph of a
Latitude. A folder of `latitude-5420_A.jpg` would have matched no group at all. So the model is what
qualifies a file and the brand only RANKS it, which costs nothing: the operator is looking at the
picture before they accept it, and a suggestion that is merely less specific is a suggestion they
can see through.

THE FUNCTION IS ALLOWED TO MISS AND NEVER ALLOWED TO MISMATCH. Where the rule is unsure it returns
nothing and the operator assigns the photo by hand; there is no case where it guesses. That is why
a bare letter token is treated as a grade marker even though a model may legitimately contain one
("Galaxy Tab A"): the cost of being wrong about that is a suggestion that does not appear, which a
person can fix in one press, rather than a wrong photograph on a live product page, which nobody
would notice.

WHY THE GRADE IS THE HARD PART. A bare `a` appears inside lat**a**tude, **a**pple and c**a**rbon, so
"does the filename contain the letter A" hands every Grade A group a confident wrong answer. The
marker counts only as a WHOLE TOKEN - `_a`, `-a`, ` a `, `(a)`, or after the word `grade` - which is
what `tokens()` gives us for free: the `a` in `latitude` is part of the token `latitude`, and never
a token of its own.
"""

import re

# Only a KNOWN image extension is stripped. Splitting on the last dot would mangle a real model
# string that contains one - the imported catalogue has `13.3" FHD Touchscreen Assembly`, and a
# naive strip turns that into `13`.
_IMAGE_EXT = re.compile(r"\.(jpe?g|png|webp|gif|bmp|heic|tiff?)$", re.I)

_GRADE_LETTERS = ("A", "B", "C", "D")

# How many candidates the screen is offered. More than this is not a shortlist, it is a folder.
MAX_SUGGESTIONS = 5


def tokens(text: str | None) -> list[str]:
    """A filename or a brand/model string, as comparable lowercase tokens.

    Splits on everything that is not alphanumeric, so `Dell Latitude 5420`, `dell-latitude-5420`
    and `dell_latitude_5420` are the same three tokens and all three compare equal to each other.
    """
    s = _IMAGE_EXT.sub("", (text or "").strip())
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def grade_marker(filename: str | None) -> str | None:
    """The grade a filename claims, or None when it claims none.

    Two spellings count, and nothing else does: the word `grade` followed by a letter, and a letter
    standing as its own token. See the module docstring for why a substring test is not an option.
    """
    parts = tokens(filename)
    if not parts:
        return None
    for i, t in enumerate(parts):
        if t == "grade" and i + 1 < len(parts) and parts[i + 1] in ("a", "b", "c", "d"):
            return parts[i + 1].upper()
    for t in parts:
        if t in ("a", "b", "c", "d"):
            return t.upper()
    return None


def candidates(brand: str | None, model: str | None, grade: str | None,
               pool: list[dict]) -> list[dict]:
    """Rank the pool for one group. Pure: takes rows, returns rows, touches no database.

    `pool` is a list of `{"media_id", "filename", "uploaded_at"}` - the shape the pool read door
    returns - and `uploaded_at` may be a datetime or an ISO string. The result carries the tokens
    that matched, so the screen can say WHY it is offering a photograph instead of showing an
    unexplained thumbnail.
    """
    # The MODEL qualifies a file; the brand only ranks it. See the module docstring - requiring the
    # brand was the first cut and it matched nothing, because nobody names a photo "dell-...".
    wanted = tokens(model)
    if not wanted:
        return []
    wanted_set = set(wanted)
    brand_set = set(tokens(brand))
    grade = (grade or "").strip().upper()
    out: list[dict] = []
    for row in pool:
        name = row.get("filename") or ""
        have = tokens(name)
        have_set = set(have)
        # EVERY model word must be present. A file missing one is not a weaker match, it is a
        # different device: `latitude.jpg` is not a Latitude 5420 that we are less sure about.
        if not wanted_set.issubset(have_set):
            continue
        claimed = grade_marker(name)
        # A file that claims a DIFFERENT grade is dropped outright - not down-ranked. A file that
        # claims none is kept, because a folder of `latitude-5420.jpg` for a group that has only
        # one grade is a folder the operator named sensibly and the app should still be able to
        # offer.
        if claimed is not None and grade and claimed != grade:
            continue
        out.append({
            "media_id": row["media_id"],
            "filename": name,
            "grade_marker": claimed,
            "matched_tokens": sorted(wanted_set),
            # How much name is left over once the model is accounted for. Fewer extra words means a
            # more specific name, which is the tie-break below the grade.
            "extra_tokens": len(have_set - wanted_set),
            "uploaded_at": row.get("uploaded_at"),
            "_exact_grade": claimed == grade and grade != "",
            "_brand": len(brand_set & have_set),
        })
    # Deterministic throughout: a file that NAMES the grade beats one that is merely silent about
    # it, then the brand (when the folder does carry it), then the most specific name, then the
    # newest, then the id - so two runs over the same folder return the same order and a test can
    # pin it.
    out.sort(key=lambda c: (not c["_exact_grade"], -c["_brand"], c["extra_tokens"],
                            _sortable_time(c["uploaded_at"]), -c["media_id"]))
    for c in out:
        c.pop("_exact_grade", None)
        c.pop("_brand", None)
    return out[:MAX_SUGGESTIONS]


def _sortable_time(value) -> float:
    """Newest first, for a value that may be a datetime, an ISO string, or absent."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return -float(value)
    try:
        return -value.timestamp()
    except AttributeError:
        try:
            from datetime import datetime
            return -datetime.fromisoformat(str(value)).timestamp()
        except ValueError:
            return 0.0
