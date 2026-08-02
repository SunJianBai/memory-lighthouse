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

test_home="$test_root/home"
install -d -m 0700 "$test_home" "$test_home/.ssh"
export HOME="$test_home"

extracted_config="$test_root/extracted-ssh-config"
rendered_config="$test_root/rendered-ssh-config"
effective_config="$test_root/effective-ssh-config"
effective_lane_one_config="$test_root/effective-ssh-lane-one-config"
effective_lane_eight_config="$test_root/effective-ssh-lane-eight-config"
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
  -e "s#~/.ssh#$HOME/.ssh#g" \
  "$extracted_config" > "$rendered_config"
ssh -G -T -F "$rendered_config" tx4h4g-prod > "$effective_config"
ssh -G -T -F "$rendered_config" tx4h4g-prod-lane-1 > "$effective_lane_one_config"
ssh -G -T -F "$rendered_config" tx4h4g-prod-lane-8 > "$effective_lane_eight_config"
for effective_host_config in \
  "$effective_config" "$effective_lane_one_config" "$effective_lane_eight_config"; do
  grep -Fxq 'hostname 127.0.0.1' "$effective_host_config"
  grep -Fxq 'user openbmbtest' "$effective_host_config"
  grep -Fxq 'batchmode yes' "$effective_host_config"
  grep -Fxq 'identitiesonly yes' "$effective_host_config"
  grep -Fxq 'stricthostkeychecking true' "$effective_host_config"
  grep -Fxq 'connecttimeout 20' "$effective_host_config"
  grep -Fxq 'connectionattempts 1' "$effective_host_config"
  grep -Fxq 'controlmaster false' "$effective_host_config"
  grep -Fxq 'controlpersist 7800' "$effective_host_config"
  grep -Fxq 'proxycommand /bin/false' "$effective_host_config"
  grep -Fxq 'serveraliveinterval 30' "$effective_host_config"
  grep -Fxq 'serveralivecountmax 6' "$effective_host_config"
  grep -Fxq 'globalknownhostsfile /dev/null' "$effective_host_config"
  grep -Eq '^userknownhostsfile .*/\.ssh/known_hosts$' "$effective_host_config"
  grep -Eq '^identityfile .*/\.ssh/openbmb_deploy$' "$effective_host_config"
  grep -Eq '^controlpath .*/\.ssh/openbmb-[^[:space:]]+$' "$effective_host_config"
done
main_control_path="$(awk '$1 == "controlpath" { print $2 }' "$effective_config")"
lane_one_control_path="$(awk '$1 == "controlpath" { print $2 }' "$effective_lane_one_config")"
lane_eight_control_path="$(awk '$1 == "controlpath" { print $2 }' "$effective_lane_eight_config")"
[[ -n "$main_control_path" && -n "$lane_one_control_path" && -n "$lane_eight_control_path" ]]
[[ "$main_control_path" != "$lane_one_control_path" ]]
[[ "$main_control_path" != "$lane_eight_control_path" ]]
[[ "$lane_one_control_path" != "$lane_eight_control_path" ]]
[[ "$(basename -- "$main_control_path")" =~ ^openbmb-tx4h4g-prod-[0-9a-f]{40}$ ]]
[[ "$(basename -- "$lane_one_control_path")" =~ ^openbmb-tx4h4g-prod-lane-1-[0-9a-f]{40}$ ]]
[[ "$(basename -- "$lane_eight_control_path")" =~ ^openbmb-tx4h4g-prod-lane-8-[0-9a-f]{40}$ ]]
[[ "$(dirname -- "$main_control_path")" == "$HOME/.ssh" ]]
[[ "$(dirname -- "$lane_one_control_path")" == "$HOME/.ssh" ]]
[[ "$(dirname -- "$lane_eight_control_path")" == "$HOME/.ssh" ]]

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
ssh -T -F "$fail_closed_config" tx4h4g-prod-lane-8 true \
  > "$test_root/lane-fail-closed.out" 2> "$test_root/lane-fail-closed.err"
lane_fail_closed_status=$?
scp -F "$fail_closed_config" "$test_root/scp-source" \
  tx4h4g-prod-lane-8:must-not-transfer \
  > "$test_root/lane-scp-fail-closed.out" 2> "$test_root/lane-scp-fail-closed.err"
lane_scp_fail_closed_status=$?
set -e
[[ "$fail_closed_status" -ne 0 ]]
[[ "$scp_fail_closed_status" -ne 0 ]]
[[ "$lane_fail_closed_status" -ne 0 ]]
[[ "$lane_scp_fail_closed_status" -ne 0 ]]
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
fake_ssh_log="$test_root/fake-ssh.log"
cat > "$fake_ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
set -Eeuo pipefail

control_path_for() {
  local host="$1"
  local host_hash
  [[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]
  [[ "${HOME:?}" == /* && -d "$HOME/.ssh" && ! -L "$HOME/.ssh" ]]
  host_hash="$(printf '%s' "$host" | sha1sum | awk '{ print $1 }')"
  [[ "$host_hash" =~ ^[0-9a-f]{40}$ ]]
  printf '%s/.ssh/openbmb-%s-%s' "$HOME" "$host" "$host_hash"
}
state_for() {
  printf '%s/%s' "${FAKE_MASTER_STATE_DIR:?}" "$1"
}
if [[ "${1:-}" == -G && "${2:-}" == -T && $# -eq 3 ]]; then
  printf 'controlpath %s\n' "$(control_path_for "$3")"
  exit 0
fi
if [[ "${1:-}" == -O && "${2:-}" == check && $# -eq 3 ]]; then
  printf 'check=%s\n' "$3" >> "${FAKE_SSH_LOG:?}"
  [[ -e "$(state_for "$3")" ]]
  exit
fi
[[ "${1:-}" == -MNf && "${2:-}" == -o && \
   "${3:-}" == ProxyCommand=none && "${4:-}" == -o && \
   "${5:-}" == ControlMaster=yes && "${6:-}" == -o && \
   "${7:-}" == ControlPersist=130m && $# -eq 8 ]]

host="$8"
printf 'start=%s\n' "$host" >> "$FAKE_SSH_LOG"
if [[ "$host" == signal-prod ]]; then
  printf '%s\n' "$$" > "${FAKE_SIGNAL_CHILD_PID:?}"
  trap 'printf "terminated\n" > "${FAKE_SIGNAL_TERMINATED:?}"; exit 143' HUP INT TERM
  : > "${FAKE_SIGNAL_STARTED:?}"
  while :; do sleep 1; done
fi

if [[ "$host" != fake-prod ]]; then
  : > "$(state_for "$host")"
  exit 0
fi

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
: > "$(state_for "$host")"
FAKE_SSH
chmod 0700 "$fake_ssh"

install -d -m 0700 "$master_state"
export FAKE_MASTER_STATE_DIR="$master_state"
export FAKE_MASTER_ATTEMPTS="$attempt_file"
export FAKE_SSH_LOG="$fake_ssh_log"
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

control_path_for() {
  local host="$1"
  local host_hash
  host_hash="$(printf '%s' "$host" | sha1sum | awk '{ print $1 }')"
  printf '%s/.ssh/openbmb-%s-%s' "$HOME" "$host" "$host_hash"
}

# A failed control check may remove only a user-owned, non-symlink Unix socket,
# and only after the helper repeats both the control check and type validation.
stale_control_path="$(control_path_for stale-prod)"
python3 - "$stale_control_path" <<'PY'
import socket
import sys

path = sys.argv[1]
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.bind(path)
sock.close()
PY
[[ -S "$stale_control_path" && ! -L "$stale_control_path" ]]
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" stale-prod 1 0 \
  > "$test_root/stale.out" 2> "$test_root/stale.err"
[[ ! -e "$stale_control_path" && ! -L "$stale_control_path" ]]
[[ -e "$master_state/stale-prod" ]]
[[ "$(grep -Fc 'check=stale-prod' "$fake_ssh_log")" -eq 4 ]]
grep -Fq 'Established authenticated SSH master for stale-prod.' "$test_root/stale.out"

regular_control_path="$(control_path_for regular-prod)"
printf 'must survive\n' > "$regular_control_path"
set +e
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" regular-prod 1 0 \
  > "$test_root/regular.out" 2> "$test_root/regular.err"
regular_status=$?
set -e
[[ "$regular_status" -ne 0 ]]
[[ -f "$regular_control_path" && ! -L "$regular_control_path" ]]
[[ "$(cat "$regular_control_path")" == 'must survive' ]]
grep -Fq 'not a private user-owned socket' "$test_root/regular.err"

symlink_target="$test_root/symlink-target"
printf 'must survive\n' > "$symlink_target"
symlink_control_path="$(control_path_for symlink-prod)"
ln -s -- "$symlink_target" "$symlink_control_path"
set +e
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" symlink-prod 1 0 \
  > "$test_root/symlink.out" 2> "$test_root/symlink.err"
symlink_status=$?
set -e
[[ "$symlink_status" -ne 0 ]]
[[ -L "$symlink_control_path" && "$(readlink -- "$symlink_control_path")" == "$symlink_target" ]]
[[ "$(cat "$symlink_target")" == 'must survive' ]]
grep -Fq 'not a private user-owned socket' "$test_root/symlink.err"

# TERM received while the helper is waiting for a spawned SSH process must be
# forwarded to that exact child, reaped, and surfaced as the signal exit status.
export FAKE_SIGNAL_STARTED="$test_root/signal-started"
export FAKE_SIGNAL_CHILD_PID="$test_root/signal-child-pid"
export FAKE_SIGNAL_TERMINATED="$test_root/signal-terminated"
OPENBMB_SSH_COMMAND="$fake_ssh" \
  bash "$script_dir/ensure-ssh-master.sh" signal-prod 1 0 \
  > "$test_root/signal.out" 2> "$test_root/signal.err" &
helper_pid=$!
for _ in {1..500}; do
  [[ -e "$FAKE_SIGNAL_STARTED" && -s "$FAKE_SIGNAL_CHILD_PID" ]] && break
  sleep 0.01
done
if [[ ! -e "$FAKE_SIGNAL_STARTED" || ! -s "$FAKE_SIGNAL_CHILD_PID" ]]; then
  printf 'signal fixture did not reach the blocking SSH child\n' >&2
  cat "$test_root/signal.out" >&2 || true
  cat "$test_root/signal.err" >&2 || true
  cat "$fake_ssh_log" >&2 || true
  exit 1
fi
signal_child_pid="$(cat "$FAKE_SIGNAL_CHILD_PID")"
kill -TERM "$helper_pid"
set +e
wait "$helper_pid"
helper_status=$?
set -e
[[ "$helper_status" -eq 143 ]]
[[ -s "$FAKE_SIGNAL_TERMINATED" ]]
! kill -0 "$signal_child_pid" 2>/dev/null
[[ ! -e "$master_state/signal-prod" ]]

printf 'Pinned SSH master retry fixtures: OK\n'
