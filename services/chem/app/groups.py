from rdkit import Chem

# Functional groups the stage can highlight. Molecules always carry explicit
# hydrogens (PubChem 3D records include them; SMILES input gets AddHs), so a
# pattern can include the O-H, N-H or S-H hydrogen that is part of the group.
# Heavy-atom patterns exclude look-alikes (an ether oxygen next to a carbonyl
# is an ester, an amine nitrogen next to a carbonyl is an amide, and so on).
_NOT_AMIDE_N = "[NX3;!$(N[CX3]=[OX1])]"

GROUPS: dict[str, dict[str, str]] = {
    "hydroxyl": {"label": "Hydroxyl (alcohol)", "smarts": "[CX4][OX2][#1]"},
    "phenol": {"label": "Phenol", "smarts": "[c][OX2][#1]"},
    "ether": {
        "label": "Ether",
        "smarts": "[#6;!$([#6]=[#8])][OX2;H0][#6;!$([#6]=[#8])]",
    },
    "aldehyde": {"label": "Aldehyde", "smarts": "[CX3](=[OX1])([#6])[#1]"},
    "ketone": {"label": "Ketone", "smarts": "[#6][CX3](=[OX1])[#6]"},
    "carboxylic_acid": {
        "label": "Carboxylic acid",
        "smarts": "[CX3](=[OX1])[OX2][#1]",
    },
    "ester": {
        "label": "Ester",
        "smarts": "[#6][CX3](=[OX1])[OX2H0][#6;!$([CX3]=[OX1])]",
    },
    "anhydride": {
        "label": "Acid anhydride",
        "smarts": "[CX3](=[OX1])[OX2][CX3](=[OX1])",
    },
    "acyl_halide": {
        "label": "Acyl halide",
        "smarts": "[CX3](=[OX1])[F,Cl,Br,I]",
    },
    "amide": {"label": "Amide", "smarts": "[CX3](=[OX1])[NX3]"},
    "amine_primary": {
        "label": "Primary amine",
        "smarts": f"[#6]{_NOT_AMIDE_N}([#1])[#1]",
    },
    "amine_secondary": {
        "label": "Secondary amine",
        "smarts": f"[#6]{_NOT_AMIDE_N}([#1])[#6]",
    },
    "amine_tertiary": {
        "label": "Tertiary amine",
        "smarts": f"[#6]{_NOT_AMIDE_N}([#6])[#6]",
    },
    "nitrile": {"label": "Nitrile", "smarts": "[CX2]#[NX1]"},
    "nitro": {
        "label": "Nitro group",
        "smarts": "[#6][N;X3;$([N+](=O)[O-]),$(N(=O)=O)](~[OX1])~[OX1]",
    },
    "thiol": {"label": "Thiol", "smarts": "[#6][SX2][#1]"},
    "alkyl_halide": {"label": "Alkyl halide", "smarts": "[CX4][F,Cl,Br,I]"},
    "alkene": {"label": "Alkene", "smarts": "[CX3]=[CX3]"},
    "alkyne": {"label": "Alkyne", "smarts": "[CX2]#[CX2]"},
    "aromatic_ring": {
        "label": "Aromatic ring",
        "smarts": "[a;r6]1[a;r6][a;r6][a;r6][a;r6][a;r6]1",
    },
}

_PATTERNS = {}
for _gid, _g in GROUPS.items():
    _pattern = Chem.MolFromSmarts(_g["smarts"])
    if _pattern is None:  # a typo here should fail at import, not at match time
        raise ValueError(f"Bad SMARTS for {_gid}: {_g['smarts']}")
    _PATTERNS[_gid] = _pattern


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
