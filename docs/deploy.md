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

Run this block as a unit. `set -eu` stops at the first failed build, backup,
snapshot, or metadata operation. The local files preserve the old instance
metadata; the disk snapshot separately protects saves and certificates.

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
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/instance.json"
jq -r '.metadata.items[] | select(.key == "gce-container-declaration") | .value' \
  "$BACKUP_DIR/instance.json" > "$BACKUP_DIR/gce-container-declaration.yaml"
jq -r '.metadata.items[] | select(.key == "startup-script") | .value' \
  "$BACKUP_DIR/instance.json" > "$BACKUP_DIR/startup.sh"
test -s "$BACKUP_DIR/gce-container-declaration.yaml"
test -s "$BACKUP_DIR/startup.sh"
echo "Metadata backup: $BACKUP_DIR"

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

gcloud compute instances stop cogfab --zone=us-central1-a
gcloud compute disks snapshot cogfab --zone=us-central1-a \
  --snapshot-names="$SNAPSHOT"
gcloud compute instances set-service-account cogfab --zone=us-central1-a \
  --service-account="$VM_SERVICE_ACCOUNT" --scopes=cloud-platform
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata="cogfab-image=$IMAGE" \
  --metadata-from-file=startup-script=deploy/startup.sh
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=gce-container-declaration
gcloud compute instances describe cogfab --zone=us-central1-a \
  --format=json > "$BACKUP_DIR/after.json"
jq -e '
  ([.metadata.items[].key] | index("gce-container-declaration")) == null and
  ([.metadata.items[].key] | index("startup-script")) != null and
  ([.metadata.items[].key] | index("cogfab-image")) != null
' "$BACKUP_DIR/after.json" >/dev/null
gcloud compute instances start cogfab --zone=us-central1-a
)
```

Verify the site, a real WebSocket session, the save directory, logs, and the
metrics endpoint. Keep the snapshot through the migration's settling period.
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

gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata-from-file="gce-container-declaration=$BACKUP_DIR/gce-container-declaration.yaml,startup-script=$BACKUP_DIR/startup.sh"
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=cogfab-image
gcloud compute instances start cogfab --zone=us-central1-a
)
```

After the new runtime has started, a full rollback begins while the VM is still
running. Remove the new Docker containers, restore both exported metadata
values, and reboot into the old agent-managed declaration:

```sh
(
set -eu
BACKUP_DIR="$HOME/cogfab-migration-YYYYMMDD-HHMMSS" # printed above

gcloud compute ssh cogfab --zone=us-central1-a \
  --command='for name in cogfab cogfab-next cogfab-previous; do sudo docker stop --time=20 "$name" 2>/dev/null || true; sudo docker rm "$name" 2>/dev/null || true; done'
gcloud compute instances stop cogfab --zone=us-central1-a
gcloud compute instances add-metadata cogfab --zone=us-central1-a \
  --metadata-from-file="gce-container-declaration=$BACKUP_DIR/gce-container-declaration.yaml,startup-script=$BACKUP_DIR/startup.sh"
gcloud compute instances remove-metadata cogfab --zone=us-central1-a \
  --keys=cogfab-image
gcloud compute instances start cogfab --zone=us-central1-a
)
```

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
