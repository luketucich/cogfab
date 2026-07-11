# Deploying cogfab.io

Production is one container on one Container-Optimized OS VM in GCP's
always-free tier. The checked-in startup script pulls and runs the selected
image; the binary serves the web app, the WebSocket, and its own Let's Encrypt
certificate. Total cost is about $4/month, nearly all of it the static IP.

The GKE manifests in deploy/ are the documented scale-up path for if the game
ever outgrows one machine; they are not what runs today.

## One-time setup

```sh
gcloud auth login
gcloud config set project cogfab-io

# Where images live
gcloud services enable artifactregistry.googleapis.com
gcloud artifacts repositories create cogfab \
  --repository-format=docker --location=us-central1
gcloud auth configure-docker us-central1-docker.pkg.dev

# A narrow VM identity: pull this repository and send container logs.
gcloud iam service-accounts create cogfab-vm \
  --display-name="Cogfab production VM"
VM_SERVICE_ACCOUNT=cogfab-vm@cogfab-io.iam.gserviceaccount.com
gcloud artifacts repositories add-iam-policy-binding cogfab \
  --location=us-central1 \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT" \
  --role=roles/artifactregistry.reader
gcloud projects add-iam-policy-binding cogfab-io \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT" \
  --role=roles/logging.logWriter

# The address DNS points at
gcloud compute addresses create cogfab-ip --region=us-central1

# Let web traffic in
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 --target-tags=web

# The machine (e2-micro in us-central1: always-free tier). cogfab-image is
# deliberately versioned; deploy/startup.sh reads it on every boot.
IMAGE=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v1
gcloud compute instances create cogfab \
  --zone=us-central1-a --machine-type=e2-micro --tags=web \
  --image-family=cos-stable --image-project=cos-cloud \
  --address=cogfab-ip --scopes=cloud-platform \
  --service-account="$VM_SERVICE_ACCOUNT" \
  --metadata="cogfab-image=$IMAGE,google-logging-enabled=true" \
  --metadata-from-file=startup-script=deploy/startup.sh
```

Point DNS at the static IP (an A record for `cogfab.io` and one for
`www.cogfab.io`). The first request after DNS resolves makes the server fetch
its certificate; give it a minute.

## Migrating the existing VM

[Google ends create and update workflows](https://cloud.google.com/compute/docs/containers/prepare-for-container-agent-shutdown)
that use the container startup agent on July 31, 2026; support for already
running agent-managed workloads ends July 31, 2027. Cogfab releases depend on
the earlier workflow, so migrate the current VM before the 2026 deadline.
Create and grant the `cogfab-vm` service account from the one-time setup first;
the migration also replaces the live VM's broad default identity with it.

Before the maintenance window, join one room from two browsers. Make one
recognizable change, confirm that the second browser receives it, wait at least
35 seconds for the periodic save, and record the room code and final state.
Establish the external and operator baselines before continuing:

```sh
test "$(curl -fsS https://cogfab.io/healthz)" = ok
test "$(curl -sS -o /dev/null -w '%{http_code}' https://cogfab.io/metrics)" = 404
gcloud compute ssh cogfab --zone=us-central1-a \
  --command='sudo test -d /var/lib/cogfab'
```

The health check also verifies public TLS. The SSH command proves the access
needed for rollback and private metrics; its first use may create a local key
and publish it to Compute Engine SSH metadata. Do not start the migration unless
that is intentional and the recorded room and all three commands pass.

Run this block as a unit. `set -eu` stops at the first failed build, backup,
snapshot, or metadata operation. The local files preserve the old instance
metadata and VM identity; the disk snapshot separately protects saves and
certificates.

```sh
(
set -eu
IMAGE=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v3
VM_SERVICE_ACCOUNT=cogfab-vm@cogfab-io.iam.gserviceaccount.com
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/cogfab-migration-$STAMP"
SNAPSHOT="cogfab-pre-startup-$STAMP"

command -v jq >/dev/null
gcloud iam service-accounts describe "$VM_SERVICE_ACCOUNT" >/dev/null
mkdir -m 700 "$BACKUP_DIR"
VM_MEMBER="serviceAccount:$VM_SERVICE_ACCOUNT"
gcloud artifacts repositories get-iam-policy cogfab --location=us-central1 \
  --format=json > "$BACKUP_DIR/repository-iam.json"
gcloud projects get-iam-policy cogfab-io \
  --format=json > "$BACKUP_DIR/project-iam.json"
jq -e --arg member "$VM_MEMBER" '
  any(.bindings[]?;
    .role == "roles/artifactregistry.reader" and
    ((.members // []) | index($member)) != null)
' "$BACKUP_DIR/repository-iam.json" >/dev/null
jq -e --arg member "$VM_MEMBER" '
  any(.bindings[]?;
    .role == "roles/logging.logWriter" and
    ((.members // []) | index($member)) != null)
' "$BACKUP_DIR/project-iam.json" >/dev/null
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/instance.json"
ORIGINAL_SERVICE_ACCOUNT="$(jq -er '
  .serviceAccounts |
  if length == 1 then .[0].email else error("expected one service account") end
' "$BACKUP_DIR/instance.json")"
ORIGINAL_SCOPES="$(jq -er '
  .serviceAccounts[0].scopes |
  if length > 0 then join(",") else error("expected access scopes") end
' "$BACKUP_DIR/instance.json")"
BOOT_DISK="$(jq -er '
  [.disks[] | select(.boot)] |
  if length == 1 then .[0].source | split("/")[-1]
  else error("expected one boot disk") end
' "$BACKUP_DIR/instance.json")"
jq -jr '.metadata.items[] | select(.key == "gce-container-declaration") | .value' \
  "$BACKUP_DIR/instance.json" > "$BACKUP_DIR/gce-container-declaration.yaml"
jq -jr '.metadata.items[] | select(.key == "startup-script") | .value' \
  "$BACKUP_DIR/instance.json" > "$BACKUP_DIR/startup.sh"
gcloud compute disks describe "$BOOT_DISK" --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/boot-disk.json"
test -s "$BACKUP_DIR/gce-container-declaration.yaml"
test -s "$BACKUP_DIR/startup.sh"
test -n "$ORIGINAL_SERVICE_ACCOUNT"
test -n "$ORIGINAL_SCOPES"
printf '%s\n' "$SNAPSHOT" > "$BACKUP_DIR/snapshot.txt"
echo "Metadata backup: $BACKUP_DIR"

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
docker buildx imagetools inspect "$IMAGE" > "$BACKUP_DIR/image.txt"
cat "$BACKUP_DIR/image.txt"
grep -q 'Platform:.*linux/amd64' "$BACKUP_DIR/image.txt"
IMAGE_DIGEST="$(awk '$1 == "Digest:" { print $2; exit }' \
  "$BACKUP_DIR/image.txt")"
case "$IMAGE_DIGEST" in
  sha256:*) ;;
  *) echo "Could not read the image digest" >&2; exit 1 ;;
esac
printf '%s\n' "$IMAGE_DIGEST" > "$BACKUP_DIR/image-digest.txt"
echo "Image digest: $IMAGE_DIGEST"

gcloud compute instances stop cogfab --zone=us-central1-a
test "$(gcloud compute instances describe cogfab --zone=us-central1-a \
  --format='value(status)')" = TERMINATED
gcloud compute disks snapshot "$BOOT_DISK" --zone=us-central1-a \
  --snapshot-names="$SNAPSHOT"
snapshot_status=""
snapshot_attempt=0
while [ "$snapshot_attempt" -lt 120 ]; do
  snapshot_status="$(gcloud compute snapshots describe "$SNAPSHOT" \
    --format='value(status)' 2>/dev/null || true)"
  case "$snapshot_status" in
    READY) break ;;
    FAILED) echo "Snapshot failed: $SNAPSHOT" >&2; exit 1 ;;
    CREATING|UPLOADING|"") sleep 5 ;;
    *) echo "Unexpected snapshot status: $snapshot_status" >&2; exit 1 ;;
  esac
  snapshot_attempt=$((snapshot_attempt + 1))
done
test "$snapshot_status" = READY
echo "Disk snapshot: $SNAPSHOT"
gcloud compute instances set-service-account cogfab --zone=us-central1-a \
  --service-account="$VM_SERVICE_ACCOUNT" --scopes=cloud-platform
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata="cogfab-image=$IMAGE" \
  --metadata-from-file=startup-script=deploy/startup.sh
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=gce-container-declaration
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/after.json"
jq -e --arg service_account "$VM_SERVICE_ACCOUNT" --arg image "$IMAGE" \
  --rawfile startup_script deploy/startup.sh '
  ([.metadata.items[].key] | index("gce-container-declaration")) == null and
  ([.metadata.items[] | select(.key == "startup-script") | .value] ==
    [$startup_script]) and
  ([.metadata.items[] | select(.key == "cogfab-image") | .value] ==
    [$image]) and
  .serviceAccounts[0].email == $service_account and
  .serviceAccounts[0].scopes ==
    ["https://www.googleapis.com/auth/cloud-platform"]
' "$BACKUP_DIR/after.json" >/dev/null
gcloud compute instances start cogfab --zone=us-central1-a
)
```

The migration succeeds only after every check below passes:

- `curl -fsS https://cogfab.io/healthz` returns `ok`, proving external TLS and
  HTTP health.
- The recorded room restores its recognizable state; two browser clients can
  join it and see a new change in real time, proving persistence and WebSockets.
- On the VM, `sudo docker ps --all --format '{{.Names}} {{.Image}} {{.Status}}'`
  shows `cogfab` running `server:v3` and no `cogfab-next`, `cogfab-previous`,
  or `klt-cogfab-*` container, and `test "$(sudo docker inspect --format
  '{{.State.Running}}' cogfab)" = true` confirms it is running. `sudo docker
  image inspect "$(sudo docker inspect --format '{{.Image}}' cogfab)"
  --format '{{json .RepoDigests}}'` prints its registry digest, and `sudo docker
  logs --tail 100 cogfab` has no startup errors. In the operator shell, set
  `BACKUP_DIR` to the printed metadata backup and compare the digest with
  `cat "$BACKUP_DIR/image-digest.txt"`.
- This command returns the container's `server listening domain=cogfab.io`
  entry, proving the narrow VM identity can still write Cloud logs:

  ```sh
  gcloud logging read \
    'resource.type="gce_instance" AND logName="projects/cogfab-io/logs/cos_containers" AND (jsonPayload."cos.googleapis.com/container_name"="cogfab-next" OR jsonPayload."cos.googleapis.com/container_name"="cogfab") AND jsonPayload.message:"server listening domain=cogfab.io"' \
    --project=cogfab-io --freshness=15m --limit=1 \
    --format='value(jsonPayload.message)'
  ```

- The SSH-tunneled check under **Checking on it** returns `cogfab_*` metrics,
  while `https://cogfab.io/metrics` still returns `404`.

Keep the printed metadata backup and disk snapshot for at least 24 hours after
all checks pass. Roll back if any check fails; delete the snapshot only in a
later cleanup after that settling period.

If the new image is the only problem, set `cogfab-image` back to the last
working tag and rerun the startup script. If the block stops after shutting
down the VM but before `add-metadata`, starting it resumes the legacy runtime.
If it stops during either metadata command, leave the VM stopped: retry the
declaration removal or use the full rollback below so only one startup
mechanism is present when the VM boots.

The snapshot does not contain instance metadata. If the migration stops during
the metadata steps and the VM has not booted the new script, restore the old
metadata directly while it remains stopped:

```sh
(
set -eu
BACKUP_DIR="$HOME/cogfab-migration-YYYYMMDD-HHMMSS" # printed above
ORIGINAL_SERVICE_ACCOUNT="$(jq -er '.serviceAccounts[0].email' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_SCOPES="$(jq -er '.serviceAccounts[0].scopes | join(",")' \
  "$BACKUP_DIR/instance.json")"

test "$(gcloud compute instances describe cogfab --zone=us-central1-a \
  --format='value(status)')" = TERMINATED
gcloud compute instances set-service-account cogfab --zone=us-central1-a \
  --service-account="$ORIGINAL_SERVICE_ACCOUNT" --scopes="$ORIGINAL_SCOPES"
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata-from-file="gce-container-declaration=$BACKUP_DIR/gce-container-declaration.yaml,startup-script=$BACKUP_DIR/startup.sh"
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=cogfab-image
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/rollback.json"
jq -e --slurpfile original "$BACKUP_DIR/instance.json" '
  ([.metadata.items[]] | sort_by(.key)) ==
    ([$original[0].metadata.items[]] | sort_by(.key)) and
  .serviceAccounts == $original[0].serviceAccounts
' "$BACKUP_DIR/rollback.json" >/dev/null
gcloud compute instances start cogfab --zone=us-central1-a
)
```

After the new runtime has started, a full rollback begins while the VM is still
running. This path requires SSH so it can remove the new Docker containers
before restoring the old identity and metadata. If SSH cleanup fails, the block
stops the VM and exits without changing either; use the disk restore below.

```sh
(
set -eu
BACKUP_DIR="$HOME/cogfab-migration-YYYYMMDD-HHMMSS" # printed above
ORIGINAL_SERVICE_ACCOUNT="$(jq -er '.serviceAccounts[0].email' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_SCOPES="$(jq -er '.serviceAccounts[0].scopes | join(",")' \
  "$BACKUP_DIR/instance.json")"

if ! gcloud compute ssh cogfab --zone=us-central1-a --command='
set -eu
sudo docker info >/dev/null
for name in cogfab cogfab-next cogfab-previous; do
  if sudo docker container inspect "$name" >/dev/null 2>&1; then
    sudo docker stop --time=20 "$name" >/dev/null
    sudo docker rm "$name" >/dev/null
  fi
done
sudo docker info >/dev/null
for name in cogfab cogfab-next cogfab-previous; do
  if sudo docker container inspect "$name" >/dev/null 2>&1; then
    echo "Docker cleanup left $name behind" >&2
    exit 1
  fi
done
'; then
  gcloud compute instances stop cogfab --zone=us-central1-a
  echo "SSH cleanup failed; use the disk restore below" >&2
  exit 1
fi
gcloud compute instances stop cogfab --zone=us-central1-a
test "$(gcloud compute instances describe cogfab --zone=us-central1-a \
  --format='value(status)')" = TERMINATED
gcloud compute instances set-service-account cogfab --zone=us-central1-a \
  --service-account="$ORIGINAL_SERVICE_ACCOUNT" --scopes="$ORIGINAL_SCOPES"
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata-from-file="gce-container-declaration=$BACKUP_DIR/gce-container-declaration.yaml,startup-script=$BACKUP_DIR/startup.sh"
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=cogfab-image
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/rollback.json"
jq -e --slurpfile original "$BACKUP_DIR/instance.json" '
  ([.metadata.items[]] | sort_by(.key)) ==
    ([$original[0].metadata.items[]] | sort_by(.key)) and
  .serviceAccounts == $original[0].serviceAccounts
' "$BACKUP_DIR/rollback.json" >/dev/null
gcloud compute instances start cogfab --zone=us-central1-a
)
```

If saves or certificates are corrupt, metadata rollback is not enough. Restore
the stopped boot disk from the snapshot as a last resort. This preserves the
current disk, restores the old metadata and identity, and verifies the critical
configuration before booting:

```sh
(
set -eu
BACKUP_DIR="$HOME/cogfab-migration-YYYYMMDD-HHMMSS" # printed above
STAMP="$(date +%Y%m%d-%H%M%S)"
SNAPSHOT="$(cat "$BACKUP_DIR/snapshot.txt")"
RESTORED_DISK="cogfab-restored-$STAMP"
ORIGINAL_SERVICE_ACCOUNT="$(jq -er '.serviceAccounts[0].email' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_SCOPES="$(jq -er '.serviceAccounts[0].scopes | join(",")' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_BOOT_DISK="$(jq -er '
  [.disks[] | select(.boot)][0].source | split("/")[-1]
' "$BACKUP_DIR/instance.json")"
ORIGINAL_DEVICE_NAME="$(jq -er '[.disks[] | select(.boot)][0].deviceName' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_INTERFACE="$(jq -er '[.disks[] | select(.boot)][0].interface' \
  "$BACKUP_DIR/instance.json")"
ORIGINAL_DISK_TYPE="$(jq -er '.type | split("/")[-1]' \
  "$BACKUP_DIR/boot-disk.json")"
SNAPSHOT_SIZE="$(gcloud compute snapshots describe "$SNAPSHOT" \
  --format='value(diskSizeGb)')"

test "$(gcloud compute snapshots describe "$SNAPSHOT" \
  --format='value(status)')" = READY
gcloud compute instances stop cogfab --zone=us-central1-a
test "$(gcloud compute instances describe cogfab --zone=us-central1-a \
  --format='value(status)')" = TERMINATED
gcloud compute disks create "$RESTORED_DISK" --zone=us-central1-a \
  --source-snapshot="$SNAPSHOT" --size="${SNAPSHOT_SIZE}GB" \
  --type="$ORIGINAL_DISK_TYPE"
gcloud compute disks describe "$RESTORED_DISK" --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/restored-disk.json"
jq -e --slurpfile original "$BACKUP_DIR/boot-disk.json" '
  .status == "READY" and
  .type == $original[0].type and
  .architecture == $original[0].architecture and
  ([.licenses[]] | sort) == ([$original[0].licenses[]] | sort) and
  ([.guestOsFeatures[]?.type] | sort) ==
    ([$original[0].guestOsFeatures[]?.type] | sort)
' "$BACKUP_DIR/restored-disk.json" >/dev/null

gcloud compute instances set-disk-auto-delete cogfab --zone=us-central1-a \
  --disk="$ORIGINAL_BOOT_DISK" --no-auto-delete
gcloud compute instances detach-disk cogfab --zone=us-central1-a \
  --disk="$ORIGINAL_BOOT_DISK"
if ! gcloud compute instances attach-disk cogfab --zone=us-central1-a \
  --disk="$RESTORED_DISK" --boot --device-name="$ORIGINAL_DEVICE_NAME" \
  --interface="$ORIGINAL_INTERFACE" --mode=rw; then
  gcloud compute instances attach-disk cogfab --zone=us-central1-a \
    --disk="$ORIGINAL_BOOT_DISK" --boot \
    --device-name="$ORIGINAL_DEVICE_NAME" \
    --interface="$ORIGINAL_INTERFACE" --mode=rw
  echo "Restored-disk attachment failed; original disk reattached" >&2
  exit 1
fi
gcloud compute instances set-disk-auto-delete cogfab --zone=us-central1-a \
  --disk="$RESTORED_DISK" --no-auto-delete
gcloud compute instances set-service-account cogfab --zone=us-central1-a \
  --service-account="$ORIGINAL_SERVICE_ACCOUNT" --scopes="$ORIGINAL_SCOPES"
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata-from-file="gce-container-declaration=$BACKUP_DIR/gce-container-declaration.yaml,startup-script=$BACKUP_DIR/startup.sh"
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=cogfab-image
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/disk-restore.json"
jq -e --arg disk "$RESTORED_DISK" \
  --arg device_name "$ORIGINAL_DEVICE_NAME" \
  --arg interface "$ORIGINAL_INTERFACE" \
  --slurpfile original "$BACKUP_DIR/instance.json" '
  ([.disks[] | select(.boot)] | length) == 1 and
  ([.disks[] | select(.boot)][0].source | endswith("/disks/" + $disk)) and
  [.disks[] | select(.boot)][0].deviceName == $device_name and
  [.disks[] | select(.boot)][0].interface == $interface and
  [.disks[] | select(.boot)][0].mode == "READ_WRITE" and
  [.disks[] | select(.boot)][0].autoDelete == false and
  ([.metadata.items[]] | sort_by(.key)) ==
    ([$original[0].metadata.items[]] | sort_by(.key)) and
  .serviceAccounts == $original[0].serviceAccounts
' "$BACKUP_DIR/disk-restore.json" >/dev/null
gcloud compute instances start cogfab --zone=us-central1-a
)
```

Do not delete either disk during recovery. The block reattaches the preserved
original automatically if the replacement cannot be attached. Keep both disks
until the 24-hour settling period ends.

## Each deploy

```sh
IMAGE=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v4

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata="cogfab-image=$IMAGE"
gcloud compute ssh cogfab --zone=us-central1-a \
  --command='sudo google_metadata_script_runner startup'
```

Bump the tag each release. The script pulls before stopping the old container,
then gives it twenty seconds to save and exit cleanly. The swap takes a few
seconds; clients reconnect on their own.

## Checking on it

```sh
curl -s https://cogfab.io/healthz                # ok?
gcloud compute ssh cogfab --zone=us-central1-a   # then: docker ps, docker logs cogfab
ls /var/lib/cogfab                               # on the VM: room saves + certs
```

The startup script binds operational metrics to VM loopback only. Inspect them
through an SSH tunnel without opening a firewall port:

```sh
gcloud compute ssh cogfab --zone=us-central1-a -- -N -L 9090:127.0.0.1:9090
# In another terminal:
curl -s http://127.0.0.1:9090/metrics | grep '^cogfab_'
```

This endpoint is a current snapshot, not stored history. A private scraper and
dashboard are a separate deployment step; never expose port 9090 publicly.
