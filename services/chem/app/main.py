from fastapi import FastAPI, HTTPException

from .groups import GROUPS
from .molecule import (
    EmbeddingFailed,
    MoleculeTooLarge,
    UnparsableMolecule,
    load_payload,
)
from .pubchem import MoleculeNotFound, PubChemUnavailable

app = FastAPI(title="Chemistry service")


def _payload(query: str | None, smiles: str | None) -> dict:
    if (query is None) == (smiles is None):
        raise HTTPException(400, detail="give_query_or_smiles")
    try:
        return load_payload(query=query, smiles=smiles)
    except MoleculeNotFound:
        raise HTTPException(404, detail="molecule_not_found")
    except UnparsableMolecule:
        raise HTTPException(422, detail="molecule_unparsable")
    except MoleculeTooLarge:
        raise HTTPException(422, detail="molecule_too_large")
    except EmbeddingFailed:
        raise HTTPException(422, detail="embedding_failed")
    except PubChemUnavailable:
        raise HTTPException(502, detail="pubchem_unavailable")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/groups")
def groups() -> dict:
    """The functional groups that can be detected and highlighted."""
    return {gid: g["label"] for gid, g in GROUPS.items()}


@app.get("/molecule")
def molecule(query: str | None = None, smiles: str | None = None) -> dict:
    return _payload(query, smiles)


@app.get("/highlight")
def highlight(
    group_id: str, query: str | None = None, smiles: str | None = None
) -> dict:
    """Molecule payload plus verified atom indices for one functional group.

    Unknown group or no match means the highlight cannot be verified, so
    callers must not publish it.
    """
    if group_id not in GROUPS:
        raise HTTPException(422, detail="unknown_group")
    payload = _payload(query, smiles)
    matches = payload["groups"].get(group_id)
    if not matches:
        raise HTTPException(404, detail="group_not_in_molecule")
    return {
        **payload,
        "highlight": {
            "group_id": group_id,
            "label": GROUPS[group_id]["label"],
            "matches": matches,
            "indices": sorted({i for m in matches for i in m}),
        },
    }
