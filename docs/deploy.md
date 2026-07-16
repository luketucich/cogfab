# Deploying cogfab.io

Cogfab runs as two Docker containers on a Container-Optimized OS VM in GCP.
The game container serves the site, WebSocket, and TLS certificate. A small
OpenTelemetry collector exports private metrics from the VM's loopback
interface.

`deploy/startup.sh` pulls a versioned image from Artifact Registry, checks it,
and swaps containers only after the replacement is healthy. The GKE manifests
in `deploy/` are reference configuration, not the current production setup or
a ready-made horizontal scaling solution.

## One-time setup

Install Docker and the Google Cloud CLI, then authenticate:

```sh
gcloud auth login
gcloud config set project cogfab-io
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  iap.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  oslogin.googleapis.com \
  sts.googleapis.com \
  telemetry.googleapis.com
```

Create the image repository and configure Docker:

```sh
gcloud artifacts repositories create cogfab \
  --repository-format=docker \
  --location=us-central1
gcloud auth configure-docker us-central1-docker.pkg.dev
```

Create a VM service account with only the permissions the container needs:

```sh
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
gcloud projects add-iam-policy-binding cogfab-io \
  --member="serviceAccount:$VM_SERVICE_ACCOUNT" \
  --role=roles/telemetry.metricsWriter
```

Prepare IAP access, reserve the public address, and allow web traffic:

```sh
USER_EMAIL="$(gcloud config get-value account)"
gcloud projects add-iam-policy-binding cogfab-io \
  --member="user:$USER_EMAIL" \
  --role=roles/compute.osAdminLogin
gcloud projects add-iam-policy-binding cogfab-io \
  --member="user:$USER_EMAIL" \
  --role=roles/iap.tunnelResourceAccessor

gcloud compute addresses create cogfab-ip --region=us-central1
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 \
  --target-tags=web
gcloud compute firewall-rules create allow-iap-ssh-cogfab \
  --allow=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-service-accounts="$VM_SERVICE_ACCOUNT"
```

Build the first image, then create the VM:

```sh
test -z "$(git status --porcelain)"
TAG="$(git rev-parse --short HEAD)"
IMAGE="us-central1-docker.pkg.dev/cogfab-io/cogfab/server:$TAG"
docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"

gcloud compute instances create cogfab \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --tags=web \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --address=cogfab-ip \
  --deletion-protection \
  --scopes=cloud-platform \
  --service-account="$VM_SERVICE_ACCOUNT" \
  --metadata="cogfab-image=$IMAGE,enable-oslogin=TRUE,google-logging-enabled=true" \
  --metadata-from-file=startup-script=deploy/startup.sh
```

Confirm IAP access before disabling any public SSH or RDP firewall rules:

```sh
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap
gcloud compute firewall-rules update default-allow-ssh --disabled
gcloud compute firewall-rules update default-allow-rdp --disabled
```

Point the `cogfab.io` and `www.cogfab.io` A records at the reserved address.
The server requests its Let's Encrypt certificate after DNS resolves.

The deploy workflow uses the `production` GitHub environment, the
`github-actions/cogfab-production` Workload Identity provider, and the
`cogfab-deploy` service account. The environment accepts only `main`. The
provider also checks the numeric repository and owner IDs, exact workflow,
branch, environment, and manual event before granting a short-lived identity.

## Deploy

Run the **Deploy production** workflow from GitHub Actions after a change reaches
`main`. It publishes an image tagged with the full commit SHA, deploys its
immutable digest, and verifies the public site and both production containers.
If verification fails, `deploy/release.sh` restores the previous image and
startup script.

The workflow authenticates through Workload Identity Federation. It has no GCP
key and reaches the VM through IAP and OS Login.

Before changing the startup script or save format, open one room in two
browsers, make a recognizable change, and wait at least 35 seconds for the
periodic save. Record the room code and state, then take a disk snapshot. Image
rollback cannot repair incompatible or damaged data.

The current server reads version 1 and version 2 room saves, then writes version
2. A previous release cannot read a room after it has been saved as version 2,
so keep the disk snapshot until the migrated room has been verified in
production.

```sh
SNAPSHOT="cogfab-predeploy-$(date +%Y%m%d-%H%M%S)"
gcloud compute disks snapshot cogfab \
  --zone=us-central1-a \
  --snapshot-names="$SNAPSHOT"
```

### Manual fallback

Use a new image tag for every release. A clean commit makes the deployed source
easy to identify and avoids a floating tag such as `latest`:

```sh
test -z "$(git status --porcelain)"
TAG="$(git rev-parse --short HEAD)"
IMAGE="us-central1-docker.pkg.dev/cogfab-io/cogfab/server:$TAG"

docker build --platform linux/amd64 -t "$IMAGE" .
docker push "$IMAGE"
gcloud compute instances add-metadata cogfab \
  --zone=us-central1-a \
  --metadata="cogfab-image=$IMAGE" \
  --metadata-from-file=startup-script=deploy/startup.sh
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo google_metadata_script_runner startup'
```

The startup script pulls the image before stopping the current container. It
gives the server time to save, starts the replacement, and restores the old
container automatically if the health check fails.

## Verify

Set `EXPECTED_IMAGE` to the image being deployed, then run every check:

```sh
EXPECTED_IMAGE=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:EXPECTED_TAG
test "$(curl -fsS https://cogfab.io/healthz)" = ok
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  https://cogfab.io/metrics)" = 404
test "$(gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command="sudo docker inspect \
    --format '{{.Config.Image}} {{.State.Running}}' cogfab")" = \
  "$EXPECTED_IMAGE true"
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo docker logs --tail 100 cogfab'
```

The health check covers public HTTP and TLS. The `404` confirms that metrics
are not exposed by the public server. For a higher-risk release, also join one
room from two browsers and confirm that a change appears in both. After a
startup or persistence change, wait 35 seconds for the recorded room to save,
confirm its JSON now reports version 2, and reconnect to verify it restores.
Keep the pre-deploy disk snapshot until all three checks pass.

After a room has migrated, do not leave a version 1 image running against its
version 2 save. Fix the release by rolling forward, or restore the pre-deploy
disk snapshot before rolling back the image.

Room saves and certificates live under `/var/lib/cogfab` on the VM:

```sh
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo ls -la /var/lib/cogfab'
```

## Metrics

The app exposes Prometheus-format metrics on VM loopback. A Google-built
OpenTelemetry collector scrapes them once a minute and sends them to Cloud
Monitoring for retention and PromQL queries. The collector has no public
listener.

Open **Monitoring > Metrics explorer** in the `cogfab-io` project and use the
PromQL editor. For example:

```promql
cogfab_players_active
```

`deploy/monitoring/grafana-dashboard.json` is the portable dashboard source.
Its checked-in Cloud Monitoring conversion is applied with the uptime check and
alert policies by running:

```sh
deploy/monitoring/apply.sh
```

Open the [Cogfab Operations dashboard](https://console.cloud.google.com/monitoring/dashboards/builder/cogfab-operations?project=cogfab-io)
to view the live charts.

The production policies notify the primary operator by email. The script
preserves attached notification channels. New projects must add their own
destination under **Monitoring > Alerting > Edit notification channels**.

The collector should be running beside the game:

```sh
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo docker ps --filter name=cogfab-otel'

PROMETHEUS_API="https://monitoring.googleapis.com/v1/projects/cogfab-io/location/global/prometheus/api/v1/query"
curl -fsS \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "$PROMETHEUS_API?query=cogfab_players_active" | \
  grep -q '"cogfab_players_active"'
```

For a raw snapshot, open an SSH tunnel to the private app listener:

```sh
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  -- -N -L 9090:127.0.0.1:9090
```

In another terminal:

```sh
curl -fsS http://127.0.0.1:9090/metrics | grep '^cogfab_'
```

Port 9090 should remain private.

## Roll back

Point the VM at the last known-good image and run the startup script again:

```sh
PREVIOUS_IMAGE=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:PREVIOUS_TAG
gcloud compute instances add-metadata cogfab \
  --zone=us-central1-a \
  --metadata="cogfab-image=$PREVIOUS_IMAGE"
gcloud compute ssh cogfab \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo google_metadata_script_runner startup'
test "$(curl -fsS https://cogfab.io/healthz)" = ok
```

This manual command reuses the startup script stored in VM metadata. If the
failed release changed `deploy/startup.sh`, restore its previous revision in
metadata as well. The normal GitHub deployment path automatically restores
both the image and startup script when verification fails.

The deployment changes the container, not the VM disk, so room saves and
certificates remain in place during a rollback. Set `EXPECTED_IMAGE` to
`$PREVIOUS_IMAGE` and repeat the full **Verify** section.

## Scaling note

The GKE deployment stays at one replica because rooms live in process memory
and the saves disk has one writer. Scaling out requires stable room routing and
shared persistence before increasing the replica count.
