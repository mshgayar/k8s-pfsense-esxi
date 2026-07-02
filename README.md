# Kubernetes HA Lab Cluster on VMware ESXi

Full installation guide — from ESXi virtual switches and pfSense, through DNS, NFS, HAProxy, to a fully operational Kubernetes v1.30.14 HA cluster.

---

## Architecture

```
Internet
    |
[Home Router] — 192.168.1.1
    |
    |  Home LAN (192.168.1.0/24)  —  vSwitch0 (vmnic0)
    |
[MacBook] 192.168.1.x
    |  static route: 172.25.25.0/24 via 192.168.1.20
    |
[pfSense 2.8.1]
  WAN: 192.168.1.20  (vSwitch0)
  LAN: 172.25.25.1   (vSwitch1 — k8s-net-lab)
    |
    |  K8s Network (172.25.25.0/24)  —  vSwitch1 (vmnic1)
    |
    ├── [infra]    172.25.25.254   RHEL 9   BIND9 DNS + NFS Server
    ├── [lb-k8s]   172.25.25.10    RHEL 9   HAProxy Load Balancer
    ├── [manager]  172.25.25.5     RHEL 9   Ansible + kubectl
    │
    ├── [master1]  172.25.25.11    Ubuntu 22.04   K8s Control Plane + etcd
    ├── [master2]  172.25.25.12    Ubuntu 22.04   K8s Control Plane + etcd
    ├── [master3]  172.25.25.13    Ubuntu 22.04   K8s Control Plane + etcd
    │
    ├── [worker1]  172.25.25.21    Ubuntu 22.04   K8s Worker
    ├── [worker2]  172.25.25.22    Ubuntu 22.04   K8s Worker
    └── [worker3]  172.25.25.23    Ubuntu 22.04   K8s Worker

MetalLB IP Pool: 172.25.25.100 – 172.25.25.150
Kubernetes Dashboard: https://172.25.25.100
HAProxy API VIP: 172.25.25.10:6443
```

![Network Diagram](k8s-lab-network-diagram.png)

---

## Node Inventory

| Hostname | IP | OS | Role | vCPU | RAM |
|---|---|---|---|---|---|
| pfsense | WAN: 192.168.1.20 / LAN: 172.25.25.1 | pfSense 2.8.1 | Gateway / Firewall / NAT | 2 | 2 GB |
| infra.mo.lab.local | 172.25.25.254 | RHEL 9 | BIND9 DNS + NFS Server | 2 | 4 GB |
| lb-k8s.mo.lab.local | 172.25.25.10 | RHEL 9 | HAProxy Load Balancer | 2 | 2 GB |
| manager.mo.lab.local | 172.25.25.5 | RHEL 9 | Ansible + kubectl | 2 | 4 GB |
| master1.mo.lab.local | 172.25.25.11 | Ubuntu 22.04 | K8s Control Plane + etcd | 2 | 4 GB |
| master2.mo.lab.local | 172.25.25.12 | Ubuntu 22.04 | K8s Control Plane + etcd | 2 | 4 GB |
| master3.mo.lab.local | 172.25.25.13 | Ubuntu 22.04 | K8s Control Plane + etcd | 2 | 4 GB |
| worker1.mo.lab.local | 172.25.25.21 | Ubuntu 22.04 | K8s Worker | 2 | 4 GB |
| worker2.mo.lab.local | 172.25.25.22 | Ubuntu 22.04 | K8s Worker | 2 | 4 GB |
| worker3.mo.lab.local | 172.25.25.23 | Ubuntu 22.04 | K8s Worker | 2 | 4 GB |

---

## Step 1 — ESXi Virtual Switch Setup

### 1.1 — vSwitch0 (Home LAN — existing)

vSwitch0 is the default ESXi switch connected to your home LAN. No changes needed.

- **Physical NIC:** vmnic0
- **Network:** 192.168.1.0/24
- **Used by:** ESXi management + pfSense WAN interface

### 1.2 — Create vSwitch1 (Kubernetes Network)

1. Log in to ESXi web UI → **Networking** → **Virtual Switches**
2. Click **Add standard virtual switch**
3. Set:
   - **Name:** `k8s-net-lab`
   - **Uplink:** `vmnic1` (second NIC)
   - MTU: 1500
4. Click **Add**

### 1.3 — Create Port Group on vSwitch1

1. **Networking** → **Port groups** → **Add port group**
2. Set:
   - **Name:** `k8s-net-lab`
   - **VLAN ID:** 0
   - **Virtual switch:** `k8s-net-lab`
3. Click **Add**

### 1.4 — Assign Network to VMs

When creating each VM, set the network adapter to **k8s-net-lab** port group.

> **pfSense** needs TWO network adapters: one on `VM Network` (vSwitch0) for WAN, one on `k8s-net-lab` (vSwitch1) for LAN.

---

## Step 2 — pfSense Installation

### 2.1 — Download pfSense

Download the AMD64 ISO from: https://www.pfsense.org/download/

- **Version:** 2.8.1
- **Architecture:** AMD64 (64-bit)
- **Installer:** DVD Image (ISO)
- **Mirror:** choose closest

Upload the ISO to ESXi datastore: **Storage** → **Datastores** → **Datastore browser** → **Upload**

### 2.2 — Create pfSense VM in ESXi

1. **Virtual Machines** → **Create / Register VM**
2. Settings:
   - **Name:** `pfsense`
   - **OS family:** Other
   - **OS version:** FreeBSD 14 or later (64-bit)
   - **CPU:** 2
   - **RAM:** 2 GB
   - **Disk:** 20 GB
3. **Network adapters — add TWO:**
   - Adapter 1: `VM Network` (WAN — vSwitch0)
   - Adapter 2: `k8s-net-lab` (LAN — vSwitch1)
4. **CD/DVD:** mount the pfSense ISO
5. Power on and boot from ISO

### 2.3 — pfSense Installation (FreeBSD installer)

1. Accept copyright → **Install pfSense**
2. **Keymap:** default (US)
3. **Partitioning:** Auto (UFS) → select disk → Entire disk → MBR → Finish → Commit
4. Wait for install to complete → **Reboot**
5. Remove ISO after reboot

### 2.4 — Assign WAN and LAN Interfaces

On first boot pfSense asks to assign interfaces:

```
Should VLANs be set up now? → n
Enter the WAN interface name: em0        (first NIC — vSwitch0)
Enter the LAN interface name: em1        (second NIC — vSwitch1)
Do you want to proceed? → y
```

### 2.5 — Set LAN IP Address

From the pfSense console menu:

```
2) Set interface(s) IP address
→ 2 (LAN)
→ Enter new LAN IPv4 address: 172.25.25.1
→ Enter new LAN IPv4 subnet bit count: 24
→ Enter LAN IPv4 upstream gateway: (blank — press Enter)
→ Do you want to enable DHCP on LAN? → n
→ Do you want to revert to HTTP? → n
```

### 2.6 — Configure pfSense via Web UI

Access pfSense at: **https://192.168.1.20** (from home LAN)  
Default credentials: `admin` / `pfsense`

Run the setup wizard:
- **Hostname:** pfsense
- **Domain:** mo.lab.local
- **DNS:** 172.25.25.254 (your BIND9 server — set after infra VM is up)
- **WAN:** DHCP (gets IP from home router)
- **LAN:** 172.25.25.1 / 24
- Change admin password

### 2.7 — Enable NAT and Firewall Rules

**NAT — Firewall → NAT → Outbound:**
1. Select **Automatic outbound NAT**
2. Click **Save**

**LAN firewall rule — Firewall → Rules → LAN:**
1. Click **Add**
2. Set:
   - **Action:** Pass
   - **Protocol:** Any
   - **Source:** LAN net
   - **Destination:** Any
3. Click **Save** → **Apply Changes**

**WAN firewall rule — allow return traffic (usually automatic with NAT)**

### 2.8 — Static Route on Mac (to reach K8s network)

```bash
# Add static route (temporary — lost on reboot)
sudo route add -net 172.25.25.0/24 192.168.1.20

# To make permanent — add to /etc/pf.conf or use Mac network settings
```

---

## Step 3 — Clone Config Repo and Deploy to Servers

All configuration files are in this repo. Clone it on the manager VM and copy files to each server.

### 3.1 — Clone on Manager VM

```bash
ssh msalah@172.25.25.5
sudo -i
dnf install -y git
git clone https://github.com/mshgayar/k8s-pfsense-esxi.git /root/ansible-k8s
cd /root/ansible-k8s
```

### 3.2 — Copy DNS Config to infra VM (172.25.25.254)

```bash
# Copy named config files
scp named.conf root@172.25.25.254:/etc/named.conf
scp named.conf.local root@172.25.25.254:/etc/named/named.conf.local
scp zones/db.mo.lab.local root@172.25.25.254:/etc/named/zones/db.mo.lab.local
scp zones/db.172.25.25.rev root@172.25.25.254:/etc/named/zones/db.172.25.25.rev

# Reload BIND9 on infra
ssh root@172.25.25.254 "systemctl reload named"

# Verify
dig @172.25.25.254 master1-k8s.mo.lab.local
```

### 3.3 — Copy HAProxy Config to lb-k8s VM (172.25.25.10)

```bash
# Copy haproxy config
scp etc/haproxy/haproxy.cfg root@172.25.25.10:/etc/haproxy/haproxy.cfg

# Remove forwardfor (incompatible with TCP mode)
ssh root@172.25.25.10 "sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg"

# Validate and reload
ssh root@172.25.25.10 "haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy"
```

### 3.4 — Copy Ansible Inventory to Manager

```bash
mkdir -p /etc/ansible
cp /root/ansible-k8s/hosts /etc/ansible/hosts
```

---

## Step 4 — BIND9 DNS Setup (infra — 172.25.25.254)

```bash
ssh root@172.25.25.254

dnf install -y bind bind-utils

# Config files already copied from repo in Step 3.2
# Just enable and start

mkdir -p /etc/named/zones
chown -R named:named /etc/named

systemctl enable --now named

# Test
dig @172.25.25.254 master1-k8s.mo.lab.local
dig @172.25.25.254 -x 172.25.25.11
```

---

## Step 5 — NFS Server Setup (infra — 172.25.25.254)

```bash
ssh root@172.25.25.254

dnf install -y nfs-utils

mkdir -p /home/nfs/k8s
chmod 777 /home/nfs/k8s
chown -R nobody:nobody /home/nfs/k8s

echo "/home/nfs/k8s 172.25.25.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports

systemctl enable --now nfs-server
exportfs -rav

firewall-cmd --add-service=nfs --permanent
firewall-cmd --add-service=nfs3 --permanent
firewall-cmd --reload

# Verify
showmount -e 172.25.25.254
```

---

## Step 6 — HAProxy Setup (lb-k8s — 172.25.25.10)

```bash
ssh root@172.25.25.10

dnf install -y haproxy

# Config already copied from repo in Step 3.3
# Just enable and open ports

systemctl enable --now haproxy

firewall-cmd --permanent --add-port=6443/tcp
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --permanent --add-port=9000/tcp
firewall-cmd --reload
```

HAProxy stats: http://172.25.25.10:9000

---

## Step 7 — Manager VM Setup (172.25.25.5)

```bash
ssh msalah@172.25.25.5
sudo -i

dnf install -y ansible-core git

# Generate SSH key
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""

# Copy key to all nodes
ssh-copy-id msalah@172.25.25.11
ssh-copy-id msalah@172.25.25.12
ssh-copy-id msalah@172.25.25.13
ssh-copy-id worker1-k8s@172.25.25.21
ssh-copy-id worker2-k8s@172.25.25.22
ssh-copy-id worker3-k8s@172.25.25.23

# Configure passwordless sudo — masters
for ip in 172.25.25.11 172.25.25.12 172.25.25.13; do
  ssh msalah@$ip "echo 'msalah ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/msalah"
done

# Configure passwordless sudo — workers
ssh worker1-k8s@172.25.25.21 "echo 'worker1-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker1-k8s"
ssh worker2-k8s@172.25.25.22 "echo 'worker2-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker2-k8s"
ssh worker3-k8s@172.25.25.23 "echo 'worker3-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker3-k8s"

# Set Ansible inventory (already copied from repo)
mkdir -p /etc/ansible
cp /root/ansible-k8s/hosts /etc/ansible/hosts

# Test connectivity
ansible all -m ping
```

---

## Step 8 — Prepare All K8s Nodes via Ansible

```bash
cd /root/ansible-k8s
ansible-playbook prepare-k8s-nodes.yml
```

This playbook runs on all 6 nodes and:
- Updates all packages
- Disables swap
- Loads kernel modules (overlay, br_netfilter)
- Configures sysctl for Kubernetes networking
- Installs containerd with SystemdCgroup=true
- Disables UFW
- Installs kubeadm, kubelet, kubectl v1.30 (held from upgrades)

---

## Step 9 — Initialize Kubernetes Cluster (master1)

```bash
ssh msalah@172.25.25.11

sudo kubeadm init \
  --control-plane-endpoint "172.25.25.10:6443" \
  --upload-certs \
  --pod-network-cidr=10.244.0.0/16

# Configure kubectl on master1
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

Copy kubeconfig to manager:

```bash
# On manager VM
mkdir -p ~/.kube
scp msalah@172.25.25.11:/home/msalah/.kube/config ~/.kube/config
```

---

## Step 10 — Join master2 and master3

On master1 — generate fresh credentials (cert key valid 2 hours):

```bash
sudo kubeadm init phase upload-certs --upload-certs
sudo kubeadm token create --print-join-command
```

On each master (master2 and master3) — clean reset then join:

```bash
sudo kubeadm reset -f
sudo rm -rf /etc/kubernetes/manifests /etc/kubernetes/pki
sudo rm -rf /etc/kubernetes/*.conf /var/lib/etcd /var/lib/kubelet
sudo systemctl restart containerd

# Run the join command with --control-plane --certificate-key
sudo kubeadm join 172.25.25.10:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --control-plane --certificate-key <cert-key>
```

> **If join fails with "etcd cluster not healthy"** — remove stale etcd member on master1:
> ```bash
> ETCDCTL_API=3 etcdctl \
>   --endpoints=https://127.0.0.1:2379 \
>   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
>   --cert=/etc/kubernetes/pki/etcd/server.crt \
>   --key=/etc/kubernetes/pki/etcd/server.key \
>   member list
>
> etcdctl member remove <STALE_ID>
> ```
> Then reset and retry the join.

---

## Step 11 — Join Worker Nodes

```bash
# On each worker node
sudo kubeadm join 172.25.25.10:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

---

## Step 12 — Install Calico CNI (from manager)

> Flannel was not used — it requires /opt/bin which does not exist on Ubuntu 22.04.

```bash
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

# Wait for all nodes to become Ready
kubectl get nodes -w
```

Expected output:

```
NAME                   STATUS   ROLES           AGE   VERSION
master1.mo.lab.local   Ready    control-plane   5m    v1.30.14
master2.mo.lab.local   Ready    control-plane   3m    v1.30.14
master3.mo.lab.local   Ready    control-plane   2m    v1.30.14
worker1.mo.lab.local   Ready    <none>          1m    v1.30.14
worker2.mo.lab.local   Ready    <none>          1m    v1.30.14
worker3.mo.lab.local   Ready    <none>          1m    v1.30.14
```

---

## Step 13 — Install MetalLB (from manager)

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.5/config/manifests/metallb-native.yaml

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=90s

# Apply IP pool from repo
cd /root/ansible-k8s
kubectl apply -f metallb-config.yaml

# Verify
kubectl get IPAddressPool -n metallb-system
kubectl get L2Advertisement -n metallb-system
```

---

## Step 14 — Install Kubernetes Dashboard (from manager)

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml

# Change service type from ClusterIP to LoadBalancer
kubectl edit svc kubernetes-dashboard -n kubernetes-dashboard
# Change: type: ClusterIP  →  type: LoadBalancer

# Verify MetalLB assigned 172.25.25.100
kubectl get svc -n kubernetes-dashboard

# Create admin service account
kubectl create serviceaccount admin-user -n kubernetes-dashboard
kubectl create clusterrolebinding admin-user \
  --clusterrole=cluster-admin \
  --serviceaccount=kubernetes-dashboard:admin-user

# Generate login token
kubectl -n kubernetes-dashboard create token admin-user
```

Access at: **https://172.25.25.100**

---

## Step 15 — Install Metrics Server (for Dashboard graphs)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for self-signed certs (required in lab)
kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# Verify
kubectl top nodes
kubectl top pods -A
```

---

## Step 16 — Install NFS Dynamic Provisioner (from manager)

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

helm repo add nfs-subdir-external-provisioner \
  https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
helm repo update

helm install nfs-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --namespace nfs-provisioner --create-namespace \
  --set nfs.server=172.25.25.254 \
  --set nfs.path=/home/nfs/k8s \
  --set storageClass.name=nfs-storage \
  --set storageClass.defaultClass=true

# Install nfs-common on all worker nodes
ansible workers -m apt -a "name=nfs-common state=present update_cache=yes" --become

# Restart provisioner after nfs-common is installed
kubectl rollout restart deployment -n nfs-provisioner nfs-provisioner-nfs-subdir-external-provisioner

# Test dynamic provisioning
cd /root/ansible-k8s
kubectl apply -f test-pvc.yaml
kubectl apply -f test-pod-dynamic-storage.yaml
kubectl get pvc
```

---

## Access Endpoints

| Service | URL |
|---|---|
| Kubernetes Dashboard | https://172.25.25.100 |
| HAProxy Stats | http://172.25.25.10:9000 |
| Kubernetes API | https://172.25.25.10:6443 |
| pfSense Web UI | https://192.168.1.20 |

---

## Component Versions

| Component | Version |
|---|---|
| pfSense | 2.8.1 |
| HAProxy | 2.8.14 |
| BIND9 | RHEL 9 default |
| Kubernetes | v1.30.14 |
| containerd | v2.2.5 |
| Calico CNI | v3.27.0 |
| MetalLB | v0.14.5 |
| Kubernetes Dashboard | v2.7.0 |
| NFS Subdir Provisioner | latest (Helm) |
| Metrics Server | latest |

---

## Files in This Repo

| File | Destination | Host |
|---|---|---|
| `hosts` | `/etc/ansible/hosts` | manager |
| `named.conf` | `/etc/named.conf` | infra |
| `named.conf.local` | `/etc/named/named.conf.local` | infra |
| `zones/db.mo.lab.local` | `/etc/named/zones/db.mo.lab.local` | infra |
| `zones/db.172.25.25.rev` | `/etc/named/zones/db.172.25.25.rev` | infra |
| `etc/haproxy/haproxy.cfg` | `/etc/haproxy/haproxy.cfg` | lb-k8s |
| `prepare-k8s-nodes.yml` | run with ansible-playbook | manager |
| `packages-installation.yml` | run with ansible-playbook | manager |
| `metallb-config.yaml` | kubectl apply | manager |
| `test-pvc.yaml` | kubectl apply | manager |
| `test-pod-dynamic-storage.yaml` | kubectl apply | manager |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| etcd cluster not healthy on join | `etcdctl member remove <ID>` on master1 before retrying |
| NumCPU preflight error on join | Increase VM to ≥2 vCPU in ESXi → Edit Settings → CPU |
| Flannel CrashLoopBackOff | Use Calico — Flannel needs /opt/bin which Ubuntu 22.04 does not have |
| NFS mount bad option on workers | `ansible workers -m apt -a "name=nfs-common state=present" --become` |
| Certificate key expired on join | `kubeadm init phase upload-certs --upload-certs` on master1 |
| HAProxy forwardfor warning | `sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg` |
| BIND9 REFUSED from external host | Set `dnssec-validation no` in named.conf |
| MetalLB controller CrashLoopBackOff | `kubectl delete pod -n metallb-system <pod>` to force recreate |
| Dashboard no graphs | Install Metrics Server (Step 15) |
| pfSense routing loop | Disable wrong default gateway under System → Routing → Gateways |

