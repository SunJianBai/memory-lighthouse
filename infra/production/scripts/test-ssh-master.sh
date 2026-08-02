#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(CDPATH= cd -- "$script_dir/../../.." && pwd -P)"
workflow="$project_root/.github/workflows/production-delivery.yml"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/openbmb-ssh-master-test.XXXXXX")"
case "$test_root" in
  "${TMPDIR:-/tmp}"/openbmb-ssh-master-test.*) ;;
  *) printf 'unsafe SSH master test directory\n' >&2; exit 1 ;;
esac

listener_pid=''
cleanup() {
  if [[ -n "$listener_pid" ]]; then
    kill "$listener_pid" >/dev/null 2>&1 || true
    wait "$listener_pid" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

extracted_config="$test_root/extracted-ssh-config"
rendered_config="$test_root/rendered-ssh-config"
effective_config="$test_root/effective-ssh-config"
awk '
  /cat > "\$HOME\/\.ssh\/config" <<EOF/ { capture = 1; next }
  capture && /^          EOF$/ { complete = 1; exit }
  capture {
    line = $0
    sub(/^          /, "", line)
    print line
  }
  END { if (!capture || !complete) exit 1 }
' "$workflow" > "$extracted_config"
sed \
  -e 's/\$DEPLOY_HOST/127.0.0.1/g' \
  -e 's/\$DEPLOY_USER/openbmbtest/g' \
  "$extracted_config" > "$rendered_config"
ssh -G -T -F "$rendered_config" tx4h4g-prod > "$effective_config"
grep -Fxq 'hostname 127.0.0.1' "$effective_config"
grep -Fxq 'user openbmbtest' "$effective_config"
grep -Fxq 'batchmode yes' "$effective_config"
grep -Fxq 'identitiesonly yes' "$effective_config"
grep -Fxq 'stricthostkeychecking true' "$effective_config"
grep -Fxq 'connecttimeout 20' "$effective_config"
grep -Fxq 'connectionattempts 1' "$effective_config"
grep -Fxq 'controlmaster false' "$effective_config"
grep -Fxq 'controlpersist 7800' "$effective_config"
grep -Fxq 'proxycommand /bin/false' "$effective_config"
grep -Fxq 'serveraliveinterval 30' "$effective_config"
grep -Fxq 'serveralivecountmax 6' "$effective_config"
grep -Fxq 'globalknownhostsfile /dev/null' "$effective_config"
grep -Eq '^userknownhostsfile .*/\.ssh/known_hosts$' "$effective_config"
grep -Eq '^identityfile .*/\.ssh/openbmb_deploy$' "$effective_config"
grep -Eq '^controlpath .*/\.ssh/openbmb-[^[:space:]]+$' "$effective_config"

guard_listener_script="$test_root/guard-listener.py"
guard_port_file="$test_root/guard-port"
guard_connection_count_file="$test_root/guard-connection-count"
cat > "$guard_listener_script" <<'PY'
import socket
import sys

port_file, count_file = sys.argv[1:]
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 0))
server.listen(1)
server.settimeout(1.0)
with open(port_file, "w", encoding="ascii") as handle:
    handle.write(str(server.getsockname()[1]))

connections = 0
try:
    connection, _ = server.accept()
    connections = 1
    connection.close()
except TimeoutError:
    pass
with open(count_file, "w", encoding="ascii") as handle:
    handle.write(str(connections))
server.close()
PY
python3 "$guard_listener_script" "$guard_port_file" "$guard_connection_count_file" &
listener_pid=$!
for _ in {1..100}; do
  [[ -s "$guard_port_file" ]] && break
  sleep 0.01
done
[[ -s "$guard_port_file" ]]
guard_port="$(cat "$guard_port_file")"
[[ "$guard_port" =~ ^[1-9][0-9]*$ ]]
fail_closed_config="$test_root/fail-closed-ssh-config"
awk -v port="$guard_port" '
  { print }
  $1 == "HostName" { print "  Port " port }
' "$rendered_config" > "$fail_closed_config"
set +e
ssh -T -F "$fail_closed_config" tx4h4g-prod true \
  > "$test_root/fail-closed.out" 2> "$test_root/fail-closed.err"
fail_closed_status=$?
printf 'fail closed\n' > "$test_root/scp-source"
scp -F "$fail_closed_config" "$test_root/scp-source" \
  tx4h4g-prod:must-not-transfer \
  > "$test_root/scp-fail-closed.out" 2> "$test_root/scp-fail-closed.err"
scp_fail_closed_status=$?
set -e
[[ "$fail_closed_status" -ne 0 ]]
[[ "$scp_fail_closed_status" -ne 0 ]]
wait "$listener_pid"
listener_pid=''
[[ "$(cat "$guard_connection_count_file")" == 0 ]]

listener_script="$test_root/reset-listener.py"
port_file="$test_root/port"
connection_count_file="$test_root/connection-count"
cat > "$listener_script" <<'PY'
import socket
import struct
import sys

port_file, count_file = sys.argv[1:]
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 0))
server.listen(2)
with open(port_file, "w", encoding="ascii") as handle:
    handle.write(str(server.getsockname()[1]))

for index in range(2):
    connection, _ = server.accept()
    with open(count_file, "w", encoding="ascii") as handle:
        handle.write(str(index + 1))
    if index == 0:
        connection.setsockopt(
            socket.SOL_SOCKET,
            socket.SO_LINGER,
            struct.pack("ii", 1, 0),
        )
        connection.close()
        continue
    connection.sendall(b"READY\n")
    connection.close()

server.close()
PY
python3 "$listener_script" "$port_file" "$connection_count_file" &
listener_pid=$!
for _ in {1..100}; do
  [[ -s "$port_file" ]] && break
  sleep 0.01
done
[[ -s "$port_file" ]]
reset_port="$(cat "$port_file")"
[[ "$reset_port" =~ ^[1-9][0-9]*$ ]]

reset_config="$test_root/reset-client-config"
cat > "$reset_config" <<EOF
Host reset-target
  HostName 127.0.0.1
  Port $reset_port
  User nobody
  BatchMode yes
  ConnectTimeout 5
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  GlobalKnownHostsFile /dev/null
  LogLevel ERROR
EOF

fake_ssh="$test_root/fake-ssh"
master_state="$test_root/master-state"
attempt_file="$test_root/master-attempts"
cat > "$fake_ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${1:-}" == -O && "${2:-}" == check && "${3:-}" == fake-prod && $# -eq 3 ]]; then
  [[ -e "${FAKE_MASTER_STATE:?}" ]]
  exit
fi
[[ "${1:-}" == -MNf && "${2:-}" == -o && \
   "${3:-}" == ProxyCommand=none && "${4:-}" == -o && \
   "${5:-}" == ControlMaster=yes && "${6:-}" == -o && \
   "${7:-}" == ControlPersist=130m && "${8:-}" == fake-prod && $# -eq 8 ]]

attempt=1
if [[ -s "${FAKE_MASTER_ATTEMPTS:?}" ]]; then
  attempt=$(( $(cat "$FAKE_MASTER_ATTEMPTS") + 1 ))
fi
printf '%s\n' "$attempt" > "$FAKE_MASTER_ATTEMPTS"

if [[ "$attempt" -eq 1 ]]; then
  "${REAL_SSH_COMMAND:?}" -F "${RESET_SSH_CONFIG:?}" -MNf reset-target
  exit
fi

response="$(python3 - "${RESET_PORT:?}" <<'PY'
import socket
import sys

with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=5) as client:
    print(client.recv(64).decode("ascii").strip())
PY
)"
[[ "$response" == READY ]]
: > "$FAKE_MASTER_STATE"
FAKE_SSH
chmod 0700 "$fake_ssh"

export FAKE_MASTER_STATE="$master_state"
export FAKE_MASTER_ATTEMPTS="$attempt_file"
export REAL_SSH_COMMAND="$(command -v ssh)"
export RESET_SSH_CONFIG="$reset_config"
export RESET_PORT="$reset_port"
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" fake-prod 3 0 \
  > "$test_root/helper.out" 2> "$test_root/helper.err"
wait "$listener_pid"
listener_pid=''

[[ "$(cat "$attempt_file")" == 2 ]]
[[ "$(cat "$connection_count_file")" == 2 ]]
grep -Fq 'attempt 1/3' "$test_root/helper.err"
grep -Fq 'Established authenticated SSH master for fake-prod.' "$test_root/helper.out"
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" fake-prod 3 0 \
  > "$test_root/reuse.out" 2> "$test_root/reuse.err"
[[ "$(cat "$attempt_file")" == 2 ]]
grep -Fq 'Reused authenticated SSH master for fake-prod.' "$test_root/reuse.out"
[[ ! -s "$test_root/reuse.err" ]]
set +e
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" fake-prod 7 0 \
  > "$test_root/invalid-attempts.out" 2> "$test_root/invalid-attempts.err"
invalid_attempts_status=$?
set -e
[[ "$invalid_attempts_status" -ne 0 ]]
[[ "$(cat "$attempt_file")" == 2 ]]
grep -Fq 'between 1 and 6' "$test_root/invalid-attempts.err"

printf 'Pinned SSH master retry fixtures: OK\n'
