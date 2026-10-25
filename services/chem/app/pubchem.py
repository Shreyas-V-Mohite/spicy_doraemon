import json
import re
from pathlib import Path

import pubchempy as pcp

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"


class MoleculeNotFound(Exception):
    pass


class PubChemUnavailable(Exception):
    pass


def normalize(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def _cache_path(query: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", normalize(query)).strip("-")
    return CACHE_DIR / f"{slug}.json"


def fetch_sdf(query: str) -> tuple[int, str]:
    """Return (cid, 3D SDF text) for a compound name.

    PubChem is read at most once per name; the result is cached on disk and
    the demo molecules ship in the repo, so the demo works offline.
    """
    path = _cache_path(query)
    if path.exists():
        data = json.loads(path.read_text())
        return data["cid"], data["sdf"]

    try:
        cids = pcp.get_cids(normalize(query), "name")
        if not cids:
            raise MoleculeNotFound(query)
        cid = cids[0]
        sdf = pcp.get_sdf(cid, record_type="3d")
    except MoleculeNotFound:
        raise
    except Exception as exc:  # network errors, PubChem outages
        raise PubChemUnavailable(str(exc)) from exc

    if not sdf:
        raise MoleculeNotFound(f"{query} has no 3D record")

    CACHE_DIR.mkdir(exist_ok=True)
    path.write_text(json.dumps({"cid": cid, "sdf": sdf}))
    return cid, sdf
