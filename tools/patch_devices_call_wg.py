from __future__ import annotations
from pathlib import Path
import re, sys

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found:", p, file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgcall.bak")
bak.write_text(src, encoding="utf-8")

# 1) import wgAddPeer/wgRemovePeer
if 'from "../lib/wg-node"' not in src:
    if 'import { env } from "../env";' in src:
        src = src.replace(
            'import { env } from "../env";\n',
            'import { env } from "../env";\nimport { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
            1
        )
    else:
        # fallback: add near top after other imports
        m = re.search(r'(\A(?:import[^\n]*\n)+)', src)
        if m:
            src = src[:m.end()] + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + src[m.end():]
        else:
            src = 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + src

# 2) Insert wgAddPeer before returning node/peer in provision
if "wgAddPeer(" not in src:
    m = re.search(r"return\s+\{\s*\n\s*node:\s*\{.*?\n\s*\},\s*\n\s*peer:\s*\{", src, re.S)
    if not m:
        print("ERR: cannot locate provision return { node, peer } block", file=sys.stderr)
        sys.exit(3)

    insertion = (
        "      // apply on WireGuard node (idempotent)\n"
        "      await wgAddPeer({\n"
        "        publicKey: peer.publicKey,\n"
        "        allowedIp: peer.allowedIp,\n"
        "        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },\n"
        "      });\n\n"
    )
    src = src[:m.start()] + insertion + src[m.start():]

# 3) Insert wgRemovePeer after peer update in revoke
if "wgRemovePeer(" not in src:
    # add after first prisma.peer.update(...) line
    src2, n = re.subn(
        r"(await\s+prisma\.peer\.update\([^\;]+\);\s*\n)",
        r"\1\n      // remove from WireGuard node (best effort)\n      await wgRemovePeer({\n        publicKey: peer.publicKey,\n        node: { sshHost: node.sshHost, sshUser: node.sshUser, wgInterface: node.wgInterface },\n      });\n",
        src,
        count=1,
        flags=re.S
    )
    if n == 0:
        print("WARN: prisma.peer.update(...) not found to inject wgRemovePeer; skipping revoke injection", file=sys.stderr)
    else:
        src = src2

p.write_text(src, encoding="utf-8")
print("OK: Patched devices.ts (wg calls).")
print("Backup:", bak)
