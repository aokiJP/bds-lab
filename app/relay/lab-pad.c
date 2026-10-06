// lab-pad: a game controller on the Android device, as a person plugs one in (the kernel's uinput: an "Xbox Wireless
// Controller" with its buttons, sticks and D-pad). Minecraft 1.26's new screens (Ore UI) take a controller where they ignore
// taps on the emulator, and the shell's injected key events (`input gamepad`, device -1) reach them unevenly: from a real
// device each press has its own down, a moment held, and its up. Commands are read from a FIFO, one word each:
//   A B X Y LB RB LT RT SELECT START HOME L3 R3 UP DOWN LEFT RIGHT   (a press)   wait<ms>   (a pause)   hold<ms>
//   lab-pad <fifo>        echo "A DOWN A" > <fifo>
// A button is held 500 ms (hold<ms> changes it for the presses after it): the game samples its buttons once a frame, and
// on the CI device (4 frames a second) a 90 ms press was missed again and again where a 600 ms one was taken at once
// No C library (x86_64 system calls): a few kilobytes, so it can be put on a device by any means. Built by the lab (cc),
// never committed as a binary.
#include <linux/input.h>
#include <linux/uinput.h>

typedef unsigned long u64;
static long sys(long n, long a, long b, long c, long d) {
  long r;
  register long r10 __asm__("r10") = d;
  __asm__ volatile("syscall" : "=a"(r) : "a"(n), "D"(a), "S"(b), "d"(c), "r"(r10) : "rcx", "r11", "memory");
  return r;
}
#define SYS_read 0
#define SYS_write 1
#define SYS_open 2
#define SYS_close 3
#define SYS_ioctl 16
#define SYS_nanosleep 35
#define SYS_exit 60
#define SYS_mknodat 259
#define AT_FDCWD -100
#define O_RDONLY 0
#define O_WRONLY 1
#define O_NONBLOCK 04000

static int ufd;
static long hold_ms = 500;
static void say(const char *s) { long n = 0; while (s[n]) n++; sys(SYS_write, 1, (long)s, n, 0); }
static void nap(long ms) { struct { long s, ns; } t = { ms / 1000, (ms % 1000) * 1000000L }; sys(SYS_nanosleep, (long)&t, 0, 0, 0); }
static void emit(int type, int code, int value) {
  struct input_event e;
  char *p = (char *)&e;
  for (unsigned i = 0; i < sizeof e; i++) p[i] = 0;
  e.type = (unsigned short)type; e.code = (unsigned short)code; e.value = value;
  sys(SYS_write, ufd, (long)&e, sizeof e, 0);
}
static void syn(void) { emit(EV_SYN, SYN_REPORT, 0); }
static int eq(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }

static const struct { const char *name; int key; } KEYS[] = {
  { "A", BTN_A }, { "B", BTN_B }, { "X", BTN_X }, { "Y", BTN_Y }, { "LB", BTN_TL }, { "RB", BTN_TR }, { "SELECT", BTN_SELECT },
  { "START", BTN_START }, { "HOME", BTN_MODE }, { "L3", BTN_THUMBL }, { "R3", BTN_THUMBR },
};
static void press(const char *w) {
  // the D-pad: the hat axis, as a controller reports it (Android turns it into DPAD keys)
  if (eq(w, "UP") || eq(w, "DOWN") || eq(w, "LEFT") || eq(w, "RIGHT")) {
    int axis = (eq(w, "UP") || eq(w, "DOWN")) ? ABS_HAT0Y : ABS_HAT0X, v = (eq(w, "UP") || eq(w, "LEFT")) ? -1 : 1;
    emit(EV_ABS, axis, v); syn(); nap(hold_ms); emit(EV_ABS, axis, 0); syn(); nap(200); return;
  }
  // the triggers: an axis pulled all the way
  if (eq(w, "LT") || eq(w, "RT")) { int axis = eq(w, "LT") ? ABS_Z : ABS_RZ; emit(EV_ABS, axis, 1023); syn(); nap(hold_ms); emit(EV_ABS, axis, 0); syn(); nap(200); return; }
  for (unsigned i = 0; i < sizeof KEYS / sizeof KEYS[0]; i++) if (eq(w, KEYS[i].name)) { emit(EV_KEY, KEYS[i].key, 1); syn(); nap(hold_ms); emit(EV_KEY, KEYS[i].key, 0); syn(); nap(200); return; }
  if (w[0] == 'w' && w[1] == 'a' && w[2] == 'i' && w[3] == 't') { long ms = 0; for (const char *p = w + 4; *p >= '0' && *p <= '9'; p++) ms = ms * 10 + (*p - '0'); nap(ms); return; }
  if (w[0] == 'h' && w[1] == 'o' && w[2] == 'l' && w[3] == 'd') { long ms = 0; for (const char *p = w + 4; *p >= '0' && *p <= '9'; p++) ms = ms * 10 + (*p - '0'); if (ms > 0 && ms < 10000) hold_ms = ms; return; }
  say("lab-pad: unknown "); say(w); say("\n");
}
static void abs_axis(int code, int min, int max) {
  struct uinput_abs_setup a;
  char *p = (char *)&a;
  for (unsigned i = 0; i < sizeof a; i++) p[i] = 0;
  a.code = (unsigned short)code; a.absinfo.minimum = min; a.absinfo.maximum = max;
  sys(SYS_ioctl, ufd, UI_SET_ABSBIT, code, 0);
  sys(SYS_ioctl, ufd, UI_ABS_SETUP, (long)&a, 0);
}

// (the entry: the stack as the kernel left it — argc, then argv — handed to C, the stack aligned)
__asm__(".globl _start\n_start:\n  mov %rsp, %rdi\n  and $-16, %rsp\n  call cstart\n  hlt\n");
void cstart(long *sp) {
  long argc = sp[0]; char **argv = (char **)(sp + 1);
  if (argc != 2) { say("usage: lab-pad <fifo>\n"); sys(SYS_exit, 2, 0, 0, 0); }
  ufd = (int)sys(SYS_open, (long)"/dev/uinput", O_WRONLY | O_NONBLOCK, 0, 0);
  if (ufd < 0) { say("lab-pad: /dev/uinput (root?)\n"); sys(SYS_exit, 1, 0, 0, 0); }
  sys(SYS_ioctl, ufd, UI_SET_EVBIT, EV_KEY, 0); sys(SYS_ioctl, ufd, UI_SET_EVBIT, EV_ABS, 0); sys(SYS_ioctl, ufd, UI_SET_EVBIT, EV_SYN, 0);
  for (unsigned i = 0; i < sizeof KEYS / sizeof KEYS[0]; i++) sys(SYS_ioctl, ufd, UI_SET_KEYBIT, KEYS[i].key, 0);
  abs_axis(ABS_X, -32768, 32767); abs_axis(ABS_Y, -32768, 32767); abs_axis(ABS_RX, -32768, 32767); abs_axis(ABS_RY, -32768, 32767);
  abs_axis(ABS_Z, 0, 1023); abs_axis(ABS_RZ, 0, 1023); abs_axis(ABS_HAT0X, -1, 1); abs_axis(ABS_HAT0Y, -1, 1);
  struct uinput_setup u;
  char *p = (char *)&u;
  for (unsigned i = 0; i < sizeof u; i++) p[i] = 0;
  const char *name = "Xbox Wireless Controller";
  for (int i = 0; name[i]; i++) u.name[i] = name[i];
  u.id.bustype = BUS_USB; u.id.vendor = 0x045e; u.id.product = 0x02ea; u.id.version = 0x0301;
  if (sys(SYS_ioctl, ufd, UI_DEV_SETUP, (long)&u, 0) < 0 || sys(SYS_ioctl, ufd, UI_DEV_CREATE, 0, 0) < 0) { say("lab-pad: uinput setup failed\n"); sys(SYS_exit, 1, 0, 0, 0); }
  // a named pipe for the commands (S_IFIFO | 0666), opened again after each writer
  sys(SYS_mknodat, AT_FDCWD, (long)argv[1], 0010666, 0);
  say("lab-pad: controller up, commands from "); say(argv[1]); say("\n");
  static char buf[4096], word[64];
  for (;;) {
    int f = (int)sys(SYS_open, (long)argv[1], O_RDONLY, 0, 0);
    if (f < 0) { nap(500); continue; }
    int wl = 0;
    for (;;) {
      long n = sys(SYS_read, f, (long)buf, sizeof buf, 0);
      if (n <= 0) break;
      for (long i = 0; i < n; i++) {
        char c = buf[i];
        if (c == ' ' || c == '\n' || c == '\t' || c == ',') { if (wl) { word[wl] = 0; press(word); wl = 0; } }
        else if (wl < 63) word[wl++] = c;
      }
    }
    if (wl) { word[wl] = 0; press(word); }
    sys(SYS_close, f, 0, 0, 0);
  }
}
