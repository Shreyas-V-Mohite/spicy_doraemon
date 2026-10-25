"""Warm the on-disk cache with the demo molecules: uv run python -m app.prefetch"""
from .pubchem import fetch_sdf

for name in ["ethanol", "acetic acid", "aspirin"]:
    cid, sdf = fetch_sdf(name)
    print(name, cid, len(sdf), "bytes")
