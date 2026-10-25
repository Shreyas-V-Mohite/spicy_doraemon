from rdkit import Chem

from .groups import find_groups
from .pubchem import fetch_sdf


class UnparsableMolecule(Exception):
    pass


def load_payload(query: str) -> dict:
    """The molecule payload the viewer renders and highlights refer to.

    Every atom index anywhere in the payload is a position in `atoms`.
    """
    cid, sdf = fetch_sdf(query)
    mol = Chem.MolFromMolBlock(sdf, removeHs=False)
    if mol is None:
        raise UnparsableMolecule(query)

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
    return {
        "query": query,
        "cid": cid,
        "smiles": Chem.MolToSmiles(Chem.RemoveHs(mol)),
        "sdf": sdf,
        "atoms": atoms,
        "bonds": bonds,
        "groups": find_groups(mol),
    }
