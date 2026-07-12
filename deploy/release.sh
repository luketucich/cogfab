#!/bin/bash

set -euo pipefail

readonly project="cogfab-io"
readonly zone="us-central1-a"
readonly vm="cogfab"
readonly image_repository="us-central1-docker.pkg.dev/cogfab-io/cogfab/server"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
readonly startup_script="$script_dir/startup.sh"

image="${1:-}"
readonly image
digest="${image#"$image_repository@sha256:"}"
readonly digest
if [[ "$image" != "$image_repository@sha256:$digest" || \
	! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
	echo "usage: $0 $image_repository@sha256:DIGEST" >&2
	exit 1
fi

temp_dir="$(mktemp -d)"
readonly temp_dir
readonly previous_image_file="$temp_dir/previous-image"
readonly previous_startup_script="$temp_dir/previous-startup.sh"
deployment_started=false

log() {
	echo "cogfab-release: $*"
}

ssh_vm() {
	gcloud compute ssh "$vm" \
		--project="$project" \
		--zone="$zone" \
		--tunnel-through-iap \
		--ssh-flag="-o ServerAliveInterval=30" \
		--command="$1" \
		--quiet
}

site_responding() {
	local health root_status metrics_status
	health="$(curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
		https://cogfab.io/healthz || true)"
	root_status="$(curl --silent --output /dev/null --connect-timeout 2 --max-time 5 \
		--write-out '%{http_code}' https://cogfab.io/ || true)"
	metrics_status="$(curl --silent --output /dev/null --connect-timeout 2 --max-time 5 \
		--write-out '%{http_code}' https://cogfab.io/metrics || true)"
	[[ "$health" == ok && "$root_status" == 200 && "$metrics_status" == 404 ]]
}

wait_for_site() {
	for _ in {1..8}; do
		if site_responding; then
			return
		fi
		sleep 5
	done
	log "public verification failed"
	return 1
}

verify_containers() {
	local expected_image="$1"
	ssh_vm "
		test \"\$(sudo docker inspect --format '{{.Config.Image}}' cogfab)\" = \"$expected_image\" &&
		test \"\$(sudo docker inspect --format '{{.State.Running}}' cogfab)\" = true &&
		test \"\$(sudo docker inspect --format '{{.State.Running}}' cogfab-otel)\" = true &&
		curl --fail --silent --connect-timeout 2 --max-time 5 \
			http://127.0.0.1:13133/ >/dev/null
	"
}

rollback() (
	set -euo pipefail
	local previous_image
	previous_image="$(< "$previous_image_file")"
	log "restoring $previous_image"
	gcloud compute instances add-metadata "$vm" \
		--project="$project" \
		--zone="$zone" \
		--metadata="cogfab-image=$previous_image" \
		--metadata-from-file="startup-script=$previous_startup_script" \
		--quiet
	if site_responding && verify_containers "$previous_image"; then
		log "previous release is already healthy"
		return
	fi
	ssh_vm 'sudo google_metadata_script_runner startup'
	wait_for_site
	verify_containers "$previous_image"
	log "rollback verified"
)

on_exit() {
	local status=$?
	trap - EXIT
	set +e
	if [[ "$status" -ne 0 && "$deployment_started" == true ]]; then
		if ! rollback; then
			log "automatic rollback failed"
		fi
	fi
	rm -rf "$temp_dir"
	exit "$status"
}
trap on_exit EXIT

log "capturing the current release"
gcloud compute instances describe "$vm" \
	--project="$project" \
	--zone="$zone" \
	--format='get(metadata.items.cogfab-image)' > "$previous_image_file"
gcloud compute instances describe "$vm" \
	--project="$project" \
	--zone="$zone" \
	--format='get(metadata.items.startup-script)' > "$previous_startup_script"
if [[ ! -s "$previous_image_file" || ! -s "$previous_startup_script" ]]; then
	log "current release metadata is incomplete"
	exit 1
fi

log "deploying $image"
deployment_started=true
gcloud compute instances add-metadata "$vm" \
	--project="$project" \
	--zone="$zone" \
	--metadata="cogfab-image=$image" \
	--metadata-from-file="startup-script=$startup_script" \
	--quiet
ssh_vm 'sudo google_metadata_script_runner startup'

wait_for_site
verify_containers "$image"
deployment_started=false
log "deployment verified"
