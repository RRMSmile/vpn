from __future__ import annotations
from pathlib import Path
import sys, re

p = Path("apps/api/src/routes/devices.ts")
if not p.exists():
    print("ERR: devices.ts not found:", p, file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".wgapply2.bak")
bak.write_text(src, encoding="utf-8")

def find_statement_containing(substr: str) -> tuple[int,int,str]:
    i = src.find(substr)
    if i < 0:
        raise RuntimeError(f"cannot find substring: {substr}")

    # go back to nearest "app." before substr
    start = src.rfind("app.", 0, i)
    if start < 0:
        raise RuntimeError(f"cannot find 'app.' before {substr}")

    # scan forward until top-level ';' (outside strings/comments)
    par = br = sq = 0  # (), {}, []
    in_s = None        # ', ", `
    esc = False
    in_line_c = False
    in_blk_c = False

    def is_open(c): return c in "([{"
    def is_close(c): return c in ")]}"

    j = start
    while j < len(src):
        c = src[j]
        n = src[j+1] if j+1 < len(src) else ""

        if in_line_c:
            if c == "\n":
                in_line_c = False
            j += 1
            continue

        if in_blk_c:
            if c == "*" and n == "/":
                in_blk_c = False
                j += 2
                continue
            j += 1
            continue

        if in_s is not None:
            if in_s == "`":
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == "`":
                    in_s = None
                j += 1
                continue
            else:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == in_s:
                    in_s = None
                j += 1
                continue

        # start comment?
        if c == "/" and n == "/":
            in_line_c = True
            j += 2
            continue
        if c == "/" and n == "*":
            in_blk_c = True
            j += 2
            continue

        # start string?
        if c in ("'", '"', "`"):
            in_s = c
            j += 1
            continue

        # balance
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

        # end of statement?
        if c == ";" and par == 0 and br == 0 and sq == 0:
            end = j + 1
            return start, end, src[start:end]

        j += 1

    raise RuntimeError(f"cannot find end of statement for {substr}")

def inject_before_reply_send(stmt: str, inject: str) -> str:
    # find last reply.send / return reply.send / reply.code(...).send
    hits = list(re.finditer(r"\n(\s*)(?:return\s+)?reply\.(?:code\([^)]*\)\.)?send\(", stmt))
    if not hits:
        raise RuntimeError("cannot find reply.send(...) in route statement")
    m = hits[-1]
    indent = m.group(1)
    if inject.strip() in stmt:
        return stmt  # already injected
    return stmt[:m.start()] + "\n" + "\n".join(indent + line if line else "" for line in inject.splitlines()) + stmt[m.start():]

# 1) ensure import
if 'from "../lib/wg-node"' not in src:
    if 'import { env } from "../env";' in src:
        src = src.replace(
            'import { env } from "../env";\n',
            'import { env } from "../env";\nimport { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n',
            1
        )
    else:
        m = re.search(r'(\A(?:import[^\n]*\n)+)', src)
        if not m:
            raise RuntimeError("cannot find import block for inserting wg-node import")
        src = src[:m.end()] + 'import { wgAddPeer, wgRemovePeer } from "../lib/wg-node";\n' + src[m.end():]

# refresh local copy for route searching after import change
# (we will patch via slices in src itself)
def patch_route(substr: str, kind: str) -> None:
    global src
    start, end, stmt = find_statement_containing(substr)

    if kind == "provision":
        inject = """// apply on WireGuard node (ssh)
try {
  await wgAddPeer({
    publicKey: peer.publicKey,
    allowedIp: peer.allowedIp,
    node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
  });
} catch (e) {
  // keep DB consistent: mark peer revoked on WG apply failure
  await prisma.peer.update({ where: { id: peer.id }, data: { revokedAt: new Date() } }).catch(() => {});
  throw e;
}"""
        new_stmt = inject_before_reply_send(stmt, inject)

    elif kind == "revoke":
        inject = """// remove from WireGuard node (best effort)
try {
  await wgRemovePeer({
    publicKey: peer.publicKey,
    node: { sshHost: env.WG_NODE_SSH_HOST, sshUser: env.WG_NODE_SSH_USER, wgInterface: env.WG_INTERFACE },
  });
} catch (_) {
  // ignore: revoke should stay idempotent
}"""
        new_stmt = inject_before_reply_send(stmt, inject)

    else:
        raise RuntimeError("unknown kind")

    src = src[:start] + new_stmt + src[end:]

# 2) patch provision + revoke using only suffix markers
patch_route("/provision", "provision")
patch_route("/revoke", "revoke")

p.write_text(src, encoding="utf-8")
print("OK: patched devices.ts with wgAddPeer/wgRemovePeer")
print("Backup:", bak)
