# Deploying cogfab.io

Production is one container on one VM in GCP's always-free tier. The binary
serves the web app, the WebSocket, and its own Let's Encrypt certificate
(DOMAIN env turns that on), so there is nothing else in the stack. Total cost
is about $4/month, nearly all of it the static IP.

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

# The address DNS points at
gcloud compute addresses create cogfab-ip --region=us-central1

# Let web traffic in
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 --target-tags=web

# The machine (e2-micro in us-central1: always-free tier). The startup
# script lets the non-root container bind ports 80/443 and hands it a
# writable /data for saves and certificates.
gcloud compute instances create-with-container cogfab \
  --zone=us-central1-a --machine-type=e2-micro --tags=web \
  --image-family=cos-stable --image-project=cos-cloud \
  --address=cogfab-ip --scopes=cloud-platform \
  --container-image=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v1 \
  --container-env=DOMAIN=cogfab.io \
  --container-mount-host-path=mount-path=/data,host-path=/var/lib/cogfab,mode=rw \
  --metadata=startup-script='#! /bin/bash
sysctl -w net.ipv4.ip_unprivileged_port_start=0
mkdir -p /var/lib/cogfab && chown 65532:65532 /var/lib/cogfab'
```

Point DNS at the static IP (an A record for `cogfab.io` and one for
`www.cogfab.io`). The first request after DNS resolves makes the server fetch
its certificate; give it a minute.

## Each deploy

```sh
docker build --platform linux/amd64 \
  -t us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v2 .
docker push us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v2
gcloud compute instances update-container cogfab --zone=us-central1-a \
  --container-image=us-central1-docker.pkg.dev/cogfab-io/cogfab/server:v2
```

Bump the tag each release. The swap takes a few seconds of downtime; the old
container writes its final room saves on the way down and clients reconnect
on their own.

## Checking on it

```sh
curl -s https://cogfab.io/healthz                # ok?
gcloud compute ssh cogfab --zone=us-central1-a   # then: docker ps, docker logs <id>
ls /var/lib/cogfab                               # on the VM: room saves + certs
```
