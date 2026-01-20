from __future__ import annotations
from pathlib import Path
import sys

p = Path("apps/api/src/lib/wg-node.ts")
if not p.exists():
    print("ERR: wg-node.ts not found", file=sys.stderr)
    sys.exit(2)

src = p.read_text(encoding="utf-8")
bak = p.with_suffix(p.suffix + ".idem.bak")
bak.write_text(src, encoding="utf-8")

# Avoid double patch
if "async function wgHasPeer" in src:
    print("WARN: wgHasPeer already present; abort")
    print("Backup:", bak)
    sys.exit(0)

insert_point = src.find("export async function wgAddPeer")
if insert_point < 0:
    print("ERR: cannot find wgAddPeer in wg-node.ts", file=sys.stderr)
    sys.exit(2)

helper = r'''
async function wgHasPeer(params: {
  publicKey: string;
  node: { sshHost: string; sshUser: string; wgInterface: string };
}): Promise<boolean> {
  const { publicKey, node } = params;

  const cmd = [
    "set -euo pipefail;",
    # grep -F returns 0 if found, 1 if not found
    f"sudo -n wg show {node.wgInterface} | grep -F '{publicKey}' >/dev/null && echo YES || echo NO;",
  ].join(" ");

  const { stdout } = await sshExec(cmd, {
    host: node.sshHost,
    user: node.sshUser,
    opts: env.WG_NODE_SSH_OPTS,
  });

  return String(stdout).trim().endswith("YES");
}

'''.lstrip("\n")

src = src[:insert_point] + helper + src[insert_point:]

# Patch wgAddPeer body to be idempotent
if "return sshExec(cmd" not in src:
    print("ERR: unexpected wgAddPeer structure", file=sys.stderr)
    sys.exit(2)

# Replace wgAddPeer implementation block by crude but safe string-based edit
marker_add_start = src.find("export async function wgAddPeer")
marker_add_end = src.find("export async function wgRemovePeer")
if marker_add_end < 0:
    print("ERR: cannot find wgRemovePeer", file=sys.stderr)
    sys.exit(2)

add_block = src[marker_add_start:marker_add_end]

# Ensure we only patch once
if "wgHasPeer" not in add_block:
    add_block = add_block.replace(
        '  const cmd = [\n'
        '    "set -euo pipefail;",\n'
        '    `sudo -n wg set ${node.wgInterface} peer ${publicKey} allowed-ips ${allowedIp}/32;`,\n'
        '    `sudo -n wg show ${node.wgInterface} | sed -n "1,20p";`,\n'
        '  ].join(" ");\n\n'
        "  return sshExec(cmd, {\n",
        '  const exists = await wgHasPeer({ publicKey, node });\n\n'
        '  const cmd = [\n'
        '    "set -euo pipefail;",\n'
        '    // idempotent: if peer exists, wg will just update allowed-ips\n'
        '    `sudo -n wg set ${node.wgInterface} peer ${publicKey} allowed-ips ${allowedIp}/32;`,\n'
        '    `sudo -n wg show ${node.wgInterface} | sed -n "1,40p";`,\n'
        '    `echo PEER_EXISTS=${exists ? "yes" : "no"}`, \n'
        '  ].join(" ");\n\n'
        "  return sshExec(cmd, {\n",
        1
    )

# Patch wgRemovePeer to be idempotent (skip remove if not exists)
rem_start = src.find("export async function wgRemovePeer")
if rem_start < 0:
    print("ERR: wgRemovePeer not found after insert", file=sys.stderr)
    sys.exit(2)

rem_block = src[rem_start:]

# If already patched, abort
if "wgHasPeer" not in rem_block:
    # Insert exists check right after destructuring
    needle = "  const { publicKey, node } = params;\n\n"
    if needle not in rem_block:
        print("ERR: unexpected wgRemovePeer structure (no destructure needle)", file=sys.stderr)
        sys.exit(2)

    rem_block = rem_block.replace(
        needle,
        needle + "  const exists = await wgHasPeer({ publicKey, node });\n\n"
                 "  if (!exists) {\n"
                 "    return { stdout: \"PEER_NOT_FOUND\\n\", stderr: \"\" };\n"
                 "  }\n\n",
        1
    )

    # Also add exists marker in output
    rem_block = rem_block.replace(
        '    `sudo -n wg show ${node.wgInterface} | sed -n "1,20p";`,\n',
        '    `sudo -n wg show ${node.wgInterface} | sed -n "1,40p";`,\n'
        '    `echo PEER_EXISTS=yes`,\n',
        1
    )

src = src[:marker_add_start] + add_block + src[marker_add_end:rem_start] + rem_block

p.write_text(src, encoding="utf-8")
print("OK: patched wg-node.ts idempotent helpers")
print("Backup:", bak)
