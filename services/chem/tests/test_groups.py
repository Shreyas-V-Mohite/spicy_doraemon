import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# One reference molecule per group, as SMILES, and what it must contain.
REFERENCE = {
    "hydroxyl": "CCO",
    "phenol": "Oc1ccccc1",
    "ether": "CCOCC",
    "aldehyde": "CC=O",
    "ketone": "CC(=O)C",
    "carboxylic_acid": "CC(=O)O",
    "ester": "CC(=O)OC",
    "anhydride": "CC(=O)OC(C)=O",
    "acyl_halide": "CC(=O)Cl",
    "amide": "CC(=O)N",
    "amine_primary": "CCN",
    "amine_secondary": "CCNC",
    "amine_tertiary": "CCN(C)C",
    "nitrile": "CC#N",
    "nitro": "C[N+](=O)[O-]",
    "thiol": "CCS",
    "alkyl_halide": "CCBr",
    "alkene": "C=C",
    "alkyne": "C#C",
    "aromatic_ring": "c1ccccc1",
}


def detected(smiles: str) -> set[str]:
    r = client.get("/molecule", params={"smiles": smiles})
    assert r.status_code == 200, r.text
    return set(r.json()["groups"])


def test_there_is_a_reference_molecule_for_every_group():
    assert set(client.get("/groups").json()) == set(REFERENCE)


@pytest.mark.parametrize("group,smiles", REFERENCE.items())
def test_each_group_is_found_in_its_reference_molecule(group, smiles):
    assert group in detected(smiles)


# Look-alikes that must NOT be reported as the group on the right.
@pytest.mark.parametrize(
    "smiles,absent",
    [
        ("CC(=O)OC", {"ether", "ketone", "carboxylic_acid", "anhydride", "hydroxyl"}),
        ("CC(=O)OC(C)=O", {"ester", "ether", "ketone"}),
        ("CC(=O)O", {"hydroxyl", "ester", "ketone"}),
        ("CC(=O)N", {"amine_primary", "amine_secondary", "amine_tertiary", "ketone"}),
        ("CCOCC", {"ester", "hydroxyl"}),
        ("CCO", {"phenol", "ether", "carboxylic_acid"}),
        ("Oc1ccccc1", {"hydroxyl"}),
        ("CC=O", {"ketone"}),
        ("CC(=O)C", {"aldehyde"}),
        ("CCN", {"amide", "amine_secondary"}),
        ("CCNC", {"amine_primary", "amine_tertiary"}),
        ("CCN(C)C", {"amine_primary", "amine_secondary"}),
        ("C[N+](=O)[O-]", {"amine_primary", "amine_secondary", "amine_tertiary", "amide"}),
        ("c1ccccc1", {"alkene"}),
    ],
)
def test_look_alikes_are_not_confused(smiles, absent):
    assert not (detected(smiles) & absent)


def test_a_real_molecule_reports_all_of_its_groups():
    # Aspirin, from PubChem (cached): an acid, an ester and an aromatic ring.
    r = client.get("/molecule", params={"query": "aspirin"}).json()
    assert {"carboxylic_acid", "ester", "aromatic_ring"} <= set(r["groups"])
    assert not ({"anhydride", "ketone", "ether", "phenol"} & set(r["groups"]))


def test_labels_are_returned_for_detected_groups_only():
    r = client.get("/molecule", params={"smiles": "CC(=O)O"}).json()
    assert r["group_labels"] == {"carboxylic_acid": "Carboxylic acid"}


def sdf_elements(sdf: str) -> list[str]:
    lines = sdf.splitlines()
    n = int(lines[3][0:3])
    return [lines[4 + i][31:34].strip() for i in range(n)]


@pytest.mark.parametrize("smiles", ["CC(=O)Oc1ccccc1C(=O)O", "CCN(C)C", "C[N+](=O)[O-]"])
def test_smiles_atom_indices_match_the_sdf_order(smiles):
    body = client.get("/molecule", params={"smiles": smiles}).json()
    assert [a["element"] for a in body["atoms"]] == sdf_elements(body["sdf"])
    assert body["cid"] is None


def test_highlight_by_smiles_points_at_the_group():
    body = client.get(
        "/highlight", params={"smiles": "CC(=O)O", "group_id": "carboxylic_acid"}
    ).json()
    elements = sorted(body["atoms"][i]["element"] for i in body["highlight"]["indices"])
    assert elements == ["C", "H", "O", "O"]


@pytest.mark.parametrize(
    "params,code,detail",
    [
        ({"smiles": "not a smiles"}, 422, "molecule_unparsable"),
        ({"smiles": "C(C"}, 422, "molecule_unparsable"),
        ({"smiles": "C" * 150}, 422, "molecule_too_large"),
        ({"smiles": "C" * 300}, 422, "molecule_unparsable"),
        ({}, 400, "give_query_or_smiles"),
        ({"smiles": "CCO", "query": "ethanol"}, 400, "give_query_or_smiles"),
    ],
)
def test_bad_input_is_refused_with_a_reason(params, code, detail):
    r = client.get("/molecule", params=params)
    assert (r.status_code, r.json()["detail"]) == (code, detail)


def test_unverifiable_highlight_is_refused_for_smiles_too():
    r = client.get("/highlight", params={"smiles": "CCO", "group_id": "ester"})
    assert (r.status_code, r.json()["detail"]) == (404, "group_not_in_molecule")
