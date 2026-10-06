// lab-relay: a UDP relay run on the Android device (app/lib/android.mjs startRelay). The game joins 127.0.0.1 (a local
// server: no Microsoft sign-in asked, "Guardian"), and this sends each of its sessions on to the lab's BDS on the
// machine (10.0.2.2) and the answers back. Each peer that sends to the listening port gets its own socket to the target;
// what the target answers goes back to that peer from the listening port. Built static on the machine (cc -static) for
// the device's CPU: no libraries on the device. Built by the lab, never committed as a binary.
//   lab-relay <listen-port> <target-ip> <target-port>    lab-relay --ping <ip> <port>
//   lab-relay --reflect <port> <target-ip> <target-port>: the game's broadcasts to <port> — NetherNet's LAN discovery, UDP
//   7551, a port the game holds itself, so nothing else can listen there — caught as they leave (AF_PACKET with ETH_P_ALL,
//   root: the kernel shows packets leaving the device only to sockets of all protocols — one for ETH_P_IP saw none on the
//   CI device, where tcpdump showed a broadcast from each network every 2 s) and sent
//   again as unicast to the target with the game's own address and port as the source (a raw socket). The emulator's NAT
//   carries that like any packet from the game; the server's answer comes back to the game's own socket from the target,
//   and what follows (LAN signaling) goes there directly
// (_GNU_SOURCE: struct udphdr's Linux names — source, dest, len, check — in every C library: glibc, musl, bionic)
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/udp.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MAXS 64
#define IDLE 180
struct sess { struct sockaddr_in peer; int fd; time_t last; unsigned long up, down; };
static struct sess S[MAXS];

// --ping <ip> <port>: a RakNet unconnected ping, the pong's bytes and text printed (does a server answer from here?)
static int ping(const char *ip, int port) {
  struct sockaddr_in t = { 0 }; t.sin_family = AF_INET; t.sin_port = htons((unsigned short)port);
  if (inet_pton(AF_INET, ip, &t.sin_addr) != 1) { fprintf(stderr, "not an IPv4 address: %s\n", ip); return 2; }
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  static const unsigned char pkt[33] = { 1, 0,0,0,0,0,0,0,1, 0,0xff,0xff,0,0xfe,0xfe,0xfe,0xfe,0xfd,0xfd,0xfd,0xfd,0x12,0x34,0x56,0x78, 0,0,0,0,0,0,0,1 };
  for (int k = 0; k < 3; k++) {
    sendto(fd, pkt, sizeof pkt, 0, (struct sockaddr *)&t, sizeof t);
    struct pollfd p = { fd, POLLIN, 0 };
    if (poll(&p, 1, 2000) > 0) {
      unsigned char b[2048]; struct sockaddr_in f; socklen_t fl = sizeof f;
      ssize_t r = recvfrom(fd, b, sizeof b, 0, (struct sockaddr *)&f, &fl);
      char a[INET_ADDRSTRLEN]; inet_ntop(AF_INET, &f.sin_addr, a, sizeof a);
      printf("pong %zd bytes from %s:%d id 0x%02x: ", r, a, ntohs(f.sin_port), r > 0 ? b[0] : 0);
      for (ssize_t i = 35; i < r; i++) putchar(b[i] >= 32 && b[i] < 127 ? b[i] : '.');
      putchar('\n'); return 0;
    }
    printf("no answer (%d)\n", k + 1); fflush(stdout);
  }
  return 1;
}

static int reflect(int port, const char *ip, int toport) {
  struct in_addr dst;
  if (inet_pton(AF_INET, ip, &dst) != 1) { fprintf(stderr, "lab-relay: not an IPv4 address: %s\n", ip); return 2; }
  int cap = socket(AF_PACKET, SOCK_DGRAM, htons(ETH_P_ALL));
  if (cap < 0) { perror("lab-relay: AF_PACKET (root?)"); return 1; }
  int raw = socket(AF_INET, SOCK_RAW, IPPROTO_RAW);
  if (raw < 0) { perror("lab-relay: raw socket (root?)"); return 1; }
  printf("lab-relay: broadcasts to :%d -> %s:%d\n", port, ip, toport); fflush(stdout);
  static unsigned char buf[65536], out[65536], prev[2048];
  size_t prevn = 0; struct timespec pt = { 0 }; unsigned long n = 0;
  for (;;) {
    struct sockaddr_ll from; socklen_t fl = sizeof from;
    ssize_t r = recvfrom(cap, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
    // (as it leaves, or its copy looped back to the device: whichever the kernel shows first; the same datagram once)
    if (r < 28 || from.sll_protocol != htons(ETH_P_IP) || (from.sll_pkttype != PACKET_OUTGOING && from.sll_pkttype != PACKET_BROADCAST && from.sll_pkttype != PACKET_HOST)) continue;
    struct iphdr *ih = (struct iphdr *)buf;
    if (ih->version != 4 || ih->protocol != IPPROTO_UDP) continue;
    size_t ihl = (size_t)ih->ihl * 4;
    if ((size_t)r < ihl + 8) continue;
    struct udphdr *uh = (struct udphdr *)(buf + ihl);
    if (ntohs(uh->dest) != port) continue;
    // a broadcast only (255.255.255.255 or a network's .255): a unicast to the port is on its way already
    uint32_t d = ntohl(ih->daddr);
    if (d != 0xffffffffu && (d & 0xffu) != 0xffu) continue;
    size_t ulen = ntohs(uh->len);
    if (ulen < 8 || ihl + ulen > (size_t)r || ulen > sizeof prev) continue;
    // (one broadcast leaves by each network — wlan0 and eth0 on the emulator, each from its own address, so with its own UDP
    // checksum: the same datagram is its payload; sent on once, the first copy's address as the source)
    struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
    long ms = (now.tv_sec - pt.tv_sec) * 1000 + (now.tv_nsec - pt.tv_nsec) / 1000000;
    if (ulen == prevn && !memcmp(prev, (unsigned char *)uh + 8, ulen - 8) && ms < 200) continue;
    memcpy(prev, (unsigned char *)uh + 8, ulen - 8); prevn = ulen; pt = now;
    struct iphdr *oh = (struct iphdr *)out;
    memset(oh, 0, sizeof *oh);
    oh->version = 4; oh->ihl = 5; oh->ttl = 64; oh->protocol = IPPROTO_UDP; oh->saddr = ih->saddr; oh->daddr = dst.s_addr;
    oh->tot_len = htons((unsigned short)(20 + ulen));
    struct udphdr *ou = (struct udphdr *)(out + 20);
    memcpy(ou, uh, ulen); ou->dest = htons((unsigned short)toport); ou->check = 0;
    struct sockaddr_in to = { 0 }; to.sin_family = AF_INET; to.sin_addr = dst;
    if (sendto(raw, out, 20 + ulen, 0, (struct sockaddr *)&to, sizeof to) < 0) { perror("lab-relay: reflect"); continue; }
    if (n++ < 5) { char a[INET_ADDRSTRLEN]; inet_ntop(AF_INET, &ih->saddr, a, sizeof a); printf("lab-relay: reflected #%lu %zu bytes from %s:%d\n", n, ulen - 8, a, ntohs(uh->source)); fflush(stdout); }
  }
}

int main(int argc, char **argv) {
  if (argc == 4 && !strcmp(argv[1], "--ping")) return ping(argv[2], atoi(argv[3]));
  if (argc == 5 && !strcmp(argv[1], "--reflect")) return reflect(atoi(argv[2]), argv[3], atoi(argv[4]));
  if (argc != 4) { fprintf(stderr, "usage: %s <listen-port> <target-ip> <target-port> | --ping <ip> <port> | --reflect <port> <target-ip> <target-port>\n", argv[0]); return 2; }
  signal(SIGPIPE, SIG_IGN);
  struct sockaddr_in lis = { 0 }, tgt = { 0 };
  lis.sin_family = AF_INET; lis.sin_port = htons((unsigned short)atoi(argv[1])); lis.sin_addr.s_addr = htonl(INADDR_ANY);
  tgt.sin_family = AF_INET; tgt.sin_port = htons((unsigned short)atoi(argv[3]));
  if (inet_pton(AF_INET, argv[2], &tgt.sin_addr) != 1) { fprintf(stderr, "lab-relay: not an IPv4 address: %s\n", argv[2]); return 2; }
  int lf = socket(AF_INET, SOCK_DGRAM, 0), one = 1;
  if (lf < 0) { perror("lab-relay: socket"); return 1; }
  setsockopt(lf, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  setsockopt(lf, SOL_SOCKET, SO_BROADCAST, &one, sizeof one);
  if (bind(lf, (struct sockaddr *)&lis, sizeof lis) < 0) { perror("lab-relay: bind"); return 1; }
  for (int i = 0; i < MAXS; i++) S[i].fd = -1;
  printf("lab-relay: :%s -> %s:%s\n", argv[1], argv[2], argv[3]); fflush(stdout);
  static char buf[65536];
  for (;;) {
    struct pollfd p[MAXS + 1]; int map[MAXS + 1], n = 0;
    time_t now = time(NULL);
    p[n].fd = lf; p[n].events = POLLIN; map[n++] = -1;
    for (int i = 0; i < MAXS; i++) {
      if (S[i].fd < 0) continue;
      if (now - S[i].last > IDLE) { close(S[i].fd); S[i].fd = -1; continue; }
      p[n].fd = S[i].fd; p[n].events = POLLIN; map[n++] = i;
    }
    if (poll(p, (nfds_t)n, 5000) < 0) { if (errno == EINTR) continue; perror("lab-relay: poll"); return 1; }
    for (int k = 0; k < n; k++) {
      if (!(p[k].revents & POLLIN)) continue;
      if (map[k] < 0) {
        struct sockaddr_in from; socklen_t fl = sizeof from;
        ssize_t r = recvfrom(lf, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
        if (r <= 0) continue;
        int s = -1, free_i = -1, oldest = -1;
        for (int i = 0; i < MAXS; i++) {
          if (S[i].fd >= 0 && S[i].peer.sin_addr.s_addr == from.sin_addr.s_addr && S[i].peer.sin_port == from.sin_port) { s = i; break; }
          if (S[i].fd < 0) { if (free_i < 0) free_i = i; }
          else if (oldest < 0 || S[i].last < S[oldest].last) oldest = i;
        }
        if (s < 0) {
          s = free_i >= 0 ? free_i : oldest;
          if (S[s].fd >= 0) close(S[s].fd);
          S[s].fd = socket(AF_INET, SOCK_DGRAM, 0); S[s].peer = from;
          if (S[s].fd < 0 || connect(S[s].fd, (struct sockaddr *)&tgt, sizeof tgt) < 0) { perror("lab-relay: upstream"); if (S[s].fd >= 0) close(S[s].fd); S[s].fd = -1; continue; }
          char a[INET_ADDRSTRLEN]; inet_ntop(AF_INET, &from.sin_addr, a, sizeof a);
          printf("lab-relay: peer %s:%d\n", a, ntohs(from.sin_port)); fflush(stdout);
        }
        S[s].last = time(NULL);
        if (send(S[s].fd, buf, (size_t)r, 0) < 0) { perror("lab-relay: send"); }
        if (S[s].up++ < 3 || !(S[s].up % 500)) { printf("lab-relay: up #%lu %zd bytes id 0x%02x\n", S[s].up, r, (unsigned char)buf[0]); fflush(stdout); }
      } else {
        struct sess *x = &S[map[k]];
        ssize_t r = recv(x->fd, buf, sizeof buf, 0);
        if (r <= 0) continue;
        x->last = time(NULL);
        sendto(lf, buf, (size_t)r, 0, (struct sockaddr *)&x->peer, sizeof x->peer);
        if (x->down++ < 3 || !(x->down % 500)) { printf("lab-relay: down #%lu %zd bytes id 0x%02x\n", x->down, r, (unsigned char)buf[0]); fflush(stdout); }
      }
    }
  }
}
