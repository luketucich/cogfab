# Deploying to GKE

One image, one pod, one disk. The server binary serves the web app and the
WebSocket on the same origin, so there is nothing else to host.

## One-time setup

```sh
gcloud auth login
gcloud config set project PROJECT_ID

# Where images live
gcloud artifacts repositories create cogfab \
  --repository-format=docker --location=us-central1
gcloud auth configure-docker us-central1-docker.pkg.dev

# The cluster (Autopilot: no nodes to manage, pay per pod)
gcloud container clusters create-auto cogfab --region=us-central1
gcloud container clusters get-credentials cogfab --region=us-central1

# The ingress IP that DNS points at (survives recreating the ingress)
gcloud compute addresses create cogfab-ip --global
gcloud compute addresses describe cogfab-ip --global --format='value(address)'
```

Point DNS at that address: an A record for `cogfab.io` and one for
`www.cogfab.io`. The managed certificate will not issue until DNS resolves.

## Each deploy

```sh
docker build -t us-central1-docker.pkg.dev/PROJECT_ID/cogfab/server:v1 .
docker push us-central1-docker.pkg.dev/PROJECT_ID/cogfab/server:v1
kubectl apply -f deploy/
```

Bump the tag (v2, v3, ...) each release and update it in
`deploy/deployment.yaml`; `kubectl apply -f deploy/` rolls it out. The
strategy is Recreate, so there is a few seconds of downtime while the old pod
writes its final saves and lets go of the disk; clients reconnect on their
own.

## Checking on it

```sh
kubectl get pods                        # Running?
kubectl logs deploy/cogfab              # server logs (slog)
kubectl get managedcertificate          # Active once DNS + cert are ready
kubectl describe ingress cogfab        # the LB's view of the backend
```

First bring-up is slow: the load balancer takes ~10 minutes and the
certificate up to an hour after DNS points at the IP. After that,
https://cogfab.io is the game.
