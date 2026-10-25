from rdkit import Chem

# The only functional groups the copilot may name. Patterns include the
# hydrogen on the acidic or hydroxyl oxygen, so it highlights with the group.
GROUPS: dict[str, dict[str, str]] = {
    "hydroxyl": {
        "label": "Hydroxyl (alcohol)",
        "smarts": "[CX4][OX2][#1]",
    },
    "carboxylic_acid": {
        "label": "Carboxylic acid",
        "smarts": "[CX3](=[OX1])[OX2][#1]",
    },
    "ester": {
        "label": "Ester",
        "smarts": "[#6][CX3](=[OX1])[OX2H0][#6]",
    },
}

_PATTERNS = {gid: Chem.MolFromSmarts(g["smarts"]) for gid, g in GROUPS.items()}


def find_groups(mol: Chem.Mol) -> dict[str, list[list[int]]]:
    """Atom-index matches per supported group, only for groups that match.

    Indices are positions in the molecule's atom list, which RDKit keeps
    identical to the atom block order of the SDF it was parsed from.
    """
    found: dict[str, list[list[int]]] = {}
    for gid, pattern in _PATTERNS.items():
        matches = [sorted(m) for m in mol.GetSubstructMatches(pattern)]
        if matches:
            found[gid] = matches
    return found
