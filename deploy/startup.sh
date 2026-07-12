#!/bin/bash

set -euo pipefail

readonly stable_container="cogfab"
readonly candidate_container="cogfab-next"
readonly previous_container="cogfab-previous"
readonly collector_container="cogfab-otel"
readonly previous_collector="cogfab-otel-previous"
readonly collector_image="us-docker.pkg.dev/cloud-ops-agents-artifacts/google-cloud-opentelemetry-collector/otelcol-google@sha256:6add546498180921af0a2a0d26faa0b60f27faf7298c969b041226a52a685d32"
readonly data_dir="/var/lib/cogfab"
readonly deploy_home="/home/cogfab-deploy"
readonly collector_dir="$data_dir/monitoring"
readonly legacy_collector_config="$collector_dir/collector.yaml"
readonly collector_config_a="$collector_dir/collector-a.yaml"
readonly collector_config_b="$collector_dir/collector-b.yaml"
readonly image_repository="us-central1-docker.pkg.dev/cogfab-io/cogfab/server"
readonly image_url="http://metadata.google.internal/computeMetadata/v1/instance/attributes/cogfab-image"
readonly registry="us-central1-docker.pkg.dev"

declare -a previous_containers=()
declare -a previous_running=()
candidate_was_promoted=false
rollback_needed=false
stable_was_renamed=false

log() {
	echo "cogfab-startup: $*"
}

container_exists() {
	docker container inspect "$1" >/dev/null 2>&1
}

container_running() {
	[[ "$(docker container inspect --format '{{.State.Running}}' "$1" 2>/dev/null)" == true ]]
}

remove_container() {
	local name="$1"
	if ! container_exists "$name"; then
		return
	fi
	if container_running "$name"; then
		docker stop --time=20 "$name" >/dev/null
	fi
	docker rm "$name" >/dev/null
}

wait_for_docker() {
	for _ in {1..30}; do
		if docker info >/dev/null 2>&1; then
			return
		fi
		sleep 2
	done
	log "docker did not become ready"
	return 1
}

allow_web_port() {
	local port="$1"
	if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
		iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
	fi
}

acquire_lock() {
	# The kernel releases this lock even if the startup script is interrupted.
	exec 9>"$deploy_home/startup.lock"
	if ! flock --nonblock 9; then
		log "could not acquire startup lock; another run is active"
		return 1
	fi
}

release_lock() {
	flock --unlock 9 2>/dev/null || true
	exec 9>&-
}

rollback() {
	local name restored
	log "candidate failed; restoring the previous container"
	if [[ "$candidate_was_promoted" == true ]] && ! remove_container "$stable_container"; then
		log "could not remove promoted candidate"
	fi
	if ! remove_container "$candidate_container"; then
		log "could not remove failed candidate"
	fi
	if [[ "$stable_was_renamed" == true ]] && container_exists "$previous_container"; then
		if ! docker rename "$previous_container" "$stable_container"; then
			log "could not restore the $stable_container name"
		fi
	fi
	for name in "${previous_running[@]}"; do
		if ! docker start "$name" >/dev/null 2>&1; then
			log "could not restart $name"
		fi
	done
	if ((${#previous_running[@]} == 0)); then
		return
	fi
	restored=false
	for _ in {1..10}; do
		if service_responding; then
			restored=true
			break
		fi
		sleep 1
	done
	if [[ "$restored" != true ]]; then
		log "previous service did not become healthy"
	fi
}

on_exit() {
	local status=$?
	trap - EXIT
	set +e
	if [[ "$status" -ne 0 && "$rollback_needed" == true ]]; then
		rollback
	fi
	release_lock
	exit "$status"
}

service_responding() {
	if [[ -s "$data_dir/certs/cogfab.io" ]]; then
		[[ "$(curl --fail --silent --max-time 2 \
			--resolve cogfab.io:443:127.0.0.1 \
			https://cogfab.io/healthz)" == ok ]]
		return
	fi
	curl --fail --silent --max-time 2 http://127.0.0.1:9090/metrics |
		grep --quiet '^cogfab_rooms_active '
}

wait_for_candidate() {
	local ready
	ready=false
	for _ in {1..20}; do
		if container_running "$candidate_container" && service_responding; then
			ready=true
			break
		fi
		sleep 1
	done
	if [[ "$ready" == true ]]; then
		# Docker only honors restart policies after a container has stayed up for
		# ten seconds. Twelve clean checks give that protection a small margin.
		for _ in {1..12}; do
			sleep 1
			if ! container_running "$candidate_container" || ! service_responding; then
				ready=false
				break
			fi
		done
	fi
	if [[ "$ready" == true ]]; then
		return
	fi
	docker logs --tail 50 "$candidate_container" >&2 || true
	log "candidate did not become healthy"
	return 1
}

collector_responding() {
	curl --fail --silent --max-time 2 http://127.0.0.1:13133/ >/dev/null
}

create_collector() {
	local image="$1"
	local config="$2"
	docker create \
		--name "$collector_container" \
		--restart no \
		--network host \
		--memory 160m \
		--read-only \
		--security-opt no-new-privileges \
		--tmpfs /tmp:rw,noexec,nosuid,size=16m \
		--env GOOGLE_CLOUD_PROJECT=cogfab-io \
		--mount "type=bind,source=$config,target=/etc/otelcol/config.yaml,readonly" \
		"$image" \
		--config=/etc/otelcol/config.yaml >/dev/null
}

wait_for_collector() {
	local ready
	ready=false
	for _ in {1..20}; do
		if container_running "$collector_container" && collector_responding; then
			ready=true
			break
		fi
		sleep 1
	done
	if [[ "$ready" == true ]]; then
		# Keep the fallback until the collector clears Docker's restart threshold.
		for _ in {1..12}; do
			sleep 1
			if ! container_running "$collector_container" || \
				! collector_responding; then
				ready=false
				break
			fi
		done
	fi
	if [[ "$ready" != true ]]; then
		docker logs --tail 50 "$collector_container" >&2 || true
		log "metrics collector did not become healthy"
		return 1
	fi
}

recover_collector_name() {
	local current_restart
	if ! container_exists "$previous_collector"; then
		return
	fi
	current_restart=""
	if container_exists "$collector_container"; then
		current_restart="$(docker inspect --format \
			'{{.HostConfig.RestartPolicy.Name}}' "$collector_container")"
	fi
	if container_exists "$collector_container" && container_running "$collector_container" && \
		collector_responding && [[ "$current_restart" == always ]]; then
		remove_container "$previous_collector"
		return
	fi
	remove_container "$collector_container"
	docker rename "$previous_collector" "$collector_container"
	if ! container_running "$collector_container"; then
		docker start "$collector_container" >/dev/null
	fi
	wait_for_collector
}

restore_collector() {
	local candidate_config="$1"
	local previous_restart="$2"
	local collector_was_running="$3"

	if ! remove_container "$collector_container"; then
		return 1
	fi
	if container_exists "$previous_collector"; then
		docker rename "$previous_collector" "$collector_container" || return 1
		docker update --restart "$previous_restart" "$collector_container" \
			>/dev/null || return 1
		if [[ "$collector_was_running" == true ]]; then
			docker start "$collector_container" >/dev/null || return 1
			wait_for_collector || return 1
		fi
	fi
	if ! rm -f "$candidate_config"; then
		log "could not remove $candidate_config"
	fi
}

start_collector() {
	local candidate_config config_tmp current_config old_config
	local collector_should_run previous_removed previous_restart

	mkdir -p "$collector_dir"
	recover_collector_name
	current_config=""
	previous_restart="no"
	collector_should_run=false
	if container_exists "$collector_container"; then
		current_config="$(docker inspect --format \
			'{{range .Mounts}}{{if eq .Destination "/etc/otelcol/config.yaml"}}{{.Source}}{{end}}{{end}}' \
			"$collector_container")"
		previous_restart="$(docker inspect --format \
			'{{.HostConfig.RestartPolicy.Name}}' "$collector_container")"
		if container_running "$collector_container" || \
			[[ "$previous_restart" == always ]]; then
			collector_should_run=true
		fi
	fi
	if [[ "$current_config" == "$collector_config_a" ]]; then
		candidate_config="$collector_config_b"
	else
		candidate_config="$collector_config_a"
	fi
	config_tmp="$candidate_config.tmp"
	docker cp "$stable_container:/etc/cogfab/collector.yaml" "$config_tmp"
	mv "$config_tmp" "$candidate_config"

	if container_exists "$collector_container"; then
		if container_running "$collector_container"; then
			if ! docker stop --time=20 "$collector_container" >/dev/null; then
				rm -f "$candidate_config" || true
				return 1
			fi
		fi
		if ! docker rename "$collector_container" "$previous_collector"; then
			if [[ "$collector_should_run" == true ]] && \
				! container_running "$collector_container"; then
				docker start "$collector_container" >/dev/null || true
			fi
			rm -f "$candidate_config" || true
			return 1
		fi
	fi

	if ! create_collector "$collector_image" "$candidate_config" || \
		! docker start "$collector_container" >/dev/null || \
		! wait_for_collector || \
		! docker update --restart always "$collector_container" >/dev/null; then
		log "restoring the previous metrics collector"
		if ! restore_collector "$candidate_config" "$previous_restart" \
			"$collector_should_run"; then
			log "could not restore the previous metrics collector"
		fi
		return 1
	fi

	previous_removed=true
	if container_exists "$previous_collector" && \
		! remove_container "$previous_collector"; then
		previous_removed=false
		log "could not remove $previous_collector; keeping its config"
	fi
	if [[ "$previous_removed" == true ]]; then
		for old_config in "$legacy_collector_config" "$collector_config_a" \
			"$collector_config_b"; do
			if [[ "$old_config" != "$candidate_config" ]]; then
				if ! rm -f "$old_config"; then
					log "could not remove $old_config"
				fi
			fi
		done
	fi
}

log "configuring the host"
mkdir -p "$deploy_home"
chmod 700 "$deploy_home"
acquire_lock
trap on_exit EXIT
sysctl -w net.ipv4.ip_unprivileged_port_start=0
allow_web_port 80
allow_web_port 443
mkdir -p "$data_dir"
chown 65532:65532 "$data_dir"
export HOME="$deploy_home"
wait_for_docker

image="$(curl --fail --silent --show-error --retry 5 --retry-all-errors \
	--connect-timeout 2 --max-time 5 --retry-delay 2 \
	--header 'Metadata-Flavor: Google' "$image_url")"
if [[ "$image" != "$image_repository:"?* && \
	"$image" != "$image_repository@sha256:"?* ]] || [[ "$image" == *:latest ]]; then
	log "cogfab-image must be a versioned image or digest from $image_repository"
	exit 1
fi

log "pulling $image"
docker-credential-gcr configure-docker --registries "$registry"
docker pull "$image"
docker pull "$collector_image"

# Recover the stable name if a prior run lost power between its two renames.
if container_exists "$previous_container"; then
	if ! container_exists "$stable_container"; then
		remove_container "$candidate_container"
		docker rename "$previous_container" "$stable_container"
		if ! container_running "$stable_container"; then
			docker start "$stable_container" >/dev/null
		fi
	else
		remove_container "$previous_container"
	fi
fi
remove_container "$candidate_container"

# The enabled COS logging agent reads Docker's default container logs.
docker create \
	--name "$candidate_container" \
	--restart no \
	--network host \
	--env DOMAIN=cogfab.io \
	--env METRICS_ADDR=127.0.0.1:9090 \
	--mount "type=bind,source=$data_dir,target=/data" \
	"$image" >/dev/null

# The deprecated container startup agent prefixes its generated name with
# klt-cogfab-. Keep every current container intact until the candidate answers
# locally, so a failed deploy can put the previous process straight back.
container_names="$(docker container ls --all --format '{{.Names}}')"
while IFS= read -r name; do
	if [[ "$name" == "$stable_container" || "$name" == klt-cogfab-* ]]; then
		previous_containers+=("$name")
		if container_running "$name"; then
			previous_running+=("$name")
		fi
	fi
done <<< "$container_names"

rollback_needed=true
for name in "${previous_containers[@]}"; do
	if container_running "$name"; then
		log "stopping $name"
		docker stop --time=20 "$name" >/dev/null
	fi
done
if container_exists "$stable_container"; then
	stable_was_renamed=true
	docker rename "$stable_container" "$previous_container"
fi

log "starting candidate"
docker start "$candidate_container" >/dev/null
docker update --restart always "$candidate_container" >/dev/null
wait_for_candidate
candidate_was_promoted=true
docker rename "$candidate_container" "$stable_container"
if ! container_running "$stable_container" || ! service_responding; then
	log "promoted container did not stay healthy"
	false
fi
rollback_needed=false

# Metrics are operational support, not application state. A collector failure
# fails the release check but does not roll back a healthy game container.
log "starting metrics collector"
start_collector

# Cleanup happens only after the replacement is serving traffic. Failure here
# must not roll back a healthy deployment.
if ! remove_container "$previous_container"; then
	log "could not remove $previous_container"
fi
for name in "${previous_containers[@]}"; do
	if [[ "$name" != "$stable_container" ]] && ! remove_container "$name"; then
		log "could not remove $name"
	fi
done

log "started $stable_container and $collector_container"
