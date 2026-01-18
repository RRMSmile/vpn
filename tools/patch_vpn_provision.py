from __future__ import annotations
from pathlib import Path

p = Path("apps/api/src/lib/vpn-provision.ts")
src = p.read_text(encoding="utf-8")

bak = p.with_suffix(p.suffix + ".bak")
bak.write_text(src, encoding="utf-8")

changed = False

# 1) Ensure Node create has name
needle = "create: {\n      id: env.WG_NODE_ID,\n"
if needle in src and "name: env.WG_NODE_ID," not in src:
    src = src.replace(needle, "create: {\n      id: env.WG_NODE_ID,\n      name: env.WG_NODE_ID,\n", 1)
    changed = True

# 2) Ensure ProvisionInputSchema export exists (for routes/vpn.ts)
if "export const ProvisionInputSchema" not in src:
    insert_after = "function getEnv() {\n  return Env.parse(process.env);\n}\n"
    if insert_after in src:
        block = (
            "\nexport const ProvisionInputSchema = z.object({\n"
            "  publicKey: z.string(),\n"
            "});\n"
        )
        src = src.replace(insert_after, insert_after + block, 1)
        changed = True
    else:
        raise SystemExit("Cannot find insertion point after getEnv()")

# 3) Back-compat exports expected by src/routes/vpn.ts
if "export const provisionIosPeer" not in src:
    # append near bottom, before default export if possible
    marker = "export default { provision, revoke };"
    alias_block = (
        "\n// Back-compat for existing route imports\n"
        "export const provisionIosPeer = provision;\n"
        "export const revokePeer = revoke;\n"
    )
    if marker in src:
        src = src.replace(marker, alias_block + "\n" + marker, 1)
        changed = True
    else:
        # fallback: append to end
        src = src + "\n" + alias_block
        changed = True

if not changed:
    print("No changes needed (already patched).")
else:
    p.write_text(src, encoding="utf-8")
    print("Patched OK.")
    print(f"Backup: {bak}")
