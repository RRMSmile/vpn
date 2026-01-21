from __future__ import annotations
from pathlib import Path
import re, sys

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found", file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgapply4.bak")
bak.write_text(src, encoding="utf-8")

def ensure_import(s: str) -> str:
    if 'from "../lib/wg-node"' in s:
        return s
    if 'import { env } from "../env";' in s:
        return s.replace(
            'import { env } from "../env";\n',
            'import { env } from "../env";\nimport { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
            1
        )
    m = re.search(r'(\A(?:import[^\n]*\n)+)', s)
    if not m:
        raise RuntimeError("cannot find import block")
    return s[:m.end()] + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + s[m.end():]

def extract_route_block(s: str, marker: str) -> tuple[int,int,str]:
    i = s.find(marker)
    if i < 0:
        raise RuntimeError(f"cannot find marker: {marker}")
    start = s.rfind("app.post(", 0, i)
    if start < 0:
        raise RuntimeError(f"cannot find app.post before marker: {marker}")

    par = br = sq = 0
    in_s = None
    esc = False
    in_line = False
    in_blk = False
    j = start
    while j < len(s):
        c = s[j]
        n = s[j+1] if j+1 < len(s) else ""

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
            return start, end, s[start:end]
        j += 1

    raise RuntimeError(f"cannot find end ';' for route block: {marker}")

def inject_after_peer_assign(block: str, inject_tpl: str, mode: str) -> str:
    # mode = "provision" -> find prisma.peer.create/upsert/...
    # mode = "revoke" -> find prisma.peer.find/update/...
    if mode == "provision":
        m = re.search(r'\n(\s*)(const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*await\s+prisma\.peer\.(create|upsert|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|update)\b', block)
    else:
        m = re.search(r'\n(\s*)(const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*await\s+prisma\.peer\.(findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|update)\b', block)

    if not m:
        raise RuntimeError(f"cannot find prisma.peer.* assignment in {mode} route block")

    indent = m.group(1)
    var = m.group(3)

    # insert after the statement semicolon
    start_pos = m.start()
    sub = block[start_pos:]
    semi = sub.find(";")
    if semi < 0:
        raise RuntimeError("cannot find ';' after prisma.peer.* assignment")
    insert_at = start_pos + semi + 1

    inject = inject_tpl.replace("{{VAR}}", var)
    snippet = "\n" + "\n".join(indent + line if line else "" for line in inject.splitlines()) + "\n"

    # idempotency: avoid double insert
    if "wgAddPeer(" in inject and "wgAddPeer(" in block:
        return block
    if "wgRemovePeer(" in inject and "wgRemovePeer(" in block:
        return block

    return block[:insert_at] + snippet + block[insert_at:]

src = ensure_import(src)

# PROVISION
prov_marker = 'app.post("/v1/devices/:id/provision"'
ps, pe, prov = extract_route_block(src, prov_marker)

prov_inject = """// apply peer to WireGuard node (ssh)
try {
  await wgAddPeer({
    publicKey: {{VAR}}.publicKey,
    allowedIp: {{VAR}}.allowedIp,
    node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
  });
} catch (e: any) {
  req.log?.error({ err: e }, "wgAddPeer failed");
  throw e;
}"""

prov2 = inject_after_peer_assign(prov, prov_inject, "provision")
src = src[:ps] + prov2 + src[pe:]

# REVOKE
rev_marker = 'app.post("/v1/devices/:id/revoke"'
rs, re_, rev = extract_route_block(src, rev_marker)

rev_inject = """// remove peer from WireGuard node (ssh) - best effort
try {
  await wgRemovePeer({
    publicKey: {{VAR}}.publicKey,
    node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
  });
} catch (e: any) {
  req.log?.warn({ err: e }, "wgRemovePeer failed");
}"""

rev2 = inject_after_peer_assign(rev, rev_inject, "revoke")
src = src[:rs] + rev2 + src[re_:]

p.write_text(src, encoding="utf-8")
print("OK: patched devices.ts v4 (wgAddPeer/wgRemovePeer)")
print("Backup:", bak)
