// LAB_SPEED's companion, preloaded just before libfaketime: BDS's network layer (RakNet) keeps the real clock.
// RakNet times its peers with gettimeofday(): sped up with the rest, its 10 s timeout became 0.2 s of real time at 50x, and a pause of
// the machine that long (a busy login on 2 cores) dropped the player. So gettimeofday() reads the real clock here. RakNet also sleeps
// with pthread_cond_timedwait() until gettimeofday() + n ms; libfaketime would take that deadline for a sped-up one (in the past:
// the network thread spun on one core), so a deadline on the real clock is waited for on the real clock. The game's own clocks
// (clock_gettime, the ticks, sleeps and the other timed waits) stay sped up by libfaketime. (Script API Date.now() reads the real
// clock too; game time is system.currentTick.)
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

typedef int (*cgt_fn)(clockid_t, struct timespec *);
typedef int (*ctw_fn)(pthread_cond_t *, pthread_mutex_t *, const struct timespec *);
static cgt_fn real_cgt, next_cgt;   // libc's clock_gettime (the vDSO), libfaketime's
static ctw_fn real_ctw, next_ctw;   // libc's pthread_cond_timedwait, libfaketime's

__attribute__((constructor)) static void init(void) {
  void *libc = dlopen("libc.so.6", RTLD_LAZY | RTLD_NOLOAD), *lpt = dlopen("libpthread.so.0", RTLD_LAZY | RTLD_NOLOAD);
  if (libc) real_cgt = (cgt_fn)dlsym(libc, "clock_gettime");
  // (glibc < 2.34 keeps the condition variables in libpthread)
  if (lpt) real_ctw = (ctw_fn)dlvsym(lpt, "pthread_cond_timedwait", "GLIBC_2.3.2");
  if (!real_ctw && libc) real_ctw = (ctw_fn)dlvsym(libc, "pthread_cond_timedwait", "GLIBC_2.3.2");
  next_cgt = (cgt_fn)dlsym(RTLD_NEXT, "clock_gettime");
  next_ctw = (ctw_fn)dlvsym(RTLD_NEXT, "pthread_cond_timedwait", "GLIBC_2.3.2");
  if (!next_ctw) next_ctw = (ctw_fn)dlsym(RTLD_NEXT, "pthread_cond_timedwait");
}

int gettimeofday(struct timeval *restrict tv, void *restrict tz) {
  struct timespec ts;
  if (!tz && real_cgt && real_cgt(CLOCK_REALTIME, &ts) == 0) {
    if (tv) { tv->tv_sec = ts.tv_sec; tv->tv_usec = ts.tv_nsec / 1000; }
    return 0;
  }
  return (int)syscall(SYS_gettimeofday, tv, tz);
}

int pthread_cond_timedwait(pthread_cond_t *restrict c, pthread_mutex_t *restrict m, const struct timespec *restrict at) {
  if (at && real_cgt && next_cgt && real_ctw) {
    struct timespec r, f;
    if (real_cgt(CLOCK_REALTIME, &r) == 0 && next_cgt(CLOCK_REALTIME, &f) == 0) {
      double d = at->tv_sec + at->tv_nsec / 1e9, rn = r.tv_sec + r.tv_nsec / 1e9, fn = f.tv_sec + f.tv_nsec / 1e9;
      // near the real now (a minute back to two ahead) and well before the sped-up now: a deadline on the real clock (a monotonic
      // deadline, days of uptime, is far from either epoch time and goes to libfaketime as before)
      if (d - rn > -60 && d - rn < 120 && fn - d > 1) return real_ctw(c, m, at);
    }
  }
  if (next_ctw) return next_ctw(c, m, at);
  return real_ctw ? real_ctw(c, m, at) : 22;   // (EINVAL: nothing to wait with)
}
