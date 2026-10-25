from collections import Counter

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pubchem import fetch_sdf

client = TestClient(app)

DEMO = ["ethanol", "acetic acid", "aspirin"]


def sdf_elements(sdf: str) -> list[str]:
    """Elements in atom-block order, parsed without RDKit."""
    lines = sdf.splitlines()
    n_atoms = int(lines[3][0:3])
    return [lines[4 + i][31:34].strip() for i in range(n_atoms)]


@pytest.mark.parametrize("name", DEMO)
def test_atom_indices_match_sdf_order(name):
    body = client.get("/molecule", params={"query": name}).json()
    assert [a["element"] for a in body["atoms"]] == sdf_elements(body["sdf"])
    assert [a["index"] for a in body["atoms"]] == list(range(len(body["atoms"])))


@pytest.mark.parametrize(
    "name,group,elements",
    [
        ("ethanol", "hydroxyl", {"C": 1, "O": 1, "H": 1}),
        ("acetic acid", "carboxylic_acid", {"C": 1, "O": 2, "H": 1}),
        ("aspirin", "carboxylic_acid", {"C": 1, "O": 2, "H": 1}),
        ("aspirin", "ester", {"C": 3, "O": 2}),
    ],
)
def test_highlight_indices_point_at_the_group(name, group, elements):
    body = client.get("/highlight", params={"query": name, "group_id": group}).json()
    atoms = body["atoms"]
    assert len(body["highlight"]["matches"]) == 1
    picked = Counter(atoms[i]["element"] for i in body["highlight"]["indices"])
    assert dict(picked) == elements


def test_unverifiable_highlights_are_refused():
    r = client.get("/highlight", params={"query": "ethanol", "group_id": "ester"})
    assert (r.status_code, r.json()["detail"]) == (404, "group_not_in_molecule")
    r = client.get("/highlight", params={"query": "ethanol", "group_id": "made_up"})
    assert (r.status_code, r.json()["detail"]) == (422, "unknown_group")


def test_cache_key_ignores_case_and_spacing():
    assert fetch_sdf("  Acetic   ACID ") == fetch_sdf("acetic acid")


def test_groups_endpoint_lists_the_whitelist():
    assert len(client.get("/groups").json()) == 20
