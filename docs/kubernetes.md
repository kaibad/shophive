# ShopHive Non-Prod Kubernetes Migration — MicroK8s on a Single EC2 (AWS)

**Goal:** Move `dev` and `staging` off Docker Compose on EC2 onto a single MicroK8s cluster — one EC2 instance, on-demand, two namespaces (`dev`, `staging`) — using the default VPC, no domain (nip.io), minimum-cost setup, manual AWS Console steps (no CLI), and no SSH (SSM Session Manager only).

---

## Constraints Driving This Design

- Minimum cost
- One EC2 instance, one MicroK8s cluster, two namespaces (`dev`, `staging`) — not two separate clusters
- On-demand instance (no Spot interruptions)
- No scheduled stop/start — runs 24/7
- No domain — nip.io wildcard hostnames, no TLS

---

## Architecture

### 1. Network Layer

```
Default VPC (already exists, per-region)
 └── Default public subnet (any AZ)
      - Auto-assign public IP: on (default VPC behavior)
      - Route table: already has 0.0.0.0/0 → Internet Gateway (default)
      └── EC2 instance (MicroK8s node)
           - Elastic IP attached (static, survives stop/start)
           - Security Group (new, scoped to this instance):
               inbound: 80/tcp, 443/tcp   from 0.0.0.0/0
               inbound: 16443/tcp          from admin IP only (kubectl API access)
               inbound: none for SSH       (SSM Session Manager instead)
               outbound: all
```

**Why this works:**

- No NAT Gateway needed (saves ~$32/mo) — public subnet + SG already gives outbound internet for free.
- No SSH key pair — SSM Session Manager only, reduces attack surface.
- Elastic IP stays static, and is what nip.io hostnames resolve against.
- Default VPC subnets are public by default — fine here since the instance needs inbound 80/443 anyway.

### 2. Compute

- 1× **t3.medium**, on-demand (2 vCPU / 4GB)
- Single-node MicroK8s — this one node is both control-plane and worker
- Root volume: **20GB gp3 EBS**

### 3. Cluster Layout

```
MicroK8s (single node)
 ├── namespace: dev
 │    ├── postgres (StatefulSet, manual PV via hostPath)
 │    ├── backend (Django, Deployment)
 │    ├── frontend (React, Deployment)
 │    ├── static-server (nginx, serves /static /media)
 │    └── ResourceQuota (caps dev's cpu/mem)
 │
 ├── namespace: staging
 │    ├── postgres (StatefulSet, manual PV via hostPath)
 │    ├── backend
 │    ├── frontend
 │    ├── static-server
 │    └── ResourceQuota (caps staging's cpu/mem)
 │
 └── ingress-nginx (cluster-wide, DaemonSet with hostPort 80/443)
      ├── dev.<EIP>.nip.io      → routes into dev namespace
      └── staging.<EIP>.nip.io  → routes into staging namespace
```

- **hostpath-storage** addon for dynamically-provisioned PVs (static/media volumes)
- **Manual PVs with `claimRef`** for Postgres (deliberate choice, see Step 7)
- **Postgres runs in-cluster** for both dev and staging (not RDS) — cost-saving, non-prod only
- **ResourceQuotas** per namespace so one environment can't starve the other

### 4. Addons Enabled

```bash
microk8s enable dns helm3 ingress hostpath-storage
```

No `cert-manager` (no domain), no `metallb` (single node, ingress-nginx binds host directly).

### 5. Access / Traffic Flow

```
Internet → Elastic IP → ingress-nginx (hostPort) → host-header routing → Service → Pod
```

- `dev.<EIP>.nip.io` and `staging.<EIP>.nip.io` — free, auto-resolving wildcard DNS
- Plain HTTP (no TLS) — acceptable for non-prod

### 6. Service Types Used

| Component     | Service Type | Reachable From                            |
| ------------- | ------------ | ----------------------------------------- |
| Postgres      | ClusterIP    | Inside cluster only                       |
| Backend       | ClusterIP    | Inside cluster only (exposed via Ingress) |
| Frontend      | ClusterIP    | Inside cluster only (exposed via Ingress) |
| static-server | ClusterIP    | Inside cluster only (exposed via Ingress) |

NodePort/LoadBalancer are **not used anywhere** — ingress-nginx's `hostPort` binding handles all external access.

### Estimated Monthly Cost

| Item                  |                  Estimated Monthly Cost |
| --------------------- | --------------------------------------: |
| t3.medium (On-Demand) |                                 ~$30.00 |
| 20 GB gp3 EBS         |                                  ~$1.60 |
| Elastic IP (attached) |                                   $0.00 |
| NAT Gateway           |                        $0.00 (not used) |
| ALB                   |                        $0.00 (not used) |
| Route 53 / ACM        |                        $0.00 (not used) |
| **Total**             | **~$32/month for both dev and staging** |

---

## Deployment vs. StatefulSet — Why Each Was Chosen

| Feature       | Deployment                             | StatefulSet                                   |
| ------------- | -------------------------------------- | --------------------------------------------- |
| Pod naming    | Random suffix (`backend-7d9f8c-xk2p9`) | Stable, ordered (`postgres-0`)                |
| Pod identity  | New identity restart                   | Same identity across restarts                 |
| Storage       | Shared/ephemeral                       | Own PVC per pod, reattaches to same volume    |
| Startup order | Any order, parallel                    | Sequential (0, 1, 2...)                       |
| Networking    | Interchangeable behind Service         | Stable DNS per pod                            |
| Used for      | backend, frontend (stateless)          | postgres (stateful, needs identity + storage) |

**Rule of thumb:** if restarting a pod and losing its identity/order would corrupt something (databases, brokers) → StatefulSet. If pods are stateless/swappable → Deployment.

---

## Step-by-Step Build Log

### Phase 1 — EC2 + MicroK8s Bootstrap

**1. IAM Role for SSM (Console)**

- IAM → Roles → Create role → AWS service → EC2
- Attach policy: `AmazonSSMManagedInstanceCore`
- Name: `shophive-nonprod-node-role`

**2. Security Group (Console)**

- Name: `shophive-nonprod-sg`, in default VPC
- Inbound: HTTP (80) from `0.0.0.0/0`, HTTPS (443) from `0.0.0.0/0`, Custom TCP 16443 from My IP
- No port 22 rule
- Outbound: default (all allowed)

**3. Launch Instance (Console)**

- Name: `shophive-nonprod-microk8s`
- AMI: Ubuntu Server 24.04 LTS
- Type: `t3.medium`
- Key pair: **Proceed without a key pair**
- Default VPC, default subnet, public IP enabled, SG: `shophive-nonprod-sg`
- Storage: 20 GiB gp3
- IAM instance profile: `shophive-nonprod-node-role`

**4. Elastic IP (Console)**

- EC2 → Elastic IPs → Allocate → Associate to the instance
- Recorded IP: `13.126.217.132`
- nip.io bases: `dev.13.126.217.132.nip.io`, `staging.13.126.217.132.nip.io`

**5. Connect via SSM**

- EC2 → Instances → select instance → Connect → Session Manager tab → Connect

**6. Install MicroK8s**

```bash
sudo apt update -y
sudo snap install microk8s --classic --channel=1.31/stable
sudo usermod -aG microk8s ssm-user
sudo chown -fR ssm-user ~/.kube 2>/dev/null || true
exit
# reconnect
microk8s status --wait-ready
microk8s enable dns helm3 ingress hostpath-storage
```

**7. Verify Cluster**

```bash
microk8s kubectl get nodes
microk8s kubectl get pods -A
```

Confirmed: node `Ready`, Calico + CoreDNS + ingress-nginx + hostpath-provisioner all `Running`.

**8. Verify Ingress binds to host ports**

```bash
microk8s kubectl get daemonset -n ingress
microk8s kubectl describe pod -n ingress -l name=nginx-ingress-microk8s
```

Confirmed `Host Ports: 80/TCP, 443/TCP, 10254/TCP` — ingress-nginx runs as a DaemonSet with `hostNetwork`/`hostPort`, not a ClusterIP/LoadBalancer Service (so `get svc -n ingress` correctly shows nothing).

```bash
curl -I http://13.126.217.132
# → HTTP/1.1 404 Not Found (expected — nginx up, no Ingress rules yet)
```

---

### Phase 2 — Namespaces + ResourceQuotas

**`namespace.yml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: dev
---
apiVersion: v1
kind: Namespace
metadata:
  name: staging
```

**`resourcequotas.yml`** (final version, bumped after a rollout quota conflict — see Errors section)

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: dev-quota
  namespace: dev
spec:
  hard:
    requests.cpu: "800m"
    requests.memory: 1.5Gi
    limits.cpu: "1500m"
    limits.memory: 3Gi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: staging-quota
  namespace: staging
spec:
  hard:
    requests.cpu: "1"
    requests.memory: 2Gi
    limits.cpu: "2"
    limits.memory: 3Gi
```

```bash
microk8s kubectl apply -f namespace.yml
microk8s kubectl apply -f resourcequotas.yml
microk8s kubectl get ns
microk8s kubectl describe resourcequota dev-quota -n dev
microk8s kubectl describe resourcequota staging-quota -n staging
```

---

### Phase 3 — Postgres (StatefulSet + Manual PV)

**Why manual PVs instead of dynamic provisioning:** deliberate choice for Postgres to fully control the hostPath location and reclaim policy (`Retain` — data survives PVC deletion). Static/media volumes use dynamic provisioning instead (simpler, non-critical data).

**1. Confirm StorageClass**

```bash
microk8s kubectl get storageclass
# microk8s-hostpath (default)   microk8s.io/hostpath   Delete
```

**2. Create hostPath directories on the node**

```bash
sudo mkdir -p /data/postgres-dev
sudo mkdir -p /data/postgres-staging
sudo chmod 777 /data/postgres-dev /data/postgres-staging
```

**3. Secrets** (`secrets-dev.yml`, `secrets-staging.yml`)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: shophive-secrets
  namespace: dev
type: Opaque
data:
  DB_NAME: <base64>
  DB_USER: <base64>
  DB_PASSWORD: <base64>
  SECRET_KEY: <base64>
```

Same shape for staging, `namespace: staging`. **Different DB_PASSWORD and SECRET_KEY per environment** — never reuse across dev/staging.

Generate values:

```bash
openssl rand -base64 24                                          # DB password
python3 -c "import secrets; print(secrets.token_urlsafe(50))"    # Django SECRET_KEY
echo -n '<value>' | base64                                       # base64-encode for the manifest
```

**4. PVs with `claimRef`** (final version, fixed after a binding mismatch — see Errors)

```yaml
# pv-dev.yml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv-dev
spec:
  capacity:
    storage: 2Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /data/postgres-dev
  claimRef:
    namespace: dev
    name: postgres-pvc
```

```yaml
# pv-staging.yml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgres-pv-staging
spec:
  capacity:
    storage: 3Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath:
    path: /data/postgres-staging
  claimRef:
    namespace: staging
    name: postgres-pvc
```

**5. Postgres PVC + StatefulSet + Service** (final version, with correct env var mapping — see Errors)

```yaml
# postgres-dev.yml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: dev
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: manual
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: dev
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_NAME }
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_USER }
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_PASSWORD }
            - name: DB_NAME
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_NAME }
            - name: DB_USER
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_USER }
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "$(DB_USER)", "-d", "$(DB_NAME)"]
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 300m, memory: 512Mi }
      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: dev
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
```

`postgres-staging.yml` — identical shape, `namespace: staging`, resources bumped to `150m/384Mi` req, `400m/768Mi` limit.

**6. Apply order**

```bash
microk8s kubectl apply -f pv-dev.yml
microk8s kubectl apply -f pv-staging.yml
microk8s kubectl apply -f secrets-dev.yml
microk8s kubectl apply -f secrets-staging.yml
microk8s kubectl apply -f postgres-dev.yml
microk8s kubectl apply -f postgres-staging.yml
```

**Result:** both `postgres-0` pods `Running`, `1/1`, PVs correctly bound (`postgres-pv-dev` ↔ `dev/postgres-pvc`, `postgres-pv-staging` ↔ `staging/postgres-pvc`).

---

### Phase 4 — Backend & Frontend Deployments

Both pull from public Docker Hub images, tags `latest-dev` / `latest-staging`, no imagePullSecret needed.

```yaml
# backend-dev.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: kailashbadu/shophive-backend:latest-dev
          ports:
            - containerPort: 8000
          env:
            - name: SECRET_KEY
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: SECRET_KEY }
            - name: DEBUG
              value: "True"
            - name: DB_NAME
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_NAME }
            - name: DB_USER
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_USER }
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef: { name: shophive-secrets, key: DB_PASSWORD }
            - name: DB_HOST
              value: postgres
            - name: DB_PORT
              value: "5432"
          volumeMounts:
            - name: static-volume
              mountPath: /app/staticfiles
            - name: media-volume
              mountPath: /app/media
          readinessProbe:
            tcpSocket: { port: 8000 }
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 300m, memory: 512Mi }
      volumes:
        - name: static-volume
          persistentVolumeClaim:
            claimName: static-pvc
        - name: media-volume
          persistentVolumeClaim:
            claimName: media-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: dev
spec:
  selector:
    app: backend
  ports:
    - port: 8000
      targetPort: 8000
```

`backend-staging.yml` — same shape, `namespace: staging`, `image: ...latest-staging`, `DEBUG: "False"`, resources `150m/384Mi` req, `400m/768Mi` limit.

```yaml
# frontend-dev.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: kailashbadu/shophive-frontend:latest-dev
          ports:
            - containerPort: 80
          env:
            - name: VITE_DJANGO_BASE_URL
              value: "/api"
          readinessProbe:
            tcpSocket: { port: 80 }
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { cpu: 200m, memory: 256Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: dev
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
```

`frontend-staging.yml` — same shape, `namespace: staging`, `image: ...latest-staging`.

```bash
microk8s kubectl apply -f backend-dev.yml
microk8s kubectl apply -f frontend-dev.yml
microk8s kubectl apply -f backend-staging.yml
microk8s kubectl apply -f frontend-staging.yml
```

---

### Phase 5 — Static/Media PVCs + Static-File Server + Ingress

Maps directly from the original Nginx reverse-proxy config used in Compose:

```
/api/    → backend:8000
/admin/  → backend:8000
/static/ → alias /app/staticfiles/
/media/  → alias /app/media/
/        → frontend:80
```

**Static/media PVCs (dynamic provisioning)**

```yaml
# static-media-dev.yml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: static-pvc
  namespace: dev
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: microk8s-hostpath
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: media-pvc
  namespace: dev
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: microk8s-hostpath
  resources:
    requests:
      storage: 1Gi
```

`static-media-staging.yml` — same shape, `namespace: staging`.

**Static file server**

```yaml
# static-server-dev.yml
apiVersion: v1
kind: ConfigMap
metadata:
  name: static-server-conf
  namespace: dev
data:
  default.conf: |
    server {
      listen 80;
      location /static/ {
        alias /app/staticfiles/;
      }
      location /media/ {
        alias /app/media/;
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: static-server
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: static-server
  template:
    metadata:
      labels:
        app: static-server
    spec:
      containers:
        - name: static-server
          image: nginx:alpine
          ports:
            - containerPort: 80
          volumeMounts:
            - name: static-volume
              mountPath: /app/staticfiles
              readOnly: true
            - name: media-volume
              mountPath: /app/media
              readOnly: true
            - name: nginx-conf
              mountPath: /etc/nginx/conf.d
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { cpu: 100m, memory: 128Mi }
      volumes:
        - name: static-volume
          persistentVolumeClaim:
            claimName: static-pvc
        - name: media-volume
          persistentVolumeClaim:
            claimName: media-pvc
        - name: nginx-conf
          configMap:
            name: static-server-conf
---
apiVersion: v1
kind: Service
metadata:
  name: static-server
  namespace: dev
spec:
  selector:
    app: static-server
  ports:
    - port: 80
      targetPort: 80
```

`static-server-staging.yml` — same shape, `namespace: staging`.

> **Note:** backend and static-server share `static-pvc`/`media-pvc` (`ReadWriteOnce`). This only works because both run on the same single node. Would break on a multi-node cluster.

**Ingress**

```yaml
# ingress-dev.yml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shophive-ingress
  namespace: dev
spec:
  ingressClassName: public
  rules:
    - host: dev.13.126.217.132.nip.io
      http:
        paths:
          - path: /api/
            pathType: Prefix
            backend:
              service: { name: backend, port: { number: 8000 } }
          - path: /admin/
            pathType: Prefix
            backend:
              service: { name: backend, port: { number: 8000 } }
          - path: /static/
            pathType: Prefix
            backend:
              service: { name: static-server, port: { number: 80 } }
          - path: /media/
            pathType: Prefix
            backend:
              service: { name: static-server, port: { number: 80 } }
          - path: /
            pathType: Prefix
            backend:
              service: { name: frontend, port: { number: 80 } }
```

`ingress-staging.yml` — same shape, `namespace: staging`, `host: staging.13.126.217.132.nip.io`.

**Apply order**

```bash
microk8s kubectl apply -f static-media-dev.yml
microk8s kubectl apply -f static-media-staging.yml
microk8s kubectl apply -f backend-dev.yml       # re-apply after adding volumeMounts
microk8s kubectl apply -f backend-staging.yml
microk8s kubectl apply -f static-server-dev.yml
microk8s kubectl apply -f static-server-staging.yml
microk8s kubectl apply -f ingress-dev.yml
microk8s kubectl apply -f ingress-staging.yml
```

**End-to-end verification**

```bash
curl -I http://dev.13.126.217.132.nip.io/
curl -I http://dev.13.126.217.132.nip.io/api/
curl -I http://staging.13.126.217.132.nip.io/
curl -I http://staging.13.126.217.132.nip.io/api/
```

**Result:** All 8 pods (postgres, backend, frontend, static-server × 2 namespaces) `Running`, `1/1`. Django admin login works through `dev.13.126.217.132.nip.io/admin/`.

---

## Errors Encountered & Fixes (Reference Log)

### 1. `volumemounts` — wrong casing / wrong nesting

**Symptom:** `kubectl apply` on `backend-dev.yml` rejected with:

```
strict decoding error: unknown field "spec.template.spec.containers[0].volumemounts"
```

**Cause:** Two mistakes — (a) field name must be `volumeMounts` (capital M), and (b) the top-level `volumes:` block must sit at the **pod spec** level (sibling of `containers:`), not nested inside a container.
**Fix:** Corrected casing to `volumeMounts`, moved `volumes:` to pod-spec level.

### 2. PVCs bound to the wrong PV

**Symptom:**

```
dev's PVC (postgres-pvc, 2Gi requested)     → Bound to postgres-pv-staging (3Gi)
staging's PVC (postgres-pvc, 3Gi requested) → Pending (only 2Gi PV left, too small)
```

**Cause:** Both manual PVs shared `storageClassName: manual` with no other link to a specific PVC. Kubernetes' binding controller matches any `Available` PV in the same class with capacity ≥ request — not by name — so whichever PVC applied first grabbed the larger PV.
**Fix:** Added `claimRef: { namespace, name }` to each PV, pinning it to its intended PVC and removing all ambiguity.

### 3. Postgres `CrashLoopBackOff` — missing password

**Symptom:**

```
Error: Database is uninitialized and superuser password is not specified.
You must specify POSTGRES_PASSWORD to a non-empty value for the superuser.
```

**Cause:** The Secret used app-style key names (`DB_PASSWORD`, `DB_USER`, `DB_NAME` — matching Django's `.env` convention) but the official `postgres:15-alpine` image expects `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` specifically. Using `envFrom: secretRef` dumped the Secret's keys as-is, so Postgres never saw the names it needed.
**Fix:** Switched from `envFrom` to explicit `env` entries, mapping each Postgres-required var name to the same underlying Secret key (kept `DB_NAME`/`DB_USER` too, since the readiness probe's `pg_isready` command references them).

### 4. Static file 404s — Django admin CSS/icons missing

**Symptom:** Admin login page loads but completely unstyled — broken icon boxes, no CSS. `curl -I .../static/admin/css/base.css` → `404`.
**Cause:** `collectstatic` had not (yet) run against the fresh `static-pvc` — turned out to be resolved automatically by the backend image's entrypoint once a clean pod rollout completed.
**Fix / diagnostic path:** Checked `ls /app/staticfiles` inside the pod, ran `python manage.py collectstatic --noinput` manually as a fallback, confirmed via `curl` retest.

### 5. Rolling update stuck — ResourceQuota rejection

**Symptom:** `kubectl rollout status deployment/backend -n dev` →

```
error: deployment "backend" exceeded its progress deadline
```

Deployment `Conditions:` showed `ReplicaFailure: True, Reason: FailedCreate`. New ReplicaSet stuck at `0/1`, old pod (92 minutes old) never replaced.
**Root cause (from RS events):**

```
Error creating: pods "backend-f68885966-wnfw8" is forbidden: exceeded quota: dev-quota,
requested: limits.cpu=300m, used: limits.cpu=900m, limited: limits.cpu=1
```

A standard `RollingUpdate` briefly runs old + new pods together (default `maxSurge`), and `dev-quota`'s original `limits.cpu: "1"` (1000m) was too tight to allow that overlap once backend + frontend + static-server were all running.
**Fix:** Bumped `dev-quota` to `requests.cpu: 800m / requests.memory: 1.5Gi / limits.cpu: 1500m / limits.memory: 3Gi`, re-applied, then `kubectl rollout restart deployment/backend -n dev` completed successfully. Also cleaned up stale ReplicaSets left over from the stuck attempts (`kubectl delete rs ...`).

### 6. `relation "store_product" does not exist`

**Symptom:** Backend logs showed a Django `ProgrammingError` when loading `/api/products/`; frontend showed `401`/`500` errors and a `SyntaxError: Unexpected token '<'` (frontend trying to `JSON.parse()` an HTML error page).
**Cause:** The in-cluster Postgres was a fresh, unmigrated database — this was actually the _old_ pre-fix backend pod, which likely started before Postgres was ready or before a clean migration could run.
**Fix:** Not directly needed — the backend image runs `migrate` automatically as part of its container entrypoint. After the pod was cleanly rolled out (post quota-fix), `python manage.py showmigrations` confirmed all migrations `[X]` applied. Confirmed as resolved after retesting registration/product listing in the browser.

---

## Open Items / Next Steps

- Update `dev.yml` / `staging.yml` GitHub Actions pipelines to replace the `appleboy/ssh-action` Docker Compose deploy step with `helm upgrade --install` (or `kubectl apply`) invoked over SSM instead of SSH — keeps the "no SSH key" posture consistent with this cluster.
- Consider Helm charts (`values-dev.yaml` / `values-staging.yaml`) to reduce manifest duplication across environments.
- Confirm ingress-nginx behavior under real traffic load (single node — no HA).
- Static/media PVCs use `ReadWriteOnce` + dynamic provisioning; fine on one node, would need reworking (e.g. ReadWriteMany via NFS/EFS, or object storage) if ever scaled beyond a single node.
