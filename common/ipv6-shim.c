/* Kernels without IPv6 (containers, CI), LD_PRELOADed into the server (and Wine's processes):
   - AF_INET6 sockets appear to work (BDS's RakNet opens [::]:portv6 and refuses to start otherwise).
     LAB_SHIM_NOSOCK=1 turns this off (NetherNet: BDS falls back to IPv4 by itself; a fake IPv6 socket would hide that).
   - /proc/net/if_inet6 & co. read as empty IPv6 tables instead of "no such file": Wine's GetAdaptersAddresses(AF_UNSPEC)
     fails as a whole without them (ERROR_BUFFER_OVERFLOW/garbage), so a Windows server under Wine sees no network and
     NetherNet gathers no ICE candidates (signaling answers 504). Only when the real file is missing. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>
#include <stdio.h>
#include <stdarg.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/syscall.h>

#define MAXFD 65536
static unsigned char fake[MAXFD];
static unsigned short fakeport[MAXFD];

static int (*real_socket)(int,int,int);
static int (*real_bind)(int,const struct sockaddr*,socklen_t);
static int (*real_setsockopt)(int,int,int,const void*,socklen_t);
static int (*real_getsockname)(int,struct sockaddr*,socklen_t*);
static int (*real_close)(int);
static int nosock=-1;
static int sockon(void){ if(nosock<0){ const char*e=getenv("LAB_SHIM_NOSOCK"); nosock=e&&*e=='1'; } return !nosock; }

static void init(void){
  if(!real_socket){
    real_socket=dlsym(RTLD_NEXT,"socket");
    real_bind=dlsym(RTLD_NEXT,"bind");
    real_setsockopt=dlsym(RTLD_NEXT,"setsockopt");
    real_getsockname=dlsym(RTLD_NEXT,"getsockname");
    real_close=dlsym(RTLD_NEXT,"close");
  }
}

int socket(int domain,int type,int protocol){
  init();
  if(domain==AF_INET6&&sockon()){
    int fd=real_socket(AF_INET,type,protocol);
    if(fd>=0&&fd<MAXFD){fake[fd]=1;fakeport[fd]=0;}
    return fd;
  }
  return real_socket(domain,type,protocol);
}

int bind(int fd,const struct sockaddr*addr,socklen_t len){
  init();
  if(fd>=0&&fd<MAXFD&&fake[fd]&&addr&&addr->sa_family==AF_INET6){
    const struct sockaddr_in6*a6=(const struct sockaddr_in6*)addr;
    struct sockaddr_in a4;
    memset(&a4,0,sizeof a4);
    a4.sin_family=AF_INET;
    a4.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    a4.sin_port=0; /* ephemeral: never collides with the real IPv4 listener */
    fakeport[fd]=ntohs(a6->sin6_port);
    return real_bind(fd,(const struct sockaddr*)&a4,sizeof a4);
  }
  return real_bind(fd,addr,len);
}

int setsockopt(int fd,int level,int opt,const void*val,socklen_t len){
  init();
  if(fd>=0&&fd<MAXFD&&fake[fd]&&level==IPPROTO_IPV6) return 0;
  return real_setsockopt(fd,level,opt,val,len);
}

int getsockname(int fd,struct sockaddr*addr,socklen_t*len){
  init();
  if(fd>=0&&fd<MAXFD&&fake[fd]&&len&&*len>=sizeof(struct sockaddr_in6)){
    struct sockaddr_in6 a6;
    memset(&a6,0,sizeof a6);
    a6.sin6_family=AF_INET6;
    a6.sin6_port=htons(fakeport[fd]);
    a6.sin6_addr=in6addr_any;
    memcpy(addr,&a6,sizeof a6);
    *len=sizeof a6;
    return 0;
  }
  return real_getsockname(fd,addr,len);
}

int close(int fd){
  init();
  if(fd>=0&&fd<MAXFD) fake[fd]=0;
  return real_close(fd);
}

/* ---- empty IPv6 tables for readers of /proc (only when the real file is missing) ---- */
static const char*fake6(const char*p){
  static const char*T[][2]={
    {"/proc/net/if_inet6",""},{"/proc/net/ipv6_route",""},{"/proc/net/snmp6",""},
    {"/proc/net/tcp6","  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"},
    {"/proc/net/udp6","  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops\n"},
    {"/proc/sys/net/ipv6/conf/default/forwarding","0\n"},{"/proc/sys/net/ipv6/conf/default/hop_limit","64\n"}};
  if(!p||strncmp(p,"/proc/",6)) return NULL;
  for(unsigned i=0;i<sizeof T/sizeof T[0];i++) if(!strcmp(p,T[i][0])) return T[i][1];
  return NULL;
}
static int (*real_open)(const char*,int,...);
static int (*real_open64)(const char*,int,...);
static int (*real_openat)(int,const char*,int,...);
static FILE*(*real_fopen)(const char*,const char*);
static FILE*(*real_fopen64)(const char*,const char*);
static void initf(void){
  if(!real_open){ real_open=dlsym(RTLD_NEXT,"open"); real_open64=dlsym(RTLD_NEXT,"open64"); real_openat=dlsym(RTLD_NEXT,"openat");
    real_fopen=dlsym(RTLD_NEXT,"fopen"); real_fopen64=dlsym(RTLD_NEXT,"fopen64"); }
}
/* a readable, seekable fd holding text (memfd; a pipe where memfd is missing) */
static int memtext(const char*t){
  size_t n=strlen(t);
#ifdef SYS_memfd_create
  int fd=(int)syscall(SYS_memfd_create,"lab-ipv6",0);
  if(fd>=0){ if(n&&write(fd,t,n)!=(ssize_t)n){ real_close?real_close(fd):0; return -1; } lseek(fd,0,SEEK_SET); return fd; }
#endif
  int pp[2]; if(pipe(pp)) return -1; if(n) (void)!write(pp[1],t,n); if(real_close) real_close(pp[1]); else syscall(SYS_close,pp[1]); return pp[0];
}
/* the fake only stands in for a file that does not exist (a kernel with IPv6 keeps its real tables) */
static const char*want(const char*p,int fl){ const char*t=fake6(p); if(!t||(fl&O_ACCMODE)!=O_RDONLY) return NULL; return access(p,F_OK)?t:NULL; }
static int vopen(int(*f)(const char*,int,...),const char*p,int fl,va_list ap){
  const char*t=want(p,fl); if(t) return memtext(t);
  if(fl&(O_CREAT|O_TMPFILE)){ mode_t m=va_arg(ap,mode_t); return f(p,fl,m); } return f(p,fl);
}
int open(const char*p,int fl,...){ init(); initf(); va_list ap; va_start(ap,fl); int r=vopen(real_open,p,fl,ap); va_end(ap); return r; }
int open64(const char*p,int fl,...){ init(); initf(); va_list ap; va_start(ap,fl); int r=vopen(real_open64?real_open64:real_open,p,fl,ap); va_end(ap); return r; }
int openat(int d,const char*p,int fl,...){
  init(); initf(); const char*t=(p[0]=='/')?want(p,fl):NULL; if(t) return memtext(t);
  va_list ap; va_start(ap,fl); int r; if(fl&(O_CREAT|O_TMPFILE)){ mode_t m=va_arg(ap,mode_t); r=real_openat(d,p,fl,m); } else r=real_openat(d,p,fl); va_end(ap); return r;
}
static FILE*ffake(const char*p,const char*m){ if(!m||m[0]!='r'||strchr(m,'+')) return NULL; const char*t=fake6(p); if(!t||!access(p,F_OK)) return NULL; int fd=memtext(t); return fd<0?NULL:fdopen(fd,"r"); }
FILE*fopen(const char*p,const char*m){ init(); initf(); FILE*f=ffake(p,m); return f?f:real_fopen(p,m); }
FILE*fopen64(const char*p,const char*m){ init(); initf(); FILE*f=ffake(p,m); return f?f:(real_fopen64?real_fopen64:real_fopen)(p,m); }
