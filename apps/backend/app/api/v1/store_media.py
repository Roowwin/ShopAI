"""The shop's door onto product photography: one image, by opaque id, with no credential.

WHY IT IS PUBLIC, AND WHY IT IS NARROW. A catalogue tile and a product page render
`products.image_url` in a plain `<img>`, which carries no Authorization header, so an image the
shop shows must be readable without a session. That is the whole reason this door exists: every
other media route in this API (`/staff/assets/{id}/images/{iid}/raw`, the product-media raw read)
sits behind the staff bearer token, and the backoffice previews them by fetching into a blob URL
precisely because a bare `<img>` cannot.

Being public, it is kept to the smallest set of rows that have a reason to be seen:

  * ONLY rows a `product_group` points at. `media_objects` also holds unit photographs and RMA
    defect photographs, which are nobody's business outside the building - and an id space that
    answered for those would make every upload guessable-in-principle rather than unguessable.
  * ONLY by `public_id`, never by the row id. A sequential id is not a secret and must never be
    treated as one; the UUID is the address because it is not enumerable.
  * MUTATING METHODS ARE NOT ROUTED HERE at all, so there is no write for a mis-scoped request to
    reach. This door reads bytes and returns them.

THE ADDRESS IS SHOP-RELATIVE BY CONSTRUCTION. `services/media.py:public_address` mints
`/media/<uuid>`, nginx serves that prefix on the SHOP vhost, and the storefront's CSP
(`img-src 'self' data:`) admits it because it is the same origin as the page. Nothing here answers
on the API host in a way any page depends on; if a client reached this route directly it would get
the same bytes, which is not a leak - it is the same public photograph, one hop shorter.

CACHING IS FOREVER BECAUSE THE BYTES NEVER CHANGE. A group has one image and replacing it writes a
NEW `media_objects` row with a NEW public_id, so a given id always names the same photograph. That
is what makes `immutable` honest here rather than a hopeful header.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text

from app.core.db import get_db

router = APIRouter(prefix="/store", tags=["store-media"])

YEAR_SECONDS = 31536000


@router.get("/media/{public_id}")
async def store_media(public_id: str, db=Depends(get_db)):
    """The bytes of one product-group photograph. Public, immutable, and named by an opaque id."""
    # Parsed before it reaches SQL: the column is `uuid`, so a malformed address would be a cast
    # error and a 500 - and "no such photograph" is the truthful answer to an address that is not
    # one, not a server fault.
    try:
        key = str(uuid.UUID(public_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="no such image")
    row = (await db.execute(text("""
        SELECT mo.bytes, mo.content_type, mo.byte_size
        FROM media_objects mo
        WHERE mo.public_id = CAST(:p AS uuid)
          AND EXISTS (SELECT 1 FROM product_groups g WHERE g.media_id = mo.id)
    """), {"p": key})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="no such image")
    return Response(
        content=bytes(row["bytes"]),
        media_type=row["content_type"],
        headers={
            "Cache-Control": f"public, max-age={YEAR_SECONDS}, immutable",
            "Content-Length": str(row["byte_size"]),
            # The bytes for an id are fixed for the life of the row, so the content itself is a
            # sufficient validator. Not a security header - a cache one.
            "ETag": '"' + key + '"',
        },
    )
