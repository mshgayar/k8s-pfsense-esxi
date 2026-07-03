const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak,
  LevelFormat, ExternalHyperlink, TableOfContents
} = require('docx');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DOCS = __dirname;

// ── Helpers ────────────────────────────────────────────────────────────────

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

function h(level, text, opts = {}) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    ...opts,
    children: [new TextRun({ text, bold: true })],
  });
}

function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, ...opts, children: [new TextRun(text)] });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 40 },
    shading: { fill: 'F5F5F5', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 8, color: '1565C0', space: 4 } },
    indent: { left: 360 },
    children: [new TextRun({ text, font: 'Courier New', size: 18, color: '1A1A1A' })],
  });
}

function codeLines(lines) {
  return lines.map(l => code(l));
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 60 },
    children: [new TextRun(text)],
  });
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    shading: { fill: 'FFF8E1', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 8, color: 'F57F17', space: 4 } },
    indent: { left: 360 },
    children: [
      new TextRun({ text: 'Note: ', bold: true, color: 'E65100' }),
      new TextRun(text),
    ],
  });
}

function divider() {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
    spacing: { before: 200, after: 200 },
    children: [],
  });
}

function img(filename, widthPx, heightPx, caption = '') {
  const filepath = path.join(REPO, filename);
  if (!fs.existsSync(filepath)) return [p(`[Image not found: ${filename}]`)];
  const data = fs.readFileSync(filepath);
  // Scale to fit within 9360 DXA (6.5 inches @ 144dpi = ~936px) → 6.5 inch wide
  const scale = 9360 / (widthPx * 9.144);  // EMU per pixel at 96dpi
  const wEmu = Math.round(widthPx * 9144);
  const hEmu = Math.round(heightPx * 9144);
  // Target max width = 6.5 inches = 5943600 EMU
  const maxW = 5943600;
  const ratio = Math.min(1, maxW / wEmu);
  const finalW = Math.round(wEmu * ratio);
  const finalH = Math.round(hEmu * ratio);
  const result = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round(finalW / 9144), height: Math.round(finalH / 9144) }, altText: { title: caption, description: caption, name: caption } })],
    }),
  ];
  if (caption) result.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: caption, italics: true, size: 20, color: '555555' })] }));
  return result;
}

function twoColTable(rows, col1Width = 2400, col2Width = 6960) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [col1Width, col2Width],
    rows: rows.map(([a, b, header]) => new TableRow({
      tableHeader: !!header,
      children: [a, b].map((cell, i) => new TableCell({
        borders,
        width: { size: i === 0 ? col1Width : col2Width, type: WidthType.DXA },
        shading: header ? { fill: '1B3A5C', type: ShadingType.CLEAR } : (i === 0 ? { fill: 'F5F8FF', type: ShadingType.CLEAR } : {}),
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: cell, color: header ? 'FFFFFF' : undefined, bold: header || i === 0 })] })],
      })),
    })),
  });
}

// ── Sections ───────────────────────────────────────────────────────────────

const children = [];

// Cover
children.push(
  new Paragraph({ pageBreakBefore: false, spacing: { before: 1440 }, children: [] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'Kubernetes HA Lab', size: 64, bold: true, color: '0D47A1' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Complete Build & Operations Guide', size: 36, color: '1565C0' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: 'VMware ESXi · pfSense · 3-Master K8s v1.30.14 · Calico · MetalLB · Kafka', size: 24, color: '555555', italics: true })] }),
  ...img('diagram-k8s-components.png', 2800, 3777, 'Kubernetes Cluster Components'),
  new Paragraph({ children: [new PageBreak()] }),
);

// TOC placeholder
children.push(
  h(HeadingLevel.HEADING_1, 'Table of Contents'),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ── 1. Architecture Overview ───────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '1. Architecture Overview'), divider());
children.push(p('This lab implements a production-grade Kubernetes HA cluster on VMware ESXi using pfSense as the network gateway and firewall. Three control-plane nodes run stacked etcd using Raft consensus, while three worker nodes host application workloads. HAProxy load-balances the Kubernetes API across all three masters.'));

children.push(h(HeadingLevel.HEADING_2, 'Node Inventory'));
children.push(twoColTable([
  ['Host', 'IP / OS / Role', true],
  ['infra.mo.lab.local', '172.25.25.254 · RHEL 9 · BIND9 DNS + NFS server'],
  ['manager.mo.lab.local', '172.25.25.5 · RHEL 9 · Ansible control node + Helm + kubectl'],
  ['lb-k8s.mo.lab.local', '172.25.25.10 · RHEL 9 · HAProxy 2.8.14 load balancer'],
  ['master1-k8s.mo.lab.local', '172.25.25.11 · Ubuntu 22.04 · K8s control plane + etcd'],
  ['master2-k8s.mo.lab.local', '172.25.25.12 · Ubuntu 22.04 · K8s control plane + etcd'],
  ['master3-k8s.mo.lab.local', '172.25.25.13 · Ubuntu 22.04 · K8s control plane + etcd'],
  ['worker1-k8s.mo.lab.local', '172.25.25.21 · Ubuntu 22.04 · K8s worker node'],
  ['worker2-k8s.mo.lab.local', '172.25.25.22 · Ubuntu 22.04 · K8s worker node'],
  ['worker3-k8s.mo.lab.local', '172.25.25.23 · Ubuntu 22.04 · K8s worker node'],
], 3000, 6360));

children.push(h(HeadingLevel.HEADING_2, 'Network Layout'));
children.push(twoColTable([
  ['Network', 'Description', true],
  ['vSwitch0 192.168.1.0/24', 'Home LAN — vmnic0, pfSense WAN 192.168.1.20'],
  ['vSwitch1 172.25.25.0/24', 'K8s lab network — vmnic1, pfSense LAN 172.25.25.1'],
  ['MetalLB pool', '172.25.25.100 – 172.25.25.150 (L2 mode)'],
  ['Pod CIDR', '10.244.0.0/16 (Calico)'],
  ['Domain', 'mo.lab.local (BIND9 on infra)'],
], 3000, 6360));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 2. pfSense ─────────────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '2. pfSense 2.8.1 Installation & Configuration'), divider());
children.push(p('pfSense acts as NAT gateway, firewall, and router between the home LAN (192.168.1.0/24) and the isolated K8s lab network (172.25.25.0/24).'));

children.push(h(HeadingLevel.HEADING_2, 'ESXi VM Configuration'));
children.push(...[
  'vCPU: 2, RAM: 2 GB, Disk: 8 GB',
  'Network Adapter 1: vSwitch0 (vmnic0) → WAN interface em0',
  'Network Adapter 2: vSwitch1 k8s-net-lab (vmnic1) → LAN interface em1',
].map(t => bullet(t)));

children.push(h(HeadingLevel.HEADING_2, 'Initial Interface Assignment'));
children.push(p('On first boot pfSense prompts for interface assignment:'));
children.push(...codeLines([
  'WAN  → em0 (192.168.1.20/24, gateway 192.168.1.1)',
  'LAN  → em1 (172.25.25.1/24)',
]));

children.push(h(HeadingLevel.HEADING_2, 'NAT — Outbound Rule'));
children.push(p('Firewall → NAT → Outbound → Manual Outbound NAT:'));
children.push(...[
  'Interface: WAN',
  'Source: 172.25.25.0/24',
  'Translation: Interface Address',
].map(t => bullet(t)));

children.push(h(HeadingLevel.HEADING_2, 'Static Route on Mac'));
children.push(p('Add a persistent route on your Mac so you can reach 172.25.25.x from the home LAN:'));
children.push(code('sudo route add -net 172.25.25.0/24 192.168.1.20'));
children.push(note('This route is lost on reboot. Add it to /etc/rc.local or a LaunchDaemon for persistence.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 3. BIND9 DNS ───────────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '3. BIND9 DNS Server (infra — 172.25.25.254)'), divider());

children.push(h(HeadingLevel.HEADING_2, 'Install'));
children.push(...codeLines([
  '# On infra VM',
  'dnf install -y bind bind-utils',
  'systemctl enable --now named',
]));

children.push(h(HeadingLevel.HEADING_2, '/etc/named.conf (key settings)'));
children.push(...codeLines([
  'options {',
  '    listen-on port 53 { 127.0.0.1; 172.25.25.254; };',
  '    directory "/var/named";',
  '    allow-query { localhost; 172.25.25.0/24; };',
  '    recursion yes;',
  '    forwarders { 8.8.8.8; 8.8.4.4; };',
  '    dnssec-enable no;',
  '    dnssec-validation no;',
  '};',
]));

children.push(h(HeadingLevel.HEADING_2, '/etc/named/named.conf.local'));
children.push(...codeLines([
  'zone "mo.lab.local" {',
  '    type master;',
  '    file "/etc/named/zones/db.mo.lab.local";',
  '};',
  'zone "25.25.172.in-addr.arpa" {',
  '    type master;',
  '    file "/etc/named/zones/db.172.25.25.rev";',
  '};',
]));

children.push(h(HeadingLevel.HEADING_2, 'Forward Zone — db.mo.lab.local'));
children.push(...codeLines([
  '$TTL 86400',
  '@ IN SOA infra.mo.lab.local. admin.mo.lab.local. (2024010101 3600 1800 604800 86400)',
  '@ IN NS infra.mo.lab.local.',
  'infra         IN A 172.25.25.254',
  'manager       IN A 172.25.25.5',
  'lb-k8s        IN A 172.25.25.10',
  'master1-k8s   IN A 172.25.25.11',
  'master2-k8s   IN A 172.25.25.12',
  'master3-k8s   IN A 172.25.25.13',
  'worker1-k8s   IN A 172.25.25.21',
  'worker2-k8s   IN A 172.25.25.22',
  'worker3-k8s   IN A 172.25.25.23',
  'dashboard-k8s IN A 172.25.25.100',
]));

children.push(h(HeadingLevel.HEADING_2, 'Verify DNS'));
children.push(...codeLines([
  'dig @172.25.25.254 master1-k8s.mo.lab.local',
  '# Expected: 172.25.25.11 in ANSWER section',
  'dig @172.25.25.254 -x 172.25.25.11',
  '# Expected: master1-k8s.mo.lab.local in ANSWER section',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 4. NFS Server ──────────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '4. NFS Server (infra — 172.25.25.254)'), divider());
children.push(...codeLines([
  '# On infra VM',
  'dnf install -y nfs-utils',
  'mkdir -p /home/nfs/k8s',
  'chmod 777 /home/nfs/k8s',
  'echo "/home/nfs/k8s 172.25.25.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports',
  'exportfs -rav',
  'systemctl enable --now nfs-server',
  '',
  '# Verify from any worker',
  'showmount -e 172.25.25.254',
  '# Expected: /home/nfs/k8s  172.25.25.0/24',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 5. HAProxy ─────────────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '5. HAProxy 2.8.14 Load Balancer (lb-k8s — 172.25.25.10)'), divider());
children.push(h(HeadingLevel.HEADING_2, 'Install'));
children.push(...codeLines([
  '# On lb-k8s VM',
  'dnf install -y haproxy',
  'systemctl enable --now haproxy',
]));

children.push(h(HeadingLevel.HEADING_2, '/etc/haproxy/haproxy.cfg'));
children.push(...codeLines([
  'global',
  '    log /dev/log local0',
  '    chroot /var/lib/haproxy',
  '    stats socket /run/haproxy/admin.sock mode 660 level admin',
  '    user haproxy',
  '    group haproxy',
  '    daemon',
  '',
  'defaults',
  '    log global',
  '    mode tcp',
  '    option tcplog',
  '    timeout connect 5000',
  '    timeout client  50000',
  '    timeout server  50000',
  '',
  'frontend kubernetes-api',
  '    bind *:6443',
  '    mode tcp',
  '    default_backend kubernetes-masters',
  '',
  'backend kubernetes-masters',
  '    mode tcp',
  '    balance roundrobin',
  '    option tcp-check',
  '    server master1 172.25.25.11:6443 check fall 3 rise 2',
  '    server master2 172.25.25.12:6443 check fall 3 rise 2',
  '    server master3 172.25.25.13:6443 check fall 3 rise 2',
  '',
  'frontend http-ingress',
  '    bind *:80',
  '    mode tcp',
  '    default_backend http-workers',
  '',
  'backend http-workers',
  '    mode tcp',
  '    balance roundrobin',
  '    server worker1 172.25.25.21:80 check fall 3 rise 2',
  '    server worker2 172.25.25.22:80 check fall 3 rise 2',
  '    server worker3 172.25.25.23:80 check fall 3 rise 2',
  '',
  'frontend https-ingress',
  '    bind *:443',
  '    mode tcp',
  '    default_backend https-workers',
  '',
  'backend https-workers',
  '    mode tcp',
  '    balance roundrobin',
  '    server worker1 172.25.25.21:443 check fall 3 rise 2',
  '    server worker2 172.25.25.22:443 check fall 3 rise 2',
  '    server worker3 172.25.25.23:443 check fall 3 rise 2',
  '',
  'listen stats',
  '    bind *:9000',
  '    mode http',
  '    stats enable',
  '    stats uri /',
  '    stats refresh 10s',
]));

children.push(h(HeadingLevel.HEADING_2, 'Verify'));
children.push(...codeLines([
  'haproxy -c -f /etc/haproxy/haproxy.cfg   # config check',
  'systemctl restart haproxy',
  'curl http://172.25.25.10:9000/            # stats page',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 6. Ansible Setup ───────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '6. Ansible Setup (manager — 172.25.25.5)'), divider());
children.push(...codeLines([
  '# On manager VM',
  'dnf install -y ansible-core git',
  '',
  '# Generate SSH key and copy to all nodes',
  'ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""',
  'for host in 172.25.25.11 172.25.25.12 172.25.25.13 172.25.25.21 172.25.25.22 172.25.25.23; do',
  '  ssh-copy-id msalah@$host',
  'done',
  '',
  '# Clone the repo',
  'git clone https://github.com/mshgayar/k8s-pfsense-esxi.git /root/ansible-k8s',
  'cd /root/ansible-k8s',
]));

children.push(h(HeadingLevel.HEADING_2, 'Ansible Inventory — hosts'));
children.push(...codeLines([
  '[masters]',
  'master1-k8s ansible_host=172.25.25.11',
  'master2-k8s ansible_host=172.25.25.12',
  'master3-k8s ansible_host=172.25.25.13',
  '',
  '[workers]',
  'worker1-k8s ansible_host=172.25.25.21 ansible_user=worker1-k8s',
  'worker2-k8s ansible_host=172.25.25.22 ansible_user=worker2-k8s',
  'worker3-k8s ansible_host=172.25.25.23 ansible_user=worker3-k8s',
  '',
  '[k8s:children]',
  'masters',
  'workers',
  '',
  '[k8s:vars]',
  'ansible_user=msalah',
  'ansible_become=yes',
  'ansible_become_method=sudo',
]));

children.push(h(HeadingLevel.HEADING_2, 'Test Connectivity'));
children.push(...codeLines([
  'ansible all -i hosts -m ping',
  '# All 6 nodes should return SUCCESS',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 7. Kubernetes Stack ────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '7. Kubernetes Stack'), divider());

children.push(h(HeadingLevel.HEADING_2, '7.1 Prepare All Nodes via Ansible'));
children.push(p('The prepare-k8s-nodes.yml playbook configures all 6 K8s nodes: disables swap, loads kernel modules, configures sysctl, installs containerd, and installs kubeadm/kubelet/kubectl v1.30.'));
children.push(...codeLines([
  '# On manager VM',
  'cd /root/ansible-k8s',
  'ansible-playbook -i hosts prepare-k8s-nodes.yml',
]));

children.push(p('Key tasks performed on every node:'));
children.push(...[
  'apt update/upgrade — latest security patches',
  'Disable swap permanently (swapoff -a + /etc/fstab edit)',
  'Load overlay and br_netfilter kernel modules',
  'sysctl: net.bridge.bridge-nf-call-iptables=1, net.ipv4.ip_forward=1',
  'Install containerd.io from Docker repository with SystemdCgroup=true in config.toml',
  'Disable UFW firewall',
  'Install kubelet kubeadm kubectl v1.30 and hold package versions',
  'Enable kubelet service',
].map(t => bullet(t)));

children.push(h(HeadingLevel.HEADING_2, '7.2 Initialize Cluster on master1'));
children.push(...codeLines([
  '# On master1 (172.25.25.11)',
  'kubeadm init \\',
  '  --control-plane-endpoint "172.25.25.10:6443" \\',
  '  --upload-certs \\',
  '  --pod-network-cidr=10.244.0.0/16 \\',
  '  --apiserver-advertise-address=172.25.25.11',
]));

children.push(p('After init completes, set up kubeconfig:'));
children.push(...codeLines([
  'mkdir -p $HOME/.kube',
  'cp /etc/kubernetes/admin.conf $HOME/.kube/config',
  'chown $(id -u):$(id -g) $HOME/.kube/config',
]));

children.push(p('Save the join commands output — you will need them for the control-plane and worker joins.'));
children.push(note('The --certificate-key value expires after 2 hours. Regenerate with: kubeadm init phase upload-certs --upload-certs on master1.'));

children.push(h(HeadingLevel.HEADING_2, '7.3 Join master2 and master3'));
children.push(...codeLines([
  '# On master2 and master3 — use the control-plane join command from kubeadm init output',
  'kubeadm join 172.25.25.10:6443 \\',
  '  --token <token> \\',
  '  --discovery-token-ca-cert-hash sha256:<hash> \\',
  '  --control-plane \\',
  '  --certificate-key <cert-key> \\',
  '  --apiserver-advertise-address=172.25.25.12  # (or .13 for master3)',
]));

children.push(p('If a join fails and leaves a stale etcd member, clean it up before retrying:'));
children.push(...codeLines([
  '# On master1 — list and remove stale etcd member',
  'etcdctl --endpoints=https://127.0.0.1:2379 \\',
  '  --cacert=/etc/kubernetes/pki/etcd/ca.crt \\',
  '  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \\',
  '  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \\',
  '  member list',
  '',
  'etcdctl ... member remove <STALE_ID>',
  '',
  '# On master2/master3 — clean before retry',
  'kubeadm reset -f && rm -rf /etc/kubernetes /var/lib/etcd',
]));

children.push(h(HeadingLevel.HEADING_2, '7.4 Join Worker Nodes'));
children.push(...codeLines([
  '# On worker1, worker2, worker3 — use the worker join command',
  'kubeadm join 172.25.25.10:6443 \\',
  '  --token <token> \\',
  '  --discovery-token-ca-cert-hash sha256:<hash>',
  '',
  '# Verify on master1 — nodes will be NotReady until CNI is installed',
  'kubectl get nodes',
]));

children.push(h(HeadingLevel.HEADING_2, '7.5 Install Calico CNI'));
children.push(note('Flannel v0.28.5 requires /opt/bin which is not present on Ubuntu 22.04. Use Calico v3.27.0 instead.'));
children.push(...codeLines([
  '# On master1',
  'kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml',
  '',
  '# Watch nodes become Ready (takes ~60 seconds)',
  'kubectl get nodes -w',
  '',
  '# Expected output:',
  'NAME          STATUS   ROLES           AGE   VERSION',
  'master1-k8s   Ready    control-plane   5m    v1.30.14',
  'master2-k8s   Ready    control-plane   4m    v1.30.14',
  'master3-k8s   Ready    control-plane   3m    v1.30.14',
  'worker1-k8s   Ready    <none>          2m    v1.30.14',
  'worker2-k8s   Ready    <none>          2m    v1.30.14',
  'worker3-k8s   Ready    <none>          1m    v1.30.14',
]));

children.push(h(HeadingLevel.HEADING_2, '7.6 Install MetalLB'));
children.push(...codeLines([
  '# Apply MetalLB manifest',
  'kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.5/config/manifests/metallb-native.yaml',
  '',
  '# Wait for controller to be ready',
  'kubectl wait -n metallb-system deployment/controller --for=condition=Available --timeout=120s',
  '',
  '# Apply IP pool configuration',
  'kubectl apply -f metallb-config.yaml',
]));

children.push(p('metallb-config.yaml:'));
children.push(...codeLines([
  'apiVersion: metallb.io/v1beta1',
  'kind: IPAddressPool',
  'metadata:',
  '  name: k8s-ip-pool',
  '  namespace: metallb-system',
  'spec:',
  '  addresses:',
  '  - 172.25.25.100-172.25.25.150',
  '---',
  'apiVersion: metallb.io/v1beta1',
  'kind: L2Advertisement',
  'metadata:',
  '  name: k8s-l2-advert',
  '  namespace: metallb-system',
  'spec:',
  '  ipAddressPools:',
  '  - k8s-ip-pool',
]));

children.push(h(HeadingLevel.HEADING_2, '7.7 Install Kubernetes Dashboard'));
children.push(...codeLines([
  'kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml',
  '',
  '# Change service type to LoadBalancer',
  'kubectl -n kubernetes-dashboard patch svc kubernetes-dashboard \\',
  '  -p \'{"spec":{"type":"LoadBalancer"}}\'',
  '',
  '# Verify MetalLB assigned IP 172.25.25.100',
  'kubectl -n kubernetes-dashboard get svc',
  '',
  '# Create admin service account and cluster role binding',
  'kubectl create serviceaccount dashboard-admin -n kubernetes-dashboard',
  'kubectl create clusterrolebinding dashboard-admin \\',
  '  --clusterrole=cluster-admin \\',
  '  --serviceaccount=kubernetes-dashboard:dashboard-admin',
  '',
  '# Generate login token',
  'kubectl create token dashboard-admin -n kubernetes-dashboard --duration=87600h',
]));
children.push(note('Access at https://172.25.25.100 — paste the token to log in.'));

children.push(h(HeadingLevel.HEADING_2, '7.8 Install Metrics Server'));
children.push(...codeLines([
  'kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml',
  '',
  '# Patch for insecure TLS (required in lab — no valid certs on kubelets)',
  'kubectl patch deployment metrics-server -n kube-system \\',
  '  --type json \\',
  '  -p \'[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]\'',
  '',
  '# Verify',
  'kubectl top nodes',
]));

children.push(h(HeadingLevel.HEADING_2, '7.9 Install NFS Dynamic Provisioner'));
children.push(...codeLines([
  '# Install nfs-common on all worker nodes (required for NFS mounts)',
  'ansible workers -i hosts -m apt -a "name=nfs-common state=present" --become',
  '',
  '# Add Helm repo and install provisioner',
  'helm repo add nfs-subdir-external-provisioner \\',
  '  https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/',
  'helm repo update',
  '',
  'helm install nfs-subdir-external-provisioner \\',
  '  nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \\',
  '  --set nfs.server=172.25.25.254 \\',
  '  --set nfs.path=/home/nfs/k8s \\',
  '  --set storageClass.name=nfs-storage \\',
  '  --set storageClass.defaultClass=true',
  '',
  '# Test dynamic provisioning',
  'kubectl apply -f test-pvc.yaml',
  'kubectl apply -f test-pod-dynamic-storage.yaml',
  'kubectl get pvc   # Should be Bound',
]));

children.push(h(HeadingLevel.HEADING_2, '7.10 Kubernetes Traffic Flow Diagram'));
children.push(...img('diagram-traffic-scheduling.png', 2800, 4926, 'Kubernetes Traffic Flow & Pod Scheduling'));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 8. Kafka ───────────────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '8. Kafka Cluster for Corelight / Zeek Logs'), divider());
children.push(p('After the Kubernetes cluster is operational, a Kafka cluster will be deployed using the Strimzi operator in KRaft mode (no Zookeeper). The Corelight network sensor will forward Zeek log events to Kafka topics for downstream consumption by a SIEM or analytics platform.'));

children.push(...img('diagram-kafka-cluster.png', 2800, 4202, 'Kafka Cluster Architecture — Corelight Log Ingestion'));

children.push(h(HeadingLevel.HEADING_2, 'Design'));
children.push(...[
  '3 broker pods — one per worker node, NFS PVCs (20Gi each) for durability',
  'KRaft mode — no Zookeeper dependency',
  'Replication Factor 2 — survives single broker failure',
  'MetalLB LoadBalancer VIP: 172.25.25.101:9092',
  'Topics: corelight.conn, corelight.dns, corelight.http, corelight.ssl, corelight.files, corelight.weird',
  'Retention: 7 days — supports full replay after consumer failure',
].map(t => bullet(t)));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 9. Troubleshooting ─────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '9. Troubleshooting'), divider());
children.push(twoColTable([
  ['Issue', 'Root Cause & Fix', true],
  ['etcd not healthy on join', 'Stale member from failed join → etcdctl member remove <ID> on master1, then kubeadm reset on the joining node'],
  ['NumCPU preflight error', '1 vCPU configured → power off VM, Edit Settings in ESXi, set 2 vCPU minimum'],
  ['Flannel CrashLoopBackOff', 'Flannel requires /opt/bin absent on Ubuntu 22.04 → use Calico v3.27.0'],
  ['NFS mount bad option', 'nfs-common missing on workers → ansible workers -m apt -a "name=nfs-common state=present"'],
  ['Certificate key expired', 'kubeadm cert key expires after 2 hours → kubeadm init phase upload-certs --upload-certs on master1'],
  ['HAProxy forwardfor error', 'option forwardfor incompatible with TCP mode → remove forwardfor lines from haproxy.cfg'],
  ['BIND9 REFUSED queries', 'DNSSEC validation rejecting responses → set dnssec-validation no in named.conf'],
  ['MetalLB controller crash', 'Stale pod after node restart → kubectl delete pod -n metallb-system <pod>'],
  ['Dashboard no graphs', 'Metrics Server not installed → follow Step 7.8'],
  ['NFS provisioner crash', 'nfs-common missing on workers → install then rollout restart deployment'],
  ['pfSense routing loop', 'Wrong default gateway → System → Routing → Gateways, disable incorrect entry'],
], 3200, 6160));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 10. Quick Reference ────────────────────────────────────────────────────
children.push(h(HeadingLevel.HEADING_1, '10. Quick Reference'), divider());

children.push(h(HeadingLevel.HEADING_2, 'Access Endpoints'));
children.push(twoColTable([
  ['Service', 'URL / Address', true],
  ['Kubernetes Dashboard', 'https://172.25.25.100 (Bearer Token login)'],
  ['HAProxy Stats', 'http://172.25.25.10:9000'],
  ['Kubernetes API', 'https://172.25.25.10:6443 (via HAProxy)'],
  ['pfSense Web UI', 'https://192.168.1.20 (home LAN only)'],
  ['DNS Server', '172.25.25.254:53 (BIND9, mo.lab.local)'],
  ['NFS Export', '172.25.25.254:/home/nfs/k8s'],
  ['Kafka (planned)', '172.25.25.101:9092 (MetalLB VIP)'],
], 3000, 6360));

children.push(h(HeadingLevel.HEADING_2, 'Component Versions'));
children.push(twoColTable([
  ['Component', 'Version', true],
  ['pfSense', '2.8.1'],
  ['HAProxy', '2.8.14'],
  ['Kubernetes', 'v1.30.14'],
  ['containerd', 'v2.2.5'],
  ['Calico CNI', 'v3.27.0'],
  ['MetalLB', 'v0.14.5'],
  ['Kubernetes Dashboard', 'v2.7.0'],
  ['Strimzi (Kafka)', 'latest (KRaft mode)'],
], 3000, 6360));

children.push(h(HeadingLevel.HEADING_2, 'Key Commands Cheatsheet'));
children.push(...codeLines([
  '# Cluster health',
  'kubectl get nodes -o wide',
  'kubectl get pods -A',
  'kubectl get svc -A',
  'kubectl top nodes',
  '',
  '# etcd health',
  'etcdctl --endpoints=https://127.0.0.1:2379 \\',
  '  --cacert=/etc/kubernetes/pki/etcd/ca.crt \\',
  '  --cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt \\',
  '  --key=/etc/kubernetes/pki/etcd/healthcheck-client.key \\',
  '  endpoint health --cluster',
  '',
  '# Regenerate dashboard token',
  'kubectl create token dashboard-admin -n kubernetes-dashboard --duration=87600h',
  '',
  '# Regenerate kubeadm cert key (for new control-plane joins)',
  'kubeadm init phase upload-certs --upload-certs',
  '',
  '# Run Ansible on all K8s nodes',
  'ansible k8s -i hosts -m command -a "uptime"',
]));

// ── Build document ─────────────────────────────────────────────────────────

const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '0D47A1' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '1565C0' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '1565C0' } },
          children: [
            new TextRun({ text: 'Kubernetes HA Lab — Build Guide', bold: true, color: '0D47A1' }),
            new TextRun('\t'),
            new TextRun({ text: 'mo.lab.local · v1.30.14', color: '555555' }),
          ],
          tabStops: [{ type: 'right', position: 8640 }],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
          children: [
            new TextRun({ text: 'Confidential — Internal Lab Documentation', color: '888888', size: 18 }),
            new TextRun('\t'),
            new TextRun({ text: 'Page ', color: '888888', size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], color: '888888', size: 18 }),
          ],
          tabStops: [{ type: 'right', position: 8640 }],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = path.join(DOCS, 'k8s-lab-documentation.docx');
  fs.writeFileSync(outPath, buffer);
  console.log('Written:', outPath);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
