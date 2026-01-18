from __future__ import annotations
from pathlib import Path
import re, sys

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found", file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgapply3.bak")
bak.write_text(src, encoding="utf-8")

def ensure_import(src: str) -> str:
    if 'from "../lib/wg-node"' in src:
        return src
    if 'import { env } from "../env";' in src:
        return src.replace(
            'import { env } from "../env";\n',
            'import { env } from "../env";\nimport { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
            1
        )
    m = re.search(r'(\A(?:import[^\n]*\n)+)', src)
    if not m:
        raise RuntimeError("cannot find import block")
    return src[:m.end()] + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + src[m.end():]

def extract_route_block(src: str, marker: str) -> tuple[int,int,str]:
    i = src.find(marker)
    if i < 0:
        raise RuntimeError(f"cannot find marker: {marker}")
    # find "app.post(" start before marker
    start = src.rfind("app.post(", 0, i)
    if start < 0:
        raise RuntimeError(f"cannot find app.post before marker: {marker}")

    # parse until the statement ends with top-level ';'
    par = br = sq = 0
    in_s = None
    esc = False
    in_line = False
    in_blk = False

    j = start
    while j < len(src):
        c = src[j]
        n = src[j+1] if j+1 < len(src) else ""

        if in_line:
            if c == "\n":
                in_line = False
            j += 1
            continue
        if in_blk:
            if c == "*" and n == "/":
                in_blk = False
                j += 2
                continue
            j += 1
            continue

        if in_s:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == in_s:
                in_s = None
            j += 1
            continue

        if c == "/" and n == "/":
            in_line = True
            j += 2
            continue
        if c == "/" and n == "*":
            in_blk = True
            j += 2
            continue

        if c in ("'", '"', "`"):
            in_s = c
            j += 1
            continue

        if c == "(":
            par += 1
        elif c == ")":
            par -= 1
        elif c == "{":
            br += 1
        elif c == "}":
            br -= 1
        elif c == "[":
            sq += 1
        elif c == "]":
            sq -= 1

        if c == ";" and par == 0 and br == 0 and sq == 0:
            end = j + 1
            return start, end, src[start:end]
        j += 1

    raise RuntimeError(f"cannot find end ';' for route block: {marker}")

def inject_after_peer_decl(block: str, inject: str) -> str:
    # find first "const peer =" or "let peer =" within block
    m = re.search(r'\n(\s*)(const|let)\s+peer\s*=\s*', block)
    if not m:
        raise RuntimeError("cannot find 'const peer =' in route block")
    indent = m.group(1)

    # find end of that statement (next ';' at same nesting level) starting from m.start()
    start_pos = m.start()
    sub = block[start_pos:]
    # simple: first semicolon after this position
    semi = sub.find(";")
    if semi < 0:
        raise RuntimeError("cannot find ';' after peer declaration")
    insert_at = start_pos + semi + 1

    snippet = "\n" + "\n".join(indent + line if line else "" for line in inject.splitlines()) + "\n"
    if inject.strip() in block:
        return block
    return block[:insert_at] + snippet + block[insert_at:]

src = ensure_import(src)

# --- provision block patch ---
prov_marker = 'app.post("/v1/devices/:id/provision"'
ps, pe, prov = extract_route_block(src, prov_marker)
prov_inject = """// apply peer to WireGuard node (ssh)
await wgAddPeer({
  publicKey: peer.publicKey,
  allowedIp: peer.allowedIp,
  node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
});"""
prov2 = inject_after_peer_decl(prov, prov_inject)
src = src[:ps] + prov2 + src[pe:]

# --- revoke block patch ---
rev_marker = 'app.post("/v1/devices/:id/revoke"'
rs, re_, rev = extract_route_block(src, rev_marker)
rev_inject = """// remove peer from WireGuard node (best effort)
try {
  await wgRemovePeer({
    publicKey: peer.publicKey,
    node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
  });
} catch (_) {}"""
rev2 = inject_after_peer_decl(rev, rev_inject)
src = src[:rs] + rev2 + src[re_:]

p.write_text(src, encoding="utf-8")
print("OK: patched devices.ts (v3) with wgAddPeer/wgRemovePeer after peer declaration")
print("Backup:", bak)
