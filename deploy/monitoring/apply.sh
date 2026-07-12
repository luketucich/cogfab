#!/bin/bash

set -euo pipefail

readonly project="cogfab-io"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly script_dir
readonly dashboard_id="cogfab-operations"
readonly uptime_name="Cogfab health"

command -v jq >/dev/null || {
	echo "jq is required to update the monitoring dashboard" >&2
	exit 1
}

temp_dir="$(mktemp -d)"
readonly temp_dir
trap 'rm -rf "$temp_dir"' EXIT

policy_id() {
	local display_name="$1"
	gcloud monitoring policies list \
		--project="$project" \
		--filter="displayName=\"$display_name\"" \
		--format='value(name.basename())' | head -n 1
}

find_uptime_id() {
	gcloud monitoring uptime list-configs \
		--project="$project" \
		--filter="displayName=\"$uptime_name\"" \
		--format='value(name.basename())' | head -n 1
}

apply_policy() {
	local file="$1"
	local display_name="$2"
	local id
	local policy_config
	id="$(policy_id "$display_name")"
	if [[ -n "$id" ]]; then
		policy_config="$(mktemp "$temp_dir/policy.XXXXXX")"
		gcloud monitoring policies describe "$id" \
			--project="$project" \
			--format=json | \
			jq --slurpfile desired "$file" \
				'. as $existing
				| $desired[0]
				| .notificationChannels = ($existing.notificationChannels // [])
				| .conditions |= map(
					. as $wanted
					| [$existing.conditions[]
						| select(.displayName == $wanted.displayName)
						| .name][0] as $name
					| if $name then . + {name: $name} else . end
				)' \
				> "$policy_config"
		gcloud monitoring policies update "$id" \
			--project="$project" \
			--policy-from-file="$policy_config" \
			--quiet >/dev/null
	else
		gcloud monitoring policies create \
			--project="$project" \
			--policy-from-file="$file" \
			--quiet >/dev/null
	fi
}

if gcloud monitoring dashboards describe "$dashboard_id" \
	--project="$project" >/dev/null 2>&1; then
	dashboard_config="$temp_dir/dashboard.json"
	dashboard_etag="$(gcloud monitoring dashboards describe "$dashboard_id" \
		--project="$project" \
		--format='value(etag)')"
	jq --arg etag "$dashboard_etag" '. + {etag: $etag}' \
		"$script_dir/cloud-dashboard.json" > "$dashboard_config"
	gcloud monitoring dashboards update "$dashboard_id" \
		--project="$project" \
		--config-from-file="$dashboard_config" \
		--quiet >/dev/null
else
	gcloud monitoring dashboards create \
		--project="$project" \
		--config-from-file="$script_dir/cloud-dashboard.json" \
		--quiet >/dev/null
fi

uptime_id="$(find_uptime_id)"
if [[ -n "$uptime_id" ]]; then
	gcloud monitoring uptime update "$uptime_id" \
		--project="$project" \
		--display-name="$uptime_name" \
		--path=/healthz \
		--period=1 \
		--timeout=10 \
		--validate-ssl=true \
		--set-status-codes=200 \
		--matcher-content=ok \
		--matcher-type=contains-string \
		--quiet >/dev/null
else
	gcloud monitoring uptime create "$uptime_name" \
		--project="$project" \
		--resource-type=uptime-url \
		--resource-labels="host=cogfab.io,project_id=$project" \
		--protocol=https \
		--path=/healthz \
		--period=1 \
		--timeout=10 \
		--validate-ssl=true \
		--status-codes=200 \
		--matcher-content=ok \
		--matcher-type=contains-string \
		--quiet >/dev/null
fi

uptime_id="$(find_uptime_id)"
if [[ -z "$uptime_id" ]]; then
	echo "Could not find the Cogfab uptime check after applying it" >&2
	exit 1
fi

uptime_policy="$temp_dir/uptime-policy.json"
jq --arg check_id "$uptime_id" \
	'(.conditions[0].conditionThreshold.filter) |= sub("UPTIME_CHECK_ID"; $check_id)' \
	"$script_dir/alerts/uptime.json" > "$uptime_policy"

apply_policy "$uptime_policy" "Cogfab is unavailable"
apply_policy "$script_dir/alerts/metrics-missing.json" "Cogfab metrics are missing"
apply_policy "$script_dir/alerts/save-failures.json" "Cogfab room save failed"

echo "Applied Cogfab dashboard, uptime check, and alert policies to $project."
