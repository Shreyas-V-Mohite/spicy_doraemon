from rdkit import Chem
from rdkit.Chem import AllChem

from .groups import GROUPS, find_groups
from .pubchem import fetch_sdf

MAX_SMILES_CHARS = 200
MAX_HEAVY_ATOMS = 100


class UnparsableMolecule(Exception):
    pass


class MoleculeTooLarge(Exception):
    pass


class EmbeddingFailed(Exception):
    pass


def _mol_from_smiles(smiles: str) -> tuple[Chem.Mol, str]:
    """Build a 3D structure from SMILES, for molecules PubChem lacks in 3D."""
    smiles = smiles.strip()
    if not smiles or len(smiles) > MAX_SMILES_CHARS or any(c.isspace() for c in smiles):
        raise UnparsableMolecule(smiles[:40])
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise UnparsableMolecule(smiles[:40])
    if mol.GetNumHeavyAtoms() > MAX_HEAVY_ATOMS:
        raise MoleculeTooLarge(smiles[:40])
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    if AllChem.EmbedMolecule(mol, params) != 0:
        raise EmbeddingFailed(smiles[:40])
    try:
        AllChem.MMFFOptimizeMolecule(mol, maxIters=500)
    except Exception:
        pass  # an unoptimised conformer is still a valid structure
    # Atoms keep their RDKit order in the block, so indices carry over.
    return mol, Chem.MolToMolBlock(mol) + "$$$$\n"


def load_payload(query: str | None = None, smiles: str | None = None) -> dict:
    """The molecule payload the viewer renders and highlights refer to.

    Every atom index anywhere in the payload is a position in `atoms`.
    Give a compound name (looked up on PubChem) or a SMILES string.
    """
    if smiles is not None:
        mol, sdf = _mol_from_smiles(smiles)
        cid = None
        label = smiles.strip()
    else:
        cid, sdf = fetch_sdf(query or "")
        mol = Chem.MolFromMolBlock(sdf, removeHs=False)
        if mol is None:
            raise UnparsableMolecule(query)
        label = query or ""

    conf = mol.GetConformer()
    atoms = []
    for atom in mol.GetAtoms():
        pos = conf.GetAtomPosition(atom.GetIdx())
        atoms.append(
            {
                "index": atom.GetIdx(),
                "element": atom.GetSymbol(),
                "x": pos.x,
                "y": pos.y,
                "z": pos.z,
            }
        )
    bonds = [
        {
            "begin": b.GetBeginAtomIdx(),
            "end": b.GetEndAtomIdx(),
            "order": b.GetBondTypeAsDouble(),
        }
        for b in mol.GetBonds()
    ]
    groups = find_groups(mol)
    return {
        "query": label,
        "cid": cid,
        "smiles": Chem.MolToSmiles(Chem.RemoveHs(mol)),
        "sdf": sdf,
        "atoms": atoms,
        "bonds": bonds,
        "groups": groups,
        "group_labels": {gid: GROUPS[gid]["label"] for gid in groups},
    }
