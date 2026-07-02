# Kubernetes HA Lab Cluster on VMware ESXi

Full installation guide — from ESXi virtual switches and pfSense, through DNS, NFS, HAProxy, to a fully operational Kubernetes v1.30.14 HA cluster.

---

## Architecture

```
Internet
    |
[Home Router] 192.168.1.1
    |
    |  Home LAN (192.168.1.0/24) — vSwitch0 (vmnic0)
    |
[MacBook] 192.168.1.x
    | static route: 172.25.25.0/24 via 192.168.1.20
    |
[pfSense 2.8.1]
  WAN: 192.168.1.20  (vSwitch0)
  LAN: 172.25.25.1   (vSwitch1 — k8s-net-lab)
    |
    |  K8s Network (172.25.25.0/24) — vSwitch1 (vmnic1)
    |
    ├── [infra]    172.25.25.254   RHEL 9        BIND9 DNS + NFS Server
    ├── [lb-k8s]   172.25.25.10    RHEL 9        HAProxy Load Balancer
    ├── [manager]  172.25.25.5     RHEL 9        Ansible + kubectl
    ├── [master1]  172.25.25.11    Ubuntu 22.04  K8s Control Plane + etcd
    ├── [master2]  172.25.25.12    Ubuntu 22.04  K8s Control Plane + etcd
    ├── [master3]  172.25.25.13    Ubuntu 22.04  K8s Control Plane + etcd
    ├── [worker1]  172.25.25.21    Ubuntu 22.04  K8s Worker
    ├── [worker2]  172.25.25.22    Ubuntu 22.04  K8s Worker
    └── [worker3]  172.25.25.23    Ubuntu 22.04  K8s Worker

MetalLB IP Pool:       172.25.25.100 – 172.25.25.150
Kubernetes Dashboard:  https://172.25.25.100
Kubernetes API VIP:    https://172.25.25.10:6443
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

### 1.1 — vSwitch0 (Home LAN — already exists)

Default ESXi switch — no changes needed.
- **Physical NIC:** vmnic0
- **Network:** 192.168.1.0/24
- **Used by:** ESXi management + pfSense WAN

### 1.2 — Create vSwitch1 (Kubernetes Network)

1. ESXi web UI → **Networking** → **Virtual Switches** → **Add standard virtual switch**
2. Set:
   - **Name:** `k8s-net-lab`
   - **Uplink:** `vmnic1`
   - **MTU:** 1500
3. Click **Add**

### 1.3 — Create Port Group on vSwitch1

1. **Networking** → **Port groups** → **Add port group**
2. Set:
   - **Name:** `k8s-net-lab`
   - **VLAN ID:** 0
   - **Virtual switch:** `k8s-net-lab`
3. Click **Add**

> When creating VMs, assign all K8s VMs to the **k8s-net-lab** port group.
> pfSense needs **two** adapters: one on `VM Network` (WAN) and one on `k8s-net-lab` (LAN).

---

## Step 2 — pfSense Installation

### 2.1 — Download pfSense ISO

Download from: https://www.pfsense.org/download/
- **Version:** 2.8.1
- **Architecture:** AMD64
- **Type:** DVD Image (ISO)

Upload ISO to ESXi: **Storage** → **Datastore browser** → **Upload**

### 2.2 — Create pfSense VM in ESXi

1. **Virtual Machines** → **Create / Register VM**
2. Settings:
   - **Name:** `pfsense`
   - **OS family:** Other — FreeBSD 14 or later (64-bit)
   - **CPU:** 2 | **RAM:** 2 GB | **Disk:** 20 GB
3. Add **two network adapters:**
   - Adapter 1: `VM Network` (WAN)
   - Adapter 2: `k8s-net-lab` (LAN)
4. Mount pfSense ISO on CD/DVD drive
5. Power on

### 2.3 — pfSense Installer (FreeBSD)

1. Accept copyright → **Install pfSense**
2. Keymap: default → **Continue with default keymap**
3. Partitioning: **Auto (UFS)** → select disk → **Entire disk** → **MBR** → **Finish** → **Commit**
4. Wait for install → **Reboot** → remove ISO

### 2.4 — Assign Interfaces on First Boot

```
Should VLANs be set up now? → n
Enter the WAN interface name: em0       (first NIC — vSwitch0)
Enter the LAN interface name: em1       (second NIC — vSwitch1)
Do you want to proceed? → y
```

### 2.5 — Set LAN IP from Console

```
2) Set interface(s) IP address
→ Select 2 (LAN)
→ IPv4 address: 172.25.25.1
→ Subnet bit count: 24
→ Upstream gateway: (blank)
→ Enable DHCP on LAN: n
→ Revert to HTTP: n
```

### 2.6 — Configure via Web UI

Access: **https://192.168.1.20** (default: `admin` / `pfsense`)

- **System → General:** hostname `pfsense`, domain `mo.lab.local`, DNS `172.25.25.254`
- **Firewall → NAT → Outbound:** set to **Automatic**
- **Firewall → Rules → LAN:** add rule — Action: Pass, Protocol: Any, Source: LAN net, Destination: Any

### 2.7 — Static Route on Mac

```bash
sudo route add -net 172.25.25.0/24 192.168.1.20
```

---

## Step 3 — Clone Config Repo on Manager VM

All configuration files are in this repo. Clone it once and use it for all deployments.

```bash
ssh msalah@172.25.25.5
sudo -i
dnf install -y git
git clone https://github.com/mshgayar/k8s-pfsense-esxi.git /root/ansible-k8s
cd /root/ansible-k8s
```

---

## Step 4 — BIND9 DNS Server (infra — 172.25.25.254)

### 4.1 — Install BIND9

```bash
ssh root@172.25.25.254
dnf install -y bind bind-utils
mkdir -p /etc/named/zones
```

### 4.2 — Copy Configuration Files from Repo

```bash
# Run from manager VM
scp /root/ansible-k8s/named.conf          root@172.25.25.254:/etc/named.conf
scp /root/ansible-k8s/named.conf.local    root@172.25.25.254:/etc/named/named.conf.local
scp /root/ansible-k8s/zones/db.mo.lab.local      root@172.25.25.254:/etc/named/zones/
scp /root/ansible-k8s/zones/db.172.25.25.rev     root@172.25.25.254:/etc/named/zones/
```

### 4.3 — Start and Verify

```bash
ssh root@172.25.25.254 "chown -R named:named /etc/named && systemctl enable --now named"

# Test DNS resolution
dig @172.25.25.254 master1-k8s.mo.lab.local
dig @172.25.25.254 -x 172.25.25.11
```

---

## Step 5 — NFS Server (infra — 172.25.25.254)

### 5.1 — Install NFS

```bash
ssh root@172.25.25.254
dnf install -y nfs-utils
```

### 5.2 — Create Export Directory and Configure

```bash
mkdir -p /home/nfs/k8s
chmod 777 /home/nfs/k8s
chown -R nobody:nobody /home/nfs/k8s

echo "/home/nfs/k8s 172.25.25.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports
```

### 5.3 — Start and Open Firewall

```bash
systemctl enable --now nfs-server
exportfs -rav

firewall-cmd --add-service=nfs --permanent
firewall-cmd --add-service=nfs3 --permanent
firewall-cmd --reload
```

### 5.4 — Verify

```bash
showmount -e 172.25.25.254
# Expected: /home/nfs/k8s 172.25.25.0/24
```

---

## Step 6 — HAProxy Load Balancer (lb-k8s — 172.25.25.10)

### 6.1 — Install HAProxy

```bash
ssh root@172.25.25.10
dnf install -y haproxy
```

### 6.2 — Copy Configuration File from Repo

```bash
# Run from manager VM
scp /root/ansible-k8s/etc/haproxy/haproxy.cfg root@172.25.25.10:/etc/haproxy/haproxy.cfg

# Remove forwardfor option (incompatible with TCP mode)
ssh root@172.25.25.10 "sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg"
```

### 6.3 — Validate, Start and Open Firewall

```bash
ssh root@172.25.25.10 "haproxy -c -f /etc/haproxy/haproxy.cfg"
ssh root@172.25.25.10 "systemctl enable --now haproxy"
ssh root@172.25.25.10 "
  firewall-cmd --permanent --add-port=6443/tcp &&
  firewall-cmd --permanent --add-port=80/tcp &&
  firewall-cmd --permanent --add-port=443/tcp &&
  firewall-cmd --permanent --add-port=9000/tcp &&
  firewall-cmd --reload"
```

### 6.4 — Verify

HAProxy stats: http://172.25.25.10:9000

| Port | Purpose | Backends |
|---|---|---|
| 6443 | Kubernetes API | master1/2/3 :6443 |
| 80 | HTTP Ingress | worker1/2/3 :80 |
| 443 | HTTPS Ingress | worker1/2/3 :443 |
| 9000 | HAProxy Stats | — |

---

## Step 7 — Manager VM — Ansible Setup (172.25.25.5)

### 7.1 — Install Ansible and Generate SSH Key

```bash
ssh msalah@172.25.25.5
sudo -i
dnf install -y ansible-core
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
```

### 7.2 — Copy SSH Key to All Nodes

```bash
ssh-copy-id msalah@172.25.25.11
ssh-copy-id msalah@172.25.25.12
ssh-copy-id msalah@172.25.25.13
ssh-copy-id worker1-k8s@172.25.25.21
ssh-copy-id worker2-k8s@172.25.25.22
ssh-copy-id worker3-k8s@172.25.25.23
```

### 7.3 — Configure Passwordless sudo

```bash
# Masters
for ip in 172.25.25.11 172.25.25.12 172.25.25.13; do
  ssh msalah@$ip "echo 'msalah ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/msalah"
done

# Workers
ssh worker1-k8s@172.25.25.21 "echo 'worker1-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker1-k8s"
ssh worker2-k8s@172.25.25.22 "echo 'worker2-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker2-k8s"
ssh worker3-k8s@172.25.25.23 "echo 'worker3-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker3-k8s"
```

### 7.4 — Copy Ansible Inventory from Repo

```bash
mkdir -p /etc/ansible
cp /root/ansible-k8s/hosts /etc/ansible/hosts

# Test connectivity to all nodes
ansible all -m ping
```

---

## Step 8 — Prepare All K8s Nodes via Ansible

A single combined playbook handles everything: base packages, swap, kernel modules, containerd, and Kubernetes components.

```bash
cd /root/ansible-k8s
ansible-playbook prepare-k8s-nodes.yml
```

**What the playbook does (in order):**

| Task | Details |
|---|---|
| Update packages | apt update + upgrade |
| Install base packages | git, curl, vim, htop, net-tools, bash-completion, etc. |
| Disable swap | swapoff -a + remove from fstab |
| Kernel modules | overlay + br_netfilter |
| sysctl | ip_forward + bridge-nf-call-iptables |
| Install containerd | from Docker repo, SystemdCgroup=true |
| Disable UFW | firewall off on all K8s nodes |
| Install Kubernetes | kubeadm + kubelet + kubectl v1.30 (held) |
| Enable kubelet | systemctl enable kubelet |

---

## Step 9 — Initialize Kubernetes Cluster (master1)

```bash
ssh msalah@172.25.25.11

sudo kubeadm init \
  --control-plane-endpoint "172.25.25.10:6443" \
  --upload-certs \
  --pod-network-cidr=10.244.0.0/16

# Configure kubectl
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

On **master1** — generate fresh credentials (cert key valid 2 hours):

```bash
sudo kubeadm init phase upload-certs --upload-certs
sudo kubeadm token create --print-join-command
```

On **master2** and **master3** — clean reset then join:

```bash
sudo kubeadm reset -f
sudo rm -rf /etc/kubernetes/manifests /etc/kubernetes/pki
sudo rm -rf /etc/kubernetes/*.conf /var/lib/etcd /var/lib/kubelet
sudo systemctl restart containerd

# Run the join command output from master1 with --control-plane --certificate-key appended
sudo kubeadm join 172.25.25.10:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --control-plane --certificate-key <cert-key>
```

> **If join fails — "etcd cluster not healthy":** remove stale member on master1 first:
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
> Then reset and retry.

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

# Wait for all nodes Ready
kubectl get nodes -w
```

---

## Step 13 — Install MetalLB (from manager)

### 13.1 — Install

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.5/config/manifests/metallb-native.yaml

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=90s
```

### 13.2 — Apply IP Pool from Repo

```bash
kubectl apply -f /root/ansible-k8s/metallb-config.yaml

# Verify
kubectl get IPAddressPool -n metallb-system
```

---

## Step 14 — Install Kubernetes Dashboard (from manager)

### 14.1 — Install

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml
```

### 14.2 — Expose via MetalLB

```bash
# Change service type to LoadBalancer
kubectl edit svc kubernetes-dashboard -n kubernetes-dashboard
# Change:  type: ClusterIP  →  type: LoadBalancer

# Verify IP assigned (should be 172.25.25.100)
kubectl get svc -n kubernetes-dashboard
```

### 14.3 — Create Admin Account and Token

```bash
kubectl create serviceaccount admin-user -n kubernetes-dashboard
kubectl create clusterrolebinding admin-user \
  --clusterrole=cluster-admin \
  --serviceaccount=kubernetes-dashboard:admin-user

# Generate login token
kubectl -n kubernetes-dashboard create token admin-user
```

Access at: **https://172.25.25.100**

---

## Step 15 — Install Metrics Server (Dashboard graphs)

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for self-signed certs (required in lab)
kubectl patch deployment metrics-server -n kube-system \
  --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# Verify
kubectl top nodes
```

---

## Step 16 — Install NFS Dynamic Provisioner (from manager)

### 16.1 — Install Helm and Provisioner

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
```

### 16.2 — Fix nfs-common on Worker Nodes

```bash
ansible workers -m apt -a "name=nfs-common state=present update_cache=yes" --become

kubectl rollout restart deployment -n nfs-provisioner nfs-provisioner-nfs-subdir-external-provisioner
```

### 16.3 — Test Dynamic Provisioning

```bash
kubectl apply -f /root/ansible-k8s/test-pvc.yaml
kubectl apply -f /root/ansible-k8s/test-pod-dynamic-storage.yaml
kubectl get pvc
# Expected: STATUS = Bound
```

---

## Files in This Repo

| File | Destination | Host |
|---|---|---|
| `hosts` | `/etc/ansible/hosts` | manager |
| `named.conf` | `/etc/named.conf` | infra |
| `named.conf.local` | `/etc/named/named.conf.local` | infra |
| `zones/db.mo.lab.local` | `/etc/named/zones/` | infra |
| `zones/db.172.25.25.rev` | `/etc/named/zones/` | infra |
| `etc/haproxy/haproxy.cfg` | `/etc/haproxy/haproxy.cfg` | lb-k8s |
| `prepare-k8s-nodes.yml` | `ansible-playbook prepare-k8s-nodes.yml` | manager |
| `metallb-config.yaml` | `kubectl apply -f` | manager |
| `test-pvc.yaml` | `kubectl apply -f` | manager |
| `test-pod-dynamic-storage.yaml` | `kubectl apply -f` | manager |

> `packages-installtion.yml` has been merged into `prepare-k8s-nodes.yml` — only one playbook needed.

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

## Troubleshooting

| Issue | Fix |
|---|---|
| etcd cluster not healthy on join | `etcdctl member remove <ID>` on master1 before retrying |
| NumCPU preflight error | Increase VM to ≥2 vCPU in ESXi → Edit Settings → CPU |
| Flannel CrashLoopBackOff | Use Calico — Flannel needs /opt/bin which Ubuntu 22.04 does not have |
| NFS mount bad option on workers | `ansible workers -m apt -a "name=nfs-common state=present" --become` |
| Certificate key expired on join | `kubeadm init phase upload-certs --upload-certs` on master1 |
| HAProxy forwardfor warning | `sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg` |
| BIND9 REFUSED from external | Set `dnssec-validation no` in named.conf |
| MetalLB controller crashing | `kubectl delete pod -n metallb-system <pod>` to force recreate |
| Dashboard no CPU/memory graphs | Install Metrics Server (Step 15) |
| pfSense routing loop | Disable wrong gateway under System → Routing → Gateways |
