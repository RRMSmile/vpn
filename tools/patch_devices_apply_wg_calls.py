from __future__ import annotations
from pathlib import Path
import re, sys

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found:", p, file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgapply.bak")
bak.write_text(src, encoding="utf-8")

changed = False

# 1) ensure import exists
if 'from "../lib/wg-node"' not in src:
    # insert after env import if exists
    if 'import { env } from "../env";' in src:
        src = src.replace(
            'import { env } from "../env";\n',
            'import { env } from "../env";\nimport { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
            1
        )
        changed = True
    else:
        # fallback: add after import block
        m = re.search(r'(\A(?:import[^\n]*\n)+)', src)
        if not m:
            print("ERR: cannot locate import block", file=sys.stderr)
            sys.exit(3)
        src = src[:m.end()] + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + src[m.end():]
        changed = True

# Helpers: locate route blocks by path fragment
def patch_block(route_path: str, injector: str) -> None:
    global src, changed
    idx = src.find(route_path)
    if idx < 0:
        print(f"ERR: cannot find route path marker: {route_path}", file=sys.stderr)
        sys.exit(4)

    # Take a slice from route marker onward and find handler end by matching ");" for app.<method>(..., async (...) => { ... })
    tail = src[idx:]
    # crude but reliable: find the first occurrence of "\n  );" after marker (route registration end)
    end = tail.find("\n  );")
    if end < 0:
        end = tail.find("\n);")
    if end < 0:
        print(f"ERR: cannot find end of route registration for: {route_path}", file=sys.stderr)
        sys.exit(5)

    block = tail[:end+4]

    if injector.strip() in block:
        return  # already patched

    # inject BEFORE the final "return" in handler if possible, else before route close
    # preference: insert before "return reply.send" or "return {"
    ins_pos = None
    m = re.search(r"\n\s*return\s+reply\.send\(", block)
    if m:
        ins_pos = m.start()
    else:
        m = re.search(r"\n\s*return\s+\{", block)
        if m:
            ins_pos = m.start()
    if ins_pos is None:
        # fallback: insert near end
        ins_pos = len(block) - 4

    block2 = block[:ins_pos] + "\n" + injector.rstrip() + "\n" + block[ins_pos:]
    src = src[:idx] + block2 + tail[end+4:]
    changed = True

# 2) provision: call wgAddPeer()
patch_block(
    "/v1/devices/:deviceId/provision",
    r"""
      // APPLY TO WG NODE (idempotent best-effort)
      // If this fails, we rollback in DB to avoid "db says active but wg doesn't"
      try {
        await wgAddPeer({
          sshHost: node.sshHost,
          sshUser: node.sshUser,
          wgInterface: node.wgInterface,
          publicKey: peer.publicKey,
          allowedIp: peer.allowedIp,
        } as any);
      } catch (e) {
        // rollback: mark peer revoked (soft)
        await prisma.peer.update({
          where: { id: peer.id },
          data: { revokedAt: new Date() },
        }).catch(() => {});
        throw e;
      }
""".strip("\n")
)

# 3) revoke: call wgRemovePeer()
patch_block(
    "/v1/devices/:deviceId/revoke",
    r"""
      // REMOVE FROM WG NODE (idempotent best-effort)
      try {
        await wgRemovePeer({
          sshHost: node.sshHost,
          sshUser: node.sshUser,
          wgInterface: node.wgInterface,
          publicKey: peer.publicKey,
        } as any);
      } catch (_) {
        // do not fail revoke if peer already absent on node
      }
""".strip("\n")
)

if not changed:
    print("No changes needed.")
else:
    p.write_text(src, encoding="utf-8")
    print("Patched devices.ts with wgAddPeer/wgRemovePeer calls OK.")
    print(f"Backup: {bak}")
