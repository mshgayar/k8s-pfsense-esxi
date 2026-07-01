# Kubernetes HA Lab Cluster on VMware ESXi

Full installation guide for a highly available Kubernetes v1.30.14 cluster with pfSense, HAProxy, BIND9 DNS, NFS storage, MetalLB, and Kubernetes Dashboard.

---

## Architecture

```
Home LAN (192.168.1.0/24)
        |
   [MacBook] ──── static route 172.25.25.0/24 via 192.168.1.20
        |
   [pfSense 2.8.1]
     WAN: 192.168.1.20
     LAN: 172.25.25.1  ←── NAT + Firewall + Gateway
        |
        └── vSwitch1 (k8s-net-lab) — 172.25.25.0/24
              |
    ┌─────────┼──────────────────────────────────┐
    │         │                                  │
[infra]   [lb-k8s]                          [manager]
172.25.25.254  172.25.25.10               172.25.25.5
DNS + NFS   HAProxy LB                  Ansible + kubectl
              │
         ┌────┴──────────────────────┐
         │           │               │
      [master1]   [master2]       [master3]
    172.25.25.11  172.25.25.12  172.25.25.13
      K8s Control Plane + etcd (HA stacked)
         │
         ├── [worker1] 172.25.25.21
         ├── [worker2] 172.25.25.22
         └── [worker3] 172.25.25.23
```

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

## Step 1 — pfSense Setup

- WAN interface: `192.168.1.20` (home LAN)
- LAN interface: `172.25.25.1` (k8s network)
- Enable NAT: Firewall → NAT → Outbound → Automatic
- Add firewall rule on LAN to allow all traffic from `172.25.25.0/24`
- Static route on Mac: `sudo route add -net 172.25.25.0/24 192.168.1.20`

---

## Step 2 — BIND9 DNS (infra — 172.25.25.254)

```bash
dnf install -y bind bind-utils

cp named.conf /etc/named.conf
cp named.conf.local /etc/named/named.conf.local
cp zones/db.mo.lab.local /etc/named/zones/db.mo.lab.local
cp zones/db.172.25.25.rev /etc/named/zones/db.172.25.25.rev

systemctl enable --now named

# Test
dig @172.25.25.254 master1-k8s.mo.lab.local
dig @172.25.25.254 -x 172.25.25.11
```

---

## Step 3 — NFS Server (infra — 172.25.25.254)

```bash
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

## Step 4 — HAProxy (lb-k8s — 172.25.25.10)

```bash
dnf install -y haproxy

cp haproxy.cfg /etc/haproxy/haproxy.cfg

sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg

haproxy -c -f /etc/haproxy/haproxy.cfg
systemctl enable --now haproxy

firewall-cmd --permanent --add-port=6443/tcp
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=443/tcp
firewall-cmd --permanent --add-port=9000/tcp
firewall-cmd --reload
```

HAProxy stats: http://172.25.25.10:9000

---

## Step 5 — Manager VM (172.25.25.5)

```bash
dnf install -y ansible-core git

ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""

ssh-copy-id msalah@172.25.25.11
ssh-copy-id msalah@172.25.25.12
ssh-copy-id msalah@172.25.25.13
ssh-copy-id worker1-k8s@172.25.25.21
ssh-copy-id worker2-k8s@172.25.25.22
ssh-copy-id worker3-k8s@172.25.25.23

# Passwordless sudo — masters
for ip in 172.25.25.11 172.25.25.12 172.25.25.13; do
  ssh msalah@$ip "echo 'msalah ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/msalah"
done

# Passwordless sudo — workers
ssh worker1-k8s@172.25.25.21 "echo 'worker1-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker1-k8s"
ssh worker2-k8s@172.25.25.22 "echo 'worker2-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker2-k8s"
ssh worker3-k8s@172.25.25.23 "echo 'worker3-k8s ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/worker3-k8s"

mkdir -p /etc/ansible
cp hosts /etc/ansible/hosts

ansible all -m ping
```

---

## Step 6 — Prepare All K8s Nodes (from manager)

```bash
ansible-playbook prepare-k8s-nodes.yml
```

This playbook runs on all 6 nodes and:
- Updates all packages
- Disables swap
- Loads kernel modules (overlay, br_netfilter)
- Configures sysctl
- Installs containerd with SystemdCgroup=true
- Disables UFW
- Installs kubeadm, kubelet, kubectl v1.30 (held)

---

## Step 7 — Initialize Kubernetes Cluster (master1)

```bash
sudo kubeadm init \
  --control-plane-endpoint "172.25.25.10:6443" \
  --upload-certs \
  --pod-network-cidr=10.244.0.0/16

mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Copy kubeconfig to manager
scp msalah@172.25.25.11:/home/msalah/.kube/config ~/.kube/config
```

---

## Step 8 — Join master2 and master3

On master1 — generate fresh credentials (valid 2 hours):

```bash
sudo kubeadm init phase upload-certs --upload-certs
sudo kubeadm token create --print-join-command
```

On master2 and master3 — clean reset then join:

```bash
sudo kubeadm reset -f
sudo rm -rf /etc/kubernetes/manifests /etc/kubernetes/pki
sudo rm -rf /etc/kubernetes/*.conf /var/lib/etcd /var/lib/kubelet
sudo systemctl restart containerd

sudo kubeadm join 172.25.25.10:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --control-plane --certificate-key <cert-key>
```

> **If join fails with "etcd cluster not healthy"** — remove stale member on master1:
> ```bash
> ETCDCTL_API=3 etcdctl \
>   --endpoints=https://127.0.0.1:2379 \
>   --cacert=/etc/kubernetes/pki/etcd/ca.crt \
>   --cert=/etc/kubernetes/pki/etcd/server.crt \
>   --key=/etc/kubernetes/pki/etcd/server.key \
>   member list
>
> etcdctl member remove <ID>
> ```
> Then reset and retry the join.

---

## Step 9 — Join Worker Nodes

```bash
sudo kubeadm join 172.25.25.10:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

---

## Step 10 — Install Calico CNI (from manager)

> Flannel was not used — it requires /opt/bin which does not exist on Ubuntu 22.04.

```bash
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

kubectl get nodes -w
```

---

## Step 11 — Install MetalLB (from manager)

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.5/config/manifests/metallb-native.yaml

kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=app=metallb \
  --timeout=90s

kubectl apply -f metallb-config.yaml

kubectl get IPAddressPool -n metallb-system
```

---

## Step 12 — Install Kubernetes Dashboard (from manager)

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml

# Change ClusterIP to LoadBalancer
kubectl edit svc kubernetes-dashboard -n kubernetes-dashboard

# Verify external IP assigned by MetalLB
kubectl get svc -n kubernetes-dashboard

# Create admin account
kubectl create serviceaccount admin-user -n kubernetes-dashboard
kubectl create clusterrolebinding admin-user \
  --clusterrole=cluster-admin \
  --serviceaccount=kubernetes-dashboard:admin-user

# Generate login token
kubectl -n kubernetes-dashboard create token admin-user
```

Access at: **https://172.25.25.100**

---

## Step 13 — NFS Dynamic Provisioner (from manager)

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

# Test dynamic provisioning
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

---

## Component Versions

| Component | Version |
|---|---|
| pfSense | 2.8.1 |
| HAProxy | 2.8.14 |
| Kubernetes | v1.30.14 |
| containerd | v2.2.5 |
| Calico CNI | v3.27.0 |
| MetalLB | v0.14.5 |
| Kubernetes Dashboard | v2.7.0 |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| etcd cluster not healthy on join | `etcdctl member remove <ID>` on master1 before retrying |
| NumCPU preflight error | Increase VM to ≥2 vCPU in ESXi settings |
| Flannel CrashLoopBackOff | Use Calico — Flannel needs /opt/bin which Ubuntu does not have |
| NFS mount bad option on workers | `ansible workers -m apt -a "name=nfs-common state=present" --become` |
| Certificate key expired on join | `kubeadm init phase upload-certs --upload-certs` on master1 |
| HAProxy forwardfor warning | `sed -i '/option.*forwardfor/d' /etc/haproxy/haproxy.cfg` |
| BIND9 REFUSED from external host | Set `dnssec-validation no` in named.conf |
