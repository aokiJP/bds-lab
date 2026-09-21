/* Make AF_INET6 sockets appear to work on kernels without IPv6.
   Used only to let BDS's RakNet start in IPv4-only containers. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>

#define MAXFD 65536
static unsigned char fake[MAXFD];
static unsigned short fakeport[MAXFD];

static int (*real_socket)(int,int,int);
static int (*real_bind)(int,const struct sockaddr*,socklen_t);
static int (*real_setsockopt)(int,int,int,const void*,socklen_t);
static int (*real_getsockname)(int,struct sockaddr*,socklen_t*);
static int (*real_close)(int);

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
  if(domain==AF_INET6){
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
